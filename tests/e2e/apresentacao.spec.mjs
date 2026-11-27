/**
 * Página de apresentação com o sino HQ 3D (cena "Quem tocou?" em laço, sem controle manual de pausa).
 * O Chromium de teste desenha o WebGL por software, então os tempos de espera são folgados.
 */
import { test, expect } from '@playwright/test';

const SINO = '[data-heroi-sino]';
const DESTINOS = [
  ['Criar conta de cliente', '/cliente/entrar.html#titulo-criar', 'Criar conta Cliente'],
  ['Entrar como cliente', '/cliente/entrar.html', 'Entrar no AutoniCK'],
  ['Criar conta Business', '/business/entrar.html#titulo-criar', 'Criar conta Business'],
  ['Entrar no Business', '/business/entrar.html', 'Entrar no AutoniCK Business'],
];
const pronto = (page) => expect(page.locator(SINO)).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
const tempo = (page) => page.locator(SINO).getAttribute('data-t').then(Number);

test.describe('sem JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('imagem estática e os quatro botões funcionam sem JavaScript', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.heroi-sino__poster')).toBeVisible();
    for (const [nome, destino, titulo] of DESTINOS) {
      await page.goto('/');
      const link = page.getByRole('link', { name: nome, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', destino);
      await link.click();
      await expect(page).toHaveURL(new RegExp(destino.replace(/[.#]/g, '\\$&') + '$'));
      await expect(page.getByRole('heading', { name: titulo })).toBeVisible();
    }
  });
});

test('estrutura: texto e ações de um lado, sino do outro; espaço do sino reservado desde o início', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');
  const caixaAntes = await page.locator('.heroi-sino__palco').boundingBox();
  const texto = await page.locator('.apresentacao__texto').boundingBox();
  expect(caixaAntes.x).toBeGreaterThan(texto.x + texto.width - 1);
  await pronto(page);
  const caixaDepois = await page.locator('.heroi-sino__palco').boundingBox();
  expect(caixaDepois).toEqual(caixaAntes);
  await expect(page.locator('.heroi-sino__poster')).toHaveCSS('opacity', '0');
  await expect(page.locator('.heroi-sino__cena')).toHaveCSS('opacity', '1');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bem-vindo ao AutoniCK');
});

test('laço: dois ciclos completos, sem parar, sem sumir e sem erro no console', async ({ page }) => {
  test.setTimeout(120_000);
  const erros = [];
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/');
  await pronto(page);
  await expect(page.locator(SINO)).toHaveAttribute('data-rodando', 'sim');
  await expect(page.locator(SINO)).toHaveAttribute('data-ciclos', '2', { timeout: 90_000 });
  await expect(page.locator(SINO)).toHaveAttribute('data-estado', 'pronto');
  await expect(page.locator('.heroi-sino__cena')).toBeVisible();
  expect(erros).toEqual([]);
});

const CONTROLE = '.heroi-sino__controle';
for (const [nome, tamanho] of [
  ['computador', { width: 1280, height: 860 }],
  ['celular', { width: 390, height: 844 }],
]) {
  test(`laço sem botão de pausa na apresentação (${nome})`, async ({ page }) => {
    await page.setViewportSize(tamanho);
    await page.goto('/');
    await pronto(page);
    const sino = page.locator(SINO);
    await expect(sino).toHaveAttribute('data-rodando', 'sim');
    await expect(sino.locator(CONTROLE)).toHaveCount(0);
    await expect(sino.getByRole('button')).toHaveCount(0);
    await expect(sino.locator('.heroi-sino__palco')).not.toHaveAttribute('tabindex');
    const atual = await tempo(page);
    await expect.poll(() => tempo(page), { timeout: 10_000 }).toBeGreaterThan(atual);
    for (const [nome] of DESTINOS) {
      await expect(page.getByRole('link', { name: nome, exact: true })).toBeVisible();
    }
  });
}

test('para fora da tela e com a aba oculta; volta do mesmo ponto', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 420 }); // janela baixa: rolando até o fim, o sino sai inteiro da tela
  await page.goto('/');
  await pronto(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await page.locator('.heroi-sino__palco').evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThan(0);
  await expect(page.locator(SINO)).toHaveAttribute('data-rodando', 'nao');
  const fora = await tempo(page);
  await page.waitForTimeout(1000);
  expect(await tempo(page)).toBe(fora);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator(SINO)).toHaveAttribute('data-rodando', 'sim');
  await expect.poll(() => tempo(page), { timeout: 10_000 }).toBeGreaterThan(fora);
  // aba oculta
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator(SINO)).toHaveAttribute('data-rodando', 'nao');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator(SINO)).toHaveAttribute('data-rodando', 'sim');
});

test('movimento reduzido: começa estático, sem baixar o 3D; toca uma vez sob pedido', async ({ browser }) => {
  test.setTimeout(90_000);
  const contexto = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await contexto.newPage();
  const pedidos = [];
  page.on('request', (r) => pedidos.push(new URL(r.url()).pathname));
  await page.goto('/');
  await page.waitForTimeout(1500);
  await expect(page.locator(SINO)).toHaveAttribute('data-estado', 'estatico');
  await expect(page.locator('.heroi-sino__poster')).toBeVisible();
  await expect(page.locator(CONTROLE)).toHaveCount(0);
  expect(pedidos.filter((p) => p.endsWith('.glb') || p.includes('/vendor/three/'))).toEqual([]);
  // o próprio sino toca a cena uma vez (teclado: Enter com ele em foco)
  const sino = page.getByRole('button', { name: 'Ver a animação do Bong' });
  await sino.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(SINO)).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await expect(page.locator(SINO)).toHaveAttribute('data-rodando', 'sim');
  await expect(page.locator(SINO)).toHaveAttribute('data-rodando', 'nao', { timeout: 40_000 });
  expect(Number(await page.locator(SINO).getAttribute('data-ciclos'))).toBe(0); // parou na pose final, sem laço
  await expect(page.locator(CONTROLE)).toHaveCount(0);
  await contexto.close();
});

test('sem o GLB: fica a imagem estática, sem "Carregando", e os botões seguem funcionando', async ({ page }) => {
  await page.route('**/assets/sino/*.glb', (rota) => rota.fulfill({ status: 404, body: 'não encontrado' }));
  await page.goto('/');
  await expect(page.locator(SINO)).toHaveAttribute('data-estado', 'falhou', { timeout: 30_000 });
  await expect(page.locator(SINO)).toHaveAttribute('data-motivo', /404/);
  await expect(page.locator('.heroi-sino__poster')).toBeVisible();
  await expect(page.locator('.heroi-sino__poster')).toHaveCSS('opacity', '1');
  await expect(page.getByText(/carregando/i)).toHaveCount(0);
  await expect(page.locator(CONTROLE)).toHaveCount(0);
  await page.getByRole('link', { name: 'Entrar como cliente' }).click();
  await expect(page).toHaveURL(/\/cliente\/entrar\.html$/);
});

test('sem o Three.js: fica a imagem estática', async ({ page }) => {
  await page.route('**/vendor/three/**', (rota) => rota.abort());
  await page.goto('/');
  await expect(page.locator(SINO)).toHaveAttribute('data-estado', 'falhou', { timeout: 30_000 });
  await expect(page.locator('.heroi-sino__poster')).toBeVisible();
  await expect(page.locator(CONTROLE)).toHaveCount(0);
});

test('ao sair da página, o laço para e a cena é liberada', async ({ page }) => {
  await page.goto('/');
  await pronto(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect(page.locator(SINO)).toHaveAttribute('data-estado', 'encerrado');
  await expect(page.locator(SINO)).toHaveAttribute('data-rodando', 'nao');
  await expect(page.locator('.heroi-sino__cena')).toHaveCount(0);
  await expect(page.locator('.heroi-sino__poster')).toBeVisible();
});

test('celular: título e sino lado a lado; as duas entradas cabem na primeira tela', async ({ browser }) => {
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await contexto.newPage();
  await page.goto('/');
  await pronto(page);
  for (const [nome] of DESTINOS) {
    const caixa = await page.getByRole('link', { name: nome, exact: true }).boundingBox();
    expect(caixa.y + caixa.height, nome).toBeLessThanOrEqual(844);
    expect(caixa.height).toBeGreaterThanOrEqual(44);
  }
  const titulo = await page.getByRole('heading', { level: 1 }).boundingBox();
  const sino = await page.locator('.heroi-sino__palco').boundingBox();
  expect(sino.x).toBeGreaterThan(titulo.x + titulo.width - 1);
  await contexto.close();
});

test('sem WebGL: imagem estática e botões funcionando', async ({ page }) => {
  // simula um navegador sem WebGL: nenhum contexto 3D é entregue à página
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (tipo, ...resto) { return /webgl/i.test(tipo) ? null : original.call(this, tipo, ...resto); };
  });
  await page.goto('/');
  const sino = page.locator(SINO);
  await expect(sino).toHaveAttribute('data-estado', 'falhou', { timeout: 30_000 });
  await expect(sino).toHaveAttribute('data-motivo', /WebGL/);
  await expect(page.locator(CONTROLE)).toHaveCount(0);
  await expect(page.locator('.heroi-sino__poster')).toBeVisible();
  await page.getByRole('link', { name: 'Criar conta Business' }).click();
  await expect(page).toHaveURL(/\/business\/entrar\.html#titulo-criar$/);
});
