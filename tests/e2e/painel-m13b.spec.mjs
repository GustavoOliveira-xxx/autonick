/**
 * M13b: painel real da empresa ativa, cadastro em etapas ligado ao banco, menu por permissões, marcador de mensagens
 * novas, introdução do Cliente e Leitura ampliada. Banco SIMULADO no navegador; dados fictícios.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = '/__neon_simulado';
const EMP = 'e0000000-0000-4000-8000-000000000013';
const TODAS = ['empresa.visualizar', 'vitrine.visualizar', 'equipe.visualizar', 'equipe.convidar', 'produtos.visualizar', 'produtos.criar', 'estoque.visualizar',
  'fornecedores.visualizar', 'clientes.visualizar', 'vendas.visualizar', 'vendas.criar', 'pedidos.visualizar', 'catalogo_servicos.visualizar',
  'catalogo_servicos.alterar', 'orcamentos.visualizar', 'servicos.visualizar', 'agenda.visualizar', 'financeiro.visualizar', 'financeiro.criar'];

function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}

const agora = new Date();
const painelCheio = () => ({
  empresa: { id: EMP, nome_publico: 'Ateliê Ponto Firme', situacao_vitrine: 'publicada', dado_de_teste: true }, hoje: agora.toISOString().slice(0, 10), gerado_em: agora.toISOString(),
  pedidos: { aguardando: 3, ultimos: [{ id: 'p1', cliente_nome: 'Cida Ramos', total_estimado_centavos: 6400, criado_em: agora.toISOString() }] },
  orcamentos: { abertas: 5, mais_antiga_em: new Date(Date.now() - 2 * 86400000).toISOString() },
  ordens: { em_andamento: 4, vencendo: 2, atrasadas: 1 },
  vendas: { mes: agora.toISOString().slice(0, 7), quantidade: 46, total_centavos: 842050, mes_anterior_total_centavos: 751800, semanas: [164000, 258000, 336050, 84000] },
  financeiro: { receber_7_dias: { parcelas: 4, valor_centavos: 123000, atrasadas: 1 }, pagar_7_dias: { parcelas: 3, valor_centavos: 98000, atrasadas: 0 }, saldo_contas_centavos: 41200 },
  estoque: { abaixo_do_minimo: 1, itens: [{ produto: 'Linha poliéster preta', disponivel: 2, minimo: 10 }] },
  agenda_hoje: [],
  mensagens: { total: 4, conversas: [{ tipo: 'solicitacao', id: 's1', os_id: null, rotulo: 'Solicitação nº 22 · Cida Ramos', novas: 3, ultima_em: agora.toISOString() },
    { tipo: 'pedido', id: 'p1', os_id: null, rotulo: 'Pedido de hoje · Marcos Lima', novas: 1, ultima_em: agora.toISOString() }] },
});
const painelVazio = () => ({ ...painelCheio(), pedidos: { aguardando: 0, ultimos: [] }, orcamentos: { abertas: 0, mais_antiga_em: null },
  ordens: { em_andamento: 0, vencendo: 0, atrasadas: 0 }, vendas: { mes: agora.toISOString().slice(0, 7), quantidade: 0, total_centavos: 0, mes_anterior_total_centavos: 0, semanas: [0, 0, 0, 0] },
  financeiro: { receber_7_dias: { parcelas: 0, valor_centavos: 0, atrasadas: 0 }, pagar_7_dias: { parcelas: 0, valor_centavos: 0, atrasadas: 0 }, saldo_contas_centavos: 0 },
  estoque: { abaixo_do_minimo: 0, itens: [] }, mensagens: { total: 0, conversas: [] } });

async function simular(context, { permissoes = TODAS, painel = painelCheio, logado = true, empresas = true, membro = true } = {}) {
  const estado = { corpos: {}, chamadas: [] };
  await context.route('**/js/config/public-config.js', (rota) => rota.fulfill({ contentType: 'text/javascript',
    body: `export const CONFIG_PUBLICA = Object.freeze({ ambiente: 'desenvolvimento', neonAuthUrl: '${BASE}/auth', neonDataApiUrl: '${BASE}/api' });` }));
  await context.route(`**${BASE}/**`, async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(BASE, '');
    let corpo = null;
    try { corpo = req.postDataJSON(); } catch { corpo = null; }
    estado.corpos[caminho] = corpo;
    estado.chamadas.push(caminho);
    const json = (d, cab = {}) => rota.fulfill({ status: 200, contentType: 'application/json', headers: cab, body: JSON.stringify(d) });
    if (caminho === '/auth/get-session') return logado ? json({ user: { id: 'u1', name: 'Pessoa fictícia', email: 'p@autonick-teste.example', emailVerified: true } }, { 'set-auth-jwt': jwt('u1') }) : json({});
    if (caminho === '/auth/token/anonymous') return json({ token: jwt('anon'), expires_at: new Date(Date.now() + 900000).toISOString() });
    switch (caminho) {
      case '/api/perfis_identidade': return json([{ id: 'p1', tipo_conta: 'business', nome: 'Pessoa fictícia', criado_em: '2026-11-01T12:00:00Z' }]);
      case '/api/rpc/minhas_permissoes': if (!membro) return rota.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ hint: 'TENANT_FORBIDDEN', message: 'Você não tem acesso a esta empresa.' }) });
        return json({ membro_id: 'm1', perfil_id: null, papel: 'funcionario', perfil_nome: 'Atendimento', permissoes });
      case '/api/empresas': return json(empresas ? [{ id: EMP, nome_publico: 'Ateliê Ponto Firme', modalidade: 'ambos', cidade: 'Campinas', uf: 'SP', situacao_vitrine: 'publicada', dado_de_teste: true, versao: 1 }] : []);
      case '/api/rpc/painel_empresa': return json(painel());
      case '/api/categorias_plataforma': return json([{ id: 'k1', nome: 'Costura e moda', slug: 'costura-moda' }]);
      case '/api/rpc/criar_empresa': return json({ id: EMP, nome_publico: corpo?.p_dados?.nome_publico, versao: 1 });
      case '/api/rpc/sou_ck_admin': return json(true);
      case '/api/rpc/ck_listar_empresas': return json([
        { id: 'k1', nome_publico: 'Rascunho Fictício', cidade: 'Campinas', uf: 'SP', situacao_vitrine: 'rascunho', dado_de_teste: true },
        { id: 'k2', nome_publico: 'Publicada Fictícia', cidade: 'Campinas', uf: 'SP', situacao_vitrine: 'publicada', dado_de_teste: true }]);
      case '/api/rpc/ck_fila_moderacao': return json({ avaliacoes: [{ id: 'av1', empresa: 'Publicada Fictícia', impedimento: null,
        conteudo: { nota: 5, comentario: 'Ligue 11 99999-0000.', estado: 'aguardando', data: agora.toISOString(), sinaliza_contato: true, oculto: false } }], respostas: [], denuncias: [], contestacoes: [] });
      case '/api/rpc/mensagens_novas': return json({ total: 3, conversas: [{ tipo: 'solicitacao', id: 's1', os_id: null, empresa_id: EMP, rotulo: 'Solicitação nº 22', novas: 3, ultima_em: agora.toISOString() }] });
      case '/api/rpc/solicitacoes_da_empresa': return json({ contagem: { nova: 1 }, total: 1, itens: [{ id: 's1', numero: 22, servico: 'Ajuste de vestido', cliente_nome: 'Cida Ramos',
        origem: 'plataforma', estado: 'nova', estado_exibicao: 'nova', total_vigente_centavos: null, estimativa: null, criado_em: agora.toISOString(), horario: null, tem_rascunho: false, aguardando_aprovacao: false }] });
      default: return json([]);
    }
  });
  return estado;
}

test('painel real: números da empresa ativa, sem dados de exemplo, e contador no menu [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/dashboard.html?id=${EMP}`);
  const painel = page.locator('#painel');
  await expect(page.getByRole('heading', { name: 'Precisa da sua ação' })).toBeVisible();
  await expect(painel).toContainText('Pedidos aguardando aceite');
  await expect(painel).toContainText('R$ 8.420,50');
  await expect(painel).toContainText('O mais antigo há 2 dias');
  await expect(painel).toContainText('1 atrasada');
  await expect(painel).toContainText('Linha poliéster preta');
  await expect(painel).toContainText('não é extrato bancário');   // RF-140, SEC-T14: não afirma recebimento bancário
  await expect(painel).not.toContainText('null');
  await expect(painel).not.toContainText('Origem: dados fictícios');
  expect(estado.corpos['/api/rpc/painel_empresa']).toEqual({ p_empresa_id: EMP });
  await expect(page.locator('#contador-mensagens')).toContainText('4');
  await expect(page.locator('#empresa-ativa')).toContainText('Ateliê Ponto Firme');
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Painel' })).toHaveAttribute('aria-current', 'page');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('painel e menu respeitam as permissões: bloco e módulo sem permissão não aparecem [simulação]', async ({ page, context }) => {
  await simular(context, { permissoes: ['vendas.visualizar', 'vendas.criar'],
    painel: () => ({ ...painelCheio(), financeiro: null, estoque: null, orcamentos: null, ordens: null, pedidos: null, mensagens: null, agenda_hoje: null }) });
  await page.goto(`/business/dashboard.html?id=${EMP}`);
  const painel = page.locator('#painel');
  await expect(painel).toContainText('R$ 8.420,50');
  await expect(painel).not.toContainText('A receber');
  await expect(painel).not.toContainText('Estoque baixo');
  await expect(page.locator('#acoes-painel')).toContainText('Nova venda');
  await expect(page.locator('#acoes-painel')).not.toContainText('Lançar no financeiro');
  const menu = page.getByRole('navigation', { name: 'Principal' });
  await expect(menu.getByRole('link', { name: 'Vendas', exact: true })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Financeiro', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: 'Equipe', exact: true })).toHaveCount(0);
});

test('empresa sem movimento: estado vazio claro com primeiros passos, sem números de exemplo [simulação]', async ({ page, context }) => {
  await simular(context, { painel: painelVazio });
  await page.goto(`/business/dashboard.html?id=${EMP}`);
  await expect(page.getByRole('heading', { name: 'Primeiros passos' })).toBeVisible();
  await expect(page.locator('#painel')).toContainText('Ainda não há movimento nesta empresa.');
  await expect(page.getByRole('link', { name: 'Cadastrar um produto' })).toHaveAttribute('href', `/business/produtos-empresa.html?id=${EMP}`);
  await expect(page.locator('#painel')).not.toContainText('R$ 8.420,50');
});

test('painel sem empresa: orienta a escolher; com empresa ativa na sessão, abre a dela [simulação]', async ({ page, context }) => {
  await simular(context);
  await page.goto('/business/dashboard.html');
  await expect(page.locator('#painel')).toContainText('Escolha uma empresa para ver o painel.');
  await page.evaluate((id) => sessionStorage.setItem('autonick.empresaAtiva', JSON.stringify({ id, nome: 'Ateliê Ponto Firme' })), EMP);
  await page.goto('/business/dashboard.html');
  await expect(page).toHaveURL(new RegExp(`dashboard\\.html\\?id=${EMP}$`));
  await expect(page.locator('#painel')).toContainText('Pedidos aguardando aceite');
});

test('empresa ativa sem vínculo: o painel não mostra dados e não chega a pedir os indicadores (SEC-T04) [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { membro: false });
  await page.goto(`/business/dashboard.html?id=${EMP}`);
  await expect(page.getByRole('alert')).toContainText('Você não tem mais acesso a esta empresa.');
  await expect(page.locator('#painel')).not.toContainText('Pedidos aguardando aceite');
  expect(estado.chamadas).not.toContain('/api/rpc/painel_empresa');
});

test('cadastro pelo modal da Central (endereço antigo redireciona) grava pelo criar_empresa e abre o painel da nova empresa [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { painel: painelVazio });
  await page.goto('/business/onboarding.html');
  await expect(page).toHaveURL(/\/business\/minhas-empresas\.html/);
  const modal = page.getByRole('dialog', { name: 'Cadastrar nova empresa' });
  await expect(modal).toBeVisible();
  await modal.getByLabel('Nome do negócio').fill('Ateliê Ponto Firme');
  await modal.getByLabel('O que a empresa faz').selectOption('ambos');
  await modal.getByLabel('Categoria principal').selectOption({ label: 'Costura e moda' });
  await modal.getByLabel('Cidade').fill('Campinas');
  await modal.getByLabel('E-mail de contato da empresa').fill('contato@autonick-teste.example');
  await expect(modal.locator('#nova-revisao')).toContainText('Campinas (SP)');
  await modal.getByRole('button', { name: 'Cadastrar empresa' }).click();
  await expect(modal.getByRole('status')).toContainText('Empresa cadastrada');
  const c = estado.corpos['/api/rpc/criar_empresa'];
  expect(c.p_dados).toEqual({ nome_publico: 'Ateliê Ponto Firme', modalidade: 'ambos', categoria_id: 'k1', cidade: 'Campinas', uf: 'SP', email_contato: 'contato@autonick-teste.example' });
  expect(c.p_operation_key).toMatch(/^[0-9a-f-]{36}$/);
  await modal.getByRole('link', { name: 'Usar Ateliê Ponto Firme agora' }).click();
  await expect(page).toHaveURL(new RegExp(`dashboard\\.html\\?id=${EMP}`));
});

test('cadastro sem sessão pede para entrar e não abre o modal [simulação]', async ({ page, context }) => {
  await simular(context, { logado: false });
  await page.goto('/business/onboarding.html');
  await expect(page).toHaveURL(/\/business\/minhas-empresas\.html/);
  await expect(page.locator('#empresas')).toContainText(/Entr/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('lista de orçamentos marca a conversa com mensagens novas, com texto e não só cor [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/solicitacoes.html?id=${EMP}`);
  const linha = page.locator('[data-conversa="solicitacao:s1"]');
  await expect(linha).toContainText('3 mensagens novas');
  expect(estado.corpos['/api/rpc/mensagens_novas']).toEqual({ p_empresa_id: EMP });
});

test('Leitura ampliada troca a fonte, fica marcada e é lembrada neste aparelho', async ({ page }) => {
  await page.goto('/ajuda.html');
  const botao = page.locator('button[data-leitura]');
  await expect(botao).toHaveAttribute('aria-pressed', 'false');
  const antes = await page.evaluate(() => getComputedStyle(document.body).fontSize);
  await botao.click();
  await expect(botao).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-leitura', 'ampliada');
  const depois = await page.evaluate(() => getComputedStyle(document.body).fontSize);
  expect(parseFloat(depois)).toBeGreaterThan(parseFloat(antes));
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Atkinson Hyperlegible');
  await page.reload();
  await expect(page.locator('button[data-leitura]')).toHaveAttribute('aria-pressed', 'true');
  const guardado = await page.evaluate(() => ({ ...localStorage }));
  expect(guardado).toEqual({ 'autonick.preferencia.leitura': 'ampliada' });
});

test('introdução do Cliente: aparece na primeira visita, fecha e continua disponível em "Como funciona"', async ({ page }) => {
  await page.goto('/cliente/');
  await expect(page.getByRole('heading', { name: 'Como funciona' })).toBeVisible();
  await page.getByRole('button', { name: 'Entendi' }).click();
  await expect(page.locator('#como-funciona')).toBeHidden();
  await page.reload();
  await expect(page.locator('#como-funciona')).toBeHidden();
  await page.locator('#abrir-introducao').click();
  await expect(page.getByRole('heading', { name: 'Como funciona' })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['autonick.cliente.introducaoVista']);
});

test('CK (Noite Elétrica): selos legíveis e sem rolagem lateral em 360 px com fila de moderação e vitrine em rascunho [simulação]', async ({ page, context }) => {
  // Achado da regressão real do M12 no navegador: selo neutro com fundo claro no tema escuro (contraste 1,89) e selo longo passando da tela.
  await simular(context);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/ck-admin/');
  await expect(page.locator('[data-moderar-avaliacao="av1"]')).toContainText('Comentário com telefone, e-mail ou endereço');
  await expect(page.locator('main')).toContainText('Rascunho Fictício');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
});
