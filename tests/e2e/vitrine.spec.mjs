/**
 * Telas do M10 (vitrine pública, área de demonstração, retorno após login, controles de vitrine do gestor e limites da CK)
 * com SIMULAÇÃO do contrato da Data API. Comprovam a interface: a rota pública chama só as três funções do anônimo e sem
 * token, filtro de cidade e bairro não traz nada de fora sem ação explícita, nenhum "km" nem mapa nem pedido de localização,
 * contatos só depois do login, retorno interno validado, nome aprovado na tela do M08 (C-01), faixa DEMONSTRAÇÃO e negação
 * da área para conta não autorizada, celular, teclado e acessibilidade. As regras reais estão em
 * tests/db/vitrine-busca.test.mjs e em verificar:neon:m10.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = '/__neon_simulado';
const AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const E1 = 'a1000000-0000-4000-8000-000000000001';
const E2 = 'a1000000-0000-4000-8000-000000000002';
const E3 = 'a1000000-0000-4000-8000-000000000003';
const SV = 'b1000000-0000-4000-8000-000000000001';
const EMP = 'e0000000-0000-4000-8000-000000000010';

function jwt(sub, role = 'authenticated') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role, exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}
// Token anônimo como o do Neon Auth (GET /token/anonymous): papel anonymous e um `sub` próprio.
const ANONIMO = jwt('anon-1', 'anonymous');
const USUARIO = jwt('u1');
const item = (id, nome, cidade, bairro, extra = {}) => ({ empresa_id: id, nome_publico: nome, categoria: 'Costura e moda', modalidade: 'ambos', cidade, bairro,
  faixa: null, selo: 'Aprovado para publicação', casou_em: ['nome'], itens_que_casaram: [], ...extra });
const EMPRESAS = [item(E1, 'Costura da Ana', 'Campinas', 'Cambuí', { itens_que_casaram: [{ tipo: 'servico', id: SV, nome: 'Ajuste de barra' }] }),
  item(E2, 'Ateliê Bela Moda', 'Campinas', 'Centro'), item(E3, 'Elétrica Paulista', 'São Paulo', 'Mooca')];
const PERFIL = {
  empresa: { id: E1, nome_publico: 'Costura da Ana', categoria: 'Costura e moda', modalidade: 'ambos', cidade: 'Campinas', uf: 'SP', bairro: 'Cambuí',
    area_atendimento: 'Campinas e região', descricao_publica: 'Ajustes e consertos de roupas.', horario_funcionamento: 'Seg a sex, 9h às 18h', selo: 'Aprovado para publicação' },
  servicos: [{ id: SV, nome: 'Ajuste de barra', descricao: null, categoria: 'Costura e moda', politica_preco: 'fixo', preco_centavos: 3000, duracao_min: 30, pacote: null },
    { id: 'b1000000-0000-4000-8000-000000000002', nome: 'Pacote noiva', descricao: null, categoria: null, politica_preco: 'pacote', preco_centavos: 20000, duracao_min: null,
      pacote: { incluidos: ['Ajuste de barra'], outros_incluidos: 1 } }],
  produtos: [{ id: 'c1', nome: 'Linha de costura', descricao: null, categoria: null, sob_encomenda: false, variacoes: [{ variacao_id: 'v1', rotulo: 'Padrão', preco_centavos: 800 }] }],
  sem_itens: false,
};

async function simular(context, { logado = false, tipo = 'cliente', demo = 'autorizada', ck = false, permissoes = [] } = {}) {
  const estado = { chamadas: [], corpos: {}, token: {}, limites: [{ chave: 'reagendamentos_por_os', valor: 3, minimo: 1, maximo: 10, descricao: 'Pedidos por OS', atualizado_em: '2026-11-13T12:00:00Z' }],
    historico: [] };
  await context.route('**/js/config/public-config.js', (rota) => rota.fulfill({ contentType: 'text/javascript',
    body: `export const CONFIG_PUBLICA = Object.freeze({ ambiente: 'teste', neonAuthUrl: '${BASE}/auth', neonDataApiUrl: '${BASE}/api' });` }));
  await context.route(`**${BASE}/**`, async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(BASE, '');
    const corpo = req.postData() ? JSON.parse(req.postData()) : null;
    estado.chamadas.push(caminho);
    estado.corpos[caminho] = corpo;
    estado.token[caminho] = (req.headers().authorization ?? '').replace(/^Bearer /, '') || null;
    const json = (status, d, cab = {}) => rota.fulfill({ status, contentType: 'application/json', headers: cab, body: JSON.stringify(d) });
    if (caminho === '/auth/get-session') {
      return logado ? json(200, { user: { id: 'u1', name: 'Pessoa', email: 'p@autonick-teste.example', emailVerified: true } }, { 'set-auth-jwt': USUARIO }) : json(200, {});
    }
    if (caminho === '/auth/token/anonymous') return json(200, { token: ANONIMO, expires_at: new Date(Date.now() + 900000).toISOString() });
    // Como no Neon: sem token, a Data API responde 401.
    if (caminho.startsWith('/api/') && !req.headers().authorization) return json(401, { message: 'missing authentication credentials' });
    switch (caminho) {
      case '/api/perfis_identidade': return json(200, [{ id: 'p1', tipo_conta: tipo, nome: 'Pessoa', criado_em: '2026-11-01T12:00:00Z' }]);
      case '/api/rpc/filtros_vitrine': case '/api/rpc/filtros_demonstracao':
        return json(200, { categorias_negocio: [{ id: 'k1', nome: 'Costura e moda' }], categorias_produto: [{ id: 'k2', nome: 'Aviamentos' }],
          cidades: [{ nome: 'Campinas' }, { nome: 'São Paulo' }], bairros: [{ cidade: 'Campinas', nome: 'Cambuí' }, { cidade: 'Campinas', nome: 'Centro' }] });
      case '/api/rpc/buscar_vitrine': case '/api/rpc/buscar_demonstracao': {
        const f = corpo.p_filtros;
        let itens = EMPRESAS.filter((i) => !f.termo || i.nome_publico.toLowerCase().includes(f.termo.toLowerCase().slice(0, 4)));
        if (f.cidade && f.ampliar !== 'cidade') itens = itens.filter((i) => i.cidade === f.cidade);
        if (f.bairro && !f.ampliar) itens = itens.filter((i) => i.bairro === f.bairro);
        if (f.cidade) itens = itens.map((i) => ({ ...i, faixa: f.bairro && i.bairro === f.bairro && i.cidade === f.cidade ? 'mesmo_bairro' : i.cidade === f.cidade ? 'mesma_cidade' : 'outros' }));
        const ordem = f.ampliar ? 'Primeiro neste bairro, depois nesta cidade, por relevância da busca. Nenhuma posição é paga.' : 'Só nesta cidade, por relevância da busca. Nenhuma posição é paga.';
        return json(200, { itens, pagina: corpo.p_pagina, por_pagina: 20, total: itens.length, mais_de_100: false, ha_mais: false, ordem,
          ...(caminho.includes('demonstracao') ? { demonstracao: true } : {}) });
      }
      case '/api/rpc/vitrine_publica': case '/api/rpc/vitrine_demonstracao':
        if (corpo.p_empresa_id !== E1) return json(400, { hint: 'NOT_FOUND', message: 'Esta vitrine não está disponível.' });
        return json(200, { ...PERFIL, ...(req.headers().authorization === `Bearer ${USUARIO}` ? { contatos: { telefone_publico: '1933330000' } } : {}) });
      case '/api/rpc/minha_autorizacao_demonstracao':
        return json(200, demo === 'autorizada' ? { autorizada: true, expira_em: '2026-12-13T12:00:00Z' } : { autorizada: false, expira_em: null });
      case '/api/rpc/empresas_para_pedido': return json(200, [{ id: E1, nome: 'Costura da Ana', cidade: 'Campinas', dado_de_teste: false }]);
      case '/api/rpc/servicos_para_cliente':
        // C-01: o banco devolve o nome aprovado mesmo com a cópia de trabalho em análise ("Ateliê Ana Nova" nunca chega).
        return json(200, { empresa: { id: E1, nome: 'Costura da Ana' }, horarios: Array.from({ length: 7 }, (_, d) => ({ dia_semana: d, intervalos: [] })),
          servicos: [{ id: SV, nome: 'Ajuste de barra', descricao: null, politica_preco: 'fixo', preco_centavos: 3000, perguntas: [], modalidade: 'analise_manual' }],
          aviso: 'A estimativa não é o valor final.' });
      case '/api/rpc/meus_pedidos': return json(200, []);
      case '/api/rpc/itens_para_pedido': return json(200, [{ variacao_id: 'v1', produto: 'Linha de costura', variacao: 'Padrão', preco_centavos: 800, sob_encomenda: false }]);
      case '/api/rpc/sou_ck_admin': return json(200, ck);
      case '/api/rpc/ck_listar_empresas': case '/api/solicitacoes_publicacao': case '/api/moderacoes_vitrine': case '/api/contestacoes': return json(200, []);
      case '/api/categorias_plataforma': return json(200, [{ id: 'k1', nome: 'Costura e moda', slug: 'costura-moda' }]);
      case '/api/rpc/ck_limites': return json(200, estado.limites);
      case '/api/rpc/ck_historico_limites': return json(200, estado.historico);
      case '/api/rpc/ck_definir_limite':
        if (corpo.p_valor > 10) return json(400, { hint: 'VALIDATION_ERROR', message: 'O valor vai de 1 a 10.', details: 'valor' });
        estado.historico.unshift({ chave: corpo.p_chave, antes: estado.limites[0].valor, depois: corpo.p_valor, motivo: corpo.p_motivo, autor: 'Admin CK', quando: '2026-11-14T12:00:00Z' });
        estado.limites[0].valor = corpo.p_valor;
        return json(200, { chave: corpo.p_chave, valor: corpo.p_valor });
      case '/api/empresas': return json(200, [{ id: EMP, nome_publico: 'Costura da Ana', versao: 1, dado_de_teste: false, situacao_vitrine: 'publicada' }]);
      case '/api/rpc/minhas_permissoes': return json(200, { membro_id: 'm', papel: 'proprietario', perfil_id: null, perfil_nome: null, permissoes });
      case '/api/rpc/servicos_da_empresa': return json(200, [{ id: SV, nome: 'Ajuste de barra', politica_preco: 'fixo', preco_centavos: 3000, modalidade: 'analise_manual',
        ativo: true, exibir_na_vitrine: estado.servicoNaVitrine ?? false, versao: 2, perguntas: [], regras: [], validade_dias: 15, solicitacoes_abertas: 0, categoria: null }]);
      case '/api/rpc/politica_cancelamento': return json(200, null);
      case '/api/rpc/definir_vitrine_servico': estado.servicoNaVitrine = corpo.p_exibir; return json(200, { id: SV, exibir_na_vitrine: corpo.p_exibir });
      default: return json(404, {});
    }
  });
  return estado;
}

const axe = async (page) => expect((await new AxeBuilder({ page }).withTags(AXE).analyze()).violations).toEqual([]);

test('rota pública: só as três funções do anônimo, sem token; filtro de cidade e bairro só amplia com ação explícita [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto('/cliente/');
  await expect(page.locator('#lista-resultados [data-empresa]')).toHaveCount(3);
  await page.locator('#cidade').selectOption('Campinas');
  await page.locator('#bairro').fill('Cambuí');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.locator('#lista-resultados [data-empresa]')).toHaveCount(1);
  await expect(page.locator('#resultados')).not.toContainText('Ateliê Bela Moda');
  await expect(page.locator('#ordem')).toContainText('Nenhuma posição é paga');
  expect(new URL(page.url()).searchParams.get('cidade')).toBe('Campinas');
  await page.locator('[data-acao="ampliar-bairro"]').click();
  await expect(page.locator('[data-faixa="mesmo_bairro"] > h3')).toHaveText('Neste bairro (Cambuí)');
  await expect(page.locator('[data-faixa="mesma_cidade"]')).toContainText('Ateliê Bela Moda');
  await expect(page.locator('[data-faixa="outros"]')).toHaveCount(0);
  await page.locator('[data-acao="ampliar-cidade"]').click();
  await expect(page.locator('[data-faixa="outros"]')).toContainText('Elétrica Paulista');
  await page.locator('[data-acao="voltar-filtro"]').click();
  await expect(page.locator('#lista-resultados [data-empresa]')).toHaveCount(1);
  const publicas = new Set(estado.chamadas.filter((c) => c.startsWith('/api/')));
  // Rota pública: o token usado é sempre o anônimo, nunca o de uma sessão.
  expect([...publicas].sort()).toEqual(['/api/rpc/buscar_vitrine', '/api/rpc/filtros_vitrine']);
  expect(estado.token['/api/rpc/buscar_vitrine']).toBe(ANONIMO);
  expect(estado.chamadas).toContain('/auth/token/anonymous');
  expect(estado.corpos['/api/rpc/buscar_vitrine'].p_filtros).not.toHaveProperty('demonstracao');
  const texto = await page.locator('main').innerText();
  expect(texto).not.toMatch(/\bkm\b|distância calculada/i);
  await axe(page);
});

test('rota pública: bairro sem cidade é corrigido ao lado do campo; vazio com ação; nada de mapa nem localização [simulação]', async ({ page, context }) => {
  await simular(context);
  let pediuLocalizacao = false;
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = () => { window.__geo = true; }; navigator.geolocation.watchPosition = () => { window.__geo = true; }; });
  await page.goto('/cliente/');
  await page.locator('#bairro').fill('Centro');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.locator('#bairro-erro')).toHaveText('Escolha a cidade antes do bairro.');
  await expect(page.locator('#bairro')).toBeFocused();
  await page.locator('#bairro').fill('');
  await page.locator('#termo').fill('zzzz');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.locator('#resultados')).toContainText('Nenhum estabelecimento com estes filtros.');
  await expect(page.locator('[data-acao="limpar"]')).toBeVisible();
  pediuLocalizacao = await page.evaluate(() => Boolean(window.__geo));
  expect(pediuLocalizacao).toBe(false);
  await expect(page.locator('iframe, [data-mapa], .leaflet-container')).toHaveCount(0);
  await expect(page.locator('#aviso-localizacao')).toContainText('Não pedimos sua localização');
});

test('perfil público: sem contatos para o anônimo, botões levam à entrada com retorno interno; pacote sem nome interno [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/cliente/empresa.html?e=${E1}`);
  await expect(page.locator('h1')).toHaveText('Costura da Ana');
  await expect(page.locator('#contatos')).toContainText('aparecem depois que você entra');
  await expect(page.locator('main')).not.toContainText('1933330000');
  await expect(page.locator('#lista-servicos')).toContainText('Inclui: Ajuste de barra, mais 1 serviço(s).');
  await expect(page.locator('#lista-produtos')).toContainText('Padrão: R$ 8,00');
  await expect(page.locator('#lista-produtos')).not.toContainText(/estoque|custo|dispon[ií]ve/i);
  const href = await page.locator(`[data-orcamento="${SV}"]`).getAttribute('href');
  expect(href).toBe(`/cliente/entrar.html?volta=${encodeURIComponent(`/cliente/servicos.html?empresa=${E1}&servico=${SV}`)}`);
  expect(estado.token['/api/rpc/vitrine_publica']).toBe(ANONIMO);
  await axe(page);
  await page.goto(`/cliente/empresa.html?e=${E2}`);
  await expect(page.locator('#vitrine')).toContainText('Esta vitrine não está disponível.');
  await page.goto('/cliente/empresa.html?e=nao-e-uuid');
  await expect(page.locator('#vitrine')).toContainText('Esta vitrine não está disponível.');
});

test('perfil com login: contatos divulgados; do orçamento ao M08 com o serviço escolhido e o nome aprovado (C-01) [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { logado: true });
  await page.goto(`/cliente/empresa.html?e=${E1}`);
  await expect(page.locator('#contatos')).toContainText('1933330000');
  expect(estado.token['/api/rpc/vitrine_publica']).toBe(USUARIO);
  await page.locator(`[data-orcamento="${SV}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/cliente/servicos.html\\?empresa=${E1}&servico=${SV}`));
  await expect(page.locator('#titulo-form')).toHaveText('Ajuste de barra');
  await expect(page.locator('main')).toContainText('Serviços de Costura da Ana');
  await expect(page.locator('main')).not.toContainText('Ateliê Ana Nova');
  await page.goto(`/cliente/empresa.html?e=${E1}`);
  await page.locator('#fazer-pedido').click();
  await expect(page).toHaveURL(new RegExp(`/cliente/pedidos.html\\?empresa=${E1}`));
  await expect(page.locator('#itens-pedido')).toContainText('Linha de costura');
  await expect(page.locator('#voltar-vitrine')).toHaveAttribute('href', `/cliente/empresa.html?e=${E1}`);
});

test('conta só empresarial é orientada a criar o perfil Cliente, sem troca automática [simulação]', async ({ page, context }) => {
  await simular(context, { logado: true, tipo: 'business' });
  await page.goto(`/cliente/servicos.html?empresa=${E1}&servico=${SV}`);
  await expect(page.locator('main')).toContainText('Esta conta ainda não tem perfil Cliente.');
  await expect(page.getByRole('link', { name: 'Criar o perfil Cliente na entrada' })).toBeVisible();
});

test('entrada com retorno: só caminho interno do Cliente é aceito [simulação]', async ({ page, context }) => {
  await simular(context);
  for (const volta of ['https://exemplo.com', '//exemplo.com', '/business/conta.html']) {
    await page.goto(`/cliente/entrar.html?volta=${encodeURIComponent(volta)}`);
    const destino = await page.evaluate(async () => (await import('/js/domain/retorno.js')).destinoSeguro(new URLSearchParams(location.search).get('volta'), 'cliente'));
    expect(destino).toBeNull();
  }
});

test('área de demonstração: faixa DEMONSTRAÇÃO para autorizada; negação para não autorizada e anônimo [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { logado: true });
  await page.goto('/cliente/demonstracao.html');
  await expect(page.locator('[data-demonstracao]').first()).toContainText('DEMONSTRAÇÃO');
  await expect(page.locator('#validade-demonstracao')).toContainText('Autorização válida até');
  await expect(page.locator('#lista-resultados [data-empresa]')).toHaveCount(3);
  await expect(page.locator(`a[href="/cliente/demonstracao-empresa.html?e=${E1}"]`)).toBeVisible();
  expect(estado.chamadas).not.toContain('/api/rpc/buscar_vitrine');
  await axe(page);
  await page.goto(`/cliente/demonstracao-empresa.html?e=${E1}`);
  await expect(page.locator('[data-demonstracao]').first()).toBeVisible();
});

test('área de demonstração: conta sem autorização e visitante não veem nada [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { logado: true, demo: 'negada' });
  await page.goto('/cliente/demonstracao.html');
  await expect(page.locator('#resultados')).toContainText('Área disponível só para contas de demonstração autorizadas.');
  await expect(page.locator('#form-busca')).toBeHidden();
  expect(estado.chamadas).not.toContain('/api/rpc/buscar_demonstracao');
});

test('área de demonstração sem login pede a entrada com retorno [simulação]', async ({ page, context }) => {
  await simular(context);
  await page.goto('/cliente/demonstracao.html');
  await expect(page.getByRole('link', { name: 'Entrar com a conta de demonstração' })).toHaveAttribute('href', `/cliente/entrar.html?volta=${encodeURIComponent('/cliente/demonstracao.html')}`);
});

test('celular 360 px e teclado: busca, filtros, ação de ampliar e perfil sem mouse [simulação]', async ({ page, context }) => {
  await simular(context);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/cliente/');
  await expect(page.locator('#lista-resultados [data-empresa]')).toHaveCount(3);
  const largos = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((n) => n.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
    .map((n) => `${n.tagName}.${n.className}#${n.id}`).slice(0, 5));
  expect(largos).toEqual([]);
  await page.locator('#termo').focus();
  await page.keyboard.type('costura');
  await page.locator('#cidade').focus();
  await page.keyboard.press('ArrowDown');
  await page.locator('#modalidade').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Buscar' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#contagem')).toContainText('encontrado');
  await page.locator('#resultados a').first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/cliente\/empresa\.html\?e=/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('celular 360 px na área de demonstração (logado, faixa, ampliação e perfil) com nomes longos como os do Neon [simulação]', async ({ page, context }) => {
  // Achado na verificação real: nomes com a palavra da rodada ("[TESTE] Ateliê Navegador m10nmwfrrfyq") e o cabeçalho logado.
  const longo = 'm10nmwfrrfyqabcdefgh';
  for (const e of EMPRESAS) e.nome_publico = `[TESTE] ${e.nome_publico} ${longo}`;
  PERFIL.empresa.nome_publico = `[TESTE] Costura da Ana ${longo}`;
  PERFIL.servicos[0].nome = `Ajuste de barra ${longo}`;
  PERFIL.produtos[0].nome = `Linha de costura ${longo}`;
  try {
    await simular(context, { logado: true });
    await page.setViewportSize({ width: 360, height: 780 });
    // A onda do clique fica numa camada com overflow:hidden (recortada, não causa rolagem); por isso não entra na medição.
    const largos = () => page.evaluate(() => [...document.querySelectorAll('body *')].filter((n) => !n.closest('.camada-onda') && n.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .map((n) => `${n.tagName}.${n.className}#${n.id}`).slice(0, 8));
    await page.goto('/cliente/demonstracao.html');
    await expect(page.locator('#lista-resultados [data-empresa]')).toHaveCount(3);
    await page.locator('#cidade').selectOption('Campinas');
    await page.locator('#bairro').fill('Cambuí');
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.locator('[data-acao="ampliar-bairro"]').click();
    await expect(page.locator('[data-faixa="mesma_cidade"]')).toBeVisible();
    expect(await largos()).toEqual([]);
    await page.goto(`/cliente/demonstracao-empresa.html?e=${E1}`);
    await expect(page.locator('#lista-servicos')).toContainText(longo);
    expect(await largos()).toEqual([]);
  } finally {
    for (const e of EMPRESAS) e.nome_publico = e.nome_publico.replace('[TESTE] ', '').replace(` ${longo}`, '');
    PERFIL.empresa.nome_publico = 'Costura da Ana';
    PERFIL.servicos[0].nome = 'Ajuste de barra';
    PERFIL.produtos[0].nome = 'Linha de costura';
  }
});

test('gestor: serviço ativo aparece "Fora da vitrine" até publicar; botão só com vitrine.alterar [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { logado: true, tipo: 'business', permissoes: ['catalogo_servicos.visualizar', 'catalogo_servicos.alterar', 'vitrine.alterar'] });
  await page.addInitScript((id) => localStorage.setItem('autonick:empresa-ativa', id), EMP);
  await page.goto(`/business/servicos.html?id=${EMP}`);
  await expect(page.locator(`[data-servico="${SV}"] [data-situacao-vitrine]`)).toContainText('Fora da vitrine');
  await page.locator(`[data-vitrine="${SV}"]`).click();
  await expect(page.locator('#avisos')).toContainText('Serviço publicado na vitrine.');
  expect(estado.corpos['/api/rpc/definir_vitrine_servico']).toMatchObject({ p_servico_id: SV, p_exibir: true, p_expected_version: 2 });
});

test('gestor sem vitrine.alterar não vê o botão de publicar [simulação]', async ({ page, context }) => {
  await simular(context, { logado: true, tipo: 'business', permissoes: ['catalogo_servicos.visualizar', 'catalogo_servicos.alterar'] });
  await page.goto(`/business/servicos.html?id=${EMP}`);
  await expect(page.locator(`[data-servico="${SV}"]`)).toBeVisible();
  await expect(page.locator(`[data-vitrine="${SV}"]`)).toHaveCount(0);
});

test('CK: limites com faixa, motivo obrigatório, confirmação "o que vai mudar" e histórico; quem não é CK é negado [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { logado: true, tipo: 'business', ck: true });
  await page.goto('/ck-admin/#parametros');
  await expect(page.getByRole('tab', { name: 'Parâmetros' })).toHaveAttribute('aria-selected', 'true');
  const item = page.locator('[data-limite-item="reagendamentos_por_os"]');
  await expect(item.locator('[data-valor]')).toHaveText('3');
  await item.locator('input[name="valor"]').fill('11');
  await item.getByRole('button', { name: 'Alterar limite' }).click();
  await expect(item.locator('[id$="-valor-erro"]')).toHaveText('O valor vai de 1 a 10.');
  await item.locator('input[name="valor"]').fill('4');
  await item.locator('input[name="motivo"]').fill('curto');
  await item.getByRole('button', { name: 'Alterar limite' }).click();
  await expect(item.locator('[id$="-motivo-erro"]')).toContainText('10 a 300');
  await item.locator('input[name="motivo"]').fill('Mais flexibilidade para os testes do M10.');
  await item.getByRole('button', { name: 'Alterar limite' }).click();
  await expect(page.getByRole('dialog')).toContainText('de 3 para 4');
  await page.getByRole('dialog').getByRole('button', { name: 'Alterar limite' }).click();
  await expect(page.locator('#historico-limites')).toContainText('de 3 para 4');
  await expect(page.locator('#historico-limites')).toContainText('Motivo: Mais flexibilidade para os testes do M10.');
  expect(estado.corpos['/api/rpc/ck_definir_limite']).toMatchObject({ p_chave: 'reagendamentos_por_os', p_valor: 4 });
  expect(estado.chamadas.filter((c) => /solicitacoes_servico|clientes|pedidos|ordens/.test(c))).toEqual([]);
  await axe(page);
});

test('CK: quem não é administrador não vê a tela de limites [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { logado: true, tipo: 'business', ck: false });
  await page.goto('/ck-admin/');
  await expect(page.locator('#painel')).toContainText('exclusiva da equipe da CK');
  expect(estado.chamadas).not.toContain('/api/rpc/ck_limites');
});
