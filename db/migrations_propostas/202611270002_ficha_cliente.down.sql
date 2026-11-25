BEGIN;
DROP FUNCTION IF EXISTS public.ficha_cliente(uuid);
DELETE FROM app_private.historico_migracoes WHERE id = '202611270002';
COMMIT;
