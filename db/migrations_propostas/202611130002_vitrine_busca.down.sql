-- Rollback da migration 202611130002 (M10). Só no branch `desenvolvimento`.
-- Recusa se alguma empresa já publicou item na vitrine ou se existe autorização de demonstração: a reversão apagaria
-- decisões registradas e precisa de decisão humana. A auditoria fica (imutável).

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.produtos WHERE exibir_na_vitrine) OR EXISTS (SELECT 1 FROM public.servicos WHERE exibir_na_vitrine)
     OR EXISTS (SELECT 1 FROM app_private.autorizacoes_demonstracao) THEN
    RAISE EXCEPTION 'Há itens publicados na vitrine ou autorizações de demonstração: a reversão apagaria decisões. Decisão humana necessária.';
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.filtros_vitrine(), public.buscar_vitrine(jsonb, integer), public.vitrine_publica(uuid) FROM anonymous;
REVOKE USAGE ON SCHEMA public FROM anonymous;

-- Funções do M05, M06, M08 e M09 voltam ao texto anterior.
CREATE OR REPLACE FUNCTION app_private.servico_json(p_s public.servicos, p_privado boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', p_s.id, 'empresa_id', p_s.empresa_id, 'nome', p_s.nome, 'descricao', p_s.descricao,
    'categoria_id', p_s.categoria_id, 'categoria', (SELECT nome FROM public.categorias_plataforma WHERE id = p_s.categoria_id),
    'politica_preco', p_s.politica_preco, 'preco_centavos', app_private.para_centavos(p_s.preco), 'duracao_min', p_s.duracao_min,
    'validade_dias', p_s.validade_dias, 'modalidade', p_s.modalidade, 'exibicao', p_s.exibicao, 'faixa_percentual', p_s.faixa_percentual,
    'ativo', p_s.ativo, 'versao', p_s.versao,
    'itens_pacote', CASE WHEN p_s.politica_preco = 'pacote' THEN coalesce((SELECT jsonb_agg(jsonb_build_object('servico_id', x.id, 'nome', x.nome) ORDER BY i.ordem) FROM public.servico_pacote_itens i JOIN public.servicos x ON x.id = i.servico_id WHERE i.pacote_id = p_s.id), '[]'::jsonb) END,
    'perguntas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', q.id, 'ordem', q.ordem, 'texto', q.texto, 'ajuda', q.ajuda, 'tipo', q.tipo,
        'obrigatoria', q.obrigatoria, 'configuracao', q.configuracao) ORDER BY q.ordem)
      FROM public.servico_perguntas q WHERE q.servico_id = p_s.id AND q.ativa), '[]'::jsonb))
  || CASE WHEN p_privado THEN jsonb_build_object(
    'regras', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'ordem', r.ordem, 'tipo', r.tipo, 'pergunta_id', r.pergunta_id,
        'rotulo', r.rotulo, 'parametros', r.parametros) ORDER BY r.ordem)
      FROM public.servico_regras r WHERE r.servico_id = p_s.id AND r.ativa), '[]'::jsonb),
    'solicitacoes_abertas', (SELECT count(*) FROM public.solicitacoes_servico s WHERE s.servico_id = p_s.id
                               AND s.estado IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida')))
    ELSE '{}'::jsonb END
$$;

CREATE OR REPLACE FUNCTION public.produtos_da_empresa(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  perms text[];
  ver_preco boolean;
  ver_estoque boolean;
  ver_custo boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = p_empresa_id AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  perms := app_private.permissoes_de(p_empresa_id, usuario);
  ver_preco := 'produtos.visualizar' = ANY (perms);
  ver_estoque := 'estoque.visualizar' = ANY (perms);
  ver_custo := 'produtos.ver_custo' = ANY (perms);
  IF NOT (ver_preco OR ver_estoque) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite ver os produtos desta empresa.');
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'nome', p.nome, 'descricao', p.descricao, 'categoria_id', p.categoria_id, 'finalidade', p.finalidade,
      'sob_encomenda', p.sob_encomenda, 'venda_pausada', p.venda_pausada, 'motivo_pausa', p.motivo_pausa,
      'fornecedor_padrao_id', p.fornecedor_padrao_id, 'ativo', p.ativo, 'versao', p.versao,
      'variacoes', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', v.id, 'padrao', v.padrao, 'atributos', v.atributos, 'rotulo', app_private.rotulo_variacao(v.atributos, v.padrao),
          'sku', v.sku, 'ativo', v.ativo, 'versao', v.versao, 'estoque_minimo', v.estoque_minimo,
          'preco_centavos', CASE WHEN ver_preco THEN app_private.para_centavos(v.preco) END,
          'custo_centavos', CASE WHEN ver_custo AND v.custo_atual IS NOT NULL THEN app_private.para_centavos(v.custo_atual) END,
          'fisico', CASE WHEN ver_estoque THEN s.fisico END,
          'reservado', CASE WHEN ver_estoque THEN s.reservado END,
          'disponivel', CASE WHEN ver_estoque THEN s.disponivel END,
          'abaixo_minimo', CASE WHEN ver_estoque THEN (v.estoque_minimo IS NOT NULL AND s.disponivel <= v.estoque_minimo) END))
          ORDER BY v.padrao DESC, v.criado_em, v.id), '[]'::jsonb)
        FROM public.produto_variacoes v JOIN public.saldos_estoque s ON s.variacao_id = v.id
        WHERE v.produto_id = p.id AND (v.ativo OR NOT v.padrao)),
      'resumo', CASE WHEN ver_estoque THEN (SELECT jsonb_build_object(
          'fisico', coalesce(sum(s.fisico), 0), 'reservado', coalesce(sum(s.reservado), 0), 'disponivel', coalesce(sum(s.disponivel), 0),
          'variacoes_em_alerta', count(*) FILTER (WHERE v.estoque_minimo IS NOT NULL AND s.disponivel <= v.estoque_minimo))
        FROM public.produto_variacoes v JOIN public.saldos_estoque s ON s.variacao_id = v.id
        WHERE v.produto_id = p.id AND v.ativo) END)
      ORDER BY p.ativo DESC, lower(p.nome))
      FROM public.produtos p WHERE p.empresa_id = p_empresa_id), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.servicos_para_cliente(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_perfil_cliente(usuario);
  IF NOT app_private.empresa_recebe_pedido(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Empresa não encontrada.');
  END IF;
  RETURN jsonb_build_object(
    'empresa', (SELECT jsonb_build_object('id', e.id, 'nome', e.nome_publico) FROM public.empresas e WHERE e.id = p_empresa_id),
    'horarios', app_private.grade_json(p_empresa_id),
    'servicos', coalesce((SELECT jsonb_agg(app_private.servico_json(s, false) - 'empresa_id' - 'versao' ORDER BY lower(s.nome))
      FROM public.servicos s WHERE s.empresa_id = p_empresa_id AND s.ativo), '[]'::jsonb),
    'aviso', 'A estimativa não é o valor final. Nenhum horário é reservado no envio: a empresa confirma depois.');
END $$;

CREATE OR REPLACE FUNCTION public.empresas_para_pedido() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'nome', coalesce(e.dados_publicados->>'nome_publico', e.nome_publico),
      'cidade', coalesce(e.dados_publicados->>'cidade', e.cidade), 'dado_de_teste', e.dado_de_teste) ORDER BY lower(e.nome_publico))
    FROM public.empresas e WHERE app_private.empresa_recebe_pedido(e.id, usuario)), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION app_private.solicitacao_json(p_id uuid, p_para_cliente boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', s.id, 'empresa_id', s.empresa_id, 'numero', s.numero, 'servico_id', s.servico_id, 'servico', s.servico_nome,
    'empresa', (SELECT e.nome_publico FROM public.empresas e WHERE e.id = s.empresa_id),
    'origem', s.origem, 'cliente_nome', s.cliente_nome, 'relato', s.relato, 'cidade', s.cidade, 'bairro', s.bairro,
    'preferencia', s.preferencia, 'respostas', s.respostas, 'estimativa', s.estimativa, 'estado', s.estado,
    'estado_exibicao', CASE WHEN s.estado IN ('orcamento_enviado', 'revisao_pedida') AND v.valido_ate < app_private.hoje_sp() THEN 'vencido' ELSE s.estado END,
    'aceite', s.aceite, 'motivo_encerramento', s.motivo_encerramento, 'encerrada_em', s.encerrada_em, 'versao', s.versao,
    'criado_em', s.criado_em,
    'aguarda_os', s.estado = 'aceita' AND NOT EXISTS (SELECT 1 FROM public.ordens_servico o2 WHERE o2.solicitacao_id = s.id),
    'os', app_private.os_resumo(s.id, p_para_cliente), 'origem_os_id', s.origem_os_id,
    'politica_cancelamento', CASE WHEN s.estado IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida') THEN (SELECT jsonb_build_object('versao', pc.versao, 'texto', pc.texto) FROM public.politicas_cancelamento pc WHERE pc.empresa_id = s.empresa_id AND pc.ativa) END,
    'versao_vigente_id', s.versao_vigente_id,
    'versoes', coalesce((SELECT jsonb_agg(app_private.versao_json(o, p_para_cliente) ORDER BY o.numero DESC)
      FROM public.orcamento_versoes o WHERE o.solicitacao_id = s.id
       AND (NOT p_para_cliente OR o.estado NOT IN ('rascunho', 'aguardando_aprovacao'))), '[]'::jsonb),
    'eventos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ev.id, 'tipo', ev.tipo, 'autor_tipo', ev.autor_tipo,
        'autor', CASE WHEN ev.autor_tipo = 'equipe' AND NOT p_para_cliente THEN app_private.nome_da_pessoa(ev.autor_auth_id)
                      WHEN ev.autor_tipo = 'equipe' THEN 'Empresa' WHEN ev.autor_tipo = 'cliente' THEN s.cliente_nome ELSE 'AutoniCK' END,
        'texto', ev.texto, 'dados', ev.dados, 'interno', NOT ev.visivel_cliente, 'criado_em', ev.criado_em) ORDER BY ev.criado_em, ev.id)
      FROM public.solicitacao_eventos ev WHERE ev.solicitacao_id = s.id AND (NOT p_para_cliente OR ev.visivel_cliente)), '[]'::jsonb),
    'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim, 'confirmado_pela_empresa', true,
        'aviso', 'Horário definido pela empresa. Se não puder, peça outro horário pela mensagem.')
        || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object('id', a.id, 'avisos', a.avisos, 'justificativa', a.justificativa,
             'confirmado_por', app_private.nome_da_pessoa(a.confirmado_por)) END
      FROM public.agendamentos a WHERE a.solicitacao_id = s.id AND a.estado = 'confirmado'))
  || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object(
    'cliente_id', s.cliente_id, 'horarios_gerais', app_private.grade_json(s.empresa_id),
    'historico_horarios', coalesce((SELECT jsonb_agg(jsonb_build_object('inicio', a.inicio, 'fim', a.fim, 'estado', a.estado, 'avisos', a.avisos,
        'justificativa', a.justificativa, 'criado_em', a.criado_em) ORDER BY a.criado_em DESC)
      FROM public.agendamentos a WHERE a.solicitacao_id = s.id), '[]'::jsonb),
    'servico_atual', (SELECT jsonb_build_object('versao', sv.versao, 'ativo', sv.ativo, 'validade_dias', sv.validade_dias, 'duracao_min', sv.duracao_min)
      FROM public.servicos sv WHERE sv.id = s.servico_id)) END
  FROM public.solicitacoes_servico s
  LEFT JOIN public.orcamento_versoes v ON v.id = s.versao_vigente_id
  WHERE s.id = p_id
$$;

CREATE OR REPLACE FUNCTION public.minhas_solicitacoes() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'numero', s.numero, 'empresa', e.nome_publico, 'empresa_id', s.empresa_id,
      'servico', s.servico_nome, 'estado', s.estado,
      'estado_exibicao', CASE WHEN s.estado IN ('orcamento_enviado', 'revisao_pedida') AND v.valido_ate < app_private.hoje_sp() THEN 'vencido' ELSE s.estado END,
      'total_vigente_centavos', CASE WHEN v.estado IN ('enviada', 'aceita') THEN app_private.para_centavos(v.total) END,
      'valido_ate', v.valido_ate, 'criado_em', s.criado_em,
      'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim) FROM public.agendamentos a WHERE a.solicitacao_id = s.id AND a.estado = 'confirmado'))
      ORDER BY s.criado_em DESC)
    FROM (SELECT * FROM public.solicitacoes_servico WHERE cliente_auth_id = usuario ORDER BY criado_em DESC LIMIT 100) s
    JOIN public.empresas e ON e.id = s.empresa_id
    LEFT JOIN public.orcamento_versoes v ON v.id = s.versao_vigente_id), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION app_private.os_json(p_id uuid, p_para_cliente boolean, p_ver_custo boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  o public.ordens_servico;
  s public.solicitacoes_servico;
  v public.orcamento_versoes;
  c public.cancelamentos_os;
  r jsonb;
BEGIN
  SELECT * INTO o FROM public.ordens_servico WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.solicitacoes_servico WHERE id = o.solicitacao_id;
  SELECT * INTO v FROM public.orcamento_versoes WHERE id = o.versao_aceita_id;
  SELECT * INTO c FROM public.cancelamentos_os WHERE os_id = o.id;
  r := jsonb_build_object('id', o.id, 'numero', o.numero, 'empresa_id', o.empresa_id,
    'empresa', (SELECT e.nome_publico FROM public.empresas e WHERE e.id = o.empresa_id),
    'solicitacao_id', o.solicitacao_id, 'solicitacao_numero', s.numero, 'servico', o.servico_nome, 'origem', o.origem,
    'cliente_nome', o.cliente_nome, 'estado', o.estado, 'previsao_conclusao', o.previsao_conclusao,
    'aceita_em', o.aceita_em, 'iniciada_em', o.iniciada_em, 'concluida_em', o.concluida_em, 'encerrada_em', o.encerrada_em,
    'cancelada_em', o.cancelada_em, 'encerrada_por', o.encerrada_por, 'revisao_pendente', o.revisao_pendente,
    'garantia', CASE WHEN o.garantia_dias IS NOT NULL THEN jsonb_build_object('dias', o.garantia_dias, 'condicoes', o.garantia_condicoes,
      'ate', (o.concluida_em AT TIME ZONE 'America/Sao_Paulo')::date + o.garantia_dias,
      'aviso', 'Garantia oferecida pela empresa; não substitui os direitos previstos em lei.') END,
    'recorrencia', o.recorrencia,
    'proxima', (SELECT jsonb_build_object('solicitacao_id', x.id, 'numero', x.numero, 'estado', x.estado)
      FROM public.solicitacoes_servico x WHERE x.origem_os_id = o.id),
    'valores', app_private.os_valores(o.id, p_para_cliente),
    'versao_aceita', app_private.versao_json(v, p_para_cliente),
    'condicoes_cancelamento', jsonb_build_object('politica', v.aceite->'politica_cancelamento', 'condicoes', v.condicoes),
    'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim, 'menos_de_24h', a.inicio - now() < interval '24 hours' AND a.inicio > now(),
        'aviso', 'Horário combinado. Para mudar, peça outro horário: a mudança só vale quando a outra parte concordar.')
        || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object('id', a.id, 'avisos', a.avisos, 'justificativa', a.justificativa) END
      FROM public.agendamentos a WHERE a.solicitacao_id = o.solicitacao_id AND a.estado = 'confirmado'),
    'reagendamentos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'tipo', g.tipo, 'proposto_por', g.proposto_por,
        'inicio', g.inicio, 'fim', g.fim, 'motivo', g.motivo, 'estado', g.estado, 'resposta_motivo', g.resposta_motivo,
        'respondido_em', g.respondido_em, 'concordancia_informada', g.concordancia_informada, 'criado_em', g.criado_em,
        'menos_de_24h', g.inicio - now() < interval '24 hours' AND g.inicio > now())
        || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object('avisos', g.avisos, 'justificativa', g.justificativa,
             'autor', app_private.nome_da_pessoa(g.autor)) END ORDER BY g.criado_em DESC)
      FROM public.reagendamentos g WHERE g.os_id = o.id), '[]'::jsonb),
    'pedidos_de_reagendamento_do_cliente', (SELECT count(*) FROM public.reagendamentos g WHERE g.os_id = o.id AND g.proposto_por = 'cliente'),
    'cancelamento', CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('solicitado_por', c.solicitado_por, 'motivo', c.motivo,
      'estado_no_momento', c.estado_no_momento, 'criado_em', c.criado_em, 'arrependimento_possivel', c.arrependimento_possivel,
      'tinha_condicoes', c.tinha_condicoes,
      'aviso_arrependimento', CASE WHEN c.arrependimento_possivel THEN 'Cancelamento em até 7 dias da contratação pela plataforma, antes do início do serviço: não há custos de cancelamento. Regra sujeita a revisão jurídica.' END) END,
    'custos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', pc.id, 'numero', pc.numero, 'itens', pc.itens,
        'justificativa', pc.justificativa, 'total_centavos', app_private.para_centavos(pc.total), 'estado', pc.estado,
        'contestacao', pc.contestacao, 'resposta_por', pc.resposta_por, 'respondida_em', pc.respondida_em,
        'acordo_valor_centavos', app_private.para_centavos(pc.acordo_valor), 'acordo_texto', pc.acordo_texto,
        'motivo_retirada', pc.motivo_retirada, 'tem_titulo', pc.titulo_id IS NOT NULL, 'versao', pc.versao, 'criado_em', pc.criado_em,
        'aviso', 'Proposta de custos não é dívida: só vale com a sua concordância ou um acordo registrado.')
        ORDER BY pc.numero DESC) FROM public.propostas_custo_cancelamento pc WHERE pc.os_id = o.id), '[]'::jsonb),
    'eventos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ev.id, 'tipo', ev.tipo, 'de', ev.de_estado, 'para', ev.para_estado,
        'autor_tipo', ev.autor_tipo,
        'autor', CASE WHEN ev.autor_tipo = 'equipe' AND NOT p_para_cliente THEN app_private.nome_da_pessoa(ev.autor_auth_id)
                      WHEN ev.autor_tipo = 'equipe' THEN 'Empresa' WHEN ev.autor_tipo = 'cliente' THEN o.cliente_nome ELSE 'AutoniCK' END,
        'texto', ev.texto, 'dados', CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE ev.dados END, 'interno', NOT ev.publico,
        'criado_em', ev.criado_em) ORDER BY ev.criado_em, ev.id)
      FROM public.os_eventos ev WHERE ev.os_id = o.id AND (NOT p_para_cliente OR ev.publico)), '[]'::jsonb),
    'encerramento', app_private.os_encerramento(o),
    'versao', o.versao);
  IF NOT p_para_cliente THEN
    r := r || jsonb_build_object('cliente_id', o.cliente_id, 'responsavel_auth_id', o.responsavel_auth_id,
      'responsavel', app_private.nome_da_pessoa(o.responsavel_auth_id),
      'materiais', app_private.os_materiais_json(o.id, p_ver_custo), 'ver_custo', p_ver_custo);
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.minhas_os() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'numero', o.numero, 'empresa', e.nome_publico, 'servico', o.servico_nome,
      'estado', o.estado, 'solicitacao_id', o.solicitacao_id, 'criado_em', o.criado_em,
      'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim) FROM public.agendamentos a
                   WHERE a.solicitacao_id = o.solicitacao_id AND a.estado = 'confirmado'),
      'acao_pendente', CASE
        WHEN EXISTS (SELECT 1 FROM public.reagendamentos g WHERE g.os_id = o.id AND g.estado = 'pendente' AND g.proposto_por = 'empresa') THEN 'responder_horario'
        WHEN EXISTS (SELECT 1 FROM public.propostas_custo_cancelamento pc WHERE pc.os_id = o.id AND pc.estado IN ('pendente', 'acordo_proposto')) THEN 'responder_custos'
        WHEN o.estado = 'concluida' AND NOT o.revisao_pendente THEN 'confirmar_recebimento' END) ORDER BY o.criado_em DESC)
    FROM (SELECT * FROM public.ordens_servico WHERE cliente_auth_id = usuario ORDER BY criado_em DESC LIMIT 100) o
    JOIN public.empresas e ON e.id = o.empresa_id), '[]'::jsonb);
END $$;


DROP FUNCTION public.ck_historico_limites();
DROP FUNCTION public.definir_vitrine_servico(uuid, boolean, integer, text);
DROP FUNCTION public.definir_vitrine_produto(uuid, boolean, integer, text);
DROP FUNCTION public.minha_autorizacao_demonstracao();
DROP FUNCTION public.vitrine_demonstracao(uuid);
DROP FUNCTION public.buscar_demonstracao(jsonb, integer);
DROP FUNCTION public.filtros_demonstracao();
DROP FUNCTION public.vitrine_publica(uuid);
DROP FUNCTION public.buscar_vitrine(jsonb, integer);
DROP FUNCTION public.filtros_vitrine();
DROP FUNCTION app_private.vitrine_do_conjunto(text, uuid, boolean);
DROP FUNCTION app_private.buscar_no_conjunto(text, jsonb, integer);
DROP FUNCTION app_private.filtros_do_conjunto(text);
DROP FUNCTION app_private.produto_vitrine_json(public.produtos);
DROP FUNCTION app_private.servico_vitrine_json(public.servicos);
DROP FUNCTION app_private.texto_publico(text);
DROP FUNCTION app_private.produto_publico(public.produtos);
DROP FUNCTION app_private.servico_publico(public.servicos);
DROP FUNCTION app_private.cartoes_do_conjunto(text);
DROP FUNCTION app_private.nome_aprovado(uuid);
DROP FUNCTION app_private.casa_inicio(text, text);
DROP FUNCTION app_private.normalizar(text);
DROP FUNCTION app_private.exigir_demonstracao();
DROP FUNCTION app_private.demonstracao_autorizada(text);
DROP FUNCTION app_private.revogar_demonstracao(text, text, text);
DROP FUNCTION app_private.autorizar_demonstracao(text, text, text, integer);

DROP TABLE app_private.autorizacoes_demonstracao;
ALTER TABLE public.servicos DROP COLUMN exibir_na_vitrine;
ALTER TABLE public.produtos DROP COLUMN exibir_na_vitrine;
DELETE FROM app_private.historico_migracoes WHERE id = '202611130002';

COMMIT;
