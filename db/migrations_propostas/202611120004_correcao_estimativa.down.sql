-- Rollback da migration 202611120004: volta `estimar_servico` à versão da 202611120003. Só no branch `desenvolvimento`.
-- Atenção: a versão anterior permite que contas sem perfil de cliente estimem serviços de empresas que recebem pedidos delas.

BEGIN;

CREATE OR REPLACE FUNCTION public.estimar_servico(p_servico_id uuid, p_respostas jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  s public.servicos;
BEGIN
  SELECT * INTO s FROM public.servicos WHERE id = p_servico_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Serviço não encontrado.');
  END IF;
  IF NOT (app_private.tem(s.empresa_id, usuario, 'catalogo_servicos.visualizar') OR app_private.tem(s.empresa_id, usuario, 'orcamentos.visualizar')) THEN
    IF NOT (s.ativo AND app_private.empresa_recebe_pedido(s.empresa_id, usuario)) THEN
      PERFORM app_private.erro('NOT_FOUND', 'Serviço não encontrado.');
    END IF;
  END IF;
  RETURN app_private.calcular_estimativa(s, app_private.validar_respostas(s.id, p_respostas, false));
END $$;

DELETE FROM app_private.historico_migracoes WHERE id = '202611120004';

COMMIT;
