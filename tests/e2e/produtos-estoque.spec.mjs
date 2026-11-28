/**
 * Telas do M05 (produtos, estoque, fornecedores e compras) com SIMULAÇÃO do contrato da
 * Data API. Comprovam a interface: o que aparece por permissão, validação ao lado do campo,
 * proposta x lançamento direto (D5-04), estorno com motivo, custo escondido, chave de operação
 * e acessibilidade. As regras reais estão em tests/db/estoque.test.mjs e verificar:neon:m05.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = '/__neon_simulado';
const EMP = 'e0000000-0000-4000-8000-000000000001';
const AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const TODAS = ['produtos.visualizar', 'produtos.criar', 'produtos.alterar', 'produtos.alterar_preco', 'produtos.ver_custo',
  'estoque.visualizar', 'estoque.propor', 'estoque.aprovar', 'fornecedores.visualizar', 'fornecedores.alterar'];
const ESTOQUISTA = ['produtos.visualizar', 'produtos.criar', 'produtos.alterar', 'estoque.visualizar', 'estoque.propor'];

function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}

const variacao = (id, extra = {}) => ({ id, padrao: false, atributos: { Cor: 'Azul' }, rotulo: 'Azul', sku: null, ativo: true, versao: 1,
  estoque_minimo: 3, preco_centavos: 4990, custo_centavos: 2100, fisico: 8, reservado: 2, disponivel: 6, abaixo_minimo: false, ...extra });
const produtoBase = () => ({ id: 'p1', nome: 'Camiseta', descricao: null, categoria_id: null, finalidade: 'comercializavel', sob_encomenda: false,
  venda_pausada: false, motivo_pausa: null, fornecedor_padrao_id: null, ativo: true, versao: 1,
  variacoes: [variacao('v1'), variacao('v2', { atributos: { Cor: 'Preta' }, rotulo: 'Preta', disponivel: 1, fisico: 1, reservado: 0, abaixo_minimo: true })],
  resumo: { fisico: 9, reservado: 2, disponivel: 7, variacoes_em_alerta: 1 } });

async function simular(context, { permissoes = TODAS, papel = 'proprietario', produtos = [produtoBase()], pendentes = [], historico = [], erros = {} } = {}) {
  const estado = { produtos, pendentes, historico, compras: [], fornecedores: [{ id: 'f1', nome: 'Distribuidora', documento: null, telefone: null, email: null, observacoes: null, ativo: true, versao: 1 }],
    chamadas: [], corpos: {}, chaves: [] };
  const semCusto = (lista) => (permissoes.includes('produtos.ver_custo') ? lista
    : lista.map((p) => ({ ...p, variacoes: p.variacoes.map(({ custo_centavos, ...v }) => v) })));
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
    if (caminho === '/auth/get-session') return json(200, { user: { id: 'u1', name: 'Pessoa', email: 'p@teste.example', emailVerified: true } }, { 'set-auth-jwt': jwt('u1') });
    if (erros[caminho]?.length) {
      const e = erros[caminho].shift();
      if (e === 'rede') return rota.abort('failed');
      return json(400, e);
    }
    switch (caminho) {
      case '/api/perfis_identidade': return json(200, [{ id: 'p1', tipo_conta: 'business', nome: 'Pessoa', criado_em: '2026-11-01T12:00:00Z' }]);
      case '/api/empresas': return json(200, [{ id: EMP, nome_publico: 'Loja Teste', versao: 1, dado_de_teste: true }]);
      case '/api/rpc/minhas_permissoes': return json(200, { membro_id: 'm', papel, perfil_id: null, perfil_nome: null, permissoes });
      case '/api/rpc/produtos_da_empresa': return json(200, semCusto(estado.produtos));
      case '/api/rpc/alertas_estoque': return json(200, estado.produtos.flatMap((p) => p.variacoes.filter((v) => v.abaixo_minimo)
        .map((v) => ({ produto_id: p.id, produto_nome: p.nome, variacao_id: v.id, rotulo: v.rotulo, disponivel: v.disponivel, estoque_minimo: v.estoque_minimo, sob_encomenda: false }))));
      case '/api/rpc/propostas_da_empresa': return json(200, estado.pendentes);
      case '/api/rpc/historico_movimentacoes': return json(200, estado.historico);
      case '/api/rpc/compras_da_empresa': return json(200, estado.compras);
      case '/api/fornecedores': return json(200, estado.fornecedores);
      case '/api/rpc/fornecedores_da_empresa': return json(200, estado.fornecedores);
      case '/api/rpc/criar_produto': {
        const novo = { ...produtoBase(), id: 'p2', nome: corpo.p_dados.nome, finalidade: corpo.p_dados.finalidade, variacoes: [variacao('v9', { padrao: !corpo.p_variacoes, rotulo: 'Padrão', atributos: {} })] };
        estado.produtos.push(novo);
        return json(200, { id: 'p2', nome: novo.nome, versao: 1, variacoes: [], estoque_inicial: corpo.p_dados.quantidade_inicial ? { estado: permissoes.includes('estoque.aprovar') ? 'aprovada' : 'pendente' } : null });
      }
      case '/api/rpc/registrar_movimentacao':
      case '/api/rpc/propor_movimentacao': {
        const direto = caminho.endsWith('registrar_movimentacao');
        if (!direto) estado.pendentes.push({ id: 'pr1', tipo: corpo.p_tipo, estado: 'pendente', motivo: corpo.p_motivo, autor_nome: 'Pessoa', sou_autor: true, versao: 1,
          criado_em: '2026-11-01T13:00:00Z', itens: [{ variacao_id: 'v1', produto_nome: 'Camiseta', rotulo: 'Azul', quantidade: corpo.p_itens[0].quantidade }] });
        return json(200, { proposta_id: 'pr1', estado: direto ? 'aprovada' : 'pendente', saldos: direto ? [{ variacao_id: 'v1', fisico: 10, reservado: 2, disponivel: 8 }] : [] });
      }
      case '/api/rpc/aprovar_proposta': estado.pendentes = []; return json(200, { proposta_id: 'pr1', estado: 'aprovada', saldos: [] });
      case '/api/rpc/estornar_movimentacao': estado.historico = estado.historico.map((m) => ({ ...m, estornada: true })); return json(200, { estornada: true });
      case '/api/rpc/criar_compra': estado.compras.push({ id: 'c1', estado: 'rascunho', data_compra: '2026-11-01', fornecedor_nome: 'Distribuidora', versao: 1, sou_autor: true,
        autor_nome: 'Pessoa', criado_em: '2026-11-01T13:00:00Z', itens: [{ variacao_id: 'v1', produto_nome: 'Camiseta', rotulo: 'Azul', quantidade: corpo.p_itens[0].quantidade }] });
        return json(200, { id: 'c1', estado: 'rascunho', versao: 1 });
      case '/api/rpc/registrar_compra': estado.compras[0].estado = permissoes.includes('estoque.aprovar') ? 'recebida' : 'registrada';
        return json(200, { id: 'c1', estado: estado.compras[0].estado });
      case '/api/rpc/pausar_venda_produto': estado.produtos[0].venda_pausada = corpo.p_pausar; estado.produtos[0].motivo_pausa = corpo.p_motivo; return json(200, { venda_pausada: corpo.p_pausar });
      case '/api/rpc/alterar_preco': return json(200, { preco_centavos: corpo.p_preco_centavos, versao: 2 });
      default: return json(404, {});
    }
  });
  return estado;
}

const historicoExemplo = [{ id: 'm1', criado_em: '2026-11-01T12:00:00Z', tipo: 'entrada', produto_nome: 'Camiseta', rotulo: 'Azul', variacao_id: 'v1',
  quantidade: 5, fisico_apos: 8, motivo: null, ator_nome: 'Pessoa', origem_tipo: 'proposta', proposta_id: 'pr0', estorno_de: null, estornada: false, custo_centavos: null }];

test('proprietária cadastra produto: finalidade obrigatória e preço validado ao lado do campo (D5-01, C-13) [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/produtos-empresa.html?id=${EMP}`);
  await expect(page.locator('#lista-produtos')).toContainText('Camiseta');
  await expect(page.locator('#lista-produtos')).toContainText('R$ 49,90');
  await expect(page.locator('#lista-produtos')).toContainText('Estoque baixo em 1 variação');
  await expect(page.locator('#conteudo')).toContainText('Dado de teste');
  await page.locator('#novo-produto').click();   // pacote 27/11: lista primeiro, cadastro sob demanda
  await page.locator('#novo-nome').fill('Caneca');
  await page.getByRole('button', { name: 'Cadastrar produto' }).click();
  await expect(page.locator('[data-grupo="finalidade"]')).toHaveText('Escolha se o produto é comercializável ou de uso interno.');
  await page.getByLabel('Uso interno (insumo)').check();
  await page.locator('#simples-preco').fill('12,345');
  await page.getByRole('button', { name: 'Cadastrar produto' }).click();
  await expect(page.locator('#simples-preco-erro')).toContainText('duas casas');
  await page.locator('#simples-preco').fill('12,50');
  await page.locator('#simples-inicial').fill('4');
  await page.getByRole('button', { name: 'Cadastrar produto' }).click();
  await expect(page.locator('#avisos')).toContainText('Produto "Caneca" cadastrado.');
  await expect(page.locator('#avisos')).toContainText('O estoque inicial já está lançado.');
  expect(estado.corpos['/api/rpc/criar_produto'].p_dados).toMatchObject({ nome: 'Caneca', finalidade: 'uso_interno', preco_centavos: 1250, quantidade_inicial: 4 });
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
});

test('produto com variações: grade com atributos e repetição apontada (D5-12) [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/produtos-empresa.html?id=${EMP}`);
  await page.locator('#novo-produto').click();
  await page.locator('#novo-nome').fill('Vestido');
  await page.getByLabel('Comercializável', { exact: true }).check();
  await page.getByLabel('Sim, tem variações').check();
  await page.locator('#novo-atributo1').fill('Tamanho');
  await page.locator('#novo-atributo1').blur();
  await page.locator('#var-0-a1').fill('P');
  await page.locator('#var-0-preco').fill('89,90');
  await page.getByRole('button', { name: 'Adicionar variação' }).click();
  await page.locator('#var-1-a1').fill(' p ');
  await page.locator('#var-1-preco').fill('89,90');
  await page.getByRole('button', { name: 'Cadastrar produto' }).click();
  await expect(page.locator('#var-1-a1-erro')).toHaveText('Esta variação repete outra.');
  await page.locator('#var-1-a1').fill('M');
  await page.getByRole('button', { name: 'Cadastrar produto' }).click();
  await expect(page.locator('#avisos')).toContainText('Produto "Vestido" cadastrado.');
  expect(estado.corpos['/api/rpc/criar_produto'].p_variacoes).toEqual([
    { atributos: { Tamanho: 'P' }, preco_centavos: 8990 }, { atributos: { Tamanho: 'M' }, preco_centavos: 8990 }]);
});

test('estoquista: custo escondido, movimentação vira proposta e não há estorno (D5-04, SEC-001) [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { permissoes: ESTOQUISTA, papel: 'funcionario', historico: historicoExemplo });
  await page.goto(`/business/produto.html?id=${EMP}&produto=p1`);
  await expect(page.locator('#conteudo-pagina')).toContainText('Variações, preços e estoque');
  await expect(page.locator('#conteudo-pagina')).not.toContainText('Último custo');
  await expect(page.locator('#conteudo-pagina')).not.toContainText('R$ 21,00');
  await page.goto(`/business/estoque-empresa.html?id=${EMP}`);
  await expect(page.locator('#lista-alertas')).toContainText('Camiseta (Preta)');
  await expect(page.locator('#form-movimentacao')).toHaveCount(0);   // pacote 27/11: sem formulário de movimentação na abertura
  await expect(page.locator('[data-estornar]')).toHaveCount(0);
  await page.locator('#ajustar-estoque').click();
  await expect(page.locator('#mov-custo')).toHaveCount(0);
  await page.locator('#mov-tipo').selectOption('entrada');
  await page.locator('#mov-variacao').selectOption('v1');
  await page.locator('#mov-quantidade').fill('3');
  await page.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(page.locator('#avisos')).toContainText('Ajuste enviado para aprovação.');
  expect(estado.chamadas).toContain('/api/rpc/propor_movimentacao');
  expect(estado.chamadas).not.toContain('/api/rpc/registrar_movimentacao');
  await expect(page.locator('#lista-pendentes')).toContainText('Cancelar minha proposta');
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
});

test('quem aprova: aprova pendência e estorna com motivo obrigatório no diálogo [simulação]', async ({ page, context }) => {
  await simular(context, { historico: historicoExemplo, pendentes: [{ id: 'pr9', tipo: 'saida', estado: 'pendente', motivo: 'Amostra', autor_nome: 'Eva', sou_autor: false,
    versao: 1, criado_em: '2026-11-01T13:00:00Z', itens: [{ variacao_id: 'v1', produto_nome: 'Camiseta', rotulo: 'Azul', quantidade: 1 }] }] });
  await page.goto(`/business/estoque-empresa.html?id=${EMP}`);
  await expect(page.locator('#lista-pendentes')).toContainText('Saída por Eva');
  await page.getByRole('button', { name: 'Aprovar e aplicar' }).click();
  await expect(page.locator('#avisos')).toContainText('Movimentação aprovada e aplicada ao estoque.');
  await page.locator('#secao-historico summary').click();
  await page.locator('[data-estornar="m1"]').click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toContainText('a original continua no histórico');
  await dialogo.getByRole('button', { name: 'Estornar' }).click();
  await expect(page.locator('#estorno-erro')).toHaveText('Explique o estorno com pelo menos 10 caracteres.');
  await page.locator('#estorno-motivo').fill('Entrada lançada na variação errada');
  await dialogo.getByRole('button', { name: 'Estornar' }).click();
  await expect(page.locator('#avisos')).toContainText('Movimentação estornada.');
  await expect(page.locator('#tabela-historico')).toContainText('(estornada)');
});

test('falta de estoque explicada; perda de rede reaproveita a mesma chave (API-OP-037) [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { erros: { '/api/rpc/registrar_movimentacao': [
    { hint: 'INSUFFICIENT_STOCK', message: 'Estoque insuficiente: há 6 disponíveis de Camiseta (Azul).', details: 'v1' }, 'rede'] } });
  await page.goto(`/business/estoque-empresa.html?id=${EMP}`);
  await page.locator('#ajustar-estoque').click();
  await page.locator('#mov-tipo').selectOption('saida');
  await page.locator('#mov-variacao').selectOption('v1');
  await page.locator('#mov-quantidade').fill('9');
  await page.locator('#mov-motivo').fill('Avaria no transporte');
  await page.getByRole('button', { name: 'Lançar no estoque' }).click();
  await expect(page.locator('#avisos')).toContainText('há 6 disponíveis');
  await expect(page.getByRole('dialog')).toContainText('há 6 disponíveis');   // o erro aparece também dentro do modal
  await page.locator('#mov-quantidade').fill('2');
  await page.getByRole('button', { name: 'Lançar no estoque' }).click();
  await expect(page.locator('#avisos')).toContainText('não será duplicada');
  await page.getByRole('button', { name: 'Lançar no estoque' }).click();
  await expect(page.locator('#avisos')).toContainText('Estoque atualizado.');
  const envios = estado.chaves.filter((c) => c.startsWith('/api/rpc/registrar_movimentacao'));
  expect(envios).toHaveLength(3);
  expect(envios[0]).not.toEqual(envios[1]);
  expect(envios[1]).toEqual(envios[2]);
});

test('pausa comercial com motivo e preço com histórico (D5-08, RF-045) [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/produto.html?id=${EMP}&produto=p1`);
  await page.locator('#pausa-motivo').fill('Coleção encerrada');
  await page.getByRole('button', { name: 'Pausar a venda' }).click();
  await expect(page.locator('#avisos')).toContainText('Venda pausada. O estoque continua o mesmo.');
  await expect(page.locator('#conteudo-pagina')).toContainText('A venda deste produto está pausada.');
  await page.locator('tr[data-variacao="v1"] summary', { hasText: 'Alterar' }).click();
  await page.locator('#preco-v1').fill('52,90');
  await page.locator('tr[data-variacao="v1"]').getByRole('button', { name: 'Salvar preço' }).click();
  await expect(page.locator('#avisos')).toContainText('Preço alterado para R$ 52,90.');
  expect(estado.corpos['/api/rpc/alterar_preco']).toMatchObject({ p_preco_centavos: 5290, p_expected_version: 1 });
});

test('compras: quem não vê custo não informa custo; registro vira proposta (D5-04, D5-06) [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { permissoes: ESTOQUISTA, papel: 'funcionario' });
  await page.goto(`/business/fornecedores.html?id=${EMP}`);
  await expect(page.getByRole('alert')).toContainText('não inclui os fornecedores');
  expect(estado.chamadas).not.toContain('/api/rpc/fornecedores_da_empresa');
  // Pacote 27/11 (item 4): Compras é um destino próprio, com lista e "Nova compra" em modal.
  await page.goto(`/business/compras.html?id=${EMP}`);
  await page.locator('#nova-compra').click();
  await expect(page.locator('#compra-fornecedor')).toHaveCount(0);
  await page.locator('#compra-produto').fill('Cami');
  await expect(page.getByRole('option', { name: /Camiseta/ }).first()).toBeVisible();
  await page.locator('#compra-produto').press('ArrowDown');
  await page.locator('#compra-produto').press('Enter');
  await expect(page.locator('[data-item-compra="v1"], [data-item-compra="v2"]').first()).toBeVisible();
  await expect(page.locator('[id^="compra-custo-"]')).toHaveCount(0);
  const item = await page.locator('[data-item-compra]').first().getAttribute('data-item-compra');
  await page.locator(`#compra-qtd-${item}`).fill('10');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.locator('#avisos')).toContainText('Compra salva como rascunho.');
  expect(estado.corpos['/api/rpc/criar_compra'].p_itens).toEqual([{ variacao_id: item, quantidade: 10 }]);
  await page.getByRole('button', { name: 'Registrar compra' }).click();
  await expect(page.locator('#avisos')).toContainText('A entrada aguarda aprovação.');
  await expect(page.locator('#lista-compras')).toContainText('Aguardando aprovação da entrada');
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
});

test('celular (360 px): telas do M05 sem rolagem horizontal [simulação]', async ({ page, context }) => {
  await simular(context, { historico: historicoExemplo });
  await page.setViewportSize({ width: 360, height: 780 });
  for (const caminho of [`/business/estoque-empresa.html?id=${EMP}`, `/business/produto.html?id=${EMP}&produto=p1`, `/business/produtos-empresa.html?id=${EMP}`, `/business/fornecedores.html?id=${EMP}`, `/business/compras.html?id=${EMP}`]) {
    await page.goto(caminho);
    await page.locator('#conteudo-pagina section').first().waitFor();
    const larguras = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth,
      [...document.querySelectorAll('#conteudo *')].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 5).map((e) => `${e.tagName}.${e.className}#${e.id} ${Math.round(e.getBoundingClientRect().right)}`).join(' | ')]);
    expect(larguras[0], `${caminho} ${larguras[2]}`).toBeLessThanOrEqual(larguras[1]);
  }
});

test('sem permissão de estoque, a tela explica e não lê nada [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { permissoes: ['vitrine.visualizar'], papel: 'funcionario' });
  await page.goto(`/business/estoque-empresa.html?id=${EMP}`);
  await expect(page.getByRole('alert')).toContainText('não inclui o estoque');
  expect(estado.chamadas).not.toContain('/api/rpc/produtos_da_empresa');
});
