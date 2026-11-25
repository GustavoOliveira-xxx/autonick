BEGIN;
DROP FUNCTION IF EXISTS public.busca_global(uuid, text);
DROP FUNCTION IF EXISTS app_private.sem_acento(text);
DELETE FROM app_private.historico_migracoes WHERE id = '202611270001';
COMMIT;
