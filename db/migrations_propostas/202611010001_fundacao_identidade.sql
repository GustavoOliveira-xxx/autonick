-- MIG-01/MIG-02 (parcial): fundação e perfis de identidade.
-- STATUS: PROPOSTA, NÃO APLICADA no Neon (aplicação depende de autorização).
-- Testada em PostgreSQL local com a emulação de db/tests/emulacao-neon.sql.
--
-- Rastreabilidade: ADR-001 (B), ADR-002 (Neon), RF-001, RF-002, RF-003, RF-006,
-- RF-007, RF-009, RN-002, RN-005, RN-055, RNF-002, RNF-004, RNF-006, RNF-010,
-- BDD-001 §4.2 (`perfis_identidade`, `eventos_auditoria`), SEC-001 §4.
--
-- Pré-requisitos fornecidos pelo Neon (NÃO criados aqui): papéis `authenticated`,
-- `anonymous`, `authenticator`; funções `auth.user_id()` e `auth.uid()`;
-- schema `neon_auth` do Managed Better Auth.
--
-- Rollback (somente sem dados reais): ver 202611010001_fundacao_identidade.down.sql

BEGIN;

-- 1. Privilégios mínimos: nada é concedido por padrão aos papéis da Data API.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 2. Schemas não expostos pela Data API (fora de db_schemas).
CREATE SCHEMA app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
CREATE SCHEMA authz;
REVOKE ALL ON SCHEMA authz FROM PUBLIC;
GRANT USAGE ON SCHEMA authz TO authenticated;

-- Controle de migrations aplicadas (OPS-001 §5). Sem acesso pelos papéis da API.
CREATE TABLE app_private.historico_migracoes (
  id          text PRIMARY KEY,
  descricao   text NOT NULL,
  aplicada_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611010001', 'Fundação e perfis de identidade (M02)');

-- 3. Auditoria append-only (RNF-010, RN-056). Sem acesso pelos papéis da API.
CREATE TABLE app_private.eventos_auditoria (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid,
  ator_auth_id  text,
  tipo_acao     text NOT NULL,
  recurso_tipo  text NOT NULL,
  recurso_id    uuid,
  dados_minimizados jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eventos_auditoria_recurso_idx ON app_private.eventos_auditoria (recurso_tipo, recurso_id);

CREATE FUNCTION app_private.impedir_alteracao_auditoria() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Registros de auditoria não podem ser alterados ou excluídos.'
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER auditoria_somente_insercao
  BEFORE UPDATE OR DELETE ON app_private.eventos_auditoria
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_auditoria();

-- 4. Perfis de experiência (ADR-001 = B): uma identidade, perfis separados.
CREATE TABLE public.perfis_identidade (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  text NOT NULL DEFAULT auth.user_id(),
  tipo_conta    text NOT NULL CHECK (tipo_conta IN ('cliente', 'business')),
  nome          text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 2 AND 120),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT perfis_identidade_unico UNIQUE (auth_user_id, tipo_conta)
);

COMMENT ON TABLE public.perfis_identidade IS
  'Perfis Cliente e Business de uma mesma identidade do Neon Auth (ADR-001 = B). Sem alternância automática.';

ALTER TABLE public.perfis_identidade ENABLE ROW LEVEL SECURITY;

-- Somente o titular lê os próprios perfis (RN-002, RNF-003).
CREATE POLICY perfis_ler_proprios ON public.perfis_identidade
  FOR SELECT TO authenticated
  USING (auth_user_id = (SELECT auth.user_id()));

-- Inserção só para si mesmo; auth_user_id vem do JWT pelo DEFAULT (sem GRANT na coluna).
CREATE POLICY perfis_criar_proprio ON public.perfis_identidade
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = (SELECT auth.user_id()));

-- Atualização só do nome, só do próprio perfil (RF-007).
CREATE POLICY perfis_atualizar_proprio ON public.perfis_identidade
  FOR UPDATE TO authenticated
  USING (auth_user_id = (SELECT auth.user_id()))
  WITH CHECK (auth_user_id = (SELECT auth.user_id()));

-- GRANT mínimo por coluna: identidade, tipo e datas não podem ser alterados pelo cliente.
GRANT SELECT ON public.perfis_identidade TO authenticated;
GRANT INSERT (tipo_conta, nome) ON public.perfis_identidade TO authenticated;
GRANT UPDATE (nome) ON public.perfis_identidade TO authenticated;
-- Nenhum DELETE: exclusão é pedido tratado por fluxo próprio (RF-008).
-- Nenhum acesso para `anonymous`.

CREATE FUNCTION app_private.tocar_atualizado_em() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;

CREATE TRIGGER perfis_identidade_atualizado_em
  BEFORE UPDATE ON public.perfis_identidade
  FOR EACH ROW EXECUTE FUNCTION app_private.tocar_atualizado_em();

-- Auditoria de criação de perfil (SECURITY DEFINER restrito, search_path vazio).
CREATE FUNCTION app_private.auditar_perfil_criado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO app_private.eventos_auditoria (ator_auth_id, tipo_acao, recurso_tipo, recurso_id, dados_minimizados)
  VALUES (NEW.auth_user_id, 'perfil.criado', 'perfis_identidade', NEW.id,
          jsonb_build_object('tipo_conta', NEW.tipo_conta));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.auditar_perfil_criado() FROM PUBLIC;

CREATE TRIGGER perfis_identidade_auditoria
  AFTER INSERT ON public.perfis_identidade
  FOR EACH ROW EXECUTE FUNCTION app_private.auditar_perfil_criado();

-- 5. Criação idempotente de perfil (RNF-011): repetir devolve o mesmo perfil.
CREATE FUNCTION public.garantir_perfil(p_tipo_conta text, p_nome text)
RETURNS public.perfis_identidade
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  resultado public.perfis_identidade;
BEGIN
  IF (SELECT auth.user_id()) IS NULL THEN
    RAISE EXCEPTION 'Sessão ausente.' USING ERRCODE = 'insufficient_privilege', HINT = 'AUTH_REQUIRED';
  END IF;
  -- Perfil já existente é devolvido sem nova validação nem nova escrita.
  SELECT * INTO resultado
    FROM public.perfis_identidade
   WHERE auth_user_id = (SELECT auth.user_id()) AND tipo_conta = p_tipo_conta;
  IF FOUND THEN
    RETURN resultado;
  END IF;
  INSERT INTO public.perfis_identidade (tipo_conta, nome)
  VALUES (p_tipo_conta, btrim(p_nome))
  ON CONFLICT ON CONSTRAINT perfis_identidade_unico DO NOTHING;
  SELECT * INTO resultado
    FROM public.perfis_identidade
   WHERE auth_user_id = (SELECT auth.user_id()) AND tipo_conta = p_tipo_conta;
  RETURN resultado;
END $$;
REVOKE ALL ON FUNCTION public.garantir_perfil(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.garantir_perfil(text, text) TO authenticated;

-- 6. Auxiliar de autorização para políticas futuras (M03/M04).
CREATE FUNCTION authz.tem_perfil(p_tipo_conta text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis_identidade
     WHERE auth_user_id = (SELECT auth.user_id()) AND tipo_conta = p_tipo_conta
  )
$$;
REVOKE ALL ON FUNCTION authz.tem_perfil(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.tem_perfil(text) TO authenticated;

COMMIT;
