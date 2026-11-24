/**
 * M13 (D13-02 a D13-06): instalação, atualização, offline e mensagens de conexão, no Chromium do Playwright.
 * Não substitui o Safari real nem a instalação em aparelhos (validação manual em aparelhos reais).
 */
import { test, expect } from '@playwright/test';
import { simularNeon } from './simulacao-neon.mjs';
import AxeBuilder from '@axe-core/playwright';

const BASE = '/__neon_simulado';
const AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const S1 = 'e1300000-0000-4000-8000-000000000001';
const EMP = 'a1300000-0000-4000-8000-000000000001';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}
async function simular(context, { rpc = {}, cair = () => false } = {}) {
  const estado = { chamadas: [], corpos: {} };
  await context.route('**/js/config/public-config.js', (rota) => rota.fulfill({ contentType: 'text/javascript',
    body: `export const CONFIG_PUBLICA = Object.freeze({ ambiente: 'teste', neonAuthUrl: '${BASE}/auth', neonDataApiUrl: '${BASE}/api' });` }));
  await context.route(`**${BASE}/**`, async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(BASE, '');
    const corpo = req.postData() ? JSON.parse(req.postData()) : null;
    estado.chamadas.push({ caminho, metodo: req.method() });
    estado.corpos[caminho] = corpo;
    if (cair(caminho, corpo)) return rota.abort('connectionreset');
    const json = (status, d, cab = {}) => rota.fulfill({ status, contentType: 'application/json', headers: cab, body: JSON.stringify(d) });
    if (caminho === '/auth/get-session') return json(200, { user: { id: 'u1', name: 'Cida', email: 'cida@autonick-teste.example', emailVerified: true } }, { 'set-auth-jwt': jwt('u1') });
    const nome = caminho.replace('/api/rpc/', '');
    if (caminho.startsWith('/api/rpc/') && rpc[nome] !== undefined) return json(200, typeof rpc[nome] === 'function' ? rpc[nome](corpo) : rpc[nome]);
    if (caminho === '/api/perfis_identidade') return json(200, [{ id: 'p1', tipo_conta: 'cliente', nome: 'Cida', criado_em: '2026-11-01T12:00:00Z' }]);
    return json(caminho.startsWith('/api/rpc/') ? 404 : 200, caminho.startsWith('/api/rpc/') ? {} : []);
  });
  return estado;
}
async function comServiceWorker(page) {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}
const axe = async (page) => expect((await new AxeBuilder({ page }).withTags(AXE).analyze()).violations).toEqual([]);
const convite = () => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = async () => { window.__pediuInstalar = (window.__pediuInstalar ?? 0) + 1; };
  e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  window.dispatchEvent(e);
};

test('instalável no Chromium: sem erros de instalabilidade e manifesto com capturas de tela', async ({ page, request }) => {
  await comServiceWorker(page);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
  const { errors } = await cdp.send('Page.getAppManifest');
  expect(errors).toEqual([]);
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m.screenshots.map((c) => c.form_factor).sort()).toEqual(['narrow', 'wide']);
  for (const c of m.screenshots) expect((await request.get(c.src)).status()).toBe(200);
});

test('Ajuda: botão "Instalar o AutoniCK" quando o navegador oferece; sem convite, orientação do computador; versão visível', async ({ page }) => {
  await page.goto('/ajuda.html');
  await expect(page.locator('#instalacao-corpo')).toHaveAttribute('data-orientacao', 'computador');
  await expect(page.locator('#instalacao-orientacao')).toContainText('Chrome ou o Edge');
  await expect(page.getByRole('button', { name: 'Instalar o AutoniCK' })).toHaveCount(0);
  await expect(page.locator('#versao-app')).toHaveText('Versão 0.15.0 (desenvolvimento).');
  await page.evaluate(convite);
  const botao = page.getByRole('button', { name: 'Instalar o AutoniCK' });
  await expect(botao).toBeVisible();
  await botao.click();
  await expect(page.locator('#instalacao-resultado')).toContainText('O navegador está instalando o AutoniCK');
  expect(await page.evaluate(() => window.__pediuInstalar)).toBe(1);
  await expect(botao).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.locator('#instalacao-corpo')).toHaveAttribute('data-orientacao', 'instalado');
  await axe(page);
});

test('aberto como app instalado: convite escondido', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q === '(display-mode: standalone)' ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : original(q));
  });
  await page.goto('/ajuda.html');
  await page.evaluate(convite);
  await expect(page.locator('#instalacao-corpo')).toHaveAttribute('data-orientacao', 'instalado');
  await expect(page.getByRole('button', { name: 'Instalar o AutoniCK' })).toHaveCount(0);
});

test.describe('iPhone (agente do Safari)', () => {
  test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });
  test('Ajuda mostra os passos do Safari e nenhum botão de instalar', async ({ page }) => {
    await page.goto('/ajuda.html');
    await expect(page.locator('#passos-iphone li')).toHaveCount(3);
    await expect(page.locator('#passos-iphone')).toContainText('Adicionar à Tela de Início');
    await expect(page.getByRole('button', { name: 'Instalar o AutoniCK' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test('Minha conta também traz a orientação de instalação', async ({ page, context }) => {
  await simular(context);
  await page.goto('/cliente/conta.html');
  await expect(page.locator('#instalacao-conta')).toContainText('Instalar o aplicativo');
  await page.evaluate(convite);
  await expect(page.locator('#instalacao-conta').getByRole('button', { name: 'Instalar o AutoniCK' })).toBeVisible();
});

test('sem conexão: só a página offline e a Ajuda abrem; nenhuma página com login vem do cache', async ({ page, context }) => {
  await comServiceWorker(page);
  await page.goto('/ajuda.html');
  await page.waitForLoadState('networkidle');
  // Queda de rede para as páginas: o modo offline do Playwright não bloqueia todas as requisições feitas pelo service
  // worker, então as páginas são derrubadas pela rota (a lógica testada é a do service worker).
  await context.route((url) => url.pathname.endsWith('/') || url.pathname.endsWith('.html'), (rota) => rota.abort('internetdisconnected'));
  await page.goto('/ajuda.html');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ajuda');
  await expect(page.locator('#instalacao')).toContainText('Instalar o aplicativo');
  await expect(page.locator('#versao-app')).toHaveText('Versão 0.15.0 (desenvolvimento).');
  for (const url of ['/', '/cliente/', '/cliente/conta.html', '/business/financeiro-relatorios.html?id=x', '/cliente/ordens.html', '/ck-admin/']) {
    await page.goto(url).catch(() => {});
    await expect(page.getByRole('heading', { level: 1 }), url).toHaveText('Sem conexão com a internet');
    await expect(page.locator('main')).toContainText('Nenhuma operação foi feita');
  }
  await expect(page.locator('#faixa-conexao')).toHaveCount(0);
});

test('página aberta perde a conexão: faixa, envio barrado com "Nada foi enviado" e nada reenviado ao voltar', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto('/cliente/entrar.html');
  await page.locator('#entrar-email').fill('cida@autonick-teste.example');
  await page.locator('#entrar-senha').fill('senha-ficticia-123');
  await context.setOffline(true);
  await expect(page.locator('#faixa-conexao')).toContainText('Sem conexão. Você pode ler o que já está na tela, mas nada será enviado até a internet voltar.');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toHaveAttribute('aria-disabled', 'true');
  const antes = estado.chamadas.length;
  // O botão fica indisponível; o envio pelo teclado (Enter) também é barrado.
  await page.locator('#entrar-senha').press('Enter');
  await expect(page.locator('#notificacoes')).toContainText('Sem conexão. Nada foi enviado.');
  expect(estado.chamadas.length).toBe(antes);
  await axe(page);
  await context.setOffline(false);
  await expect(page.locator('#faixa-conexao')).toContainText('Conexão restabelecida. Atualize a página para ver as informações mais recentes.');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
  await page.waitForTimeout(1500);
  expect(estado.chamadas.filter((c) => c.metodo === 'POST').length).toBe(0);
  expect(await page.locator('#entrar-senha').inputValue()).toBe('senha-ficticia-123');
});

test('envio cuja resposta se perde: não diz que foi salvo; repetir usa a mesma chave', async ({ page, context }) => {
  let cair = true;
  const itens = [];
  const chaves = [];
  await simular(context, {
    cair: (caminho) => caminho === '/api/rpc/enviar_mensagem' && cair,
    rpc: {
      minha_solicitacao: { id: S1, empresa_id: EMP, numero: 3, servico_id: 's', servico: 'Barra de calça', empresa: 'Costura da Olga', origem: 'plataforma',
        cliente_nome: 'Cida', relato: 'Barra.', cidade: null, bairro: null, preferencia: null, respostas: [], estimativa: null, estado: 'em_analise',
        estado_exibicao: 'em_analise', versao: 1, versao_vigente_id: null, versoes: [], horario: null, historico_horarios: [], suspensao: null, eventos: [] },
      conversa_atendimento: () => ({ tipo: 'solicitacao', rotulo: 'Solicitação nº 3', papel: 'cliente', pode_enviar: true, bloqueio: null, envio_ate: null,
        suspensao: null, limite_diario: 50, aviso: 'Não compartilhe senhas.', atualizar_a_cada_s: 20, itens }),
      enviar_mensagem: (c) => { chaves.push(c.p_operation_key); const n = { id: `n${itens.length}`, alvo_tipo: 'mensagem', tipo: 'mensagem', autor: 'cliente',
        proprio: true, oculta: false, texto: c.p_texto, moderacao: null, criado_em: '2026-11-17T12:00:00Z' }; itens.push(n); return n; },
    },
  });
  const pedidos = [];
  page.on('request', (r) => { if (r.url().includes('/rpc/enviar_mensagem')) pedidos.push(JSON.parse(r.postData()).p_operation_key); });
  await page.goto(`/cliente/solicitacoes.html?s=${S1}`);
  await page.locator('#conversa-texto').fill('Pode ser na sexta?');
  await page.locator('#form-conversa [type="submit"]').click();
  await expect(page.locator('body')).toContainText('Não conseguimos confirmar se a operação foi registrada');
  await expect(page.locator('body')).not.toContainText(/enviada com sucesso|Mensagem enviada/i);
  cair = false;
  await page.locator('#form-conversa [type="submit"]').click();
  await expect(page.locator('#conversa-itens [data-item]')).toHaveCount(1);
  expect(pedidos.length).toBe(2);
  expect(pedidos[0]).toBe(pedidos[1]);
});

test('cache, localStorage e IndexedDB sem dados privados depois de percorrer telas com login', async ({ page, context }) => {
  await simular(context, { rpc: { minhas_denuncias: [] } });
  await comServiceWorker(page);
  for (const url of ['/cliente/conta.html', '/cliente/solicitacoes.html', '/cliente/pedidos.html', '/ajuda.html']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
  }
  const r = await page.evaluate(async () => {
    const urls = [];
    for (const nome of await caches.keys()) {
      const cache = await caches.open(nome);
      for (const pedido of await cache.keys()) urls.push(new URL(pedido.url).pathname);
    }
    const bancos = indexedDB.databases ? (await indexedDB.databases()).map((b) => b.name) : [];
    return { nomes: await caches.keys(), urls, locais: Object.keys(localStorage), bancos };
  });
  expect(r.nomes).toEqual(['autonick-estatico-v0.15.0']);
  for (const url of r.urls) expect(url, url).toMatch(/^\/(offline\.html|ajuda\.html|manifest\.webmanifest|css\/.+\.css|js\/.+\.js|assets\/.+\.(woff2|png|svg|webp))$/);
  expect(r.urls.some((u) => u.includes('__neon_simulado') || u.endsWith('.pdf') || u.endsWith('.csv'))).toBe(false);
  expect(r.locais).toEqual([]);
  expect(r.bancos).toEqual([]);
});

test.describe('atualização (D13-03)', () => {
  async function servirVersao(context, rotulo) {
    await context.route('**/service-worker.js', async (rota) => {
      const original = await rota.fetch();
      const texto = (await original.text()).replace("const VERSAO = 'autonick-estatico-v0.15.0'", `const VERSAO = 'autonick-estatico-v0.15.0-${rotulo}'`);
      await rota.fulfill({ response: original, body: texto, headers: { ...original.headers(), 'cache-control': 'no-store' } });
    });
  }

  test('nova versão só entra com o toque em "Atualizar"; formulário preenchido não recarrega sozinho', async ({ page, context }) => {
    await simularNeon(context);   // S-01: o formulário de entrada só é liberado com o acesso configurado
    await servirVersao(context, 'a');
    await comServiceWorker(page);
    await page.goto('/cliente/entrar.html');
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.locator('#entrar-email').fill('cida@autonick-teste.example');
    const antes = await page.evaluate(() => caches.keys());
    await context.unroute('**/service-worker.js');
    await servirVersao(context, 'b');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect(page.locator('#notificacoes')).toContainText('Há uma nova versão do AutoniCK.');
    await page.waitForTimeout(1500);
    expect(await page.locator('#entrar-email').inputValue()).toBe('cida@autonick-teste.example');
    const recarga = page.waitForEvent('load');
    await page.locator('#notificacoes').getByRole('button', { name: 'Atualizar' }).click();
    await recarga;
    // Depois de atualizar: um único cache, o da nova versão; o da versão anterior foi apagado.
    await expect.poll(async () => { const k = await page.evaluate(() => caches.keys()).catch(() => []); return k.length === 1 && k[0] !== antes[0]; }).toBe(true);
  });

  test('outra aba ativa a nova versão: esta aba só avisa e não perde o que foi digitado', async ({ page, context }) => {
    await simularNeon(context);   // S-01: o formulário de entrada só é liberado com o acesso configurado
    await servirVersao(context, 'a');
    await comServiceWorker(page);
    const outra = await context.newPage();
    await outra.goto('/ajuda.html');
    await page.goto('/cliente/entrar.html');
    await page.locator('#entrar-email').fill('cida@autonick-teste.example');
    await context.unroute('**/service-worker.js');
    await servirVersao(context, 'b');
    await outra.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect(outra.locator('#notificacoes')).toContainText('Há uma nova versão do AutoniCK.');
    const recargaOutra = outra.waitForEvent('load');
    await outra.locator('#notificacoes').getByRole('button', { name: 'Atualizar' }).click();
    await recargaOutra;
    await expect(page.locator('#notificacoes')).toContainText('O AutoniCK foi atualizado em outra janela');
    expect(await page.locator('#entrar-email').inputValue()).toBe('cida@autonick-teste.example');
  });
});
