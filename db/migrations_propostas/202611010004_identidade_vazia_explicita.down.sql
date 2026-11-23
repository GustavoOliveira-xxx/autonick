-- Rollback da 202611010004: volta authz.usuario_atual() a devolver NULL silenciosamente.
BEGIN;
DROP FUNCTION IF EXISTS public.diagnostico_sessao();
CREATE OR REPLACE FUNCTION authz.usuario_atual() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT auth.user_id() $$;
DELETE FROM app_private.historico_migracoes WHERE id = '202611010004';
COMMIT;
