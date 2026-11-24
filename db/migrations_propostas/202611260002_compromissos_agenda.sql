-- 202611260002_compromissos_agenda: E04 (evolução integrada). Compromissos internos da agenda.
-- 1) Compromisso avulso da empresa (visita, reunião, bloqueio de horário), sem solicitação nem OS, com responsável opcional.
-- 2) Proteção contra conflito: ao criar ou mudar um compromisso, sobreposição com horários confirmados, outros compromissos
--    e fora do horário de atendimento (grade ou exceção) gera avisos; sem confirmação explícita, nada é gravado.
-- 3) Os avisos ao marcar horário de solicitação ou OS passam a considerar também os compromissos internos.
BEGIN;

CREATE TABLE public.compromissos_agenda (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas (id),
  tipo            text NOT NULL CHECK (tipo IN ('compromisso', 'bloqueio')),
  titulo          text NOT NULL CHECK (char_length(titulo) BETWEEN 2 AND 120),
  observacao      text CHECK (char_length(observacao) <= 500),
  inicio          timestamptz NOT NULL,
  fim             timestamptz NOT NULL,
  responsavel_auth_id text,
  estado          text NOT NULL DEFAULT 'ativo' CHECK (estado IN ('ativo', 'cancelado')),
  avisos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  versao          integer NOT NULL DEFAULT 1,
  criado_por      text NOT NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  cancelado_por   text,
  CHECK (fim > inicio AND fim - inicio <= interval '12 hours')
);
CREATE INDEX compromissos_agenda_periodo ON public.compromissos_agenda (empresa_id, inicio) WHERE estado = 'ativo';
ALTER TABLE public.compromissos_agenda ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.compromissos_agenda FROM PUBLIC, anonymous, authenticated;

CREATE FUNCTION app_private.compromisso_json(c public.compromissos_agenda) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', c.id, 'tipo', c.tipo, 'titulo', c.titulo, 'observacao', c.observacao, 'inicio', c.inicio, 'fim', c.fim,
    'responsavel_auth_id', c.responsavel_auth_id, 'responsavel', app_private.nome_da_pessoa(c.responsavel_auth_id), 'estado', c.estado,
    'avisos', c.avisos, 'versao', c.versao, 'criado_por', app_private.nome_da_pessoa(c.criado_por), 'criado_em', c.criado_em)
$$;

-- Avisos ao marcar horário de solicitação ou OS: os de antes (grade, exceção, sobreposição) mais compromissos internos ativos.
CREATE FUNCTION app_private.avisos_agenda(p_empresa uuid, p_solicitacao uuid, p_compromisso uuid, p_inicio timestamptz, p_fim timestamptz) RETURNS jsonb
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
                   WHERE a.empresa_id = p_empresa AND a.estado = 'confirmado' AND a.solicitacao_id IS DISTINCT FROM p_solicitacao
                     AND a.inicio < p_fim AND a.fim > p_inicio ORDER BY a.inicio LIMIT 5 LOOP
    avisos := avisos || jsonb_build_array(jsonb_build_object('tipo', 'sobreposicao', 'solicitacao_numero', conflito.numero,
      'mensagem', format('Sobrepõe o horário da solicitação nº %s (%s a %s).', conflito.numero,
        to_char(conflito.inicio AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'), to_char(conflito.fim AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'))));
  END LOOP;
  FOR conflito IN SELECT c.titulo, c.tipo, c.inicio, c.fim FROM public.compromissos_agenda c
                   WHERE c.empresa_id = p_empresa AND c.estado = 'ativo' AND c.id IS DISTINCT FROM p_compromisso
                     AND c.inicio < p_fim AND c.fim > p_inicio ORDER BY c.inicio LIMIT 5 LOOP
    avisos := avisos || jsonb_build_array(jsonb_build_object('tipo', CASE WHEN conflito.tipo = 'bloqueio' THEN 'bloqueio' ELSE 'compromisso' END,
      'mensagem', format('%s "%s" (%s a %s).', CASE WHEN conflito.tipo = 'bloqueio' THEN 'Horário bloqueado:' ELSE 'Sobrepõe o compromisso' END, conflito.titulo,
        to_char(conflito.inicio AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'), to_char(conflito.fim AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'))));
  END LOOP;
  RETURN avisos;
END $$;

-- Quem já chamava continua chamando avisos_horario (solicitação e OS); o compromisso usa avisos_agenda ignorando a si mesmo.
CREATE OR REPLACE FUNCTION app_private.avisos_horario(p_empresa uuid, p_solicitacao uuid, p_inicio timestamptz, p_fim timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT app_private.avisos_agenda(p_empresa, p_solicitacao, NULL, p_inicio, p_fim) $$;

CREATE FUNCTION public.compromissos_agenda(p_empresa_id uuid, p_de date, p_ate date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['agenda.visualizar']);
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de OR p_ate - p_de > 62 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha um período de até 62 dias.', 'ate');
  END IF;
  RETURN coalesce((SELECT jsonb_agg(app_private.compromisso_json(c) ORDER BY c.inicio) FROM public.compromissos_agenda c
                    WHERE c.empresa_id = p_empresa_id AND c.estado = 'ativo'
                      AND (c.inicio AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), '[]'::jsonb);
END $$;

-- Cria (p_compromisso_id NULL) ou altera um compromisso. Com avisos e sem p_aceitar_avisos, devolve os avisos e não grava.
CREATE FUNCTION public.salvar_compromisso_agenda(p_empresa_id uuid, p_compromisso_id uuid, p_dados jsonb, p_aceitar_avisos boolean,
  p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_compromisso_id, p_dados::text, p_aceitar_avisos, p_expected_version));
  anterior jsonb;
  c public.compromissos_agenda;
  v_tipo text := coalesce(p_dados->>'tipo', 'compromisso');
  v_titulo text;
  v_obs text := nullif(btrim(coalesce(p_dados->>'observacao', '')), '');
  v_resp text := nullif(p_dados->>'responsavel_auth_id', '');
  v_inicio timestamptz;
  v_fim timestamptz;
  v_avisos jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'salvar_compromisso_agenda', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['agenda.alterar']);
  IF v_tipo NOT IN ('compromisso', 'bloqueio') THEN PERFORM app_private.erro('VALIDATION_ERROR', 'Tipo de compromisso inválido.', 'tipo'); END IF;
  v_titulo := app_private.ler_texto(p_dados->>'titulo', 2, 120, 'titulo', 'Dê um título (2 a 120 caracteres).');
  IF char_length(v_obs) > 500 THEN PERFORM app_private.erro('VALIDATION_ERROR', 'A observação tem até 500 caracteres.', 'observacao'); END IF;
  BEGIN
    v_inicio := (p_dados->>'inicio')::timestamptz;
    v_fim := v_inicio + make_interval(mins => (p_dados->>'duracao_min')::integer);
  EXCEPTION WHEN others THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe data, hora e duração válidas.', 'inicio');
  END;
  IF v_inicio IS NULL OR (p_dados->>'duracao_min')::integer NOT BETWEEN 5 AND 720 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A duração vai de 5 minutos a 12 horas.', 'duracao_min');
  END IF;
  IF v_inicio < now() - interval '1 day' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha um horário a partir de hoje.', 'inicio');
  END IF;
  IF v_resp IS NOT NULL AND NOT app_private.eh_membro(p_empresa_id, v_resp) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O responsável precisa fazer parte da equipe.', 'responsavel_auth_id');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agenda|' || p_empresa_id, 0));
  IF p_compromisso_id IS NOT NULL THEN
    SELECT * INTO c FROM public.compromissos_agenda WHERE id = p_compromisso_id AND empresa_id = p_empresa_id FOR UPDATE;
    IF NOT FOUND OR c.estado <> 'ativo' THEN PERFORM app_private.erro('NOT_FOUND', 'Compromisso não encontrado.'); END IF;
    IF c.versao <> p_expected_version THEN
      PERFORM app_private.erro('VERSION_CONFLICT', 'Este compromisso mudou desde que você abriu a tela. Atualize antes de continuar.');
    END IF;
  END IF;
  v_avisos := app_private.avisos_agenda(p_empresa_id, NULL, p_compromisso_id, v_inicio, v_fim);
  IF jsonb_array_length(v_avisos) > 0 AND NOT coalesce(p_aceitar_avisos, false) THEN
    -- Nada gravado e a chave não é consumida: a confirmação usa outra chave (como em propor_horario_os).
    RETURN jsonb_build_object('gravado', false, 'avisos', v_avisos);
  END IF;
  IF p_compromisso_id IS NULL THEN
    INSERT INTO public.compromissos_agenda (empresa_id, tipo, titulo, observacao, inicio, fim, responsavel_auth_id, avisos, criado_por)
    VALUES (p_empresa_id, v_tipo, v_titulo, v_obs, v_inicio, v_fim, v_resp, v_avisos, usuario) RETURNING * INTO c;
  ELSE
    UPDATE public.compromissos_agenda SET tipo = v_tipo, titulo = v_titulo, observacao = v_obs, inicio = v_inicio, fim = v_fim,
      responsavel_auth_id = v_resp, avisos = v_avisos, versao = versao + 1, atualizado_em = now() WHERE id = c.id RETURNING * INTO c;
  END IF;
  PERFORM app_private.auditar(p_empresa_id, usuario, CASE WHEN p_compromisso_id IS NULL THEN 'agenda.compromisso_criado' ELSE 'agenda.compromisso_alterado' END,
    'compromissos_agenda', c.id, jsonb_build_object('tipo', c.tipo, 'inicio', c.inicio, 'avisos_aceitos', jsonb_array_length(v_avisos)));
  RETURN app_private.idem_fim(usuario, 'salvar_compromisso_agenda', p_operation_key, assinatura,
    jsonb_build_object('gravado', true, 'avisos', v_avisos, 'compromisso', app_private.compromisso_json(c)));
END $$;

CREATE FUNCTION public.cancelar_compromisso_agenda(p_compromisso_id uuid, p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_compromisso_id, p_expected_version));
  anterior jsonb;
  c public.compromissos_agenda;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'cancelar_compromisso_agenda', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.compromissos_agenda WHERE id = p_compromisso_id FOR UPDATE;
  IF NOT FOUND OR NOT app_private.eh_membro(c.empresa_id, usuario) OR c.estado <> 'ativo' THEN
    PERFORM app_private.erro('NOT_FOUND', 'Compromisso não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['agenda.alterar']);
  IF c.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este compromisso mudou desde que você abriu a tela. Atualize antes de continuar.');
  END IF;
  UPDATE public.compromissos_agenda SET estado = 'cancelado', cancelado_por = usuario, versao = versao + 1, atualizado_em = now()
   WHERE id = c.id RETURNING * INTO c;
  PERFORM app_private.auditar(c.empresa_id, usuario, 'agenda.compromisso_cancelado', 'compromissos_agenda', c.id, jsonb_build_object('inicio', c.inicio));
  RETURN app_private.idem_fim(usuario, 'cancelar_compromisso_agenda', p_operation_key, assinatura, app_private.compromisso_json(c));
END $$;

REVOKE ALL ON FUNCTION app_private.compromisso_json(public.compromissos_agenda), app_private.avisos_agenda(uuid, uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compromissos_agenda(uuid, date, date), public.salvar_compromisso_agenda(uuid, uuid, jsonb, boolean, integer, text),
  public.cancelar_compromisso_agenda(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compromissos_agenda(uuid, date, date), public.salvar_compromisso_agenda(uuid, uuid, jsonb, boolean, integer, text),
  public.cancelar_compromisso_agenda(uuid, integer, text) TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611260002', 'E04: compromissos internos da agenda (compromisso ou bloqueio) com avisos de conflito e confirmação explícita; avisos de horário de solicitação/OS passam a considerar os compromissos');

COMMIT;
