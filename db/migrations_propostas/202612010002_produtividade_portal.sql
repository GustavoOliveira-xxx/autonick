-- 202612010002_produtividade_portal: pacote 27/11 (itens 1 e 10) e fechamento do programa anterior (E05, E08, E09).
-- 1) Vendas "consulta primeiro": vendas_da_empresa aceita {busca} (número da venda ou nome do cliente, sem acento).
-- 2) Feature flags (E09): catálogo fechado de flags com padrão conservador, escopo plataforma ou empresa, histórico em
--    auditoria. Flags nunca controlam autorização: só mostram ou escondem recursos opcionais (onboarding contextual,
--    animações decorativas, busca de CEP). Desligar não apaga dados.
-- 3) Notificações persistentes (E08): por pessoa, com deduplicação (chave única por pessoa), leitura, link interno e
--    preferências por tipo. Geradas por gatilhos dos fluxos reais (pedido, orçamento, OS) para o cliente dono do registro
--    e para quem tem a permissão da área na empresa. Só texto curto e link: nada de nota interna, valor ou documento.
--    Sem e-mail, SMS ou push: não há essa infraestrutura (só dentro do app).
-- 4) Onboarding contextual dispensável (E08): o que cada pessoa já dispensou.
-- 5) Modelos reutilizáveis de orçamento (E05): componentes, prazo e condições salvos por empresa para preencher um
--    rascunho; o orçamento continua sendo calculado e validado pelas funções de sempre.
BEGIN;

-- ===========================================================================
-- 1. Busca na lista de vendas
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.vendas_da_empresa(p_empresa_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb, p_limite integer DEFAULT 50,
  p_deslocamento integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  f jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_de date;
  v_ate date;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['vendas.visualizar']);
  BEGIN
    v_de := nullif(f->>'de', '')::date;
    v_ate := nullif(f->>'ate', '')::date;
  EXCEPTION WHEN others THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Período inválido.', 'periodo');
  END;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'numero', v.numero, 'estado', v.estado, 'entrega', v.entrega,
      'origem', v.origem, 'cliente', v.cliente_nome, 'total_centavos', app_private.para_centavos(v.total),
      'confirmada_em', v.confirmada_em, 'criado_em', v.criado_em, 'versao', v.versao, 'autor_nome', app_private.nome_da_pessoa(v.autor),
      'pagamento', app_private.situacao_pagamento(v.id)) ORDER BY v.estado = 'rascunho' DESC, v.numero DESC NULLS FIRST, v.criado_em DESC)
    FROM (SELECT * FROM public.vendas v
           WHERE v.empresa_id = p_empresa_id
             AND (f->>'estado' IS NULL OR v.estado = f->>'estado')
             AND (f->>'origem' IS NULL OR v.origem = f->>'origem')
             AND (f->>'entrega' IS NULL OR v.entrega = f->>'entrega')
             AND (f->>'cliente_empresa_id' IS NULL OR v.cliente_empresa_id::text = f->>'cliente_empresa_id')
             AND (f->>'numero' IS NULL OR v.numero::text = f->>'numero')
             AND (nullif(btrim(f->>'busca'), '') IS NULL
                  OR v.numero::text = regexp_replace(f->>'busca', '\D', '', 'g')
                  OR app_private.sem_acento(v.cliente_nome) LIKE '%' || app_private.padrao_busca(left(f->>'busca', 100)) || '%'
                  OR (v.cliente_nome IS NULL AND app_private.sem_acento('consumidor nao identificado') LIKE '%' || app_private.padrao_busca(left(f->>'busca', 100)) || '%'))
             AND (v_de IS NULL OR (coalesce(v.confirmada_em, v.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date >= v_de)
             AND (v_ate IS NULL OR (coalesce(v.confirmada_em, v.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date <= v_ate)
           ORDER BY v.estado = 'rascunho' DESC, v.numero DESC NULLS FIRST, v.criado_em DESC
           LIMIT least(greatest(coalesce(p_limite, 50), 1), 100) OFFSET greatest(coalesce(p_deslocamento, 0), 0)) v), '[]'::jsonb);
END $$;


-- ===========================================================================
-- 2. Feature flags
-- ===========================================================================
CREATE TABLE app_private.feature_flags (
  chave       text PRIMARY KEY CHECK (chave ~ '^[a-z][a-z0-9_]{2,40}$'),
  nome        text NOT NULL,
  descricao   text NOT NULL,
  escopo      text NOT NULL CHECK (escopo IN ('plataforma', 'empresa')),
  padrao      boolean NOT NULL,
  ativa       boolean NOT NULL,
  versao      integer NOT NULL DEFAULT 1,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_private.feature_flags (chave, nome, descricao, escopo, padrao, ativa) VALUES
  ('onboarding_contextual', 'Dicas de primeiros passos', 'Mostra dicas curtas e dispensáveis nas telas principais para quem está começando.', 'empresa', true, true),
  ('animacoes_decorativas', 'Animações decorativas', 'Bong, brilhos e entradas animadas. Desligar deixa a interface estática; movimento reduzido do sistema sempre vale.', 'plataforma', true, true),
  ('busca_cep', 'Busca de CEP', 'Botão "Buscar CEP" nos cadastros (consulta pela API Java). Desligado, o endereço é preenchido à mão.', 'plataforma', true, true);

CREATE TABLE public.flags_empresa (
  empresa_id  uuid NOT NULL REFERENCES public.empresas (id),
  chave       text NOT NULL REFERENCES app_private.feature_flags (chave),
  ativa       boolean NOT NULL,
  alterada_por text NOT NULL,
  alterada_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, chave)
);
ALTER TABLE public.flags_empresa ENABLE ROW LEVEL SECURITY;

-- Flags efetivas: plataforma (todas as pessoas, até visitantes) e, com empresa informada e vínculo ativo, as da empresa.
CREATE FUNCTION public.flags_ativas(p_empresa_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '');
  membro boolean := p_empresa_id IS NOT NULL AND usuario IS NOT NULL AND app_private.eh_membro(p_empresa_id, usuario);
BEGIN
  RETURN coalesce((SELECT jsonb_object_agg(f.chave, CASE WHEN f.escopo = 'empresa' AND membro
      THEN coalesce((SELECT fe.ativa FROM public.flags_empresa fe WHERE fe.empresa_id = p_empresa_id AND fe.chave = f.chave), f.ativa) ELSE f.ativa END)
    FROM app_private.feature_flags f WHERE f.escopo = 'plataforma' OR membro), '{}'::jsonb);
END $$;

CREATE FUNCTION public.ck_flags() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.exigir_usuario();
  IF NOT (SELECT authz.eh_ck_admin()) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só a administração CK vê as flags da plataforma.');
  END IF;
  RETURN (SELECT jsonb_agg(jsonb_build_object('chave', chave, 'nome', nome, 'descricao', descricao, 'escopo', escopo, 'padrao', padrao,
    'ativa', ativa, 'versao', versao, 'atualizado_em', atualizado_em,
    'empresas_com_ajuste', (SELECT count(*) FROM public.flags_empresa fe WHERE fe.chave = f.chave)) ORDER BY nome) FROM app_private.feature_flags f);
END $$;

CREATE FUNCTION public.ck_definir_flag(p_chave text, p_ativa boolean, p_motivo text, p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_chave, p_ativa, p_motivo, p_expected_version));
  anterior jsonb;
  f app_private.feature_flags;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'ck_definir_flag', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  IF NOT (SELECT authz.eh_ck_admin()) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só a administração CK altera flags da plataforma.');
  END IF;
  SELECT * INTO f FROM app_private.feature_flags WHERE chave = p_chave FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_private.erro('NOT_FOUND', 'Flag desconhecida.'); END IF;
  IF f.versao <> p_expected_version THEN PERFORM app_private.erro('VERSION_CONFLICT', 'Esta flag mudou. Atualize antes de continuar.'); END IF;
  IF p_ativa IS NULL THEN PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha ligar ou desligar.', 'ativa'); END IF;
  IF v_motivo IS NULL OR char_length(v_motivo) NOT BETWEEN 5 AND 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique o motivo (5 a 300 caracteres).', 'motivo');
  END IF;
  UPDATE app_private.feature_flags SET ativa = p_ativa, versao = versao + 1, atualizado_em = now() WHERE chave = p_chave RETURNING * INTO f;
  PERFORM app_private.auditar(NULL, usuario, 'ck.flag_alterada', 'feature_flags', NULL,
    jsonb_build_object('chave', p_chave, 'ativa', p_ativa, 'motivo', v_motivo));
  RETURN app_private.idem_fim(usuario, 'ck_definir_flag', p_operation_key, assinatura, jsonb_build_object('chave', f.chave, 'ativa', f.ativa, 'versao', f.versao));
END $$;

-- Ajuste por empresa (só flags de escopo empresa): proprietário ou quem altera dados da empresa.
CREATE FUNCTION public.definir_flag_empresa(p_empresa_id uuid, p_chave text, p_ativa boolean, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_chave, p_ativa));
  anterior jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_flag_empresa', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['empresa.alterar']);
  IF NOT EXISTS (SELECT 1 FROM app_private.feature_flags WHERE chave = p_chave AND escopo = 'empresa') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Esta opção não pode ser ajustada por empresa.', 'chave');
  END IF;
  IF p_ativa IS NULL THEN PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha ligar ou desligar.', 'ativa'); END IF;
  INSERT INTO public.flags_empresa (empresa_id, chave, ativa, alterada_por) VALUES (p_empresa_id, p_chave, p_ativa, usuario)
  ON CONFLICT (empresa_id, chave) DO UPDATE SET ativa = EXCLUDED.ativa, alterada_por = EXCLUDED.alterada_por, alterada_em = now();
  PERFORM app_private.auditar(p_empresa_id, usuario, 'empresa.flag_alterada', 'flags_empresa', NULL, jsonb_build_object('chave', p_chave, 'ativa', p_ativa));
  RETURN app_private.idem_fim(usuario, 'definir_flag_empresa', p_operation_key, assinatura, jsonb_build_object('chave', p_chave, 'ativa', p_ativa));
END $$;

-- ===========================================================================
-- 3. Notificações persistentes
-- ===========================================================================
CREATE TABLE public.notificacoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario      text NOT NULL,
  empresa_id   uuid REFERENCES public.empresas (id),
  area         text NOT NULL CHECK (area IN ('cliente', 'business')),
  tipo         text NOT NULL CHECK (tipo IN ('pedido', 'orcamento', 'os', 'estoque')),
  titulo       text NOT NULL CHECK (char_length(titulo) BETWEEN 2 AND 120),
  texto        text CHECK (char_length(texto) <= 300),
  link         text NOT NULL CHECK (link ~ '^/(cliente|business)/[a-z0-9-]+\.html(\?[A-Za-z0-9=&%_.-]*)?$'),
  chave        text NOT NULL CHECK (char_length(chave) BETWEEN 3 AND 200),
  lida_em      timestamptz,
  criada_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usuario, chave)
);
CREATE INDEX notificacoes_por_pessoa ON public.notificacoes (usuario, criada_em DESC);
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.preferencias_notificacao (
  usuario  text NOT NULL,
  tipo     text NOT NULL CHECK (tipo IN ('pedido', 'orcamento', 'os', 'estoque')),
  ativa    boolean NOT NULL,
  PRIMARY KEY (usuario, tipo)
);
ALTER TABLE public.preferencias_notificacao ENABLE ROW LEVEL SECURITY;

-- Cria a notificação se a pessoa não desligou o tipo; a mesma chave nunca gera duas (deduplicação).
CREATE FUNCTION app_private.notificar(p_usuario text, p_empresa uuid, p_area text, p_tipo text, p_titulo text, p_texto text, p_link text, p_chave text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_usuario IS NULL OR EXISTS (SELECT 1 FROM public.preferencias_notificacao WHERE usuario = p_usuario AND tipo = p_tipo AND NOT ativa) THEN
    RETURN;
  END IF;
  INSERT INTO public.notificacoes (usuario, empresa_id, area, tipo, titulo, texto, link, chave)
  VALUES (p_usuario, p_empresa, p_area, p_tipo, left(p_titulo, 120), left(p_texto, 300), p_link, left(p_chave, 200))
  ON CONFLICT (usuario, chave) DO NOTHING;
END $$;

-- Notifica quem tem a permissão na empresa (membros ativos), menos quem causou o evento.
CREATE FUNCTION app_private.notificar_equipe(p_empresa uuid, p_permissao text, p_ator text, p_tipo text, p_titulo text, p_texto text, p_link text, p_chave text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  m record;
BEGIN
  FOR m IN SELECT auth_user_id FROM public.membros_empresa WHERE empresa_id = p_empresa AND estado = 'ativo' AND auth_user_id IS DISTINCT FROM p_ator LOOP
    IF p_permissao = ANY (app_private.permissoes_de(p_empresa, m.auth_user_id)) THEN
      PERFORM app_private.notificar(m.auth_user_id, p_empresa, 'business', p_tipo, p_titulo, p_texto, p_link, p_chave);
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION app_private.ator_atual() RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '') $$;

CREATE FUNCTION app_private.notificar_pedido() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  emp text := (SELECT nome_publico FROM public.empresas WHERE id = NEW.empresa_id);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM app_private.notificar_equipe(NEW.empresa_id, 'pedidos.visualizar', app_private.ator_atual(), 'pedido', 'Novo pedido de cliente',
      format('Pedido de %s aguardando aceite.', NEW.cliente_nome), format('/business/pedidos-empresa.html?id=%s', NEW.empresa_id), format('pedido:%s:novo', NEW.id));
  ELSIF NEW.estado IS DISTINCT FROM OLD.estado AND NEW.estado IN ('aceito', 'recusado', 'concluido', 'cancelado') THEN
    PERFORM app_private.notificar(NEW.cliente_auth_id, NEW.empresa_id, 'cliente', 'pedido',
      CASE NEW.estado WHEN 'aceito' THEN 'Pedido aceito' WHEN 'recusado' THEN 'Pedido recusado' WHEN 'concluido' THEN 'Pedido concluído' ELSE 'Pedido cancelado' END,
      format('Seu pedido em %s mudou de situação.', emp), '/cliente/pedidos.html', format('pedido:%s:%s', NEW.id, NEW.estado));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pedidos_notificar AFTER INSERT OR UPDATE OF estado ON public.pedidos FOR EACH ROW EXECUTE FUNCTION app_private.notificar_pedido();

CREATE FUNCTION app_private.notificar_solicitacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  emp text := (SELECT nome_publico FROM public.empresas WHERE id = NEW.empresa_id);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cliente_auth_id IS NOT NULL THEN
      PERFORM app_private.notificar_equipe(NEW.empresa_id, 'orcamentos.visualizar', app_private.ator_atual(), 'orcamento', format('Nova solicitação nº %s', NEW.numero),
        format('%s pediu um orçamento.', NEW.cliente_nome), format('/business/solicitacao.html?id=%s&solicitacao=%s', NEW.empresa_id, NEW.id), format('solicitacao:%s:nova', NEW.id));
    END IF;
  ELSIF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NEW.estado IN ('orcamento_enviado', 'cancelada', 'recusada') AND NEW.cliente_auth_id IS NOT NULL THEN
      PERFORM app_private.notificar(NEW.cliente_auth_id, NEW.empresa_id, 'cliente', 'orcamento',
        CASE NEW.estado WHEN 'orcamento_enviado' THEN 'Orçamento disponível' WHEN 'cancelada' THEN 'Solicitação cancelada' ELSE 'Orçamento recusado' END,
        format('Solicitação nº %s em %s.', NEW.numero, emp), format('/cliente/solicitacoes.html?s=%s', NEW.id), format('solicitacao:%s:%s:%s', NEW.id, NEW.estado, NEW.versao));
    ELSIF NEW.estado IN ('aceita', 'revisao_pedida') THEN
      PERFORM app_private.notificar_equipe(NEW.empresa_id, 'orcamentos.visualizar', app_private.ator_atual(), 'orcamento',
        CASE NEW.estado WHEN 'aceita' THEN format('Orçamento nº %s aceito', NEW.numero) ELSE format('Revisão pedida no nº %s', NEW.numero) END,
        format('Cliente: %s.', NEW.cliente_nome), format('/business/solicitacao.html?id=%s&solicitacao=%s', NEW.empresa_id, NEW.id), format('solicitacao:%s:%s:%s', NEW.id, NEW.estado, NEW.versao));
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER solicitacoes_notificar AFTER INSERT OR UPDATE OF estado ON public.solicitacoes_servico FOR EACH ROW EXECUTE FUNCTION app_private.notificar_solicitacao();

CREATE FUNCTION app_private.notificar_os() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  emp text := (SELECT nome_publico FROM public.empresas WHERE id = NEW.empresa_id);
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NEW.cliente_auth_id IS NOT NULL AND NEW.estado IN ('em_execucao', 'concluida', 'encerrada', 'cancelada') THEN
    PERFORM app_private.notificar(NEW.cliente_auth_id, NEW.empresa_id, 'cliente', 'os',
      CASE NEW.estado WHEN 'em_execucao' THEN format('Serviço nº %s em andamento', NEW.numero) WHEN 'concluida' THEN format('Serviço nº %s concluído', NEW.numero)
        WHEN 'encerrada' THEN format('Serviço nº %s encerrado', NEW.numero) ELSE format('Serviço nº %s cancelado', NEW.numero) END,
      format('Atualização de %s.', emp), format('/cliente/ordens.html?os=%s', NEW.id), format('os:%s:%s:%s', NEW.id, NEW.estado, NEW.versao));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ordens_notificar AFTER UPDATE OF estado ON public.ordens_servico FOR EACH ROW EXECUTE FUNCTION app_private.notificar_os();

CREATE FUNCTION app_private.notificar_proposta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.estado = 'pendente' THEN
    PERFORM app_private.notificar_equipe(NEW.empresa_id, 'estoque.aprovar', app_private.ator_atual(), 'estoque', 'Movimentação de estoque para aprovar',
      'Uma movimentação aguarda sua aprovação.', format('/business/estoque-empresa.html?id=%s', NEW.empresa_id), format('proposta:%s', NEW.id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER propostas_notificar AFTER INSERT ON public.propostas_movimentacao FOR EACH ROW EXECUTE FUNCTION app_private.notificar_proposta();

CREATE FUNCTION public.minhas_notificacoes(p_antes timestamptz DEFAULT NULL, p_limite integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_usuario text := app_private.exigir_usuario();
  v_limite integer := least(greatest(coalesce(p_limite, 20), 1), 50);
  itens jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(x ORDER BY criada_em DESC), '[]'::jsonb) INTO itens FROM (
    SELECT jsonb_build_object('id', n.id, 'area', n.area, 'tipo', n.tipo, 'titulo', n.titulo, 'texto', n.texto, 'link', n.link,
      'lida', n.lida_em IS NOT NULL, 'criada_em', n.criada_em,
      'empresa', (SELECT nome_publico FROM public.empresas WHERE id = n.empresa_id)) x, n.criada_em
      FROM public.notificacoes n
     WHERE n.usuario = v_usuario AND (p_antes IS NULL OR n.criada_em < p_antes)
       -- vínculo encerrado: notificações da equipe daquela empresa deixam de aparecer
       AND (n.area = 'cliente' OR app_private.eh_membro(n.empresa_id, v_usuario))
     ORDER BY n.criada_em DESC LIMIT v_limite) s;
  RETURN jsonb_build_object('itens', itens, 'mais', jsonb_array_length(itens) = v_limite,
    'nao_lidas', (SELECT count(*) FROM public.notificacoes n WHERE n.usuario = v_usuario AND n.lida_em IS NULL
                   AND (n.area = 'cliente' OR app_private.eh_membro(n.empresa_id, v_usuario))));
END $$;

CREATE FUNCTION public.marcar_notificacoes_lidas(p_ids uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_usuario text := app_private.exigir_usuario();
  n integer;
BEGIN
  IF p_ids IS NOT NULL AND cardinality(p_ids) > 200 THEN PERFORM app_private.erro('VALIDATION_ERROR', 'Marque até 200 de cada vez.'); END IF;
  UPDATE public.notificacoes SET lida_em = now()
   WHERE usuario = v_usuario AND lida_em IS NULL AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('marcadas', n);
END $$;

CREATE FUNCTION public.preferencias_notificacao() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_usuario text := app_private.exigir_usuario();
BEGIN
  RETURN (SELECT jsonb_object_agg(t, coalesce((SELECT ativa FROM public.preferencias_notificacao p WHERE p.usuario = v_usuario AND p.tipo = t), true))
    FROM unnest(ARRAY['pedido', 'orcamento', 'os', 'estoque']) t);
END $$;

CREATE FUNCTION public.definir_preferencia_notificacao(p_tipo text, p_ativa boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_usuario text := app_private.exigir_usuario();
BEGIN
  IF p_tipo NOT IN ('pedido', 'orcamento', 'os', 'estoque') OR p_ativa IS NULL THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Preferência inválida.', 'tipo');
  END IF;
  INSERT INTO public.preferencias_notificacao (usuario, tipo, ativa) VALUES (v_usuario, p_tipo, p_ativa)
  ON CONFLICT (usuario, tipo) DO UPDATE SET ativa = EXCLUDED.ativa;
  RETURN public.preferencias_notificacao();
END $$;

-- ===========================================================================
-- 4. Onboarding contextual dispensável
-- ===========================================================================
CREATE TABLE public.onboarding_dispensado (
  usuario  text NOT NULL,
  chave    text NOT NULL CHECK (chave ~ '^[a-z][a-z0-9_.-]{2,60}$'),
  dispensado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario, chave)
);
ALTER TABLE public.onboarding_dispensado ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.meu_onboarding() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(chave ORDER BY chave) FROM public.onboarding_dispensado WHERE usuario = v_usuario), '[]'::jsonb);
END $$;

CREATE FUNCTION public.dispensar_onboarding(p_chave text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_usuario text := app_private.exigir_usuario();
BEGIN
  IF p_chave IS NULL OR p_chave !~ '^[a-z][a-z0-9_.-]{2,60}$' THEN PERFORM app_private.erro('VALIDATION_ERROR', 'Dica desconhecida.', 'chave'); END IF;
  IF (SELECT count(*) FROM public.onboarding_dispensado WHERE usuario = v_usuario) >= 200 THEN RETURN public.meu_onboarding(); END IF;
  INSERT INTO public.onboarding_dispensado (usuario, chave) VALUES (v_usuario, p_chave) ON CONFLICT DO NOTHING;
  RETURN public.meu_onboarding();
END $$;

CREATE FUNCTION public.reiniciar_onboarding() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_usuario text := app_private.exigir_usuario();
BEGIN
  DELETE FROM public.onboarding_dispensado WHERE usuario = v_usuario;
  RETURN '[]'::jsonb;
END $$;

-- ===========================================================================
-- 5. Modelos reutilizáveis de orçamento
-- ===========================================================================
CREATE TABLE public.modelos_orcamento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas (id),
  nome          text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 2 AND 80),
  componentes   jsonb NOT NULL CHECK (jsonb_typeof(componentes) = 'array'),
  prazo_execucao text CHECK (char_length(prazo_execucao) <= 120),
  condicoes     text CHECK (char_length(condicoes) <= 1000),
  ativo         boolean NOT NULL DEFAULT true,
  versao        integer NOT NULL DEFAULT 1,
  criado_por    text NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX modelos_orcamento_nome ON public.modelos_orcamento (empresa_id, app_private.sem_acento(nome)) WHERE ativo;
ALTER TABLE public.modelos_orcamento ENABLE ROW LEVEL SECURITY;

-- Valida e normaliza os componentes (mesmos tipos e limites do orçamento; o cálculo continua no salvar do rascunho).
CREATE FUNCTION app_private.componentes_de_modelo(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  e jsonb;
  r jsonb := '[]'::jsonb;
  q numeric;
  v numeric;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) NOT BETWEEN 1 AND 50 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O modelo precisa de 1 a 50 itens.', 'componentes');
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p) LOOP
    IF coalesce(e->>'tipo', '') NOT IN ('material', 'mao_de_obra', 'deslocamento', 'outro') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Tipo de item inválido.', 'componentes');
    END IF;
    IF char_length(btrim(coalesce(e->>'descricao', ''))) NOT BETWEEN 2 AND 120 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Cada item precisa de uma descrição (2 a 120 caracteres).', 'componentes');
    END IF;
    BEGIN
      q := (e->>'quantidade')::numeric;
      v := (e->>'valor_unitario_centavos')::numeric;
    EXCEPTION WHEN others THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Quantidade ou valor inválido.', 'componentes');
    END;
    IF q IS NULL OR q <= 0 OR q > 99999 OR v IS NULL OR v < 0 OR v > 99999999999 OR v <> trunc(v) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Quantidade maior que zero e valor em centavos inteiros.', 'componentes');
    END IF;
    r := r || jsonb_build_array(jsonb_build_object('tipo', e->>'tipo', 'descricao', btrim(e->>'descricao'), 'quantidade', q, 'valor_unitario_centavos', v::bigint));
  END LOOP;
  RETURN r;
END $$;

CREATE FUNCTION public.modelos_orcamento(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['orcamentos.visualizar']);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'componentes', componentes, 'prazo_execucao', prazo_execucao,
    'condicoes', condicoes, 'versao', versao, 'atualizado_em', atualizado_em) ORDER BY app_private.sem_acento(nome))
    FROM public.modelos_orcamento WHERE empresa_id = p_empresa_id AND ativo), '[]'::jsonb);
END $$;

CREATE FUNCTION public.salvar_modelo_orcamento(p_empresa_id uuid, p_modelo_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_modelo_id, p_dados::text, p_expected_version));
  anterior jsonb;
  m public.modelos_orcamento;
  v_nome text := btrim(coalesce(p_dados->>'nome', ''));
  v_comp jsonb;
  v_prazo text := nullif(btrim(coalesce(p_dados->>'prazo_execucao', '')), '');
  v_cond text := nullif(btrim(coalesce(p_dados->>'condicoes', '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'salvar_modelo_orcamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['orcamentos.criar']);
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN PERFORM app_private.erro('VALIDATION_ERROR', 'Dados do modelo inválidos.'); END IF;
  IF p_dados ? 'ativo' AND NOT (p_dados->>'ativo')::boolean THEN
    UPDATE public.modelos_orcamento SET ativo = false, versao = versao + 1, atualizado_em = now()
     WHERE id = p_modelo_id AND empresa_id = p_empresa_id AND ativo AND versao = p_expected_version RETURNING * INTO m;
    IF NOT FOUND THEN PERFORM app_private.erro('VERSION_CONFLICT', 'Este modelo mudou ou já foi removido. Atualize a tela.'); END IF;
    PERFORM app_private.auditar(p_empresa_id, usuario, 'orcamento.modelo_removido', 'modelos_orcamento', m.id, jsonb_build_object('nome', m.nome));
    RETURN app_private.idem_fim(usuario, 'salvar_modelo_orcamento', p_operation_key, assinatura, jsonb_build_object('id', m.id, 'ativo', false));
  END IF;
  IF char_length(v_nome) NOT BETWEEN 2 AND 80 THEN PERFORM app_private.erro('VALIDATION_ERROR', 'Dê um nome ao modelo (2 a 80 caracteres).', 'nome'); END IF;
  IF char_length(v_prazo) > 120 THEN PERFORM app_private.erro('VALIDATION_ERROR', 'O prazo pode ter até 120 caracteres.', 'prazo_execucao'); END IF;
  IF char_length(v_cond) > 1000 THEN PERFORM app_private.erro('VALIDATION_ERROR', 'As condições podem ter até 1000 caracteres.', 'condicoes'); END IF;
  v_comp := app_private.componentes_de_modelo(p_dados->'componentes');
  IF EXISTS (SELECT 1 FROM public.modelos_orcamento WHERE empresa_id = p_empresa_id AND ativo AND app_private.sem_acento(nome) = app_private.sem_acento(v_nome) AND id IS DISTINCT FROM p_modelo_id) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Já existe um modelo com este nome.', 'nome');
  END IF;
  IF p_modelo_id IS NULL THEN
    INSERT INTO public.modelos_orcamento (empresa_id, nome, componentes, prazo_execucao, condicoes, criado_por)
    VALUES (p_empresa_id, v_nome, v_comp, v_prazo, v_cond, usuario) RETURNING * INTO m;
  ELSE
    UPDATE public.modelos_orcamento SET nome = v_nome, componentes = v_comp, prazo_execucao = v_prazo, condicoes = v_cond, versao = versao + 1, atualizado_em = now()
     WHERE id = p_modelo_id AND empresa_id = p_empresa_id AND ativo AND versao = p_expected_version RETURNING * INTO m;
    IF NOT FOUND THEN PERFORM app_private.erro('VERSION_CONFLICT', 'Este modelo mudou ou foi removido. Atualize a tela.'); END IF;
  END IF;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'orcamento.modelo_salvo', 'modelos_orcamento', m.id, jsonb_build_object('nome', m.nome, 'itens', jsonb_array_length(v_comp)));
  RETURN app_private.idem_fim(usuario, 'salvar_modelo_orcamento', p_operation_key, assinatura, jsonb_build_object('id', m.id, 'nome', m.nome, 'versao', m.versao));
END $$;

-- ===========================================================================
-- Privilégios
-- ===========================================================================
REVOKE ALL ON FUNCTION app_private.notificar(text, uuid, text, text, text, text, text, text),
  app_private.notificar_equipe(uuid, text, text, text, text, text, text, text), app_private.ator_atual(),
  app_private.notificar_pedido(), app_private.notificar_solicitacao(), app_private.notificar_os(), app_private.notificar_proposta(),
  app_private.componentes_de_modelo(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flags_ativas(uuid), public.ck_flags(), public.ck_definir_flag(text, boolean, text, integer, text),
  public.definir_flag_empresa(uuid, text, boolean, text), public.minhas_notificacoes(timestamptz, integer), public.marcar_notificacoes_lidas(uuid[]),
  public.preferencias_notificacao(), public.definir_preferencia_notificacao(text, boolean), public.meu_onboarding(), public.dispensar_onboarding(text),
  public.reiniciar_onboarding(), public.modelos_orcamento(uuid), public.salvar_modelo_orcamento(uuid, uuid, jsonb, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ck_flags(), public.ck_definir_flag(text, boolean, text, integer, text),
  public.definir_flag_empresa(uuid, text, boolean, text), public.minhas_notificacoes(timestamptz, integer), public.marcar_notificacoes_lidas(uuid[]),
  public.preferencias_notificacao(), public.definir_preferencia_notificacao(text, boolean), public.meu_onboarding(), public.dispensar_onboarding(text),
  public.reiniciar_onboarding(), public.modelos_orcamento(uuid), public.salvar_modelo_orcamento(uuid, uuid, jsonb, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.flags_ativas(uuid) TO authenticated, anonymous;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202612010002', 'Pacote 27/11: busca na lista de vendas, feature flags com consumidores reais, notificações persistentes com deduplicação e preferências, onboarding dispensável e modelos de orçamento');

COMMIT;
