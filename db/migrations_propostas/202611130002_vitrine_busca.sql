-- 202611130002: M10, vitrine pública e busca (empresas, serviços e produtos), área de demonstração para contas fictícias
-- autorizadas, visibilidade explícita de produtos e serviços, nome aprovado nos fluxos do cliente (C-01) e histórico dos
-- limites da plataforma para a CK (MINI-ESPEC_M10; ADR-G10 aprovada em 13/11/2026; só no branch `desenvolvimento`).
-- Princípios: o papel `anonymous` executa SÓ três funções de leitura (D10-01) e nenhuma tabela; dados fictícios nunca na
-- rota pública (DF-06); nada é publicado automaticamente (D10-03 = C, D10-04 = B); sem extensão nova (D10-06); sem mapa,
-- sem GPS e sem coordenadas (D10-09, D10-10). Nenhuma permissão nova (catálogo segue com 55).

BEGIN;

-- ===========================================================================
-- 1. Visibilidade explícita na vitrine (D10-03 = C, D10-04 = B): desligada por padrão; nada existente é publicado.
-- ===========================================================================
ALTER TABLE public.produtos ADD COLUMN exibir_na_vitrine boolean NOT NULL DEFAULT false;
ALTER TABLE public.servicos ADD COLUMN exibir_na_vitrine boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.produtos.exibir_na_vitrine IS
  'M10 (D10-03 = C): o produto só aparece na vitrine pública quando a empresa liga este controle; comercializável não basta.';
COMMENT ON COLUMN public.servicos.exibir_na_vitrine IS
  'M10 (D10-04 = B): o serviço só aparece na vitrine pública quando a empresa liga este controle; ativo não basta. Não muda o M08.';

-- ===========================================================================
-- 2. Autorização das contas de demonstração (D10-14, D10-25 = A)
-- ===========================================================================
CREATE TABLE app_private.autorizacoes_demonstracao (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id      text NOT NULL,
  motivo            text NOT NULL CHECK (char_length(motivo) BETWEEN 10 AND 300),
  autorizada_por    text NOT NULL,
  autorizada_em     timestamptz NOT NULL DEFAULT now(),
  expira_em         timestamptz NOT NULL,
  revogada_em       timestamptz,
  motivo_revogacao  text CHECK (motivo_revogacao IS NULL OR char_length(motivo_revogacao) BETWEEN 10 AND 300),
  CHECK (expira_em > autorizada_em AND expira_em <= autorizada_em + interval '30 days'),
  CHECK ((revogada_em IS NULL) = (motivo_revogacao IS NULL))
);
CREATE INDEX autorizacoes_demonstracao_usuario ON app_private.autorizacoes_demonstracao (auth_user_id, expira_em);
ALTER TABLE app_private.autorizacoes_demonstracao ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE app_private.autorizacoes_demonstracao IS
  'M10 (D10-25 = A): contas fictícias autorizadas para a área de demonstração por SQL operacional auditado; validade de até 30 dias, renovável.';

-- Só por SQL operacional no branch `desenvolvimento` (nenhum papel da Data API executa).
CREATE FUNCTION app_private.autorizar_demonstracao(p_auth_user_id text, p_motivo text, p_operador text, p_dias integer DEFAULT 30)
RETURNS uuid LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_ok boolean;
  v_id uuid;
BEGIN
  SELECT lower(u.email), u."emailVerified" INTO v_email, v_ok FROM neon_auth."user" u WHERE u.id::text = p_auth_user_id;
  IF v_email IS NULL OR v_email NOT LIKE '%@autonick-teste.example' THEN
    RAISE EXCEPTION 'Só conta fictícia do domínio autonick-teste.example pode ser autorizada.' USING HINT = 'VALIDATION_ERROR';
  END IF;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'A conta fictícia precisa ter o e-mail confirmado.' USING HINT = 'VALIDATION_ERROR';
  END IF;
  IF p_dias IS NULL OR p_dias NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'A validade vai de 1 a 30 dias.' USING HINT = 'VALIDATION_ERROR';
  END IF;
  IF p_operador IS NULL OR char_length(btrim(p_operador)) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'Informe quem autorizou.' USING HINT = 'VALIDATION_ERROR';
  END IF;
  INSERT INTO app_private.autorizacoes_demonstracao (auth_user_id, motivo, autorizada_por, expira_em)
  VALUES (p_auth_user_id, btrim(p_motivo), btrim(p_operador), now() + make_interval(days => p_dias))
  RETURNING id INTO v_id;
  PERFORM app_private.auditar(NULL, NULL, 'demonstracao.autorizada', 'autorizacoes_demonstracao', v_id,
    jsonb_build_object('conta', p_auth_user_id, 'dias', p_dias, 'operador', btrim(p_operador), 'motivo', btrim(p_motivo)));
  RETURN v_id;
END $$;

CREATE FUNCTION app_private.revogar_demonstracao(p_auth_user_id text, p_motivo text, p_operador text)
RETURNS integer LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE app_private.autorizacoes_demonstracao SET revogada_em = now(), motivo_revogacao = btrim(p_motivo)
   WHERE auth_user_id = p_auth_user_id AND revogada_em IS NULL AND expira_em > now();
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM app_private.auditar(NULL, NULL, 'demonstracao.revogada', 'autorizacoes_demonstracao', NULL,
    jsonb_build_object('conta', p_auth_user_id, 'revogadas', n, 'operador', btrim(p_operador), 'motivo', btrim(p_motivo)));
  RETURN n;
END $$;

CREATE FUNCTION app_private.demonstracao_autorizada(p_usuario text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT p_usuario IS NOT NULL
     AND coalesce(app_private.email_da_pessoa(p_usuario) LIKE '%@autonick-teste.example', false)
     AND EXISTS (SELECT 1 FROM neon_auth."user" u WHERE u.id::text = p_usuario AND u."emailVerified")
     AND EXISTS (SELECT 1 FROM app_private.autorizacoes_demonstracao a
                  WHERE a.auth_user_id = p_usuario AND a.revogada_em IS NULL AND a.expira_em > now())
$$;

CREATE FUNCTION app_private.exigir_demonstracao() RETURNS text
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  IF NOT app_private.demonstracao_autorizada(usuario) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Área disponível só para contas de demonstração autorizadas.');
  END IF;
  RETURN usuario;
END $$;

-- ===========================================================================
-- 3. Núcleo da vitrine: conjunto fixado por quem chama ('publico' ou 'demonstracao'); nunca vem do navegador.
-- ===========================================================================

-- Minúsculas, sem acento (tabela fixa, sem extensão: D10-06 = A), só letras e números, espaços simples.
CREATE FUNCTION app_private.normalizar(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT btrim(regexp_replace(lower(translate(coalesce(p, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- Algum termo do campo começa com p_token (casamento por início de palavra).
CREATE FUNCTION app_private.casa_inicio(p_campo_normalizado text, p_token text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT (' ' || p_campo_normalizado) LIKE '% ' || p_token || '%' $$;

-- Nome aprovado (C-01): o cliente nunca vê o nome da cópia de trabalho.
CREATE FUNCTION app_private.nome_aprovado(p_empresa uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT coalesce(e.dados_publicados ->> 'nome_publico', e.nome_publico) FROM public.empresas e WHERE e.id = p_empresa $$;

-- Cartões elegíveis do conjunto (versão aprovada da projeção do M03).
CREATE FUNCTION app_private.cartoes_do_conjunto(p_conjunto text) RETURNS SETOF public.public_empresa_cards
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT c.* FROM public.public_empresa_cards c JOIN public.empresas e ON e.id = c.empresa_id
   WHERE p_conjunto IN ('publico', 'demonstracao')
     AND e.situacao_vitrine = 'publicada' AND e.situacao_erp = 'ativa' AND e.dados_publicados IS NOT NULL
     AND e.dado_de_teste = (p_conjunto = 'demonstracao') AND c.dado_de_teste = (p_conjunto = 'demonstracao')
$$;

CREATE FUNCTION app_private.servico_publico(p_s public.servicos) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT p_s.ativo AND p_s.exibir_na_vitrine $$;

CREATE FUNCTION app_private.produto_publico(p_p public.produtos) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT p_p.ativo AND p_p.exibir_na_vitrine AND p_p.finalidade = 'comercializavel' AND NOT p_p.venda_pausada
     AND EXISTS (SELECT 1 FROM public.produto_variacoes v WHERE v.produto_id = p_p.id AND v.ativo)
$$;

-- Texto livre sem contato (D10-05, comportamento restritivo): descrição com telefone, e-mail ou endereço web não vai à vitrine.
CREATE FUNCTION app_private.texto_publico(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT CASE WHEN app_private.tem_contato(p) THEN NULL ELSE nullif(btrim(p), '') END $$;

CREATE FUNCTION app_private.servico_vitrine_json(p_s public.servicos) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', p_s.id, 'nome', p_s.nome, 'descricao', app_private.texto_publico(p_s.descricao),
    'categoria', (SELECT nome FROM public.categorias_plataforma WHERE id = p_s.categoria_id),
    'politica_preco', p_s.politica_preco,
    'preco_centavos', CASE WHEN p_s.politica_preco IN ('fixo', 'a_partir_de', 'pacote') THEN app_private.para_centavos(p_s.preco) END,
    'duracao_min', p_s.duracao_min,
    'pacote', CASE WHEN p_s.politica_preco = 'pacote' THEN jsonb_build_object(
      -- Pacote público não revela serviço interno: só os nomes dos incluídos que também estão na vitrine.
      'incluidos', coalesce((SELECT jsonb_agg(x.nome ORDER BY i.ordem) FROM public.servico_pacote_itens i JOIN public.servicos x ON x.id = i.servico_id
                              WHERE i.pacote_id = p_s.id AND app_private.servico_publico(x)), '[]'::jsonb),
      'outros_incluidos', (SELECT count(*) FROM public.servico_pacote_itens i JOIN public.servicos x ON x.id = i.servico_id
                            WHERE i.pacote_id = p_s.id AND NOT app_private.servico_publico(x))) END)
$$;

CREATE FUNCTION app_private.produto_vitrine_json(p_p public.produtos) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', p_p.id, 'nome', p_p.nome, 'descricao', app_private.texto_publico(p_p.descricao),
    'categoria', (SELECT nome FROM public.categorias_plataforma WHERE id = p_p.categoria_id),
    'sob_encomenda', p_p.sob_encomenda,
    'variacoes', coalesce((SELECT jsonb_agg(jsonb_build_object('variacao_id', v.id, 'rotulo', app_private.rotulo_variacao(v.atributos, v.padrao),
        'preco_centavos', app_private.para_centavos(v.preco)) ORDER BY v.padrao DESC, v.criado_em, v.id)
      FROM public.produto_variacoes v WHERE v.produto_id = p_p.id AND v.ativo), '[]'::jsonb))
$$;

CREATE FUNCTION app_private.filtros_do_conjunto(p_conjunto text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'categorias_negocio', coalesce((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'nome', k.nome) ORDER BY k.ordem, k.nome)
      FROM public.categorias_plataforma k WHERE k.tipo = 'negocio' AND k.ativo), '[]'::jsonb),
    'categorias_produto', coalesce((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'nome', k.nome) ORDER BY k.ordem, k.nome)
      FROM public.categorias_plataforma k WHERE k.tipo = 'produto' AND k.ativo), '[]'::jsonb),
    -- D10-08 = A: só localidades das empresas elegíveis do próprio conjunto.
    'cidades', coalesce((SELECT jsonb_agg(jsonb_build_object('nome', x.nome) ORDER BY x.chave)
      FROM (SELECT DISTINCT ON (app_private.normalizar(c.cidade)) app_private.normalizar(c.cidade) AS chave, c.cidade AS nome
              FROM app_private.cartoes_do_conjunto(p_conjunto) c ORDER BY app_private.normalizar(c.cidade), c.cidade) x), '[]'::jsonb),
    'bairros', coalesce((SELECT jsonb_agg(jsonb_build_object('cidade', x.cidade, 'nome', x.nome) ORDER BY x.chave)
      FROM (SELECT DISTINCT ON (app_private.normalizar(c.cidade), app_private.normalizar(c.bairro))
                   app_private.normalizar(c.cidade) || '|' || app_private.normalizar(c.bairro) AS chave, c.cidade, c.bairro AS nome
              FROM app_private.cartoes_do_conjunto(p_conjunto) c WHERE nullif(btrim(c.bairro), '') IS NOT NULL
             ORDER BY app_private.normalizar(c.cidade), app_private.normalizar(c.bairro), c.bairro) x), '[]'::jsonb))
$$;

-- Busca com relevância (D10-06) e faixas de localização (D10-07); limites no servidor (D10-22).
CREATE FUNCTION app_private.buscar_no_conjunto(p_conjunto text, p_filtros jsonb, p_pagina integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  f jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_termo text;
  v_tokens text[];
  v_palavras integer;
  v_tipo text;
  v_cat uuid;
  v_cat_prod uuid;
  v_cidade text;
  v_bairro text;
  v_modalidade text;
  v_ampliar text;
  v_pagina integer := coalesce(p_pagina, 1);
  v_total integer;
  v_itens jsonb;
  v_ordem text;
  POR_PAGINA constant integer := 20;
  MAX_PAGINAS constant integer := 5;
  PARADAS constant text[] := ARRAY['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'nos', 'nas',
                                    'para', 'pra', 'com', 'por', 'um', 'uma'];
BEGIN
  PERFORM app_private.exigir_chaves(f, ARRAY['termo', 'tipo', 'categoria_id', 'categoria_produto_id', 'cidade', 'bairro', 'modalidade', 'ampliar']);
  IF v_pagina NOT BETWEEN 1 AND MAX_PAGINAS THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Mostramos até 5 páginas por busca. Refine a busca para ver outros resultados.', 'pagina');
  END IF;
  v_termo := nullif(btrim(coalesce(f ->> 'termo', '')), '');
  IF char_length(v_termo) > 80 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A busca pode ter até 80 caracteres.', 'termo');
  END IF;
  v_palavras := coalesce(array_length(regexp_split_to_array(app_private.normalizar(v_termo), ' '), 1), 0);
  IF v_termo IS NOT NULL AND v_palavras > 6 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Use até 6 palavras na busca.', 'termo');
  END IF;
  SELECT coalesce(array_agg(DISTINCT t), ARRAY[]::text[]) INTO v_tokens
    FROM unnest(regexp_split_to_array(app_private.normalizar(v_termo), ' ')) t
   WHERE char_length(t) >= 2 AND NOT t = ANY (PARADAS);
  v_tipo := coalesce(nullif(f ->> 'tipo', ''), 'tudo');
  IF v_tipo NOT IN ('tudo', 'empresas', 'servicos', 'produtos') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Tipo de resultado inválido.', 'tipo');
  END IF;
  v_cat := app_private.ler_uuid(f ->> 'categoria_id', 'categoria_id');
  IF v_cat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categorias_plataforma WHERE id = v_cat AND tipo = 'negocio' AND ativo) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Categoria inválida.', 'categoria_id');
  END IF;
  v_cat_prod := app_private.ler_uuid(f ->> 'categoria_produto_id', 'categoria_produto_id');
  IF v_cat_prod IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categorias_plataforma WHERE id = v_cat_prod AND tipo = 'produto' AND ativo) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Categoria de produto inválida.', 'categoria_produto_id');
  END IF;
  v_cidade := nullif(app_private.normalizar(f ->> 'cidade'), '');
  v_bairro := nullif(app_private.normalizar(f ->> 'bairro'), '');
  IF char_length(coalesce(f ->> 'cidade', '')) > 80 OR char_length(coalesce(f ->> 'bairro', '')) > 80 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Cidade e bairro têm até 80 caracteres.', CASE WHEN char_length(coalesce(f ->> 'cidade', '')) > 80 THEN 'cidade' ELSE 'bairro' END);
  END IF;
  IF v_bairro IS NOT NULL AND v_cidade IS NULL THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha a cidade antes do bairro.', 'bairro');
  END IF;
  v_modalidade := nullif(f ->> 'modalidade', '');
  IF v_modalidade IS NOT NULL AND v_modalidade NOT IN ('comercio', 'servicos', 'ambos') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Modalidade inválida.', 'modalidade');
  END IF;
  v_ampliar := nullif(f ->> 'ampliar', '');
  IF v_ampliar IS NOT NULL AND (v_ampliar NOT IN ('bairro', 'cidade') OR v_cidade IS NULL OR (v_ampliar = 'bairro' AND v_bairro IS NULL)) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Ampliação inválida para os filtros escolhidos.', 'ampliar');
  END IF;

  WITH cartoes AS (
    SELECT c.*, app_private.normalizar(c.nome_publico) AS n_nome, app_private.normalizar(c.cidade) AS n_cidade,
           app_private.normalizar(c.bairro) AS n_bairro,
           app_private.normalizar(concat_ws(' ', c.descricao_publica, c.area_atendimento)) AS n_desc,
           app_private.normalizar((SELECT nome FROM public.categorias_plataforma WHERE id = c.categoria_id)) AS n_cat,
           (SELECT nome FROM public.categorias_plataforma WHERE id = c.categoria_id) AS categoria
      FROM app_private.cartoes_do_conjunto(p_conjunto) c
  ),
  itens AS (
    SELECT s.empresa_id, 'servico'::text AS tipo, s.id, s.nome, app_private.normalizar(s.nome) AS n_nome,
           app_private.normalizar(app_private.texto_publico(s.descricao)) AS n_desc,
           app_private.normalizar((SELECT nome FROM public.categorias_plataforma WHERE id = s.categoria_id)) AS n_cat,
           s.categoria_id
      FROM public.servicos s WHERE s.empresa_id IN (SELECT empresa_id FROM cartoes) AND app_private.servico_publico(s)
    UNION ALL
    SELECT p.empresa_id, 'produto', p.id, p.nome, app_private.normalizar(p.nome), app_private.normalizar(app_private.texto_publico(p.descricao)),
           app_private.normalizar((SELECT nome FROM public.categorias_plataforma WHERE id = p.categoria_id)), p.categoria_id
      FROM public.produtos p WHERE p.empresa_id IN (SELECT empresa_id FROM cartoes) AND app_private.produto_publico(p)
  ),
  itens_do_tipo AS (
    SELECT * FROM itens WHERE v_tipo = 'tudo' OR (v_tipo = 'servicos' AND tipo = 'servico') OR (v_tipo = 'produtos' AND tipo = 'produto')
  ),
  filtrados AS (
    SELECT c.* FROM cartoes c
     WHERE (v_modalidade IS NULL OR c.modalidade = v_modalidade OR c.modalidade = 'ambos')
       AND (v_cat IS NULL OR c.categoria_id = v_cat OR EXISTS (SELECT 1 FROM itens i WHERE i.empresa_id = c.empresa_id AND i.tipo = 'servico' AND i.categoria_id = v_cat))
       AND (v_cat_prod IS NULL OR EXISTS (SELECT 1 FROM itens i WHERE i.empresa_id = c.empresa_id AND i.tipo = 'produto' AND i.categoria_id = v_cat_prod))
       AND (v_tipo IN ('tudo', 'empresas') OR EXISTS (SELECT 1 FROM itens_do_tipo i WHERE i.empresa_id = c.empresa_id))
       -- D10-07: com filtro de cidade ou bairro, nada de fora entra sem a ação explícita "ampliar".
       AND (v_cidade IS NULL OR v_ampliar = 'cidade' OR c.n_cidade = v_cidade)
       AND (v_bairro IS NULL OR v_ampliar IS NOT NULL OR c.n_bairro = v_bairro)
  ),
  pesos AS (
    SELECT c.empresa_id, t.token,
           greatest(
             CASE WHEN v_tipo IN ('tudo', 'empresas', 'servicos', 'produtos') AND app_private.casa_inicio(c.n_nome, t.token) THEN 8 ELSE 0 END,
             CASE WHEN v_tipo <> 'empresas' AND EXISTS (SELECT 1 FROM itens_do_tipo i WHERE i.empresa_id = c.empresa_id AND i.tipo = 'servico' AND app_private.casa_inicio(i.n_nome, t.token)) THEN 6 ELSE 0 END,
             CASE WHEN v_tipo <> 'empresas' AND EXISTS (SELECT 1 FROM itens_do_tipo i WHERE i.empresa_id = c.empresa_id AND i.tipo = 'produto' AND app_private.casa_inicio(i.n_nome, t.token)) THEN 5 ELSE 0 END,
             CASE WHEN app_private.casa_inicio(c.n_cat, t.token)
                    OR (v_tipo <> 'empresas' AND EXISTS (SELECT 1 FROM itens_do_tipo i WHERE i.empresa_id = c.empresa_id AND app_private.casa_inicio(i.n_cat, t.token))) THEN 4 ELSE 0 END,
             CASE WHEN app_private.casa_inicio(c.n_desc, t.token) THEN 2 ELSE 0 END,
             CASE WHEN v_tipo <> 'empresas' AND EXISTS (SELECT 1 FROM itens_do_tipo i WHERE i.empresa_id = c.empresa_id AND app_private.casa_inicio(i.n_desc, t.token)) THEN 1 ELSE 0 END
           ) AS peso
      FROM filtrados c CROSS JOIN unnest(v_tokens) AS t(token)
  ),
  pontuados AS (
    SELECT c.*,
           coalesce((SELECT sum(p.peso) FROM pesos p WHERE p.empresa_id = c.empresa_id), 0) AS pontos,
           CASE WHEN v_cidade IS NULL THEN NULL
                WHEN v_bairro IS NOT NULL AND c.n_cidade = v_cidade AND c.n_bairro = v_bairro THEN 'mesmo_bairro'
                WHEN c.n_cidade = v_cidade THEN 'mesma_cidade'
                ELSE 'outros' END AS faixa
      FROM filtrados c
     -- Todas as palavras do termo precisam casar em algum campo da mesma empresa.
     WHERE NOT EXISTS (SELECT 1 FROM pesos p WHERE p.empresa_id = c.empresa_id AND p.peso = 0)
  ),
  ordenados AS (
    SELECT p.*, row_number() OVER (ORDER BY CASE p.faixa WHEN 'mesmo_bairro' THEN 0 WHEN 'mesma_cidade' THEN 1 WHEN 'outros' THEN 2 ELSE 0 END,
                                            p.pontos DESC, p.n_nome, p.empresa_id) AS posicao
      FROM pontuados p
  )
  SELECT (SELECT count(*) FROM ordenados),
         coalesce((SELECT jsonb_agg(jsonb_build_object(
             'empresa_id', o.empresa_id, 'nome_publico', o.nome_publico, 'categoria', o.categoria, 'modalidade', o.modalidade,
             'cidade', o.cidade, 'bairro', o.bairro, 'faixa', o.faixa, 'selo', o.selo,
             'casou_em', CASE WHEN cardinality(v_tokens) = 0 THEN '[]'::jsonb ELSE to_jsonb(array_remove(ARRAY[
                 CASE WHEN EXISTS (SELECT 1 FROM unnest(v_tokens) t WHERE app_private.casa_inicio(o.n_nome, t)) THEN 'nome' END,
                 CASE WHEN v_tipo <> 'empresas' AND EXISTS (SELECT 1 FROM itens_do_tipo i, unnest(v_tokens) t WHERE i.empresa_id = o.empresa_id AND i.tipo = 'servico' AND app_private.casa_inicio(i.n_nome, t)) THEN 'servico' END,
                 CASE WHEN v_tipo <> 'empresas' AND EXISTS (SELECT 1 FROM itens_do_tipo i, unnest(v_tokens) t WHERE i.empresa_id = o.empresa_id AND i.tipo = 'produto' AND app_private.casa_inicio(i.n_nome, t)) THEN 'produto' END,
                 CASE WHEN EXISTS (SELECT 1 FROM unnest(v_tokens) t WHERE app_private.casa_inicio(o.n_cat, t)) THEN 'categoria' END,
                 CASE WHEN EXISTS (SELECT 1 FROM unnest(v_tokens) t WHERE app_private.casa_inicio(o.n_desc, t)) THEN 'descricao' END], NULL)) END,
             'itens_que_casaram', CASE WHEN cardinality(v_tokens) = 0 OR v_tipo = 'empresas' THEN '[]'::jsonb ELSE coalesce((
                 SELECT jsonb_agg(jsonb_build_object('tipo', x.tipo, 'id', x.id, 'nome', x.nome) ORDER BY x.tipo DESC, x.n_nome)
                   FROM (SELECT i.* FROM itens_do_tipo i WHERE i.empresa_id = o.empresa_id
                            AND EXISTS (SELECT 1 FROM unnest(v_tokens) t WHERE app_private.casa_inicio(i.n_nome, t))
                          ORDER BY i.tipo DESC, i.n_nome LIMIT 3) x), '[]'::jsonb) END)
           ORDER BY o.posicao)
           FROM ordenados o WHERE o.posicao > (v_pagina - 1) * POR_PAGINA AND o.posicao <= least(v_pagina * POR_PAGINA, POR_PAGINA * MAX_PAGINAS)), '[]'::jsonb)
    INTO v_total, v_itens;

  v_ordem := CASE
    WHEN v_cidade IS NOT NULL AND v_ampliar IS NOT NULL AND v_bairro IS NOT NULL THEN 'Primeiro neste bairro, depois nesta cidade' || CASE WHEN v_ampliar = 'cidade' THEN ', depois em outras cidades' ELSE '' END
    WHEN v_cidade IS NOT NULL AND v_ampliar = 'cidade' THEN 'Primeiro nesta cidade, depois em outras cidades'
    WHEN v_bairro IS NOT NULL THEN 'Só neste bairro'
    WHEN v_cidade IS NOT NULL THEN 'Só nesta cidade'
    ELSE 'Em todas as cidades' END
    || CASE WHEN cardinality(v_tokens) > 0 THEN ', por relevância da busca.' ELSE ', em ordem alfabética.' END
    || ' Nenhuma posição é paga.';

  RETURN jsonb_build_object('itens', v_itens, 'pagina', v_pagina, 'por_pagina', POR_PAGINA,
    'total', least(v_total, 100), 'mais_de_100', v_total > 100,
    'ha_mais', v_pagina < MAX_PAGINAS AND v_pagina * POR_PAGINA < least(v_total, 100),
    'ordem', v_ordem);
END $$;

-- Perfil de uma empresa do conjunto. Contatos só para quem está logado (D10-20, comportamento restritivo) e só os públicos.
CREATE FUNCTION app_private.vitrine_do_conjunto(p_conjunto text, p_empresa_id uuid, p_logado boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  c public.public_empresa_cards;
  v_servicos jsonb;
  v_produtos jsonb;
BEGIN
  SELECT * INTO c FROM app_private.cartoes_do_conjunto(p_conjunto) x WHERE x.empresa_id = p_empresa_id;
  IF c.empresa_id IS NULL THEN
    -- D10-11: a mesma resposta para indisponível e inexistente.
    PERFORM app_private.erro('NOT_FOUND', 'Esta vitrine não está disponível.');
  END IF;
  SELECT coalesce(jsonb_agg(app_private.servico_vitrine_json(s) ORDER BY lower(s.nome)), '[]'::jsonb) INTO v_servicos
    FROM public.servicos s WHERE s.empresa_id = c.empresa_id AND app_private.servico_publico(s);
  SELECT coalesce(jsonb_agg(app_private.produto_vitrine_json(p) ORDER BY lower(p.nome)), '[]'::jsonb) INTO v_produtos
    FROM public.produtos p WHERE p.empresa_id = c.empresa_id AND app_private.produto_publico(p);
  RETURN jsonb_build_object(
    'empresa', jsonb_build_object('id', c.empresa_id, 'nome_publico', c.nome_publico,
      'categoria', (SELECT nome FROM public.categorias_plataforma WHERE id = c.categoria_id), 'modalidade', c.modalidade,
      'cidade', c.cidade, 'uf', c.uf, 'bairro', c.bairro, 'area_atendimento', c.area_atendimento,
      'descricao_publica', c.descricao_publica, 'horario_funcionamento', c.horario_funcionamento, 'selo', c.selo),
    'servicos', v_servicos, 'produtos', v_produtos,
    'sem_itens', jsonb_array_length(v_servicos) = 0 AND jsonb_array_length(v_produtos) = 0)
    || CASE WHEN p_logado THEN jsonb_build_object('contatos', jsonb_strip_nulls(jsonb_build_object(
         'telefone_publico', nullif(c.telefone_publico, ''), 'whatsapp_publico', nullif(c.whatsapp_publico, ''), 'email_publico', nullif(c.email_publico, ''))))
       ELSE '{}'::jsonb END;
END $$;

-- ===========================================================================
-- 4. Rota pública: as três únicas funções do papel `anonymous` (D10-01). Nenhum parâmetro muda o conjunto.
-- ===========================================================================
CREATE FUNCTION public.filtros_vitrine() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT app_private.filtros_do_conjunto('publico') $$;

CREATE FUNCTION public.buscar_vitrine(p_filtros jsonb DEFAULT '{}'::jsonb, p_pagina integer DEFAULT 1) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT app_private.buscar_no_conjunto('publico', p_filtros, p_pagina) $$;

CREATE FUNCTION public.vitrine_publica(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- authz.usuario_atual(): nulo para o anônimo; com o papel authenticated sem identidade, falha fechada (AUTH_REQUIRED).
  RETURN app_private.vitrine_do_conjunto('publico', p_empresa_id, (SELECT authz.usuario_atual()) IS NOT NULL);
END $$;

-- ===========================================================================
-- 5. Área de demonstração (D10-14): só contas fictícias autorizadas (D10-25), só empresas fictícias.
-- ===========================================================================
CREATE FUNCTION public.filtros_demonstracao() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.exigir_demonstracao();
  RETURN app_private.filtros_do_conjunto('demonstracao') || jsonb_build_object('demonstracao', true);
END $$;

CREATE FUNCTION public.buscar_demonstracao(p_filtros jsonb DEFAULT '{}'::jsonb, p_pagina integer DEFAULT 1) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.exigir_demonstracao();
  RETURN app_private.buscar_no_conjunto('demonstracao', p_filtros, p_pagina) || jsonb_build_object('demonstracao', true);
END $$;

CREATE FUNCTION public.vitrine_demonstracao(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.exigir_demonstracao();
  RETURN app_private.vitrine_do_conjunto('demonstracao', p_empresa_id, true) || jsonb_build_object('demonstracao', true);
END $$;

-- Situação da autorização da própria conta (a tela mostra a validade, sem dado de outra conta).
CREATE FUNCTION public.minha_autorizacao_demonstracao() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN jsonb_build_object('autorizada', app_private.demonstracao_autorizada(usuario),
    'expira_em', CASE WHEN app_private.demonstracao_autorizada(usuario) THEN (SELECT max(expira_em) FROM app_private.autorizacoes_demonstracao
      WHERE auth_user_id = usuario AND revogada_em IS NULL AND expira_em > now()) END);
END $$;

-- ===========================================================================
-- 6. Gestor publica e retira itens da vitrine (D10-03 = C, D10-04 = B). Não muda ativo, pausa nem o M08.
-- ===========================================================================
CREATE FUNCTION public.definir_vitrine_produto(p_produto_id uuid, p_exibir boolean, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_produto_id, p_exibir, p_expected_version));
  anterior jsonb;
  p public.produtos;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_vitrine_produto', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  p := app_private.produto_da_empresa_trava(p_produto_id);
  PERFORM app_private.exigir_permissoes(p.empresa_id, usuario, ARRAY['produtos.alterar', 'vitrine.alterar']);
  IF p.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este produto foi alterado por outra pessoa. Atualize antes de continuar.');
  END IF;
  IF p_exibir IS NULL OR p_exibir = p.exibir_na_vitrine THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN p.exibir_na_vitrine THEN 'O produto já está na vitrine.' ELSE 'O produto já está fora da vitrine.' END);
  END IF;
  IF p_exibir AND p.finalidade <> 'comercializavel' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Produto de uso interno não vai para a vitrine.', 'exibir_na_vitrine');
  END IF;
  UPDATE public.produtos SET exibir_na_vitrine = p_exibir, versao = versao + 1, atualizado_em = now() WHERE id = p.id RETURNING * INTO p;
  PERFORM app_private.auditar(p.empresa_id, usuario, CASE WHEN p_exibir THEN 'produtos.vitrine_ligada' ELSE 'produtos.vitrine_desligada' END,
    'produtos', p.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'definir_vitrine_produto', p_operation_key, assinatura,
    jsonb_build_object('id', p.id, 'exibir_na_vitrine', p.exibir_na_vitrine, 'versao', p.versao,
      'aparece_na_vitrine', app_private.produto_publico(p)));
END $$;

CREATE FUNCTION public.definir_vitrine_servico(p_servico_id uuid, p_exibir boolean, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_servico_id, p_exibir, p_expected_version));
  anterior jsonb;
  s public.servicos;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_vitrine_servico', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.servico_da_empresa_trava(p_servico_id);
  PERFORM app_private.exigir_permissoes(s.empresa_id, usuario, ARRAY['catalogo_servicos.alterar', 'vitrine.alterar']);
  IF s.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este serviço mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF p_exibir IS NULL OR p_exibir = s.exibir_na_vitrine THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN s.exibir_na_vitrine THEN 'O serviço já está na vitrine.' ELSE 'O serviço já está fora da vitrine.' END);
  END IF;
  IF p_exibir AND NOT s.ativo THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Reative o serviço antes de mostrá-lo na vitrine.');
  END IF;
  UPDATE public.servicos SET exibir_na_vitrine = p_exibir, versao = versao + 1, atualizado_em = now() WHERE id = s.id RETURNING * INTO s;
  PERFORM app_private.auditar(s.empresa_id, usuario, CASE WHEN p_exibir THEN 'servicos.vitrine_ligada' ELSE 'servicos.vitrine_desligada' END,
    'servicos', s.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'definir_vitrine_servico', p_operation_key, assinatura, app_private.servico_json(s, true));
END $$;

-- ===========================================================================
-- 7. Histórico dos limites da plataforma para a tela da CK (P-M08-02; D10-23 = A). Só auditoria `ck.limite_alterado`.
-- ===========================================================================
CREATE FUNCTION public.ck_historico_limites() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.exigir_usuario();
  IF NOT (SELECT authz.eh_ck_admin()) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só a administração CK vê o histórico dos limites da plataforma.');
  END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'quando' DESC) FROM (
    SELECT jsonb_build_object('chave', a.dados_minimizados->>'chave', 'antes', (a.dados_minimizados->>'antes')::integer,
             'depois', (a.dados_minimizados->>'depois')::integer, 'motivo', a.dados_minimizados->>'motivo',
             'autor', app_private.nome_da_pessoa(a.ator_auth_id), 'quando', a.criado_em) AS x
      FROM app_private.eventos_auditoria a WHERE a.tipo_acao = 'ck.limite_alterado' ORDER BY a.criado_em DESC LIMIT 100) q), '[]'::jsonb);
END $$;

-- ===========================================================================
-- 8. Ajustes: visibilidade nas listas internas e nome aprovado nos fluxos do cliente (C-01)
-- ===========================================================================
CREATE OR REPLACE FUNCTION app_private.servico_json(p_s public.servicos, p_privado boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', p_s.id, 'empresa_id', p_s.empresa_id, 'nome', p_s.nome, 'descricao', p_s.descricao,
    'categoria_id', p_s.categoria_id, 'categoria', (SELECT nome FROM public.categorias_plataforma WHERE id = p_s.categoria_id),
    'politica_preco', p_s.politica_preco, 'preco_centavos', app_private.para_centavos(p_s.preco), 'duracao_min', p_s.duracao_min,
    'validade_dias', p_s.validade_dias, 'modalidade', p_s.modalidade, 'exibicao', p_s.exibicao, 'faixa_percentual', p_s.faixa_percentual,
    'ativo', p_s.ativo, 'exibir_na_vitrine', p_s.exibir_na_vitrine, 'versao', p_s.versao,
    'itens_pacote', CASE WHEN p_s.politica_preco = 'pacote' THEN coalesce((SELECT jsonb_agg(jsonb_build_object('servico_id', x.id, 'nome', x.nome) ORDER BY i.ordem) FROM public.servico_pacote_itens i JOIN public.servicos x ON x.id = i.servico_id WHERE i.pacote_id = p_s.id), '[]'::jsonb) END,
    'perguntas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', q.id, 'ordem', q.ordem, 'texto', q.texto, 'ajuda', q.ajuda, 'tipo', q.tipo,
        'obrigatoria', q.obrigatoria, 'configuracao', q.configuracao) ORDER BY q.ordem)
      FROM public.servico_perguntas q WHERE q.servico_id = p_s.id AND q.ativa), '[]'::jsonb))
  || CASE WHEN p_privado THEN jsonb_build_object(
    'regras', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'ordem', r.ordem, 'tipo', r.tipo, 'pergunta_id', r.pergunta_id,
        'rotulo', r.rotulo, 'parametros', r.parametros) ORDER BY r.ordem)
      FROM public.servico_regras r WHERE r.servico_id = p_s.id AND r.ativa), '[]'::jsonb),
    'solicitacoes_abertas', (SELECT count(*) FROM public.solicitacoes_servico s WHERE s.servico_id = p_s.id
                               AND s.estado IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida')))
    ELSE '{}'::jsonb END
$$;

CREATE OR REPLACE FUNCTION public.produtos_da_empresa(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  perms text[];
  ver_preco boolean;
  ver_estoque boolean;
  ver_custo boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = p_empresa_id AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  perms := app_private.permissoes_de(p_empresa_id, usuario);
  ver_preco := 'produtos.visualizar' = ANY (perms);
  ver_estoque := 'estoque.visualizar' = ANY (perms);
  ver_custo := 'produtos.ver_custo' = ANY (perms);
  IF NOT (ver_preco OR ver_estoque) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite ver os produtos desta empresa.');
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'nome', p.nome, 'descricao', p.descricao, 'categoria_id', p.categoria_id, 'finalidade', p.finalidade,
      'sob_encomenda', p.sob_encomenda, 'venda_pausada', p.venda_pausada, 'motivo_pausa', p.motivo_pausa,
      'fornecedor_padrao_id', p.fornecedor_padrao_id, 'ativo', p.ativo, 'versao', p.versao,
      'exibir_na_vitrine', p.exibir_na_vitrine, 'aparece_na_vitrine', app_private.produto_publico(p),
      'variacoes', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', v.id, 'padrao', v.padrao, 'atributos', v.atributos, 'rotulo', app_private.rotulo_variacao(v.atributos, v.padrao),
          'sku', v.sku, 'ativo', v.ativo, 'versao', v.versao, 'estoque_minimo', v.estoque_minimo,
          'preco_centavos', CASE WHEN ver_preco THEN app_private.para_centavos(v.preco) END,
          'custo_centavos', CASE WHEN ver_custo AND v.custo_atual IS NOT NULL THEN app_private.para_centavos(v.custo_atual) END,
          'fisico', CASE WHEN ver_estoque THEN s.fisico END,
          'reservado', CASE WHEN ver_estoque THEN s.reservado END,
          'disponivel', CASE WHEN ver_estoque THEN s.disponivel END,
          'abaixo_minimo', CASE WHEN ver_estoque THEN (v.estoque_minimo IS NOT NULL AND s.disponivel <= v.estoque_minimo) END))
          ORDER BY v.padrao DESC, v.criado_em, v.id), '[]'::jsonb)
        FROM public.produto_variacoes v JOIN public.saldos_estoque s ON s.variacao_id = v.id
        WHERE v.produto_id = p.id AND (v.ativo OR NOT v.padrao)),
      'resumo', CASE WHEN ver_estoque THEN (SELECT jsonb_build_object(
          'fisico', coalesce(sum(s.fisico), 0), 'reservado', coalesce(sum(s.reservado), 0), 'disponivel', coalesce(sum(s.disponivel), 0),
          'variacoes_em_alerta', count(*) FILTER (WHERE v.estoque_minimo IS NOT NULL AND s.disponivel <= v.estoque_minimo))
        FROM public.produto_variacoes v JOIN public.saldos_estoque s ON s.variacao_id = v.id
        WHERE v.produto_id = p.id AND v.ativo) END)
      ORDER BY p.ativo DESC, lower(p.nome))
      FROM public.produtos p WHERE p.empresa_id = p_empresa_id), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.servicos_para_cliente(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_perfil_cliente(usuario);
  IF NOT app_private.empresa_recebe_pedido(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Empresa não encontrada.');
  END IF;
  RETURN jsonb_build_object(
    'empresa', (SELECT jsonb_build_object('id', e.id, 'nome', app_private.nome_aprovado(e.id)) FROM public.empresas e WHERE e.id = p_empresa_id),
    'horarios', app_private.grade_json(p_empresa_id),
    'servicos', coalesce((SELECT jsonb_agg(app_private.servico_json(s, false) - 'empresa_id' - 'versao' ORDER BY lower(s.nome))
      FROM public.servicos s WHERE s.empresa_id = p_empresa_id AND s.ativo), '[]'::jsonb),
    'aviso', 'A estimativa não é o valor final. Nenhum horário é reservado no envio: a empresa confirma depois.');
END $$;

CREATE OR REPLACE FUNCTION public.empresas_para_pedido() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'nome', coalesce(e.dados_publicados->>'nome_publico', e.nome_publico),
      'cidade', coalesce(e.dados_publicados->>'cidade', e.cidade), 'dado_de_teste', e.dado_de_teste) ORDER BY lower(coalesce(e.dados_publicados->>'nome_publico', e.nome_publico)))
    FROM public.empresas e WHERE app_private.empresa_recebe_pedido(e.id, usuario)), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION app_private.solicitacao_json(p_id uuid, p_para_cliente boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', s.id, 'empresa_id', s.empresa_id, 'numero', s.numero, 'servico_id', s.servico_id, 'servico', s.servico_nome,
    'empresa', CASE WHEN p_para_cliente THEN app_private.nome_aprovado(s.empresa_id) ELSE (SELECT e.nome_publico FROM public.empresas e WHERE e.id = s.empresa_id) END,
    'origem', s.origem, 'cliente_nome', s.cliente_nome, 'relato', s.relato, 'cidade', s.cidade, 'bairro', s.bairro,
    'preferencia', s.preferencia, 'respostas', s.respostas, 'estimativa', s.estimativa, 'estado', s.estado,
    'estado_exibicao', CASE WHEN s.estado IN ('orcamento_enviado', 'revisao_pedida') AND v.valido_ate < app_private.hoje_sp() THEN 'vencido' ELSE s.estado END,
    'aceite', s.aceite, 'motivo_encerramento', s.motivo_encerramento, 'encerrada_em', s.encerrada_em, 'versao', s.versao,
    'criado_em', s.criado_em,
    'aguarda_os', s.estado = 'aceita' AND NOT EXISTS (SELECT 1 FROM public.ordens_servico o2 WHERE o2.solicitacao_id = s.id),
    'os', app_private.os_resumo(s.id, p_para_cliente), 'origem_os_id', s.origem_os_id,
    'politica_cancelamento', CASE WHEN s.estado IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida') THEN (SELECT jsonb_build_object('versao', pc.versao, 'texto', pc.texto) FROM public.politicas_cancelamento pc WHERE pc.empresa_id = s.empresa_id AND pc.ativa) END,
    'versao_vigente_id', s.versao_vigente_id,
    'versoes', coalesce((SELECT jsonb_agg(app_private.versao_json(o, p_para_cliente) ORDER BY o.numero DESC)
      FROM public.orcamento_versoes o WHERE o.solicitacao_id = s.id
       AND (NOT p_para_cliente OR o.estado NOT IN ('rascunho', 'aguardando_aprovacao'))), '[]'::jsonb),
    'eventos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ev.id, 'tipo', ev.tipo, 'autor_tipo', ev.autor_tipo,
        'autor', CASE WHEN ev.autor_tipo = 'equipe' AND NOT p_para_cliente THEN app_private.nome_da_pessoa(ev.autor_auth_id)
                      WHEN ev.autor_tipo = 'equipe' THEN 'Empresa' WHEN ev.autor_tipo = 'cliente' THEN s.cliente_nome ELSE 'AutoniCK' END,
        'texto', ev.texto, 'dados', ev.dados, 'interno', NOT ev.visivel_cliente, 'criado_em', ev.criado_em) ORDER BY ev.criado_em, ev.id)
      FROM public.solicitacao_eventos ev WHERE ev.solicitacao_id = s.id AND (NOT p_para_cliente OR ev.visivel_cliente)), '[]'::jsonb),
    'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim, 'confirmado_pela_empresa', true,
        'aviso', 'Horário definido pela empresa. Se não puder, peça outro horário pela mensagem.')
        || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object('id', a.id, 'avisos', a.avisos, 'justificativa', a.justificativa,
             'confirmado_por', app_private.nome_da_pessoa(a.confirmado_por)) END
      FROM public.agendamentos a WHERE a.solicitacao_id = s.id AND a.estado = 'confirmado'))
  || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object(
    'cliente_id', s.cliente_id, 'horarios_gerais', app_private.grade_json(s.empresa_id),
    'historico_horarios', coalesce((SELECT jsonb_agg(jsonb_build_object('inicio', a.inicio, 'fim', a.fim, 'estado', a.estado, 'avisos', a.avisos,
        'justificativa', a.justificativa, 'criado_em', a.criado_em) ORDER BY a.criado_em DESC)
      FROM public.agendamentos a WHERE a.solicitacao_id = s.id), '[]'::jsonb),
    'servico_atual', (SELECT jsonb_build_object('versao', sv.versao, 'ativo', sv.ativo, 'validade_dias', sv.validade_dias, 'duracao_min', sv.duracao_min)
      FROM public.servicos sv WHERE sv.id = s.servico_id)) END
  FROM public.solicitacoes_servico s
  LEFT JOIN public.orcamento_versoes v ON v.id = s.versao_vigente_id
  WHERE s.id = p_id
$$;

CREATE OR REPLACE FUNCTION public.minhas_solicitacoes() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'numero', s.numero, 'empresa', app_private.nome_aprovado(e.id), 'empresa_id', s.empresa_id,
      'servico', s.servico_nome, 'estado', s.estado,
      'estado_exibicao', CASE WHEN s.estado IN ('orcamento_enviado', 'revisao_pedida') AND v.valido_ate < app_private.hoje_sp() THEN 'vencido' ELSE s.estado END,
      'total_vigente_centavos', CASE WHEN v.estado IN ('enviada', 'aceita') THEN app_private.para_centavos(v.total) END,
      'valido_ate', v.valido_ate, 'criado_em', s.criado_em,
      'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim) FROM public.agendamentos a WHERE a.solicitacao_id = s.id AND a.estado = 'confirmado'))
      ORDER BY s.criado_em DESC)
    FROM (SELECT * FROM public.solicitacoes_servico WHERE cliente_auth_id = usuario ORDER BY criado_em DESC LIMIT 100) s
    JOIN public.empresas e ON e.id = s.empresa_id
    LEFT JOIN public.orcamento_versoes v ON v.id = s.versao_vigente_id), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION app_private.os_json(p_id uuid, p_para_cliente boolean, p_ver_custo boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  o public.ordens_servico;
  s public.solicitacoes_servico;
  v public.orcamento_versoes;
  c public.cancelamentos_os;
  r jsonb;
BEGIN
  SELECT * INTO o FROM public.ordens_servico WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.solicitacoes_servico WHERE id = o.solicitacao_id;
  SELECT * INTO v FROM public.orcamento_versoes WHERE id = o.versao_aceita_id;
  SELECT * INTO c FROM public.cancelamentos_os WHERE os_id = o.id;
  r := jsonb_build_object('id', o.id, 'numero', o.numero, 'empresa_id', o.empresa_id,
    'empresa', CASE WHEN p_para_cliente THEN app_private.nome_aprovado(o.empresa_id) ELSE (SELECT e.nome_publico FROM public.empresas e WHERE e.id = o.empresa_id) END,
    'solicitacao_id', o.solicitacao_id, 'solicitacao_numero', s.numero, 'servico', o.servico_nome, 'origem', o.origem,
    'cliente_nome', o.cliente_nome, 'estado', o.estado, 'previsao_conclusao', o.previsao_conclusao,
    'aceita_em', o.aceita_em, 'iniciada_em', o.iniciada_em, 'concluida_em', o.concluida_em, 'encerrada_em', o.encerrada_em,
    'cancelada_em', o.cancelada_em, 'encerrada_por', o.encerrada_por, 'revisao_pendente', o.revisao_pendente,
    'garantia', CASE WHEN o.garantia_dias IS NOT NULL THEN jsonb_build_object('dias', o.garantia_dias, 'condicoes', o.garantia_condicoes,
      'ate', (o.concluida_em AT TIME ZONE 'America/Sao_Paulo')::date + o.garantia_dias,
      'aviso', 'Garantia oferecida pela empresa; não substitui os direitos previstos em lei.') END,
    'recorrencia', o.recorrencia,
    'proxima', (SELECT jsonb_build_object('solicitacao_id', x.id, 'numero', x.numero, 'estado', x.estado)
      FROM public.solicitacoes_servico x WHERE x.origem_os_id = o.id),
    'valores', app_private.os_valores(o.id, p_para_cliente),
    'versao_aceita', app_private.versao_json(v, p_para_cliente),
    'condicoes_cancelamento', jsonb_build_object('politica', v.aceite->'politica_cancelamento', 'condicoes', v.condicoes),
    'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim, 'menos_de_24h', a.inicio - now() < interval '24 hours' AND a.inicio > now(),
        'aviso', 'Horário combinado. Para mudar, peça outro horário: a mudança só vale quando a outra parte concordar.')
        || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object('id', a.id, 'avisos', a.avisos, 'justificativa', a.justificativa) END
      FROM public.agendamentos a WHERE a.solicitacao_id = o.solicitacao_id AND a.estado = 'confirmado'),
    'reagendamentos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'tipo', g.tipo, 'proposto_por', g.proposto_por,
        'inicio', g.inicio, 'fim', g.fim, 'motivo', g.motivo, 'estado', g.estado, 'resposta_motivo', g.resposta_motivo,
        'respondido_em', g.respondido_em, 'concordancia_informada', g.concordancia_informada, 'criado_em', g.criado_em,
        'menos_de_24h', g.inicio - now() < interval '24 hours' AND g.inicio > now())
        || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object('avisos', g.avisos, 'justificativa', g.justificativa,
             'autor', app_private.nome_da_pessoa(g.autor)) END ORDER BY g.criado_em DESC)
      FROM public.reagendamentos g WHERE g.os_id = o.id), '[]'::jsonb),
    'pedidos_de_reagendamento_do_cliente', (SELECT count(*) FROM public.reagendamentos g WHERE g.os_id = o.id AND g.proposto_por = 'cliente'),
    'cancelamento', CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('solicitado_por', c.solicitado_por, 'motivo', c.motivo,
      'estado_no_momento', c.estado_no_momento, 'criado_em', c.criado_em, 'arrependimento_possivel', c.arrependimento_possivel,
      'tinha_condicoes', c.tinha_condicoes,
      'aviso_arrependimento', CASE WHEN c.arrependimento_possivel THEN 'Cancelamento em até 7 dias da contratação pela plataforma, antes do início do serviço: não há custos de cancelamento. Regra sujeita a revisão jurídica.' END) END,
    'custos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', pc.id, 'numero', pc.numero, 'itens', pc.itens,
        'justificativa', pc.justificativa, 'total_centavos', app_private.para_centavos(pc.total), 'estado', pc.estado,
        'contestacao', pc.contestacao, 'resposta_por', pc.resposta_por, 'respondida_em', pc.respondida_em,
        'acordo_valor_centavos', app_private.para_centavos(pc.acordo_valor), 'acordo_texto', pc.acordo_texto,
        'motivo_retirada', pc.motivo_retirada, 'tem_titulo', pc.titulo_id IS NOT NULL, 'versao', pc.versao, 'criado_em', pc.criado_em,
        'aviso', 'Proposta de custos não é dívida: só vale com a sua concordância ou um acordo registrado.')
        ORDER BY pc.numero DESC) FROM public.propostas_custo_cancelamento pc WHERE pc.os_id = o.id), '[]'::jsonb),
    'eventos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ev.id, 'tipo', ev.tipo, 'de', ev.de_estado, 'para', ev.para_estado,
        'autor_tipo', ev.autor_tipo,
        'autor', CASE WHEN ev.autor_tipo = 'equipe' AND NOT p_para_cliente THEN app_private.nome_da_pessoa(ev.autor_auth_id)
                      WHEN ev.autor_tipo = 'equipe' THEN 'Empresa' WHEN ev.autor_tipo = 'cliente' THEN o.cliente_nome ELSE 'AutoniCK' END,
        'texto', ev.texto, 'dados', CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE ev.dados END, 'interno', NOT ev.publico,
        'criado_em', ev.criado_em) ORDER BY ev.criado_em, ev.id)
      FROM public.os_eventos ev WHERE ev.os_id = o.id AND (NOT p_para_cliente OR ev.publico)), '[]'::jsonb),
    'encerramento', app_private.os_encerramento(o),
    'versao', o.versao);
  IF NOT p_para_cliente THEN
    r := r || jsonb_build_object('cliente_id', o.cliente_id, 'responsavel_auth_id', o.responsavel_auth_id,
      'responsavel', app_private.nome_da_pessoa(o.responsavel_auth_id),
      'materiais', app_private.os_materiais_json(o.id, p_ver_custo), 'ver_custo', p_ver_custo);
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.minhas_os() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'numero', o.numero, 'empresa', app_private.nome_aprovado(e.id), 'servico', o.servico_nome,
      'estado', o.estado, 'solicitacao_id', o.solicitacao_id, 'criado_em', o.criado_em,
      'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim) FROM public.agendamentos a
                   WHERE a.solicitacao_id = o.solicitacao_id AND a.estado = 'confirmado'),
      'acao_pendente', CASE
        WHEN EXISTS (SELECT 1 FROM public.reagendamentos g WHERE g.os_id = o.id AND g.estado = 'pendente' AND g.proposto_por = 'empresa') THEN 'responder_horario'
        WHEN EXISTS (SELECT 1 FROM public.propostas_custo_cancelamento pc WHERE pc.os_id = o.id AND pc.estado IN ('pendente', 'acordo_proposto')) THEN 'responder_custos'
        WHEN o.estado = 'concluida' AND NOT o.revisao_pendente THEN 'confirmar_recebimento' END) ORDER BY o.criado_em DESC)
    FROM (SELECT * FROM public.ordens_servico WHERE cliente_auth_id = usuario ORDER BY criado_em DESC LIMIT 100) o
    JOIN public.empresas e ON e.id = o.empresa_id), '[]'::jsonb);
END $$;

-- ===========================================================================
-- 9. Privilégios: funções internas fechadas; públicas só para authenticated; três delas também para anonymous.
-- ===========================================================================
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app_private' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY['buscar_demonstracao', 'buscar_vitrine', 'ck_historico_limites', 'definir_vitrine_produto', 'definir_vitrine_servico', 'filtros_demonstracao', 'filtros_vitrine', 'minha_autorizacao_demonstracao', 'vitrine_demonstracao', 'vitrine_publica']) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- D10-01: o visitante sem conta usa só estas três funções. O uso do esquema não libera nenhuma tabela (nenhum GRANT a anonymous).
GRANT USAGE ON SCHEMA public TO anonymous;
GRANT EXECUTE ON FUNCTION public.filtros_vitrine(), public.buscar_vitrine(jsonb, integer), public.vitrine_publica(uuid) TO anonymous;
REVOKE ALL ON app_private.autorizacoes_demonstracao FROM PUBLIC, anonymous, authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611130002', 'M10: vitrine pública e busca (três funções para o anônimo), área de demonstração para contas fictícias autorizadas, visibilidade explícita de produtos e serviços desligada por padrão, nome aprovado nos fluxos do cliente (C-01) e histórico de limites da CK; sem permissão nova (55)');

COMMIT;
