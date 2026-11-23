import { test, expect } from '@playwright/test';
import { PAGINAS, escolherEmpresa } from './paginas.mjs';

for (const caminho of PAGINAS) {
  test(`estrutura básica e sem erros de console: ${caminho}`, async ({ page }) => {
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
    await escolherEmpresa(page);
    const resposta = await page.goto(caminho);
    expect(resposta.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page).toHaveTitle(/AutoniCK/);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main#conteudo')).toHaveCount(1);
    await expect(page.locator('a.pular-conteudo')).toHaveAttribute('href', '#conteudo');
    await expect(page.locator('.faixa-demo').first()).toContainText(/DEMONSTRAÇÃO|VERSÃO DE DESENVOLVIMENTO/);
    await expect(page.locator('#cabecalho nav[aria-label="Principal"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(erros).toEqual([]);
  });
}

test('todos os links internos respondem 200', async ({ page, request }) => {
  test.setTimeout(180_000);   // percorre todas as páginas; a barra lateral do Business (M13b) traz mais links por tela
  await escolherEmpresa(page);
  const vistos = new Set();
  for (const caminho of PAGINAS) {
    await page.goto(caminho);
    await page.waitForLoadState('networkidle');
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
    for (const href of hrefs) {
      if (!href.startsWith('/') || vistos.has(href)) continue;
      vistos.add(href);
      const r = await request.get(href.split('#')[0]);
      expect(r.status(), href).toBe(200);
    }
  }
  expect(vistos.size).toBeGreaterThan(8);
});
