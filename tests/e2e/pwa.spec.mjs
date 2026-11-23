/** PWA: manifesto, service worker, cache somente estático e aviso offline (RF-191, RF-192, FCT-092). */
import { test, expect } from '@playwright/test';

test('manifesto válido com ícones existentes', async ({ request }) => {
  const r = await request.get('/manifest.webmanifest');
  expect(r.status()).toBe(200);
  const m = await r.json();
  expect(m).toMatchObject({ name: 'AutoniCK', lang: 'pt-BR', start_url: '/', scope: '/', display: 'standalone' });
  const tamanhos = m.icons.map((i) => i.sizes);
  expect(tamanhos).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icone of m.icons) expect((await request.get(icone.src)).status()).toBe(200);
});

test('service worker guarda só arquivos estáticos e mostra aviso sem conexão', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.goto('/cliente/');
  await page.waitForLoadState('networkidle');
  const guardados = await page.evaluate(async () => {
    const urls = [];
    for (const nome of await caches.keys()) {
      const cache = await caches.open(nome);
      for (const pedido of await cache.keys()) urls.push(new URL(pedido.url).pathname);
    }
    return urls;
  });
  expect(guardados.length).toBeGreaterThan(5);
  for (const url of guardados) {
    expect(url, url).toMatch(/^\/(offline\.html|ajuda\.html|manifest\.webmanifest|css\/.+\.css|js\/.+\.js|assets\/.+\.(woff2|png|svg|webp))$/);
  }
  expect(guardados).not.toContain('/cliente/');

  await context.setOffline(true);
  await page.goto('/business/dashboard.html').catch(() => {});
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sem conexão com a internet');
  await expect(page.locator('main')).toContainText('Nenhuma operação foi feita');
  await context.setOffline(false);
});
