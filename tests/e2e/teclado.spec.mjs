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

test('cadastro em etapas: erros explicados e foco no primeiro campo inválido [simulação]', async ({ page }) => {
  await simularLogado(page, { '/api/categorias_plataforma': [{ id: 'k1', nome: 'Costura e moda', slug: 'costura-moda' }] });
  await page.goto('/business/onboarding.html');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('alert')).toContainText('Corrija os campos abaixo');
  await expect(page.locator('#nome')).toBeFocused();
  await expect(page.locator('#nome')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#nome').fill('Negócio Fictício');
  await page.locator('#categoria').selectOption('k1');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Como atende' })).toBeFocused();
  await page.getByLabel('Os dois').check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.locator('#cidade').fill('São Paulo');
  await page.locator('#email').fill('email-invalido');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('#erro-email')).toContainText('e-mail válido');
  await page.locator('#email').fill('teste@negocio.example');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('#revisao')).toContainText('Negócio Fictício');
  await expect(page.getByRole('button', { name: 'Cadastrar empresa' })).toBeVisible();
});

