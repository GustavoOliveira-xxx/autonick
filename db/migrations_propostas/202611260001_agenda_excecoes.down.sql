-- Desfaz 202611260001: volta os avisos de conflito ao que eram e remove exceções, funções e tabela.
BEGIN;
CREATE OR REPLACE FUNCTION app_private.avisos_horario(p_empresa uuid, p_solicitacao uuid, p_inicio timestamptz, p_fim timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  avisos jsonb := '[]'::jsonb;
  ini timestamp := p_inicio AT TIME ZONE 'America/Sao_Paulo';
  fim timestamp := p_fim AT TIME ZONE 'America/Sao_Paulo';
  conflito record;
BEGIN
  IF ini::date <> (fim - interval '1 microsecond')::date OR NOT EXISTS (
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
DROP FUNCTION IF EXISTS public.remover_excecao_agenda(uuid, text);
DROP FUNCTION IF EXISTS public.salvar_excecao_agenda(uuid, date, text, jsonb, text, text);
DROP FUNCTION IF EXISTS public.excecoes_agenda(uuid, date, date);
DROP FUNCTION IF EXISTS app_private.excecao_json(public.excecoes_agenda);
DROP TABLE IF EXISTS public.excecoes_agenda;
DELETE FROM app_private.historico_migracoes WHERE id = '202611260001';
COMMIT;
