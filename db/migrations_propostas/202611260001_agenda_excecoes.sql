-- 202611260001_agenda_excecoes: E04 (evolução integrada). Exceções da agenda por data.
-- 1) Feriados, fechamentos e horários especiais de um dia, por empresa (substituem a grade semanal só naquele dia).
-- 2) Os avisos de conflito ao marcar horário passam a considerar a exceção: dia fechado avisa com o motivo;
--    horário especial vale no lugar da grade daquele dia.
-- Sem agenda por funcionário nem bloqueio automático: como antes, o aviso exige confirmação explícita para gravar.
BEGIN;

CREATE TABLE public.excecoes_agenda (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas (id),
  data          date NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('fechado', 'horario_especial')),
  intervalos    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(intervalos) = 'array' AND jsonb_array_length(intervalos) <= 2),
  motivo        text NOT NULL CHECK (char_length(motivo) BETWEEN 2 AND 120),
  criado_por    text NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, data),
  CHECK ((tipo = 'fechado') = (jsonb_array_length(intervalos) = 0))
);
ALTER TABLE public.excecoes_agenda ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.excecoes_agenda FROM PUBLIC, anonymous, authenticated;

CREATE FUNCTION app_private.excecao_json(x public.excecoes_agenda) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', x.id, 'data', x.data, 'tipo', x.tipo, 'intervalos', x.intervalos, 'motivo', x.motivo,
    'criado_por', app_private.nome_da_pessoa(x.criado_por), 'atualizado_em', x.atualizado_em)
$$;

CREATE FUNCTION public.excecoes_agenda(p_empresa_id uuid, p_de date DEFAULT NULL, p_ate date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_de date := coalesce(p_de, app_private.hoje_sp());
  v_ate date := coalesce(p_ate, coalesce(p_de, app_private.hoje_sp()) + 365);
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['agenda.visualizar']);
  IF v_ate < v_de OR v_ate - v_de > 400 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha um período de até 400 dias.', 'ate');
  END IF;
  RETURN coalesce((SELECT jsonb_agg(app_private.excecao_json(x) ORDER BY x.data) FROM public.excecoes_agenda x
                    WHERE x.empresa_id = p_empresa_id AND x.data BETWEEN v_de AND v_ate), '[]'::jsonb);
END $$;

-- Cria ou substitui a exceção de um dia (um registro por data). Só para hoje em diante.
CREATE FUNCTION public.salvar_excecao_agenda(p_empresa_id uuid, p_data date, p_tipo text, p_intervalos jsonb, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_data, p_tipo, p_intervalos::text, p_motivo));
  anterior jsonb;
  v_intervalos jsonb := '[]'::jsonb;
  v_motivo text;
  iv jsonb;
  v_abre time;
  v_fecha time;
  v_ant time;
  x public.excecoes_agenda;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'salvar_excecao_agenda', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['agenda.alterar']);
  IF p_data IS NULL OR p_data < app_private.hoje_sp() OR p_data > app_private.hoje_sp() + 730 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha uma data de hoje até dois anos à frente.', 'data');
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('fechado', 'horario_especial') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha se o dia fica fechado ou com horário especial.', 'tipo');
  END IF;
  v_motivo := app_private.ler_texto(p_motivo, 2, 120, 'motivo', 'Diga o motivo (2 a 120 caracteres), por exemplo "Feriado municipal".');
  IF p_tipo = 'horario_especial' THEN
    IF p_intervalos IS NULL OR jsonb_typeof(p_intervalos) <> 'array' OR jsonb_array_length(p_intervalos) NOT BETWEEN 1 AND 2 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um ou dois intervalos de atendimento.', 'intervalos');
    END IF;
    FOR iv IN SELECT value FROM jsonb_array_elements(p_intervalos) LOOP
      BEGIN
        v_abre := (iv->>'abre')::time;
        v_fecha := (iv->>'fecha')::time;
      EXCEPTION WHEN others THEN
        PERFORM app_private.erro('VALIDATION_ERROR', 'Horário inválido: use HH:MM.', 'intervalos');
      END;
      IF v_abre IS NULL OR v_fecha IS NULL OR v_abre >= v_fecha OR (v_ant IS NOT NULL AND v_abre < v_ant) THEN
        PERFORM app_private.erro('VALIDATION_ERROR', 'Cada intervalo abre antes de fechar, e o segundo começa depois do primeiro.', 'intervalos');
      END IF;
      v_intervalos := v_intervalos || jsonb_build_array(jsonb_build_object('abre', to_char(v_abre, 'HH24:MI'), 'fecha', to_char(v_fecha, 'HH24:MI')));
      v_ant := v_fecha;
    END LOOP;
  END IF;
  IF (SELECT count(*) FROM public.excecoes_agenda WHERE empresa_id = p_empresa_id AND data >= app_private.hoje_sp()) >= 200
     AND NOT EXISTS (SELECT 1 FROM public.excecoes_agenda WHERE empresa_id = p_empresa_id AND data = p_data) THEN
    PERFORM app_private.erro('LIMIT_REACHED', 'A empresa já tem 200 exceções futuras. Remova alguma antes de criar outra.');
  END IF;
  INSERT INTO public.excecoes_agenda AS e (empresa_id, data, tipo, intervalos, motivo, criado_por)
  VALUES (p_empresa_id, p_data, p_tipo, v_intervalos, v_motivo, usuario)
  ON CONFLICT (empresa_id, data) DO UPDATE SET tipo = EXCLUDED.tipo, intervalos = EXCLUDED.intervalos, motivo = EXCLUDED.motivo,
    criado_por = EXCLUDED.criado_por, atualizado_em = now()
  RETURNING * INTO x;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'agenda.excecao_salva', 'excecoes_agenda', x.id,
    jsonb_build_object('data', x.data, 'tipo', x.tipo));
  RETURN app_private.idem_fim(usuario, 'salvar_excecao_agenda', p_operation_key, assinatura, app_private.excecao_json(x));
END $$;

CREATE FUNCTION public.remover_excecao_agenda(p_excecao_id uuid, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  anterior jsonb;
  x public.excecoes_agenda;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'remover_excecao_agenda', p_operation_key, p_excecao_id::text);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO x FROM public.excecoes_agenda WHERE id = p_excecao_id FOR UPDATE;
  IF NOT FOUND OR NOT app_private.eh_membro(x.empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Exceção não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(x.empresa_id, usuario, ARRAY['agenda.alterar']);
  DELETE FROM public.excecoes_agenda WHERE id = x.id;
  PERFORM app_private.auditar(x.empresa_id, usuario, 'agenda.excecao_removida', 'excecoes_agenda', x.id,
    jsonb_build_object('data', x.data, 'tipo', x.tipo));
  RETURN app_private.idem_fim(usuario, 'remover_excecao_agenda', p_operation_key, p_excecao_id::text,
    jsonb_build_object('id', x.id, 'removida', true));
END $$;

-- Avisos de conflito com a exceção do dia (fechado avisa com o motivo; horário especial substitui a grade daquele dia).
CREATE OR REPLACE FUNCTION app_private.avisos_horario(p_empresa uuid, p_solicitacao uuid, p_inicio timestamptz, p_fim timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  avisos jsonb := '[]'::jsonb;
  ini timestamp := p_inicio AT TIME ZONE 'America/Sao_Paulo';
  fim timestamp := p_fim AT TIME ZONE 'America/Sao_Paulo';
  conflito record;
  x public.excecoes_agenda;
BEGIN
  SELECT * INTO x FROM public.excecoes_agenda e WHERE e.empresa_id = p_empresa AND e.data = ini::date;
  IF x.id IS NOT NULL AND x.tipo = 'fechado' THEN
    avisos := avisos || jsonb_build_array(jsonb_build_object('tipo', 'dia_fechado',
      'mensagem', format('A empresa marcou %s como fechado (%s).', to_char(x.data, 'DD/MM'), x.motivo)));
  ELSIF x.id IS NOT NULL THEN
    IF ini::date <> (fim - interval '1 microsecond')::date OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(x.intervalos) iv
          WHERE ini::time >= (iv->>'abre')::time AND (fim - interval '1 microsecond')::time < (iv->>'fecha')::time) THEN
      avisos := avisos || jsonb_build_array(jsonb_build_object('tipo', 'fora_do_horario',
        'mensagem', format('O horário fica fora do horário especial de %s (%s).', to_char(x.data, 'DD/MM'), x.motivo)));
    END IF;
  ELSIF ini::date <> (fim - interval '1 microsecond')::date OR NOT EXISTS (
       SELECT 1 FROM public.horarios_empresa h WHERE h.empresa_id = p_empresa AND h.dia_semana = extract(dow FROM ini)::integer
          AND ini::time >= h.abre AND (fim - interval '1 microsecond')::time < h.fecha) THEN
    avisos := avisos || jsonb_build_array(jsonb_build_object('tipo', 'fora_do_horario',
      'mensagem', 'O horário fica fora do horário de atendimento cadastrado para esse dia.'));
  END IF;
  FOR conflito IN SELECT a.inicio, a.fim, s.numero FROM public.agendamentos a JOIN public.solicitacoes_servico s ON s.id = a.solicitacao_id
                   WHERE a.empresa_id = p_empresa AND a.estado = 'confirmado' AND a.solicitacao_id <> p_solicitacao
                     AND a.inicio < p_fim AND a.fim > p_inicio ORDER BY a.inicio LIMIT 5 LOOP
    avisos := avisos || jsonb_build_array(jsonb_build_object('tipo', 'sobreposicao', 'solicitacao_numero', conflito.numero,
      'mensagem', format('Sobrepõe o horário da solicitação nº %s (%s a %s).', conflito.numero,
        to_char(conflito.inicio AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'), to_char(conflito.fim AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'))));
  END LOOP;
  RETURN avisos;
END $$;

REVOKE ALL ON FUNCTION app_private.excecao_json(public.excecoes_agenda) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.excecoes_agenda(uuid, date, date), public.salvar_excecao_agenda(uuid, date, text, jsonb, text, text),
  public.remover_excecao_agenda(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.excecoes_agenda(uuid, date, date), public.salvar_excecao_agenda(uuid, date, text, jsonb, text, text),
  public.remover_excecao_agenda(uuid, text) TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611260001', 'E04: exceções da agenda por data (fechado ou horário especial), consideradas nos avisos de conflito ao marcar horário');

COMMIT;
