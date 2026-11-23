-- 202611180001_painel_mensagens: M13b (ADR-G13b D13b-09 = A e D13b-10 = A).
-- 1) painel_empresa: leitura agregada dos indicadores do painel Business, cada bloco só com a permissão correspondente.
-- 2) Marcador de novas mensagens: "lido até" por participante e conversa (tabela fechada, acesso só por função).
-- Nenhuma permissão nova no catálogo; nenhuma função para o papel anônimo; nada muda nas tabelas existentes.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Estado de leitura por participante e conversa (D13b-10 = A)
-- ---------------------------------------------------------------------------
CREATE TABLE public.leituras_conversa (
  auth_user_id  text NOT NULL,
  conversa_tipo text NOT NULL CHECK (conversa_tipo IN ('solicitacao', 'pedido')),
  conversa_id   uuid NOT NULL,
  lido_ate      timestamptz NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (auth_user_id, conversa_tipo, conversa_id)
);
ALTER TABLE public.leituras_conversa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leituras_conversa FROM PUBLIC, anonymous, authenticated;

-- Mensagens novas (do outro lado da conversa) para uma pessoa: como cliente (p_empresa NULL) ou como equipe de uma empresa.
-- Conta só mensagens do M12 (mensagens_atendimento) não ocultadas pela moderação, depois do "lido até" da pessoa.
-- Na equipe, respeita a mesma regra de leitura da conversa (conversa_acesso): orçamentos ou, para OS, serviços desde o aceite;
-- pedidos com pedidos.visualizar.
CREATE FUNCTION app_private.mensagens_novas_de(p_usuario text, p_empresa uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  perms text[];
  v jsonb;
BEGIN
  IF p_empresa IS NOT NULL THEN
    perms := app_private.permissoes_de(p_empresa, p_usuario);
  END IF;
  WITH conversas AS (
    -- Cliente: solicitações (com ou sem OS) e pedidos de que é titular
    SELECT 'solicitacao'::text AS tipo, s.id, o.id AS os_id, s.empresa_id,
           CASE WHEN o.id IS NOT NULL THEN format('OS nº %s · %s', o.numero, s.servico_nome) ELSE format('Solicitação nº %s · %s', s.numero, s.servico_nome) END AS rotulo,
           'empresa'::text AS autor_outro, NULL::timestamptz AS desde
      FROM public.solicitacoes_servico s LEFT JOIN public.ordens_servico o ON o.solicitacao_id = s.id
     WHERE p_empresa IS NULL AND s.origem = 'plataforma' AND s.cliente_auth_id = p_usuario
    UNION ALL
    SELECT 'pedido', p.id, NULL, p.empresa_id, format('Pedido de %s', to_char(p.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')), 'empresa', NULL
      FROM public.pedidos p
     WHERE p_empresa IS NULL AND p.cliente_auth_id = p_usuario
    UNION ALL
    -- Equipe: só o que a pessoa pode ler nesta empresa
    SELECT 'solicitacao', s.id, o.id, s.empresa_id,
           CASE WHEN o.id IS NOT NULL THEN format('OS nº %s · %s', o.numero, s.cliente_nome) ELSE format('Solicitação nº %s · %s', s.numero, s.cliente_nome) END,
           'cliente',
           CASE WHEN 'orcamentos.visualizar' = ANY (perms) THEN NULL ELSE o.aceita_em END
      FROM public.solicitacoes_servico s LEFT JOIN public.ordens_servico o ON o.solicitacao_id = s.id
     WHERE p_empresa IS NOT NULL AND s.empresa_id = p_empresa AND s.origem = 'plataforma'
       AND ('orcamentos.visualizar' = ANY (perms) OR (o.id IS NOT NULL AND 'servicos.visualizar' = ANY (perms)))
    UNION ALL
    SELECT 'pedido', p.id, NULL, p.empresa_id, format('Pedido de %s · %s', to_char(p.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'), p.cliente_nome), 'cliente', NULL
      FROM public.pedidos p
     WHERE p_empresa IS NOT NULL AND p.empresa_id = p_empresa AND p.cliente_auth_id IS NOT NULL AND 'pedidos.visualizar' = ANY (perms)
  ), contagem AS (
    SELECT c.tipo, c.id, c.os_id, c.empresa_id, c.rotulo, count(m.id) AS novas, max(m.criado_em) AS ultima_em
      FROM conversas c
      LEFT JOIN public.leituras_conversa l ON l.auth_user_id = p_usuario AND l.conversa_tipo = c.tipo AND l.conversa_id = c.id
      JOIN public.mensagens_atendimento m
        ON (CASE WHEN c.tipo = 'solicitacao' THEN m.solicitacao_id ELSE m.pedido_id END) = c.id
       AND m.autor_papel = c.autor_outro
       AND m.criado_em > coalesce(l.lido_ate, '-infinity'::timestamptz)
       AND (c.desde IS NULL OR m.criado_em >= c.desde)
       AND NOT app_private.conteudo_oculto('mensagem', m.id)
     GROUP BY c.tipo, c.id, c.os_id, c.empresa_id, c.rotulo
  )
  SELECT jsonb_build_object(
           'total', coalesce(sum(novas), 0),
           'conversas', coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'id', id, 'os_id', os_id, 'empresa_id', empresa_id,
             'empresa', (SELECT e.nome_publico FROM public.empresas e WHERE e.id = contagem.empresa_id),
             'rotulo', rotulo, 'novas', novas, 'ultima_em', ultima_em) ORDER BY ultima_em DESC), '[]'::jsonb))
    INTO v FROM (SELECT * FROM contagem ORDER BY ultima_em DESC LIMIT 50) contagem;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION app_private.mensagens_novas_de(text, uuid) FROM PUBLIC;

-- Lista para a pessoa logada: como cliente (sem empresa) ou como equipe da empresa informada.
CREATE FUNCTION public.mensagens_novas(p_empresa_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  IF p_empresa_id IS NOT NULL AND NOT app_private.eh_membro(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  RETURN app_private.mensagens_novas_de(usuario, p_empresa_id);
END $$;

-- Marca a conversa como lida até o último item que a pessoa viu (nunca no futuro, nunca para trás).
-- O acesso é conferido pela mesma regra da conversa (conversa_acesso). Repetir não muda nada além do horário.
CREATE FUNCTION public.marcar_conversa_lida(p_tipo text, p_id uuid, p_ate timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  a jsonb := app_private.conversa_acesso(p_tipo, p_id, usuario);
  v_tipo text := a->>'tipo';
  v_id uuid := coalesce((a->>'solicitacao_id')::uuid, (a->>'pedido_id')::uuid);
  v_ate timestamptz := least(coalesce(p_ate, clock_timestamp()), clock_timestamp());
  v_final timestamptz;
BEGIN
  INSERT INTO public.leituras_conversa AS l (auth_user_id, conversa_tipo, conversa_id, lido_ate)
  VALUES (usuario, v_tipo, v_id, v_ate)
  ON CONFLICT (auth_user_id, conversa_tipo, conversa_id)
  DO UPDATE SET lido_ate = greatest(l.lido_ate, excluded.lido_ate), atualizado_em = clock_timestamp()
  RETURNING lido_ate INTO v_final;
  RETURN jsonb_build_object('tipo', v_tipo, 'id', v_id, 'lido_ate', v_final);
END $$;

-- ---------------------------------------------------------------------------
-- 2. Painel Business (D13b-09 = A): uma leitura, cada bloco só com a permissão correspondente
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.painel_empresa(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  perms text[];
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  inicio_mes date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  e public.empresas;
  v_pedidos jsonb; v_orc jsonb; v_os jsonb; v_vendas jsonb; v_fin jsonb; v_estoque jsonb; v_agenda jsonb; v_msg jsonb;
BEGIN
  IF NOT app_private.eh_membro(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  perms := app_private.permissoes_de(p_empresa_id, usuario);
  SELECT * INTO e FROM public.empresas WHERE id = p_empresa_id;

  IF 'pedidos.visualizar' = ANY (perms) THEN
    SELECT jsonb_build_object('aguardando', count(*),
             'ultimos', coalesce((SELECT jsonb_agg(x ORDER BY x->>'criado_em' DESC) FROM (
               SELECT jsonb_build_object('id', p.id, 'cliente_nome', p.cliente_nome, 'total_estimado_centavos', app_private.para_centavos(p.total_estimado),
                 'criado_em', p.criado_em) AS x
                 FROM public.pedidos p WHERE p.empresa_id = p_empresa_id AND p.estado = 'solicitado' ORDER BY p.criado_em DESC LIMIT 3) t), '[]'::jsonb))
      INTO v_pedidos FROM public.pedidos WHERE empresa_id = p_empresa_id AND estado = 'solicitado';
  END IF;

  IF 'orcamentos.visualizar' = ANY (perms) THEN
    SELECT jsonb_build_object('abertas', count(*), 'mais_antiga_em', min(criado_em))
      INTO v_orc FROM public.solicitacoes_servico
     WHERE empresa_id = p_empresa_id AND estado IN ('nova', 'em_analise', 'revisao_pedida');
  END IF;

  IF 'servicos.visualizar' = ANY (perms) THEN
    SELECT jsonb_build_object('em_andamento', count(*),
             'vencendo', count(*) FILTER (WHERE previsao_conclusao BETWEEN hoje AND hoje + 3),
             'atrasadas', count(*) FILTER (WHERE previsao_conclusao < hoje))
      INTO v_os FROM public.ordens_servico
     WHERE empresa_id = p_empresa_id AND estado IN ('aguardando_inicio', 'em_execucao', 'pausada');
  END IF;

  IF 'vendas.visualizar' = ANY (perms) THEN
    WITH v AS (
      SELECT total, (confirmada_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia FROM public.vendas
       WHERE empresa_id = p_empresa_id AND estado = 'confirmada' AND confirmada_em IS NOT NULL
         AND (confirmada_em AT TIME ZONE 'America/Sao_Paulo')::date >= (inicio_mes - interval '1 month')::date)
    SELECT jsonb_build_object('mes', to_char(inicio_mes, 'YYYY-MM'),
             'quantidade', count(*) FILTER (WHERE dia >= inicio_mes),
             'total_centavos', coalesce(app_private.para_centavos(sum(total) FILTER (WHERE dia >= inicio_mes)), 0),
             'mes_anterior_total_centavos', coalesce(app_private.para_centavos(sum(total) FILTER (WHERE dia < inicio_mes)), 0),
             'semanas', jsonb_build_array(
               coalesce(app_private.para_centavos(sum(total) FILTER (WHERE dia >= inicio_mes AND extract(day FROM dia) <= 7)), 0),
               coalesce(app_private.para_centavos(sum(total) FILTER (WHERE dia >= inicio_mes AND extract(day FROM dia) BETWEEN 8 AND 14)), 0),
               coalesce(app_private.para_centavos(sum(total) FILTER (WHERE dia >= inicio_mes AND extract(day FROM dia) BETWEEN 15 AND 21)), 0),
               coalesce(app_private.para_centavos(sum(total) FILTER (WHERE dia >= inicio_mes AND extract(day FROM dia) >= 22)), 0)))
      INTO v_vendas FROM v;
  END IF;

  IF 'financeiro.visualizar' = ANY (perms) THEN
    WITH abertas AS (
      SELECT t.tipo, pa.saldo, pa.vencimento FROM public.parcelas_financeiras pa
        JOIN public.titulos_financeiros t ON t.id = pa.titulo_id
       WHERE pa.empresa_id = p_empresa_id AND pa.estado IN ('aberta', 'parcial') AND t.estado IN ('aberto', 'parcial')
         AND pa.vencimento <= hoje + 7)
    SELECT jsonb_build_object(
             'receber_7_dias', jsonb_build_object('parcelas', count(*) FILTER (WHERE tipo = 'receber'),
               'valor_centavos', coalesce(app_private.para_centavos(sum(saldo) FILTER (WHERE tipo = 'receber')), 0),
               'atrasadas', count(*) FILTER (WHERE tipo = 'receber' AND vencimento < hoje)),
             'pagar_7_dias', jsonb_build_object('parcelas', count(*) FILTER (WHERE tipo = 'pagar'),
               'valor_centavos', coalesce(app_private.para_centavos(sum(saldo) FILTER (WHERE tipo = 'pagar')), 0),
               'atrasadas', count(*) FILTER (WHERE tipo = 'pagar' AND vencimento < hoje)),
             'saldo_contas_centavos', (SELECT coalesce(app_private.para_centavos(sum(c.saldo)), 0) FROM public.contas_financeiras c
                                        WHERE c.empresa_id = p_empresa_id AND c.ativa))
      INTO v_fin FROM abertas;
  END IF;

  IF 'estoque.visualizar' = ANY (perms) THEN
    WITH baixo AS (
      SELECT p.nome, pv.atributos, s.disponivel, pv.estoque_minimo
        FROM public.saldos_estoque s
        JOIN public.produto_variacoes pv ON pv.id = s.variacao_id
        JOIN public.produtos p ON p.id = pv.produto_id
       WHERE s.empresa_id = p_empresa_id AND pv.ativo AND p.ativo AND pv.estoque_minimo IS NOT NULL AND s.disponivel < pv.estoque_minimo)
    SELECT jsonb_build_object('abaixo_do_minimo', (SELECT count(*) FROM baixo),
             'itens', coalesce((SELECT jsonb_agg(jsonb_build_object('produto', nome, 'atributos', atributos, 'disponivel', disponivel, 'minimo', estoque_minimo)
                                 ORDER BY (disponivel::numeric / greatest(estoque_minimo, 1)), nome)
                                FROM (SELECT * FROM baixo ORDER BY (disponivel::numeric / greatest(estoque_minimo, 1)), nome LIMIT 5) b), '[]'::jsonb))
      INTO v_estoque;
  END IF;

  IF 'agenda.visualizar' = ANY (perms) THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('inicio', a.inicio, 'fim', a.fim, 'solicitacao_id', s.id, 'numero', s.numero,
             'servico', s.servico_nome, 'cliente', s.cliente_nome) ORDER BY a.inicio), '[]'::jsonb)
      INTO v_agenda FROM public.agendamentos a JOIN public.solicitacoes_servico s ON s.id = a.solicitacao_id
     WHERE a.empresa_id = p_empresa_id AND a.estado = 'confirmado' AND (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date = hoje;
  END IF;

  IF 'orcamentos.visualizar' = ANY (perms) OR 'servicos.visualizar' = ANY (perms) OR 'pedidos.visualizar' = ANY (perms) THEN
    v_msg := app_private.mensagens_novas_de(usuario, p_empresa_id);
  END IF;

  RETURN jsonb_build_object(
    'empresa', jsonb_build_object('id', e.id, 'nome_publico', e.nome_publico, 'situacao_vitrine', e.situacao_vitrine, 'dado_de_teste', e.dado_de_teste),
    'hoje', hoje, 'gerado_em', now(),
    'pedidos', v_pedidos, 'orcamentos', v_orc, 'ordens', v_os, 'vendas', v_vendas, 'financeiro', v_fin,
    'estoque', v_estoque, 'agenda_hoje', v_agenda, 'mensagens', v_msg);
END $$;

-- ---------------------------------------------------------------------------
-- 3. Privilégios (só authenticated; o anônimo continua com as 3 funções do M10)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.mensagens_novas(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mensagens_novas(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.marcar_conversa_lida(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_conversa_lida(text, uuid, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.painel_empresa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.painel_empresa(uuid) TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611180001', 'M13b: painel_empresa (indicadores do painel Business numa leitura, cada bloco com a permissão correspondente) e marcador de novas mensagens (leituras_conversa por participante e conversa, mensagens_novas e marcar_conversa_lida); sem permissão nova nem função anônima');

COMMIT;
