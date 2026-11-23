-- Rollback da migration 202611170001 (M12). Só no branch `desenvolvimento`, e só com autorização.
-- Devolve registrar_mensagem e vitrine_do_conjunto ao texto anterior e remove funções, tabelas e limites do M12.
-- ATENÇÃO: remove as mensagens, avaliações, denúncias e decisões criadas depois do M12 (as mensagens do M08 e as
-- atualizações da OS continuam intactas, porque nunca foram copiadas). A auditoria fica (imutável).

BEGIN;

CREATE OR REPLACE FUNCTION public.registrar_mensagem(p_solicitacao_id uuid, p_texto text, p_interna boolean, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_texto, p_interna));
  anterior jsonb;
  s public.solicitacoes_servico;
  papel text;
  v_texto text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_mensagem', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.solicitacao_trava(p_solicitacao_id);
  papel := app_private.papel_na_solicitacao(s, usuario, 'orcamentos.criar');
  IF papel = 'cliente' AND coalesce(p_interna, false) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Notas internas são só da empresa.');
  END IF;
  v_texto := app_private.ler_texto(p_texto, 1, 1000, 'texto', 'Escreva a mensagem (até 1.000 caracteres).');
  IF NOT coalesce(p_interna, false) AND s.estado IN ('recusada', 'cancelada') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta solicitação está encerrada.');
  END IF;
  PERFORM app_private.evento_solicitacao(s, CASE WHEN coalesce(p_interna, false) THEN 'nota_interna' ELSE 'mensagem' END, papel, usuario, v_texto,
    '{}'::jsonb, NOT coalesce(p_interna, false));
  RETURN app_private.idem_fim(usuario, 'registrar_mensagem', p_operation_key, assinatura,
    app_private.solicitacao_json(s.id, papel = 'cliente'));
END $$;

CREATE OR REPLACE FUNCTION app_private.vitrine_do_conjunto(p_conjunto text, p_empresa_id uuid, p_logado boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  c public.public_empresa_cards;
  v_servicos jsonb;
  v_produtos jsonb;
BEGIN
  SELECT * INTO c FROM app_private.cartoes_do_conjunto(p_conjunto) x WHERE x.empresa_id = p_empresa_id;
  IF c.empresa_id IS NULL THEN
    -- D10-11: a mesma resposta para indisponível e inexistente.
    PERFORM app_private.erro('NOT_FOUND', 'Esta vitrine não está disponível.');
  END IF;
  SELECT coalesce(jsonb_agg(app_private.servico_vitrine_json(s) ORDER BY lower(s.nome)), '[]'::jsonb) INTO v_servicos
    FROM public.servicos s WHERE s.empresa_id = c.empresa_id AND app_private.servico_publico(s);
  SELECT coalesce(jsonb_agg(app_private.produto_vitrine_json(p) ORDER BY lower(p.nome)), '[]'::jsonb) INTO v_produtos
    FROM public.produtos p WHERE p.empresa_id = c.empresa_id AND app_private.produto_publico(p);
  RETURN jsonb_build_object(
    'empresa', jsonb_build_object('id', c.empresa_id, 'nome_publico', c.nome_publico,
      'categoria', (SELECT nome FROM public.categorias_plataforma WHERE id = c.categoria_id), 'modalidade', c.modalidade,
      'cidade', c.cidade, 'uf', c.uf, 'bairro', c.bairro, 'area_atendimento', c.area_atendimento,
      'descricao_publica', c.descricao_publica, 'horario_funcionamento', c.horario_funcionamento, 'selo', c.selo),
    'servicos', v_servicos, 'produtos', v_produtos,
    'sem_itens', jsonb_array_length(v_servicos) = 0 AND jsonb_array_length(v_produtos) = 0)
    || CASE WHEN p_logado THEN jsonb_build_object('contatos', jsonb_strip_nulls(jsonb_build_object(
         'telefone_publico', nullif(c.telefone_publico, ''), 'whatsapp_publico', nullif(c.whatsapp_publico, ''), 'email_publico', nullif(c.email_publico, ''))))
       ELSE '{}'::jsonb END;
END $$;

DROP FUNCTION public.conversa_atendimento(text, uuid);
DROP FUNCTION public.enviar_mensagem(text, uuid, text, text);
DROP FUNCTION public.minha_avaliacao_os(uuid);
DROP FUNCTION public.avaliar_os(uuid, integer, text, text);
DROP FUNCTION public.retirar_avaliacao(uuid, text);
DROP FUNCTION public.avaliacoes_da_empresa(uuid);
DROP FUNCTION public.responder_avaliacao(uuid, text, text);
DROP FUNCTION public.denunciar(text, uuid, text, text, text);
DROP FUNCTION public.minhas_denuncias();
DROP FUNCTION public.contestar_moderacao(uuid, text, text);
DROP FUNCTION public.ck_fila_moderacao();
DROP FUNCTION public.ck_assumir_denuncia(uuid, text);
DROP FUNCTION public.ck_decidir_denuncia(uuid, text, text, text, text);
DROP FUNCTION public.ck_moderar_publicacao(text, uuid, text, text, text, text);
DROP FUNCTION public.ck_assumir_contestacao_moderacao(uuid, text);
DROP FUNCTION public.ck_decidir_contestacao_moderacao(uuid, text, text, text, text);
DROP FUNCTION app_private.impedimento_contestacao(text, uuid);
DROP FUNCTION app_private.avaliacoes_vitrine(uuid, text);
DROP FUNCTION app_private.avaliacao_do_cliente(uuid);
DROP FUNCTION app_private.impedimento_ck(text, uuid, text, text);
DROP FUNCTION app_private.exigir_ck(text);
DROP FUNCTION app_private.conteudo_para_ck(text, uuid);
DROP FUNCTION app_private.autor_do_conteudo(text, uuid);
DROP FUNCTION app_private.empresa_visivel_para(uuid, text);
DROP FUNCTION app_private.gravar_mensagem(text, uuid, text, text);
DROP FUNCTION app_private.itens_conversa(jsonb, text);
DROP FUNCTION app_private.moderacao_para_parte(text, uuid);
DROP FUNCTION app_private.conversa_acesso(text, uuid, text);
DROP FUNCTION app_private.mes_ano(timestamptz);
DROP FUNCTION app_private.conteudo_oculto(text, uuid);
DROP TABLE public.contestacoes_moderacao;
DROP TABLE public.conteudos_moderados;
DROP TABLE public.decisoes_moderacao;
DROP TABLE public.denuncias;
DROP TABLE public.respostas_avaliacao;
DROP TABLE public.avaliacoes;
DROP TABLE public.mensagens_atendimento;
DELETE FROM app_private.limites_plataforma WHERE chave IN ('mensagens_por_conversa_dia', 'denuncias_por_dia');
DELETE FROM app_private.historico_migracoes WHERE id = '202611170001';

COMMIT;
