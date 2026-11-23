-- Rollback da 202611120003 (M08). Só no branch `desenvolvimento`.
-- Recusa se já houver serviço ou solicitação cadastrados (para não perder registros) ou se algum perfil já recebeu
-- uma das permissões novas. Em banco sem dados do M08, remove tudo e volta ao catálogo de 51 permissões.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.servicos) OR EXISTS (SELECT 1 FROM public.solicitacoes_servico) OR EXISTS (SELECT 1 FROM public.horarios_empresa) THEN
    RAISE EXCEPTION 'Rollback recusado: já existem serviços, solicitações ou horários do M08.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.perfil_permissoes WHERE codigo IN ('catalogo_servicos.visualizar', 'catalogo_servicos.alterar', 'agenda.visualizar', 'agenda.alterar')) THEN
    RAISE EXCEPTION 'Rollback recusado: há perfis de acesso com as permissões do M08.';
  END IF;
END $$;

DROP FUNCTION public.reconciliar_orcamentos(uuid);
DROP FUNCTION app_private.reconciliacao_orcamentos(uuid);
DROP FUNCTION public.ck_definir_limite(text, integer, text, text);
DROP FUNCTION public.ck_limites();
DROP FUNCTION public.agenda_basica(uuid, date, date);
DROP FUNCTION public.confirmar_horario(uuid, timestamptz, integer, boolean, text, text);
DROP FUNCTION public.cancelar_solicitacao(uuid, text, text);
DROP FUNCTION public.recusar_orcamento(uuid, uuid, jsonb, text);
DROP FUNCTION app_private.encerrar_solicitacao(public.solicitacoes_servico, text, text);
DROP FUNCTION public.aceitar_orcamento(uuid, uuid, boolean, text);
DROP FUNCTION public.pedir_revisao(uuid, text, text);
DROP FUNCTION public.registrar_mensagem(uuid, text, boolean, text);
DROP FUNCTION public.aprovar_orcamento(uuid, integer, text);
DROP FUNCTION public.enviar_orcamento(uuid, integer, text);
DROP FUNCTION app_private.desconto_cabe(public.orcamento_versoes, text);
DROP FUNCTION app_private.publicar_versao(public.solicitacoes_servico, public.orcamento_versoes, text, text);
DROP FUNCTION public.salvar_rascunho_orcamento(uuid, jsonb, integer, text);
DROP FUNCTION app_private.gravar_componentes(public.orcamento_versoes, jsonb, numeric);
DROP FUNCTION public.assumir_solicitacao(uuid, integer, text);
DROP FUNCTION public.minha_solicitacao(uuid);
DROP FUNCTION public.minhas_solicitacoes();
DROP FUNCTION public.solicitacao_detalhe(uuid);
DROP FUNCTION public.solicitacoes_da_empresa(uuid, jsonb, integer, integer);
DROP FUNCTION app_private.papel_na_solicitacao(public.solicitacoes_servico, text, text);
DROP FUNCTION app_private.solicitacao_trava(uuid);
DROP FUNCTION public.criar_solicitacao_interna(uuid, uuid, uuid, jsonb, text);
DROP FUNCTION public.criar_solicitacao(uuid, jsonb, text);
DROP FUNCTION app_private.criar_solicitacao_nucleo(public.servicos, text, text, uuid, text, jsonb, text);
DROP FUNCTION app_private.solicitacao_json(uuid, boolean);
DROP FUNCTION app_private.versao_json(public.orcamento_versoes, boolean);
DROP FUNCTION app_private.ler_preferencia(jsonb);
DROP FUNCTION app_private.avisos_horario(uuid, uuid, timestamptz, timestamptz);
DROP FUNCTION public.salvar_horarios_empresa(uuid, jsonb, text);
DROP FUNCTION public.horarios_empresa(uuid);
DROP FUNCTION public.estimar_servico(uuid, jsonb);
DROP FUNCTION public.servicos_para_cliente(uuid);
DROP FUNCTION app_private.grade_json(uuid);
DROP FUNCTION public.salvar_regras_servico(uuid, jsonb, integer, text);
DROP FUNCTION public.salvar_formulario_servico(uuid, jsonb, integer, text);
DROP FUNCTION public.definir_servico_ativo(uuid, boolean, integer, text);
DROP FUNCTION public.alterar_servico(uuid, jsonb, integer, text);
DROP FUNCTION public.criar_servico(uuid, jsonb, text);
DROP FUNCTION public.servicos_da_empresa(uuid);
DROP FUNCTION app_private.calcular_estimativa(public.servicos, jsonb);
DROP FUNCTION app_private.validar_respostas(uuid, jsonb, boolean);
DROP FUNCTION app_private.servico_da_empresa_trava(uuid);
DROP FUNCTION app_private.aplicar_dados_servico(public.servicos, jsonb);
DROP FUNCTION app_private.servico_json(public.servicos, boolean);
DROP FUNCTION app_private.agora_sp();
DROP FUNCTION app_private.pede_dado_sensivel(text);
DROP FUNCTION app_private.evento_solicitacao(public.solicitacoes_servico, text, text, text, text, jsonb, boolean);
DROP FUNCTION app_private.limite(text);

DROP TABLE public.agendamentos;
DROP TABLE public.solicitacao_eventos;
DROP TABLE public.orcamento_componentes;
ALTER TABLE public.solicitacoes_servico DROP COLUMN versao_vigente_id;
DROP TABLE public.orcamento_versoes;
DROP TABLE public.solicitacoes_servico;
DROP TABLE public.horarios_empresa;
DROP TABLE public.servico_regras;
DROP TABLE public.servico_perguntas;
DROP TABLE public.servicos;
DROP FUNCTION app_private.proteger_componentes();
DROP FUNCTION app_private.proteger_versao_orcamento();

ALTER TABLE app_private.contadores_empresa DROP COLUMN proxima_solicitacao;
DROP TABLE app_private.limites_plataforma;
DELETE FROM public.permissoes_catalogo WHERE codigo IN ('catalogo_servicos.visualizar', 'catalogo_servicos.alterar', 'agenda.visualizar', 'agenda.alterar');
ALTER TABLE public.permissoes_catalogo DROP CONSTRAINT permissoes_catalogo_codigo_check;
ALTER TABLE public.permissoes_catalogo ADD CONSTRAINT permissoes_catalogo_codigo_check CHECK (codigo ~ '^[a-z]+\.[a-z_]+$');
DELETE FROM app_private.historico_migracoes WHERE id = '202611120003';

COMMIT;
