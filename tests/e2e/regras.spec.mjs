/** Regras de negócio demonstradas na interface (não substituem testes de banco). */
import { test, expect } from '@playwright/test';

test('busca e vitrine do Cliente sem banco configurado avisam e não mostram dados de demonstração local (M10)', async ({ page }) => {
  await page.goto('/cliente/');
  await expect(page.locator('#resultados')).toContainText('ainda não está disponível nesta versão');
  await expect(page.locator('#form-busca')).toBeHidden();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await page.goto('/cliente/empresa.html?e=00000000-0000-4000-8000-000000000000');
  await expect(page.locator('#vitrine')).toContainText('ainda não está disponível nesta versão');
});

test('endereços antigos do M01 levam à tela real, sem dados de exemplo (M13b)', async ({ page }) => {
  const ID = '00000000-0000-4000-8000-000000000000';
  await page.goto(`/business/produtos.html?id=${ID}`);
  await expect(page).toHaveURL(`/business/produtos-empresa.html?id=${ID}`);
  await page.goto(`/business/estoque.html?id=${ID}`);
  await expect(page).toHaveURL(`/business/estoque-empresa.html?id=${ID}`);
  await page.goto('/business/produtos.html');
  await expect(page).toHaveURL('/business/minhas-empresas.html');
  await page.goto('/business/empresas.html');
  await expect(page).toHaveURL('/business/minhas-empresas.html');
  for (const nome of ['Conserta Já Assistência', 'Ateliê Linha Fina', 'Zíper metálico']) await expect(page.locator('main')).not.toContainText(nome);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('sem empresa escolhida, o painel orienta a escolher e não mostra números (M13b)', async ({ page }) => {
  await page.goto('/business/dashboard.html');
  await expect(page.locator('#painel')).toContainText('Escolha uma empresa para ver o painel.');
  await expect(page.locator('#painel')).not.toContainText('R$');
});

test('área CK Admin não exibe dados sem serviço e sessão (FCT-002)', async ({ page }) => {
  await page.goto('/ck-admin/');
  const main = page.locator('main');
  await expect(main).toContainText('Área exclusiva da equipe da CK Group');
  await expect(main).toContainText('ainda não está disponível nesta versão');
  await expect(main.locator('#painel li')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
});
