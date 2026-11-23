-- MIG-02 (correção): identidade da sessão sem USAGE no schema `auth`.
--
-- Defeito encontrado na verificação REAL do M02 (01/11/2026): no Neon, o schema
-- `auth` pertence a um papel da plataforma e não concede USAGE a `authenticated`
-- quando a Data API é habilitada sem concessões padrão. Por isso o DEFAULT e as
-- políticas da 202611010001, que chamavam auth.user_id() diretamente, falhavam
-- com "permission denied for schema auth" (HTTP 403 na criação de perfil).
-- O dono do banco não tem GRANT OPTION nesse schema, então a concessão direta
-- não é possível.
--
-- Correção: função mínima authz.usuario_atual(), SECURITY DEFINER do dono do
-- banco, sem parâmetros, que só devolve o `sub` do JWT da sessão corrente.
-- Não amplia privilégios: o valor vem do JWT validado pela Data API.
--
-- Rastreabilidade: ADR-001 (B), RF-001, RF-003, RNF-002, RNF-004, SEC-001 §4.
-- Rollback: 202611010002_correcao_identidade_sessao.down.sql

BEGIN;

CREATE FUNCTION authz.usuario_atual() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT auth.user_id() $$;
REVOKE ALL ON FUNCTION authz.usuario_atual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.usuario_atual() TO authenticated;

ALTER TABLE public.perfis_identidade
  ALTER COLUMN auth_user_id SET DEFAULT authz.usuario_atual();

ALTER POLICY perfis_ler_proprios ON public.perfis_identidade
  USING (auth_user_id = (SELECT authz.usuario_atual()));
ALTER POLICY perfis_criar_proprio ON public.perfis_identidade
  WITH CHECK (auth_user_id = (SELECT authz.usuario_atual()));
ALTER POLICY perfis_atualizar_proprio ON public.perfis_identidade
  USING (auth_user_id = (SELECT authz.usuario_atual()))
  WITH CHECK (auth_user_id = (SELECT authz.usuario_atual()));

CREATE OR REPLACE FUNCTION public.garantir_perfil(p_tipo_conta text, p_nome text)
RETURNS public.perfis_identidade
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  resultado public.perfis_identidade;
  usuario text := (SELECT authz.usuario_atual());
BEGIN
  IF usuario IS NULL THEN
    RAISE EXCEPTION 'Sessão ausente.' USING ERRCODE = 'insufficient_privilege', HINT = 'AUTH_REQUIRED';
  END IF;
  -- Perfil já existente é devolvido sem nova validação nem nova escrita.
  SELECT * INTO resultado
    FROM public.perfis_identidade
   WHERE auth_user_id = usuario AND tipo_conta = p_tipo_conta;
  IF FOUND THEN
    RETURN resultado;
  END IF;
  INSERT INTO public.perfis_identidade (tipo_conta, nome)
  VALUES (p_tipo_conta, btrim(p_nome))
  ON CONFLICT ON CONSTRAINT perfis_identidade_unico DO NOTHING;
  SELECT * INTO resultado
    FROM public.perfis_identidade
   WHERE auth_user_id = usuario AND tipo_conta = p_tipo_conta;
  RETURN resultado;
END $$;

CREATE OR REPLACE FUNCTION authz.tem_perfil(p_tipo_conta text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis_identidade
     WHERE auth_user_id = (SELECT authz.usuario_atual()) AND tipo_conta = p_tipo_conta
  )
$$;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611010002', 'Correção: identidade da sessão via authz.usuario_atual() (M02)');

COMMIT;
