-- Rollback da 202611010001. Usar SOMENTE em ambiente sem dados reais
-- (OPS-001 §4: nada de DROP em ambiente com dados reais sem backup e autorização).
BEGIN;
DROP FUNCTION IF EXISTS authz.tem_perfil(text);
DROP FUNCTION IF EXISTS public.garantir_perfil(text, text);
DROP TABLE IF EXISTS public.perfis_identidade;
DROP FUNCTION IF EXISTS app_private.auditar_perfil_criado();
DROP FUNCTION IF EXISTS app_private.tocar_atualizado_em();
DROP TABLE IF EXISTS app_private.eventos_auditoria;
DROP TABLE IF EXISTS app_private.historico_migracoes;
DROP FUNCTION IF EXISTS app_private.impedir_alteracao_auditoria();
DROP SCHEMA IF EXISTS authz;
DROP SCHEMA IF EXISTS app_private;
GRANT USAGE ON SCHEMA public TO PUBLIC;
COMMIT;
