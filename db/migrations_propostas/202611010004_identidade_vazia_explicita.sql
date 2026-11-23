-- MIG-04 (correção, M03): identidade vazia em requisição autenticada vira erro explícito.
--
-- Defeito D-07, observado no Neon real em 01/11/2026 (4 ocorrências): com um JWT
-- válido, auth.user_id() devolveu NULL de forma transitória. Em RPCs isso gerava
-- "Sessão ausente" (recuperável). Em LEITURAS, porém, a RLS comparava com NULL e
-- devolvia lista vazia sem erro: a conta parecia não ter perfil, a empresa parecia
-- não existir e a fila da CK parecia vazia. Falha fechada (nunca libera dados), mas
-- enganosa.
--
-- Correção: authz.usuario_atual() passa a lançar AUTH_REQUIRED quando o papel da
-- requisição é `authenticated` e a identidade vem vazia. O cliente já repete uma vez
-- esse caso com token renovado. O papel `anonymous` continua recebendo NULL (sem
-- concessões, ele não lê nada de qualquer forma).
--
-- Também cria public.diagnostico_sessao(), que devolve só o papel da requisição e se
-- a identidade foi lida, para diagnóstico de D-07 sem expor dados.
--
-- Rollback: 202611010004_identidade_vazia_explicita.down.sql

BEGIN;

CREATE OR REPLACE FUNCTION authz.usuario_atual() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := auth.user_id();
BEGIN
  -- O GUC `role` guarda o papel definido pela Data API (SET ROLE) mesmo dentro de
  -- função SECURITY DEFINER.
  IF usuario IS NULL AND current_setting('role', true) = 'authenticated' THEN
    RAISE EXCEPTION 'Sessão ausente ou expirada.' USING ERRCODE = '28000', HINT = 'AUTH_REQUIRED';
  END IF;
  RETURN usuario;
END $$;

CREATE FUNCTION public.diagnostico_sessao() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  presente boolean;
BEGIN
  BEGIN
    presente := (SELECT authz.usuario_atual()) IS NOT NULL;
  EXCEPTION WHEN invalid_authorization_specification THEN
    presente := false;
  END;
  RETURN jsonb_build_object('papel', current_setting('role', true), 'identidade_presente', presente);
END $$;
REVOKE ALL ON FUNCTION public.diagnostico_sessao() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.diagnostico_sessao() TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611010004', 'Correção D-07: identidade vazia em requisição autenticada vira erro explícito (M03)');

COMMIT;
