/** Sem rolagem horizontal nas larguras de validação (GDC-001 §H, UX-001 §4, FCT-089). */
import { test, expect } from '@playwright/test';
import { PAGINAS, escolherEmpresa } from './paginas.mjs';

const TAMANHOS = [[320, 640], [375, 812], [768, 1024], [1440, 900]];

for (const [largura, altura] of TAMANHOS) {
  test(`sem rolagem horizontal em ${largura}x${altura}`, async ({ page }, info) => {
    test.setTimeout(180_000);   // percorre todas as páginas numa só execução
    await page.setViewportSize({ width: largura, height: altura });
    await escolherEmpresa(page);
    for (const caminho of PAGINAS) {
      await page.goto(caminho);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(300);
      const excesso = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(excesso, `${caminho} em ${largura}px`).toBeLessThanOrEqual(0);
    }
    await page.goto('/cliente/');
    await page.waitForLoadState('networkidle');
    await info.attach(`cliente-${largura}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}

test('alvos de toque têm pelo menos 44 px de altura em 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await escolherEmpresa(page);
  for (const caminho of ['/', '/cliente/', '/business/dashboard.html']) {
    await page.goto(caminho);
    await page.waitForLoadState('networkidle');
    const pequenos = await page.$$eval('.botao, .navegacao a, .campo input, .campo select', (els) =>
      els.filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 43.5).map((e) => e.outerHTML.slice(0, 80)));
    expect(pequenos, caminho).toEqual([]);
  }
});
