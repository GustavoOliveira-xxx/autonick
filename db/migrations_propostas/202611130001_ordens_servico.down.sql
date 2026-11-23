-- Rollback da migration 202611130001 (M09). Só no branch `desenvolvimento`.
-- Recusa se houver dado do M09 além da carga (OS criada depois da migration, material, cancelamento, título de serviço,
-- reagendamento, política ou pacote): nesse caso a reversão apagaria histórico e precisa de decisão humana.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ordens_servico WHERE origem_carga IS NULL)
     OR EXISTS (SELECT 1 FROM public.ordens_servico WHERE versao > 1 OR estado <> 'aguardando_inicio')
     OR EXISTS (SELECT 1 FROM public.os_material_usos) OR EXISTS (SELECT 1 FROM public.cancelamentos_os)
     OR EXISTS (SELECT 1 FROM public.reagendamentos) OR EXISTS (SELECT 1 FROM public.politicas_cancelamento)
     OR EXISTS (SELECT 1 FROM public.servico_pacote_itens) OR EXISTS (SELECT 1 FROM public.servicos WHERE politica_preco = 'pacote')
     OR EXISTS (SELECT 1 FROM public.titulos_financeiros WHERE origem_tipo IN ('servico', 'cancelamento_servico'))
     OR EXISTS (SELECT 1 FROM public.reservas_estoque WHERE origem_tipo = 'os_material')
     OR EXISTS (SELECT 1 FROM public.movimentacoes_estoque WHERE origem_tipo = 'os')
     OR EXISTS (SELECT 1 FROM public.solicitacoes_servico WHERE origem_os_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.categorias_financeiras WHERE codigo_sistema = 'servicos') THEN
    RAISE EXCEPTION 'Há dados do M09 além da carga: a reversão apagaria histórico. Decisão humana necessária.';
  END IF;
END $$;

-- Funções do M07 e do M08 voltam ao texto anterior.
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
    'servico', s.servico_nome, 'relato', s.relato);
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
  PERFORM app_private.evento_solicitacao(s, 'aceita', papel, usuario, NULL,
    jsonb_build_object('versao', v.numero, 'total_centavos', app_private.para_centavos(v.total), 'aguarda_os', true), true);
  PERFORM app_private.auditar(s.empresa_id, usuario, 'orcamentos.aceito', 'orcamento_versoes', v.id,
    jsonb_build_object('solicitacao', s.numero, 'versao', v.numero, 'total_centavos', app_private.para_centavos(v.total), 'por', papel));
  RETURN app_private.idem_fim(usuario, 'aceitar_orcamento', p_operation_key, assinatura, app_private.solicitacao_json(s.id, papel = 'cliente'));
END $$;

CREATE OR REPLACE FUNCTION app_private.solicitacao_json(p_id uuid, p_para_cliente boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', s.id, 'empresa_id', s.empresa_id, 'numero', s.numero, 'servico_id', s.servico_id, 'servico', s.servico_nome,
    'empresa', (SELECT e.nome_publico FROM public.empresas e WHERE e.id = s.empresa_id),
    'origem', s.origem, 'cliente_nome', s.cliente_nome, 'relato', s.relato, 'cidade', s.cidade, 'bairro', s.bairro,
    'preferencia', s.preferencia, 'respostas', s.respostas, 'estimativa', s.estimativa, 'estado', s.estado,
    'estado_exibicao', CASE WHEN s.estado IN ('orcamento_enviado', 'revisao_pedida') AND v.valido_ate < app_private.hoje_sp() THEN 'vencido' ELSE s.estado END,
    'aceite', s.aceite, 'motivo_encerramento', s.motivo_encerramento, 'encerrada_em', s.encerrada_em, 'versao', s.versao,
    'criado_em', s.criado_em, 'aguarda_os', s.estado = 'aceita',
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

CREATE OR REPLACE FUNCTION public.confirmar_horario(p_solicitacao_id uuid, p_inicio timestamptz, p_duracao_min integer, p_aceitar_avisos boolean,
  p_justificativa text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_inicio, p_duracao_min, p_aceitar_avisos, p_justificativa));
  anterior jsonb;
  s public.solicitacoes_servico;
  a public.agendamentos;
  v_fim timestamptz;
  v_avisos jsonb;
  v_ant public.agendamentos;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'confirmar_horario', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.solicitacao_trava(p_solicitacao_id);
  PERFORM app_private.exigir_permissoes(s.empresa_id, usuario, ARRAY['agenda.alterar']);
  IF s.estado IN ('recusada', 'cancelada') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta solicitação está encerrada.');
  END IF;
  SELECT * INTO v_ant FROM public.agendamentos WHERE solicitacao_id = s.id AND estado = 'confirmado' FOR UPDATE;
  IF s.estado = 'aceita' AND v_ant.id IS NOT NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O orçamento já foi aceito com este horário. A troca de horário depois do aceite é o reagendamento da próxima etapa.');
  END IF;
  IF p_inicio IS NULL OR p_inicio < now() THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha uma data e hora a partir de agora.', 'inicio');
  END IF;
  IF p_inicio > now() + interval '180 days' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O horário pode ser marcado até 180 dias à frente.', 'inicio');
  END IF;
  IF p_duracao_min IS NULL OR p_duracao_min NOT BETWEEN 15 AND 720 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A duração vai de 15 minutos a 12 horas.', 'duracao_min');
  END IF;
  IF char_length(p_justificativa) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A justificativa tem até 300 caracteres.', 'justificativa');
  END IF;
  v_fim := p_inicio + make_interval(mins => p_duracao_min);
  -- Trava da agenda da empresa: duas confirmações ao mesmo tempo veem uma a outra nos avisos de sobreposição.
  PERFORM pg_advisory_xact_lock(hashtextextended('agenda|' || s.empresa_id, 0));
  v_avisos := app_private.avisos_horario(s.empresa_id, s.id, p_inicio, v_fim);
  IF jsonb_array_length(v_avisos) > 0 AND NOT coalesce(p_aceitar_avisos, false) THEN
    -- Nada é gravado: a tela mostra os avisos e pede confirmação explícita.
    RETURN jsonb_build_object('confirmado', false, 'avisos', v_avisos);
  END IF;
  IF v_ant.id IS NOT NULL THEN
    UPDATE public.agendamentos SET estado = 'substituido', encerrado_em = now() WHERE id = v_ant.id;
  END IF;
  INSERT INTO public.agendamentos (empresa_id, solicitacao_id, inicio, fim, avisos, justificativa, confirmado_por)
  VALUES (s.empresa_id, s.id, p_inicio, v_fim, v_avisos, nullif(btrim(coalesce(p_justificativa, '')), ''), usuario) RETURNING * INTO a;
  UPDATE public.solicitacoes_servico SET versao = versao + 1, atualizado_em = now() WHERE id = s.id RETURNING * INTO s;
  PERFORM app_private.evento_solicitacao(s, CASE WHEN v_ant.id IS NULL THEN 'horario_confirmado' ELSE 'horario_alterado' END, 'equipe', usuario, NULL,
    jsonb_build_object('inicio', a.inicio, 'fim', a.fim, 'anterior', CASE WHEN v_ant.id IS NOT NULL THEN jsonb_build_object('inicio', v_ant.inicio, 'fim', v_ant.fim) END,
      'aviso_cliente', 'Horário definido pela empresa. Se não puder, peça outro horário pela mensagem.'), true);
  IF jsonb_array_length(v_avisos) > 0 THEN
    PERFORM app_private.evento_solicitacao(s, 'aviso_horario_aceito', 'equipe', usuario, a.justificativa, jsonb_build_object('avisos', v_avisos), false);
  END IF;
  PERFORM app_private.auditar(s.empresa_id, usuario, 'agenda.horario_confirmado', 'agendamentos', a.id,
    jsonb_build_object('solicitacao', s.numero, 'avisos', jsonb_array_length(v_avisos), 'substituiu', v_ant.id IS NOT NULL));
  RETURN app_private.idem_fim(usuario, 'confirmar_horario', p_operation_key, assinatura,
    jsonb_build_object('confirmado', true, 'avisos', v_avisos, 'horario', jsonb_build_object('id', a.id, 'inicio', a.inicio, 'fim', a.fim)));
END $$;

CREATE OR REPLACE FUNCTION public.cancelar_solicitacao(p_solicitacao_id uuid, p_motivo text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_motivo));
  anterior jsonb;
  s public.solicitacoes_servico;
  papel text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'cancelar_solicitacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.solicitacao_trava(p_solicitacao_id);
  papel := app_private.papel_na_solicitacao(s, usuario, 'orcamentos.cancelar');
  IF s.estado = 'aceita' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O orçamento já foi aceito: o cancelamento será tratado com a ordem de serviço (próxima etapa).');
  END IF;
  IF s.estado IN ('recusada', 'cancelada') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta solicitação já está encerrada.');
  END IF;
  IF papel = 'equipe' THEN
    v_motivo := app_private.ler_texto(v_motivo, 10, 300, 'motivo', 'Explique ao cliente o motivo (10 a 300 caracteres).');
  ELSIF char_length(v_motivo) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O motivo tem até 300 caracteres.', 'motivo');
  END IF;
  s := app_private.encerrar_solicitacao(s, 'cancelada', v_motivo);
  PERFORM app_private.evento_solicitacao(s, 'cancelada', papel, usuario, v_motivo, jsonb_build_object('sem_cobranca', true), true);
  PERFORM app_private.auditar(s.empresa_id, usuario, 'orcamentos.solicitacao_cancelada', 'solicitacoes_servico', s.id,
    jsonb_build_object('numero', s.numero, 'por', papel));
  RETURN app_private.idem_fim(usuario, 'cancelar_solicitacao', p_operation_key, assinatura, app_private.solicitacao_json(s.id, papel = 'cliente'));
END $$;

CREATE OR REPLACE FUNCTION app_private.aplicar_dados_servico(p_atual public.servicos, p_dados jsonb) RETURNS public.servicos
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  s public.servicos := p_atual;
BEGIN
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['nome', 'descricao', 'categoria_id', 'politica_preco', 'preco_centavos', 'duracao_min',
    'validade_dias', 'modalidade', 'exibicao', 'faixa_percentual']);
  IF p_dados ? 'nome' THEN
    s.nome := app_private.ler_texto(p_dados->>'nome', 2, 80, 'nome', 'Dê um nome ao serviço (2 a 80 caracteres).');
  END IF;
  IF p_dados ? 'descricao' THEN
    s.descricao := nullif(btrim(coalesce(p_dados->>'descricao', '')), '');
    IF char_length(s.descricao) > 1000 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'A descrição pode ter até 1.000 caracteres.', 'descricao');
    END IF;
  END IF;
  IF p_dados ? 'categoria_id' THEN
    s.categoria_id := app_private.ler_uuid(p_dados->>'categoria_id', 'categoria_id');
    -- D8-04: categorias empresariais agora; categorias próprias de serviço (tipo 'servico', já previsto na tabela) no futuro.
    IF s.categoria_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categorias_plataforma WHERE id = s.categoria_id AND ativo AND tipo IN ('negocio', 'servico')) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha uma das categorias empresariais oficiais.', 'categoria_id');
    END IF;
  END IF;
  IF p_dados ? 'politica_preco' THEN
    s.politica_preco := p_dados->>'politica_preco';
    IF s.politica_preco IS NULL OR s.politica_preco NOT IN ('fixo', 'a_partir_de', 'sob_consulta', 'por_regras') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha como o preço é informado: fixo, a partir de, sob consulta ou por regras.', 'politica_preco');
    END IF;
  END IF;
  IF p_dados ? 'preco_centavos' THEN
    s.preco := app_private.centavos(p_dados->'preco_centavos', 'preco_centavos', false, 1);
  END IF;
  IF s.politica_preco = 'sob_consulta' THEN
    s.preco := NULL;
  ELSIF s.politica_preco IN ('fixo', 'a_partir_de') AND s.preco IS NULL THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o preço do serviço.', 'preco_centavos');
  END IF;
  IF p_dados ? 'duracao_min' THEN
    s.duracao_min := nullif(p_dados->>'duracao_min', '')::integer;
    IF s.duracao_min IS NOT NULL AND s.duracao_min NOT BETWEEN 15 AND 720 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'A duração estimada vai de 15 minutos a 12 horas.', 'duracao_min');
    END IF;
  END IF;
  IF p_dados ? 'validade_dias' THEN
    s.validade_dias := coalesce(nullif(p_dados->>'validade_dias', '')::integer, 15);
    IF s.validade_dias NOT BETWEEN 1 AND 90 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'A validade do orçamento vai de 1 a 90 dias.', 'validade_dias');
    END IF;
  END IF;
  IF p_dados ? 'modalidade' THEN
    s.modalidade := coalesce(p_dados->>'modalidade', 'analise_manual');
    IF s.modalidade NOT IN ('analise_manual', 'orcamento_automatico') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Modalidade inválida.', 'modalidade');
    END IF;
  END IF;
  IF s.modalidade = 'orcamento_automatico' AND s.politica_preco <> 'por_regras' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O orçamento automático só existe para serviços com preço calculado por regras.', 'modalidade');
  END IF;
  IF p_dados ? 'exibicao' THEN
    s.exibicao := coalesce(p_dados->>'exibicao', 'valor');
    IF s.exibicao NOT IN ('valor', 'faixa') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Mostre a estimativa como valor único ou como faixa.', 'exibicao');
    END IF;
  END IF;
  IF p_dados ? 'faixa_percentual' THEN
    s.faixa_percentual := coalesce(nullif(p_dados->>'faixa_percentual', '')::integer, 0);
  END IF;
  IF s.faixa_percentual NOT BETWEEN 0 AND 50 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A faixa vai de 0% a 50% para mais e para menos.', 'faixa_percentual');
  END IF;
  IF s.exibicao = 'faixa' AND s.faixa_percentual = 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Para mostrar faixa, informe a porcentagem (1% a 50%).', 'faixa_percentual');
  END IF;
  RETURN s;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  PERFORM app_private.erro('VALIDATION_ERROR', 'Número inválido nos dados do serviço.', 'duracao_min');
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app_private.calcular_estimativa(p_s public.servicos, p_respostas jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  r public.servico_regras;
  q public.servico_perguntas;
  v jsonb;
  soma numeric := 0;
  parcela numeric;
  minimo numeric := NULL;
  base jsonb := '[]'::jsonb;
  faltando jsonb := '[]'::jsonb;
  tem_regra boolean := false;
  valor numeric;
  aviso text := 'Estimativa, não é o valor final. O valor só vale depois do orçamento da empresa.';
BEGIN
  IF p_s.politica_preco = 'sob_consulta' THEN
    RETURN jsonb_build_object('completa', false, 'tipo', 'sob_consulta', 'faltando', '[]'::jsonb, 'base', '[]'::jsonb,
      'rotulo', 'Preço sob consulta: a empresa vai analisar e enviar o orçamento.');
  ELSIF p_s.politica_preco = 'fixo' THEN
    RETURN jsonb_build_object('completa', true, 'tipo', 'fixo', 'valor_centavos', app_private.para_centavos(p_s.preco),
      'base', jsonb_build_array(jsonb_build_object('rotulo', 'Preço informado pela empresa', 'valor_centavos', app_private.para_centavos(p_s.preco))),
      'faltando', '[]'::jsonb, 'rotulo', 'Preço informado pela empresa. ' || aviso);
  ELSIF p_s.politica_preco = 'a_partir_de' THEN
    RETURN jsonb_build_object('completa', false, 'tipo', 'a_partir_de', 'minimo_centavos', app_private.para_centavos(p_s.preco),
      'base', '[]'::jsonb, 'faltando', '[]'::jsonb,
      'rotulo', 'A partir de ' || app_private.brl(p_s.preco) || '. A empresa vai analisar e enviar o orçamento.');
  END IF;
  FOR r IN SELECT * FROM public.servico_regras WHERE servico_id = p_s.id AND ativa ORDER BY ordem LOOP
    tem_regra := true;
    parcela := NULL;
    IF r.pergunta_id IS NOT NULL THEN
      SELECT * INTO q FROM public.servico_perguntas WHERE id = r.pergunta_id;
      v := p_respostas -> r.pergunta_id::text;
      IF v IS NULL OR NOT q.ativa THEN
        faltando := faltando || jsonb_build_array(jsonb_build_object('pergunta_id', r.pergunta_id, 'texto', q.texto));
        CONTINUE;
      END IF;
    END IF;
    CASE r.tipo
      WHEN 'valor_base' THEN parcela := (r.parametros->>'valor_centavos')::numeric / 100;
      WHEN 'por_quantidade' THEN parcela := round((v #>> '{}')::numeric * (r.parametros->>'valor_unitario_centavos')::numeric / 100, 2);
      WHEN 'por_opcao' THEN
        parcela := coalesce((SELECT sum((r.parametros->'valores'->>x)::numeric) FROM jsonb_array_elements_text(
          CASE jsonb_typeof(v) WHEN 'array' THEN v ELSE jsonb_build_array(v) END) x), 0) / 100;
      WHEN 'se_sim' THEN parcela := CASE WHEN (v #>> '{}')::boolean THEN (r.parametros->>'valor_centavos')::numeric / 100 ELSE 0 END;
      WHEN 'minimo' THEN minimo := (r.parametros->>'valor_centavos')::numeric / 100;
    END CASE;
    IF parcela IS NOT NULL THEN
      soma := soma + parcela;
      base := base || jsonb_build_array(jsonb_build_object('rotulo', r.rotulo, 'valor_centavos', app_private.para_centavos(parcela)));
    END IF;
  END LOOP;
  IF NOT tem_regra OR jsonb_array_length(faltando) > 0 THEN
    RETURN jsonb_build_object('completa', false, 'tipo', 'por_regras', 'base', base, 'faltando', faltando,
      'rotulo', CASE WHEN NOT tem_regra THEN 'A empresa ainda não cadastrou regras de cálculo: ela vai analisar e enviar o orçamento.'
                     ELSE 'Faltam informações para estimar: a empresa vai analisar e enviar o orçamento.' END);
  END IF;
  valor := soma;
  IF minimo IS NOT NULL AND valor < minimo THEN
    base := base || jsonb_build_array(jsonb_build_object('rotulo', 'Ajuste ao valor mínimo do serviço', 'valor_centavos', app_private.para_centavos(minimo - valor)));
    valor := minimo;
  END IF;
  IF valor <= 0 THEN
    RETURN jsonb_build_object('completa', false, 'tipo', 'por_regras', 'base', base, 'faltando', '[]'::jsonb,
      'rotulo', 'As regras não chegaram a um valor: a empresa vai analisar e enviar o orçamento.');
  END IF;
  RETURN jsonb_build_object('completa', true, 'tipo', 'por_regras', 'valor_centavos', app_private.para_centavos(valor),
    'minimo_centavos', CASE WHEN p_s.exibicao = 'faixa' THEN app_private.para_centavos(round(valor * (100 - p_s.faixa_percentual) / 100, 2)) END,
    'maximo_centavos', CASE WHEN p_s.exibicao = 'faixa' THEN app_private.para_centavos(round(valor * (100 + p_s.faixa_percentual) / 100, 2)) END,
    'exibicao', p_s.exibicao, 'faixa_percentual', p_s.faixa_percentual, 'base', base, 'faltando', '[]'::jsonb,
    'servico_versao', p_s.versao,
    'rotulo', CASE WHEN p_s.modalidade = 'orcamento_automatico'
      THEN 'Orçamento gerado pelas regras da empresa, sem análise manual.'
      ELSE aviso END);
END $$;

CREATE OR REPLACE FUNCTION app_private.servico_json(p_s public.servicos, p_privado boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', p_s.id, 'empresa_id', p_s.empresa_id, 'nome', p_s.nome, 'descricao', p_s.descricao,
    'categoria_id', p_s.categoria_id, 'categoria', (SELECT nome FROM public.categorias_plataforma WHERE id = p_s.categoria_id),
    'politica_preco', p_s.politica_preco, 'preco_centavos', app_private.para_centavos(p_s.preco), 'duracao_min', p_s.duracao_min,
    'validade_dias', p_s.validade_dias, 'modalidade', p_s.modalidade, 'exibicao', p_s.exibicao, 'faixa_percentual', p_s.faixa_percentual,
    'ativo', p_s.ativo, 'versao', p_s.versao,
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

CREATE OR REPLACE FUNCTION app_private.criar_solicitacao_nucleo(p_s public.servicos, p_origem text, p_cliente_auth text, p_cliente_id uuid,
  p_cliente_nome text, p_dados jsonb, p_usuario text) RETURNS public.solicitacoes_servico
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  sol public.solicitacoes_servico;
  v_resp jsonb;
  v_est jsonb;
  v_num integer;
  v_relato text;
  v_form jsonb;
  v_resp_retrato jsonb;
  ver public.orcamento_versoes;
  b jsonb;
  i integer := 0;
BEGIN
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['respostas', 'relato', 'cidade', 'bairro', 'preferencia']);
  IF NOT p_s.ativo THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este serviço não está disponível no momento.');
  END IF;
  v_relato := app_private.ler_texto(p_dados->>'relato', 10, 2000, 'relato', 'Conte o que você precisa (10 a 2.000 caracteres).');
  IF char_length(p_dados->>'cidade') > 80 OR char_length(p_dados->>'bairro') > 80 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Cidade e bairro têm até 80 caracteres.', 'cidade');
  END IF;
  v_resp := app_private.validar_respostas(p_s.id, p_dados->'respostas', true);
  v_est := app_private.calcular_estimativa(p_s, v_resp);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'ordem', q.ordem, 'texto', q.texto, 'tipo', q.tipo, 'obrigatoria', q.obrigatoria,
      'configuracao', q.configuracao) ORDER BY q.ordem), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('pergunta_id', q.id, 'texto', q.texto, 'tipo', q.tipo, 'valor', v_resp -> q.id::text,
      'unidade', q.configuracao->>'unidade') ORDER BY q.ordem) FILTER (WHERE v_resp ? q.id::text), '[]'::jsonb)
    INTO v_form, v_resp_retrato
    FROM public.servico_perguntas q WHERE q.servico_id = p_s.id AND q.ativa;
  INSERT INTO app_private.contadores_empresa (empresa_id) VALUES (p_s.empresa_id) ON CONFLICT (empresa_id) DO NOTHING;
  UPDATE app_private.contadores_empresa SET proxima_solicitacao = proxima_solicitacao + 1 WHERE empresa_id = p_s.empresa_id
    RETURNING proxima_solicitacao - 1 INTO v_num;
  INSERT INTO public.solicitacoes_servico (empresa_id, numero, servico_id, servico_versao, servico_nome, origem, cliente_auth_id, cliente_id,
    cliente_nome, relato, cidade, bairro, preferencia, formulario, respostas, estimativa, criado_por)
  VALUES (p_s.empresa_id, v_num, p_s.id, p_s.versao, p_s.nome, p_origem, p_cliente_auth, p_cliente_id, p_cliente_nome, v_relato,
    nullif(btrim(coalesce(p_dados->>'cidade', '')), ''), nullif(btrim(coalesce(p_dados->>'bairro', '')), ''),
    app_private.ler_preferencia(p_dados->'preferencia'), v_form, v_resp_retrato, v_est, p_usuario)
  RETURNING * INTO sol;
  PERFORM app_private.evento_solicitacao(sol, 'criada', CASE p_origem WHEN 'plataforma' THEN 'cliente' ELSE 'equipe' END, p_usuario,
    NULL, jsonb_build_object('estimativa', v_est), true);
  -- Orçamento automático (D8-09): só no serviço em que o gestor ligou essa modalidade e só com estimativa completa.
  IF p_s.modalidade = 'orcamento_automatico' AND (v_est->>'completa')::boolean THEN
    INSERT INTO public.orcamento_versoes (empresa_id, solicitacao_id, numero, tipo, estado, valido_ate, condicoes, criada_por, enviada_em)
    VALUES (sol.empresa_id, sol.id, 1, 'automatico', 'rascunho', app_private.hoje_sp() + p_s.validade_dias,
      'Orçamento gerado pelas regras cadastradas pela empresa, sem análise manual.', 'sistema', NULL)
    RETURNING * INTO ver;
    FOR b IN SELECT value FROM jsonb_array_elements(v_est->'base') LOOP
      i := i + 1;
      INSERT INTO public.orcamento_componentes (empresa_id, versao_id, ordem, tipo, descricao, quantidade, valor_unitario, desconto, total)
      VALUES (sol.empresa_id, ver.id, i, 'outro', left(b->>'rotulo', 120), 1, (b->>'valor_centavos')::numeric / 100, 0, (b->>'valor_centavos')::numeric / 100);
    END LOOP;
    UPDATE public.orcamento_versoes SET subtotal = (SELECT sum(total) FROM public.orcamento_componentes WHERE versao_id = ver.id),
      total = (SELECT sum(total) FROM public.orcamento_componentes WHERE versao_id = ver.id), estado = 'enviada', enviada_em = now()
     WHERE id = ver.id RETURNING * INTO ver;
    UPDATE public.solicitacoes_servico SET estado = 'orcamento_enviado', versao_vigente_id = ver.id, versao = versao + 1, atualizado_em = now()
     WHERE id = sol.id RETURNING * INTO sol;
    PERFORM app_private.evento_solicitacao(sol, 'orcamento_automatico', 'sistema', NULL, NULL,
      jsonb_build_object('versao', 1, 'total_centavos', app_private.para_centavos(ver.total), 'valido_ate', ver.valido_ate), true);
  END IF;
  RETURN sol;
END $$;

CREATE OR REPLACE FUNCTION app_private.resumo_periodo(p_empresa uuid, p_de date, p_ate date, p_ver_custo boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  f record;
  v_inicial numeric;
  v_compras uuid := (SELECT id FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND codigo_sistema = 'compras');
  v_vendas numeric;
  v_canceladas numeric;
  v_outras numeric;
  v_despesas numeric;
  v_compras_valor numeric;
  v_cmv numeric;
  v_cmv_estorno numeric;
  v_cob_valor numeric;
  v_cob_total numeric;
  v_receita numeric;
  v_resultado jsonb;
  v_cat_insumos uuid := (SELECT id FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND codigo_sistema = 'insumos');
  v_insumos_compra numeric;
  v_insumos_total numeric;
BEGIN
  SELECT coalesce(sum(CASE WHEN sentido = 'entrada' THEN valor ELSE -valor END), 0) INTO v_inicial
    FROM public.lancamentos_financeiros WHERE empresa_id = p_empresa AND data < p_de;
  SELECT
    coalesce(sum(valor) FILTER (WHERE natureza = 'receita' AND sentido = 'entrada'), 0) AS receitas_entradas,
    coalesce(sum(valor) FILTER (WHERE natureza = 'receita' AND sentido = 'saida'), 0) AS receitas_saidas,
    coalesce(sum(valor) FILTER (WHERE natureza = 'despesa' AND sentido = 'saida'), 0) AS despesas_saidas,
    coalesce(sum(valor) FILTER (WHERE natureza = 'despesa' AND sentido = 'entrada'), 0) AS despesas_entradas,
    coalesce(sum(valor) FILTER (WHERE natureza = 'interna' AND sentido = 'saida'), 0) AS transferido,
    coalesce(sum(valor) FILTER (WHERE natureza = 'interna' AND sentido = 'entrada'), 0) AS transferido_entrada,
    -- Estorno de aporte reduz os aportes; estorno de retirada reduz as retiradas (nunca vira o oposto).
    coalesce(sum(CASE WHEN l.tipo = 'estorno' THEN -valor ELSE valor END) FILTER (WHERE coalesce(o_tipo, l.tipo) = 'aporte'), 0) AS aportes,
    coalesce(sum(CASE WHEN l.tipo = 'estorno' THEN -valor ELSE valor END) FILTER (WHERE coalesce(o_tipo, l.tipo) = 'retirada'), 0) AS retiradas,
    coalesce(sum(CASE WHEN sentido = 'entrada' THEN valor ELSE -valor END) FILTER (WHERE natureza = 'ajuste'), 0) AS ajustes,
    coalesce(sum(CASE WHEN sentido = 'entrada' THEN valor ELSE -valor END) FILTER (WHERE l.tipo = 'ajuste_conferencia'), 0) AS diferencas_caixa
    INTO f FROM (SELECT x.*, (SELECT o.tipo FROM public.lancamentos_financeiros o WHERE o.id = x.estorno_de) AS o_tipo
                   FROM public.lancamentos_financeiros x WHERE x.empresa_id = p_empresa AND x.data BETWEEN p_de AND p_ate) l;

  -- Vendas: entram no mês da confirmação e saem no mês do cancelamento (o mês fechado não muda depois).
  SELECT coalesce(sum(total), 0) INTO v_vendas FROM public.vendas
   WHERE empresa_id = p_empresa AND estado IN ('confirmada', 'cancelada') AND confirmada_em IS NOT NULL
     AND (confirmada_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate;
  SELECT coalesce(sum(total), 0) INTO v_canceladas FROM public.vendas
   WHERE empresa_id = p_empresa AND estado = 'cancelada' AND (cancelada_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate;
  -- Outras receitas: contas a receber manuais pela competência (menos as canceladas no período) e receitas avulsas.
  SELECT coalesce(sum(total) FILTER (WHERE competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(total) FILTER (WHERE estado = 'cancelado' AND (cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_outras FROM public.titulos_financeiros WHERE empresa_id = p_empresa AND tipo = 'receber' AND origem_tipo = 'manual';
  v_outras := v_outras + coalesce((SELECT sum(CASE WHEN l.sentido = 'entrada' THEN l.valor ELSE -l.valor END)
    FROM public.lancamentos_financeiros l LEFT JOIN public.lancamentos_financeiros o ON o.id = l.estorno_de
   WHERE l.empresa_id = p_empresa AND l.data BETWEEN p_de AND p_ate
     AND (l.tipo = 'receita_avulsa' OR o.tipo = 'receita_avulsa')), 0);
  -- Despesas: contas a pagar pela competência (menos canceladas no período) e despesas avulsas, exceto compras de mercadorias.
  SELECT coalesce(sum(total) FILTER (WHERE competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(total) FILTER (WHERE estado = 'cancelado' AND (cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_despesas FROM public.titulos_financeiros
   WHERE empresa_id = p_empresa AND tipo = 'pagar' AND categoria_id IS DISTINCT FROM v_compras;
  v_despesas := v_despesas + coalesce((SELECT sum(CASE WHEN l.sentido = 'saida' THEN l.valor ELSE -l.valor END)
    FROM public.lancamentos_financeiros l LEFT JOIN public.lancamentos_financeiros o ON o.id = l.estorno_de
   WHERE l.empresa_id = p_empresa AND l.data BETWEEN p_de AND p_ate AND l.categoria_id IS DISTINCT FROM v_compras
     AND (l.tipo = 'despesa_avulsa' OR o.tipo = 'despesa_avulsa')), 0);
  -- I7-02 (C): compra mista (categoria "Compras para revenda" com itens de uso interno): a parte dos insumos é despesa
  -- gerencial no mês da compra; a parte de revenda vira CMV quando vendida. Cada centavo entra uma vez só.
  SELECT coalesce(sum(least(app_private.valor_insumos_compra(t.origem_id), t.total)) FILTER (WHERE t.competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(least(app_private.valor_insumos_compra(t.origem_id), t.total))
           FILTER (WHERE t.estado = 'cancelado' AND (t.cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_insumos_compra FROM public.titulos_financeiros t
   WHERE t.empresa_id = p_empresa AND t.tipo = 'pagar' AND t.origem_tipo = 'compra' AND t.categoria_id = v_compras;
  v_despesas := v_despesas + v_insumos_compra;
  -- Total de insumos reconhecidos no período (informativo; já está dentro das despesas).
  SELECT v_insumos_compra
       + coalesce(sum(total) FILTER (WHERE competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(total) FILTER (WHERE estado = 'cancelado' AND (cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_insumos_total FROM public.titulos_financeiros
   WHERE empresa_id = p_empresa AND tipo = 'pagar' AND categoria_id = v_cat_insumos;
  v_insumos_total := v_insumos_total + coalesce((SELECT sum(CASE WHEN l.sentido = 'saida' THEN l.valor ELSE -l.valor END)
    FROM public.lancamentos_financeiros l LEFT JOIN public.lancamentos_financeiros o ON o.id = l.estorno_de
   WHERE l.empresa_id = p_empresa AND l.data BETWEEN p_de AND p_ate AND l.categoria_id = v_cat_insumos
     AND (l.tipo = 'despesa_avulsa' OR o.tipo = 'despesa_avulsa')), 0);
  SELECT coalesce(sum(total) FILTER (WHERE competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(total) FILTER (WHERE estado = 'cancelado' AND (cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_compras_valor FROM public.titulos_financeiros WHERE empresa_id = p_empresa AND tipo = 'pagar' AND categoria_id = v_compras;
  v_compras_valor := v_compras_valor - v_insumos_compra;   -- só a parte de revenda (a de insumos já está nas despesas)
  v_receita := v_vendas - v_canceladas + v_outras;

  IF p_ver_custo THEN
    -- D7-15: custo do momento da venda; itens sem custo reduzem a cobertura e o resultado é chamado de parcial.
    SELECT coalesce(sum(vi.custo_unitario * vi.quantidade), 0), coalesce(sum(vi.valor) FILTER (WHERE vi.custo_unitario IS NOT NULL), 0),
           coalesce(sum(vi.valor), 0)
      INTO v_cmv, v_cob_valor, v_cob_total
      FROM public.venda_itens vi JOIN public.vendas v ON v.id = vi.venda_id
     WHERE v.empresa_id = p_empresa AND v.estado IN ('confirmada', 'cancelada') AND v.confirmada_em IS NOT NULL
       AND (v.confirmada_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate;
    SELECT coalesce(sum(vi.custo_unitario * vi.quantidade), 0) INTO v_cmv_estorno
      FROM public.venda_itens vi JOIN public.vendas v ON v.id = vi.venda_id
     WHERE v.empresa_id = p_empresa AND v.estado = 'cancelada' AND vi.destino_cancelamento IN ('voltou', 'nao_entregue')
       AND (v.cancelada_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate;
    v_cmv := v_cmv - v_cmv_estorno;
    v_resultado := jsonb_build_object('disponivel', true,
      'receita_vendas_centavos', app_private.para_centavos(v_vendas),
      'vendas_canceladas_centavos', app_private.para_centavos(v_canceladas),
      'outras_receitas_centavos', app_private.para_centavos(v_outras),
      'custo_mercadorias_vendidas_centavos', app_private.para_centavos(v_cmv),
      'margem_bruta_centavos', app_private.para_centavos(v_vendas - v_canceladas - v_cmv),
      'despesas_centavos', app_private.para_centavos(v_despesas),
      'resultado_estimado_centavos', app_private.para_centavos(v_receita - v_cmv - v_despesas),
      'compras_mercadorias_centavos', app_private.para_centavos(v_compras_valor),
      'compras_revenda_centavos', app_private.para_centavos(v_compras_valor), 'insumos_centavos', app_private.para_centavos(v_insumos_total),
      'reconhecimento_insumos', 'compra',
      'cobertura_custo_percentual', CASE WHEN v_cob_total = 0 THEN NULL ELSE round(100 * v_cob_valor / v_cob_total, 1) END,
      'parcial', v_cob_total > 0 AND v_cob_valor < v_cob_total);
  ELSE
    v_resultado := jsonb_build_object('disponivel', false,
      'motivo', 'O resultado usa o custo das mercadorias vendidas, e seu acesso não permite ver custos.',
      'receita_vendas_centavos', app_private.para_centavos(v_vendas),
      'vendas_canceladas_centavos', app_private.para_centavos(v_canceladas),
      'outras_receitas_centavos', app_private.para_centavos(v_outras),
      'despesas_centavos', app_private.para_centavos(v_despesas),
      'compras_mercadorias_centavos', app_private.para_centavos(v_compras_valor),
      'compras_revenda_centavos', app_private.para_centavos(v_compras_valor), 'insumos_centavos', app_private.para_centavos(v_insumos_total),
      'reconhecimento_insumos', 'compra');
  END IF;
  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'fluxo', jsonb_build_object(
      'saldo_inicial_centavos', app_private.para_centavos(v_inicial),
      'receitas_recebidas_centavos', app_private.para_centavos(f.receitas_entradas),
      'devolucoes_e_estornos_de_receita_centavos', app_private.para_centavos(f.receitas_saidas),
      'despesas_pagas_centavos', app_private.para_centavos(f.despesas_saidas),
      'estornos_de_despesa_centavos', app_private.para_centavos(f.despesas_entradas),
      'transferido_entre_contas_centavos', app_private.para_centavos(f.transferido),
      'aportes_centavos', app_private.para_centavos(f.aportes),
      'retiradas_centavos', app_private.para_centavos(f.retiradas),
      'ajustes_centavos', app_private.para_centavos(f.ajustes),
      'diferencas_caixa_centavos', app_private.para_centavos(f.diferencas_caixa),
      'saldos_iniciais_centavos', app_private.para_centavos(f.ajustes - f.diferencas_caixa),
      'variacao_operacional_centavos', app_private.para_centavos(f.receitas_entradas - f.receitas_saidas - f.despesas_saidas + f.despesas_entradas),
      'saldo_final_centavos', app_private.para_centavos(v_inicial + f.receitas_entradas - f.receitas_saidas - f.despesas_saidas
        + f.despesas_entradas + f.transferido_entrada - f.transferido + f.aportes - f.retiradas + f.ajustes),
      'metodo', 'Regime de caixa: soma do que entrou e saiu das contas, pela data de cada lançamento. Transferências entre contas '
        || 'não mudam o total; aportes e retiradas do proprietário aparecem separados e não são receita nem despesa.'),
    'resultado', v_resultado || jsonb_build_object(
      'metodo', 'Competência simplificada: vendas confirmadas no período (canceladas saem no mês do cancelamento), mais outras '
        || 'receitas, menos o custo das mercadorias vendidas (custo informado no momento da venda) e as despesas do mês de '
        || 'referência. Mercadorias para revenda viram custo quando vendidas; insumos de uso interno são despesa gerencial no mês '
        || 'da compra (reconhecimento na compra, adotado no MVP); o mesmo custo nunca entra duas vezes. Diferenças de conferência '
        || 'de caixa aparecem no fluxo de caixa e no relatório de conferências, não no resultado. Transferências, aportes e retiradas '
        || 'não entram. Custos indiretos não são rateados.',
      'aviso', 'Estimativa gerencial. Não é contabilidade oficial nem substitui um contador.'));
END $$;

CREATE OR REPLACE FUNCTION public.registrar_devolucao_valor(p_titulo_id uuid, p_valor_centavos bigint, p_forma text, p_motivo text,
  p_operation_key text, p_conta_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_titulo_id, p_valor_centavos, p_forma, p_motivo, p_conta_id));
  anterior jsonb;
  t public.titulos_financeiros;
  c public.contas_financeiras;
  v_valor numeric;
  v_id uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_devolucao_valor', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO t FROM public.titulos_financeiros WHERE id = p_titulo_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Registro financeiro não encontrado.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = t.empresa_id AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  IF NOT (app_private.tem(t.empresa_id, usuario, 'vendas.registrar_recebimento') OR app_private.tem(t.empresa_id, usuario, 'financeiro.aprovar')) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite registrar devoluções de valor.');
  END IF;
  IF t.estado <> 'cancelado' OR t.origem_tipo <> 'venda' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só há devolução de valor em venda cancelada.');
  END IF;
  IF p_valor_centavos IS NULL OR p_valor_centavos <= 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um valor maior que zero.', 'valor_centavos');
  END IF;
  v_valor := round(p_valor_centavos::numeric / 100, 2);
  IF v_valor > t.a_devolver THEN
    PERFORM app_private.erro('PAYMENT_EXCEEDS_BALANCE',
      format('O valor passa do que falta devolver (R$ %s).', to_char(t.a_devolver, 'FM999G999G990D00')), 'valor_centavos');
  END IF;
  IF p_forma IS NULL OR p_forma NOT IN ('dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia', 'outro') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha a forma da devolução.', 'forma');
  END IF;
  c := app_private.conta_valida(t.empresa_id, coalesce(p_conta_id, app_private.conta_caixa(t.empresa_id)));
  INSERT INTO public.recebimentos (empresa_id, titulo_id, parcela_id, conta_id, tipo, valor, forma, data, motivo, autor, operation_key)
  VALUES (t.empresa_id, t.id, NULL, c.id, 'devolucao', v_valor, p_forma, app_private.hoje_sp(),
    nullif(btrim(coalesce(p_motivo, '')), ''), usuario, p_operation_key) RETURNING id INTO v_id;
  UPDATE public.titulos_financeiros SET a_devolver = a_devolver - v_valor, versao = versao + 1 WHERE id = t.id;
  PERFORM app_private.evento_comercial(t.empresa_id, 'valor_devolvido', usuario, 'titulo', t.id,
    jsonb_build_object('valor_centavos', p_valor_centavos, 'forma', p_forma, 'conta', c.nome), p_operation_key);
  PERFORM app_private.auditar(t.empresa_id, usuario, 'venda.valor_devolvido', 'recebimentos', v_id,
    jsonb_build_object('valor_centavos', p_valor_centavos, 'conta_id', c.id));
  RETURN app_private.idem_fim(usuario, 'registrar_devolucao_valor', p_operation_key, assinatura,
    jsonb_build_object('id', v_id, 'a_devolver_centavos', app_private.para_centavos(t.a_devolver - v_valor)));
END $$;

CREATE OR REPLACE FUNCTION public.cancelar_titulo(p_titulo_id uuid, p_motivo text, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_titulo_id, p_motivo, p_expected_version));
  anterior jsonb;
  t public.titulos_financeiros;
  v_motivo text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'cancelar_titulo', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO t FROM public.titulos_financeiros WHERE id = p_titulo_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Conta não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(t.empresa_id, usuario, ARRAY['financeiro.cancelar']);
  IF t.origem_tipo = 'venda' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A conta de uma venda é cancelada pela própria venda.');
  END IF;
  IF t.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta conta mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF t.estado = 'cancelado' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta conta já foi cancelada.');
  END IF;
  IF t.recebido > 0 THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE t.tipo WHEN 'pagar' THEN 'Há pagamentos registrados. Estorne-os antes de cancelar.'
      ELSE 'Há recebimentos registrados. Estorne-os antes de cancelar.' END);
  END IF;
  v_motivo := app_private.ler_texto(p_motivo, 10, 300, 'motivo', 'Explique o cancelamento (10 a 300 caracteres).');
  UPDATE public.parcelas_financeiras SET estado = 'cancelada', versao = versao + 1 WHERE titulo_id = t.id;
  UPDATE public.titulos_financeiros SET estado = 'cancelado', cancelado_em = now(), cancelado_por = usuario, motivo_cancelamento = v_motivo,
    versao = versao + 1 WHERE id = t.id;
  PERFORM app_private.auditar(t.empresa_id, usuario, 'financeiro.titulo_cancelado', 'titulos_financeiros', t.id, jsonb_build_object('motivo', v_motivo));
  RETURN app_private.idem_fim(usuario, 'cancelar_titulo', p_operation_key, assinatura, app_private.titulo_json(t.id));
END $$;


DROP FUNCTION public.reconciliar_os(uuid);
DROP FUNCTION public.cancelar_horario_os(uuid, text, text);
DROP FUNCTION public.retirar_reagendamento(uuid, text);
DROP FUNCTION public.responder_reagendamento(uuid, boolean, text, boolean, text, text);
DROP FUNCTION public.pedir_reagendamento_os(uuid, timestamptz, integer, text, text, text);
DROP FUNCTION public.propor_horario_os(uuid, timestamptz, integer, text, boolean, text, boolean, text);
DROP FUNCTION public.agenda_operacional(uuid, date, date, text);
DROP FUNCTION public.salvar_itens_pacote(uuid, uuid[], integer, text);
DROP FUNCTION public.gerar_proxima_os(uuid, text);
DROP FUNCTION public.gerar_titulo_custos(uuid, date, text);
DROP FUNCTION public.registrar_acordo_custos(uuid, bigint, text, boolean, integer, text);
DROP FUNCTION public.retirar_custos(uuid, text, integer, text);
DROP FUNCTION public.revisar_custos(uuid, jsonb, text, integer, text);
DROP FUNCTION public.responder_custos(uuid, boolean, text, integer, text);
DROP FUNCTION public.propor_custos_cancelamento(uuid, jsonb, text, text);
DROP FUNCTION public.cancelar_os(uuid, text, boolean, text);
DROP FUNCTION public.salvar_politica_cancelamento(uuid, text, text);
DROP FUNCTION public.politica_cancelamento(uuid);
DROP FUNCTION public.reparcelar_titulo_os(uuid, jsonb, text);
DROP FUNCTION public.gerar_antecipacao_os(uuid, bigint, date, text);
DROP FUNCTION public.devolver_material_os(uuid, integer, text, text);
DROP FUNCTION public.decidir_uso_material(uuid, boolean, text, integer, text);
DROP FUNCTION public.registrar_uso_material(uuid, uuid, integer, text, text);
DROP FUNCTION public.reservar_material_os(uuid, boolean, text);
DROP FUNCTION public.adicionar_material_os(uuid, uuid, integer, text);
DROP FUNCTION public.registrar_garantia_os(uuid, integer, text, text);
DROP FUNCTION public.atualizar_dados_os(uuid, jsonb, integer, text);
DROP FUNCTION public.publicar_atualizacao_os(uuid, text, boolean, text);
DROP FUNCTION public.pedir_revisao_os(uuid, text, text);
DROP FUNCTION public.confirmar_recebimento_servico(uuid, text);
DROP FUNCTION public.mudar_estado_os(uuid, text, text, integer, text);
DROP FUNCTION public.minha_os(uuid);
DROP FUNCTION public.minhas_os();
DROP FUNCTION public.os_detalhe(uuid);
DROP FUNCTION public.ordens_da_empresa(uuid, jsonb, integer, integer);
DROP FUNCTION app_private.reconciliacao_os(uuid);
DROP FUNCTION app_private.proposta_custos_trava(uuid);
DROP FUNCTION app_private.inserir_proposta_custos(public.ordens_servico, public.cancelamentos_os, jsonb, text, text);
DROP FUNCTION app_private.aplicar_horario(public.ordens_servico, public.reagendamentos, text);
DROP FUNCTION app_private.validar_horario(timestamptz, integer);
DROP FUNCTION app_private.cancelar_titulos_os(public.ordens_servico, text, text);
DROP FUNCTION app_private.confirmar_uso(public.os_material_usos, text, text);
DROP FUNCTION app_private.liberar_reservas_os(public.ordens_servico, text, text);
DROP FUNCTION app_private.criar_os(public.solicitacoes_servico, public.orcamento_versoes, text, text);
DROP FUNCTION app_private.os_json(uuid, boolean, boolean);
DROP FUNCTION app_private.os_encerramento(public.ordens_servico);
DROP FUNCTION app_private.os_resumo(uuid, boolean);
DROP FUNCTION app_private.os_materiais_json(uuid, boolean);
DROP FUNCTION app_private.os_valores(uuid, boolean);
DROP FUNCTION app_private.criar_titulo_os(public.ordens_servico, text, uuid, text, text, jsonb, text);
DROP FUNCTION app_private.categoria_servicos(uuid);
DROP FUNCTION app_private.os_ativa(public.ordens_servico);
DROP FUNCTION app_private.papel_na_os(public.ordens_servico, text, text);
DROP FUNCTION app_private.os_evento(public.ordens_servico, text, text, text, text, text, text, jsonb, boolean);
DROP FUNCTION app_private.os_trava(uuid);

-- Os registros de auditoria da carga ficam (auditoria é imutável); apontam para OS que deixam de existir.
DROP TABLE public.reagendamentos, public.propostas_custo_cancelamento, public.cancelamentos_os, public.os_material_usos,
  public.os_materiais, public.os_eventos;
ALTER TABLE public.solicitacoes_servico DROP CONSTRAINT solicitacoes_origem_os_fk;
DROP INDEX public.solicitacoes_uma_por_os;
ALTER TABLE public.solicitacoes_servico DROP COLUMN origem_os_id;
DROP TABLE public.ordens_servico, public.politicas_cancelamento, public.servico_pacote_itens;

DROP INDEX public.titulos_servico_parte_unica;
DROP INDEX public.titulos_custo_cancelamento_unico;
ALTER TABLE public.titulos_financeiros DROP CONSTRAINT titulos_parte_servico;
ALTER TABLE public.titulos_financeiros DROP CONSTRAINT titulos_tipo_origem;
ALTER TABLE public.titulos_financeiros ADD CONSTRAINT titulos_tipo_origem CHECK ((origem_tipo = 'venda' AND tipo = 'receber')
    OR (origem_tipo IN ('compra', 'recorrencia') AND tipo = 'pagar') OR origem_tipo = 'manual');
ALTER TABLE public.titulos_financeiros DROP CONSTRAINT titulos_financeiros_origem_tipo_check;
ALTER TABLE public.titulos_financeiros ADD CONSTRAINT titulos_financeiros_origem_tipo_check
  CHECK (origem_tipo IN ('venda', 'manual', 'compra', 'recorrencia'));
ALTER TABLE public.titulos_financeiros DROP COLUMN parte_servico;

ALTER TABLE public.categorias_financeiras DROP CONSTRAINT categorias_sistema_tipo;
ALTER TABLE public.categorias_financeiras DROP CONSTRAINT categorias_financeiras_codigo_sistema_check;
ALTER TABLE public.categorias_financeiras ADD CONSTRAINT categorias_financeiras_codigo_sistema_check
  CHECK (codigo_sistema IN ('vendas', 'compras', 'insumos'));
ALTER TABLE public.categorias_financeiras ADD CONSTRAINT categorias_sistema_tipo CHECK (codigo_sistema IS NULL
  OR (codigo_sistema = 'vendas' AND tipo = 'receita') OR (codigo_sistema IN ('compras', 'insumos') AND tipo = 'despesa'));


ALTER TABLE public.movimentacoes_estoque DROP CONSTRAINT movimentacoes_estoque_origem_tipo_check;
ALTER TABLE public.movimentacoes_estoque ADD CONSTRAINT movimentacoes_estoque_origem_tipo_check
  CHECK (origem_tipo IN ('proposta', 'estorno', 'reserva', 'venda', 'devolucao_venda'));


ALTER TABLE public.servicos DROP CONSTRAINT servicos_preco_politica;
ALTER TABLE public.servicos DROP CONSTRAINT servicos_politica_preco_check;
ALTER TABLE public.servicos ADD CONSTRAINT servicos_politica_preco_check
  CHECK (politica_preco IN ('fixo', 'a_partir_de', 'sob_consulta', 'por_regras'));
ALTER TABLE public.servicos ADD CONSTRAINT servicos_preco_politica CHECK (
       (politica_preco IN ('fixo', 'a_partir_de') AND preco IS NOT NULL)
    OR (politica_preco = 'sob_consulta' AND preco IS NULL)
    OR (politica_preco = 'por_regras'));

ALTER TABLE app_private.contadores_empresa DROP COLUMN proxima_os;
DELETE FROM app_private.limites_plataforma WHERE chave IN ('reagendamentos_pendentes_por_os', 'reagendamentos_por_os');
DELETE FROM app_private.historico_migracoes WHERE id = '202611130001';

COMMIT;
