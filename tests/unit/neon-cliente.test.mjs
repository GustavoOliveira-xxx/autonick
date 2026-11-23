/**
 * Testes do cliente HTTP do Neon (M02) com fetch simulado.
 * Verificam contrato de chamadas, credenciais, cache do JWT em memória
 * e mensagens neutras. Não substituem testes contra o serviço real.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClienteNeon, ErroNeon, expiracaoDoJwt } from '../../public/js/data/neon-cliente.js';

const AUTH = 'https://auth.exemplo.test/neondb/auth/';
const API = 'https://api.exemplo.test/neondb/rest/v1';

function jwt(expSegundos) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub: 'u1', role: 'authenticated', exp: expSegundos })}.assinatura`;
}

function resposta(status, corpo, cabecalhos = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => cabecalhos[n.toLowerCase()] ?? null },
    json: async () => corpo,
  };
}

function falso(roteiro) {
  const chamadas = [];
  const fetch = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    const passo = roteiro.shift();
    if (!passo) throw new Error(`chamada inesperada: ${url}`);
    if (passo === 'rede') throw new TypeError('Failed to fetch');
    return passo(url, opcoes);
  };
  return { fetch, chamadas };
}

test('sem configuração, nenhuma chamada é feita e o erro é NAO_CONFIGURADO', async () => {
  const { fetch, chamadas } = falso([]);
  const c = new ClienteNeon({ authUrl: null, dataApiUrl: null, fetch });
  assert.equal(c.configurado, false);
  await assert.rejects(c.entrar({ email: 'a@b.example', senha: '12345678' }), (e) => e instanceof ErroNeon && e.codigo === 'NAO_CONFIGURADO');
  await c.sair();
  assert.equal(chamadas.length, 0);
});

test('entrar usa POST /sign-in/email com cookie (credentials include) e corpo JSON', async () => {
  const { fetch, chamadas } = falso([() => resposta(200, {})]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch });
  await c.entrar({ email: 'pessoa@exemplo.example', senha: 'segredo123' });
  assert.equal(chamadas[0].url, 'https://auth.exemplo.test/neondb/auth/sign-in/email');
  assert.equal(chamadas[0].opcoes.method, 'POST');
  assert.equal(chamadas[0].opcoes.credentials, 'include');
  assert.deepEqual(JSON.parse(chamadas[0].opcoes.body), { email: 'pessoa@exemplo.example', password: 'segredo123' });
});

test('falha de login tem mensagem neutra, sem revelar se o e-mail existe (SEC-T22)', async () => {
  for (const status of [400, 401, 422]) {
    const { fetch } = falso([() => resposta(status, { message: 'User not found' })]);
    const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch });
    await assert.rejects(c.entrar({ email: 'x@y.example', senha: 'abcdefgh' }), { message: 'E-mail ou senha incorretos.' });
  }
});

test('cadastro recusado não confirma que o e-mail já existe', async () => {
  const { fetch } = falso([() => resposta(422, { message: 'User already exists' })]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch });
  await assert.rejects(c.cadastrar({ nome: 'A', email: 'x@y.example', senha: 'abcdefgh' }), (e) => /Se você já tem conta/.test(e.message) && !/exists/.test(e.message));
});

test('erros de rede e de serviço viram códigos do API-001', async () => {
  const c1 = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch: falso(['rede']).fetch });
  await assert.rejects(c1.entrar({ email: 'a@b.example', senha: 'abcdefgh' }), { codigo: 'NETWORK_UNKNOWN' });
  const c2 = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch: falso([() => resposta(503, {})]).fetch });
  await assert.rejects(c2.entrar({ email: 'a@b.example', senha: 'abcdefgh' }), { codigo: 'PROVIDER_UNAVAILABLE' });
  const c3 = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch: falso([() => resposta(429, {})]).fetch });
  await assert.rejects(c3.entrar({ email: 'a@b.example', senha: 'abcdefgh' }), { codigo: 'RATE_LIMITED' });
});

test('sessão lê o JWT do cabeçalho set-auth-jwt e o reaproveita enquanto válido', async () => {
  const agora = 1_800_000_000_000;
  const token = jwt(agora / 1000 + 900);
  const { fetch, chamadas } = falso([
    () => resposta(200, { user: { id: 'u1', name: 'Pessoa', email: 'p@e.example', emailVerified: true } }, { 'set-auth-jwt': token }),
    () => resposta(200, [{ id: 'p1', tipo_conta: 'cliente' }]),
    () => resposta(200, [{ id: 'p1', tipo_conta: 'cliente' }]),
  ]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora });
  const s = await c.sessao();
  assert.deepEqual(s.usuario, { id: 'u1', nome: 'Pessoa', email: 'p@e.example', emailVerificado: true });
  await c.meusPerfis();
  await c.meusPerfis();
  assert.equal(chamadas.length, 3, 'não pede nova sessão enquanto o token é válido');
  assert.equal(chamadas[1].opcoes.headers.Authorization, `Bearer ${token}`);
  assert.match(chamadas[1].url, /\/perfis_identidade\?select=/);
});

test('token perto de expirar é renovado pela sessão', async () => {
  const agora = 1_800_000_000_000;
  const velho = jwt(agora / 1000 + 10);
  const novo = jwt(agora / 1000 + 900);
  const usuario = { user: { id: 'u1', name: 'P', email: 'p@e.example' } };
  const { fetch, chamadas } = falso([
    () => resposta(200, usuario, { 'set-auth-jwt': velho }),
    () => resposta(200, usuario, { 'set-auth-jwt': novo }),
    () => resposta(200, []),
  ]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora });
  await c.sessao();
  await c.meusPerfis();
  assert.equal(chamadas[2].opcoes.headers.Authorization, `Bearer ${novo}`);
});

test('sem sessão, consultas à Data API exigem login (AUTH_REQUIRED)', async () => {
  const { fetch } = falso([() => resposta(200, null)]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch });
  await assert.rejects(c.meusPerfis(), { codigo: 'AUTH_REQUIRED' });
});

test('400 da Data API por JWT inválido é tratado como sessão expirada', async () => {
  const agora = 1_800_000_000_000;
  const { fetch } = falso([
    () => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example' } }, { 'set-auth-jwt': jwt(agora / 1000 + 900) }),
    () => resposta(400, { message: 'Provided authentication token is not a valid JWT encoding' }),
  ]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora });
  await assert.rejects(c.meusPerfis(), { codigo: 'AUTH_REQUIRED' });
});

test('login de e-mail não verificado vira EMAIL_NAO_VERIFICADO (403 do Auth)', async () => {
  const { fetch } = falso([() => resposta(403, { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' })]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch });
  await assert.rejects(c.entrar({ email: 'p@e.example', senha: 'abcdefgh' }), { codigo: 'EMAIL_NAO_VERIFICADO' });
});

test('cadastro informa se o e-mail já está verificado', async () => {
  const { fetch } = falso([() => resposta(200, { user: { id: 'u1', emailVerified: false } })]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch });
  assert.deepEqual(await c.cadastrar({ nome: 'P', email: 'p@e.example', senha: 'abcdefgh' }), { emailVerificado: false });
});

test('verificação por código usa os endpoints de e-mail OTP e trata código errado', async () => {
  const { fetch, chamadas } = falso([
    () => resposta(200, { success: true }),
    () => resposta(400, { message: 'Invalid OTP' }),
    () => resposta(200, { status: true }),
  ]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch });
  await c.enviarCodigoDeVerificacao('p@e.example');
  assert.match(chamadas[0].url, /\/email-otp\/send-verification-otp$/);
  assert.deepEqual(JSON.parse(chamadas[0].opcoes.body), { email: 'p@e.example', type: 'email-verification' });
  await assert.rejects(c.verificarEmail({ email: 'p@e.example', codigo: '000000' }), (e) => /Código incorreto/.test(e.message));
  await c.verificarEmail({ email: 'p@e.example', codigo: '123456' });
  assert.match(chamadas[2].url, /\/email-otp\/verify-email$/);
  assert.deepEqual(JSON.parse(chamadas[2].opcoes.body), { email: 'p@e.example', otp: '123456' });
});

test('garantirPerfil chama a RPC com parâmetros nomeados e pede objeto único', async () => {
  const agora = 1_800_000_000_000;
  const { fetch, chamadas } = falso([
    () => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example' } }, { 'set-auth-jwt': jwt(agora / 1000 + 900) }),
    () => resposta(200, { id: 'p9', tipo_conta: 'business', nome: 'Loja' }),
  ]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora });
  const perfil = await c.garantirPerfil('business', 'Loja');
  assert.equal(perfil.id, 'p9');
  assert.equal(chamadas[1].url, `${API}/rpc/garantir_perfil`);
  assert.equal(chamadas[1].opcoes.method, 'POST');
  assert.equal(chamadas[1].opcoes.headers.Accept, 'application/vnd.pgrst.object+json');
  assert.deepEqual(JSON.parse(chamadas[1].opcoes.body), { p_tipo_conta: 'business', p_nome: 'Loja' });
});

test('sair descarta o token mesmo se o serviço falhar', async () => {
  const agora = 1_800_000_000_000;
  const { fetch, chamadas } = falso([
    () => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example' } }, { 'set-auth-jwt': jwt(agora / 1000 + 900) }),
    'rede',
    () => resposta(200, null),
  ]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora });
  await c.sessao();
  await assert.rejects(c.sair());
  await assert.rejects(c.meusPerfis(), { codigo: 'AUTH_REQUIRED' });
  assert.match(chamadas[2].url, /get-session$/);
});

test('pedido de código para nova senha usa o fluxo por código e não revela se o e-mail existe', async () => {
  const { fetch, chamadas } = falso([() => resposta(400, { message: 'User not found' })]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch });
  await c.pedirRedefinicaoDeSenha({ email: 'x@y.example' });
  assert.match(chamadas[0].url, /\/email-otp\/request-password-reset$/);
  assert.deepEqual(JSON.parse(chamadas[0].opcoes.body), { email: 'x@y.example' });
});

test('redefinição com código: envia e-mail, código e nova senha; código errado tem mensagem clara', async () => {
  const ok = falso([() => resposta(200, { success: true }), () => resposta(200, {}), () => resposta(200, {}), () => resposta(200, {})]);
  const r = await new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch: ok.fetch }).redefinirSenhaComCodigo({ email: 'x@y.example', codigo: '123456', novaSenha: 'nova-senha-1' });
  assert.deepEqual(r, { sessoesEncerradas: true });
  assert.deepEqual(ok.chamadas.map((c) => new URL(c.url).pathname.replace(/^.*\/auth/, '')), ['/email-otp/reset-password', '/sign-in/email', '/revoke-other-sessions', '/sign-out']);
  const semEncerrar = falso([() => resposta(200, { success: true }), () => resposta(429, {})]);
  assert.deepEqual(await new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch: semEncerrar.fetch }).redefinirSenhaComCodigo({ email: 'x@y.example', codigo: '123456', novaSenha: 'nova-senha-1' }), { sessoesEncerradas: false });
  assert.deepEqual(JSON.parse(ok.chamadas[0].opcoes.body), { email: 'x@y.example', otp: '123456', password: 'nova-senha-1' });
  const errado = falso([() => resposta(400, { message: 'Invalid OTP' })]);
  await assert.rejects(new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch: errado.fetch }).redefinirSenhaComCodigo({ email: 'x@y.example', codigo: '000000', novaSenha: 'nova-senha-1' }),
    { message: 'Código incorreto ou expirado. Confira o código ou peça um novo.' });
  const curta = falso([]);
  await assert.rejects(new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch: curta.fetch }).redefinirSenhaComCodigo({ email: 'x@y.example', codigo: '1', novaSenha: '123' }), { codigo: 'SENHA_FRACA' });
  assert.equal(curta.chamadas.length, 0);
});

test('troca de senha com sessão: encerra as outras sessões por padrão e explica senha atual errada', async () => {
  const ok = falso([() => resposta(200, { token: 'novo' })]);
  await new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch: ok.fetch }).trocarSenha({ atual: 'antiga-123', nova: 'nova-senha-1' });
  assert.match(ok.chamadas[0].url, /\/change-password$/);
  assert.equal(ok.chamadas[0].opcoes.credentials, 'include');
  assert.deepEqual(JSON.parse(ok.chamadas[0].opcoes.body), { currentPassword: 'antiga-123', newPassword: 'nova-senha-1', revokeOtherSessions: true });
  const errada = falso([() => resposta(400, { message: 'Invalid password' })]);
  await assert.rejects(new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch: errada.fetch }).trocarSenha({ atual: 'x', nova: 'nova-senha-1' }), { codigo: 'SENHA_ATUAL_INCORRETA' });
});

test('o cliente não usa localStorage nem sessionStorage para tokens', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../../public/js/data/neon-cliente.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /\b(?:localStorage|sessionStorage)\s*[.[]|document\.cookie/);
});

test('expiracaoDoJwt tolera tokens malformados', () => {
  assert.equal(expiracaoDoJwt('lixo'), 0);
  assert.equal(expiracaoDoJwt(jwt(100)), 100_000);
});

test('configuração pública não contém credenciais', async () => {
  const { CONFIG_PUBLICA } = await import('../../public/js/config/public-config.js');
  for (const valor of Object.values(CONFIG_PUBLICA)) {
    if (typeof valor === 'string') assert.doesNotMatch(valor, /postgres|npg_|password|@/i);
  }
  assert.ok(Object.isFrozen(CONFIG_PUBLICA));
});

test('D-07: garantirPerfil repete UMA vez um 403 transitório (RPC idempotente)', async () => {
  const agora = 1_800_000_000_000;
  const sessao = () => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example' } }, { 'set-auth-jwt': jwt(agora / 1000 + 900) });
  const perfil = { id: 'p1', tipo_conta: 'cliente', nome: 'P' };
  const esperas = [];
  const { fetch, chamadas } = falso([sessao, () => resposta(403, { code: '42501' }), () => resposta(200, perfil)]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora, esperar: async (ms) => esperas.push(ms) });
  assert.deepEqual(await c.garantirPerfil('cliente', 'P'), perfil);
  assert.equal(chamadas.filter((x) => x.url.endsWith('/rpc/garantir_perfil')).length, 2);
  assert.deepEqual(esperas, [400]);
});

test('D-07: ocorrência registrada com contexto, sem token nem corpo (P-M08-07)', async () => {
  const { registroD07 } = await import('../../public/js/data/neon-cliente.js');
  registroD07.length = 0;
  const agora = 1_800_000_000_000;
  const sessao = () => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example' } }, { 'set-auth-jwt': jwt(agora / 1000 + 900) });
  const vazia = () => resposta(400, { code: '28000', hint: 'AUTH_REQUIRED', message: 'Sessão ausente ou expirada.' });
  const { fetch } = falso([sessao, vazia, sessao, () => resposta(200, [])]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora, esperar: async () => {} });
  await c.consultar('/empresas?select=id&id=eq.123');
  assert.equal(registroD07.length, 1);
  const r = registroD07[0];
  assert.equal(r.caminho, '/empresas');
  assert.equal(r.tipo, 'identidade_vazia');
  assert.equal(r.em_andamento, 1);
  assert.equal(r.ordem_na_sessao, 1);
  assert.equal(r.primeira_com_token, true);
  assert.equal(r.repeticao, 'sucesso');
  assert.doesNotMatch(JSON.stringify(registroD07), /eyJ|Bearer|p@e\.example|123/);
  assert.equal(globalThis.autonickDiagnostico.d07, registroD07);
});

test('D-07: negação que se repete continua negada, sem terceira tentativa', async () => {
  const agora = 1_800_000_000_000;
  const sessao = () => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example' } }, { 'set-auth-jwt': jwt(agora / 1000 + 900) });
  const { fetch, chamadas } = falso([sessao, () => resposta(403, {}), () => resposta(403, {})]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora, esperar: async () => {} });
  await assert.rejects(c.garantirPerfil('cliente', 'P'), { codigo: 'FORBIDDEN_ACTION' });
  assert.equal(chamadas.length, 3);
});

test('D-07: 403 sem código de regra também é repetido uma vez em consultas', async () => {
  const agora = 1_800_000_000_000;
  const sessao = () => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example' } }, { 'set-auth-jwt': jwt(agora / 1000 + 900) });
  const { fetch, chamadas } = falso([sessao, () => resposta(403, { code: '42501' }), () => resposta(200, [])]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora, esperar: async () => {} });
  assert.deepEqual(await c.meusPerfis(), []);
  assert.equal(chamadas.length, 3);
});

test('D-07: negação de regra do banco (com hint) nunca é repetida', async () => {
  const agora = 1_800_000_000_000;
  const sessao = () => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example' } }, { 'set-auth-jwt': jwt(agora / 1000 + 900) });
  const { fetch, chamadas } = falso([sessao, () => resposta(403, { hint: 'FORBIDDEN_ACTION', message: 'Somente a equipe da CK pode ver esta lista.' })]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora, esperar: async () => {} });
  await assert.rejects(c.rpc('ck_listar_empresas'), { codigo: 'FORBIDDEN_ACTION', message: 'Somente a equipe da CK pode ver esta lista.' });
  assert.equal(chamadas.length, 2);
});

test('D-07: outros erros não são repetidos', async () => {
  const agora = 1_800_000_000_000;
  const sessao = () => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example' } }, { 'set-auth-jwt': jwt(agora / 1000 + 900) });
  const c1 = falso([sessao, () => resposta(400, { message: 'invalid input value for enum' })]);
  await assert.rejects(new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch: c1.fetch, agora: () => agora, esperar: async () => {} }).garantirPerfil('ck_admin', 'P'), { codigo: 'VALIDATION_ERROR' });
  assert.equal(c1.chamadas.length, 2);
  const c2 = falso([sessao, () => resposta(429, {})]);
  await assert.rejects(new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch: c2.fetch, agora: () => agora, esperar: async () => {} }).meusPerfis(), { codigo: 'RATE_LIMITED' });
  assert.equal(c2.chamadas.length, 2);
});

test('M03: erro de regra do banco usa o código do hint, a mensagem em português e o campo', async () => {
  const agora = 1_800_000_000_000;
  const sessao = () => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example' } }, { 'set-auth-jwt': jwt(agora / 1000 + 900) });
  const { fetch, chamadas } = falso([sessao, () => resposta(400, { code: 'P0001', hint: 'VALIDATION_ERROR', message: 'Informe a cidade.', details: 'cidade' })]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora });
  await assert.rejects(c.rpc('criar_empresa', { p_dados: {} }), (e) => e.codigo === 'VALIDATION_ERROR' && e.message === 'Informe a cidade.' && e.campo === 'cidade');
  assert.equal(chamadas[1].url, `${API}/rpc/criar_empresa`);
  assert.equal(chamadas[1].opcoes.method, 'POST');
});

test('M03: conflitos e negações vindos do banco mantêm o código do API-001', async () => {
  const agora = 1_800_000_000_000;
  const sessao = () => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example' } }, { 'set-auth-jwt': jwt(agora / 1000 + 900) });
  for (const [status, hint] of [[400, 'STATE_CONFLICT'], [400, 'VERSION_CONFLICT'], [400, 'IDEMPOTENCY_CONFLICT'], [403, 'TENANT_FORBIDDEN']]) {
    const { fetch } = falso([sessao, () => resposta(status, { hint, message: 'Mensagem do banco.' })]);
    const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora });
    await assert.rejects(c.rpc('qualquer'), { codigo: hint, message: 'Mensagem do banco.' });
  }
  // Hint desconhecido não é confiado: vale o código pelo status (e o 403 se repete uma vez, D-07).
  const negado = () => resposta(403, { hint: 'OUTRA_COISA', message: 'permission denied for table empresas' });
  const { fetch } = falso([sessao, negado, negado]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora, esperar: async () => {} });
  await assert.rejects(c.consultar('/empresas'), { codigo: 'FORBIDDEN_ACTION', message: 'Seu perfil não permite esta ação.' });
});

test('D-07: "sessão ausente" vinda do banco com token válido renova o token e repete uma vez', async () => {
  const agora = 1_800_000_000_000;
  const sessao = () => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example' } }, { 'set-auth-jwt': jwt(agora / 1000 + 900) });
  const perfil = { id: 'p1', tipo_conta: 'business', nome: 'P' };
  const { fetch, chamadas } = falso([sessao, () => resposta(403, { code: '42501', hint: 'AUTH_REQUIRED', message: 'Sessão ausente.' }), sessao, () => resposta(200, perfil)]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora, esperar: async () => {} });
  assert.deepEqual(await c.garantirPerfil('business', 'P'), perfil);
  assert.deepEqual(chamadas.map((x) => new URL(x.url).pathname.split('/').pop()), ['get-session', 'garantir_perfil', 'get-session', 'garantir_perfil']);
});

test('D-07: "sessão ausente" que se repete chega à tela como sessão encerrada', async () => {
  const agora = 1_800_000_000_000;
  const sessao = () => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example' } }, { 'set-auth-jwt': jwt(agora / 1000 + 900) });
  const vazia = () => resposta(403, { hint: 'AUTH_REQUIRED', message: 'Sessão ausente.' });
  const { fetch, chamadas } = falso([sessao, vazia, sessao, vazia]);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora, esperar: async () => {} });
  await assert.rejects(c.garantirPerfil('business', 'P'), { codigo: 'AUTH_REQUIRED' });
  assert.equal(chamadas.length, 4);
});

test('D6-12: no máximo 2 requisições simultâneas à Data API; as demais esperam na ordem e todas terminam', async () => {
  let ativas = 0;
  let pico = 0;
  const ordem = [];
  const liberar = [];
  const fetch = async (url) => {
    if (url.endsWith('/get-session')) return resposta(200, { user: { id: 'u1' } }, { 'set-auth-jwt': jwt(Math.floor(Date.now() / 1000) + 900) });
    ativas += 1;
    pico = Math.max(pico, ativas);
    ordem.push(url.split('/').pop());
    await new Promise((r) => liberar.push(r));
    ativas -= 1;
    return resposta(200, { ok: url.split('/').pop() });
  };
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch });
  await c.sessao();
  const pedidos = ['a', 'b', 'c', 'd', 'e'].map((n) => c.rpc(n));
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(ativas <= 2, `ativas: ${ativas}`);
    liberar.shift()?.();
  }
  const r = await Promise.all(pedidos);
  assert.deepEqual(r.map((x) => x.ok), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(ordem, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(pico, 2);
  assert.equal(c.picoSimultaneas, 2);
});

test('D6-12: uma requisição que falha libera a vaga (a fila não trava)', async () => {
  const roteiro = [];
  const fetch = async (url) => {
    if (url.endsWith('/get-session')) return resposta(200, { user: { id: 'u1' } }, { 'set-auth-jwt': jwt(Math.floor(Date.now() / 1000) + 900) });
    roteiro.push(url);
    if (url.endsWith('/falha')) throw new TypeError('Failed to fetch');
    return resposta(200, { ok: true });
  };
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch });
  const resultados = await Promise.allSettled([c.rpc('falha'), c.rpc('falha'), c.rpc('falha'), c.rpc('ok')]);
  assert.equal(resultados.filter((x) => x.status === 'rejected').length, 3);
  assert.equal(resultados[3].status, 'fulfilled');
});

test('códigos novos do M06 chegam com a mensagem do banco', async () => {
  const fetch = async (url) => {
    if (url.endsWith('/get-session')) return resposta(200, { user: { id: 'u1' } }, { 'set-auth-jwt': jwt(Math.floor(Date.now() / 1000) + 900) });
    return resposta(400, { hint: 'DISCOUNT_EXCEEDS_LIMIT', message: 'O desconto passa do seu limite de 10%.', details: 'desconto' });
  };
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch });
  await assert.rejects(c.rpc('criar_venda'), (e) => e.codigo === 'DISCOUNT_EXCEEDS_LIMIT' && /10%/.test(e.message) && e.campo === 'desconto');
});

test('M13 (D13-06): sem conexão nada sai; envio diz "Nada foi enviado" e leitura diz que não carregou', async () => {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try {
    const { fetch, chamadas } = falso([]);
    const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch });
    await assert.rejects(c.rpc('criar_venda', { p_empresa_id: 'e1', p_operation_key: 'k1' }),
      (e) => e.codigo === 'NETWORK_UNKNOWN' && e.naoEnviado === true && e.message === 'Sem conexão. Nada foi enviado.');
    await assert.rejects(c.rpc('conversa_atendimento', { p_tipo: 'os', p_id: 'x' }),
      (e) => e.codigo === 'NETWORK_UNKNOWN' && e.message === 'Sem conexão. Não foi possível carregar as informações agora.');
    await assert.rejects(c.entrar({ email: 'a@b.example', senha: 'abcdefgh' }), (e) => e.message === 'Sem conexão. Nada foi enviado.');
    assert.equal(chamadas.length, 0, 'nenhuma requisição sem conexão');
  } finally {
    if (anterior) Object.defineProperty(globalThis, 'navigator', anterior); else delete globalThis.navigator;
  }
});

test('M13 (D13-06): resposta perdida depois do envio não vira sucesso; a mensagem pede para conferir antes de repetir', async () => {
  const agora = 1_800_000_000_000;
  const token = jwt(agora / 1000 + 900);
  const { fetch } = falso([() => resposta(200, { user: { id: 'u1', name: 'P', email: 'p@e.example', emailVerified: true } }, { 'set-auth-jwt': token }), 'rede', 'rede']);
  const c = new ClienteNeon({ authUrl: AUTH, dataApiUrl: API, fetch, agora: () => agora });
  await c.sessao();
  await assert.rejects(c.rpc('criar_venda', { p_empresa_id: 'e1', p_operation_key: 'k1' }),
    (e) => e.codigo === 'NETWORK_UNKNOWN' && !e.naoEnviado && /Não conseguimos confirmar se a operação foi registrada/.test(e.message)
      && /Repetir pelo mesmo botão não duplica/.test(e.message));
  await assert.rejects(c.rpc('conversa_atendimento', { p_tipo: 'os', p_id: 'x' }),
    (e) => e.message === 'Não conseguimos falar com o servidor. Verifique sua conexão.');
});
