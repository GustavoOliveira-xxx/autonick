-- 202611140001: M11, jornada completa do Cliente (MINI-ESPEC_M11; ADR-G11 aprovada em 14/11/2026: D11-08 = B, demais = A).
-- Só no branch `desenvolvimento`. Nenhuma tabela nova, nenhuma permissão nova (catálogo segue com 55), nenhuma função nova
-- para o papel `anonymous` (segue com as três do M10).
-- D11-01 a D11-03: o login não amplia o catálogo. Novas solicitações e pedidos do Cliente só aceitam item publicado na
--   vitrine, de empresa com cartão aprovado e elegível no conjunto da conta, conferido na lista, na estimativa e no envio.
--   Venda interna, balcão e o restante do ERP NÃO mudam (variacao_vendavel e criar_solicitacao_nucleo intactas).
-- D11-06 e D11-07: suspensão (comum ou grave) congela o aceite do que ainda não foi aceito; recusa e cancelamento seguem
--   sem custo; o já aceito continua; o cliente vê só "comum" ou "grave", nunca a justificativa interna.
-- D11-08: conta fictícia precisa de autorização de demonstração válida para iniciar nova solicitação ou pedido.

BEGIN;

-- ===========================================================================
-- 1. Funções auxiliares (privadas)
-- ===========================================================================

-- Situação da vitrine que o cliente pode ver: NULL (não suspensa), 'comum' ou 'grave'. Nunca a justificativa interna da CK.
CREATE FUNCTION app_private.suspensao_da_vitrine(p_empresa uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE WHEN e.situacao_vitrine = 'suspensa' THEN e.suspensao_gravidade END FROM public.empresas e WHERE e.id = p_empresa
$$;

-- D11-01, D11-02 e D11-08: a empresa aceita NOVAS solicitações e pedidos desta conta só se estiver na vitrine que a conta pode
-- ver: conjunto público (conta real) ou de demonstração (conta fictícia), com cartão aprovado, vitrine publicada e ERP ativo;
-- conta fictícia só com autorização de demonstração válida no momento da chamada. Os atendimentos já existentes não passam
-- por aqui (seguem as funções minha_*, meus_* e as ações do próprio atendimento).
CREATE FUNCTION app_private.empresa_aceita_novas(p_empresa uuid, p_usuario text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH conta AS (
    SELECT coalesce(app_private.email_da_pessoa(p_usuario) LIKE '%@autonick-teste.example', false) AS ficticia
  )
  SELECT p_usuario IS NOT NULL AND p_empresa IS NOT NULL
     AND EXISTS (SELECT 1 FROM conta, app_private.cartoes_do_conjunto(CASE WHEN conta.ficticia THEN 'demonstracao' ELSE 'publico' END) c
                  WHERE c.empresa_id = p_empresa)
     AND (NOT (SELECT ficticia FROM conta) OR app_private.demonstracao_autorizada(p_usuario))
$$;

-- ===========================================================================
-- 2. Funções existentes ajustadas (visibilidade, suspensão e avisos)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.servicos_para_cliente(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_perfil_cliente(usuario);
  IF NOT app_private.empresa_aceita_novas(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Esta empresa não está disponível para novas solicitações.');
  END IF;
  RETURN jsonb_build_object(
    'empresa', (SELECT jsonb_build_object('id', e.id, 'nome', app_private.nome_aprovado(e.id)) FROM public.empresas e WHERE e.id = p_empresa_id),
    'horarios', app_private.grade_json(p_empresa_id),
    'servicos', coalesce((SELECT jsonb_agg(app_private.servico_json(s, false) - 'empresa_id' - 'versao' ORDER BY lower(s.nome))
      FROM public.servicos s WHERE s.empresa_id = p_empresa_id AND app_private.servico_publico(s)), '[]'::jsonb),
    'aviso', 'A estimativa não é o valor final. Nenhum horário é reservado no envio: a empresa confirma depois.');
END $$;

CREATE OR REPLACE FUNCTION public.estimar_servico(p_servico_id uuid, p_respostas jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  s public.servicos;
BEGIN
  SELECT * INTO s FROM public.servicos WHERE id = p_servico_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Serviço não encontrado.');
  END IF;
  IF NOT (app_private.tem(s.empresa_id, usuario, 'catalogo_servicos.visualizar') OR app_private.tem(s.empresa_id, usuario, 'orcamentos.visualizar')) THEN
    -- Fora da equipe, só quem tem perfil de cliente e pode pedir a esta empresa (mesma regra de servicos_para_cliente).
    IF NOT (app_private.servico_publico(s) AND EXISTS (SELECT 1 FROM public.perfis_identidade WHERE auth_user_id = usuario AND tipo_conta = 'cliente')
            AND app_private.empresa_aceita_novas(s.empresa_id, usuario)) THEN
      PERFORM app_private.erro('NOT_FOUND', 'Este serviço não está disponível para novas solicitações.');
    END IF;
  END IF;
  RETURN app_private.calcular_estimativa(s, app_private.validar_respostas(s.id, p_respostas, false));
END $$;

CREATE OR REPLACE FUNCTION public.criar_solicitacao(p_servico_id uuid, p_dados jsonb, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_servico_id, p_dados::text));
  anterior jsonb;
  v_nome text;
  s public.servicos;
  sol public.solicitacoes_servico;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_solicitacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  v_nome := app_private.exigir_perfil_cliente(usuario);
  SELECT * INTO s FROM public.servicos WHERE id = p_servico_id;
  IF NOT FOUND OR NOT app_private.servico_publico(s) OR NOT app_private.empresa_aceita_novas(s.empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Este serviço não está disponível para novas solicitações.');
  END IF;
  -- Limites (D8-23), conferidos no banco e sob trava por cliente: abertas por empresa e novas por dia.
  PERFORM pg_advisory_xact_lock(hashtextextended('solicitacao|' || usuario, 0));
  IF (SELECT count(*) FROM public.solicitacoes_servico WHERE empresa_id = s.empresa_id AND cliente_auth_id = usuario
        AND estado IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida')) >= app_private.limite('solicitacoes_abertas_por_empresa') THEN
    PERFORM app_private.erro('STATE_CONFLICT', format('Você já tem %s solicitações abertas nesta empresa. Aguarde a resposta ou cancele uma delas.',
      app_private.limite('solicitacoes_abertas_por_empresa')));
  END IF;
  IF (SELECT count(*) FROM public.solicitacoes_servico WHERE cliente_auth_id = usuario
        AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = app_private.hoje_sp()) >= app_private.limite('solicitacoes_novas_por_dia') THEN
    PERFORM app_private.erro('STATE_CONFLICT', format('Limite de %s solicitações novas por dia atingido. Tente amanhã.', app_private.limite('solicitacoes_novas_por_dia')));
  END IF;
  sol := app_private.criar_solicitacao_nucleo(s, 'plataforma', usuario, NULL, v_nome, coalesce(p_dados, '{}'::jsonb), usuario);
  RETURN app_private.idem_fim(usuario, 'criar_solicitacao', p_operation_key, assinatura, app_private.solicitacao_json(sol.id, true));
END $$;

CREATE OR REPLACE FUNCTION public.itens_para_pedido(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  IF NOT app_private.empresa_aceita_novas(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Esta empresa não está disponível para novas solicitações.');
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('variacao_id', v.id, 'produto_id', p.id, 'produto', p.nome,
      'variacao', app_private.rotulo_variacao(v.atributos, v.padrao), 'preco_centavos', app_private.para_centavos(v.preco),
      'sob_encomenda', p.sob_encomenda) ORDER BY lower(p.nome), v.padrao DESC, v.id)
    FROM public.produtos p JOIN public.produto_variacoes v ON v.produto_id = p.id
   WHERE p.empresa_id = p_empresa_id AND v.ativo AND app_private.produto_publico(p)), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.criar_pedido(p_empresa_id uuid, p_itens jsonb, p_observacao text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_itens::text, p_observacao));
  anterior jsonb;
  v_nome text;
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
  ped public.pedidos;
  it record;
  vv record;
  v_total numeric := 0;
  v_dica text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_pedido', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  v_nome := app_private.exigir_perfil_cliente(usuario);
  IF NOT app_private.empresa_aceita_novas(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Esta empresa não está disponível para novas solicitações.');
  END IF;
  IF char_length(v_obs) > 500 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A observação pode ter até 500 caracteres.', 'observacao');
  END IF;
  -- Proteção contra excesso: no máximo 5 pedidos aguardando aceite por cliente em cada empresa.
  PERFORM pg_advisory_xact_lock(hashtextextended('pedido|' || p_empresa_id || '|' || usuario, 0));
  IF (SELECT count(*) FROM public.pedidos WHERE empresa_id = p_empresa_id AND cliente_auth_id = usuario AND estado = 'solicitado') >= 5 THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Você já tem 5 pedidos aguardando esta empresa. Aguarde a resposta.');
  END IF;
  INSERT INTO public.pedidos (empresa_id, cliente_auth_id, cliente_nome, observacao_cliente, total_estimado)
  VALUES (p_empresa_id, usuario, v_nome, v_obs, 0.01) RETURNING * INTO ped;   -- total provisório, recalculado abaixo
  FOR it IN SELECT * FROM app_private.ler_itens(p_itens, false) LOOP
    -- D11-01: só produto publicado na vitrine, com a variação ativa; a mesma resposta para pausado, interno,
    -- desativado, de outra empresa ou inexistente (ADR-004).
    IF NOT EXISTS (SELECT 1 FROM public.produto_variacoes v JOIN public.produtos p ON p.id = v.produto_id
                    WHERE v.id = it.variacao_id AND p.empresa_id = p_empresa_id AND v.ativo AND app_private.produto_publico(p)) THEN
      PERFORM app_private.erro('NOT_FOUND', 'Um dos produtos não está disponível para pedido.', it.variacao_id::text);
    END IF;
    -- Insumo interno, desativado ou de outra empresa: o cliente só ouve "não disponível" (ADR-004, sem revelar nomes).
    BEGIN
      SELECT * INTO vv FROM app_private.variacao_vendavel(p_empresa_id, it.variacao_id);
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_dica = PG_EXCEPTION_HINT;
      IF v_dica = 'PRODUCT_PAUSED' THEN RAISE; END IF;
      PERFORM app_private.erro('NOT_FOUND', 'Um dos produtos não está disponível para pedido.', it.variacao_id::text);
    END;
    INSERT INTO public.pedido_itens (pedido_id, empresa_id, variacao_id, quantidade, preco_unitario, nome_snapshot, rotulo_snapshot)
    VALUES (ped.id, p_empresa_id, it.variacao_id, it.quantidade, (vv.v).preco, (vv.p).nome,
      app_private.rotulo_variacao((vv.v).atributos, (vv.v).padrao));
    v_total := v_total + it.quantidade * (vv.v).preco;
  END LOOP;
  UPDATE public.pedidos SET total_estimado = v_total WHERE id = ped.id;
  PERFORM app_private.evento_comercial(p_empresa_id, 'pedido_criado', usuario, 'pedido', ped.id,
    jsonb_build_object('itens', jsonb_array_length(p_itens), 'total_centavos', app_private.para_centavos(v_total)), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'criar_pedido', p_operation_key, assinatura, app_private.resumo_pedido(ped.id));
END $$;

CREATE OR REPLACE FUNCTION public.empresas_para_pedido() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'nome', coalesce(e.dados_publicados->>'nome_publico', e.nome_publico),
      'cidade', coalesce(e.dados_publicados->>'cidade', e.cidade), 'dado_de_teste', e.dado_de_teste) ORDER BY lower(coalesce(e.dados_publicados->>'nome_publico', e.nome_publico)))
    FROM public.empresas e WHERE app_private.empresa_aceita_novas(e.id, usuario)), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.aceitar_orcamento(p_solicitacao_id uuid, p_versao_id uuid, p_condicoes_aceitas boolean, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_versao_id, p_condicoes_aceitas));
  anterior jsonb;
  s public.solicitacoes_servico;
  v public.orcamento_versoes;
  papel text;
  v_cliente uuid;
  v_retrato jsonb;
  v_os public.ordens_servico;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'aceitar_orcamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.solicitacao_trava(p_solicitacao_id);
  papel := app_private.papel_na_solicitacao(s, usuario, CASE WHEN s.origem = 'interna' THEN 'orcamentos.aprovar' END);
  IF s.estado = 'aceita' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este orçamento já foi aceito.');
  END IF;
  IF s.estado NOT IN ('orcamento_enviado', 'revisao_pedida') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Não há orçamento disponível para aceitar.');
  END IF;
  IF s.origem = 'plataforma' AND app_private.suspensao_da_vitrine(s.empresa_id) IS NOT NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A vitrine desta empresa está suspensa: não é possível aceitar o orçamento agora. Você pode recusar o orçamento ou cancelar a solicitação sem custo.');
  END IF;
  SELECT * INTO v FROM public.orcamento_versoes WHERE id = p_versao_id AND solicitacao_id = s.id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Versão não encontrada.');
  END IF;
  IF v.id IS DISTINCT FROM s.versao_vigente_id OR v.estado <> 'enviada' THEN
    PERFORM app_private.erro('QUOTE_VERSION_STALE', 'Esta versão do orçamento foi substituída. Veja a versão atual.');
  END IF;
  IF v.valido_ate < app_private.hoje_sp() THEN
    PERFORM app_private.erro('QUOTE_EXPIRED', 'O prazo deste orçamento terminou. Peça uma atualização à empresa.');
  END IF;
  IF NOT coalesce(p_condicoes_aceitas, false) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Confirme que leu e aceita as condições.', 'condicoes_aceitas');
  END IF;
  v_retrato := app_private.versao_json(v, true) || jsonb_build_object(
    'aceito_em', now(), 'aceito_por', CASE papel WHEN 'cliente' THEN 'cliente' ELSE 'equipe (aceite informado pelo cliente)' END,
    'registrado_por', CASE WHEN papel = 'equipe' THEN app_private.nome_da_pessoa(usuario) END,
    'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim) FROM public.agendamentos a WHERE a.solicitacao_id = s.id AND a.estado = 'confirmado'),
    'servico', s.servico_nome, 'relato', s.relato,
    'politica_cancelamento', (SELECT jsonb_build_object('versao', pc.versao, 'texto', pc.texto) FROM public.politicas_cancelamento pc WHERE pc.empresa_id = s.empresa_id AND pc.ativa));
  UPDATE public.orcamento_versoes SET estado = 'aceita', aceite = v_retrato, versao = versao + 1, atualizado_em = now() WHERE id = v.id RETURNING * INTO v;
  IF s.origem = 'plataforma' THEN
    SELECT id INTO v_cliente FROM public.clientes_empresa WHERE empresa_id = s.empresa_id AND perfil_cliente_id = s.cliente_auth_id;
    IF v_cliente IS NULL THEN
      INSERT INTO public.clientes_empresa (empresa_id, nome, perfil_cliente_id, criado_por)
      VALUES (s.empresa_id, s.cliente_nome, s.cliente_auth_id, usuario) RETURNING id INTO v_cliente;
    END IF;
  ELSE
    v_cliente := s.cliente_id;
  END IF;
  UPDATE public.solicitacoes_servico SET estado = 'aceita', cliente_id = v_cliente, aceite = v_retrato || jsonb_build_object('versao_id', v.id),
    versao = versao + 1, atualizado_em = now() WHERE id = s.id RETURNING * INTO s;
  -- D9-01 = B (substitui o D8-01): a OS nasce no aceite, na mesma transação, uma só por aceite.
  v_os := app_private.criar_os(s, v, usuario, NULL);
  PERFORM app_private.evento_solicitacao(s, 'aceita', papel, usuario, NULL,
    jsonb_build_object('versao', v.numero, 'total_centavos', app_private.para_centavos(v.total), 'os', v_os.numero), true);
  PERFORM app_private.auditar(s.empresa_id, usuario, 'orcamentos.aceito', 'orcamento_versoes', v.id,
    jsonb_build_object('solicitacao', s.numero, 'versao', v.numero, 'total_centavos', app_private.para_centavos(v.total), 'por', papel));
  RETURN app_private.idem_fim(usuario, 'aceitar_orcamento', p_operation_key, assinatura, app_private.solicitacao_json(s.id, papel = 'cliente'));
END $$;

CREATE OR REPLACE FUNCTION public.aceitar_pedido(p_pedido_id uuid, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_pedido_id, p_expected_version));
  anterior jsonb;
  ped public.pedidos;
  it record;
  vv record;
  v_itens jsonb := '[]'::jsonb;
  v_reserva jsonb;
  v_cliente uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'aceitar_pedido', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO ped FROM public.pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Pedido não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(ped.empresa_id, usuario, ARRAY['pedidos.aprovar']);
  IF ped.estado <> 'solicitado' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este pedido já foi respondido.');
  END IF;
  IF app_private.suspensao_da_vitrine(ped.empresa_id) IS NOT NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A vitrine desta empresa está suspensa: pedidos aguardando aceite ficam congelados até a reativação. O cliente pode cancelar o pedido sem custo.');
  END IF;
  IF ped.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este pedido mudou desde que você abriu a tela. Atualize antes de continuar.');
  END IF;
  FOR it IN SELECT * FROM public.pedido_itens WHERE pedido_id = ped.id ORDER BY variacao_id LOOP
    SELECT * INTO vv FROM app_private.variacao_vendavel(ped.empresa_id, it.variacao_id);
    v_itens := v_itens || jsonb_build_object('variacao_id', it.variacao_id, 'quantidade', it.quantidade);
  END LOOP;
  v_reserva := app_private.reservar_estoque(ped.empresa_id, usuario, 'pedido', ped.id, v_itens, p_operation_key);
  -- D6-11: o vínculo com a conta pública nasce aqui, pelo pedido aceito; nunca por e-mail ou telefone.
  SELECT id INTO v_cliente FROM public.clientes_empresa WHERE empresa_id = ped.empresa_id AND perfil_cliente_id = ped.cliente_auth_id;
  IF v_cliente IS NULL THEN
    INSERT INTO public.clientes_empresa (empresa_id, nome, perfil_cliente_id, criado_por)
    VALUES (ped.empresa_id, ped.cliente_nome, ped.cliente_auth_id, usuario) RETURNING id INTO v_cliente;
    PERFORM app_private.evento_comercial(ped.empresa_id, 'cliente_criado_por_pedido', usuario, 'cliente', v_cliente,
      jsonb_build_object('pedido_id', ped.id), p_operation_key);
  END IF;
  UPDATE public.pedidos SET estado = 'aceito', cliente_empresa_id = v_cliente, decidido_por = usuario, decidido_em = now(),
    versao = versao + 1 WHERE id = ped.id;
  PERFORM app_private.evento_comercial(ped.empresa_id, 'pedido_aceito', usuario, 'pedido', ped.id,
    jsonb_build_object('reserva', v_reserva->'reservas'), p_operation_key);
  PERFORM app_private.auditar(ped.empresa_id, usuario, 'pedido.aceito', 'pedidos', ped.id, jsonb_build_object('cliente_empresa_id', v_cliente));
  RETURN app_private.idem_fim(usuario, 'aceitar_pedido', p_operation_key, assinatura,
    app_private.resumo_pedido(ped.id) || jsonb_build_object('reservas', v_reserva->'reservas'));
END $$;

CREATE OR REPLACE FUNCTION public.meus_pedidos() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'estado', p.estado, 'versao', p.versao, 'empresa_id', p.empresa_id,
      'suspensao', app_private.suspensao_da_vitrine(p.empresa_id),
      'empresa', coalesce(e.dados_publicados->>'nome_publico', e.nome_publico), 'observacao', p.observacao_cliente,
      'motivo', CASE WHEN p.estado IN ('recusado', 'cancelado') THEN p.motivo_decisao END,
      'total_centavos', app_private.para_centavos(p.total_estimado), 'criado_em', p.criado_em, 'decidido_em', p.decidido_em,
      'entrega', (SELECT v.entrega FROM public.vendas v WHERE v.id = p.venda_id),
      'itens', (SELECT jsonb_agg(jsonb_build_object('produto', i.nome_snapshot, 'variacao', i.rotulo_snapshot, 'quantidade', i.quantidade,
          'preco_centavos', app_private.para_centavos(i.preco_unitario)) ORDER BY i.nome_snapshot)
        FROM public.pedido_itens i WHERE i.pedido_id = p.id)) ORDER BY p.criado_em DESC)
    FROM (SELECT * FROM public.pedidos WHERE cliente_auth_id = usuario ORDER BY criado_em DESC LIMIT 100) p
    JOIN public.empresas e ON e.id = p.empresa_id), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.minhas_solicitacoes() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'numero', s.numero, 'empresa', app_private.nome_aprovado(e.id), 'empresa_id', s.empresa_id, 'suspensao', app_private.suspensao_da_vitrine(s.empresa_id),
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

CREATE OR REPLACE FUNCTION public.minhas_os() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'numero', o.numero, 'empresa', app_private.nome_aprovado(e.id), 'empresa_id', o.empresa_id,
      'suspensao', app_private.suspensao_da_vitrine(o.empresa_id), 'servico', o.servico_nome,
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

CREATE OR REPLACE FUNCTION public.minha_solicitacao(p_solicitacao_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.solicitacoes_servico WHERE id = p_solicitacao_id AND cliente_auth_id = usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Solicitação não encontrada.');
  END IF;
  RETURN app_private.solicitacao_json(p_solicitacao_id, true) || jsonb_build_object('suspensao',
    app_private.suspensao_da_vitrine((SELECT empresa_id FROM public.solicitacoes_servico WHERE id = p_solicitacao_id)));
END $$;

CREATE OR REPLACE FUNCTION public.minha_os(p_os_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ordens_servico WHERE id = p_os_id AND cliente_auth_id = usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Ordem de serviço não encontrada.');
  END IF;
  RETURN app_private.os_json(p_os_id, true, false) || jsonb_build_object('suspensao',
    app_private.suspensao_da_vitrine((SELECT empresa_id FROM public.ordens_servico WHERE id = p_os_id)));
END $$;

-- ===========================================================================
-- 3. Privilégios: auxiliares fechadas; as públicas alteradas mantêm os privilégios (CREATE OR REPLACE).
-- ===========================================================================
REVOKE ALL ON FUNCTION app_private.suspensao_da_vitrine(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.empresa_aceita_novas(uuid, text) FROM PUBLIC;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611140001', 'M11: jornada do Cliente; novas solicitações e pedidos só com item publicado e empresa elegível no conjunto da vitrine (autorização de demonstração para conta fictícia); suspensão congela aceites pendentes; situação da suspensão nas listas do cliente; sem tabela, permissão ou função anônima nova');

COMMIT;
