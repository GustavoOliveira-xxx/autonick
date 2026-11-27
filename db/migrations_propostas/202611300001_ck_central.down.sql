BEGIN;
DROP FUNCTION IF EXISTS public.ck_auditoria(timestamptz, integer);
DROP FUNCTION IF EXISTS public.ck_saude();
CREATE OR REPLACE FUNCTION public.ck_limites() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.exigir_usuario();
  IF NOT (SELECT authz.eh_ck_admin()) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só a administração CK vê os limites da plataforma.');
  END IF;
  RETURN (SELECT jsonb_agg(jsonb_build_object('chave', chave, 'valor', valor, 'minimo', minimo, 'maximo', maximo, 'descricao', descricao,
    'atualizado_em', atualizado_em) ORDER BY chave) FROM app_private.limites_plataforma);
END $$;
DELETE FROM app_private.historico_migracoes WHERE id = '202611300001';
COMMIT;
