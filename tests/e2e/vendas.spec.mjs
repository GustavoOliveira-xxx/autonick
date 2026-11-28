/**
 * Telas do M06 (clientes, vendas, venda, pedidos e "meus pedidos") com SIMULAÇÃO do contrato da Data API.
 * Comprovam a interface: o que aparece por permissão, erro ao lado do campo, o navegador nunca envia preço,
 * total esperado, chave de operação reaproveitada só na perda de rede, diálogos com motivo, acessibilidade e 360 px.
 * As regras reais estão em tests/db/vendas.test.mjs e em verificar:neon:m06.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { lerPdfBaixado } from './pdf-util.mjs';

const BASE = '/__neon_simulado';
const EMP = 'e0000000-0000-4000-8000-000000000001';
const AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const TODAS = ['clientes.visualizar', 'clientes.criar', 'clientes.alterar', 'produtos.visualizar', 'produtos.ver_custo', 'estoque.visualizar',
  'pedidos.visualizar', 'pedidos.aprovar', 'pedidos.cancelar', 'vendas.visualizar', 'vendas.criar', 'vendas.aprovar', 'vendas.cancelar',
  'vendas.aplicar_desconto', 'vendas.registrar_recebimento', 'financeiro.visualizar', 'financeiro.cancelar'];
const VENDEDOR = ['clientes.visualizar', 'clientes.criar', 'vendas.visualizar', 'vendas.criar', 'vendas.aplicar_desconto'];
const V1 = 'a1000000-0000-4000-8000-000000000001';
const V2 = 'a1000000-0000-4000-8000-000000000002';
const VENDA = 'b1000000-0000-4000-8000-000000000001';

function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}

const catalogo = (comEstoque) => [
  { variacao_id: V1, produto: 'Bolo de pote', variacao: 'Padrão', sku: 'BP', preco_centavos: 3500, sob_encomenda: false, venda_pausada: false, tem_estoque: true, disponivel: comEstoque ? 5 : null },
  { variacao_id: V2, produto: 'Torta inteira', variacao: 'Padrão', sku: null, preco_centavos: 9000, sob_encomenda: true, venda_pausada: false, tem_estoque: true, disponivel: comEstoque ? 1 : null },
];

const vendaDetalhe = (extra = {}) => ({
  id: VENDA, numero: 7, estado: 'confirmada', entrega: 'entregue', versao: 3, subtotal_centavos: 9000, desconto_itens_centavos: 0, desconto_geral_centavos: 1000,
  total_centavos: 8000, empresa_id: EMP, origem: 'balcao', pedido_id: null, cliente_empresa_id: null, cliente: 'Ana Souza', condicao: 'a_vista', observacao: null,
  autor_nome: 'Pessoa', eh_autor: true, confirmada_em: '2026-11-02T12:00:00Z', confirmada_por_nome: 'Pessoa', cancelada_em: null, motivo_cancelamento: null, criado_em: '2026-11-02T11:59:00Z',
  itens: [{ variacao_id: V1, produto: 'Bolo de pote', variacao: 'Padrão', quantidade: 2, preco_centavos: 3500, desconto_centavos: 0, valor_centavos: 7000, sob_encomenda: false,
    entrega: 'entregue', entregue_em: '2026-11-02T12:00:00Z', destino_cancelamento: null, reservado: null, custo_centavos: 1750 },
  { variacao_id: V2, produto: 'Caixa presente', variacao: 'Padrão', quantidade: 1, preco_centavos: 2000, desconto_centavos: 0, valor_centavos: 2000, sob_encomenda: false,
    entrega: 'entregue', entregue_em: '2026-11-02T12:00:00Z', destino_cancelamento: null, reservado: null, custo_centavos: null }],
  pagamento: { titulo_id: 't1', estado: 'parcial', total_centavos: 8000, recebido_centavos: 3000, saldo_centavos: 5000, a_devolver_centavos: 0 },
  parcelas: [{ id: 'pa1', sequencia: 1, valor_centavos: 8000, saldo_centavos: 5000, vencimento: '2026-11-02', estado: 'parcial' }],
  recebimentos: [{ id: 'r1', tipo: 'recebimento', valor_centavos: 3000, forma: 'pix', data: '2026-11-02', motivo: null, estorno_de: null, estornado: false, parcela: 1, autor_nome: 'Pessoa', criado_em: '2026-11-02T12:01:00Z' }],
  eventos: [{ tipo: 'venda_confirmada', detalhes: {}, ator_nome: 'Pessoa', criado_em: '2026-11-02T12:00:00Z' }],
  ...extra,
});

const pedido = (extra = {}) => ({ id: 'c1000000-0000-4000-8000-000000000001', estado: 'solicitado', versao: 1, cliente: 'Cliente Kátia', observacao_cliente: 'Retiro sábado',
  motivo: null, total_centavos: 1200, criado_em: '2026-11-02T10:00:00Z', decidido_em: null, venda_id: null, venda_numero: null,
  itens: [{ variacao_id: V1, produto: 'Picolé', variacao: 'Padrão', quantidade: 2, preco_centavos: 600, sob_encomenda: false, venda_pausada: false, suficiente: true, disponivel: 2, reservado: null }], ...extra });

async function simular(context, { permissoes = TODAS, papel = 'proprietario', erros = {}, venda = vendaDetalhe(), pedidos = [pedido()], limite = { percentual: null, sem_limite: true } } = {}) {
  const estado = { chamadas: [], corpos: {}, chaves: [], venda, pedidos, meus: [] };
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
    if (corpo?.p_operation_key) estado.chaves.push(`${caminho}:${corpo.p_operation_key}`);
    const json = (status, d, cab = {}) => rota.fulfill({ status, contentType: 'application/json', headers: cab, body: JSON.stringify(d) });
    if (caminho === '/auth/get-session') return json(200, { user: { id: 'u1', name: 'Pessoa', email: 'p@autonick-teste.example', emailVerified: true } }, { 'set-auth-jwt': jwt('u1') });
    if (erros[caminho]?.length) {
      const e = erros[caminho].shift();
      if (e === 'rede') return rota.abort('failed');
      return json(400, e);
    }
    switch (caminho) {
      case '/api/perfis_identidade': return json(200, [{ id: 'p1', tipo_conta: 'business', nome: 'Pessoa', criado_em: '2026-11-01T12:00:00Z' },
        { id: 'p2', tipo_conta: 'cliente', nome: 'Pessoa', criado_em: '2026-11-01T12:00:00Z' }]);
      case '/api/empresas': return json(200, [{ id: EMP, nome_publico: 'Doceria Teste', versao: 1, dado_de_teste: true, situacao_vitrine: 'publicada' }]);
      case '/api/rpc/minhas_permissoes': return json(200, { membro_id: 'm', papel, perfil_id: null, perfil_nome: null, permissoes });
      case '/api/rpc/catalogo_para_venda': return json(200, catalogo(permissoes.includes('estoque.visualizar')));
      case '/api/rpc/ficha_cliente': return json(200, { cliente: { id: 'cl1', nome: 'Ana Souza', telefone: '19999990000', email: null, observacoes: 'Prefere retirar à tarde.',
        ativo: true, conta_vinculada: false, desde: '2026-10-01T12:00:00Z', versao: 1 },
        ...(permissoes.includes('vendas.visualizar') ? { resumo: { vendas: 1, total_centavos: 7000, ultima_compra: '2026-11-10T15:00:00Z' },
          vendas: [{ id: VENDA, numero: 12, estado: 'confirmada', total_centavos: 7000, data: '2026-11-10T15:00:00Z' }] } : {}) });
      case '/api/rpc/buscar_clientes': return json(200, { itens: [{ id: 'cl1', nome: 'Ana Souza', telefone: '19999990000', email: null, tipo_pessoa: 'pf', documento: null }], mais: false });
      case '/api/rpc/clientes_da_empresa': return json(200, [{ id: 'cl1', nome: 'Ana Souza', telefone: '19999990000', email: null, observacoes: null, ativo: true, versao: 1, conta_vinculada: false, vendas: 1 }]);
      case '/api/rpc/meu_limite_desconto': return json(200, limite);
      case '/api/rpc/registrar_venda_direta': return json(200, { id: VENDA, numero: 7, estado: 'confirmada', entrega: 'entregue', total_centavos: 8000, versao: 3 });
      case '/api/rpc/criar_venda': return json(200, { id: VENDA, numero: null, estado: 'rascunho', versao: 2, total_centavos: 8000 });
      case '/api/rpc/venda_detalhe': return json(200, permissoes.includes('produtos.ver_custo') ? estado.venda
        : { ...estado.venda, itens: estado.venda.itens.map((i) => ({ ...i, custo_centavos: null })) });   // como o banco: custo só com ver_custo
      case '/api/rpc/vendas_da_empresa': return json(200, [{ id: VENDA, numero: 7, estado: 'confirmada', entrega: 'entregue', origem: 'balcao', cliente: 'Ana Souza',
        total_centavos: 8000, confirmada_em: '2026-11-02T12:00:00Z', criado_em: '2026-11-02T11:59:00Z', versao: 3, autor_nome: 'Pessoa', pagamento: estado.venda.pagamento }]);
      case '/api/rpc/operacoes_da_empresa': return json(200, [{ tipo: 'venda', id: VENDA, numero: 7, origem: 'balcao', estado: 'confirmada', cliente: 'Ana Souza', total_centavos: 8000, quando: '2026-11-02T12:00:00Z' }]);
      case '/api/rpc/registrar_recebimento': {
        const pa = estado.venda.parcelas[0];
        pa.saldo_centavos -= corpo.p_valor_centavos;
        estado.venda.pagamento.recebido_centavos += corpo.p_valor_centavos;
        estado.venda.pagamento.saldo_centavos -= corpo.p_valor_centavos;
        return json(200, { recebimento_id: 'r2', parcela_id: 'pa1', saldo_parcela_centavos: pa.saldo_centavos, saldo_titulo_centavos: estado.venda.pagamento.saldo_centavos });
      }
      case '/api/rpc/cancelar_venda': estado.venda = { ...estado.venda, estado: 'cancelada', cancelada_em: '2026-11-02T13:00:00Z', motivo_cancelamento: corpo.p_motivo,
        pagamento: { ...estado.venda.pagamento, estado: 'cancelado', a_devolver_centavos: 3000 } };
        return json(200, { id: VENDA, estado: 'cancelada', a_devolver_centavos: 3000, versao: 4 });
      case '/api/rpc/pedidos_da_empresa': return json(200, estado.pedidos.filter((p) => !corpo.p_estado || p.estado === corpo.p_estado));
      case '/api/rpc/aceitar_pedido': estado.pedidos[0] = { ...estado.pedidos[0], estado: 'aceito', versao: 2 }; return json(200, { id: estado.pedidos[0].id, estado: 'aceito', reservas: [{ a_encomendar: 0 }] });
      case '/api/rpc/recusar_pedido': estado.pedidos[0] = { ...estado.pedidos[0], estado: 'recusado', motivo: corpo.p_motivo }; return json(200, { estado: 'recusado' });
      case '/api/rpc/concluir_pedido': estado.pedidos[0] = { ...estado.pedidos[0], estado: 'concluido', venda_id: VENDA, venda_numero: 8 };
        return json(200, { estado: 'concluido', venda: { id: VENDA, numero: 8 } });
      case '/api/rpc/empresas_para_pedido': return json(200, [{ id: EMP, nome: 'Doceria Teste', cidade: 'Campinas', dado_de_teste: true }]);
      case '/api/rpc/itens_para_pedido': return json(200, [{ variacao_id: V1, produto: 'Picolé', variacao: 'Padrão', preco_centavos: 600, sob_encomenda: false }]);
      case '/api/rpc/meus_pedidos': return json(200, estado.meus);
      case '/api/rpc/criar_pedido': estado.meus.unshift({ id: 'd1', estado: 'solicitado', versao: 1, empresa: 'Doceria Teste', observacao: corpo.p_observacao, motivo: null,
        total_centavos: 1200, criado_em: '2026-11-02T14:00:00Z', entrega: null, itens: [{ produto: 'Picolé', variacao: 'Padrão', quantidade: 2, preco_centavos: 600 }] });
        return json(200, { id: 'd1', estado: 'solicitado', total_centavos: 1200, versao: 1 });
      case '/api/rpc/cancelar_pedido': estado.meus[0] = { ...estado.meus[0], estado: 'cancelado' }; return json(200, { estado: 'cancelado' });
      case '/api/rpc/registrar_exportacao_pdf': estado.pdf = corpo; return json(200, { registrado: true, documento: corpo.p_documento, formato: 'pdf' });
      default: return json(404, {});
    }
  });
  return estado;
}

test('venda de balcão: preço nunca vai do navegador, desconto acima do limite ao lado do campo, rede perdida não duplica [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { erros: {
    '/api/rpc/registrar_venda_direta': [
      { hint: 'DISCOUNT_EXCEEDS_LIMIT', message: 'O desconto passa do seu limite de 10%. Peça ao proprietário para confirmar.', details: 'desconto' },
      'rede'] } });
  await page.goto(`/business/venda-nova.html?id=${EMP}`);
  await expect(page.locator('#resultado-catalogo')).toContainText('Bolo de pote');
  await expect(page.locator('#resultado-catalogo')).toContainText('5 disponíveis');
  await page.getByRole('button', { name: 'Confirmar venda' }).click();
  await expect(page.locator('#erro-itens')).toHaveText('Adicione pelo menos um produto.');
  await page.locator(`[data-adicionar="${V1}"]`).click();
  await page.locator(`#qtd-${V1}`).fill('2');
  await page.locator(`#qtd-${V1}`).dispatchEvent('change');
  // Pacote 27/11 (item 1.2): cliente por busca com teclado, resumo e troca.
  await page.locator('#venda-cliente').fill('ana');
  await expect(page.getByRole('option', { name: /Ana Souza/ })).toBeVisible();
  await page.locator('#venda-cliente').press('ArrowDown');
  await page.locator('#venda-cliente').press('Enter');
  await expect(page.locator('#venda-cliente-escolhido')).toContainText('Ana Souza');
  await page.locator('#venda-desconto').fill('10,00');
  await page.locator('#venda-desconto').dispatchEvent('input');
  await expect(page.locator('#total-previa')).toHaveText('Total previsto: R$ 60,00 (desconto de R$ 10,00)');
  await page.getByRole('button', { name: 'Confirmar venda' }).click();
  await expect(page.locator('#venda-desconto-erro')).toContainText('limite de 10%');
  await expect(page.locator('#venda-desconto')).toHaveAttribute('aria-invalid', 'true');
  const c1 = estado.corpos['/api/rpc/registrar_venda_direta'];
  expect(c1.p_itens).toEqual([{ variacao_id: V1, quantidade: 2 }]);
  expect(JSON.stringify(c1)).not.toMatch(/preco/);
  expect(c1.p_dados).toEqual({ cliente_empresa_id: 'cl1', desconto_geral_centavos: 1000 });
  expect(c1.p_total_esperado_centavos).toBe(6000);
  // Falha de rede: a mesma chave é reaproveitada na nova tentativa (a 1ª recusa por regra gerou chave nova).
  await page.getByRole('button', { name: 'Confirmar venda' }).click();
  await expect(page.locator('#avisos')).toContainText('não será duplicada');
  await page.getByRole('button', { name: 'Confirmar venda' }).click();
  await expect(page).toHaveURL(new RegExp(`/business/venda.html\\?id=${EMP}&venda=${VENDA}`));
  const chaves = estado.chaves.filter((c) => c.startsWith('/api/rpc/registrar_venda_direta:'));
  expect(chaves.length).toBe(3);
  expect(chaves[0]).not.toBe(chaves[1]);
  expect(chaves[1]).toBe(chaves[2]);
});

test('parcelado: gerar por DDL, sobra de centavos na última, entrada abate a 1ª parcela, tudo em centavos [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/venda-nova.html?id=${EMP}`);
  await page.locator(`[data-adicionar="${V1}"]`).click();
  await page.locator('#venda-condicao-parcelado').check();
  await page.locator('#venda-parcelas').selectOption('3');
  await page.getByRole('button', { name: 'Confirmar venda' }).click();
  await expect(page.locator('#gerar-parcelas-erro')).toContainText('Gerar parcelas');
  await page.locator('#gerar-parcelas').click();
  await expect(page.locator('#parcela-valor-0')).toHaveValue('11,66');
  await expect(page.locator('#parcela-valor-2')).toHaveValue('11,68');
  await expect(page.locator('#parcela-ddl-0')).toHaveText('30');
  await expect(page.locator('#parcela-ddl-2')).toHaveText('90');
  await page.locator('#parcela-valor-0').fill('10,00');
  await expect(page.locator('#resumo-pagamento')).toContainText('faltam R$ 1,66');
  await page.locator('#gerar-parcelas').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Gerar de novo' }).click();
  await expect(page.locator('#parcela-valor-0')).toHaveValue('11,66');
  await page.locator('#venda-recebido').fill('11,66');
  await page.getByRole('button', { name: 'Confirmar venda' }).click();
  await expect(page.locator('#venda-forma-erro')).toHaveText('Escolha a forma de pagamento.');
  await page.locator('#venda-forma').selectOption('pix');
  await page.getByRole('button', { name: 'Confirmar venda' }).click();
  await expect(page).toHaveURL(/venda\.html/);
  const p = estado.corpos['/api/rpc/registrar_venda_direta'].p_pagamento;
  expect(p.condicao).toBe('parcelado');
  expect(p.parcelas.map((x) => x.valor_centavos)).toEqual([1166, 1166, 1168]);
  expect(p.parcelas.every((x) => x.forma === 'pix')).toBe(true);
  expect(p.recebimento_inicial).toEqual({ valor_centavos: 1166, forma: 'pix' });
});

test('vendedor: sem confirmar, sem quantidade de estoque e sem custo; guarda rascunho [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { permissoes: VENDEDOR, papel: 'funcionario', limite: { percentual: 10, sem_limite: false } });
  await page.goto(`/business/venda-nova.html?id=${EMP}`);
  await expect(page.locator('#resultado-catalogo')).toContainText('em estoque');
  await expect(page.locator('#resultado-catalogo')).not.toContainText('disponíveis');
  await expect(page.getByRole('button', { name: 'Confirmar venda' })).toHaveCount(0);
  await expect(page.locator('#conteudo')).toContainText('Seu limite: 10%');
  await page.locator(`[data-adicionar="${V1}"]`).click();
  await page.getByRole('button', { name: 'Guardar como rascunho' }).click();
  await expect(page).toHaveURL(/venda\.html/);
  expect(estado.chamadas).toContain('/api/rpc/criar_venda');
  expect(estado.chamadas).not.toContain('/api/rpc/registrar_venda_direta');
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
});

test('detalhe da venda: recebimento pelo diálogo, cancelamento com destino por item e valor a devolver [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/venda.html?id=${EMP}&venda=${VENDA}`);
  await expect(page.locator('#total-venda')).toHaveText('R$ 80,00');
  await expect(page.locator('#tabela-itens')).toContainText('R$ 17,50');   // custo para quem vê custo
  await page.locator('[data-receber="1"]').click();
  await page.locator('#receber-1-valor').fill('60,00');
  await page.getByRole('button', { name: 'Registrar recebimento' }).last().click();
  await expect(page.locator('#receber-1-valor-erro')).toContainText('passa do saldo');
  await page.locator('#receber-1-valor').fill('20,00');
  await page.locator('#receber-1-forma').selectOption('dinheiro');
  await page.getByRole('button', { name: 'Registrar recebimento' }).last().click();
  await expect(page.locator('#avisos')).toContainText('Recebimento de R$ 20,00 registrado.');
  expect(estado.corpos['/api/rpc/registrar_recebimento']).toMatchObject({ p_parcela_id: 'pa1', p_valor_centavos: 2000, p_forma: 'dinheiro' });
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
  await page.locator('#cancelar-venda').click();
  await page.getByRole('button', { name: 'Cancelar venda' }).last().click();
  await expect(page.locator(`#cancelamento-${V1}-erro`)).toHaveText('Escolha o que aconteceu com o item.');
  await page.locator(`#cancelamento-${V1}`).selectOption('voltou');
  await page.locator(`#cancelamento-${V2}`).selectOption('danificado');
  await page.locator('#cancelamento-motivo').fill('curto');
  await page.getByRole('button', { name: 'Cancelar venda' }).last().click();
  await expect(page.locator('#cancelamento-motivo-erro')).toContainText('10 caracteres');
  await page.locator('#cancelamento-motivo').fill('Cliente desistiu da compra');
  await page.getByRole('button', { name: 'Cancelar venda' }).last().click();
  await expect(page.locator('#avisos')).toContainText('Venda cancelada.');
  expect(estado.corpos['/api/rpc/cancelar_venda'].p_destinos).toEqual({ [V1]: 'voltou', [V2]: 'danificado' });
  await expect(page.locator('#conteudo-pagina')).toContainText('Valor a devolver ao cliente: R$ 30,00');
  await expect(page.locator('#registrar-devolucao')).toBeVisible();
});

test('estorno só aparece para quem tem financeiro.cancelar; caixa registra recebimento [simulação]', async ({ page, context }) => {
  await simular(context, { permissoes: ['vendas.visualizar', 'vendas.registrar_recebimento'], papel: 'funcionario' });
  await page.goto(`/business/venda.html?id=${EMP}&venda=${VENDA}`);
  await expect(page.locator('#lista-recebimentos')).toContainText('R$ 30,00');
  await expect(page.locator('[data-estornar]')).toHaveCount(0);
  await expect(page.locator('[data-receber="1"]')).toBeVisible();
  await expect(page.locator('#cancelar-venda')).toHaveCount(0);
  await expect(page.locator('#tabela-itens')).not.toContainText('Custo');
});

test('pedidos recebidos: aceitar, recusar com motivo visível ao cliente e concluir gerando a venda [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { pedidos: [pedido(), pedido({ id: 'c1000000-0000-4000-8000-000000000002', cliente: 'Cliente Kleber' })] });
  await page.goto(`/business/pedidos-empresa.html?id=${EMP}`);
  await expect(page.locator('#lista-pedidos')).toContainText('Cliente Kátia');
  await expect(page.locator('#lista-pedidos')).toContainText('tem estoque (2 disponíveis)');
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
  await page.locator('[data-recusar="c1000000-0000-4000-8000-000000000001"]').click();
  await page.getByRole('button', { name: 'Recusar pedido' }).click();
  await expect(page.locator('[id$="-motivo-erro"]').first()).toContainText('10 caracteres');
  await page.locator('dialog textarea').fill('Sem picolé de uva esta semana');
  await page.getByRole('button', { name: 'Recusar pedido' }).click();
  await expect(page.locator('#avisos')).toContainText('O cliente verá o motivo.');
  expect(estado.corpos['/api/rpc/recusar_pedido']).toMatchObject({ p_motivo: 'Sem picolé de uva esta semana', p_expected_version: 1 });
});

test('aceite e conclusão: a reserva vem antes, a venda depois [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/pedidos-empresa.html?id=${EMP}`);
  await page.locator('[data-aceitar]').click();
  await page.getByRole('button', { name: 'Aceitar e reservar' }).last().click();
  await expect(page.locator('#avisos')).toContainText('Pedido aceito e estoque reservado.');
  await page.locator('#filtro-pedidos').selectOption('aceito');
  await page.locator('[data-concluir]').click();
  await page.getByRole('button', { name: 'Gerar a venda' }).click();
  await expect(page.locator('#avisos')).toContainText('Pedido concluído: venda nº 8.');
  expect(estado.chamadas.indexOf('/api/rpc/aceitar_pedido')).toBeLessThan(estado.chamadas.indexOf('/api/rpc/concluir_pedido'));
  expect(estado.corpos['/api/rpc/concluir_pedido'].p_pagamento).toEqual({ condicao: 'a_vista' });
});

test('cliente: faz pedido sem ver estoque, acompanha e cancela antes do aceite [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  // M11 (D11-03): o novo pedido começa pela vitrine (empresa no link); sem seletor avulso de empresas.
  await page.goto(`/cliente/pedidos.html?empresa=${EMP}`);
  await expect(page.locator('#lista-meus-pedidos')).toHaveText('Você ainda não fez pedidos.');
  await expect(page.locator('#pedido-empresa')).toHaveCount(0);
  await expect(page.locator('#itens-pedido')).toContainText('Picolé');
  await expect(page.locator('#itens-pedido')).not.toContainText('disponíveis');
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.locator('#erro-itens-pedido')).toHaveText('Informe a quantidade de pelo menos um produto.');
  await page.locator(`#qtd-${V1}`).fill('2');
  await page.locator('#pedido-observacao').fill('Retiro sábado');
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.locator('#avisos')).toContainText('Pedido enviado (R$ 12,00)');
  expect(estado.corpos['/api/rpc/criar_pedido']).toMatchObject({ p_empresa_id: EMP, p_itens: [{ variacao_id: V1, quantidade: 2 }], p_observacao: 'Retiro sábado' });
  await expect(page.locator('#lista-meus-pedidos')).toContainText('Aguardando aceite');
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
  await page.locator('[data-cancelar="d1"]').click();
  await page.getByRole('button', { name: 'Cancelar pedido' }).last().click();
  await expect(page.locator('#avisos')).toContainText('Pedido cancelado.');
});

for (const caminho of [`/business/venda-nova.html?id=${EMP}`, `/business/venda.html?id=${EMP}&venda=${VENDA}`, `/business/pedidos-empresa.html?id=${EMP}`, '/cliente/pedidos.html', `/business/vendas.html?id=${EMP}`, `/business/clientes.html?id=${EMP}`]) {
  test(`360 px sem rolagem horizontal: ${caminho.split('?')[0]} [simulação]`, async ({ page, context }) => {
    await simular(context);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(caminho);
    await expect(page.locator('#conteudo-pagina [aria-busy="true"]')).toHaveCount(0);
    await page.waitForTimeout(200);
    const larguras = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(larguras[0]).toBeLessThanOrEqual(larguras[1]);
  });
}

test('ficha do cliente: resumo, histórico em abas e links; sem permissão de vendas a parte some [simulação]', async ({ page, context }) => {
  await simular(context);
  await page.goto(`/business/clientes.html?id=${EMP}`);
  await page.getByRole('button', { name: 'Abrir ficha' }).click();
  const ficha = page.getByRole('dialog', { name: 'Ficha de Ana Souza' });
  await expect(ficha).toContainText('Compras confirmadas');
  await expect(ficha).toContainText('R$ 70,00');
  await expect(ficha).toContainText('Prefere retirar à tarde.');
  await expect(ficha.getByRole('tab', { name: /Vendas/ })).toHaveAttribute('aria-selected', 'true');
  await expect(ficha.getByRole('link', { name: 'Venda nº 12' })).toHaveAttribute('href', new RegExp(`venda=${VENDA}`));
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
});

test('ficha do cliente abre direto pelo endereço (vindo da busca Ctrl+K) [simulação]', async ({ page, context }) => {
  await simular(context, { permissoes: ['clientes.visualizar'], papel: 'funcionario' });
  await page.goto(`/business/clientes.html?id=${EMP}&busca=Ana&ficha=00000000-0000-4000-8000-0000000000c1`);
  const ficha = page.getByRole('dialog', { name: 'Ficha de Ana Souza' });
  await expect(ficha).toBeVisible();
  await expect(ficha).not.toContainText('Compras confirmadas');
  await expect(ficha).toContainText('Seu perfil não inclui vendas');
  await expect(page).not.toHaveURL(/ficha=/);
});

test('M13: comprovante da venda sem custo dos itens; rascunho sem botão [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/venda.html?id=${EMP}&venda=${VENDA}`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar comprovante da venda (PDF)' }).click();
  const arquivo = await download;
  expect(arquivo.suggestedFilename()).toMatch(/^venda-.+-numero-7\.pdf$/);
  const pdf = await lerPdfBaixado(arquivo);
  for (const t of ['Comprovante de venda: venda nº 7', 'Balcão', 'Ana Souza', 'Bolo de pote (Padrão)', 'R$ 90,00', 'R$ 10,00', 'R$ 80,00', 'Documento interno, sem valor fiscal.']) {
    expect(pdf.texto).toContain(t);
  }
  expect(pdf.texto).not.toContain('R$ 17,50');
  expect(estado.pdf).toMatchObject({ p_empresa_id: EMP, p_documento: 'venda', p_referencia_id: VENDA });
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await simular(context, { venda: vendaDetalhe({ estado: 'rascunho', numero: null }) });
  await page.goto(`/business/venda.html?id=${EMP}&venda=${VENDA}`);
  await expect(page.locator('#titulo-pagina')).toHaveText('Rascunho de venda');
  await expect(page.locator('[data-pdf]')).toHaveCount(0);
});
