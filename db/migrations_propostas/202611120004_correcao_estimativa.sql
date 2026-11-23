-- Migration 202611120004: correção do M08 encontrada na verificação real (12/11/2026). Só no branch `desenvolvimento`.
-- Problema: `estimar_servico`, fora da equipe da empresa, conferia só "serviço ativo + empresa recebe pedidos desta conta".
-- Uma conta empresarial SEM perfil de cliente (por exemplo, a dona de outra empresa de teste) conseguia estimar serviços
-- de outra empresa, diferente de `servicos_para_cliente` e `criar_solicitacao`, que exigem o perfil de cliente (ADR-001).
-- Correção: fora da equipe, exigir o perfil de cliente; sem ele, "Serviço não encontrado" (não revela que o serviço existe).
-- Nenhuma tabela, dado ou permissão muda.

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
    -- Fora da equipe, só quem tem perfil de cliente e pode pedir a esta empresa (mesma regra de servicos_para_cliente).
    IF NOT (s.ativo AND EXISTS (SELECT 1 FROM public.perfis_identidade WHERE auth_user_id = usuario AND tipo_conta = 'cliente')
            AND app_private.empresa_recebe_pedido(s.empresa_id, usuario)) THEN
      PERFORM app_private.erro('NOT_FOUND', 'Serviço não encontrado.');
    END IF;
  END IF;
  RETURN app_private.calcular_estimativa(s, app_private.validar_respostas(s.id, p_respostas, false));
END $$;

REVOKE ALL ON FUNCTION public.estimar_servico(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estimar_servico(uuid, jsonb) TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611120004', 'M08: estimar_servico exige perfil de cliente fora da equipe da empresa (correção da verificação real)');

COMMIT;
