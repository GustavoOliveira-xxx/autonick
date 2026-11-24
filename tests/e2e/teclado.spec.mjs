/** Uso só por teclado, foco visível e diálogo acessível (RNF-027, FCT-090). */
import { test, expect } from '@playwright/test';

test('link para pular navegação é o primeiro foco e leva ao conteúdo', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const pular = page.locator('a.pular-conteudo');
  await expect(pular).toBeFocused();
  await expect(pular).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#conteudo')).toBeFocused();
});

test('foco visível tem contorno', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const estilo = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return { estilo: s.outlineStyle, largura: parseFloat(s.outlineWidth) };
  });
  expect(estilo.estilo).not.toBe('none');
  expect(estilo.largura).toBeGreaterThanOrEqual(2);
});

const BASE = '/__neon_simulado';
const jwt = (sub) => { const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 900 })}.x`; };
async function simularLogado(page, respostas) {
  await page.route('**/js/config/public-config.js', (rota) => rota.fulfill({ contentType: 'text/javascript',
    body: `export const CONFIG_PUBLICA = Object.freeze({ ambiente: 'desenvolvimento', neonAuthUrl: '${BASE}/auth', neonDataApiUrl: '${BASE}/api' });` }));
  await page.route(`**${BASE}/**`, (rota) => {
    const caminho = new URL(rota.request().url()).pathname.replace(BASE, '');
    const json = (d, cab = {}) => rota.fulfill({ status: 200, contentType: 'application/json', headers: cab, body: JSON.stringify(d) });
    if (caminho === '/auth/get-session') return json({ user: { id: 'u1', name: 'Pessoa fictícia', email: 'p@autonick-teste.example', emailVerified: true } }, { 'set-auth-jwt': jwt('u1') });
    if (caminho === '/api/perfis_identidade') return json([{ id: 'p1', tipo_conta: 'business', nome: 'Pessoa fictícia', criado_em: '2026-11-01T12:00:00Z' }]);
    return json(respostas[caminho] ?? []);
  });
}

test('diálogo prende o foco, fecha com Esc e devolve o foco ao botão [simulação]', async ({ page }) => {
  // M13b: o diálogo do painel do M01 saiu; o mesmo componente confirma a recusa de convite.
  await simularLogado(page, { '/api/rpc/meus_convites': [{ convite_id: 'cv1', empresa_id: 'e1', empresa_nome: 'Mercado Fictício', perfil_nome: 'Estoque', expira_em: '2026-12-08T12:00:00Z' }] });
  await page.goto('/business/minhas-empresas.html');
  const botao = page.getByRole('button', { name: 'Recusar', exact: true });
  await botao.focus();
  await page.keyboard.press('Enter');
  const dialogo = page.getByRole('dialog', { name: 'Recusar convite?' });
  await expect(dialogo).toBeVisible();
  await page.keyboard.press('Tab');
  const dentro = await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')));
  expect(dentro).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialogo).toHaveCount(0);
  await expect(botao).toBeFocused();
});

test('cadastro de empresa no modal: erro explicado, foco no campo inválido e proteção contra perda de dados [simulação]', async ({ page }) => {
  await simularLogado(page, { '/api/categorias_plataforma': [{ id: 'k1', nome: 'Costura e moda', slug: 'costura-moda' }] });
  await page.goto('/business/minhas-empresas.html?cadastrar=1');
  const modal = page.getByRole('dialog', { name: 'Cadastrar nova empresa' });
  await modal.getByRole('button', { name: 'Cadastrar empresa' }).click();
  await expect(page.locator('#nova-nome')).toBeFocused();
  await expect(page.locator('#nova-nome')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#nova-nome-erro')).toHaveText('Preencha este campo.');
  await page.locator('#nova-nome').fill('Negócio Fictício');
  await page.locator('#nova-modalidade').selectOption('ambos');
  await page.locator('#nova-categoria').selectOption('k1');
  await page.locator('#nova-cidade').fill('São Paulo');
  await page.locator('#nova-email').fill('email-invalido');
  await modal.getByRole('button', { name: 'Cadastrar empresa' }).click();
  await expect(page.locator('#nova-email-erro')).toContainText('Confira o e-mail');
  await expect(page.locator('#nova-email')).toBeFocused();
  await expect(modal.locator('#nova-revisao')).toContainText('Negócio Fictício');
  await page.keyboard.press('Escape');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('alert').filter({ hasText: 'Há alterações não salvas' })).toBeVisible();
  await modal.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(page.locator('#nova-email')).toHaveValue('email-invalido');
});

