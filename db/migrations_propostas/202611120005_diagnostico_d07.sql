-- Migration 202611120005 (PROPOSTA, NÃO APLICADA): diagnóstico do D-07 por conexão. Só leitura, sem dado pessoal.
-- Motivo: as sondas 3 a 6 indicam que a identidade vazia aparece em requisições atendidas por conexões NOVAS do servidor
-- da Data API (rajadas abrem conexões; a primeira chamada depois de um período parado também). Para comprovar, cada
-- chamada precisa dizer em que conexão caiu e se o pedido chegou com as declarações do JWT:
--   papel; identidade_presente (auth.user_id()); sessao_presente (auth.session() não nulo); declaracoes_guc
--   (request.jwt.claims preenchido, sem devolver o conteúdo); conexao (pid do servidor) e conexao_idade_ms.
-- Nada de token, sub, e-mail ou nome é devolvido. Não muda tabela, dado, permissão nem a mitigação existente.
-- Aplicação no Neon `desenvolvimento` só com autorização do idealizador.

BEGIN;

-- SECURITY DEFINER só para ler o esquema `auth` (como authz.usuario_atual); o GUC `role` continua sendo o da requisição.
CREATE FUNCTION public.diagnostico_conexao() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  presente boolean;
  sessao boolean := NULL;
  inicio timestamptz;
BEGIN
  presente := (SELECT auth.user_id()) IS NOT NULL;
  IF to_regprocedure('auth.session()') IS NOT NULL THEN
    EXECUTE 'SELECT auth.session() IS NOT NULL' INTO sessao;
  END IF;
  SELECT backend_start INTO inicio FROM pg_catalog.pg_stat_get_activity(pg_catalog.pg_backend_pid());
  RETURN jsonb_build_object(
    'papel', current_setting('role', true),
    'identidade_presente', presente,
    'sessao_presente', sessao,
    'declaracoes_guc', coalesce(current_setting('request.jwt.claims', true), '') NOT IN ('', '{}'),
    'conexao', pg_catalog.pg_backend_pid(),
    'conexao_idade_ms', CASE WHEN inicio IS NULL THEN NULL ELSE round(extract(epoch FROM clock_timestamp() - inicio) * 1000) END);
END $$;
REVOKE ALL ON FUNCTION public.diagnostico_conexao() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.diagnostico_conexao() TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611120005', 'D-07: diagnóstico por conexão (só leitura, sem dado pessoal)');

COMMIT;
