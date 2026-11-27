-- Reversão de 202612010002_produtividade_portal. Notificações, preferências, onboarding dispensado, ajustes de flags por
-- empresa e modelos de orçamento gravados depois da migration são descartados.
BEGIN;
DROP TRIGGER IF EXISTS propostas_notificar ON public.propostas_movimentacao;
DROP TRIGGER IF EXISTS ordens_notificar ON public.ordens_servico;
DROP TRIGGER IF EXISTS solicitacoes_notificar ON public.solicitacoes_servico;
DROP TRIGGER IF EXISTS pedidos_notificar ON public.pedidos;
DROP FUNCTION IF EXISTS public.salvar_modelo_orcamento(uuid, uuid, jsonb, integer, text);
DROP FUNCTION IF EXISTS public.modelos_orcamento(uuid);
DROP FUNCTION IF EXISTS app_private.componentes_de_modelo(jsonb);
DROP TABLE IF EXISTS public.modelos_orcamento;
DROP FUNCTION IF EXISTS public.reiniciar_onboarding();
DROP FUNCTION IF EXISTS public.dispensar_onboarding(text);
DROP FUNCTION IF EXISTS public.meu_onboarding();
DROP TABLE IF EXISTS public.onboarding_dispensado;
DROP FUNCTION IF EXISTS public.definir_preferencia_notificacao(text, boolean);
DROP FUNCTION IF EXISTS public.preferencias_notificacao();
DROP FUNCTION IF EXISTS public.marcar_notificacoes_lidas(uuid[]);
DROP FUNCTION IF EXISTS public.minhas_notificacoes(timestamptz, integer);
DROP FUNCTION IF EXISTS app_private.notificar_proposta();
DROP FUNCTION IF EXISTS app_private.notificar_os();
DROP FUNCTION IF EXISTS app_private.notificar_solicitacao();
DROP FUNCTION IF EXISTS app_private.notificar_pedido();
DROP FUNCTION IF EXISTS app_private.ator_atual();
DROP FUNCTION IF EXISTS app_private.notificar_equipe(uuid, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS app_private.notificar(text, uuid, text, text, text, text, text, text);
DROP TABLE IF EXISTS public.preferencias_notificacao;
DROP TABLE IF EXISTS public.notificacoes;
DROP FUNCTION IF EXISTS public.definir_flag_empresa(uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public.ck_definir_flag(text, boolean, text, integer, text);
DROP FUNCTION IF EXISTS public.ck_flags();
DROP FUNCTION IF EXISTS public.flags_ativas(uuid);
DROP TABLE IF EXISTS public.flags_empresa;
DROP TABLE IF EXISTS app_private.feature_flags;
CREATE OR REPLACE FUNCTION public.vendas_da_empresa(p_empresa_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb, p_limite integer DEFAULT 50,
  p_deslocamento integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  f jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_de date;
  v_ate date;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['vendas.visualizar']);
  BEGIN
    v_de := nullif(f->>'de', '')::date;
    v_ate := nullif(f->>'ate', '')::date;
  EXCEPTION WHEN others THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Período inválido.', 'periodo');
  END;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'numero', v.numero, 'estado', v.estado, 'entrega', v.entrega,
      'origem', v.origem, 'cliente', v.cliente_nome, 'total_centavos', app_private.para_centavos(v.total),
      'confirmada_em', v.confirmada_em, 'criado_em', v.criado_em, 'versao', v.versao, 'autor_nome', app_private.nome_da_pessoa(v.autor),
      'pagamento', app_private.situacao_pagamento(v.id)) ORDER BY v.estado = 'rascunho' DESC, v.numero DESC NULLS FIRST, v.criado_em DESC)
    FROM (SELECT * FROM public.vendas v
           WHERE v.empresa_id = p_empresa_id
             AND (f->>'estado' IS NULL OR v.estado = f->>'estado')
             AND (f->>'origem' IS NULL OR v.origem = f->>'origem')
             AND (f->>'entrega' IS NULL OR v.entrega = f->>'entrega')
             AND (f->>'cliente_empresa_id' IS NULL OR v.cliente_empresa_id::text = f->>'cliente_empresa_id')
             AND (f->>'numero' IS NULL OR v.numero::text = f->>'numero')
             AND (v_de IS NULL OR (coalesce(v.confirmada_em, v.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date >= v_de)
             AND (v_ate IS NULL OR (coalesce(v.confirmada_em, v.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date <= v_ate)
           ORDER BY v.estado = 'rascunho' DESC, v.numero DESC NULLS FIRST, v.criado_em DESC
           LIMIT least(greatest(coalesce(p_limite, 50), 1), 100) OFFSET greatest(coalesce(p_deslocamento, 0), 0)) v), '[]'::jsonb);
END $$;


DELETE FROM app_private.historico_migracoes WHERE id = '202612010002';
COMMIT;
