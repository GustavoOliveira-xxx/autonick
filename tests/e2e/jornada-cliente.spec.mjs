/**
 * Telas do M11 (jornada completa do Cliente) com SIMULAÇÃO do contrato da Data API. Comprovam a interface: porta única
 * pela vitrine (sem seletor de empresas), "Pedir" por produto, retorno após login, início com "Precisa da sua ação",
 * item retirado (ao voltar do login e durante o preenchimento), sessão encerrada com o rascunho só na memória da página e
 * sem reenvio automático, duplo clique, avisos de suspensão comum e grave sem justificativa interna, aceite congelado,
 * menu, faixas corrigidas, 360 px, teclado e acessibilidade. As regras reais estão em tests/db/jornada-cliente.test.mjs e
 * em verificar:neon:m11.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = '/__neon_simulado';
const AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const E1 = 'a1100000-0000-4000-8000-000000000001';
const SV = 'b1100000-0000-4000-8000-000000000001';
const SV_FORA = 'b1100000-0000-4000-8000-000000000009';
const PR = 'c1100000-0000-4000-8000-000000000001';
const PR2 = 'c1100000-0000-4000-8000-000000000002';
const V1 = 'd1100000-0000-4000-8000-000000000001';
const V2 = 'd1100000-0000-4000-8000-000000000002';
const S1 = 'e1100000-0000-4000-8000-000000000001';
const OS = 'f1100000-0000-4000-8000-000000000001';

function jwt(sub, role = 'authenticated') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role, exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}
const USUARIO = jwt('u1');
const ANONIMO = jwt('anon', 'anonymous');
const PERFIL = {
  empresa: { id: E1, nome_publico: 'Costura da Olga', categoria: 'Costura e moda', modalidade: 'ambos', cidade: 'Campinas', uf: 'SP', bairro: 'Cambuí',
    area_atendimento: null, descricao_publica: 'Ajustes de roupas.', horario_funcionamento: null, selo: 'Aprovado para publicação' },
  servicos: [{ id: SV, nome: 'Barra de calça', descricao: null, categoria: null, politica_preco: 'fixo', preco_centavos: 3000, duracao_min: 30, pacote: null }],
  produtos: [{ id: PR, nome: 'Linha de costura', descricao: null, categoria: null, sob_encomenda: false, variacoes: [{ variacao_id: V1, rotulo: 'Padrão', preco_centavos: 800 }] },
    { id: PR2, nome: 'Botão', descricao: null, categoria: null, sob_encomenda: true, variacoes: [{ variacao_id: V2, rotulo: 'Padrão', preco_centavos: 150 }] }],
  sem_itens: false,
};
const versao = (n, estado) => ({ id: `ver-${n}`, numero: n, tipo: 'automatico', estado, estado_exibicao: estado, subtotal_centavos: 3000, desconto_itens_centavos: 0,
  desconto_geral_centavos: 0, total_centavos: 3000, valido_ate: '2099-12-31', prazo_execucao: '1 dia', condicoes: null, versao: 1,
  componentes: [{ ordem: 1, tipo: 'mao_de_obra', descricao: 'Barra', quantidade: 1, valor_unitario_centavos: 3000, desconto_centavos: 0, total_centavos: 3000 }] });
const solicitacao = (extra = {}) => ({ id: S1, empresa_id: E1, numero: 3, servico_id: SV, servico: 'Barra de calça', empresa: 'Costura da Olga', origem: 'plataforma',
  cliente_nome: 'Cida', relato: 'Fazer a barra de uma calça jeans.', cidade: null, bairro: null, preferencia: null, respostas: [], estimativa: null,
  estado: 'orcamento_enviado', estado_exibicao: 'orcamento_enviado', versao: 2, versao_vigente_id: 'ver-1', versoes: [versao(1, 'enviada')], horario: null,
  historico_horarios: [], eventos: [{ id: 'e1', tipo: 'criada', autor_tipo: 'cliente', autor: 'Cida', texto: null, dados: {}, interno: false, criado_em: '2026-11-14T12:00:00Z' }],
  suspensao: null, ...extra });

async function simular(context, { logado = true, perfis = ['cliente'], servicos = PERFIL.servicos, itens = null, erros = {}, minha = solicitacao(),
  pedidos = [], ordens = [], solicitacoes = [] } = {}) {
  const estado = { chamadas: [], corpos: {}, sessaoAtiva: logado, contagem: {} };
  await context.route('**/js/config/public-config.js', (rota) => rota.fulfill({ contentType: 'text/javascript',
    body: `export const CONFIG_PUBLICA = Object.freeze({ ambiente: 'teste', neonAuthUrl: '${BASE}/auth', neonDataApiUrl: '${BASE}/api' });` }));
  await context.route(`**${BASE}/**`, async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(BASE, '');
    const corpo = req.postData() ? JSON.parse(req.postData()) : null;
    estado.chamadas.push(caminho);
    estado.corpos[caminho] = corpo;
    estado.contagem[caminho] = (estado.contagem[caminho] ?? 0) + 1;
    const json = (status, d, cab = {}) => rota.fulfill({ status, contentType: 'application/json', headers: cab, body: JSON.stringify(d) });
    if (caminho === '/auth/get-session') {
      return estado.sessaoAtiva ? json(200, { user: { id: 'u1', name: 'Cida', email: 'cida@exemplo.example', emailVerified: true } }, { 'set-auth-jwt': USUARIO }) : json(200, {});
    }
    if (caminho === '/auth/sign-in/email') { estado.sessaoAtiva = true; return json(200, { user: { id: 'u1' } }); }
    if (caminho === '/auth/token/anonymous') return json(200, { token: ANONIMO, expires_at: new Date(Date.now() + 900000).toISOString() });
    if (caminho.startsWith('/api/') && !req.headers().authorization) return json(401, { message: 'missing authentication credentials' });
    const lista = erros[caminho];
    if (lista?.length) { const e = lista.shift(); return e.status ? json(e.status, e.corpo ?? {}) : json(400, e); }
    // Sessão encerrada no servidor: a Data API recusa a chamada autenticada.
    if (!estado.sessaoAtiva && req.headers().authorization === `Bearer ${USUARIO}`) return json(401, { message: 'JWT expired' });
    switch (caminho) {
      case '/api/perfis_identidade': return json(200, perfis.map((t, i) => ({ id: `p${i}`, tipo_conta: t, nome: 'Cida', criado_em: '2026-11-01T12:00:00Z' })));
      case '/api/rpc/vitrine_publica': return json(200, { ...PERFIL, ...(req.headers().authorization === `Bearer ${USUARIO}` ? { contatos: {} } : {}) });
      case '/api/rpc/servicos_para_cliente': return json(200, { empresa: { id: E1, nome: 'Costura da Olga' }, horarios: Array.from({ length: 7 }, (_, d) => ({ dia_semana: d, intervalos: [] })),
        servicos: servicos.map((s) => ({ ...s, perguntas: [], modalidade: 'analise_manual' })), aviso: 'A estimativa não é o valor final.' });
      case '/api/rpc/estimar_servico': return json(200, { valor_centavos: 3000, completa: true, linhas: [] });
      case '/api/rpc/criar_solicitacao': return json(200, { id: S1, numero: 3, estado: 'nova' });
      case '/api/rpc/itens_para_pedido': return json(200, itens ?? [
        { variacao_id: V1, produto_id: PR, produto: 'Linha de costura', variacao: 'Padrão', preco_centavos: 800, sob_encomenda: false },
        { variacao_id: V2, produto_id: PR2, produto: 'Botão', variacao: 'Padrão', preco_centavos: 150, sob_encomenda: true }]);
      case '/api/rpc/criar_pedido': await new Promise((r) => setTimeout(r, 300)); return json(200, { id: 'ped-1', estado: 'solicitado', total_centavos: 800, versao: 1 });
      case '/api/rpc/meus_pedidos': return json(200, pedidos);
      case '/api/rpc/minhas_solicitacoes': return json(200, solicitacoes);
      case '/api/rpc/minha_solicitacao': return json(200, minha);
      case '/api/rpc/minhas_os': return json(200, ordens);
      default: return json(404, {});
    }
  });
  return estado;
}
const axe = async (page) => expect((await new AxeBuilder({ page }).withTags(AXE).analyze()).violations).toEqual([]);
const semRolagem = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

test('serviço: vitrine sem sessão → entrar com retorno → formulário com o serviço → estimativa → envio [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { logado: false });
  await page.goto(`/cliente/empresa.html?e=${E1}`);
  const link = page.locator(`[data-orcamento="${SV}"]`);
  await expect(link).toHaveText('Entrar para pedir orçamento');
  expect(decodeURIComponent((await link.getAttribute('href')).split('volta=')[1])).toBe(`/cliente/servicos.html?empresa=${E1}&servico=${SV}`);
  estado.sessaoAtiva = true;   // a entrada é coberta pelos testes de autenticação; aqui volta ao destino
  await page.goto(`/cliente/servicos.html?empresa=${E1}&servico=${SV}`);
  await expect(page.locator('#titulo-form')).toHaveText('Barra de calça');
  await expect(page.locator('#cli-empresa')).toHaveCount(0);
  await expect(page.locator('#voltar-vitrine')).toHaveAttribute('href', `/cliente/empresa.html?e=${E1}`);
  await page.locator('#ver-estimativa').click();
  await expect(page.locator('#estimativa')).toContainText('Este é um valor estimado. Confira o orçamento antes de aceitar.');
  await page.locator('#cli-relato').fill('Fazer a barra de uma calça jeans.');
  await page.locator('#form-solicitacao [type="submit"]').click();
  await expect(page.locator('#conteudo-pagina')).toContainText('Solicitação nº 3 enviada');
  expect(estado.corpos['/api/rpc/criar_solicitacao'].p_servico_id).toBe(SV);
  await axe(page);
});

test('produto: "Pedir" no produto → pedido com o item já escolhido, sem estoque nem cobrança → meus pedidos [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/cliente/empresa.html?e=${E1}`);
  await expect(page.locator('#conteudo')).toContainText('A empresa confirma a disponibilidade ao responder ao pedido');
  await expect(page.locator('#conteudo')).toContainText('Nada é cobrado pelo app');
  await page.locator(`[data-pedir="${PR}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/cliente/pedidos.html\\?empresa=${E1}&produto=${PR}`));
  await expect(page.locator(`#qtd-${V1}`)).toHaveValue('1');
  await expect(page.locator(`#qtd-${V2}`)).toHaveValue('');
  await expect(page.locator('#novo-pedido')).not.toContainText(/estoque|disponíveis: \d/i);
  await expect(page.locator('#novo-pedido')).toContainText('o pedido não é um pagamento');
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.locator('#avisos')).toContainText('Pedido enviado (R$ 8,00)');
  expect(estado.corpos['/api/rpc/criar_pedido']).toMatchObject({ p_empresa_id: E1, p_itens: [{ variacao_id: V1, quantidade: 1 }] });
  await axe(page);
});

test('sem empresa vinda da vitrine: orientação para a busca, sem seletor; menu sem "Pedir orçamento" [simulação]', async ({ page, context }) => {
  await simular(context);
  await page.goto('/cliente/servicos.html');
  await expect(page.locator('#conteudo-pagina')).toContainText('escolha a empresa e o serviço na busca');
  await expect(page.locator('select')).toHaveCount(0);
  await page.goto('/cliente/pedidos.html');
  await expect(page.locator('#novo-pedido')).toContainText('escolha a empresa e o produto na busca');
  await expect(page.locator('#pedido-empresa')).toHaveCount(0);
  const menu = page.getByRole('navigation', { name: 'Principal' });
  await expect(menu.getByRole('link', { name: 'Pedir orçamento' })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: 'Minha conta' })).toHaveCount(1);
});

test('item retirado da vitrine ao voltar do login e durante o preenchimento: nada é criado [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { erros: {
    '/api/rpc/criar_pedido': [{ code: 'P0001', hint: 'NOT_FOUND', message: 'Um dos produtos não está disponível para pedido.', details: V1 }] } });
  // Voltando do login: o serviço escolhido saiu da vitrine (o banco não o lista mais).
  await page.goto(`/cliente/servicos.html?empresa=${E1}&servico=${SV_FORA}`);
  await expect(page.locator('#avisos')).toContainText('não está mais disponível para novas solicitações');
  await expect(page.locator('#form-solicitacao')).toHaveCount(0);
  // Durante o preenchimento: o envio é recusado e a lista é atualizada.
  await page.goto(`/cliente/pedidos.html?empresa=${E1}&produto=${PR}`);
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.locator('#avisos')).toContainText('Um dos produtos não está disponível para pedido.');
  await expect(page.locator('#avisos')).toContainText('Nada foi enviado');
  await expect(page.locator('#avisos')).not.toContainText('Pedido enviado');
  await expect.poll(() => estado.contagem['/api/rpc/itens_para_pedido']).toBeGreaterThanOrEqual(2);
});

test('empresa indisponível para novas solicitações: aviso com volta para a vitrine [simulação]', async ({ page, context }) => {
  await simular(context, { erros: { '/api/rpc/servicos_para_cliente': [{ code: 'P0001', hint: 'NOT_FOUND', message: 'Esta empresa não está disponível para novas solicitações.' }] } });
  await page.goto(`/cliente/servicos.html?empresa=${E1}&servico=${SV}&origem=demonstracao`);
  await expect(page.locator('#conteudo-pagina')).toContainText('Esta empresa não está disponível para novas solicitações.');
  await expect(page.locator('#conteudo-pagina a').first()).toHaveAttribute('href', `/cliente/demonstracao-empresa.html?e=${E1}`);
});

test('sessão encerrada no envio: entra de novo na própria página, o texto continua e nada é reenviado sozinho [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/cliente/servicos.html?empresa=${E1}&servico=${SV}`);
  await page.locator('#cli-relato').fill('Fazer a barra de duas calças de linho.');
  estado.sessaoAtiva = false;
  await page.locator('#form-solicitacao [type="submit"]').click();
  const dialogo = page.getByRole('dialog', { name: 'Entrar de novo' });
  await expect(dialogo).toContainText('o que você digitou continua nesta página');
  await expect(dialogo).toContainText('Se você recarregar ou sair desta página, o que digitou será perdido');
  const tentativas = estado.contagem['/api/rpc/criar_solicitacao'] ?? 0;
  await dialogo.getByLabel('E-mail').fill('cida@exemplo.example');
  await dialogo.getByLabel('Senha').fill('senha-de-teste-1');
  await dialogo.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('#avisos')).toContainText('nada foi enviado ainda');
  await expect(page.locator('#cli-relato')).toHaveValue('Fazer a barra de duas calças de linho.');
  expect(estado.contagem['/api/rpc/criar_solicitacao'] ?? 0).toBe(tentativas);
  // Nada do rascunho foi gravado no aparelho.
  const guardado = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(guardado).not.toContain('linho');
  await page.locator('#form-solicitacao [type="submit"]').click();
  await expect(page.locator('#conteudo-pagina')).toContainText('Solicitação nº 3 enviada');
});

test('sessão encerrada e "Agora não": aviso claro, sem envio [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/cliente/pedidos.html?empresa=${E1}&produto=${PR}`);
  await expect(page.getByRole('button', { name: 'Enviar pedido' })).toBeVisible();
  estado.sessaoAtiva = false;
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await page.getByRole('dialog', { name: 'Entrar de novo' }).getByRole('button', { name: 'Agora não' }).click();
  await expect(page.locator('#avisos')).toContainText('Sua sessão terminou e nada foi enviado.');
  await expect(page.locator('#avisos')).toContainText('se recarregar ou sair, será preciso digitar outra vez');
});

test('sem sessão ao abrir a tela: entrar volta para a mesma empresa e o mesmo item [simulação]', async ({ page, context }) => {
  await simular(context, { logado: false });
  await page.goto(`/cliente/pedidos.html?empresa=${E1}&produto=${PR}`);
  const href = await page.locator('#entrar-e-voltar').getAttribute('href');
  expect(decodeURIComponent(href.split('volta=')[1])).toBe(`/cliente/pedidos.html?empresa=${E1}&produto=${PR}`);
});

test('duplo clique no envio do pedido: um pedido só [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/cliente/pedidos.html?empresa=${E1}&produto=${PR}`);
  await page.getByRole('button', { name: 'Enviar pedido' }).dblclick();
  await expect(page.locator('#avisos')).toContainText('Pedido enviado');
  expect(estado.contagem['/api/rpc/criar_pedido']).toBe(1);
});

test('suspensão comum: aceite congelado com aviso; recusar e cancelar continuam [simulação]', async ({ page, context }) => {
  await simular(context, { minha: solicitacao({ suspensao: 'comum' }) });
  await page.goto(`/cliente/solicitacoes.html?s=${S1}`);
  await expect(page.locator('[data-suspensao="comum"]')).toContainText('A vitrine desta empresa está suspensa.');
  await expect(page.locator('[data-suspensao="comum"]')).toContainText('Você pode desistir sem custo');
  await expect(page.locator('[data-aceitar="1"]')).toBeDisabled();
  await expect(page.locator('[data-recusar="1"]')).toBeEnabled();
  await expect(page.locator('#cancelar-solicitacao')).toBeEnabled();
  await axe(page);
});

test('suspensão grave: aviso adicional nos atendimentos aceitos, sem justificativa interna [simulação]', async ({ page, context }) => {
  await simular(context, {
    pedidos: [{ id: 'ped-9', estado: 'aceito', versao: 2, empresa_id: E1, suspensao: 'grave', empresa: 'Costura da Olga', observacao: null, motivo: null,
      total_centavos: 800, criado_em: '2026-11-14T12:00:00Z', decidido_em: '2026-11-14T13:00:00Z', entrega: null,
      itens: [{ produto: 'Linha de costura', variacao: 'Padrão', quantidade: 1, preco_centavos: 800 }] }],
    ordens: [{ id: OS, numero: 4, empresa: 'Costura da Olga', empresa_id: E1, suspensao: 'grave', servico: 'Barra de calça', estado: 'em_execucao',
      solicitacao_id: S1, criado_em: '2026-11-14T12:00:00Z', horario: null, acao_pendente: null }] });
  await page.goto('/cliente/pedidos.html');
  const aviso = page.locator('[data-meu-pedido="ped-9"] [data-suspensao="grave"]');
  await expect(aviso).toContainText('motivo grave');
  await expect(aviso).toContainText('O que já foi aceito continua registrado');
  await expect(page.locator('#conteudo-pagina')).not.toContainText(/fraude|risco_consumidor|exigencia_legal|fundamento/i);
  await page.goto('/cliente/ordens.html');
  await expect(page.locator('[data-suspensao="grave"]')).toHaveText('Vitrine da empresa suspensa');
});

test('início do Cliente logado: "Precisa da sua ação" só com as próprias pendências; visitante não vê [simulação]', async ({ page, context }) => {
  const estado = await simular(context, {
    solicitacoes: [{ id: S1, numero: 3, empresa: 'Costura da Olga', empresa_id: E1, suspensao: null, servico: 'Barra', estado: 'orcamento_enviado', estado_exibicao: 'orcamento_enviado',
      total_vigente_centavos: 3000, valido_ate: '2099-12-31', criado_em: '2026-11-14T12:00:00Z', horario: null }],
    ordens: [{ id: OS, numero: 4, empresa: 'Costura da Olga', empresa_id: E1, suspensao: null, servico: 'Bainha', estado: 'concluida', solicitacao_id: 's2',
      criado_em: '2026-11-14T12:00:00Z', horario: null, acao_pendente: 'confirmar_recebimento' }],
    pedidos: [{ id: 'ped-1', estado: 'solicitado', versao: 1, empresa_id: E1, suspensao: null, empresa: 'Costura da Olga', itens: [], total_centavos: 800, criado_em: '2026-11-14T12:00:00Z' }] });
  await page.goto('/cliente/');
  const bloco = page.locator('#minha-acao');
  await expect(bloco).toBeVisible();
  await expect(bloco.locator('[data-acao-cliente="orcamentos"]')).toContainText('1 orçamento disponível para você responder');
  await expect(bloco.locator('[data-acao-cliente="recebimentos"]')).toContainText('1 serviço concluído para confirmar');
  await expect(bloco.locator('#em-andamento')).toContainText('1 pedido em andamento');
  expect(estado.chamadas).toEqual(expect.arrayContaining(['/api/rpc/minhas_solicitacoes', '/api/rpc/minhas_os', '/api/rpc/meus_pedidos']));
  await axe(page);
  await context.clearCookies();
  estado.sessaoAtiva = false;
  await page.reload();
  await expect(page.locator('#minha-acao')).toBeHidden();
});

test('faixas das telas de entrada e conta não prometem que nada é salvo [simulação]', async ({ page, context }) => {
  await simular(context);
  for (const caminho of ['/cliente/entrar.html', '/cliente/conta.html', '/business/entrar.html', '/business/conta.html', '/', '/ajuda.html']) {
    await page.goto(caminho);
    const faixa = page.locator('.faixa-demo').first();
    await expect(faixa).not.toContainText('Nada é salvo');
    await expect(faixa).toContainText('VERSÃO DE DESENVOLVIMENTO');
  }
  await expect(page.locator('#privacidade')).toContainText('gravam o que você envia no banco de dados de desenvolvimento');
});

for (const caminho of [`/cliente/servicos.html?empresa=${E1}&servico=${SV}`, `/cliente/pedidos.html?empresa=${E1}&produto=${PR}`, '/cliente/', `/cliente/empresa.html?e=${E1}`]) {
  test(`360 px sem rolagem horizontal e teclado: ${caminho.split('?')[0]} [simulação]`, async ({ page, context }) => {
    await simular(context, { solicitacoes: [{ id: S1, numero: 3, empresa: 'Costura da Olga com um nome bem comprido para testar', empresa_id: E1, suspensao: 'comum',
      servico: 'Barra', estado: 'orcamento_enviado', estado_exibicao: 'orcamento_enviado', criado_em: '2026-11-14T12:00:00Z', horario: null }] });
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(caminho);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await page.waitForTimeout(200);
    await semRolagem(page);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
    await axe(page);
  });
}

// P-M11-02: o aviso de valor estimado aparece só quando a tela mostra apenas a estimativa; com o orçamento já gerado e
// disponível para aceite, não aparece. Os dois estados vêm do contrato atual (versões visíveis da solicitação).
const ESTIMADA = { completa: true, tipo: 'por_regras', exibicao: 'valor', valor_centavos: 12000, base: [], faltando: [],
  rotulo: 'Orçamento gerado pelas regras da empresa, sem análise manual.' };
const AVISO = 'Este é um valor estimado. Confira o orçamento antes de aceitar.';

test('estimativa: só estimativa (solicitação em análise, sem orçamento) mostra o aviso de valor estimado [simulação]', async ({ page, context }) => {
  await simular(context, { minha: solicitacao({ estado: 'em_analise', estado_exibicao: 'em_analise', versao_vigente_id: null, versoes: [], estimativa: ESTIMADA }) });
  await page.goto(`/cliente/solicitacoes.html?s=${S1}`);
  await expect(page.locator('#versoes')).toContainText('A empresa ainda não enviou orçamento.');
  await expect(page.locator('#estimativa')).toContainText(AVISO);
  await expect(page.locator('#estimativa')).not.toContainText('Orçamento gerado pelas regras');
  await axe(page);
});

test('estimativa: orçamento já gerado e disponível para aceite não mostra o aviso; aceite inalterado [simulação]', async ({ page, context }) => {
  await simular(context, { minha: solicitacao({ estimativa: ESTIMADA }) });
  await page.goto(`/cliente/solicitacoes.html?s=${S1}`);
  await expect(page.locator('[data-aceitar="1"]')).toBeEnabled();
  await expect(page.locator('#estimativa')).toContainText('R$');
  await expect(page.locator('#estimativa')).not.toContainText(AVISO);
  await expect(page.locator('#estimativa [data-ajuda-estimativa]')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(AVISO);
  await axe(page);
});

test('estimativa sem valor (sob consulta): mantém a explicação do banco, sem aviso de valor estimado [simulação]', async ({ page, context }) => {
  await simular(context, { minha: solicitacao({ estado: 'nova', estado_exibicao: 'nova', versao_vigente_id: null, versoes: [],
    estimativa: { completa: false, tipo: 'sob_consulta', base: [], faltando: [], rotulo: 'Preço sob consulta: a empresa vai analisar e enviar o orçamento.' } }) });
  await page.goto(`/cliente/solicitacoes.html?s=${S1}`);
  await expect(page.locator('#estimativa')).toContainText('Preço sob consulta');
  await expect(page.locator('#estimativa')).not.toContainText(AVISO);
});
