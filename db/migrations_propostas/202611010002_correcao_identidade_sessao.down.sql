-- Rollback da 202611010002: volta a chamar auth.user_id() diretamente.
-- Atenção: no Neon isso reintroduz o defeito "permission denied for schema auth".
BEGIN;
ALTER TABLE public.perfis_identidade ALTER COLUMN auth_user_id SET DEFAULT auth.user_id();
ALTER POLICY perfis_ler_proprios ON public.perfis_identidade USING (auth_user_id = (SELECT auth.user_id()));
ALTER POLICY perfis_criar_proprio ON public.perfis_identidade WITH CHECK (auth_user_id = (SELECT auth.user_id()));
ALTER POLICY perfis_atualizar_proprio ON public.perfis_identidade
  USING (auth_user_id = (SELECT auth.user_id())) WITH CHECK (auth_user_id = (SELECT auth.user_id()));
DROP FUNCTION authz.usuario_atual();
DELETE FROM app_private.historico_migracoes WHERE id = '202611010002';
COMMIT;
