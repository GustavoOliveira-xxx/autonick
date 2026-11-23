-- EMULAÇÃO LOCAL do ambiente Neon, SOMENTE para testes (nunca aplicar no Neon).
--
-- No Neon, ao habilitar a Data API com Managed Better Auth, a plataforma cria
-- os papéis `authenticator`, `authenticated` e `anonymous` e as funções
-- `auth.user_id()` (sub do JWT como text) e `auth.uid()` (sub como uuid), via
-- extensão pg_session_jwt (documentação oficial consultada em 01/11/2026).
-- Aqui elas são reproduzidas lendo a configuração `request.jwt.claims`, que os
-- testes definem por transação. Comportamento equivalente, implementação não.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anonymous') THEN
    CREATE ROLE anonymous NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT authenticated, anonymous TO authenticator;

CREATE SCHEMA IF NOT EXISTS auth;
-- Fiel ao Neon real (verificado em 01/11/2026): o schema `auth` pertence a um
-- papel da plataforma e NÃO concede USAGE a `authenticated` nem a `anonymous`
-- quando a Data API é habilitada sem as concessões padrão.
REVOKE ALL ON SCHEMA auth FROM PUBLIC;

CREATE OR REPLACE FUNCTION auth.user_id() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub' $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN auth.user_id()::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END $$;

-- No Neon, EXECUTE nessas funções é o padrão (PUBLIC); falta só o USAGE do schema.
GRANT EXECUTE ON FUNCTION auth.user_id(), auth.uid() TO PUBLIC;

-- Neon Managed Better Auth: tabela de usuários (só as colunas usadas pelas
-- migrations). No Neon real ela pertence ao serviço e já existe.
CREATE SCHEMA IF NOT EXISTS neon_auth;
REVOKE ALL ON SCHEMA neon_auth FROM PUBLIC;
CREATE TABLE IF NOT EXISTS neon_auth."user" (
  id              uuid PRIMARY KEY,
  email           text NOT NULL,
  "emailVerified" boolean NOT NULL DEFAULT false
);
ALTER TABLE neon_auth."user" ADD COLUMN IF NOT EXISTS name text;
