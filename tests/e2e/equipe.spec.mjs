/**
 * Tela da equipe (M04, UI-047) com SIMULAÇÃO do contrato da Data API.
 * Comprova a interface (o que aparece, o que fica bloqueado, mensagens,
 * diálogos, chaves de operação e acessibilidade). As regras de verdade são
 * conferidas no banco (tests/db/equipe.test.mjs) e no Neon (verificar:neon:m04).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = '/__neon_simulado';
const EMP = 'e0000000-0000-4000-8000-000000000001';
const AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const MODULOS = {
  empresa: ['Dados da empresa', ['visualizar', 'alterar']],
  vitrine: ['Vitrine', ['visualizar', 'alterar']],
  equipe: ['Equipe', ['visualizar', 'convidar', 'alterar', 'revogar']],
  clientes: ['Clientes', ['visualizar', 'criar', 'alterar', 'exportar']],
  produtos: ['Produtos', ['visualizar', 'criar', 'alterar', 'alterar_preco', 'ver_custo', 'exportar']],
  estoque: ['Estoque', ['visualizar', 'propor', 'aprovar', 'exportar']],
  pedidos: ['Pedidos', ['visualizar', 'aprovar', 'cancelar', 'exportar']],
  vendas: ['Vendas', ['visualizar', 'criar', 'aprovar', 'cancelar', 'aplicar_desconto', 'exportar']],
  orcamentos: ['Orçamentos', ['visualizar', 'criar', 'aprovar', 'cancelar', 'exportar']],
  servicos: ['Ordens de serviço', ['visualizar', 'alterar', 'cancelar']],
  financeiro: ['Financeiro', ['visualizar', 'criar', 'aprovar', 'cancelar', 'fechar', 'exportar']],
  relatorios: ['Relatórios', ['visualizar', 'exportar']],
};
let ordem = 0;
const CATALOGO = Object.entries(MODULOS).flatMap(([modulo, [nome, acoes]]) => acoes.map((acao) => ({
  codigo: `${modulo}.${acao}`, modulo, modulo_nome: nome, acao, acao_nome: acao.replace('_', ' '),
  descricao: `Permite ${acao} em ${nome.toLowerCase()}.`, sensivel: acao === 'exportar', ordem: ++ordem,
})));
const TODAS = CATALOGO.map((p) => p.codigo);

function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}

const perfil = (id, nome, permissoes, versao = 1) => ({ id, nome, descricao: null, versao, perfil_permissoes: permissoes.map((codigo) => ({ codigo })) });
const membro = (id, nome, papel, perfilId, perfilNome, extra = {}) => ({
  membro_id: id, nome, email: `${nome.split(' ')[0].toLowerCase()}@teste.example`, papel, perfil_id: perfilId, perfil_nome: perfilNome,
  estado: 'ativo', desde: '2026-11-01T12:00:00Z', encerrado_em: null, motivo_encerramento: null, versao: 1, eu: false, ...extra,
});

async function simular(context, { acesso, perfis = [], membros = [], convites = [], erros = {} }) {
  const estado = { acesso, perfis: [...perfis], membros: [...membros], convites: [...convites], historico: [], chaves: [], chamadas: [] };
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
      return json(200, { user: { id: 'u1', name: 'Pessoa', email: 'p@teste.example', emailVerified: true } }, { 'set-auth-jwt': jwt('u1') });
    }
    if (corpo?.p_operation_key) estado.chaves.push(`${caminho}:${corpo.p_operation_key}`);
    if (erros[caminho]?.length) {
      const erro = erros[caminho].shift();
      if (erro === 'rede') return rota.abort('failed');
      return json(400, erro);
    }
    const evento = (tipo, detalhes = {}) => estado.historico.unshift({ id: `h${estado.historico.length}`, tipo, ator_nome: 'Pessoa', alvo_nome: null, detalhes, criado_em: '2026-11-01T13:00:00Z' });
    switch (caminho) {
      case '/api/perfis_identidade':
        return json(200, [{ id: 'p1', tipo_conta: 'business', nome: 'Pessoa', criado_em: '2026-11-01T12:00:00Z' }]);
      case '/api/empresas':
        return json(200, [{ id: EMP, nome_publico: 'Doces da Vila', cidade: 'Campinas', uf: 'SP', situacao_vitrine: 'rascunho', versao: 1, dado_de_teste: false }]);
      case '/api/permissoes_catalogo':
        return json(200, CATALOGO);
      case '/api/perfis_permissao':
        return json(200, estado.perfis);
      case '/api/convites_empresa':
        return json(200, estado.convites);
      case '/api/rpc/minhas_permissoes':
        return estado.acesso ? json(200, { membro_id: 'eu', ...estado.acesso }) : json(403, { hint: 'TENANT_FORBIDDEN', message: 'Você não tem acesso a esta empresa.' });
      case '/api/rpc/equipe_membros':
        return json(200, estado.membros);
      case '/api/rpc/equipe_historico':
        return json(200, estado.historico);
      case '/api/rpc/criar_perfil_permissao': {
        const novo = perfil(`pf${estado.perfis.length + 10}`, corpo.p_nome, corpo.p_permissoes);
        estado.perfis.push(novo);
        evento('perfil_criado', { nome: corpo.p_nome });
        return json(200, { id: novo.id, nome: novo.nome, permissoes: corpo.p_permissoes });
      }
      case '/api/rpc/convidar_funcionario': {
        const c = { id: `cv${estado.convites.length + 1}`, email: corpo.p_email.toLowerCase(), perfil_permissao_id: corpo.p_perfil_id, criado_em: '2026-11-01T13:00:00Z', expira_em: '2026-11-08T13:00:00Z' };
        estado.convites.push(c);
        evento('convite_criado', { email: c.email });
        return json(200, { ...c, perfil_nome: estado.perfis.find((p) => p.id === c.perfil_permissao_id)?.nome });
      }
      case '/api/rpc/alterar_perfil_do_membro': {
        const m = estado.membros.find((x) => x.membro_id === corpo.p_membro_id);
        const p = estado.perfis.find((x) => x.id === corpo.p_perfil_id);
        Object.assign(m, { perfil_id: p.id, perfil_nome: p.nome, versao: m.versao + 1 });
        evento('membro_perfil_alterado', { perfil_antes: 'antigo', perfil_depois: p.nome });
        return json(200, { membro_id: m.membro_id, perfil_nome: p.nome });
      }
      case '/api/rpc/desligar_membro': {
        const m = estado.membros.find((x) => x.membro_id === corpo.p_membro_id);
        Object.assign(m, { estado: 'encerrado', encerrado_em: '2026-11-01T14:00:00Z', motivo_encerramento: 'desligado' });
        evento('membro_desligado', { motivo: corpo.p_motivo });
        return json(200, { estado: 'encerrado' });
      }
      default:
        return json(404, {});
    }
  });
  return estado;
}

const dono = { papel: 'proprietario', perfil_id: null, perfil_nome: null, permissoes: TODAS };
const PF_ESTOQUE = perfil('pf1', 'Estoque', ['produtos.visualizar', 'estoque.visualizar', 'estoque.propor']);
const PF_FIN = perfil('pf2', 'Financeiro', ['financeiro.visualizar', 'financeiro.fechar']);

test('proprietário cria perfil a partir do modelo e convida (D4-3, D4-1) [simulação]', async ({ page, context }) => {
  const estado = await simular(context, {
    acesso: dono,
    membros: [membro('m0', 'Pessoa Dona', 'proprietario', null, null, { eu: true })],
  });
  await page.goto(`/business/equipe.html?id=${EMP}`);
  await expect(page.locator('h1')).toHaveText('Equipe de Doces da Vila');
  await expect(page.locator('#equipe')).toContainText('Crie um perfil de acesso antes de convidar alguém.');
  await expect(page.getByRole('tab', { name: /Pessoas/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Criar um perfil de acesso' }).click();
  await expect(page.getByRole('tab', { name: /Perfis de acesso/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#perfil-contador')).toHaveText('0 de 48 permissões escolhidas.');
  await page.getByRole('button', { name: 'Criar perfil' }).click();
  await expect(page.locator('#perfil-nome-erro')).toHaveText('Dê um nome ao perfil (2 a 60 caracteres).');
  await page.getByRole('button', { name: 'Estoque', exact: true }).click();
  await expect(page.locator('#perfil-nome')).toHaveValue('Estoque');
  await expect(page.locator('#perfil-contador')).toHaveText('7 de 48 permissões escolhidas.');
  await expect(page.locator('#perm-estoque-aprovar')).toBeChecked();
  await expect(page.locator('#perm-financeiro-fechar')).not.toBeChecked();
  await expect(page.locator('#nivel-financeiro-nenhum')).toBeChecked();
  // E04: nível por área. "Consultar" marca só as permissões de ver; "Sem acesso" tira todas da área.
  await page.locator('label[for="nivel-vendas-consultar"]').click();
  await expect(page.locator('#perm-vendas-visualizar')).toBeChecked();
  await expect(page.locator('#perm-vendas-criar')).not.toBeChecked();
  await expect(page.locator('#perfil-contador')).toHaveText('8 de 48 permissões escolhidas.');
  await page.locator('label[for="nivel-vendas-nenhum"]').click();
  await expect(page.locator('#perfil-contador')).toHaveText('7 de 48 permissões escolhidas.');
  const resultado = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(resultado.violations).toEqual([]);
  await page.getByRole('button', { name: 'Criar perfil' }).click();
  await expect(page.locator('#avisos')).toContainText('Perfil "Estoque" criado.');
  await expect(page.locator('#equipe')).toContainText('7 permissões · usado por 0 pessoas');
  await page.getByRole('tab', { name: /Pessoas/ }).click();
  await page.getByRole('button', { name: 'Adicionar colaborador' }).click();
  await page.locator('#convite-email').fill('Eva@Teste.example');
  await page.locator('#convite-perfil').selectOption({ label: 'Estoque (7 permissões)' });
  await expect(page.locator('#convite-resumo')).toContainText('Com o perfil "Estoque", a pessoa poderá');
  await page.getByRole('button', { name: 'Criar convite' }).click();
  await expect(page.locator('#avisos')).toContainText('Avise a pessoa para entrar no AutoniCK com o e-mail eva@teste.example');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#equipe')).toContainText('Convites aguardando resposta (1)');
  await expect(page.locator('#equipe')).toContainText('Convite criado');
  expect(estado.chamadas).toContain('/api/rpc/convidar_funcionario');
});

test('proprietário troca perfil e encerra acesso com confirmação; histórico preservado (FCT-015) [simulação]', async ({ page, context }) => {
  await simular(context, {
    acesso: dono,
    perfis: [PF_ESTOQUE, PF_FIN],
    membros: [membro('m0', 'Pessoa Dona', 'proprietario', null, null, { eu: true }), membro('m1', 'Eva Estoque', 'funcionario', 'pf1', 'Estoque')],
  });
  await page.goto(`/business/equipe.html?id=${EMP}`);
  await expect(page.locator('#equipe')).toContainText('Pessoas com acesso (2)');
  await expect(page.locator('[data-membro="m0"]')).toContainText('Este é você.');
  await page.getByText('Gerenciar acesso de Eva Estoque').click();
  await page.locator('#trocar-m1').selectOption('pf2');
  await page.getByRole('button', { name: 'Trocar perfil' }).click();
  await expect(page.locator('#avisos')).toContainText('Perfil de Eva Estoque trocado para Financeiro.');
  await page.getByText('Gerenciar acesso de Eva Estoque').click();
  await page.locator('#motivo-m1').fill('Fim do contrato de teste');
  await page.getByRole('button', { name: 'Encerrar acesso' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toContainText('O acesso a esta empresa acaba na hora');
  await dialogo.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.locator('#equipe')).toContainText('Pessoas com acesso (2)');
  await page.getByRole('button', { name: 'Encerrar acesso' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Encerrar acesso' }).click();
  await expect(page.locator('#avisos')).toContainText('Acesso encerrado. O histórico do que Eva Estoque fez continua registrado.');
  await expect(page.locator('#equipe')).toContainText('Pessoas com acesso (1)');
  await expect(page.locator('#equipe')).toContainText('Ex-funcionários (1)');
  await expect(page.locator('#equipe')).toContainText('Motivo: Fim do contrato de teste');
});

test('gestor designado: não concede o que não tem nem mexe em quem tem mais (D4-2) [simulação]', async ({ page, context }) => {
  const gerente = perfil('pf3', 'Gerente', TODAS.filter((c) => c !== 'financeiro.fechar'));
  await simular(context, {
    acesso: { papel: 'funcionario', perfil_id: 'pf3', perfil_nome: 'Gerente', permissoes: TODAS.filter((c) => c !== 'financeiro.fechar') },
    perfis: [PF_ESTOQUE, PF_FIN, gerente],
    membros: [
      membro('m0', 'Olga Dona', 'proprietario', null, null),
      membro('m3', 'Gil Gerente', 'funcionario', 'pf3', 'Gerente', { eu: true }),
      membro('m4', 'Fátima Financeiro', 'funcionario', 'pf2', 'Financeiro'),
      membro('m1', 'Eva Estoque', 'funcionario', 'pf1', 'Estoque'),
    ],
  });
  await page.goto(`/business/equipe.html?id=${EMP}`);
  await expect(page.locator('#perm-financeiro-fechar')).toBeDisabled();
  await expect(page.locator('#perm-financeiro-fechar-desc')).toContainText('Você não tem esta permissão');
  await expect(page.locator('[data-membro="m0"]')).toContainText('O acesso do proprietário não pode ser alterado');
  await expect(page.locator('[data-membro="m3"]')).toContainText('Este é você.');
  await expect(page.locator('[data-membro="m4"]')).toContainText('Esta pessoa tem permissões que você não tem.');
  await expect(page.locator('[data-membro="m4"] details')).toHaveCount(0);
  await expect(page.locator('#equipe')).toContainText('Este é o seu perfil.');
  await expect(page.locator('#equipe')).toContainText('Este perfil tem permissões que você não tem; você não pode alterá-lo.');
  await page.getByRole('button', { name: 'Adicionar colaborador' }).click();
  const opcoes = await page.locator('#convite-perfil option').allTextContents();
  expect(opcoes.some((o) => o.startsWith('Financeiro'))).toBe(false);
  expect(opcoes.some((o) => o.startsWith('Estoque'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: /Perfis de acesso/ }).click();
  await page.getByRole('button', { name: 'Gerente', exact: true }).click();
  await expect(page.locator('#avisos')).toContainText('Modelo "Gerente" aplicado.');
  await expect(page.locator('#perfil-contador')).toHaveText('47 de 48 permissões escolhidas.');
  const resultado = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(resultado.violations).toEqual([]);
});

test('recusa do banco (permissão retirada no meio) atualiza a tela e explica [simulação]', async ({ page, context }) => {
  const estado = await simular(context, {
    acesso: dono,
    perfis: [PF_ESTOQUE],
    membros: [membro('m0', 'Pessoa Dona', 'proprietario', null, null, { eu: true })],
    erros: { '/api/rpc/convidar_funcionario': [{ hint: 'FORBIDDEN_ACTION', message: 'Seu acesso não permite esta ação nesta empresa.' }] },
  });
  await page.goto(`/business/equipe.html?id=${EMP}`);
  await page.getByRole('button', { name: 'Adicionar colaborador' }).click();
  await page.locator('#convite-email').fill('novo@teste.example');
  await page.locator('#convite-perfil').selectOption('pf1');
  estado.acesso = { papel: 'funcionario', perfil_id: 'pf1', perfil_nome: 'Estoque', permissoes: ['produtos.visualizar', 'estoque.visualizar', 'estoque.propor'] };
  await page.getByRole('button', { name: 'Criar convite' }).click();
  await expect(page.locator('#avisos')).toContainText('Seu acesso não permite esta ação nesta empresa.');
  await expect(page.locator('#equipe')).toContainText('Seu perfil de acesso não inclui a equipe desta empresa.');
  await expect(page.locator('#form-convite')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('perda de rede no convite: a nova tentativa reaproveita a chave; erro do banco vai ao campo [simulação]', async ({ page, context }) => {
  const estado = await simular(context, {
    acesso: dono,
    perfis: [PF_ESTOQUE],
    membros: [membro('m0', 'Pessoa Dona', 'proprietario', null, null, { eu: true })],
    erros: { '/api/rpc/convidar_funcionario': [{ hint: 'STATE_CONFLICT', message: 'Essa pessoa já faz parte da equipe.' }, 'rede'] },
  });
  await page.goto(`/business/equipe.html?id=${EMP}`);
  await page.getByRole('button', { name: 'Adicionar colaborador' }).click();
  await page.locator('#convite-email').fill('dona@teste.example');
  await page.locator('#convite-perfil').selectOption('pf1');
  await page.getByRole('button', { name: 'Criar convite' }).click();
  await expect(page.locator('#avisos')).toContainText('Essa pessoa já faz parte da equipe.');
  await expect(page.getByRole('dialog')).toContainText('Essa pessoa já faz parte da equipe.');
  await page.locator('#convite-email').fill('nova@teste.example');
  await page.locator('#convite-perfil').selectOption('pf1');
  await page.getByRole('button', { name: 'Criar convite' }).click();
  await expect(page.locator('#avisos')).toContainText('não será duplicada');
  await page.getByRole('button', { name: 'Criar convite' }).click();
  await expect(page.locator('#avisos')).toContainText('Convite criado.');
  const envios = estado.chaves.filter((c) => c.startsWith('/api/rpc/convidar_funcionario'));
  expect(envios).toHaveLength(3);
  expect(envios[0]).not.toEqual(envios[1]);
  expect(envios[1]).toEqual(envios[2]);
});

test('funcionário sem permissão de equipe e pessoa desligada não veem a equipe [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { acesso: { papel: 'funcionario', perfil_id: 'pf1', perfil_nome: 'Estoque', permissoes: ['estoque.visualizar'] } });
  await page.goto(`/business/equipe.html?id=${EMP}`);
  await expect(page.getByRole('alert')).toContainText('Seu perfil de acesso não inclui a equipe desta empresa.');
  expect(estado.chamadas).not.toContain('/api/rpc/equipe_membros');
  estado.acesso = null;
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Você não tem mais acesso a esta empresa.');
});
