/**
 * S-01 (20/11/2026): formulários de entrada, cadastro e cadastro da empresa nascem bloqueados no HTML
 * (<form method="post"> + <fieldset data-protegido disabled> + aviso) e só são liberados pelo módulo da página depois de
 * instalar o tratamento do envio e confirmar que o acesso está pronto.
 *
 * Regressão do achado: antes da inicialização (script ATRASADO de propósito, sem esperar o evento load), com o script
 * que FALHA e com o JavaScript DESATIVADO, nem clique nem Enter enviam nada; e-mail e senha não aparecem em nenhuma URL
 * de navegação ou de requisição, nem chegam ao endereço da página estática. Depois da inicialização normal, entrar e
 * criar conta continuam funcionando. Login SIMULADO (contrato do Neon Auth); credenciais fictícias, nunca impressas.
 */
import { test, expect } from '@playwright/test';
import { simularNeon } from './simulacao-neon.mjs';

const EMAIL = 's01.ficticio@autonick-teste.example';
const SENHA = 'Ficticia-S01-trava-9137';
const SEGREDOS = [EMAIL, encodeURIComponent(EMAIL), SENHA, encodeURIComponent(SENHA)];
const temSegredo = (texto) => SEGREDOS.some((s) => (texto ?? '').includes(s));

/** Registra toda URL de requisição e de navegação, e todo envio de formulário para a própria página estática. */
function vigiar(page) {
  const v = { urls: [], navegacoes: [], postsParaPagina: [] };
  page.on('request', (r) => {
    v.urls.push(r.url());
    const caminho = new URL(r.url()).pathname;
    if (r.method() === 'POST' && !caminho.startsWith('/__neon_simulado/')) v.postsParaPagina.push({ caminho, corpoComSegredo: temSegredo(r.postData()) });
  });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) v.navegacoes.push(f.url()); });
  return v;
}
function semVazamento(v) {
  // Sem imprimir os valores: só quantas URLs teriam o segredo.
  expect(v.urls.filter(temSegredo).length, 'URLs de requisição com e-mail ou senha').toBe(0);
  expect(v.navegacoes.filter(temSegredo).length, 'URLs de navegação com e-mail ou senha').toBe(0);
  expect(v.postsParaPagina, 'envios para a página estática').toEqual([]);
}

/** Segura o módulo da página até `soltar()`; devolve a função que solta. */
async function atrasarScript(page, padrao) {
  let soltar;
  const liberado = new Promise((r) => { soltar = r; });
  await page.route(padrao, async (rota) => { await liberado; await rota.continue(); });
  return () => soltar();
}

/** Tenta enviar com o formulário ainda bloqueado: valores postos como um preenchimento automático, clique e Enter. */
async function tentarEnviar(page, formId, campos) {
  const form = page.locator(`#${formId}`);
  await expect(form.locator('fieldset[data-protegido]')).toHaveAttribute('disabled', '');
  await expect(form.locator('[data-aguardando]')).toBeVisible();
  for (const id of Object.keys(campos)) await expect(page.locator(`#${id}`)).toBeDisabled();
  const botao = form.locator('button[type="submit"]');
  await expect(botao).toBeDisabled();
  // Um preenchimento automático pode pôr valores mesmo em campos desativados.
  await page.evaluate((c) => { for (const [id, valor] of Object.entries(c)) document.getElementById(id).value = valor; }, campos);
  const antes = page.url();
  await botao.click({ force: true });                         // clique
  const ultimo = Object.keys(campos).at(-1);
  await page.locator(`#${ultimo}`).focus().catch(() => {});  // campo desativado não recebe foco...
  expect(await page.evaluate((id) => document.activeElement?.id === id, ultimo)).toBe(false);
  await page.keyboard.press('Enter');                         // ...e o Enter não envia
  await page.waitForTimeout(400);
  expect(page.url()).toBe(antes);
}

for (const area of ['cliente', 'business']) {
  test(`${area}: antes da inicialização (script atrasado), clique e Enter não enviam nada; depois, entrar funciona [simulação]`, async ({ page, context }) => {
    await simularNeon(context, {
      usuarios: [{ id: 'u1', name: 'Pessoa Fictícia', email: EMAIL, senha: SENHA }],
      perfis: [{ id: 'p1', auth_user_id: 'u1', tipo_conta: area, nome: 'Pessoa Fictícia', criado_em: '2026-11-20T12:00:00Z' }],
    });
    const soltar = await atrasarScript(page, '**/js/features/conta/entrar.js');
    const v = vigiar(page);
    await page.goto(`/${area}/entrar.html`, { waitUntil: 'commit' });
    await page.locator('#form-entrar').waitFor({ state: 'attached' });
    await tentarEnviar(page, 'form-entrar', { 'entrar-email': EMAIL, 'entrar-senha': SENHA });
    await tentarEnviar(page, 'form-criar', { 'criar-nome': 'Pessoa Fictícia', 'criar-email': EMAIL, 'criar-senha': SENHA });
    semVazamento(v);

    soltar();
    await expect(page.locator('#form-entrar')).toHaveAttribute('data-pronto', 'sim');
    await expect(page.locator('#form-entrar [data-aguardando]')).toHaveCount(0);
    await page.locator('#entrar-email').fill(EMAIL);
    await page.locator('#entrar-senha').fill(SENHA);
    if (area === 'cliente') await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    else await page.locator('#entrar-senha').press('Enter');   // Enter também entra quando o formulário está pronto
    await expect(page).toHaveURL(area === 'cliente' ? /\/cliente\/$/ : /\/business\/conta\.html$/);
    semVazamento(v);
  });
}

test('JavaScript desativado: formulários bloqueados e avisados; clique e Enter não enviam nada', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const v = vigiar(page);
  for (const area of ['cliente', 'business']) {
    await page.goto(`/${area}/entrar.html`);
    await expect(page.locator('#form-entrar [data-aguardando]')).toContainText('Formulário indisponível');
    const botao = page.locator('#form-entrar button[type="submit"]');
    await expect(page.locator('#entrar-email')).toBeDisabled();
    await expect(page.locator('#entrar-senha')).toBeDisabled();
    await expect(botao).toBeDisabled();
    await expect(page.locator('#criar-senha')).toBeDisabled();
    await expect(page.locator('#senha-email')).toBeDisabled();
    const antes = page.url();
    await botao.click({ force: true });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    expect(page.url()).toBe(antes);
  }
  semVazamento(v);
  await context.close();
});

test('script que falha ao carregar: o formulário continua bloqueado e avisa; nada é enviado', async ({ page }) => {
  await page.route('**/js/features/conta/entrar.js', (rota) => rota.abort());
  const v = vigiar(page);
  await page.goto('/cliente/entrar.html');
  await expect(page.locator('#form-entrar [data-aguardando]')).toBeVisible();
  await expect(page.locator('#entrar-senha')).toBeDisabled();
  await page.locator('#form-entrar button[type="submit"]').click({ force: true });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/cliente\/entrar\.html$/);
  semVazamento(v);
});

test('cadastro com a inicialização normal: cria a conta Cliente, sem e-mail nem senha em URLs [simulação]', async ({ page, context }) => {
  await simularNeon(context);
  const v = vigiar(page);
  await page.goto('/cliente/entrar.html');
  await page.locator('#criar-nome').fill('Pessoa Fictícia');
  await page.locator('#criar-email').fill(EMAIL);
  await page.locator('#criar-senha').fill(SENHA);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/cliente\/$/);
  semVazamento(v);
});

test('endereço antigo do cadastro leva ao modal da Central de empresas; sem sessão, nada é aberto nem enviado [simulação]', async ({ page, context }) => {
  await simularNeon(context);
  const v = vigiar(page);
  await page.goto('/business/onboarding.html');
  await expect(page).toHaveURL('/business/minhas-empresas.html?cadastrar=1');
  await expect(page.locator('#empresas')).toContainText(/Entr/);
  await expect(page.locator('#form-nova-empresa')).toHaveCount(0);
  semVazamento(v);
});
