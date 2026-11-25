BEGIN;
CREATE OR REPLACE FUNCTION app_private.nome_da_pessoa(p_usuario text) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT nome FROM public.perfis_identidade WHERE auth_user_id = p_usuario AND tipo_conta = 'business'),
    (SELECT nullif(btrim(u.name), '') FROM neon_auth."user" u WHERE u.id::text = p_usuario),
    'Pessoa sem nome')
$$;
DELETE FROM app_private.historico_migracoes WHERE id = '202611280002';
COMMIT;
