import { defineConfig, devices } from '@playwright/test';

const PORTA = Number(process.env.PORTA ?? 4173);

// Faz a emulação offline e as rotas do Playwright valerem também para as
// requisições feitas pelo service worker (recurso experimental do Chromium),
// necessário para testar o aviso sem conexão (FCT-092).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORTA}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  // WebKit do Playwright só quando pedido (WEBKIT=1) e instalado; não substitui o Safari real do iPhone.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.WEBKIT ? [
      { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: /pwa-m13|pwa\.spec/ },
      { name: 'webkit-iphone', use: { ...devices['iPhone 13'] }, testMatch: /responsividade|acessibilidade/ },
    ] : []),
  ],
  webServer: {
    command: 'node scripts/servidor-local.mjs',
    url: `http://127.0.0.1:${PORTA}/`,
    reuseExistingServer: !process.env.CI,
    env: { PORTA: String(PORTA) },
  },
});
