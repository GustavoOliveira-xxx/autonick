/**
 * Telas do M03 (empresas, vitrine e painel CK), ajustadas no M04 (papel,
 * permissões e convites), com SIMULAÇÃO do contrato da Data API (rotas do
 * Playwright). Comprovam a interface; as regras reais são testadas no banco
 * (tests/db/*.test.mjs) e no Neon (verificar:neon:m03 e verificar:neon:m04).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = '/__neon_simulado';
const CAT = 'c0000000-0000-4000-8000-000000000001';
const EMP = 'e0000000-0000-4000-8000-000000000001';

function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}

const TODAS_DA_EMPRESA = ['empresa.visualizar', 'empresa.alterar', 'vitrine.visualizar', 'vitrine.alterar',
  'equipe.visualizar', 'equipe.convidar', 'equipe.alterar', 'equipe.revogar'];
const PRIVADOS = ['documento', 'email_contato', 'endereco_privado', 'observacoes_internas'];

async function simular(context, { ck = false, empresas = [], fila = [], erros = {}, acesso = null, convites = [] } = {}) {
  const estado = { empresas: [...empresas], fila: [...fila], chaves: [], chamadas: [], convites: [...convites],
    acesso: acesso ?? { papel: 'proprietario', perfil_nome: null, permissoes: TODAS_DA_EMPRESA } };
  await context.route('**/js/config/public-config.js', (rota) => rota.fulfill({
    contentType: 'text/javascript',
    body: `export const CONFIG_PUBLICA = Object.freeze({ ambiente: 'teste', neonAuthUrl: '${BASE}/auth', neonDataApiUrl: '${BASE}/api' });`,
  }));
  await context.route(`**${BASE}/**`, async (rota) => {
    const req = rota.request();
    const url = new URL(req.url());
    const caminho = url.pathname.replace(BASE, '');
    const corpo = req.postData() ? JSON.parse(req.postData()) : null;
    estado.chamadas.push(caminho);
    const json = (status, dados, cab = {}) => rota.fulfill({ status, contentType: 'application/json', headers: cab, body: JSON.stringify(dados) });
    if (caminho === '/auth/get-session') {
      return json(200, { user: { id: 'u1', name: 'Pessoa', email: 'p@exemplo.example', emailVerified: true } }, { 'set-auth-jwt': jwt('u1') });
    }
    if (corpo?.p_operation_key) estado.chaves.push(`${caminho}:${corpo.p_operation_key}`);
    if (erros[caminho]) {
      const erro = erros[caminho].shift();
      if (erro === 'rede') return rota.abort('failed');
      if (erro) return json(400, erro);
    }
    const id = url.searchParams.get('id')?.replace('eq.', '');
    switch (caminho) {
      case '/api/perfis_identidade':
        return json(200, [{ id: 'p1', tipo_conta: 'business', nome: 'Pessoa', criado_em: '2026-11-01T12:00:00Z' }]);
      case '/api/categorias_plataforma':
        return json(200, [{ id: CAT, nome: 'Alimentação', slug: 'alimentacao' }]);
      case '/api/empresas': {
        // Como no banco desde o M04: a tabela não entrega colunas privadas.
        const sem = (e) => Object.fromEntries(Object.entries(e).filter(([c]) => !PRIVADOS.includes(c)));
        return json(200, (id ? estado.empresas.filter((e) => e.id === id) : estado.empresas).map(sem));
      }
      case '/api/rpc/minhas_empresas':
        return json(200, estado.acesso ? estado.empresas.map((e) => ({ empresa_id: e.id, nome_publico: e.nome_publico, cidade: e.cidade, uf: e.uf,
          situacao_vitrine: e.situacao_vitrine, dado_de_teste: Boolean(e.dado_de_teste), papel: estado.acesso.papel, perfil_nome: estado.acesso.perfil_nome })) : []);
      case '/api/rpc/minhas_permissoes':
        return estado.acesso ? json(200, { membro_id: 'm1', perfil_id: null, ...estado.acesso })
          : json(403, { hint: 'TENANT_FORBIDDEN', message: 'Você não tem acesso a esta empresa.' });
      case '/api/rpc/empresa_dados_privados': {
        if (!estado.acesso.permissoes.includes('empresa.visualizar')) return json(403, { hint: 'FORBIDDEN_ACTION', message: 'Seu acesso não permite esta ação nesta empresa.' });
        const e = estado.empresas.find((x) => x.id === corpo.p_empresa_id);
        return json(200, Object.fromEntries(PRIVADOS.map((c) => [c, e[c] ?? null])));
      }
      case '/api/rpc/meus_convites':
        return json(200, estado.convites);
      case '/api/rpc/aceitar_convite': {
        const c = estado.convites.find((x) => x.convite_id === corpo.p_convite_id);
        estado.convites = estado.convites.filter((x) => x !== c);
        estado.empresas.push({ id: c.empresa_id, nome_publico: c.empresa_nome, cidade: 'Campinas', uf: 'SP', situacao_vitrine: 'rascunho' });
        estado.acesso = { papel: 'funcionario', perfil_nome: c.perfil_nome, permissoes: ['vitrine.visualizar'] };
        return json(200, { membro_id: 'm2', perfil_nome: c.perfil_nome });
      }
      case '/api/rpc/sair_da_empresa':
        estado.acesso = null;
        return json(200, { estado: 'encerrado' });
      case '/api/solicitacoes_publicacao':
        if (url.searchParams.get('estado') === 'eq.aberta') return json(200, estado.fila);
        return json(200, estado.empresas.find((e) => e.id === EMP)?.situacao_vitrine === 'em_analise'
          ? [{ id: 's1', tipo: 'publicacao_inicial', estado: 'aberta', enviada_em: '2026-11-01T12:00:00Z' }] : []);
      case '/api/contestacoes':
      case '/api/eventos_publicacao':
      case '/api/public_empresa_cards':
      case '/api/moderacoes_vitrine':
        return json(200, []);
      case '/api/rpc/criar_empresa': {
        if (corpo.p_dados.cidade === 'X') {
          return json(400, { code: 'P0001', hint: 'VALIDATION_ERROR', message: 'Informe a cidade.', details: 'cidade' });
        }
        const nova = { id: EMP, ...corpo.p_dados, situacao_erp: 'ativa', situacao_vitrine: 'rascunho', versao: 1, dados_publicados: null, criado_em: '2026-11-01T12:00:00Z' };
        estado.empresas.push(nova);
        return json(200, nova);
      }
      case '/api/rpc/enviar_vitrine_para_analise': {
        const e = estado.empresas.find((x) => x.id === corpo.p_empresa_id);
        e.situacao_vitrine = 'em_analise';
        e.versao += 1;
        return json(200, e);
      }
      case '/api/rpc/sou_ck_admin':
        return json(200, ck);
      case '/api/rpc/ck_listar_empresas':
        return ck ? json(200, estado.empresas.map(({ id: i, nome_publico, cidade, uf, situacao_vitrine }) => ({ id: i, nome_publico, cidade, uf, situacao_vitrine })))
          : json(403, { hint: 'FORBIDDEN_ACTION', message: 'Somente a equipe da CK pode ver esta lista.' });
      case '/api/rpc/ck_decidir_solicitacao':
        estado.fila = [];
        return json(200, { situacao_vitrine: 'publicada' });
      default:
        return json(404, {});
    }
  });
  return estado;
}

const empresaBase = (extra = {}) => ({
  id: EMP, nome_publico: 'Doces da Vila', modalidade: 'comercio', categoria_id: CAT, cidade: 'Campinas', uf: 'SP',
  email_contato: 'contato@exemplo.example', situacao_erp: 'ativa', situacao_vitrine: 'rascunho', versao: 1,
  dados_publicados: null, criado_em: '2026-11-01T12:00:00Z', ...extra,
});

test('gestor cadastra empresa: erro do banco aparece ao lado do campo e a empresa nasce em rascunho [simulação]', async ({ page, context }) => {
  await simular(context);
  await page.goto('/business/minhas-empresas.html');
  await expect(page.locator('#empresas')).toContainText('Você ainda não participa de nenhuma empresa.');
  await page.getByRole('button', { name: 'Cadastrar minha primeira empresa' }).click();
  await page.getByRole('button', { name: 'Cadastrar empresa' }).click();
  await expect(page.locator('#nova-nome')).toBeFocused();
  await expect(page.locator('#nova-nome-erro')).toHaveText('Preencha este campo.');
  await page.locator('#nova-nome').fill('Doces da Vila');
  await page.locator('#nova-modalidade').selectOption('comercio');
  await page.locator('#nova-categoria').selectOption(CAT);
  await page.locator('#nova-cidade').fill('X');
  await page.locator('#nova-email').fill('contato@exemplo.example');
  await page.getByRole('button', { name: 'Cadastrar empresa' }).click();
  await expect(page.locator('#nova-cidade-erro')).toHaveText('Informe a cidade.');
  await expect(page.locator('#nova-cidade')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#nova-cidade')).toBeFocused();
  await page.locator('#nova-cidade').fill('Campinas');
  await page.getByRole('button', { name: 'Cadastrar empresa' }).click();
  // E03: o modal confirma e oferece os próximos passos; a lista ao fundo já mostra a empresa nova.
  const modal = page.getByRole('dialog', { name: 'Cadastrar nova empresa' });
  await expect(modal.getByRole('status')).toContainText('Empresa cadastrada');
  await expect(modal.getByRole('link', { name: 'Usar Doces da Vila agora' })).toBeFocused();
  await expect(page.locator('#lista-empresas')).toContainText('Doces da Vila');
  await modal.getByRole('link', { name: 'Completar a vitrine' }).click();
  await expect(page).toHaveURL(/\/business\/empresa\.html\?id=/);
  await expect(page.locator('#avisos')).toContainText('Empresa cadastrada');
  await expect(page.locator('h1')).toHaveText('Doces da Vila');
  await expect(page.locator('#empresa')).toContainText('Sua empresa já pode usar o ERP. A vitrine ainda não foi enviada para análise.');
  await expect(page.locator('#empresa')).toContainText('ERP: ativo');
});

test('gestor envia a vitrine: mensagem de análise e ERP mantido [simulação]', async ({ page, context }) => {
  await simular(context, { empresas: [empresaBase()] });
  await page.goto(`/business/empresa.html?id=${EMP}`);
  await page.getByRole('button', { name: 'Enviar vitrine para análise' }).click();
  await expect(page.locator('#avisos')).toContainText('Vitrine enviada para análise da CK.');
  await expect(page.locator('#empresa')).toContainText('Enquanto isso, o ERP funciona normalmente.');
  await expect(page.getByRole('button', { name: 'Enviar vitrine para análise' })).toHaveCount(0);
  const resultado = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(resultado.violations).toEqual([]);
});

test('conflito de estado atualiza a tela e explica o que mudou [simulação]', async ({ page, context }) => {
  await simular(context, {
    empresas: [empresaBase()],
    erros: { '/api/rpc/enviar_vitrine_para_analise': [{ hint: 'STATE_CONFLICT', message: 'Já existe um envio em análise para esta empresa.' }] },
  });
  await page.goto(`/business/empresa.html?id=${EMP}`);
  await page.getByRole('button', { name: 'Enviar vitrine para análise' }).click();
  await expect(page.locator('#avisos')).toContainText('A situação da sua vitrine mudou. Atualizamos a tela');
  await expect(page.locator('#avisos')).toContainText('Já existe um envio em análise');
});

test('perda de rede: a nova tentativa reaproveita a mesma chave de operação (API-OP-037) [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { empresas: [empresaBase()], erros: { '/api/rpc/enviar_vitrine_para_analise': ['rede'] } });
  await page.goto(`/business/empresa.html?id=${EMP}`);
  await page.getByRole('button', { name: 'Enviar vitrine para análise' }).click();
  await expect(page.locator('#avisos')).toContainText('não será duplicada');
  await page.getByRole('button', { name: 'Enviar vitrine para análise' }).click();
  await expect(page.locator('#avisos')).toContainText('Vitrine enviada para análise da CK.');
  const envios = estado.chaves.filter((c) => c.startsWith('/api/rpc/enviar_vitrine_para_analise'));
  expect(envios).toHaveLength(2);
  expect(envios[0]).toEqual(envios[1]);
});

test('painel CK: conta sem o papel não vê nenhum dado [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { ck: false, empresas: [empresaBase()] });
  await page.goto('/ck-admin/');
  await expect(page.locator('#painel')).toContainText('Esta área é exclusiva da equipe da CK');
  await expect(page.locator('#painel li')).toHaveCount(0);
  expect(estado.chamadas).not.toContain('/api/rpc/ck_listar_empresas');
});

test('painel CK: decisão exige escolha e motivo; aprovação esvazia a fila [simulação]', async ({ page, context }) => {
  await simular(context, {
    ck: true,
    empresas: [empresaBase({ situacao_vitrine: 'em_analise' })],
    fila: [{ id: 's1', empresa_id: EMP, tipo: 'publicacao_inicial', dados_publicos: { nome_publico: 'Doces da Vila', categoria_id: CAT, modalidade: 'comercio', cidade: 'Campinas', uf: 'SP' }, enviada_em: '2026-11-01T12:00:00Z' }],
  });
  await page.goto('/ck-admin/');
  await expect(page.locator('#painel')).toContainText('Fila de análise (1)');
  await expect(page.locator('#painel')).toContainText('Alimentação');
  const botao = page.getByRole('button', { name: 'Registrar decisão' });
  await botao.click();
  await expect(page.locator('[data-grupo="decisao"]').first()).toHaveText('Escolha a decisão.');
  await page.getByLabel('Pedir correção').first().check();
  await botao.click();
  await expect(page.locator('#painel textarea[name="motivo"]').first()).toBeFocused();
  const resultado = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(resultado.violations).toEqual([]);
  await page.getByLabel('Aprovar para publicação').check();
  await botao.click();
  await expect(page.locator('#avisos')).toContainText('Decisão registrada.');
  await expect(page.locator('#painel')).toContainText('Nenhum envio aguardando análise.');
});

test('funcionário vê só o que o perfil permite e pode sair da empresa (D4-4) [simulação]', async ({ page, context }) => {
  const estado = await simular(context, {
    empresas: [empresaBase({ documento: '12345678000199' })],
    acesso: { papel: 'funcionario', perfil_nome: 'Somente consulta', permissoes: ['vitrine.visualizar'] },
  });
  await page.goto(`/business/empresa.html?id=${EMP}`);
  await expect(page.locator('#empresa')).toContainText('Seu acesso: Somente consulta');
  await expect(page.locator('#empresa')).toContainText('Seu perfil de acesso permite consultar, mas não alterar estes dados.');
  await expect(page.getByRole('button', { name: 'Enviar vitrine para análise' })).toHaveCount(0);
  await expect(page.locator('#form-editar')).toHaveCount(0);
  await expect(page.locator('#empresa')).not.toContainText('12345678000199');
  await expect(page.getByRole('link', { name: /Equipe, convites/ })).toHaveCount(0);
  await expect(page.locator('#empresa')).not.toContainText('null');
  expect(estado.chamadas).not.toContain('/api/rpc/empresa_dados_privados');
  const resultado = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(resultado.violations).toEqual([]);
  await page.getByRole('button', { name: 'Sair da empresa' }).click();
  await expect(page.getByRole('dialog')).toContainText('Seu acesso a esta empresa acaba na hora.');
  await page.getByRole('dialog').getByRole('button', { name: 'Sair da empresa' }).click();
  await expect(page).toHaveURL(/minhas-empresas\.html$/);
  await expect(page.locator('#avisos')).toContainText('Você saiu da empresa.');
});

test('sem vínculo ativo, a tela da empresa avisa que o acesso acabou [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { empresas: [empresaBase()] });
  estado.acesso = null;
  await page.goto(`/business/empresa.html?id=${EMP}`);
  await expect(page.getByRole('alert')).toContainText('Você não tem mais acesso a esta empresa.');
  expect(estado.chamadas).not.toContain('/api/empresas');
});

test('proprietário vê dados privados pela função própria e o atalho da equipe [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { empresas: [empresaBase({ documento: '12345678000199', dado_de_teste: true })] });
  await page.goto(`/business/empresa.html?id=${EMP}`);
  await expect(page.locator('#editar-documento')).toHaveValue('12345678000199');
  await expect(page.locator('#empresa')).toContainText('Você é proprietário');
  await expect(page.locator('#empresa')).toContainText('Dado de teste');
  // Pacote 27/11 (item 6): atalhos em cartões com link de verdade.
  await expect(page.getByRole('link', { name: /Equipe e perfis/ })).toHaveAttribute('href', `/business/equipe.html?id=${EMP}`);
  await expect(page.getByRole('button', { name: 'Sair da empresa' })).toHaveCount(0);
  expect(estado.chamadas).toContain('/api/rpc/empresa_dados_privados');
});

test('convite recebido: aceitar coloca a empresa na lista com o perfil (D4-1) [simulação]', async ({ page, context }) => {
  await simular(context, {
    acesso: { papel: 'proprietario', perfil_nome: null, permissoes: TODAS_DA_EMPRESA },
    convites: [{ convite_id: 'cv1', empresa_id: 'e0000000-0000-4000-8000-000000000009', empresa_nome: 'Mercado do Bairro', perfil_nome: 'Estoque', expira_em: '2026-11-08T12:00:00Z' }],
  });
  await page.goto('/business/minhas-empresas.html');
  await expect(page.locator('#empresas')).toContainText('Convites para você');
  await expect(page.locator('#empresas')).toContainText('Perfil de acesso: Estoque');
  await page.getByRole('button', { name: 'Aceitar convite' }).click();
  await expect(page.locator('#avisos')).toContainText('Você agora faz parte da equipe de Mercado do Bairro.');
  await expect(page.locator('#empresas')).not.toContainText('Convites para você');
  await expect(page.getByRole('link', { name: 'Mercado do Bairro' })).toBeVisible();
  await expect(page.locator('#empresas')).toContainText('Seu acesso: Estoque');
});
