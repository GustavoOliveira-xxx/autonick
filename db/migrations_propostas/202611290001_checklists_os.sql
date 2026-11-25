-- 202611290001_checklists_os: E07 (evolução integrada). Checklist operacional persistente das ordens de serviço.
-- 1) Itens por OS: texto, obrigatório ou opcional, interno ou visível ao cliente, responsável, conclusão (quem e quando),
--    observação e evidência (arquivo da finalidade evidencia_os da mesma OS).
-- 2) Modelos de checklist por empresa, aplicáveis a qualquer OS.
-- 3) Histórico na linha do tempo da OS (os_eventos): itens visíveis ao cliente geram evento público; internos, não.
-- 4) Regra no banco: uma OS só é concluída com todos os itens OBRIGATÓRIOS concluídos (gatilho na tabela de OS, vale
--    para qualquer caminho). Itens opcionais nunca bloqueiam.
-- Ver: servicos.visualizar. Mudar: servicos.alterar. Modelos: catalogo_servicos.alterar ou servicos.alterar.
BEGIN;

CREATE TABLE public.os_checklist_itens (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  os_id               uuid NOT NULL,
  texto               text NOT NULL CHECK (char_length(texto) BETWEEN 2 AND 200),
  obrigatorio         boolean NOT NULL DEFAULT false,
  visivel_cliente     boolean NOT NULL DEFAULT false,
  responsavel_auth_id text,
  ordem               integer NOT NULL DEFAULT 0,
  concluido_em        timestamptz,
  concluido_por       text,
  observacao          text CHECK (char_length(observacao) <= 500),
  evidencia_arquivo_id uuid REFERENCES public.arquivos (id),
  estado              text NOT NULL DEFAULT 'ativo' CHECK (estado IN ('ativo', 'removido')),
  versao              integer NOT NULL DEFAULT 1,
  criado_por          text NOT NULL,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, os_id) REFERENCES public.ordens_servico (empresa_id, id),
  CHECK ((concluido_em IS NULL) = (concluido_por IS NULL))
);
CREATE INDEX os_checklist_por_os ON public.os_checklist_itens (os_id, ordem) WHERE estado = 'ativo';
ALTER TABLE public.os_checklist_itens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.os_checklist_itens FROM PUBLIC, anonymous, authenticated;

CREATE TABLE public.modelos_checklist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresas (id),
  nome        text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 80),
  itens       jsonb NOT NULL CHECK (jsonb_typeof(itens) = 'array' AND jsonb_array_length(itens) BETWEEN 1 AND 50),
  ativo       boolean NOT NULL DEFAULT true,
  versao      integer NOT NULL DEFAULT 1,
  criado_por  text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX modelos_checklist_nome ON public.modelos_checklist (empresa_id, lower(nome)) WHERE ativo;
ALTER TABLE public.modelos_checklist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.modelos_checklist FROM PUBLIC, anonymous, authenticated;

CREATE FUNCTION app_private.checklist_item_json(i public.os_checklist_itens) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', i.id, 'texto', i.texto, 'obrigatorio', i.obrigatorio, 'visivel_cliente', i.visivel_cliente,
    'responsavel_auth_id', i.responsavel_auth_id, 'responsavel', app_private.nome_da_pessoa(i.responsavel_auth_id), 'ordem', i.ordem,
    'concluido', i.concluido_em IS NOT NULL, 'concluido_em', i.concluido_em, 'concluido_por', app_private.nome_da_pessoa(i.concluido_por),
    'observacao', i.observacao, 'evidencia_arquivo_id', i.evidencia_arquivo_id,
    'evidencia_url', CASE WHEN i.evidencia_arquivo_id IS NULL THEN NULL ELSE '/api/arquivos/' || i.evidencia_arquivo_id END, 'versao', i.versao)
$$;

-- Lê e valida um item (texto, flags, responsável) vindo da tela ou de um modelo.
CREATE FUNCTION app_private.ler_item_checklist(p_empresa uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v_texto text := btrim(coalesce(p->>'texto', ''));
  v_resp text := nullif(p->>'responsavel_auth_id', '');
BEGIN
  IF char_length(v_texto) NOT BETWEEN 2 AND 200 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Cada item tem de 2 a 200 caracteres.', 'texto');
  END IF;
  IF v_resp IS NOT NULL AND NOT app_private.eh_membro(p_empresa, v_resp) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O responsável precisa fazer parte da equipe.', 'responsavel_auth_id');
  END IF;
  RETURN jsonb_build_object('texto', v_texto, 'obrigatorio', coalesce((p->>'obrigatorio')::boolean, false),
    'visivel_cliente', coalesce((p->>'visivel_cliente')::boolean, false), 'responsavel_auth_id', v_resp);
END $$;

CREATE FUNCTION public.checklist_os(p_os_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  o public.ordens_servico;
BEGIN
  SELECT * INTO o FROM public.ordens_servico WHERE id = p_os_id;
  IF NOT FOUND OR NOT app_private.eh_membro(o.empresa_id, usuario) THEN PERFORM app_private.erro('NOT_FOUND', 'Ordem de serviço não encontrada.'); END IF;
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.visualizar']);
  RETURN jsonb_build_object(
    'itens', coalesce((SELECT jsonb_agg(app_private.checklist_item_json(i) ORDER BY i.ordem, i.criado_em) FROM public.os_checklist_itens i
                        WHERE i.os_id = o.id AND i.estado = 'ativo'), '[]'::jsonb),
    'pendentes_obrigatorios', (SELECT count(*) FROM public.os_checklist_itens i WHERE i.os_id = o.id AND i.estado = 'ativo' AND i.obrigatorio AND i.concluido_em IS NULL),
    'pode_alterar', 'servicos.alterar' = ANY (app_private.permissoes_de(o.empresa_id, usuario)) AND o.estado IN ('aguardando_inicio', 'em_execucao', 'pausada'),
    'historico', coalesce((SELECT jsonb_agg(jsonb_build_object('tipo', e.tipo, 'texto', e.texto, 'autor', app_private.nome_da_pessoa(e.autor_auth_id),
        'publico', e.publico, 'criado_em', e.criado_em) ORDER BY e.criado_em DESC)
      FROM (SELECT * FROM public.os_eventos e WHERE e.os_id = o.id AND e.tipo LIKE 'checklist_%' ORDER BY e.criado_em DESC LIMIT 50) e), '[]'::jsonb));
END $$;

-- Itens visíveis ao cliente titular da OS (sem responsável, observação interna nem evidência).
CREATE FUNCTION public.checklist_os_cliente(p_os_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  o public.ordens_servico;
BEGIN
  SELECT * INTO o FROM public.ordens_servico WHERE id = p_os_id;
  IF NOT FOUND OR o.cliente_auth_id IS DISTINCT FROM usuario THEN PERFORM app_private.erro('NOT_FOUND', 'Serviço não encontrado.'); END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('texto', i.texto, 'concluido', i.concluido_em IS NOT NULL, 'concluido_em', i.concluido_em)
    ORDER BY i.ordem, i.criado_em) FROM public.os_checklist_itens i WHERE i.os_id = o.id AND i.estado = 'ativo' AND i.visivel_cliente), '[]'::jsonb);
END $$;

-- Garante o acesso de escrita: OS da empresa, em andamento, e quem chama pode alterar serviços.
CREATE FUNCTION app_private.checklist_os_para_alterar(p_os_id uuid, p_usuario text) RETURNS public.ordens_servico
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  o public.ordens_servico;
BEGIN
  SELECT * INTO o FROM public.ordens_servico WHERE id = p_os_id FOR UPDATE;
  IF NOT FOUND OR NOT app_private.eh_membro(o.empresa_id, p_usuario) THEN PERFORM app_private.erro('NOT_FOUND', 'Ordem de serviço não encontrada.'); END IF;
  PERFORM app_private.exigir_permissoes(o.empresa_id, p_usuario, ARRAY['servicos.alterar']);
  IF o.estado NOT IN ('aguardando_inicio', 'em_execucao', 'pausada') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O checklist só muda com a OS em andamento.');
  END IF;
  RETURN o;
END $$;

CREATE FUNCTION public.adicionar_itens_checklist(p_os_id uuid, p_itens jsonb, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_itens::text));
  anterior jsonb;
  o public.ordens_servico;
  it jsonb;
  d jsonb;
  v_ordem integer;
  n integer := 0;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'adicionar_itens_checklist', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.checklist_os_para_alterar(p_os_id, usuario);
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) NOT BETWEEN 1 AND 50 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Envie de 1 a 50 itens.', 'itens');
  END IF;
  IF (SELECT count(*) FROM public.os_checklist_itens WHERE os_id = o.id AND estado = 'ativo') + jsonb_array_length(p_itens) > 100 THEN
    PERFORM app_private.erro('LIMIT_REACHED', 'Uma OS tem até 100 itens de checklist.');
  END IF;
  SELECT coalesce(max(ordem), 0) INTO v_ordem FROM public.os_checklist_itens WHERE os_id = o.id;
  FOR it IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    d := app_private.ler_item_checklist(o.empresa_id, it);
    v_ordem := v_ordem + 1;
    n := n + 1;
    INSERT INTO public.os_checklist_itens (empresa_id, os_id, texto, obrigatorio, visivel_cliente, responsavel_auth_id, ordem, criado_por)
    VALUES (o.empresa_id, o.id, d->>'texto', (d->>'obrigatorio')::boolean, (d->>'visivel_cliente')::boolean, d->>'responsavel_auth_id', v_ordem, usuario);
  END LOOP;
  PERFORM app_private.os_evento(o, 'checklist_itens_adicionados', NULL, NULL, 'equipe', usuario,
    format('%s %s no checklist', n, CASE WHEN n = 1 THEN 'item adicionado' ELSE 'itens adicionados' END), jsonb_build_object('quantidade', n), false);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'servicos.checklist_itens', 'ordens_servico', o.id, jsonb_build_object('quantidade', n));
  RETURN app_private.idem_fim(usuario, 'adicionar_itens_checklist', p_operation_key, assinatura, jsonb_build_object('adicionados', n));
END $$;

-- Altera um item: texto, flags, responsável, observação, evidência e conclusão (concluido true/false).
CREATE FUNCTION public.alterar_item_checklist(p_item_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_item_id, p_dados::text, p_expected_version));
  anterior jsonb;
  i public.os_checklist_itens;
  o public.ordens_servico;
  d jsonb;
  v_obs text;
  v_evid uuid;
  v_concluir boolean := (p_dados->>'concluido')::boolean;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_item_checklist', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO i FROM public.os_checklist_itens WHERE id = p_item_id AND estado = 'ativo';
  IF NOT FOUND THEN PERFORM app_private.erro('NOT_FOUND', 'Item não encontrado.'); END IF;
  o := app_private.checklist_os_para_alterar(i.os_id, usuario);
  SELECT * INTO i FROM public.os_checklist_itens WHERE id = p_item_id FOR UPDATE;
  IF i.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este item mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['texto', 'obrigatorio', 'visivel_cliente', 'responsavel_auth_id', 'observacao', 'evidencia_arquivo_id', 'concluido']);
  d := app_private.ler_item_checklist(o.empresa_id, jsonb_build_object(
    'texto', coalesce(p_dados->>'texto', i.texto),
    'obrigatorio', coalesce((p_dados->>'obrigatorio')::boolean, i.obrigatorio),
    'visivel_cliente', coalesce((p_dados->>'visivel_cliente')::boolean, i.visivel_cliente),
    'responsavel_auth_id', CASE WHEN p_dados ? 'responsavel_auth_id' THEN p_dados->>'responsavel_auth_id' ELSE i.responsavel_auth_id END));
  v_obs := CASE WHEN p_dados ? 'observacao' THEN nullif(btrim(coalesce(p_dados->>'observacao', '')), '') ELSE i.observacao END;
  IF char_length(v_obs) > 500 THEN PERFORM app_private.erro('VALIDATION_ERROR', 'A observação tem até 500 caracteres.', 'observacao'); END IF;
  v_evid := CASE WHEN p_dados ? 'evidencia_arquivo_id' THEN nullif(p_dados->>'evidencia_arquivo_id', '')::uuid ELSE i.evidencia_arquivo_id END;
  IF v_evid IS NOT NULL AND v_evid IS DISTINCT FROM i.evidencia_arquivo_id AND NOT EXISTS (SELECT 1 FROM public.arquivos a WHERE a.id = v_evid
       AND a.empresa_id = o.empresa_id AND a.finalidade = 'evidencia_os' AND a.referencia_id = o.id AND a.estado = 'ativo') THEN
    PERFORM app_private.erro('NOT_FOUND', 'Evidência não encontrada nesta OS.', 'evidencia_arquivo_id');
  END IF;
  UPDATE public.os_checklist_itens SET texto = d->>'texto', obrigatorio = (d->>'obrigatorio')::boolean, visivel_cliente = (d->>'visivel_cliente')::boolean,
    responsavel_auth_id = d->>'responsavel_auth_id', observacao = v_obs, evidencia_arquivo_id = v_evid,
    concluido_em = CASE WHEN v_concluir IS NULL THEN concluido_em WHEN v_concluir THEN coalesce(concluido_em, clock_timestamp()) ELSE NULL END,
    concluido_por = CASE WHEN v_concluir IS NULL THEN concluido_por WHEN v_concluir THEN coalesce(concluido_por, usuario) ELSE NULL END,
    versao = versao + 1
   WHERE id = i.id RETURNING * INTO i;
  IF v_concluir IS NOT NULL THEN
    PERFORM app_private.os_evento(o, CASE WHEN v_concluir THEN 'checklist_item_concluido' ELSE 'checklist_item_reaberto' END, NULL, NULL, 'equipe', usuario,
      format('%s: %s', CASE WHEN v_concluir THEN 'Concluído' ELSE 'Reaberto' END, i.texto), jsonb_build_object('item', i.id), i.visivel_cliente);
  ELSE
    PERFORM app_private.os_evento(o, 'checklist_item_alterado', NULL, NULL, 'equipe', usuario, format('Item alterado: %s', i.texto), jsonb_build_object('item', i.id), false);
  END IF;
  RETURN app_private.idem_fim(usuario, 'alterar_item_checklist', p_operation_key, assinatura, app_private.checklist_item_json(i));
END $$;

CREATE FUNCTION public.remover_item_checklist(p_item_id uuid, p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_item_id, p_expected_version));
  anterior jsonb;
  i public.os_checklist_itens;
  o public.ordens_servico;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'remover_item_checklist', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO i FROM public.os_checklist_itens WHERE id = p_item_id AND estado = 'ativo';
  IF NOT FOUND THEN PERFORM app_private.erro('NOT_FOUND', 'Item não encontrado.'); END IF;
  o := app_private.checklist_os_para_alterar(i.os_id, usuario);
  IF i.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este item mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  UPDATE public.os_checklist_itens SET estado = 'removido', versao = versao + 1 WHERE id = i.id;
  PERFORM app_private.os_evento(o, 'checklist_item_removido', NULL, NULL, 'equipe', usuario, format('Item removido: %s', i.texto), jsonb_build_object('item', i.id), false);
  RETURN app_private.idem_fim(usuario, 'remover_item_checklist', p_operation_key, assinatura, jsonb_build_object('id', i.id, 'removido', true));
END $$;

CREATE FUNCTION public.modelos_checklist(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['servicos.visualizar']);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome, 'itens', m.itens, 'versao', m.versao) ORDER BY lower(m.nome))
    FROM public.modelos_checklist m WHERE m.empresa_id = p_empresa_id AND m.ativo), '[]'::jsonb);
END $$;

-- Cria (p_modelo_id NULL), altera ou desativa (p_itens NULL) um modelo.
CREATE FUNCTION public.salvar_modelo_checklist(p_empresa_id uuid, p_modelo_id uuid, p_nome text, p_itens jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_modelo_id, p_nome, p_itens::text, p_expected_version));
  anterior jsonb;
  m public.modelos_checklist;
  v_itens jsonb := '[]'::jsonb;
  it jsonb;
  v_nome text := btrim(coalesce(p_nome, ''));
BEGIN
  anterior := app_private.idem_inicio(usuario, 'salvar_modelo_checklist', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  IF NOT app_private.eh_membro(p_empresa_id, usuario) THEN PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.'); END IF;
  IF NOT (app_private.permissoes_de(p_empresa_id, usuario) && ARRAY['servicos.alterar', 'catalogo_servicos.alterar']) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite esta ação nesta empresa.');
  END IF;
  IF p_modelo_id IS NOT NULL THEN
    SELECT * INTO m FROM public.modelos_checklist WHERE id = p_modelo_id AND empresa_id = p_empresa_id AND ativo FOR UPDATE;
    IF NOT FOUND THEN PERFORM app_private.erro('NOT_FOUND', 'Modelo não encontrado.'); END IF;
    IF m.versao <> p_expected_version THEN PERFORM app_private.erro('VERSION_CONFLICT', 'O modelo mudou desde que você abriu a tela.'); END IF;
  END IF;
  IF p_itens IS NULL THEN
    IF p_modelo_id IS NULL THEN PERFORM app_private.erro('VALIDATION_ERROR', 'Informe os itens do modelo.', 'itens'); END IF;
    UPDATE public.modelos_checklist SET ativo = false, versao = versao + 1, atualizado_em = now() WHERE id = m.id RETURNING * INTO m;
  ELSE
    IF char_length(v_nome) NOT BETWEEN 2 AND 80 THEN PERFORM app_private.erro('VALIDATION_ERROR', 'Dê um nome ao modelo (2 a 80 caracteres).', 'nome'); END IF;
    IF jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) NOT BETWEEN 1 AND 50 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Um modelo tem de 1 a 50 itens.', 'itens');
    END IF;
    FOR it IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
      v_itens := v_itens || jsonb_build_array(app_private.ler_item_checklist(p_empresa_id, it - 'responsavel_auth_id') - 'responsavel_auth_id');
    END LOOP;
    IF p_modelo_id IS NULL THEN
      INSERT INTO public.modelos_checklist (empresa_id, nome, itens, criado_por) VALUES (p_empresa_id, v_nome, v_itens, usuario) RETURNING * INTO m;
    ELSE
      UPDATE public.modelos_checklist SET nome = v_nome, itens = v_itens, versao = versao + 1, atualizado_em = now() WHERE id = m.id RETURNING * INTO m;
    END IF;
  END IF;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'servicos.modelo_checklist', 'modelos_checklist', m.id, jsonb_build_object('ativo', m.ativo));
  RETURN app_private.idem_fim(usuario, 'salvar_modelo_checklist', p_operation_key, assinatura,
    jsonb_build_object('id', m.id, 'nome', m.nome, 'itens', m.itens, 'ativo', m.ativo, 'versao', m.versao));
EXCEPTION WHEN unique_violation THEN
  PERFORM app_private.erro('VALIDATION_ERROR', 'Já existe um modelo com esse nome.', 'nome');
END $$;

-- Regra de conclusão: itens obrigatórios pendentes impedem concluir a OS (por qualquer caminho).
CREATE FUNCTION app_private.os_checklist_bloqueia_conclusao() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.os_checklist_itens i WHERE i.os_id = NEW.id AND i.estado = 'ativo' AND i.obrigatorio AND i.concluido_em IS NULL;
  IF n > 0 THEN
    PERFORM app_private.erro('STATE_CONFLICT', format('Conclua %s %s do checklist antes de concluir a OS.', n,
      CASE WHEN n = 1 THEN 'item obrigatório' ELSE 'itens obrigatórios' END));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER os_checklist_antes_de_concluir BEFORE UPDATE OF estado ON public.ordens_servico
  FOR EACH ROW WHEN (NEW.estado = 'concluida' AND OLD.estado IS DISTINCT FROM 'concluida')
  EXECUTE FUNCTION app_private.os_checklist_bloqueia_conclusao();

REVOKE ALL ON FUNCTION app_private.checklist_item_json(public.os_checklist_itens), app_private.ler_item_checklist(uuid, jsonb),
  app_private.checklist_os_para_alterar(uuid, text), app_private.os_checklist_bloqueia_conclusao() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.checklist_os(uuid), public.checklist_os_cliente(uuid), public.adicionar_itens_checklist(uuid, jsonb, text),
  public.alterar_item_checklist(uuid, jsonb, integer, text), public.remover_item_checklist(uuid, integer, text),
  public.modelos_checklist(uuid), public.salvar_modelo_checklist(uuid, uuid, text, jsonb, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checklist_os(uuid), public.checklist_os_cliente(uuid), public.adicionar_itens_checklist(uuid, jsonb, text),
  public.alterar_item_checklist(uuid, jsonb, integer, text), public.remover_item_checklist(uuid, integer, text),
  public.modelos_checklist(uuid), public.salvar_modelo_checklist(uuid, uuid, text, jsonb, integer, text) TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611290001', 'E07: checklist persistente das OS (itens, responsável, conclusão, observação, evidência, modelos, histórico; obrigatórios bloqueiam a conclusão no banco)');

COMMIT;
