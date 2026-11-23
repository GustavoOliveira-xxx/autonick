-- Rollback de 202611180001_painel_mensagens (M13b).
BEGIN;
DROP FUNCTION public.painel_empresa(uuid);
DROP FUNCTION public.marcar_conversa_lida(text, uuid, timestamptz);
DROP FUNCTION public.mensagens_novas(uuid);
DROP FUNCTION app_private.mensagens_novas_de(text, uuid);
DROP TABLE public.leituras_conversa;
DELETE FROM app_private.historico_migracoes WHERE id = '202611180001';
COMMIT;
