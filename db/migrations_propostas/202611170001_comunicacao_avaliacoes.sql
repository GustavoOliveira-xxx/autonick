-- 202611170001: M12, comunicação, avaliações e moderação ampliada (MINI-ESPEC_M12; ADR-G12 aprovada em 17/11/2026:
-- D12-18 = C; D12-22 = A com exceção para administrador único; demais = A; avisos, métricas e marcador fora).
-- Só no branch `desenvolvimento`. Catálogo de permissões continua com 55; o papel `anonymous` continua com as três funções
-- do M10 (as avaliações entram na resposta de vitrine_publica, sem função nova). Tabelas novas sem acesso direto.
-- Nenhum serviço novo: a tela consulta a conversa a cada 20 s (RF-159 PARCIAL); sem imagem (RF-163 PARCIAL, ADR-006 = B).

BEGIN;

-- ===========================================================================
-- 1. Tabelas (nenhuma exposta: RLS ativo, sem política, sem GRANT; acesso só pelas funções)
-- ===========================================================================

-- D12-02 = A: mensagens novas a partir do M12. As do M08 (solicitacao_eventos, tipo `mensagem`) e as atualizações públicas
-- da OS (os_eventos, tipo `atualizacao`) continuam na origem e são lidas sem cópia.
CREATE TABLE public.mensagens_atendimento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES public.empresas (id),
  solicitacao_id uuid,
  pedido_id      uuid,
  autor_papel    text NOT NULL CHECK (autor_papel IN ('cliente', 'empresa')),
  autor_auth_id  text NOT NULL,
  texto          text NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 1000),
  criado_em      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((solicitacao_id IS NULL) <> (pedido_id IS NULL)),
  FOREIGN KEY (empresa_id, solicitacao_id) REFERENCES public.solicitacoes_servico (empresa_id, id),
  FOREIGN KEY (empresa_id, pedido_id) REFERENCES public.pedidos (empresa_id, id)
);
CREATE INDEX mensagens_por_solicitacao ON public.mensagens_atendimento (solicitacao_id, criado_em) WHERE solicitacao_id IS NOT NULL;
CREATE INDEX mensagens_por_pedido ON public.mensagens_atendimento (pedido_id, criado_em) WHERE pedido_id IS NOT NULL;
CREATE INDEX mensagens_por_autor ON public.mensagens_atendimento (autor_auth_id, criado_em);
CREATE TRIGGER mensagens_imutaveis BEFORE UPDATE OR DELETE ON public.mensagens_atendimento
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- D12-09 a D12-14: avaliação verificada de OS encerrada; uma por OS (RN-045), mesmo retirada (D12-10).
CREATE TABLE public.avaliacoes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES public.empresas (id),
  os_id            uuid NOT NULL UNIQUE,
  cliente_auth_id  text NOT NULL,
  nota             smallint NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario       text CHECK (char_length(comentario) BETWEEN 1 AND 1000),
  estado           text NOT NULL DEFAULT 'aguardando' CHECK (estado IN ('aguardando', 'publicada', 'recusada', 'retirada')),
  sinaliza_contato boolean NOT NULL DEFAULT false,
  dado_de_teste    boolean NOT NULL DEFAULT false,
  criado_em        timestamptz NOT NULL DEFAULT clock_timestamp(),
  publicada_em     timestamptz,
  retirada_em      timestamptz,
  FOREIGN KEY (empresa_id, os_id) REFERENCES public.ordens_servico (empresa_id, id),
  CHECK (estado <> 'publicada' OR publicada_em IS NOT NULL),
  CHECK (estado <> 'retirada' OR retirada_em IS NOT NULL)
);
CREATE INDEX avaliacoes_por_empresa ON public.avaliacoes (empresa_id, estado, publicada_em DESC);
CREATE TRIGGER avaliacoes_sem_exclusao BEFORE DELETE ON public.avaliacoes
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- D12-12: uma resposta por avaliação, sem edição, moderada antes de publicar.
CREATE TABLE public.respostas_avaliacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  avaliacao_id  uuid NOT NULL UNIQUE REFERENCES public.avaliacoes (id),
  empresa_id    uuid NOT NULL REFERENCES public.empresas (id),
  autor_auth_id text NOT NULL,
  texto         text NOT NULL CHECK (char_length(texto) BETWEEN 2 AND 1000),
  estado        text NOT NULL DEFAULT 'aguardando' CHECK (estado IN ('aguardando', 'publicada', 'recusada')),
  sinaliza_contato boolean NOT NULL DEFAULT false,
  criado_em     timestamptz NOT NULL DEFAULT clock_timestamp(),
  publicada_em  timestamptz,
  CHECK (estado <> 'publicada' OR publicada_em IS NOT NULL)
);
CREATE TRIGGER respostas_sem_exclusao BEFORE DELETE ON public.respostas_avaliacao
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- D12-16 e D12-17: denúncia. O denunciante nunca é devolvido às partes (D12-22).
CREATE TABLE public.denuncias (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo           bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  alvo_tipo           text NOT NULL CHECK (alvo_tipo IN ('empresa', 'avaliacao', 'resposta', 'mensagem', 'mensagem_m08', 'atualizacao_os')),
  alvo_id             uuid NOT NULL,
  empresa_id          uuid NOT NULL REFERENCES public.empresas (id),
  autor_auth_id       text,
  denunciante_auth_id text NOT NULL,
  categoria           text NOT NULL CHECK (categoria IN ('ofensivo', 'falso', 'dado_pessoal', 'spam', 'golpe', 'outro')),
  descricao           text CHECK (char_length(descricao) <= 1000),
  estado              text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'em_analise', 'resolvida')),
  assumida_por        text,
  assumida_em         timestamptz,
  decisao_id          uuid,
  criado_em           timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolvida_em        timestamptz
);
CREATE UNIQUE INDEX denuncias_uma_aberta ON public.denuncias (denunciante_auth_id, alvo_tipo, alvo_id) WHERE estado <> 'resolvida';
CREATE INDEX denuncias_por_estado ON public.denuncias (estado, criado_em);
CREATE TRIGGER denuncias_sem_exclusao BEFORE DELETE ON public.denuncias
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- D12-22: registro imutável de toda decisão de moderação.
CREATE TABLE public.decisoes_moderacao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alvo_tipo      text NOT NULL CHECK (alvo_tipo IN ('empresa', 'avaliacao', 'resposta', 'mensagem', 'mensagem_m08', 'atualizacao_os')),
  alvo_id        uuid NOT NULL,
  empresa_id     uuid NOT NULL REFERENCES public.empresas (id),
  denuncia_id    uuid REFERENCES public.denuncias (id),
  contestacao_id uuid,
  medida         text NOT NULL CHECK (medida IN ('arquivar', 'ocultar', 'encaminhar_suspensao', 'aprovar', 'recusar', 'restaurar', 'manter')),
  motivo_resumo  text CHECK (char_length(motivo_resumo) BETWEEN 10 AND 300),
  justificativa  text CHECK (char_length(justificativa) BETWEEN 20 AND 2000),
  decidido_por   text NOT NULL,
  mesmo_decisor  boolean NOT NULL DEFAULT false,
  criado_em      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX decisoes_por_alvo ON public.decisoes_moderacao (alvo_tipo, alvo_id, criado_em);
CREATE TRIGGER decisoes_imutaveis BEFORE UPDATE OR DELETE ON public.decisoes_moderacao
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- Estado vigente de ocultação (D12-18 = C). Cada mudança aponta para a decisão que a causou; o conteúdo original nunca muda.
CREATE TABLE public.conteudos_moderados (
  alvo_tipo     text NOT NULL,
  alvo_id       uuid NOT NULL,
  oculto        boolean NOT NULL,
  decisao_id    uuid NOT NULL REFERENCES public.decisoes_moderacao (id),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (alvo_tipo, alvo_id)
);

-- D12-22: uma contestação por decisão, da parte afetada.
CREATE TABLE public.contestacoes_moderacao (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decisao_id       uuid NOT NULL UNIQUE REFERENCES public.decisoes_moderacao (id),
  autor_auth_id    text NOT NULL,
  motivo           text NOT NULL CHECK (char_length(motivo) BETWEEN 10 AND 1000),
  estado           text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'em_revisao', 'decidida')),
  assumida_por     text,
  decisao_final_id uuid REFERENCES public.decisoes_moderacao (id),
  criado_em        timestamptz NOT NULL DEFAULT clock_timestamp(),
  decidida_em      timestamptz
);
CREATE TRIGGER contestacoes_moderacao_sem_exclusao BEFORE DELETE ON public.contestacoes_moderacao
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- D12-07 = A: limites novos na tabela da CK (ajustáveis no painel do M10, com motivo e histórico).
INSERT INTO app_private.limites_plataforma (chave, valor, minimo, maximo, descricao) VALUES
  ('mensagens_por_conversa_dia', 50, 1, 500, 'Mensagens por participante em cada conversa por dia (horário de São Paulo)'),
  ('denuncias_por_dia', 10, 1, 100, 'Denúncias por conta por dia (horário de São Paulo)');

-- ===========================================================================
-- 2. Auxiliares privadas
-- ===========================================================================

CREATE FUNCTION app_private.conteudo_oculto(p_tipo text, p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT coalesce((SELECT oculto FROM public.conteudos_moderados WHERE alvo_tipo = p_tipo AND alvo_id = p_id), false) $$;

CREATE FUNCTION app_private.mes_ano(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT to_char(p AT TIME ZONE 'America/Sao_Paulo', 'MM/YYYY') $$;

-- Acesso a uma conversa (D12-01, D12-03, D12-05, D12-06). p_tipo: 'solicitacao', 'os' ou 'pedido'.
-- Cliente: titular do atendimento (vê todo o histórico, antes e depois da OS).
-- Equipe, solicitação sem OS: lê com orcamentos.visualizar; envia com orcamentos.criar (as mesmas do M08).
-- Equipe, depois da OS: com orcamentos.visualizar lê toda a conversa (como no M08); só com servicos.visualizar lê a partir do
--   aceite (quando a OS nasceu) e as atualizações públicas da OS, sem ganhar acesso às mensagens anteriores; envia com
--   orcamentos.criar ou servicos.alterar.
-- Equipe, pedido: lê com pedidos.visualizar; envia com pedidos.aprovar.
-- Suspensão comum ou grave não bloqueia (D12-05); não há atendimento novo pela conversa.
-- Envio depois do fim: 30 dias; OS encerrada com garantia registrada vai até a data final da garantia, se for depois.
CREATE FUNCTION app_private.conversa_acesso(p_tipo text, p_id uuid, p_usuario text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  s public.solicitacoes_servico;
  o public.ordens_servico;
  ped public.pedidos;
  papel text;
  perms text[];
  empresa uuid;
  desde timestamptz;
  ve_os boolean := false;
  pode_ler boolean := false;
  pode_enviar boolean := false;
  fim timestamptz;
  garantia_fim timestamptz;
  bloqueio text;
  rotulo text;
BEGIN
  IF p_tipo IN ('solicitacao', 'os') THEN
    IF p_tipo = 'os' THEN
      SELECT * INTO o FROM public.ordens_servico WHERE id = p_id;
      IF NOT FOUND THEN
        PERFORM app_private.erro('NOT_FOUND', 'Atendimento não encontrado.');
      END IF;
      SELECT * INTO s FROM public.solicitacoes_servico WHERE id = o.solicitacao_id;
    ELSE
      SELECT * INTO s FROM public.solicitacoes_servico WHERE id = p_id;
      IF NOT FOUND THEN
        PERFORM app_private.erro('NOT_FOUND', 'Atendimento não encontrado.');
      END IF;
      SELECT * INTO o FROM public.ordens_servico WHERE solicitacao_id = s.id;
    END IF;
    empresa := s.empresa_id;
    IF s.origem = 'plataforma' AND s.cliente_auth_id = p_usuario THEN
      papel := 'cliente'; pode_ler := true; pode_enviar := true; ve_os := o.id IS NOT NULL;
    ELSIF app_private.eh_membro(empresa, p_usuario) THEN
      papel := 'equipe';
      perms := app_private.permissoes_de(empresa, p_usuario);
      IF 'orcamentos.visualizar' = ANY (perms) THEN
        pode_ler := true;
      END IF;
      IF o.id IS NOT NULL AND 'servicos.visualizar' = ANY (perms) THEN
        ve_os := true;
        IF NOT pode_ler THEN
          pode_ler := true; desde := o.aceita_em;
        END IF;
      END IF;
      pode_enviar := 'orcamentos.criar' = ANY (perms) OR (o.id IS NOT NULL AND 'servicos.alterar' = ANY (perms));
      IF NOT pode_ler THEN
        PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite ver a conversa deste atendimento.');
      END IF;
    ELSE
      PERFORM app_private.erro('NOT_FOUND', 'Atendimento não encontrado.');
    END IF;
    IF o.id IS NULL THEN
      IF s.estado IN ('recusada', 'cancelada') THEN
        bloqueio := 'Esta solicitação foi encerrada antes do aceite: a conversa fica só para leitura.';
      END IF;
    ELSIF o.estado = 'encerrada' THEN
      fim := o.encerrada_em + interval '30 days';
      IF o.garantia_dias IS NOT NULL AND o.concluida_em IS NOT NULL THEN
        -- Data final da garantia registrada no M09 (a mesma "até" mostrada na OS), até o fim desse dia em São Paulo.
        garantia_fim := ((((o.concluida_em AT TIME ZONE 'America/Sao_Paulo')::date + o.garantia_dias + 1)::timestamp) AT TIME ZONE 'America/Sao_Paulo');
        fim := greatest(fim, garantia_fim);
      END IF;
    ELSIF o.estado = 'cancelada' THEN
      fim := o.cancelada_em + interval '30 days';
    END IF;
    rotulo := CASE WHEN o.id IS NOT NULL THEN format('OS nº %s (solicitação nº %s)', o.numero, s.numero) ELSE format('Solicitação nº %s', s.numero) END;
  ELSIF p_tipo = 'pedido' THEN
    SELECT * INTO ped FROM public.pedidos WHERE id = p_id;
    IF NOT FOUND THEN
      PERFORM app_private.erro('NOT_FOUND', 'Atendimento não encontrado.');
    END IF;
    empresa := ped.empresa_id;
    IF ped.cliente_auth_id = p_usuario THEN
      papel := 'cliente'; pode_ler := true; pode_enviar := true;
    ELSIF app_private.eh_membro(empresa, p_usuario) THEN
      papel := 'equipe';
      perms := app_private.permissoes_de(empresa, p_usuario);
      pode_ler := 'pedidos.visualizar' = ANY (perms);
      pode_enviar := 'pedidos.aprovar' = ANY (perms);
      IF NOT pode_ler THEN
        PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite ver a conversa deste atendimento.');
      END IF;
    ELSE
      PERFORM app_private.erro('NOT_FOUND', 'Atendimento não encontrado.');
    END IF;
    IF ped.estado = 'concluido' THEN
      fim := ped.concluido_em + interval '30 days';
    ELSIF ped.estado = 'recusado' THEN
      fim := ped.decidido_em + interval '30 days';
    ELSIF ped.estado = 'cancelado' THEN
      fim := coalesce((SELECT max(ev.criado_em) FROM public.eventos_comerciais ev
                        WHERE ev.alvo_tipo = 'pedido' AND ev.alvo_id = ped.id AND ev.tipo = 'pedido_cancelado'),
                      ped.decidido_em, ped.criado_em) + interval '30 days';
    END IF;
    rotulo := format('Pedido de %s', to_char(ped.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'));
  ELSE
    PERFORM app_private.erro('VALIDATION_ERROR', 'Tipo de atendimento inválido.', 'tipo');
  END IF;
  IF bloqueio IS NULL AND fim IS NOT NULL AND now() > fim THEN
    bloqueio := 'O prazo para enviar mensagens neste atendimento terminou: a conversa fica só para leitura.';
  END IF;
  IF bloqueio IS NULL AND NOT pode_enviar THEN
    bloqueio := 'Seu acesso permite ler esta conversa, mas não enviar mensagens.';
  END IF;
  RETURN jsonb_build_object(
    'tipo', CASE WHEN s.id IS NOT NULL THEN 'solicitacao' ELSE 'pedido' END,
    'solicitacao_id', s.id, 'os_id', o.id, 'pedido_id', ped.id, 'empresa_id', empresa, 'papel', papel,
    'desde', desde, 've_os', ve_os, 'pode_enviar', bloqueio IS NULL, 'bloqueio', bloqueio, 'envio_ate', fim, 'rotulo', rotulo);
END $$;

-- Resumo da decisão que afeta um conteúdo, só para a parte afetada (motivo resumido; nunca o denunciante).
CREATE FUNCTION app_private.moderacao_para_parte(p_tipo text, p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('decisao_id', d.id, 'medida', d.medida, 'motivo', d.motivo_resumo,
           'data', d.criado_em, 'contestacao', (SELECT jsonb_build_object('estado', c.estado,
              'resultado', (SELECT f.medida FROM public.decisoes_moderacao f WHERE f.id = c.decisao_final_id))
             FROM public.contestacoes_moderacao c WHERE c.decisao_id = d.id),
           'pode_contestar', NOT EXISTS (SELECT 1 FROM public.contestacoes_moderacao c WHERE c.decisao_id = d.id))
    FROM public.decisoes_moderacao d
   WHERE d.alvo_tipo = p_tipo AND d.alvo_id = p_id AND d.medida IN ('ocultar', 'recusar')
   ORDER BY d.criado_em DESC LIMIT 1
$$;

-- Itens da conversa: leitura unificada das três fontes, sem cópia; notas internas nunca entram (filtros da origem).
CREATE FUNCTION app_private.itens_conversa(p_acesso jsonb, p_usuario text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH a AS (
    SELECT (p_acesso->>'solicitacao_id')::uuid AS sol, (p_acesso->>'pedido_id')::uuid AS ped, (p_acesso->>'os_id')::uuid AS os,
           (p_acesso->>'desde')::timestamptz AS desde, coalesce((p_acesso->>'ve_os')::boolean, false) AS ve_os
  ), itens AS (
    SELECT m.id, 'mensagem'::text AS alvo_tipo, m.autor_papel AS autor, m.autor_auth_id, m.texto, m.criado_em
      FROM public.mensagens_atendimento m, a
     WHERE ((a.sol IS NOT NULL AND m.solicitacao_id = a.sol) OR (a.ped IS NOT NULL AND m.pedido_id = a.ped))
       AND (a.desde IS NULL OR m.criado_em >= a.desde)
    UNION ALL
    SELECT e.id, 'mensagem_m08', CASE WHEN e.autor_tipo = 'cliente' THEN 'cliente' ELSE 'empresa' END, e.autor_auth_id, e.texto, e.criado_em
      FROM public.solicitacao_eventos e, a
     WHERE a.sol IS NOT NULL AND e.solicitacao_id = a.sol AND e.tipo = 'mensagem' AND e.visivel_cliente
       AND (a.desde IS NULL OR e.criado_em >= a.desde)
    UNION ALL
    SELECT e.id, 'atualizacao_os', 'empresa', e.autor_auth_id, e.texto, e.criado_em
      FROM public.os_eventos e, a
     WHERE a.ve_os AND e.os_id = a.os AND e.tipo = 'atualizacao' AND e.publico
  ), marcados AS (
    SELECT i.*, app_private.conteudo_oculto(i.alvo_tipo, i.id) AS oculta, i.autor_auth_id = p_usuario AS proprio FROM itens i
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'alvo_tipo', alvo_tipo, 'tipo', CASE WHEN alvo_tipo = 'atualizacao_os' THEN 'atualizacao' ELSE 'mensagem' END,
      'autor', autor, 'proprio', coalesce(proprio, false), 'oculta', oculta,
      'texto', CASE WHEN oculta AND NOT coalesce(proprio, false) THEN NULL ELSE texto END,
      'moderacao', CASE WHEN oculta AND coalesce(proprio, false) THEN app_private.moderacao_para_parte(alvo_tipo, id) END,
      'criado_em', criado_em) ORDER BY criado_em, id), '[]'::jsonb)
    FROM marcados
$$;

-- Grava uma mensagem nova (usada por enviar_mensagem e pela registrar_mensagem do M08).
CREATE FUNCTION app_private.gravar_mensagem(p_tipo text, p_id uuid, p_usuario text, p_texto text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  a jsonb := app_private.conversa_acesso(p_tipo, p_id, p_usuario);
  conv uuid;
  v public.mensagens_atendimento;
  lim integer := app_private.limite('mensagens_por_conversa_dia');
BEGIN
  IF NOT (a->>'pode_enviar')::boolean THEN
    PERFORM app_private.erro('STATE_CONFLICT', a->>'bloqueio');
  END IF;
  conv := coalesce((a->>'solicitacao_id')::uuid, (a->>'pedido_id')::uuid);
  -- D12-07: limite no servidor, serializado por participante e conversa.
  PERFORM pg_advisory_xact_lock(hashtextextended('m12-mensagem|' || p_usuario || '|' || conv::text, 0));
  IF (SELECT count(*) FROM public.mensagens_atendimento m
       WHERE m.autor_auth_id = p_usuario AND (m.solicitacao_id = conv OR m.pedido_id = conv)
         AND (m.criado_em AT TIME ZONE 'America/Sao_Paulo')::date = app_private.hoje_sp()) >= lim THEN
    PERFORM app_private.erro('STATE_CONFLICT', format('Limite de %s mensagens por dia nesta conversa atingido. Tente amanhã.', lim));
  END IF;
  INSERT INTO public.mensagens_atendimento (empresa_id, solicitacao_id, pedido_id, autor_papel, autor_auth_id, texto)
  VALUES ((a->>'empresa_id')::uuid, (a->>'solicitacao_id')::uuid, (a->>'pedido_id')::uuid,
          CASE WHEN a->>'papel' = 'cliente' THEN 'cliente' ELSE 'empresa' END, p_usuario, p_texto)
  RETURNING * INTO v;
  RETURN jsonb_build_object('id', v.id, 'alvo_tipo', 'mensagem', 'tipo', 'mensagem', 'autor', v.autor_papel, 'proprio', true,
    'oculta', false, 'texto', v.texto, 'moderacao', NULL, 'criado_em', v.criado_em);
END $$;

-- Empresa que a conta pode ver para denunciar: cartão público, área de demonstração autorizada (conta fictícia),
-- membro da empresa ou parte de um atendimento com ela.
CREATE FUNCTION app_private.empresa_visivel_para(p_empresa uuid, p_usuario text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM app_private.cartoes_do_conjunto('publico') c WHERE c.empresa_id = p_empresa)
      OR (coalesce(app_private.email_da_pessoa(p_usuario) LIKE '%@autonick-teste.example', false)
          AND app_private.demonstracao_autorizada(p_usuario)
          AND EXISTS (SELECT 1 FROM app_private.cartoes_do_conjunto('demonstracao') c WHERE c.empresa_id = p_empresa))
      OR app_private.eh_membro(p_empresa, p_usuario)
      OR EXISTS (SELECT 1 FROM public.solicitacoes_servico s WHERE s.empresa_id = p_empresa AND s.cliente_auth_id = p_usuario)
      OR EXISTS (SELECT 1 FROM public.pedidos p WHERE p.empresa_id = p_empresa AND p.cliente_auth_id = p_usuario)
$$;

-- Autor do conteúdo (para impedimento, contestação e "o autor vê o próprio conteúdo").
CREATE FUNCTION app_private.autor_do_conteudo(p_tipo text, p_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE p_tipo
    WHEN 'mensagem' THEN (SELECT autor_auth_id FROM public.mensagens_atendimento WHERE id = p_id)
    WHEN 'mensagem_m08' THEN (SELECT autor_auth_id FROM public.solicitacao_eventos WHERE id = p_id AND tipo = 'mensagem')
    WHEN 'atualizacao_os' THEN (SELECT autor_auth_id FROM public.os_eventos WHERE id = p_id AND tipo = 'atualizacao')
    WHEN 'avaliacao' THEN (SELECT cliente_auth_id FROM public.avaliacoes WHERE id = p_id)
    WHEN 'resposta' THEN (SELECT autor_auth_id FROM public.respostas_avaliacao WHERE id = p_id)
  END
$$;

-- Conteúdo mínimo para a CK tratar a denúncia (D12-17): só o item, o papel do autor, a data e o atendimento.
CREATE FUNCTION app_private.conteudo_para_ck(p_tipo text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  r jsonb;
BEGIN
  IF p_tipo = 'mensagem' THEN
    SELECT jsonb_build_object('texto', m.texto, 'autor', m.autor_papel, 'data', m.criado_em,
             'atendimento', CASE WHEN m.solicitacao_id IS NOT NULL
               THEN coalesce((SELECT format('OS nº %s', o.numero) FROM public.ordens_servico o WHERE o.solicitacao_id = m.solicitacao_id),
                             (SELECT format('Solicitação nº %s', s.numero) FROM public.solicitacoes_servico s WHERE s.id = m.solicitacao_id))
               ELSE 'Pedido de produto' END)
      INTO r FROM public.mensagens_atendimento m WHERE m.id = p_id;
  ELSIF p_tipo = 'mensagem_m08' THEN
    SELECT jsonb_build_object('texto', e.texto, 'autor', CASE WHEN e.autor_tipo = 'cliente' THEN 'cliente' ELSE 'empresa' END,
             'data', e.criado_em, 'atendimento', (SELECT format('Solicitação nº %s', s.numero) FROM public.solicitacoes_servico s WHERE s.id = e.solicitacao_id))
      INTO r FROM public.solicitacao_eventos e WHERE e.id = p_id AND e.tipo = 'mensagem';
  ELSIF p_tipo = 'atualizacao_os' THEN
    SELECT jsonb_build_object('texto', e.texto, 'autor', 'empresa', 'data', e.criado_em,
             'atendimento', (SELECT format('OS nº %s', o.numero) FROM public.ordens_servico o WHERE o.id = e.os_id))
      INTO r FROM public.os_eventos e WHERE e.id = p_id AND e.tipo = 'atualizacao';
  ELSIF p_tipo = 'avaliacao' THEN
    SELECT jsonb_build_object('nota', a.nota, 'comentario', a.comentario, 'estado', a.estado, 'data', a.criado_em,
             'sinaliza_contato', a.sinaliza_contato) INTO r FROM public.avaliacoes a WHERE a.id = p_id;
  ELSIF p_tipo = 'resposta' THEN
    SELECT jsonb_build_object('texto', x.texto, 'estado', x.estado, 'data', x.criado_em, 'sinaliza_contato', x.sinaliza_contato,
             'avaliacao', (SELECT jsonb_build_object('nota', a.nota, 'comentario', a.comentario) FROM public.avaliacoes a WHERE a.id = x.avaliacao_id))
      INTO r FROM public.respostas_avaliacao x WHERE x.id = p_id;
  ELSIF p_tipo = 'empresa' THEN
    r := jsonb_build_object('nome_publico', app_private.nome_aprovado(p_id));
  END IF;
  RETURN coalesce(r, '{}'::jsonb) || jsonb_build_object('oculto', app_private.conteudo_oculto(p_tipo, p_id));
END $$;

CREATE FUNCTION app_private.exigir_ck(p_usuario text) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_private.administradores_ck WHERE auth_user_id = p_usuario AND ativo) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Somente a equipe da CK pode realizar esta ação.');
  END IF;
END $$;

-- Impedimentos (SEC-001 §8.5 e regras aprovadas): membro da empresa, autor do conteúdo ou quem denunciou.
CREATE FUNCTION app_private.impedimento_ck(p_usuario text, p_empresa uuid, p_autor text, p_denunciante text) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN app_private.eh_membro(p_empresa, p_usuario) THEN 'Você é membro desta empresa e não pode decidir sobre ela (conflito de interesse).'
    WHEN p_autor IS NOT NULL AND p_autor = p_usuario THEN 'Você é autor deste conteúdo e não pode decidir sobre ele.'
    WHEN p_denunciante IS NOT NULL AND p_denunciante = p_usuario THEN 'Você fez esta denúncia e não pode decidir sobre ela.'
  END
$$;

-- Avaliação vista pelo cliente autor.
CREATE FUNCTION app_private.avaliacao_do_cliente(p_avaliacao_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', a.id, 'os_id', a.os_id, 'nota', a.nota, 'comentario', a.comentario, 'estado', a.estado,
    'oculta', app_private.conteudo_oculto('avaliacao', a.id), 'criado_em', a.criado_em, 'publicada_em', a.publicada_em,
    'moderacao', CASE WHEN a.estado = 'recusada' OR app_private.conteudo_oculto('avaliacao', a.id)
                      THEN app_private.moderacao_para_parte('avaliacao', a.id) END,
    'resposta', (SELECT jsonb_build_object('texto', r.texto, 'data', app_private.mes_ano(r.publicada_em))
                   FROM public.respostas_avaliacao r
                  WHERE r.avaliacao_id = a.id AND r.estado = 'publicada' AND NOT app_private.conteudo_oculto('resposta', r.id)))
    FROM public.avaliacoes a WHERE a.id = p_avaliacao_id
$$;

-- D12-13 e D12-14: avaliações na vitrine. Conta só as publicadas e não ocultas; média só a partir de 3; resposta só junto
-- da avaliação pública; ocultas aparecem só como indicação de moderação (D12-18 = C), sem nota, texto nem resposta;
-- retiradas não aparecem; na rota pública nunca entram avaliações de contas fictícias.
CREATE FUNCTION app_private.avaliacoes_vitrine(p_empresa uuid, p_conjunto text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH vis AS (
    SELECT a.*, app_private.conteudo_oculto('avaliacao', a.id) AS oc
      FROM public.avaliacoes a
     WHERE a.empresa_id = p_empresa AND a.estado = 'publicada' AND (p_conjunto = 'demonstracao' OR NOT a.dado_de_teste)
  ), pub AS (SELECT * FROM vis WHERE NOT oc)
  SELECT jsonb_build_object(
    'quantidade', (SELECT count(*) FROM pub),
    'media', CASE WHEN (SELECT count(*) FROM pub) >= 3 THEN round((SELECT avg(nota) FROM pub)::numeric, 1) END,
    'minimo_para_media', 3,
    'itens', coalesce((SELECT jsonb_agg(item ORDER BY quando DESC, id) FROM (
        SELECT v.id, v.publicada_em AS quando, CASE WHEN v.oc
          THEN jsonb_build_object('id', v.id, 'oculta', true, 'data', app_private.mes_ano(v.publicada_em))
          ELSE jsonb_build_object('id', v.id, 'oculta', false, 'nota', v.nota, 'comentario', v.comentario,
                 'autor', 'Cliente verificado', 'data', app_private.mes_ano(v.publicada_em),
                 'resposta', (SELECT jsonb_build_object('id', r.id, 'texto', r.texto, 'data', app_private.mes_ano(r.publicada_em))
                                FROM public.respostas_avaliacao r
                               WHERE r.avaliacao_id = v.id AND r.estado = 'publicada' AND NOT app_private.conteudo_oculto('resposta', r.id)))
          END AS item
          FROM vis v ORDER BY v.publicada_em DESC, v.id LIMIT 20) x), '[]'::jsonb))
$$;

-- ===========================================================================
-- 3. Funções públicas: conversa (D12-01 a D12-07)
-- ===========================================================================

CREATE FUNCTION public.conversa_atendimento(p_tipo text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  a jsonb := app_private.conversa_acesso(p_tipo, p_id, usuario);
BEGIN
  RETURN jsonb_build_object('tipo', a->>'tipo', 'rotulo', a->>'rotulo', 'papel', a->>'papel',
    'pode_enviar', (a->>'pode_enviar')::boolean, 'bloqueio', a->>'bloqueio', 'envio_ate', a->'envio_ate',
    'suspensao', app_private.suspensao_da_vitrine((a->>'empresa_id')::uuid),
    'limite_diario', app_private.limite('mensagens_por_conversa_dia'),
    'aviso', 'Não compartilhe senhas, códigos nem dados de pagamento.',
    'atualizar_a_cada_s', 20,
    'itens', app_private.itens_conversa(a, usuario));
END $$;

CREATE FUNCTION public.enviar_mensagem(p_tipo text, p_id uuid, p_texto text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_tipo, p_id, p_texto));
  anterior jsonb;
  v_texto text;
  r jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'enviar_mensagem', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  v_texto := app_private.ler_texto(p_texto, 1, 1000, 'texto', 'Escreva a mensagem (até 1.000 caracteres).');
  r := app_private.gravar_mensagem(p_tipo, p_id, usuario, v_texto);
  RETURN app_private.idem_fim(usuario, 'enviar_mensagem', p_operation_key, assinatura, r);
END $$;

-- ===========================================================================
-- 4. Funções públicas: avaliações (D12-09 a D12-14)
-- ===========================================================================

CREATE FUNCTION public.minha_avaliacao_os(p_os_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  o public.ordens_servico;
  av uuid;
  motivo text;
BEGIN
  SELECT * INTO o FROM public.ordens_servico WHERE id = p_os_id;
  IF NOT FOUND OR o.origem <> 'plataforma' OR o.cliente_auth_id IS DISTINCT FROM usuario THEN
    PERFORM app_private.erro('NOT_FOUND', 'Atendimento não encontrado.');
  END IF;
  SELECT id INTO av FROM public.avaliacoes WHERE os_id = o.id;
  motivo := CASE
    WHEN av IS NOT NULL THEN 'Este atendimento já foi avaliado.'
    WHEN o.estado = 'cancelada' THEN 'Atendimento cancelado não é avaliado.'
    WHEN o.estado <> 'encerrada' THEN 'A avaliação fica disponível quando o atendimento for encerrado.'
    WHEN now() > o.encerrada_em + interval '60 days' THEN 'O prazo de 60 dias para avaliar este atendimento terminou.'
  END;
  RETURN jsonb_build_object('elegivel', motivo IS NULL, 'motivo', motivo,
    'prazo_ate', CASE WHEN o.estado = 'encerrada' THEN o.encerrada_em + interval '60 days' END,
    'avaliacao', CASE WHEN av IS NOT NULL THEN app_private.avaliacao_do_cliente(av) END);
END $$;

CREATE FUNCTION public.avaliar_os(p_os_id uuid, p_nota integer, p_comentario text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_nota, p_comentario));
  anterior jsonb;
  o public.ordens_servico;
  av public.avaliacoes;
  v_com text := nullif(btrim(coalesce(p_comentario, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'avaliar_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO o FROM public.ordens_servico WHERE id = p_os_id FOR UPDATE;
  -- SEC-T17: quem não é o titular recebe "não encontrado", sem saber se a OS existe.
  IF NOT FOUND OR o.origem <> 'plataforma' OR o.cliente_auth_id IS DISTINCT FROM usuario THEN
    PERFORM app_private.erro('NOT_FOUND', 'Atendimento não encontrado.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.avaliacoes WHERE os_id = o.id) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este atendimento já foi avaliado.');
  END IF;
  IF o.estado <> 'encerrada' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só é possível avaliar um atendimento encerrado.');
  END IF;
  IF now() > o.encerrada_em + interval '60 days' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O prazo de 60 dias para avaliar este atendimento terminou.');
  END IF;
  IF p_nota IS NULL OR p_nota NOT BETWEEN 1 AND 5 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha uma nota de 1 a 5.', 'nota');
  END IF;
  IF char_length(v_com) > 1000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O comentário vai até 1.000 caracteres.', 'comentario');
  END IF;
  INSERT INTO public.avaliacoes (empresa_id, os_id, cliente_auth_id, nota, comentario, sinaliza_contato, dado_de_teste)
  VALUES (o.empresa_id, o.id, usuario, p_nota, v_com, coalesce(app_private.tem_contato(v_com), false),
          coalesce(app_private.email_da_pessoa(usuario) LIKE '%@autonick-teste.example', false))
  RETURNING * INTO av;
  PERFORM app_private.auditar(o.empresa_id, usuario, 'avaliacoes.enviada', 'avaliacoes', av.id, jsonb_build_object('nota', av.nota));
  RETURN app_private.idem_fim(usuario, 'avaliar_os', p_operation_key, assinatura, app_private.avaliacao_do_cliente(av.id));
END $$;

CREATE FUNCTION public.retirar_avaliacao(p_avaliacao_id uuid, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(p_avaliacao_id::text);
  anterior jsonb;
  av public.avaliacoes;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'retirar_avaliacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO av FROM public.avaliacoes WHERE id = p_avaliacao_id FOR UPDATE;
  IF NOT FOUND OR av.cliente_auth_id <> usuario THEN
    PERFORM app_private.erro('NOT_FOUND', 'Avaliação não encontrada.');
  END IF;
  IF av.estado NOT IN ('aguardando', 'publicada') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta avaliação não pode mais ser retirada.');
  END IF;
  UPDATE public.avaliacoes SET estado = 'retirada', retirada_em = now() WHERE id = av.id;
  PERFORM app_private.auditar(av.empresa_id, usuario, 'avaliacoes.retirada', 'avaliacoes', av.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'retirar_avaliacao', p_operation_key, assinatura, app_private.avaliacao_do_cliente(av.id));
END $$;

-- Avaliações da empresa para a equipe (vitrine.visualizar): só as já publicadas (D12-11); ocultas só como indicação.
CREATE FUNCTION public.avaliacoes_da_empresa(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  pode_responder boolean;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['vitrine.visualizar']);
  pode_responder := app_private.permissoes_de(p_empresa_id, usuario) @> ARRAY['vitrine.alterar'];
  RETURN jsonb_build_object('vitrine', app_private.avaliacoes_vitrine(p_empresa_id, 'demonstracao') - 'itens',
    'itens', coalesce((SELECT jsonb_agg(item ORDER BY quando DESC, id) FROM (
      SELECT a.id, a.publicada_em AS quando,
        CASE WHEN app_private.conteudo_oculto('avaliacao', a.id)
          THEN jsonb_build_object('id', a.id, 'oculta', true, 'data', app_private.mes_ano(a.publicada_em))
          ELSE jsonb_build_object('id', a.id, 'oculta', false, 'nota', a.nota, 'comentario', a.comentario,
            'autor', 'Cliente verificado', 'data', app_private.mes_ano(a.publicada_em),
            'pode_responder', pode_responder AND NOT EXISTS (SELECT 1 FROM public.respostas_avaliacao r WHERE r.avaliacao_id = a.id),
            'resposta', (SELECT jsonb_build_object('id', r.id, 'estado', r.estado,
                 'oculta', app_private.conteudo_oculto('resposta', r.id), 'proprio', r.autor_auth_id = usuario,
                 'texto', CASE WHEN app_private.conteudo_oculto('resposta', r.id) AND r.autor_auth_id <> usuario THEN NULL ELSE r.texto END,
                 'moderacao', CASE WHEN r.autor_auth_id = usuario AND (r.estado = 'recusada' OR app_private.conteudo_oculto('resposta', r.id))
                                   THEN app_private.moderacao_para_parte('resposta', r.id) END)
               FROM public.respostas_avaliacao r WHERE r.avaliacao_id = a.id))
        END AS item
        FROM public.avaliacoes a WHERE a.empresa_id = p_empresa_id AND a.estado = 'publicada') x), '[]'::jsonb));
END $$;

CREATE FUNCTION public.responder_avaliacao(p_avaliacao_id uuid, p_texto text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_avaliacao_id, p_texto));
  anterior jsonb;
  av public.avaliacoes;
  r public.respostas_avaliacao;
  v_texto text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'responder_avaliacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO av FROM public.avaliacoes WHERE id = p_avaliacao_id FOR UPDATE;
  IF NOT FOUND OR NOT app_private.eh_membro(av.empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Avaliação não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(av.empresa_id, usuario, ARRAY['vitrine.alterar']);
  IF av.estado <> 'publicada' OR app_private.conteudo_oculto('avaliacao', av.id) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só é possível responder a uma avaliação publicada.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.respostas_avaliacao WHERE avaliacao_id = av.id) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta avaliação já tem resposta.');
  END IF;
  v_texto := app_private.ler_texto(p_texto, 2, 1000, 'texto', 'Escreva a resposta (2 a 1.000 caracteres).');
  INSERT INTO public.respostas_avaliacao (avaliacao_id, empresa_id, autor_auth_id, texto, sinaliza_contato)
  VALUES (av.id, av.empresa_id, usuario, v_texto, coalesce(app_private.tem_contato(v_texto), false)) RETURNING * INTO r;
  PERFORM app_private.auditar(av.empresa_id, usuario, 'avaliacoes.respondida', 'respostas_avaliacao', r.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'responder_avaliacao', p_operation_key, assinatura,
    jsonb_build_object('id', r.id, 'avaliacao_id', av.id, 'estado', r.estado, 'texto', r.texto));
END $$;

-- ===========================================================================
-- 5. Funções públicas: denúncia e contestação (D12-16, D12-18, D12-22)
-- ===========================================================================

CREATE FUNCTION public.denunciar(p_alvo_tipo text, p_alvo_id uuid, p_categoria text, p_descricao text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_alvo_tipo, p_alvo_id, p_categoria, p_descricao));
  anterior jsonb;
  v_empresa uuid;
  v_autor text;
  v_desc text := nullif(btrim(coalesce(p_descricao, '')), '');
  av public.avaliacoes;
  rs public.respostas_avaliacao;
  acesso jsonb;
  item_em timestamptz;
  d public.denuncias;
  lim integer := app_private.limite('denuncias_por_dia');
  nao_achado text := 'Não encontramos o conteúdo denunciado.';
BEGIN
  anterior := app_private.idem_inicio(usuario, 'denunciar', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  IF p_categoria IS NULL OR p_categoria NOT IN ('ofensivo', 'falso', 'dado_pessoal', 'spam', 'golpe', 'outro') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha o motivo da denúncia.', 'categoria');
  END IF;
  IF char_length(v_desc) > 1000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A descrição vai até 1.000 caracteres.', 'descricao');
  END IF;
  IF p_categoria = 'outro' AND coalesce(char_length(v_desc), 0) < 10 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Descreva o problema (pelo menos 10 caracteres).', 'descricao');
  END IF;
  IF p_alvo_tipo = 'empresa' THEN
    IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = p_alvo_id) OR NOT app_private.empresa_visivel_para(p_alvo_id, usuario) THEN
      PERFORM app_private.erro('NOT_FOUND', nao_achado);
    END IF;
    v_empresa := p_alvo_id;
  ELSIF p_alvo_tipo = 'avaliacao' THEN
    SELECT * INTO av FROM public.avaliacoes WHERE id = p_alvo_id;
    IF NOT FOUND OR av.estado <> 'publicada' OR app_private.conteudo_oculto('avaliacao', av.id)
       OR NOT app_private.empresa_visivel_para(av.empresa_id, usuario) THEN
      PERFORM app_private.erro('NOT_FOUND', nao_achado);
    END IF;
    v_empresa := av.empresa_id; v_autor := av.cliente_auth_id;
  ELSIF p_alvo_tipo = 'resposta' THEN
    SELECT * INTO rs FROM public.respostas_avaliacao WHERE id = p_alvo_id;
    SELECT * INTO av FROM public.avaliacoes WHERE id = rs.avaliacao_id;
    IF rs.id IS NULL OR rs.estado <> 'publicada' OR app_private.conteudo_oculto('resposta', rs.id)
       OR av.estado <> 'publicada' OR app_private.conteudo_oculto('avaliacao', av.id)
       OR NOT app_private.empresa_visivel_para(rs.empresa_id, usuario) THEN
      PERFORM app_private.erro('NOT_FOUND', nao_achado);
    END IF;
    v_empresa := rs.empresa_id; v_autor := rs.autor_auth_id;
  ELSIF p_alvo_tipo IN ('mensagem', 'mensagem_m08', 'atualizacao_os') THEN
    -- Só participante da conversa, e só o que ele já podia ver (a denúncia não amplia acesso). Sem acesso, a mesma
    -- resposta de conteúdo inexistente (não revela se o atendimento existe).
    BEGIN
    IF p_alvo_tipo = 'mensagem' THEN
      SELECT CASE WHEN m.solicitacao_id IS NOT NULL THEN app_private.conversa_acesso('solicitacao', m.solicitacao_id, usuario)
                  ELSE app_private.conversa_acesso('pedido', m.pedido_id, usuario) END, m.criado_em, m.autor_auth_id
        INTO acesso, item_em, v_autor FROM public.mensagens_atendimento m WHERE m.id = p_alvo_id;
    ELSIF p_alvo_tipo = 'mensagem_m08' THEN
      SELECT app_private.conversa_acesso('solicitacao', e.solicitacao_id, usuario), e.criado_em, e.autor_auth_id
        INTO acesso, item_em, v_autor FROM public.solicitacao_eventos e WHERE e.id = p_alvo_id AND e.tipo = 'mensagem' AND e.visivel_cliente;
    ELSE
      SELECT app_private.conversa_acesso('os', e.os_id, usuario), e.criado_em, e.autor_auth_id
        INTO acesso, item_em, v_autor FROM public.os_eventos e WHERE e.id = p_alvo_id AND e.tipo = 'atualizacao' AND e.publico;
      IF acesso IS NOT NULL AND NOT coalesce((acesso->>'ve_os')::boolean, false) THEN
        acesso := NULL;
      END IF;
    END IF;
    EXCEPTION WHEN OTHERS THEN
      acesso := NULL;
    END;
    IF acesso IS NULL OR (acesso->>'desde' IS NOT NULL AND item_em < (acesso->>'desde')::timestamptz)
       OR app_private.conteudo_oculto(p_alvo_tipo, p_alvo_id) THEN
      PERFORM app_private.erro('NOT_FOUND', nao_achado);
    END IF;
    v_empresa := (acesso->>'empresa_id')::uuid;
  ELSE
    PERFORM app_private.erro('VALIDATION_ERROR', 'Tipo de conteúdo inválido.', 'alvo_tipo');
  END IF;
  IF v_autor IS NOT NULL AND v_autor = usuario THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Você não pode denunciar o próprio conteúdo.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('m12-denuncia|' || usuario, 0));
  IF EXISTS (SELECT 1 FROM public.denuncias WHERE denunciante_auth_id = usuario AND alvo_tipo = p_alvo_tipo
              AND alvo_id = p_alvo_id AND estado <> 'resolvida') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Você já denunciou este conteúdo; a análise está em andamento.');
  END IF;
  IF (SELECT count(*) FROM public.denuncias WHERE denunciante_auth_id = usuario
        AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = app_private.hoje_sp()) >= lim THEN
    PERFORM app_private.erro('STATE_CONFLICT', format('Limite de %s denúncias por dia atingido. Tente amanhã.', lim));
  END IF;
  INSERT INTO public.denuncias (alvo_tipo, alvo_id, empresa_id, autor_auth_id, denunciante_auth_id, categoria, descricao)
  VALUES (p_alvo_tipo, p_alvo_id, v_empresa, v_autor, usuario, p_categoria, v_desc) RETURNING * INTO d;
  PERFORM app_private.auditar(v_empresa, usuario, 'moderacao.denuncia_aberta', 'denuncias', d.id,
    jsonb_build_object('alvo_tipo', d.alvo_tipo, 'categoria', d.categoria));
  RETURN app_private.idem_fim(usuario, 'denunciar', p_operation_key, assinatura,
    jsonb_build_object('protocolo', d.protocolo, 'estado', d.estado, 'alvo_tipo', d.alvo_tipo, 'criado_em', d.criado_em));
END $$;

-- Denúncias da própria conta: estado e resultado genérico (nunca o conteúdo de terceiros nem a decisão interna).
CREATE FUNCTION public.minhas_denuncias() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('protocolo', d.protocolo, 'alvo_tipo', d.alvo_tipo, 'categoria', d.categoria,
      'estado', d.estado, 'criado_em', d.criado_em, 'resolvida_em', d.resolvida_em,
      'resultado', CASE WHEN d.estado = 'resolvida' THEN
        CASE (SELECT x.medida FROM public.decisoes_moderacao x WHERE x.id = d.decisao_id)
          WHEN 'arquivar' THEN 'Analisada: nenhuma medida foi necessária.'
          ELSE 'Analisada: a CK tomou as medidas cabíveis.' END END) ORDER BY d.criado_em DESC)
    FROM public.denuncias d WHERE d.denunciante_auth_id = usuario), '[]'::jsonb);
END $$;

CREATE FUNCTION public.contestar_moderacao(p_decisao_id uuid, p_motivo text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_decisao_id, p_motivo));
  anterior jsonb;
  d public.decisoes_moderacao;
  c public.contestacoes_moderacao;
  v_motivo text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'contestar_moderacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO d FROM public.decisoes_moderacao WHERE id = p_decisao_id;
  -- Só a parte afetada (autor do conteúdo) contesta; para os demais a decisão não existe.
  IF NOT FOUND OR d.medida NOT IN ('ocultar', 'recusar') OR app_private.autor_do_conteudo(d.alvo_tipo, d.alvo_id) IS DISTINCT FROM usuario THEN
    PERFORM app_private.erro('NOT_FOUND', 'Decisão não encontrada.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('m12-contestacao|' || d.id::text, 0));
  IF EXISTS (SELECT 1 FROM public.contestacoes_moderacao WHERE decisao_id = d.id) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta decisão já foi contestada (uma contestação por decisão).');
  END IF;
  v_motivo := app_private.ler_texto(p_motivo, 10, 1000, 'motivo', 'Explique a contestação (10 a 1.000 caracteres).');
  INSERT INTO public.contestacoes_moderacao (decisao_id, autor_auth_id, motivo) VALUES (d.id, usuario, v_motivo) RETURNING * INTO c;
  PERFORM app_private.auditar(d.empresa_id, usuario, 'moderacao.contestacao_aberta', 'contestacoes_moderacao', c.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'contestar_moderacao', p_operation_key, assinatura,
    jsonb_build_object('id', c.id, 'estado', c.estado, 'criado_em', c.criado_em));
END $$;

-- ===========================================================================
-- 6. Funções da CK (RF-166, RF-172; D12-11, D12-12, D12-17, D12-18, D12-22)
-- ===========================================================================

CREATE FUNCTION public.ck_fila_moderacao() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_ck(usuario);
  RETURN jsonb_build_object(
    'avaliacoes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'empresa', app_private.nome_aprovado(a.empresa_id),
        'conteudo', app_private.conteudo_para_ck('avaliacao', a.id),
        'impedimento', app_private.impedimento_ck(usuario, a.empresa_id, a.cliente_auth_id, NULL)) ORDER BY a.criado_em)
      FROM public.avaliacoes a WHERE a.estado = 'aguardando'), '[]'::jsonb),
    'respostas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'empresa', app_private.nome_aprovado(r.empresa_id),
        'conteudo', app_private.conteudo_para_ck('resposta', r.id),
        'impedimento', app_private.impedimento_ck(usuario, r.empresa_id, r.autor_auth_id, NULL)) ORDER BY r.criado_em)
      FROM public.respostas_avaliacao r WHERE r.estado = 'aguardando'), '[]'::jsonb),
    'denuncias', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'protocolo', d.protocolo, 'alvo_tipo', d.alvo_tipo,
        'empresa_id', d.empresa_id, 'empresa', app_private.nome_aprovado(d.empresa_id), 'categoria', d.categoria,
        'descricao', d.descricao, 'estado', d.estado, 'criado_em', d.criado_em,
        'assumida_por_mim', d.assumida_por = usuario, 'assumida', d.assumida_por IS NOT NULL,
        'conteudo', app_private.conteudo_para_ck(d.alvo_tipo, d.alvo_id),
        'impedimento', app_private.impedimento_ck(usuario, d.empresa_id, d.autor_auth_id, d.denunciante_auth_id)) ORDER BY d.criado_em)
      FROM public.denuncias d WHERE d.estado <> 'resolvida'), '[]'::jsonb),
    'contestacoes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'estado', c.estado, 'motivo', c.motivo, 'criado_em', c.criado_em,
        'empresa', app_private.nome_aprovado(dm.empresa_id), 'alvo_tipo', dm.alvo_tipo,
        'decisao', jsonb_build_object('medida', dm.medida, 'motivo', dm.motivo_resumo, 'justificativa', dm.justificativa,
          'decidida_por_mim', dm.decidido_por = usuario, 'data', dm.criado_em),
        'conteudo', app_private.conteudo_para_ck(dm.alvo_tipo, dm.alvo_id),
        'assumida_por_mim', c.assumida_por = usuario, 'assumida', c.assumida_por IS NOT NULL,
        'impedimento', app_private.impedimento_contestacao(usuario, c.id)) ORDER BY c.criado_em)
      FROM public.contestacoes_moderacao c JOIN public.decisoes_moderacao dm ON dm.id = c.decisao_id
     WHERE c.estado <> 'decidida'), '[]'::jsonb));
END $$;

CREATE FUNCTION public.ck_assumir_denuncia(p_denuncia_id uuid, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(p_denuncia_id::text);
  anterior jsonb;
  d public.denuncias;
  imp text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'ck_assumir_denuncia', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_ck(usuario);
  SELECT * INTO d FROM public.denuncias WHERE id = p_denuncia_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Denúncia não encontrada.');
  END IF;
  imp := app_private.impedimento_ck(usuario, d.empresa_id, d.autor_auth_id, d.denunciante_auth_id);
  IF imp IS NOT NULL THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', imp);
  END IF;
  IF d.estado <> 'aberta' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta denúncia já está em análise ou resolvida.');
  END IF;
  UPDATE public.denuncias SET estado = 'em_analise', assumida_por = usuario, assumida_em = now() WHERE id = d.id;
  PERFORM app_private.auditar(d.empresa_id, usuario, 'moderacao.denuncia_assumida', 'denuncias', d.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'ck_assumir_denuncia', p_operation_key, assinatura, jsonb_build_object('id', d.id, 'estado', 'em_analise'));
END $$;

-- Medidas sobre denúncia: arquivar, ocultar (conteúdo) ou encaminhar à suspensão (empresa; a suspensão em si continua sendo
-- feita pelo fluxo existente ck_suspender_vitrine, com as regras do M10 e do M11).
CREATE FUNCTION public.ck_decidir_denuncia(p_denuncia_id uuid, p_medida text, p_motivo_resumo text, p_justificativa text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_denuncia_id, p_medida, p_motivo_resumo, p_justificativa));
  anterior jsonb;
  d public.denuncias;
  dm public.decisoes_moderacao;
  imp text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'ck_decidir_denuncia', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_ck(usuario);
  SELECT * INTO d FROM public.denuncias WHERE id = p_denuncia_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Denúncia não encontrada.');
  END IF;
  imp := app_private.impedimento_ck(usuario, d.empresa_id, d.autor_auth_id, d.denunciante_auth_id);
  IF imp IS NOT NULL THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', imp);
  END IF;
  IF d.estado <> 'em_analise' OR d.assumida_por IS DISTINCT FROM usuario THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Assuma a denúncia antes de decidir.');
  END IF;
  IF p_medida IS NULL OR (d.alvo_tipo = 'empresa' AND p_medida NOT IN ('arquivar', 'encaminhar_suspensao'))
     OR (d.alvo_tipo <> 'empresa' AND p_medida NOT IN ('arquivar', 'ocultar')) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Medida inválida para este conteúdo.', 'medida');
  END IF;
  IF p_motivo_resumo IS NULL OR char_length(btrim(p_motivo_resumo)) NOT BETWEEN 10 AND 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escreva o motivo resumido para as partes (10 a 300 caracteres).', 'motivo_resumo');
  END IF;
  IF p_justificativa IS NULL OR char_length(btrim(p_justificativa)) NOT BETWEEN 20 AND 2000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Justifique a decisão (20 a 2.000 caracteres).', 'justificativa');
  END IF;
  INSERT INTO public.decisoes_moderacao (alvo_tipo, alvo_id, empresa_id, denuncia_id, medida, motivo_resumo, justificativa, decidido_por)
  VALUES (d.alvo_tipo, d.alvo_id, d.empresa_id, d.id, p_medida, btrim(p_motivo_resumo), btrim(p_justificativa), usuario)
  RETURNING * INTO dm;
  IF p_medida = 'ocultar' THEN
    INSERT INTO public.conteudos_moderados (alvo_tipo, alvo_id, oculto, decisao_id) VALUES (d.alvo_tipo, d.alvo_id, true, dm.id)
    ON CONFLICT (alvo_tipo, alvo_id) DO UPDATE SET oculto = true, decisao_id = EXCLUDED.decisao_id, atualizado_em = now();
  END IF;
  UPDATE public.denuncias SET estado = 'resolvida', resolvida_em = now(), decisao_id = dm.id WHERE id = d.id;
  PERFORM app_private.auditar(d.empresa_id, usuario, 'moderacao.denuncia_decidida', 'decisoes_moderacao', dm.id,
    jsonb_build_object('medida', dm.medida, 'alvo_tipo', dm.alvo_tipo));
  RETURN app_private.idem_fim(usuario, 'ck_decidir_denuncia', p_operation_key, assinatura,
    jsonb_build_object('decisao_id', dm.id, 'medida', dm.medida, 'empresa_id', d.empresa_id));
END $$;

-- Pré-moderação de avaliação e resposta (D12-11, D12-12).
CREATE FUNCTION public.ck_moderar_publicacao(p_alvo_tipo text, p_alvo_id uuid, p_medida text, p_motivo_resumo text, p_justificativa text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_alvo_tipo, p_alvo_id, p_medida, p_motivo_resumo, p_justificativa));
  anterior jsonb;
  av public.avaliacoes;
  rs public.respostas_avaliacao;
  v_empresa uuid;
  v_autor text;
  v_estado text;
  dm public.decisoes_moderacao;
  imp text;
  v_motivo text := nullif(btrim(coalesce(p_motivo_resumo, '')), '');
  v_just text := nullif(btrim(coalesce(p_justificativa, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'ck_moderar_publicacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_ck(usuario);
  IF p_alvo_tipo = 'avaliacao' THEN
    SELECT * INTO av FROM public.avaliacoes WHERE id = p_alvo_id FOR UPDATE;
    v_empresa := av.empresa_id; v_autor := av.cliente_auth_id; v_estado := av.estado;
  ELSIF p_alvo_tipo = 'resposta' THEN
    SELECT * INTO rs FROM public.respostas_avaliacao WHERE id = p_alvo_id FOR UPDATE;
    v_empresa := rs.empresa_id; v_autor := rs.autor_auth_id; v_estado := rs.estado;
  ELSE
    PERFORM app_private.erro('VALIDATION_ERROR', 'Tipo de conteúdo inválido.', 'alvo_tipo');
  END IF;
  IF v_empresa IS NULL THEN
    PERFORM app_private.erro('NOT_FOUND', 'Conteúdo não encontrado.');
  END IF;
  imp := app_private.impedimento_ck(usuario, v_empresa, v_autor, NULL);
  IF imp IS NOT NULL THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', imp);
  END IF;
  IF v_estado <> 'aguardando' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este conteúdo já foi analisado.');
  END IF;
  IF p_medida IS NULL OR p_medida NOT IN ('aprovar', 'recusar') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha aprovar ou recusar.', 'medida');
  END IF;
  IF p_medida = 'recusar' AND (v_motivo IS NULL OR char_length(v_motivo) NOT BETWEEN 10 AND 300) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escreva o motivo resumido da recusa (10 a 300 caracteres).', 'motivo_resumo');
  END IF;
  IF p_medida = 'recusar' AND (v_just IS NULL OR char_length(v_just) NOT BETWEEN 20 AND 2000) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Justifique a recusa (20 a 2.000 caracteres).', 'justificativa');
  END IF;
  IF v_motivo IS NOT NULL AND char_length(v_motivo) NOT BETWEEN 10 AND 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O motivo resumido tem de 10 a 300 caracteres.', 'motivo_resumo');
  END IF;
  IF v_just IS NOT NULL AND char_length(v_just) NOT BETWEEN 20 AND 2000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A justificativa tem de 20 a 2.000 caracteres.', 'justificativa');
  END IF;
  INSERT INTO public.decisoes_moderacao (alvo_tipo, alvo_id, empresa_id, medida, motivo_resumo, justificativa, decidido_por)
  VALUES (p_alvo_tipo, p_alvo_id, v_empresa, p_medida, v_motivo, v_just, usuario) RETURNING * INTO dm;
  IF p_alvo_tipo = 'avaliacao' THEN
    UPDATE public.avaliacoes SET estado = CASE WHEN p_medida = 'aprovar' THEN 'publicada' ELSE 'recusada' END,
      publicada_em = CASE WHEN p_medida = 'aprovar' THEN now() END WHERE id = p_alvo_id;
  ELSE
    UPDATE public.respostas_avaliacao SET estado = CASE WHEN p_medida = 'aprovar' THEN 'publicada' ELSE 'recusada' END,
      publicada_em = CASE WHEN p_medida = 'aprovar' THEN now() END WHERE id = p_alvo_id;
  END IF;
  PERFORM app_private.auditar(v_empresa, usuario, 'moderacao.publicacao_decidida', 'decisoes_moderacao', dm.id,
    jsonb_build_object('medida', dm.medida, 'alvo_tipo', dm.alvo_tipo));
  RETURN app_private.idem_fim(usuario, 'ck_moderar_publicacao', p_operation_key, assinatura,
    jsonb_build_object('decisao_id', dm.id, 'medida', dm.medida));
END $$;

-- D12-22 com exceção para administrador único: outra pessoa da CK decide a contestação quando houver alguém elegível
-- (CK ativa, sem impedimento e diferente de quem tomou a decisão original). Sem ninguém elegível, a mesma pessoa pode
-- decidir, com justificativa e registro explícito (mesmo_decisor). Os demais impedimentos continuam valendo.
CREATE FUNCTION app_private.impedimento_contestacao(p_usuario text, p_contestacao_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  c public.contestacoes_moderacao;
  dm public.decisoes_moderacao;
  v_autor text;
  v_denunciante text;
  imp text;
BEGIN
  SELECT * INTO c FROM public.contestacoes_moderacao WHERE id = p_contestacao_id;
  SELECT * INTO dm FROM public.decisoes_moderacao WHERE id = c.decisao_id;
  v_autor := app_private.autor_do_conteudo(dm.alvo_tipo, dm.alvo_id);
  v_denunciante := (SELECT denunciante_auth_id FROM public.denuncias WHERE id = dm.denuncia_id);
  imp := app_private.impedimento_ck(p_usuario, dm.empresa_id, v_autor, v_denunciante);
  IF imp IS NOT NULL THEN RETURN imp; END IF;
  IF dm.decidido_por = p_usuario AND EXISTS (
       SELECT 1 FROM app_private.administradores_ck a
        WHERE a.ativo AND a.auth_user_id <> p_usuario
          AND app_private.impedimento_ck(a.auth_user_id, dm.empresa_id, v_autor, v_denunciante) IS NULL) THEN
    RETURN 'Outra pessoa da CK precisa decidir esta contestação, porque você tomou a decisão original.';
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.ck_assumir_contestacao_moderacao(p_contestacao_id uuid, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(p_contestacao_id::text);
  anterior jsonb;
  c public.contestacoes_moderacao;
  imp text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'ck_assumir_contestacao_moderacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_ck(usuario);
  SELECT * INTO c FROM public.contestacoes_moderacao WHERE id = p_contestacao_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Contestação não encontrada.');
  END IF;
  imp := app_private.impedimento_contestacao(usuario, c.id);
  IF imp IS NOT NULL THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', imp);
  END IF;
  IF c.estado <> 'aberta' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta contestação já está em revisão ou decidida.');
  END IF;
  UPDATE public.contestacoes_moderacao SET estado = 'em_revisao', assumida_por = usuario WHERE id = c.id;
  PERFORM app_private.auditar((SELECT empresa_id FROM public.decisoes_moderacao WHERE id = c.decisao_id), usuario,
    'moderacao.contestacao_assumida', 'contestacoes_moderacao', c.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'ck_assumir_contestacao_moderacao', p_operation_key, assinatura,
    jsonb_build_object('id', c.id, 'estado', 'em_revisao'));
END $$;

CREATE FUNCTION public.ck_decidir_contestacao_moderacao(p_contestacao_id uuid, p_medida text, p_motivo_resumo text, p_justificativa text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_contestacao_id, p_medida, p_motivo_resumo, p_justificativa));
  anterior jsonb;
  c public.contestacoes_moderacao;
  orig public.decisoes_moderacao;
  dm public.decisoes_moderacao;
  imp text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'ck_decidir_contestacao_moderacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_ck(usuario);
  SELECT * INTO c FROM public.contestacoes_moderacao WHERE id = p_contestacao_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Contestação não encontrada.');
  END IF;
  imp := app_private.impedimento_contestacao(usuario, c.id);
  IF imp IS NOT NULL THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', imp);
  END IF;
  IF c.estado <> 'em_revisao' OR c.assumida_por IS DISTINCT FROM usuario THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Assuma a contestação antes de decidir.');
  END IF;
  IF p_medida IS NULL OR p_medida NOT IN ('restaurar', 'manter') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha restaurar ou manter a decisão.', 'medida');
  END IF;
  IF p_motivo_resumo IS NULL OR char_length(btrim(p_motivo_resumo)) NOT BETWEEN 10 AND 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escreva o motivo resumido para a parte (10 a 300 caracteres).', 'motivo_resumo');
  END IF;
  IF p_justificativa IS NULL OR char_length(btrim(p_justificativa)) NOT BETWEEN 20 AND 2000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Justifique a decisão (20 a 2.000 caracteres).', 'justificativa');
  END IF;
  SELECT * INTO orig FROM public.decisoes_moderacao WHERE id = c.decisao_id;
  INSERT INTO public.decisoes_moderacao (alvo_tipo, alvo_id, empresa_id, contestacao_id, medida, motivo_resumo, justificativa,
    decidido_por, mesmo_decisor)
  VALUES (orig.alvo_tipo, orig.alvo_id, orig.empresa_id, c.id, p_medida, btrim(p_motivo_resumo), btrim(p_justificativa),
    usuario, orig.decidido_por = usuario)
  RETURNING * INTO dm;
  IF p_medida = 'restaurar' THEN
    IF orig.medida = 'ocultar' THEN
      UPDATE public.conteudos_moderados SET oculto = false, decisao_id = dm.id, atualizado_em = now()
       WHERE alvo_tipo = orig.alvo_tipo AND alvo_id = orig.alvo_id;
    ELSIF orig.alvo_tipo = 'avaliacao' THEN
      UPDATE public.avaliacoes SET estado = 'publicada', publicada_em = now() WHERE id = orig.alvo_id AND estado = 'recusada';
    ELSIF orig.alvo_tipo = 'resposta' THEN
      UPDATE public.respostas_avaliacao SET estado = 'publicada', publicada_em = now() WHERE id = orig.alvo_id AND estado = 'recusada';
    END IF;
  END IF;
  UPDATE public.contestacoes_moderacao SET estado = 'decidida', decisao_final_id = dm.id, decidida_em = now() WHERE id = c.id;
  PERFORM app_private.auditar(orig.empresa_id, usuario, 'moderacao.contestacao_decidida', 'decisoes_moderacao', dm.id,
    jsonb_build_object('medida', dm.medida, 'mesmo_decisor', dm.mesmo_decisor));
  RETURN app_private.idem_fim(usuario, 'ck_decidir_contestacao_moderacao', p_operation_key, assinatura,
    jsonb_build_object('decisao_id', dm.id, 'medida', dm.medida, 'mesmo_decisor', dm.mesmo_decisor));
END $$;

-- ===========================================================================
-- 7. Funções existentes ajustadas
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.registrar_mensagem(p_solicitacao_id uuid, p_texto text, p_interna boolean, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_texto, p_interna));
  anterior jsonb;
  s public.solicitacoes_servico;
  papel text;
  v_texto text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_mensagem', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.solicitacao_trava(p_solicitacao_id);
  papel := app_private.papel_na_solicitacao(s, usuario, 'orcamentos.criar');
  IF papel = 'cliente' AND coalesce(p_interna, false) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Notas internas são só da empresa.');
  END IF;
  v_texto := app_private.ler_texto(p_texto, 1, 1000, 'texto', 'Escreva a mensagem (até 1.000 caracteres).');
  IF NOT coalesce(p_interna, false) AND s.estado IN ('recusada', 'cancelada') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta solicitação está encerrada.');
  END IF;
  IF coalesce(p_interna, false) THEN
    PERFORM app_private.evento_solicitacao(s, 'nota_interna', papel, usuario, v_texto, '{}'::jsonb, false);
  ELSE
    -- M12 (D12-02 = A): mensagem nova no registro da conversa do atendimento.
    PERFORM app_private.gravar_mensagem('solicitacao', s.id, usuario, v_texto);
  END IF;
  RETURN app_private.idem_fim(usuario, 'registrar_mensagem', p_operation_key, assinatura,
    app_private.solicitacao_json(s.id, papel = 'cliente'));
END $$;

CREATE OR REPLACE FUNCTION app_private.vitrine_do_conjunto(p_conjunto text, p_empresa_id uuid, p_logado boolean) RETURNS jsonb
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
    'sem_itens', jsonb_array_length(v_servicos) = 0 AND jsonb_array_length(v_produtos) = 0,
    'avaliacoes', app_private.avaliacoes_vitrine(c.empresa_id, p_conjunto))
    || CASE WHEN p_logado THEN jsonb_build_object('contatos', jsonb_strip_nulls(jsonb_build_object(
         'telefone_publico', nullif(c.telefone_publico, ''), 'whatsapp_publico', nullif(c.whatsapp_publico, ''), 'email_publico', nullif(c.email_publico, ''))))
       ELSE '{}'::jsonb END;
END $$;

-- ===========================================================================
-- 8. Privilégios
-- ===========================================================================
ALTER TABLE public.mensagens_atendimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avaliacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.respostas_avaliacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.denuncias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decisoes_moderacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conteudos_moderados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contestacoes_moderacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mensagens_atendimento, public.avaliacoes, public.respostas_avaliacao, public.denuncias, public.decisoes_moderacao, public.conteudos_moderados, public.contestacoes_moderacao FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.conversa_atendimento(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conversa_atendimento(text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.enviar_mensagem(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enviar_mensagem(text, uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.minha_avaliacao_os(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.minha_avaliacao_os(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.avaliar_os(uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.avaliar_os(uuid, integer, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.retirar_avaliacao(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retirar_avaliacao(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.avaliacoes_da_empresa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.avaliacoes_da_empresa(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.responder_avaliacao(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.responder_avaliacao(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.denunciar(text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denunciar(text, uuid, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.minhas_denuncias() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.minhas_denuncias() TO authenticated;
REVOKE ALL ON FUNCTION public.contestar_moderacao(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contestar_moderacao(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.ck_fila_moderacao() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ck_fila_moderacao() TO authenticated;
REVOKE ALL ON FUNCTION public.ck_assumir_denuncia(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ck_assumir_denuncia(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.ck_decidir_denuncia(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ck_decidir_denuncia(uuid, text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.ck_moderar_publicacao(text, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ck_moderar_publicacao(text, uuid, text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.ck_assumir_contestacao_moderacao(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ck_assumir_contestacao_moderacao(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.ck_decidir_contestacao_moderacao(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ck_decidir_contestacao_moderacao(uuid, text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION app_private.conteudo_oculto(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.mes_ano(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.conversa_acesso(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.moderacao_para_parte(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.itens_conversa(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.gravar_mensagem(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.empresa_visivel_para(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.autor_do_conteudo(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.conteudo_para_ck(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.exigir_ck(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.impedimento_ck(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.avaliacao_do_cliente(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.avaliacoes_vitrine(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.impedimento_contestacao(text, uuid) FROM PUBLIC;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611170001', 'M12: conversa por atendimento (solicitação e OS compartilham; pedido tem a sua) com leitura unificada sem cópia e sem notas internas; avaliação verificada de OS encerrada com pré-moderação e resposta única; denúncia com exposição mínima, fila da CK, ocultação (D12-18 = C), registro imutável e contestação (D12-22); limites 50 mensagens e 10 denúncias por dia; sem permissão nem função anônima nova');

COMMIT;
