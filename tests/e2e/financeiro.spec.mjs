/**
 * Telas do M07 (financeiro) com SIMULAÇÃO do contrato da Data API. Comprovam a interface: método e aviso de
 * estimativa nos indicadores, o que aparece por permissão, parcelas enviadas em centavos, erros do banco ao lado do
 * campo (saldo insuficiente, mês fechado), confirmação de transferência e de dinheiro do proprietário, conferência
 * de caixa só do proprietário, CSV para planilha, acessibilidade e 360 px. As regras reais estão em
 * tests/db/financeiro.test.mjs e em verificar:neon:m07.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { lerPdfBaixado } from './pdf-util.mjs';

const BASE = '/__neon_simulado';
const EMP = 'e0000000-0000-4000-8000-000000000007';
const AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FIN = ['financeiro.visualizar', 'financeiro.criar', 'financeiro.aprovar', 'financeiro.cancelar', 'financeiro.fechar', 'financeiro.exportar', 'produtos.ver_custo'];
const CAIXA = 'c0000000-0000-4000-8000-000000000001';
const BANCO = 'c0000000-0000-4000-8000-000000000002';
const T1 = 'f0000000-0000-4000-8000-000000000001';

function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}

const contas = () => [
  { id: CAIXA, nome: 'Caixa da empresa', tipo: 'caixa', permite_negativo: false, padrao: true, ativa: true, saldo_centavos: 7500, versao: 3 },
  { id: BANCO, nome: 'Banco do bairro', tipo: 'banco', permite_negativo: false, padrao: false, ativa: true, saldo_centavos: 50000, versao: 2 },
];
const categorias = [
  { id: 'k1', tipo: 'receita', nome: 'Vendas', sistema: true, codigo_sistema: 'vendas', ativa: true, ordem: 1, versao: 1 },
  { id: 'k2', tipo: 'receita', nome: 'Outras receitas', sistema: false, ativa: true, ordem: 90, versao: 1 },
  { id: 'k3', tipo: 'despesa', nome: 'Compras para revenda', sistema: true, codigo_sistema: 'compras', ativa: true, ordem: 1, versao: 2 },
  { id: 'k5', tipo: 'despesa', nome: 'Insumos e materiais de uso interno', sistema: true, codigo_sistema: 'insumos', ativa: true, ordem: 2, versao: 1 },
  { id: 'k4', tipo: 'despesa', nome: 'Aluguel', sistema: false, ativa: true, ordem: 10, versao: 1 },
];
const resumo = (disponivel = true) => ({
  periodo: { de: '2026-11-01', ate: '2026-11-12' },
  fluxo: { saldo_inicial_centavos: 0, receitas_recebidas_centavos: 12000, devolucoes_e_estornos_de_receita_centavos: 4500, despesas_pagas_centavos: 1200,
    estornos_de_despesa_centavos: 0, transferido_entre_contas_centavos: 12500, aportes_centavos: 30000, retiradas_centavos: 0, ajustes_centavos: 69500, diferencas_caixa_centavos: -500, saldos_iniciais_centavos: 70000,
    variacao_operacional_centavos: 6300, saldo_final_centavos: 106300, metodo: 'Regime de caixa: soma do que entrou e saiu das contas.' },
  resultado: disponivel ? { disponivel: true, receita_vendas_centavos: 13000, vendas_canceladas_centavos: 4000, outras_receitas_centavos: 8000,
    custo_mercadorias_vendidas_centavos: 5000, margem_bruta_centavos: 4000, despesas_centavos: 120000, resultado_estimado_centavos: -108000,
    compras_mercadorias_centavos: 60000, compras_revenda_centavos: 60000, insumos_centavos: 20000, reconhecimento_insumos: 'compra',
    cobertura_custo_percentual: 72.7, parcial: true,
    metodo: 'Competência simplificada: vendas confirmadas no período...', aviso: 'Estimativa gerencial. Não é contabilidade oficial nem substitui um contador.' }
    : { disponivel: false, motivo: 'O resultado usa o custo das mercadorias vendidas, e seu acesso não permite ver custos.', receita_vendas_centavos: 13000,
      vendas_canceladas_centavos: 0, outras_receitas_centavos: 0, despesas_centavos: 0, compras_mercadorias_centavos: 0, metodo: 'Competência simplificada', aviso: 'Estimativa gerencial. Não é contabilidade oficial nem substitui um contador.' },
});
const titulo = (extra = {}) => ({ id: T1, tipo: 'pagar', origem_tipo: 'manual', origem_id: null, descricao: 'Forno novo', categoria_id: 'k4', categoria: 'Aluguel',
  competencia: '2026-11-12', contraparte_tipo: 'texto', contraparte: 'Loja de fornos', total_centavos: 90000, baixado_centavos: 0, saldo_centavos: 90000,
  a_devolver_centavos: 0, estado: 'aberto', estado_exibicao: 'pendente', proximo_vencimento: '2026-11-20', motivo_cancelamento: null, versao: 1,
  criado_em: '2026-11-12T12:00:00Z', parcelas: [{ id: 'pa1', sequencia: 1, valor_centavos: 30000, saldo_centavos: 30000, vencimento: '2026-11-20', estado: 'aberta', estado_exibicao: 'pendente', versao: 1 },
    { id: 'pa2', sequencia: 2, valor_centavos: 30000, saldo_centavos: 30000, vencimento: '2026-12-20', estado: 'aberta', estado_exibicao: 'pendente', versao: 1 },
    { id: 'pa3', sequencia: 3, valor_centavos: 30000, saldo_centavos: 30000, vencimento: '2027-01-20', estado: 'aberta', estado_exibicao: 'pendente', versao: 1 }],
  baixas: [], ...extra });
const lancamento = (extra = {}) => ({ id: 'l1', data: '2026-11-10', sentido: 'saida', valor_centavos: 1200, tipo: 'despesa_avulsa', natureza: 'despesa', categoria: 'Aluguel',
  conta_id: BANCO, conta: 'Banco do bairro', descricao: 'Frete', origem_tipo: 'manual', origem_id: null, titulo_id: null, estorno_de: null, estornado: false,
  carga_m06: false, autor: 'Pessoa', criado_em: '2026-11-10T12:00:00Z', ...extra });

async function simular(context, { permissoes = FIN, papel = 'proprietario', erros = {} } = {}) {
  const estado = { chamadas: [], corpos: {}, titulo: titulo(), fechamentos: [] };
  await context.route('**/js/config/public-config.js', (rota) => rota.fulfill({
    contentType: 'text/javascript',
    body: `export const CONFIG_PUBLICA = Object.freeze({ ambiente: 'teste', neonAuthUrl: '${BASE}/auth', neonDataApiUrl: '${BASE}/api' });`,
  }));
  await context.route(`**${BASE}/**`, async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(BASE, '');
    const corpo = req.postData() ? JSON.parse(req.postData()) : null;
    estado.chamadas.push(caminho);
    estado.corpos[caminho] = corpo;
    const json = (status, d, cab = {}) => rota.fulfill({ status, contentType: 'application/json', headers: cab, body: JSON.stringify(d) });
    if (caminho === '/auth/get-session') return json(200, { user: { id: 'u1', name: 'Pessoa', email: 'p@autonick-teste.example', emailVerified: true } }, { 'set-auth-jwt': jwt('u1') });
    if (erros[caminho]?.length) return json(400, erros[caminho].shift());
    const ve = permissoes.includes('financeiro.visualizar');
    switch (caminho) {
      case '/api/perfis_identidade': return json(200, [{ id: 'p1', tipo_conta: 'business', nome: 'Pessoa', criado_em: '2026-11-01T12:00:00Z' }]);
      case '/api/empresas': return json(200, [{ id: EMP, nome_publico: 'Mercearia Teste', versao: 1, dado_de_teste: true, situacao_vitrine: 'rascunho' }]);
      case '/api/rpc/minhas_permissoes': return json(200, { membro_id: 'm', papel, perfil_id: null, perfil_nome: null, permissoes });
      case '/api/rpc/gerar_recorrencias': return json(200, { gerados: 2, nao_gerados_mes_fechado: 0, aviso: 'As contas recorrentes são geradas quando alguém abre o financeiro; não há processamento automático contínuo.' });
      case '/api/rpc/painel_financeiro': return json(200, { ...resumo(permissoes.includes('produtos.ver_custo')), contas: contas(), consolidado_centavos: 57500,
        a_receber: { aberto_centavos: 5000, vencido_centavos: 0, parcelas_vencidas: 0 },
        a_pagar: { aberto_centavos: 120000, vencido_centavos: 9900, parcelas_vencidas: 1, vence_em_7_dias_centavos: 0 },
        devolucoes_a_fazer_centavos: 2500, previsto_a_pagar_centavos: 29700, fechado_ate: '2026-09-30', ve_custo: permissoes.includes('produtos.ver_custo'),
        fontes: { contas: 'Saldo de cada conta = soma de todos os lançamentos registrados nela.', a_receber_a_pagar: 'Parcelas abertas; "vencido" é calculado hoje.', previsto: 'Recorrências dos próximos 3 meses.' },
        divergencias_caixa: { recorrente: true, meses_com_diferenca: 2, faltas_centavos: 500, sobras_centavos: 200,
          alerta: 'Diferenças de caixa se repetiram em 2 ou mais dos últimos 6 meses. Vale revisar o controle do dinheiro em espécie.',
          caixas: [{ conta_id: CAIXA, conta: 'Caixa da empresa', conferencias: 3, meses_com_diferenca: 2, meses_com_diferenca_ultimos_6: 2, faltas_centavos: 500, sobras_centavos: 200, recorrente: true }] },
        aviso_registro: 'Nenhum dinheiro é movimentado pelo sistema.' });
      case '/api/rpc/contas_da_empresa': return json(200, ve ? contas() : contas().map(({ saldo_centavos, permite_negativo, versao, ...c }) => c));
      case '/api/rpc/categorias_financeiras_da_empresa': return json(200, categorias);
      case '/api/rpc/titulos_da_empresa': return json(200, { total: 1, itens: [estado.titulo] });
      case '/api/rpc/titulo_detalhe': return json(200, estado.titulo);
      case '/api/rpc/criar_titulo': estado.titulo = titulo({ descricao: corpo.p_dados.descricao }); return json(200, estado.titulo);
      case '/api/rpc/registrar_pagamento': {
        const pa = estado.titulo.parcelas.find((p) => p.id === corpo.p_parcela_id);
        pa.saldo_centavos -= corpo.p_valor_centavos;
        pa.estado_exibicao = 'parcial';
        estado.titulo.saldo_centavos -= corpo.p_valor_centavos;
        estado.titulo.baixas = [{ id: 'g1', tipo: 'pagamento', valor_centavos: corpo.p_valor_centavos, forma: corpo.p_forma, data: '2026-11-12', conta: 'Banco do bairro', autor: 'Pessoa', estornado: false }];
        return json(200, { pagamento_id: 'g1', saldo_parcela_centavos: pa.saldo_centavos, saldo_titulo_centavos: estado.titulo.saldo_centavos });
      }
      case '/api/rpc/compras_para_conta_pagar': return json(200, [{ id: 'cp1', data_compra: '2026-10-08', numero_documento: 'NF-123', fornecedor: 'Laticínios Fictícios', custo_total_centavos: 60000, estado: 'registrada' }]);
      case '/api/rpc/gerar_titulo_compra': return json(200, titulo({ id: 'f2', origem_tipo: 'compra', descricao: 'Compra nº NF-123' }));
      case '/api/rpc/lancamentos_da_empresa': return json(200, { total: 2, itens: [lancamento(), lancamento({ id: 'l2', tipo: 'retirada', natureza: 'proprietario', categoria: null, descricao: 'Retirada do proprietário', conta: 'Caixa da empresa' })] });
      case '/api/rpc/registrar_lancamento': return json(200, lancamento({ id: 'l3' }));
      case '/api/rpc/transferir': return json(200, { id: 'tr1', conta_origem: 'Caixa da empresa', conta_destino: 'Banco do bairro', valor_centavos: corpo.p_dados.valor_centavos, saldo_origem_centavos: 2500, saldo_destino_centavos: 55000 });
      case '/api/rpc/registrar_movimento_proprietario': return json(200, lancamento({ id: 'l4', tipo: corpo.p_dados.tipo, natureza: 'proprietario' }));
      case '/api/rpc/estornar_lancamento': return json(200, lancamento({ id: 'l5', tipo: 'estorno' }));
      case '/api/rpc/situacao_fechamento': return json(200, { fechado_ate: '2026-09-30', proximo_mes: '2026-10-01', pode_fechar: true, motivo: null,
        pode_fechar_permissao: permissoes.includes('financeiro.fechar'), eh_proprietario: papel === 'proprietario',
        pendencias: { parcelas_vencidas_receber: 0, parcelas_vencidas_pagar: 1, devolucoes_a_fazer_centavos: 2500, recorrencias_nao_geradas: 0 },
        resumo: resumo(), caixas: [{ conta_id: CAIXA, conta: 'Caixa da empresa', esperado_centavos: 4000 }],
        fechamentos: [{ id: 'fe1', mes: '2026-09-01', estado: 'fechado', fechado_em: '2026-10-02T12:00:00Z', fechado_por: 'Pessoa', reaberto_em: null, reaberto_por: null,
          motivo_reabertura: null, saldos: [{ conta_id: CAIXA, conta: 'Caixa da empresa', saldo_centavos: 0 }], resumo: resumo(),
          conferencias: [{ conta_id: CAIXA, conta: 'Caixa da empresa', esperado_centavos: 500, contado_centavos: 0, diferenca_centavos: -500, motivo: 'Falta de troco no fim do mês',
            conferido_por: 'Pessoa', conferido_em: '2026-10-02T12:00:00Z', lancamento_id: 'l9' }] }] });
      case '/api/rpc/fechar_periodo': return json(200, { id: 'fe2', mes: '2026-10-01', fechado_ate: '2026-10-31', saldos: [], conferencias: corpo.p_conferencias });
      case '/api/rpc/reabrir_periodo': return json(200, { id: 'fe1', mes: '2026-09-01', estado: 'reaberto', fechado_ate: null });
      case '/api/rpc/recorrencias_da_empresa': return json(200, [{ id: 'r1', descricao: 'Internet da loja', valor_centavos: 9900, categoria_id: 'k4', categoria: 'Aluguel', fornecedor_id: null,
        fornecedor: null, periodicidade: 'mensal', dia_vencimento: 31, inicio: '2026-09-01', fim: null, ativa: true, versao: 1, gerados: 3, ultimo_gerado: '2026-11-01',
        previstos: [{ competencia: '2026-12-01', vencimento: '2026-12-31', valor_centavos: 9900 }, { competencia: '2027-02-01', vencimento: '2027-02-28', valor_centavos: 9900 }] }]);
      case '/api/rpc/criar_conta': return json(200, { id: 'c3', nome: corpo.p_dados.nome, tipo: corpo.p_dados.tipo, saldo_centavos: 0, versao: 1 });
      case '/api/rpc/criar_recorrencia': return json(200, { id: 'r2' });
      case '/api/rpc/relatorio_financeiro': if (corpo.p_tipo === 'conferencias') {
        return json(200, { tipo: 'conferencias', periodo: { de: corpo.p_de, ate: corpo.p_ate }, metodo: 'Todas as conferências do caixa físico; nunca é apagada.',
          aviso: 'Estimativa gerencial. Não é contabilidade oficial nem substitui um contador.',
          linhas: [{ mes: '2026-09-01', estado_fechamento: 'fechado', conta: 'Caixa da empresa', esperado_centavos: 500, contado_centavos: 0, diferenca_centavos: -500,
            motivo: 'Falta de troco no fim do mês', conferido_por: 'Pessoa', conferido_em: '2026-10-02T12:00:00Z', divergente: true },
          { mes: '2026-08-01', estado_fechamento: 'fechado', conta: 'Caixa da empresa', esperado_centavos: 900, contado_centavos: 900, diferenca_centavos: 0,
            motivo: null, conferido_por: 'Pessoa', conferido_em: '2026-09-02T12:00:00Z', divergente: false }] });
      }
        return json(200, { tipo: corpo.p_tipo, periodo: { de: corpo.p_de, ate: corpo.p_ate }, metodo: 'Regime de caixa: lançamentos por categoria.',
        aviso: 'Estimativa gerencial. Não é contabilidade oficial nem substitui um contador.',
        linhas: [{ natureza: 'receita', categoria: 'Vendas', entradas_centavos: 12000, saidas_centavos: 4500, liquido_centavos: 7500, lancamentos: 5 },
          { natureza: 'interna', categoria: 'Transferências entre contas', entradas_centavos: 12500, saidas_centavos: 12500, liquido_centavos: 0, lancamentos: 2 }] });
      case '/api/rpc/exportar_financeiro': return json(200, { tipo: corpo.p_tipo, periodo: { de: corpo.p_de, ate: corpo.p_ate },
        colunas: ['Data', 'Conta', 'Descrição', 'Entrada (R$)', 'Saída (R$)'], linhas: [['2026-11-02', 'Caixa da empresa', 'Venda; balcão', 12500, null], ['2026-11-03', 'Banco', '=1+1', null, 1200]],
        valores_em_centavos: true, limite_atingido: false });
      case '/api/rpc/venda_detalhe': return json(200, { id: 'v1', numero: 9, estado: 'confirmada', entrega: 'entregue', versao: 2, subtotal_centavos: 4000,
        desconto_itens_centavos: 0, desconto_geral_centavos: 0, total_centavos: 4000, empresa_id: EMP, origem: 'balcao', cliente: null, condicao: 'a_vista',
        autor_nome: 'Pessoa', eh_autor: true, confirmada_em: '2026-11-12T12:00:00Z', confirmada_por_nome: 'Pessoa', criado_em: '2026-11-12T12:00:00Z',
        itens: [{ variacao_id: 'x1', produto: 'Queijo', variacao: 'Padrão', quantidade: 1, preco_centavos: 4000, desconto_centavos: 0, valor_centavos: 4000, entrega: 'entregue', custo_centavos: null }],
        pagamento: { titulo_id: 'tv', estado: 'aberto', total_centavos: 4000, recebido_centavos: 0, saldo_centavos: 4000, a_devolver_centavos: 0 },
        parcelas: [{ id: 'pv1', sequencia: 1, valor_centavos: 4000, saldo_centavos: 4000, vencimento: '2026-11-12', estado: 'aberta' }], recebimentos: [], eventos: [] });
      case '/api/rpc/registrar_recebimento': return json(200, { recebimento_id: 'rv1', parcela_id: 'pv1', conta_id: corpo.p_conta_id, saldo_parcela_centavos: 0, saldo_titulo_centavos: 0 });
      case '/api/rpc/reconciliar_financeiro': return json(200, { ok: true, contas_divergentes: [], titulos_divergentes: [] });
      case '/api/rpc/registrar_exportacao_pdf': return json(200, { registrado: true, documento: corpo.p_documento, formato: 'pdf' });
      default: return json(404, {});
    }
  });
  return estado;
}

const pronto = (page) => expect(page.locator('#conteudo-pagina [aria-busy="true"]')).toHaveCount(0);

test('painel: cada número com fonte e método, aviso de estimativa, resultado parcial e recorrências geradas ao abrir [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/financeiro.html?id=${EMP}`);
  await expect(page.locator('#consolidado')).toHaveText('Total da empresa: R$ 575,00');
  await expect(page.locator('#aviso-registro')).toContainText('Nenhum dinheiro é movimentado');
  await expect(page.locator('#aviso-recorrencias')).toContainText('Não há processamento automático contínuo');
  await expect(page.locator('#avisos')).toContainText('2 contas recorrentes foram geradas agora');
  await expect(page.locator('#secao-fluxo')).toContainText('Aportes do proprietário (não é receita)');
  await expect(page.locator('#secao-fluxo')).toContainText('Transferido entre contas (não muda o total)');
  await expect(page.locator('#secao-fluxo')).toContainText('Como é calculado: Regime de caixa');
  await expect(page.locator('#secao-resultado')).toContainText('Não é contabilidade oficial');
  await expect(page.locator('#secao-resultado')).toContainText('Resultado estimado (parcial)');
  await expect(page.locator('#cobertura')).toContainText('72,7%');
  await expect(page.locator('#nota-revenda')).toContainText('viram custo quando o produto é vendido');
  await expect(page.locator('#nota-insumos')).toContainText('Insumos e materiais de uso interno no período: R$ 200,00');
  await expect(page.locator('#dados-fluxo')).toContainText('Saldos iniciais de contas');
  await expect(page.locator('#dados-fluxo')).toContainText('Diferenças de conferência de caixa');
  await expect(page.locator('#alerta-divergencias')).toContainText('se repetiram em 2 ou mais dos últimos 6 meses');
  await expect(page.locator('#fechado-ate')).toContainText('setembro de 2026');
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Financeiro', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(estado.chamadas.filter((c) => c === '/api/rpc/gerar_recorrencias')).toHaveLength(1);
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
});

test('sem custo: resultado não aparece e explica o motivo; sem financeiro: tela negada e link escondido [simulação]', async ({ page, context }) => {
  await simular(context, { permissoes: ['financeiro.visualizar'], papel: 'funcionario' });
  await page.goto(`/business/financeiro.html?id=${EMP}`);
  await expect(page.locator('#secao-resultado')).toContainText('seu acesso não permite ver custos');
  await expect(page.locator('#resultado-estimado')).toHaveCount(0);
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await simular(context, { permissoes: ['vendas.visualizar'], papel: 'funcionario' });
  await page.goto(`/business/financeiro.html?id=${EMP}`);
  await expect(page.locator('#conteudo-pagina')).toContainText('não inclui o financeiro');
  await expect(page.getByRole('link', { name: 'Financeiro' })).toHaveCount(0);
});

test('conta a pagar parcelada: parcelas em centavos, pagamento parcial com saldo insuficiente avisado e depois aceito [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { erros: { '/api/rpc/registrar_pagamento': [
    { hint: 'INSUFFICIENT_FUNDS', message: 'Saldo insuficiente em "Caixa da empresa" (R$ 75,00 disponível agora). O caixa físico nunca fica negativo.', details: 'valor_centavos' }] } });
  await page.goto(`/business/financeiro-contas.html?id=${EMP}`);
  await expect(page.locator('#tabela-titulos')).toContainText('Forno novo');
  await page.locator('#nova-descricao').fill('Forno novo');
  await page.locator('#nova-categoria').selectOption('k4');
  await page.locator('#nova-total').fill('900,00');
  await page.locator('#nova-parcelas').selectOption('3');
  await page.locator('#nova-vencimento').fill('2027-01-31');
  await page.locator('#nova-vencimento').dispatchEvent('input');
  await expect(page.locator('#previa-parcelas')).toContainText('Parcela 2: R$ 300,00, vence 28/02/2027');
  await page.getByRole('button', { name: 'Lançar conta' }).click();
  const c = estado.corpos['/api/rpc/criar_titulo'];
  expect(c.p_dados.parcelas).toEqual([{ valor_centavos: 30000, vencimento: '2027-01-31' }, { valor_centavos: 30000, vencimento: '2027-02-28' },
    { valor_centavos: 30000, vencimento: '2027-03-31' }]);
  expect(c.p_dados.tipo).toBe('pagar');
  expect(JSON.stringify(c)).not.toMatch(/total_centavos|saldo/);
  await expect(page.locator('#detalhe-titulo')).toBeFocused();
  await page.locator('[data-baixar="1"]').click();
  await page.locator('#baixa-1-valor').fill('100,00');
  await page.locator('#baixa-1-forma').selectOption('dinheiro');
  await page.getByRole('button', { name: 'Registrar pagamento' }).last().click();
  await expect(page.locator('#avisos')).toContainText('O caixa físico nunca fica negativo');
  await page.locator('[data-baixar="1"]').click();
  await page.locator('#baixa-1-valor').fill('100,00');
  await page.locator('#baixa-1-conta').selectOption(BANCO);
  await page.locator('#baixa-1-forma').selectOption('pix');
  await page.getByRole('button', { name: 'Registrar pagamento' }).last().click();
  await expect(page.locator('#avisos')).toContainText('Pagamento de R$ 100,00 registrado');
  expect(estado.corpos['/api/rpc/registrar_pagamento']).toMatchObject({ p_parcela_id: 'pa1', p_valor_centavos: 10000, p_conta_id: BANCO, p_forma: 'pix' });
  await expect(page.locator('#lista-parcelas')).toContainText('Pago em parte');
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
});

test('compra de fornecedor vira conta a pagar só quando a pessoa pede [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/financeiro-contas.html?id=${EMP}`);
  await expect(page.locator('#lista-compras')).toContainText('Laticínios Fictícios');
  await page.locator('[data-compra="cp1"]').click();
  await page.locator('#conta-compra-parcelas').selectOption('2');
  await page.locator('#conta-compra-vencimento').fill('2026-11-20');
  await page.getByRole('button', { name: 'Gerar conta a pagar' }).last().click();
  await expect(page.locator('#avisos')).toContainText('Conta a pagar da compra gerada');
  expect(estado.corpos['/api/rpc/gerar_titulo_compra'].p_dados.parcelas).toEqual([{ valor_centavos: 30000, vencimento: '2026-11-20' }, { valor_centavos: 30000, vencimento: '2026-12-20' }]);
});

test('movimentações: mês fechado ao lado da data, transferência explica que não é receita, dono confirma retirada [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { erros: { '/api/rpc/registrar_lancamento': [
    { hint: 'PERIOD_LOCKED', message: 'O mês de 09/2026 já foi fechado. Registre a correção com a data de hoje; ela entra no período aberto.', details: 'data' }] } });
  await page.goto(`/business/financeiro-movimentacoes.html?id=${EMP}`);
  await expect(page.locator('#tabela-lancamentos')).toContainText('Retirada do proprietário');
  await page.locator('#avulso-valor').fill('12,00');
  await page.locator('#avulso-categoria').selectOption('k4');
  await page.locator('#avulso-descricao').fill('Frete esquecido');
  await page.locator('#avulso-data').fill('2026-09-15');
  await page.getByRole('button', { name: 'Registrar' }).first().click();
  await expect(page.locator('#avulso-data-erro')).toContainText('já foi fechado');
  await expect(page.locator('#avulso-data')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#transf-destino').selectOption(BANCO);
  await page.locator('#transf-valor').fill('50,00');
  await page.getByRole('button', { name: 'Transferir' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Não é receita nem despesa');
  await page.getByRole('dialog').getByRole('button', { name: 'Transferir' }).click();
  await expect(page.locator('#avisos')).toContainText('Transferência registrada');
  expect(estado.corpos['/api/rpc/transferir'].p_dados).toMatchObject({ conta_origem_id: CAIXA, conta_destino_id: BANCO, valor_centavos: 5000 });
  await page.locator('#dono-valor').fill('100,00');
  await page.locator('#salvar-proprietario').click();
  await expect(page.getByRole('dialog')).toContainText('não é despesa da empresa');
  await page.getByRole('dialog').getByRole('button', { name: 'Registrar' }).click();
  await expect(page.locator('#avisos')).toContainText('Retirada registrada');
  expect(estado.corpos['/api/rpc/registrar_movimento_proprietario'].p_dados).toMatchObject({ tipo: 'retirada', conta_id: CAIXA, valor_centavos: 10000 });
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
});

test('funcionário com financeiro: sem formulário de aporte e retirada, e sem estornar a retirada do dono [simulação]', async ({ page, context }) => {
  await simular(context, { papel: 'funcionario', permissoes: FIN.filter((p) => p !== 'financeiro.fechar') });
  await page.goto(`/business/financeiro-movimentacoes.html?id=${EMP}`);
  await expect(page.locator('#form-proprietario')).toHaveCount(0);
  await expect(page.locator('#conteudo-pagina')).toContainText('registrados só por ele');
  await expect(page.locator('[data-lancamento="l2"] [data-estornar]')).toHaveCount(0);
  await expect(page.locator('[data-lancamento="l1"] [data-estornar]')).toHaveCount(1);
});

test('fechamento: dono confere o caixa com motivo da diferença; confirmação explica o congelamento; reabertura com justificativa [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/financeiro-fechamento.html?id=${EMP}`);
  await expect(page.locator('#secao-proximo')).toContainText('outubro de 2026');
  await expect(page.locator('#pendencias')).toContainText('1 parcela(s) a pagar vencida(s)');
  await page.locator('#contado-0').fill('43,00');
  await page.getByRole('button', { name: 'Fechar outubro de 2026' }).click();
  await expect(page.locator('#motivo-0-erro')).toContainText('Explique a diferença');
  await page.locator('#motivo-0').fill('Sobra de troco encontrada na gaveta');
  await page.getByRole('button', { name: 'Fechar outubro de 2026' }).click();
  await expect(page.getByRole('dialog')).toContainText('nada com data neste mês pode ser lançado');
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar o mês' }).click();
  await expect(page.locator('#avisos')).toContainText('foi fechado');
  expect(estado.corpos['/api/rpc/fechar_periodo']).toMatchObject({ p_mes: '2026-10-01',
    p_conferencias: [{ conta_id: CAIXA, contado_centavos: 4300, motivo: 'Sobra de troco encontrada na gaveta' }] });
  await page.locator('#reabrir-mes').click();
  await page.locator('#reabrir-motivo').fill('curto');
  await page.getByRole('button', { name: 'Reabrir', exact: true }).click();
  await expect(page.locator('#reabrir-motivo-erro')).toContainText('pelo menos 10');
  await page.locator('#reabrir-motivo').fill('Faltou lançar uma nota de setembro');
  await page.getByRole('button', { name: 'Reabrir', exact: true }).click();
  await expect(page.locator('#avisos')).toContainText('foi reaberto');
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
});

test('fechamento por funcionário: fecha sem conferência e não vê reabrir [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { papel: 'funcionario' });
  await page.goto(`/business/financeiro-fechamento.html?id=${EMP}`);
  await expect(page.locator('#contado-0')).toHaveCount(0);
  await expect(page.locator('#reabrir-mes')).toHaveCount(0);
  await expect(page.locator('#form-fechar')).toContainText('registrada pelo proprietário');
  await page.getByRole('button', { name: 'Fechar outubro de 2026' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar o mês' }).click();
  await expect(page.locator('#avisos')).toContainText('foi fechado');
  expect(estado.corpos['/api/rpc/fechar_periodo'].p_conferencias).toEqual([]);
});

test('relatórios: método na tela; CSV com BOM, ";", centavos em reais e proteção contra fórmula; sem permissão, sem botão [simulação]', async ({ page, context }) => {
  await simular(context);
  await page.goto(`/business/financeiro-relatorios.html?id=${EMP}`);
  await expect(page.locator('#tabela-relatorio')).toContainText('Transferências entre contas');
  await expect(page.locator('#conteudo-pagina')).toContainText('Como é calculado: Regime de caixa');
  const download = page.waitForEvent('download');
  await page.locator('[data-exportar="lancamentos"]').click();
  const arquivo = await download;
  expect(arquivo.suggestedFilename()).toMatch(/^autonick-financeiro-lancamentos-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/);
  const conteudo = (await (await arquivo.createReadStream()).toArray()).join('');
  expect(conteudo.startsWith('﻿')).toBe(true);
  expect(conteudo).toContain('Data;Conta;Descrição;Entrada (R$);Saída (R$)\r\n');
  expect(conteudo).toContain('2026-11-02;Caixa da empresa;"Venda; balcão";125,00;\r\n');
  expect(conteudo).toContain("'=1+1;;12,00");
  await expect(page.locator('#avisos')).toContainText('2 linha(s)');
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await simular(context, { permissoes: ['financeiro.visualizar'], papel: 'funcionario' });
  await page.goto(`/business/financeiro-relatorios.html?id=${EMP}`);
  await expect(page.locator('#sem-exportacao')).toBeVisible();
  await expect(page.locator('[data-exportar]')).toHaveCount(0);
});

test('configurações: conta só com nome e tipo, caixa nunca negativo, recorrência com aviso de geração e conferência do dono [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/financeiro-configuracoes.html?id=${EMP}`);
  await expect(page.locator('#tabela-contas')).toContainText('Banco do bairro');
  await expect(page.locator('#lista-recorrencias')).toContainText('28/02/2027');
  await expect(page.locator('#aviso-geracao')).toContainText('Não há processamento automático contínuo');
  await page.locator('#conta-nome').fill('Gaveta 2');
  await page.locator('#conta-tipo').selectOption('caixa');
  await page.locator('#conta-negativo').check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.locator('#conta-negativo-erro')).toHaveText('O caixa físico nunca fica negativo.');
  expect(estado.corpos['/api/rpc/criar_conta']).toBeUndefined();
  await page.locator('#conta-negativo').uncheck();
  await page.locator('#conta-tipo').selectOption('banco');
  await page.locator('#conta-saldo').fill('1.000,00');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.locator('#avisos')).toContainText('Conta "Gaveta 2" criada');
  const dados = estado.corpos['/api/rpc/criar_conta'].p_dados;
  expect(dados).toMatchObject({ nome: 'Gaveta 2', tipo: 'banco', permite_negativo: false, saldo_inicial_centavos: 100000 });
  expect(Object.keys(dados).sort()).toEqual(['data_saldo_inicial', 'nome', 'permite_negativo', 'saldo_inicial_centavos', 'tipo']);
  await page.locator('#conferir-saldos').click();
  await expect(page.locator('#resultado-conferencia')).toContainText('Tudo confere');
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
});

test('venda (M06 com M07): o recebimento escolhe a conta onde o valor entrou (D7-16) [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { permissoes: [...FIN, 'vendas.visualizar', 'vendas.registrar_recebimento'] });
  await page.goto(`/business/venda.html?id=${EMP}&venda=v1`);
  await page.locator('[data-receber="1"]').click();
  await expect(page.locator('#receber-1-conta')).toHaveValue(CAIXA);
  await page.locator('#receber-1-conta').selectOption(BANCO);
  await page.locator('#receber-1-forma').selectOption('pix');
  await page.getByRole('button', { name: 'Registrar recebimento' }).last().click();
  await expect(page.locator('#avisos')).toContainText('Recebimento de R$ 40,00 registrado');
  expect(estado.corpos['/api/rpc/registrar_recebimento']).toMatchObject({ p_parcela_id: 'pv1', p_valor_centavos: 4000, p_conta_id: BANCO });
});

for (const caminho of ['financeiro', 'financeiro-contas', 'financeiro-movimentacoes', 'financeiro-fechamento', 'financeiro-relatorios', 'financeiro-configuracoes']) {
  test(`360 px sem rolagem horizontal: /business/${caminho}.html [simulação]`, async ({ page, context }) => {
    await simular(context);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`/business/${caminho}.html?id=${EMP}`);
    await pronto(page);
    await page.waitForTimeout(200);
    const larguras = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(larguras[0]).toBeLessThanOrEqual(larguras[1]);
  });
}

test('conferências de caixa: quem conferiu e quando no histórico, relatório próprio com e sem diferença e exportação [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/financeiro-fechamento.html?id=${EMP}`);
  await page.getByText('Saldos e conferências').first().click();
  await expect(page.locator('[data-fechamento="fe1"]')).toContainText('lançada como ajuste; conferido por Pessoa em');
  await page.goto(`/business/financeiro-relatorios.html?id=${EMP}&tipo=conferencias`);
  await expect(page.locator('#tabela-relatorio')).toContainText('Falta de troco no fim do mês');
  await expect(page.locator('#tabela-relatorio')).toContainText('sem diferença');
  await expect(page.locator('#tabela-relatorio')).toContainText('Pessoa');
  expect(estado.corpos['/api/rpc/relatorio_financeiro'].p_tipo).toBe('conferencias');
  await expect(page.locator('[data-exportar="conferencias"]')).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
});

test('M13: relatório em PDF com as permissões do CSV; conteúdo do arquivo conferido; registro antes da entrega [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/financeiro-relatorios.html?id=${EMP}`);
  await expect(page.locator('#tabela-relatorio')).toContainText('Transferências entre contas');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar este relatório em PDF' }).click();
  const arquivo = await download;
  expect(arquivo.suggestedFilename()).toMatch(/^relatorio-categorias-mercearia-teste-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdf = await lerPdfBaixado(arquivo);
  expect(pdf.assinatura).toBe('%PDF-');
  for (const t of ['Entradas e saídas por categoria', 'Empresa: Mercearia Teste', 'Vendas', 'Transferências entre contas', 'R$ 245,00', 'R$ 170,00', 'R$ 75,00',
    'Relatório interno de gestão, sem valor fiscal', 'Como é calculado', 'Regime de caixa', 'Página 1 de 1']) expect(pdf.texto).toContain(t);
  expect(estado.corpos['/api/rpc/registrar_exportacao_pdf']).toMatchObject({ p_empresa_id: EMP, p_documento: 'relatorio_categorias', p_referencia_id: null });
  expect(estado.corpos['/api/rpc/registrar_exportacao_pdf'].p_operation_key).toBeTruthy();
  await expect(page.locator('#avisos')).toContainText('PDF gerado');
  await expect(page.locator('#avisos')).toContainText('o AutoniCK registra apenas que ele foi gerado');
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
  const caches = await page.evaluate(async () => { const urls = []; for (const n of await window.caches.keys()) for (const q of await (await window.caches.open(n)).keys()) urls.push(q.url); return urls; });
  expect(caches.some((u) => u.endsWith('.pdf') || u.includes('pdf-lib'))).toBe(false);
});

test('M13: sem "exportar o financeiro" não há botão de PDF; registro negado pelo banco não entrega arquivo [simulação]', async ({ page, context }) => {
  await simular(context, { permissoes: ['financeiro.visualizar'], papel: 'funcionario' });
  await page.goto(`/business/financeiro-relatorios.html?id=${EMP}`);
  await expect(page.locator('#tabela-relatorio')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Baixar este relatório em PDF' })).toHaveCount(0);
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await simular(context, { erros: { '/api/rpc/registrar_exportacao_pdf': [{ code: 'P0001', hint: 'FORBIDDEN_ACTION', message: 'Seu perfil não permite exportar o financeiro.' }] } });
  await page.goto(`/business/financeiro-relatorios.html?id=${EMP}`);
  let baixou = false;
  page.on('download', () => { baixou = true; });
  await page.getByRole('button', { name: 'Baixar este relatório em PDF' }).click();
  await expect(page.locator('#avisos')).toContainText('Seu perfil não permite exportar o financeiro.');
  await page.waitForTimeout(800);
  expect(baixou).toBe(false);
});

test('M13: relatório longo em PDF quebra em páginas sem cortar linhas nem separar os totais [simulação]', async ({ page, context }) => {
  await simular(context);
  await context.route(`**/__neon_simulado/api/rpc/relatorio_financeiro`, (rota) => rota.fulfill({ contentType: 'application/json', body: JSON.stringify({
    tipo: 'categorias', periodo: { de: '2026-01-01', ate: '2026-11-17' }, metodo: 'Regime de caixa.', aviso: 'Estimativa gerencial.',
    linhas: Array.from({ length: 140 }, (_, i) => ({ natureza: 'receita', categoria: `Categoria fictícia ${String(i + 1).padStart(3, '0')}`, entradas_centavos: 100, saidas_centavos: 0, liquido_centavos: 100, lancamentos: 1 })) }) }));
  await page.goto(`/business/financeiro-relatorios.html?id=${EMP}`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar este relatório em PDF' }).click();
  const pdf = await lerPdfBaixado(await download);
  expect(pdf.paginas.length).toBeGreaterThan(2);
  for (let i = 1; i <= 140; i += 1) expect(pdf.texto.split(`Categoria fictícia ${String(i).padStart(3, '0')}`).length - 1).toBe(1);
  const ultima = pdf.paginas.at(-1);
  expect(ultima).toContain('Total');
  expect(ultima).toContain('R$ 140,00');
  for (const [i, p] of pdf.paginas.entries()) expect(p).toContain(`Página ${i + 1} de ${pdf.paginas.length}`);
});
