-- Rollback da 202611130003: volta vitrine_publica ao texto da 202611130002. Só no branch `desenvolvimento`.
BEGIN;

CREATE OR REPLACE FUNCTION public.vitrine_publica(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- authz.usuario_atual(): nulo para o anônimo; com o papel authenticated sem identidade, falha fechada (AUTH_REQUIRED).
  RETURN app_private.vitrine_do_conjunto('publico', p_empresa_id, (SELECT authz.usuario_atual()) IS NOT NULL);
END $$;

DELETE FROM app_private.historico_migracoes WHERE id = '202611130003';

COMMIT;
