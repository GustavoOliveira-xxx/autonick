-- 202611250001_arquivos_logos: E03 (evolução integrada). Infraestrutura de arquivos e logos das empresas.
-- 1) Metadados de arquivos (os bytes ficam no armazenamento local da API Java, fora do banco e do Git).
-- 2) Limites de arquivos como parâmetros administráveis (mesma tabela dos limites da plataforma, ampliada).
-- 3) Logo da empresa: vale na hora no ERP; na vitrine pública só depois da aprovação da CK (cópia na solicitação e no cartão).
-- 4) Imagem do produto (pública só se o produto estiver na vitrine de uma empresa publicada).
-- Regra de leitura: quem pode ler é decidido aqui, nunca pelo navegador. Registro inexistente e registro proibido têm a
-- mesma resposta (nada), para não revelar a existência de arquivos de outras empresas.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Limites da plataforma viram a central de parâmetros (colunas novas, valores atuais preservados)
-- ---------------------------------------------------------------------------
ALTER TABLE app_private.limites_plataforma
  ADD COLUMN categoria text NOT NULL DEFAULT 'Solicitações e atendimento',
  ADD COLUMN nome text,
  ADD COLUMN unidade text,
  ADD COLUMN valor_padrao integer,
  ADD COLUMN versao integer NOT NULL DEFAULT 1;
UPDATE app_private.limites_plataforma SET valor_padrao = valor WHERE valor_padrao IS NULL;
ALTER TABLE app_private.limites_plataforma ALTER COLUMN valor_padrao SET NOT NULL;

INSERT INTO app_private.limites_plataforma (chave, valor, minimo, maximo, descricao, categoria, nome, unidade, valor_padrao) VALUES
  ('arquivos_imagem_max_kb', 2048, 256, 8192, 'Tamanho máximo de cada imagem enviada (logos e fotos de produtos).', 'Arquivos', 'Tamanho máximo de imagem', 'KB', 2048),
  ('arquivos_documento_max_kb', 5120, 512, 20480, 'Tamanho máximo de cada documento PDF anexado.', 'Arquivos', 'Tamanho máximo de documento', 'KB', 5120),
  ('arquivos_dimensao_max_px', 4096, 512, 8192, 'Maior largura ou altura aceita numa imagem (evita imagens abusivas).', 'Arquivos', 'Dimensão máxima de imagem', 'px', 4096),
  ('arquivos_cota_empresa_mb', 200, 20, 2048, 'Espaço total de arquivos ativos por empresa.', 'Arquivos', 'Espaço por empresa', 'MB', 200)
ON CONFLICT (chave) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Metadados de arquivos
-- ---------------------------------------------------------------------------
CREATE TABLE public.arquivos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid REFERENCES public.empresas (id),
  dono_auth_id     text NOT NULL,
  finalidade       text NOT NULL CHECK (finalidade IN ('logo_empresa', 'imagem_produto', 'anexo_solicitacao', 'evidencia_os', 'documento')),
  tipo_mime        text NOT NULL CHECK (tipo_mime IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  tamanho_bytes    integer NOT NULL CHECK (tamanho_bytes > 0),
  largura          integer CHECK (largura > 0),
  altura           integer CHECK (altura > 0),
  sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  nome_original    text CHECK (char_length(nome_original) <= 200),
  referencia_tipo  text CHECK (referencia_tipo IN ('produto', 'solicitacao', 'ordem_servico')),
  referencia_id    uuid,
  armazenamento    text NOT NULL DEFAULT 'local' CHECK (armazenamento IN ('local')),
  estado           text NOT NULL DEFAULT 'ativo' CHECK (estado IN ('ativo', 'removido')),
  criado_em        timestamptz NOT NULL DEFAULT clock_timestamp(),
  removido_em      timestamptz,
  removido_por     text,
  CHECK ((estado = 'removido') = (removido_em IS NOT NULL)),
  CHECK ((tipo_mime = 'application/pdf') = (largura IS NULL))
);
COMMENT ON TABLE public.arquivos IS
  'Metadados dos arquivos enviados. O conteúdo fica no armazenamento local da API Java (caminho derivado só do id). Acesso só por função.';
CREATE INDEX arquivos_empresa ON public.arquivos (empresa_id, estado);
CREATE INDEX arquivos_referencia ON public.arquivos (referencia_tipo, referencia_id) WHERE estado = 'ativo';
ALTER TABLE public.arquivos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arquivos FROM PUBLIC, anonymous, authenticated;

ALTER TABLE public.empresas ADD COLUMN logo_arquivo_id uuid REFERENCES public.arquivos (id);
ALTER TABLE public.solicitacoes_publicacao ADD COLUMN logo_arquivo_id uuid REFERENCES public.arquivos (id);
ALTER TABLE public.public_empresa_cards ADD COLUMN logo_arquivo_id uuid REFERENCES public.arquivos (id);
ALTER TABLE public.produtos ADD COLUMN imagem_arquivo_id uuid REFERENCES public.arquivos (id);

-- A solicitação enviada para análise guarda a logo daquele momento (cópia congelada, como os dados públicos).
CREATE FUNCTION app_private.solicitacao_copiar_logo() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  SELECT e.logo_arquivo_id INTO NEW.logo_arquivo_id FROM public.empresas e WHERE e.id = NEW.empresa_id;
  RETURN NEW;
END $$;
CREATE TRIGGER solicitacao_copia_logo BEFORE INSERT ON public.solicitacoes_publicacao
  FOR EACH ROW EXECUTE FUNCTION app_private.solicitacao_copiar_logo();

CREATE FUNCTION app_private.solicitacao_logo_congelada() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.logo_arquivo_id IS DISTINCT FROM OLD.logo_arquivo_id THEN
    RAISE EXCEPTION 'A logo enviada para análise não pode ser alterada.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER solicitacao_logo_congelada BEFORE UPDATE ON public.solicitacoes_publicacao
  FOR EACH ROW EXECUTE FUNCTION app_private.solicitacao_logo_congelada();

-- O cartão público só troca de logo quando a projeção vem de uma solicitação aprovada (nova origem).
-- Alterações diretas de menor risco (mesma origem) mantêm a logo aprovada.
CREATE FUNCTION app_private.cartao_logo_aprovada() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.solicitacao_origem_id IS DISTINCT FROM OLD.solicitacao_origem_id THEN
    SELECT s.logo_arquivo_id INTO NEW.logo_arquivo_id FROM public.solicitacoes_publicacao s
     WHERE s.id = NEW.solicitacao_origem_id;
  ELSE
    NEW.logo_arquivo_id := OLD.logo_arquivo_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cartao_logo_aprovada BEFORE INSERT OR UPDATE ON public.public_empresa_cards
  FOR EACH ROW EXECUTE FUNCTION app_private.cartao_logo_aprovada();

-- ---------------------------------------------------------------------------
-- 3. Regras
-- ---------------------------------------------------------------------------
-- Permissão exigida para enviar/remover por finalidade (o ator precisa ser membro ativo da empresa).
CREATE FUNCTION app_private.permissao_arquivo(p_finalidade text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_finalidade
    WHEN 'logo_empresa' THEN ARRAY['empresa.alterar']
    WHEN 'imagem_produto' THEN ARRAY['produtos.alterar']
    WHEN 'evidencia_os' THEN ARRAY['servicos.alterar']
    WHEN 'documento' THEN ARRAY['empresa.alterar']
    ELSE ARRAY['orcamentos.visualizar'] END
$$;

-- O arquivo pode ser lido pela pessoa (ou pelo visitante, se p_usuario for NULL)?
CREATE FUNCTION app_private.pode_ler_arquivo(a public.arquivos, p_usuario text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  perms text[];
BEGIN
  IF a.estado <> 'ativo' THEN RETURN false; END IF;
  -- Público: logo aprovada no cartão de empresa publicada; imagem de produto exibido na vitrine de empresa publicada.
  IF EXISTS (SELECT 1 FROM public.public_empresa_cards c JOIN public.empresas e ON e.id = c.empresa_id
              WHERE c.logo_arquivo_id = a.id AND e.situacao_vitrine = 'publicada') THEN RETURN true; END IF;
  IF a.finalidade = 'imagem_produto' AND EXISTS (
       SELECT 1 FROM public.produtos p JOIN public.empresas e ON e.id = p.empresa_id
        WHERE p.imagem_arquivo_id = a.id AND p.ativo AND p.exibir_na_vitrine AND e.situacao_vitrine = 'publicada') THEN RETURN true; END IF;
  IF p_usuario IS NULL THEN RETURN false; END IF;
  -- Cliente titular da solicitação vê os anexos dela (os que ele mandou e os que a empresa anexou para ele).
  IF a.referencia_tipo = 'solicitacao' AND EXISTS (
       SELECT 1 FROM public.solicitacoes_servico s WHERE s.id = a.referencia_id AND s.cliente_auth_id = p_usuario) THEN RETURN true; END IF;
  IF a.empresa_id IS NULL THEN RETURN a.dono_auth_id = p_usuario; END IF;
  IF NOT app_private.eh_membro(a.empresa_id, p_usuario) THEN RETURN false; END IF;
  perms := app_private.permissoes_de(a.empresa_id, p_usuario);
  RETURN CASE a.finalidade
    WHEN 'logo_empresa' THEN true
    WHEN 'imagem_produto' THEN perms && ARRAY['produtos.visualizar', 'estoque.visualizar', 'vendas.visualizar', 'pedidos.visualizar']
    WHEN 'evidencia_os' THEN 'servicos.visualizar' = ANY (perms)
    WHEN 'anexo_solicitacao' THEN perms && ARRAY['orcamentos.visualizar', 'servicos.visualizar']
    WHEN 'documento' THEN 'empresa.visualizar' = ANY (perms) OR app_private.eh_proprietario_de(a.empresa_id, p_usuario)
    ELSE false END;
END $$;
REVOKE ALL ON FUNCTION app_private.pode_ler_arquivo(public.arquivos, text) FROM PUBLIC;

CREATE FUNCTION app_private.arquivo_json(a public.arquivos) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', a.id, 'finalidade', a.finalidade, 'tipo_mime', a.tipo_mime, 'tamanho_bytes', a.tamanho_bytes,
    'largura', a.largura, 'altura', a.altura, 'nome_original', a.nome_original, 'referencia_tipo', a.referencia_tipo,
    'referencia_id', a.referencia_id, 'criado_em', a.criado_em, 'url', '/api/arquivos/' || a.id)
$$;

-- ---------------------------------------------------------------------------
-- 4. Funções. Registro e leitura de arquivos ficam no schema manutencao: só o papel da API Java recebe EXECUTE
--    (concessões da demonstração), porque só ela valida o conteúdo real antes de registrar. A identidade da pessoa
--    continua vindo do token validado (request.jwt.claims) e é conferida aqui dentro.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS manutencao;
REVOKE ALL ON SCHEMA manutencao FROM PUBLIC;
-- Chamada pela API Java depois de validar o conteúdo real e ANTES de mover o arquivo para o lugar definitivo
-- (na mesma transação: se a gravação falhar, nada fica registrado; se o registro falhar, o arquivo temporário é apagado).
CREATE FUNCTION manutencao.arquivo_registrar(p_empresa_id uuid, p_finalidade text, p_tipo_mime text, p_tamanho_bytes integer,
  p_largura integer, p_altura integer, p_sha256 text, p_nome_original text, p_referencia_tipo text, p_referencia_id uuid,
  p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_finalidade, p_sha256, p_referencia_tipo, p_referencia_id));
  anterior jsonb;
  limite_kb integer;
  usado bigint;
  a public.arquivos;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'arquivo_registrar', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  IF p_finalidade NOT IN ('logo_empresa', 'imagem_produto', 'anexo_solicitacao', 'evidencia_os', 'documento') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Finalidade de arquivo desconhecida.', 'finalidade');
  END IF;
  IF p_tipo_mime NOT IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Tipo de arquivo não aceito.', 'arquivo');
  END IF;
  IF p_finalidade IN ('logo_empresa', 'imagem_produto') AND p_tipo_mime = 'application/pdf' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Use uma imagem PNG, JPG ou WebP.', 'arquivo');
  END IF;
  -- Anexo de solicitação enviado pelo cliente titular: sem empresa no contexto da pessoa, mas o arquivo pertence à empresa da solicitação.
  IF p_finalidade = 'anexo_solicitacao' THEN
    IF p_referencia_tipo IS DISTINCT FROM 'solicitacao' OR p_referencia_id IS NULL THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Anexo precisa estar ligado a uma solicitação.', 'referencia');
    END IF;
    SELECT s.empresa_id INTO p_empresa_id FROM public.solicitacoes_servico s
     WHERE s.id = p_referencia_id AND (s.cliente_auth_id = usuario
       OR (app_private.eh_membro(s.empresa_id, usuario) AND 'orcamentos.criar' = ANY (app_private.permissoes_de(s.empresa_id, usuario))));
    IF p_empresa_id IS NULL THEN PERFORM app_private.erro('NOT_FOUND', 'Solicitação não encontrada.'); END IF;
  ELSE
    IF p_empresa_id IS NULL THEN PERFORM app_private.erro('VALIDATION_ERROR', 'Informe a empresa.', 'empresa_id'); END IF;
    PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, app_private.permissao_arquivo(p_finalidade));
    IF p_finalidade = 'imagem_produto' AND NOT EXISTS (SELECT 1 FROM public.produtos p WHERE p.id = p_referencia_id AND p.empresa_id = p_empresa_id) THEN
      PERFORM app_private.erro('NOT_FOUND', 'Produto não encontrado.', 'referencia');
    END IF;
    IF p_finalidade = 'evidencia_os' AND NOT EXISTS (SELECT 1 FROM public.ordens_servico o WHERE o.id = p_referencia_id AND o.empresa_id = p_empresa_id) THEN
      PERFORM app_private.erro('NOT_FOUND', 'Ordem de serviço não encontrada.', 'referencia');
    END IF;
  END IF;
  limite_kb := CASE WHEN p_tipo_mime = 'application/pdf' THEN app_private.limite('arquivos_documento_max_kb') ELSE app_private.limite('arquivos_imagem_max_kb') END;
  IF p_tamanho_bytes IS NULL OR p_tamanho_bytes <= 0 OR p_tamanho_bytes > limite_kb * 1024 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', format('O arquivo passa do limite de %s KB.', limite_kb), 'arquivo');
  END IF;
  IF p_tipo_mime <> 'application/pdf' AND (p_largura IS NULL OR p_altura IS NULL
       OR greatest(p_largura, p_altura) > app_private.limite('arquivos_dimensao_max_px') OR least(p_largura, p_altura) < 32) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Dimensões da imagem fora do permitido.', 'arquivo');
  END IF;
  SELECT coalesce(sum(tamanho_bytes), 0) INTO usado FROM public.arquivos WHERE empresa_id = p_empresa_id AND estado = 'ativo';
  IF usado + p_tamanho_bytes > app_private.limite('arquivos_cota_empresa_mb')::bigint * 1024 * 1024 THEN
    PERFORM app_private.erro('LIMIT_REACHED', 'O espaço de arquivos desta empresa acabou. Remova arquivos antigos.', 'arquivo');
  END IF;
  INSERT INTO public.arquivos (empresa_id, dono_auth_id, finalidade, tipo_mime, tamanho_bytes, largura, altura, sha256, nome_original,
    referencia_tipo, referencia_id)
  VALUES (p_empresa_id, usuario, p_finalidade, p_tipo_mime, p_tamanho_bytes,
    CASE WHEN p_tipo_mime = 'application/pdf' THEN NULL ELSE p_largura END, CASE WHEN p_tipo_mime = 'application/pdf' THEN NULL ELSE p_altura END,
    lower(p_sha256), left(nullif(btrim(p_nome_original), ''), 200), p_referencia_tipo, p_referencia_id)
  RETURNING * INTO a;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'arquivo.enviado', 'arquivos', a.id,
    jsonb_build_object('finalidade', a.finalidade, 'tipo', a.tipo_mime, 'tamanho', a.tamanho_bytes));
  RETURN app_private.idem_fim(usuario, 'arquivo_registrar', p_operation_key, assinatura, app_private.arquivo_json(a));
END $$;

-- Usada pela API Java no download: devolve os metadados só para quem pode ler (visitante: p_usuario NULL).
CREATE FUNCTION manutencao.arquivo_para_leitura(p_arquivo_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  a public.arquivos;
  usuario text := nullif((SELECT auth.user_id()), '');
BEGIN
  SELECT * INTO a FROM public.arquivos WHERE id = p_arquivo_id;
  IF NOT FOUND OR NOT app_private.pode_ler_arquivo(a, usuario) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id', a.id, 'tipo_mime', a.tipo_mime, 'tamanho_bytes', a.tamanho_bytes, 'sha256', a.sha256,
    'nome_original', a.nome_original,
    'publico', app_private.pode_ler_arquivo(a, NULL));
END $$;

CREATE FUNCTION public.arquivo_remover(p_arquivo_id uuid, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  anterior jsonb;
  a public.arquivos;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'arquivo_remover', p_operation_key, p_arquivo_id::text);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO a FROM public.arquivos WHERE id = p_arquivo_id AND estado = 'ativo' FOR UPDATE;
  IF NOT FOUND OR a.empresa_id IS NULL OR NOT app_private.eh_membro(a.empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Arquivo não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(a.empresa_id, usuario, app_private.permissao_arquivo(a.finalidade));
  -- A logo aprovada na vitrine continua valendo até uma nova aprovação: ela não pode ser removida enquanto estiver publicada.
  IF EXISTS (SELECT 1 FROM public.public_empresa_cards c WHERE c.logo_arquivo_id = a.id) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta logo está publicada na vitrine. Envie outra e aguarde a aprovação para trocar.');
  END IF;
  UPDATE public.empresas SET logo_arquivo_id = NULL, atualizado_em = now() WHERE id = a.empresa_id AND logo_arquivo_id = a.id;
  UPDATE public.produtos SET imagem_arquivo_id = NULL WHERE imagem_arquivo_id = a.id;
  UPDATE public.arquivos SET estado = 'removido', removido_em = clock_timestamp(), removido_por = usuario WHERE id = a.id RETURNING * INTO a;
  PERFORM app_private.auditar(a.empresa_id, usuario, 'arquivo.removido', 'arquivos', a.id, jsonb_build_object('finalidade', a.finalidade));
  RETURN app_private.idem_fim(usuario, 'arquivo_remover', p_operation_key, p_arquivo_id::text, jsonb_build_object('id', a.id, 'estado', a.estado));
END $$;

-- Logo da empresa (ERP): vale na hora para a equipe; a vitrine só muda quando a CK aprovar um novo envio.
CREATE FUNCTION public.definir_logo_empresa(p_empresa_id uuid, p_arquivo_id uuid, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_arquivo_id));
  anterior jsonb;
  v_antes uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_logo_empresa', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['empresa.alterar']);
  IF p_arquivo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.arquivos a WHERE a.id = p_arquivo_id AND a.empresa_id = p_empresa_id
       AND a.finalidade = 'logo_empresa' AND a.estado = 'ativo') THEN
    PERFORM app_private.erro('NOT_FOUND', 'Logo não encontrada.', 'arquivo');
  END IF;
  SELECT logo_arquivo_id INTO v_antes FROM public.empresas WHERE id = p_empresa_id FOR UPDATE;
  UPDATE public.empresas SET logo_arquivo_id = p_arquivo_id, atualizado_em = now() WHERE id = p_empresa_id;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'empresa.logo_definida', 'empresas', p_empresa_id,
    jsonb_build_object('antes', v_antes, 'depois', p_arquivo_id));
  RETURN app_private.idem_fim(usuario, 'definir_logo_empresa', p_operation_key, assinatura, app_private.logo_da_empresa(p_empresa_id));
END $$;

-- Situação da logo: a da equipe, a aprovada na vitrine e se há uma diferente aguardando análise.
CREATE FUNCTION app_private.logo_da_empresa(p_empresa_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'empresa_id', e.id,
    'logo_id', e.logo_arquivo_id,
    'logo_url', CASE WHEN e.logo_arquivo_id IS NULL THEN NULL ELSE '/api/arquivos/' || e.logo_arquivo_id END,
    'logo_vitrine_id', c.logo_arquivo_id,
    'logo_vitrine_url', CASE WHEN c.logo_arquivo_id IS NULL THEN NULL ELSE '/api/arquivos/' || c.logo_arquivo_id END,
    'em_analise', EXISTS (SELECT 1 FROM public.solicitacoes_publicacao s WHERE s.empresa_id = e.id AND s.estado = 'aberta'
                           AND s.logo_arquivo_id IS NOT DISTINCT FROM e.logo_arquivo_id AND s.logo_arquivo_id IS DISTINCT FROM c.logo_arquivo_id),
    'pendente', e.logo_arquivo_id IS DISTINCT FROM c.logo_arquivo_id)
  FROM public.empresas e LEFT JOIN public.public_empresa_cards c ON c.empresa_id = e.id
  WHERE e.id = p_empresa_id
$$;

-- Logos das empresas da pessoa (central de empresas, seletor e menu).
CREATE FUNCTION public.logos_das_minhas_empresas() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(jsonb_object_agg(e.id, app_private.logo_da_empresa(e.id)), '{}'::jsonb)
    FROM public.empresas e
    JOIN public.membros_empresa m ON m.empresa_id = e.id AND m.auth_user_id = app_private.exigir_usuario() AND m.estado = 'ativo'
$$;

-- Logos aprovadas das empresas publicadas (vitrine, inclusive para visitantes sem login).
CREATE FUNCTION public.logos_publicos(p_empresas uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(jsonb_object_agg(c.empresa_id, '/api/arquivos/' || c.logo_arquivo_id), '{}'::jsonb)
    FROM public.public_empresa_cards c JOIN public.empresas e ON e.id = c.empresa_id
   WHERE c.empresa_id = ANY (coalesce(p_empresas, '{}')) AND c.logo_arquivo_id IS NOT NULL AND e.situacao_vitrine = 'publicada'
     AND cardinality(coalesce(p_empresas, '{}')) <= 200
$$;

-- Imagem do produto (a etiqueta CK continua como alternativa visual quando não há imagem).
CREATE FUNCTION public.definir_imagem_produto(p_produto_id uuid, p_arquivo_id uuid, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_produto_id, p_arquivo_id));
  anterior jsonb;
  v_empresa uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_imagem_produto', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT empresa_id INTO v_empresa FROM public.produtos WHERE id = p_produto_id FOR UPDATE;
  IF v_empresa IS NULL OR NOT app_private.eh_membro(v_empresa, usuario) THEN PERFORM app_private.erro('NOT_FOUND', 'Produto não encontrado.'); END IF;
  PERFORM app_private.exigir_permissoes(v_empresa, usuario, ARRAY['produtos.alterar']);
  IF p_arquivo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.arquivos a WHERE a.id = p_arquivo_id AND a.empresa_id = v_empresa
       AND a.finalidade = 'imagem_produto' AND a.estado = 'ativo' AND a.referencia_id = p_produto_id) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Imagem não encontrada.', 'arquivo');
  END IF;
  UPDATE public.produtos SET imagem_arquivo_id = p_arquivo_id WHERE id = p_produto_id;
  PERFORM app_private.auditar(v_empresa, usuario, 'produto.imagem_definida', 'produtos', p_produto_id, jsonb_build_object('arquivo', p_arquivo_id));
  RETURN app_private.idem_fim(usuario, 'definir_imagem_produto', p_operation_key, assinatura,
    jsonb_build_object('produto_id', p_produto_id, 'imagem_id', p_arquivo_id,
      'imagem_url', CASE WHEN p_arquivo_id IS NULL THEN NULL ELSE '/api/arquivos/' || p_arquivo_id END));
END $$;

-- Imagens dos produtos da empresa (listas usam a imagem otimizada; nenhuma cena 3D por produto).
CREATE FUNCTION public.imagens_de_produtos(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  IF NOT app_private.eh_membro(p_empresa_id, usuario) THEN PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.'); END IF;
  RETURN (SELECT coalesce(jsonb_object_agg(p.id, '/api/arquivos/' || p.imagem_arquivo_id), '{}'::jsonb)
            FROM public.produtos p WHERE p.empresa_id = p_empresa_id AND p.imagem_arquivo_id IS NOT NULL);
END $$;

-- Arquivos ligados a um registro (anexos da solicitação, evidências da OS, imagens do produto).
CREATE FUNCTION public.arquivos_do_registro(p_referencia_tipo text, p_referencia_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN (SELECT coalesce(jsonb_agg(app_private.arquivo_json(a) ORDER BY a.criado_em), '[]'::jsonb)
            FROM public.arquivos a
           WHERE a.referencia_tipo = p_referencia_tipo AND a.referencia_id = p_referencia_id AND a.estado = 'ativo'
             AND app_private.pode_ler_arquivo(a, usuario));
END $$;

-- ---------------------------------------------------------------------------
-- 5. Manutenção do armazenamento (só o papel da API recebe EXECUTE, no script de concessões)
-- ---------------------------------------------------------------------------
-- Quais destes ids têm metadados (ativos ou removidos há menos de 30 dias)? Arquivos sem resposta são órfãos.
CREATE FUNCTION manutencao.arquivos_com_metadados(p_ids uuid[]) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.id FROM public.arquivos a
   WHERE a.id = ANY (p_ids) AND (a.estado = 'ativo' OR a.removido_em > now() - interval '30 days')
$$;
REVOKE ALL ON FUNCTION manutencao.arquivos_com_metadados(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION manutencao.arquivo_registrar(uuid, text, text, integer, integer, integer, text, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION manutencao.arquivo_para_leitura(uuid) FROM PUBLIC;

COMMIT;
