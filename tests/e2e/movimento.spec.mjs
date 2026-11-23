/** Preferência de movimento reduzido (RNF-030). */
import { test, expect } from '@playwright/test';

test('animações e transições são desligadas com movimento reduzido', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // M13b: as telas do M01 saíram; o painel real fica carregando enquanto o banco simulado não responde.
  await page.route('**/js/config/public-config.js', (rota) => rota.fulfill({ contentType: 'text/javascript',
    body: "export const CONFIG_PUBLICA = Object.freeze({ ambiente: 'desenvolvimento', neonAuthUrl: '/__neon_simulado/auth', neonDataApiUrl: '/__neon_simulado/api' });" }));
  await page.route('**/__neon_simulado/**', () => { /* sem resposta: a tela continua carregando */ });
  await page.goto('/business/dashboard.html?id=00000000-0000-4000-8000-000000000000');
  const linha = page.locator('.esqueleto__linha').first();
  await expect(linha).toBeVisible();
  const duracao = await linha.evaluate((e) => parseFloat(getComputedStyle(e).animationDuration));
  expect(duracao).toBeLessThan(0.05);
  const transicao = await page.evaluate(() => { const b = Object.assign(document.createElement('button'), { className: 'botao', textContent: 'x' }); document.body.append(b); const t = parseFloat(getComputedStyle(b).transitionDuration); b.remove(); return t; });
  expect(transicao).toBeLessThan(0.05);
});
