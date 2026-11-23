-- Rollback de 202611170002_exportacao_pdf. Gerado por db/geradores/m13/gerar.py.
BEGIN;

DROP FUNCTION IF EXISTS public.registrar_exportacao_pdf(uuid, text, uuid, date, date, text);

CREATE OR REPLACE FUNCTION public.exportar_financeiro(p_empresa_id uuid, p_tipo text, p_de date DEFAULT NULL, p_ate date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  p record;
  v_colunas jsonb;
  v_linhas jsonb;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.visualizar', 'financeiro.exportar']);
  p := app_private.ler_periodo(p_de, p_ate);
  IF p_tipo = 'lancamentos' THEN
    v_colunas := '["Data","Conta","Tipo","Natureza","Categoria","Entrada (R$)","Saída (R$)","Descrição","Origem","Estorno de","Registrado por"]';
    SELECT coalesce(jsonb_agg(jsonb_build_array(l.data, c.nome, l.tipo, l.natureza, cat.nome,
        CASE WHEN l.sentido = 'entrada' THEN app_private.para_centavos(l.valor) END,
        CASE WHEN l.sentido = 'saida' THEN app_private.para_centavos(l.valor) END,
        coalesce(l.descricao, t.descricao), l.origem_tipo, l.estorno_de, app_private.nome_da_pessoa(l.autor))
        ORDER BY l.data, l.criado_em), '[]'::jsonb)
      INTO v_linhas FROM (SELECT * FROM public.lancamentos_financeiros WHERE empresa_id = p_empresa_id AND data BETWEEN p.de AND p.ate
                           ORDER BY data, criado_em LIMIT 5000) l
      JOIN public.contas_financeiras c ON c.id = l.conta_id
      LEFT JOIN public.categorias_financeiras cat ON cat.id = l.categoria_id
      LEFT JOIN public.titulos_financeiros t ON t.id = l.titulo_id;
  ELSIF p_tipo = 'titulos' THEN
    v_colunas := '["Tipo","Descrição","Categoria","Referência","Contraparte","Parcela","Vencimento","Valor (R$)","Saldo (R$)","Situação"]';
    SELECT coalesce(jsonb_agg(jsonb_build_array(t.tipo, t.descricao, cat.nome, t.competencia, coalesce(ce.nome, fo.nome, t.contraparte_texto),
        pa.sequencia, pa.vencimento, app_private.para_centavos(pa.valor), app_private.para_centavos(pa.saldo),
        app_private.estado_exibicao(pa.estado, pa.vencimento, pa.estado = 'parcial')) ORDER BY pa.vencimento, t.descricao, pa.sequencia), '[]'::jsonb)
      INTO v_linhas FROM public.titulos_financeiros t
      JOIN public.parcelas_financeiras pa ON pa.titulo_id = t.id
      LEFT JOIN public.categorias_financeiras cat ON cat.id = t.categoria_id
      LEFT JOIN public.clientes_empresa ce ON ce.id = t.cliente_empresa_id
      LEFT JOIN public.fornecedores fo ON fo.id = t.fornecedor_id
     WHERE t.empresa_id = p_empresa_id AND (pa.vencimento BETWEEN p.de AND p.ate OR t.competencia BETWEEN p.de AND p.ate);
  ELSIF p_tipo IN ('categorias', 'contas') THEN
    v_linhas := (public.relatorio_financeiro(p_empresa_id, p_tipo, p.de, p.ate))->'linhas';
    IF p_tipo = 'categorias' THEN
      v_colunas := '["Natureza","Categoria","Entradas (R$)","Saídas (R$)","Líquido (R$)","Lançamentos"]';
      SELECT coalesce(jsonb_agg(jsonb_build_array(x->'natureza', x->'categoria', x->'entradas_centavos', x->'saidas_centavos',
        x->'liquido_centavos', x->'lancamentos')), '[]'::jsonb) INTO v_linhas FROM jsonb_array_elements(v_linhas) x;
    ELSE
      v_colunas := '["Conta","Tipo","Saldo inicial (R$)","Entradas (R$)","Saídas (R$)","Saldo final (R$)"]';
      SELECT coalesce(jsonb_agg(jsonb_build_array(x->'conta', x->'tipo', x->'saldo_inicial_centavos', x->'entradas_centavos',
        x->'saidas_centavos', x->'saldo_final_centavos')), '[]'::jsonb) INTO v_linhas FROM jsonb_array_elements(v_linhas) x;
    END IF;
  ELSIF p_tipo = 'conferencias' THEN
    v_colunas := '["Mês","Caixa","Esperado (R$)","Contado (R$)","Diferença (R$)","Motivo","Conferido por","Conferido em","Fechamento"]';
    SELECT coalesce(jsonb_agg(jsonb_build_array(x->'mes', x->'conta', x->'esperado_centavos', x->'contado_centavos',
        x->'diferenca_centavos', x->'motivo', x->'conferido_por', x->'conferido_em', x->'estado_fechamento')), '[]'::jsonb)
      INTO v_linhas FROM jsonb_array_elements(app_private.conferencias_caixa(p_empresa_id, p.de, p.ate)) x;
  ELSE
    PERFORM app_private.erro('VALIDATION_ERROR', 'Exportação desconhecida.', 'tipo');
  END IF;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.exportacao', 'lancamentos_financeiros', NULL,
    jsonb_build_object('tipo', p_tipo, 'de', p.de, 'ate', p.ate, 'linhas', jsonb_array_length(v_linhas)));
  RETURN jsonb_build_object('tipo', p_tipo, 'periodo', jsonb_build_object('de', p.de, 'ate', p.ate), 'colunas', v_colunas,
    'linhas', v_linhas, 'valores_em_centavos', true, 'limite_atingido', jsonb_array_length(v_linhas) >= 5000);
END $$;

DELETE FROM app_private.historico_migracoes WHERE id = '202611170002';

COMMIT;
