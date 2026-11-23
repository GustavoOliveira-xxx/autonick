-- Rollback da 202611010005 (remove a marcação; as empresas continuam existindo).
BEGIN;
DROP TRIGGER IF EXISTS empresas_propagar_marcacao_teste ON public.empresas;
DROP TRIGGER IF EXISTS cards_copiar_marcacao_teste ON public.public_empresa_cards;
DROP FUNCTION IF EXISTS app_private.marcar_empresa_de_teste(uuid, text);
DROP FUNCTION IF EXISTS app_private.propagar_marcacao_teste();
DROP FUNCTION IF EXISTS app_private.copiar_marcacao_teste();
ALTER TABLE public.public_empresa_cards DROP COLUMN IF EXISTS dado_de_teste;
ALTER TABLE public.empresas DROP COLUMN IF EXISTS dado_de_teste;
DELETE FROM app_private.historico_migracoes WHERE id = '202611010005';
COMMIT;
