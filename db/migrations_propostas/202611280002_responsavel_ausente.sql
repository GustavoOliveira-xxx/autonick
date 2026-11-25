-- 202611280002_responsavel_ausente: E07 (evolução integrada).
-- Antes, nome_da_pessoa(NULL) devolvia "Pessoa sem nome": uma OS sem responsável aparecia como se tivesse alguém sem nome.
-- Agora: sem pessoa (NULL) devolve NULL, e as telas mostram "Sem responsável definido"; pessoa existente sem nome cadastrado
-- vira "Cadastro sem nome"; quem saiu da equipe continua com o nome (as telas marcam "desligado" comparando com a equipe ativa).
-- Nenhum dado é alterado: só a função de exibição.
BEGIN;

CREATE OR REPLACE FUNCTION app_private.nome_da_pessoa(p_usuario text) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE WHEN p_usuario IS NULL OR btrim(p_usuario) = '' THEN NULL ELSE coalesce(
    (SELECT nome FROM public.perfis_identidade WHERE auth_user_id = p_usuario AND tipo_conta = 'business'),
    (SELECT nullif(btrim(u.name), '') FROM neon_auth."user" u WHERE u.id::text = p_usuario),
    'Cadastro sem nome') END
$$;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611280002', 'E07: responsável ausente não aparece mais como "Pessoa sem nome" (NULL; telas mostram "Sem responsável definido"); cadastro sem nome vira "Cadastro sem nome"');

COMMIT;
