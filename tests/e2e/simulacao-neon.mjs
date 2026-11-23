/**
 * Simulação do contrato HTTP do Neon Managed Better Auth e da Data API (mesma origem, via rotas do Playwright),
 * ajustada ao comportamento observado no Neon real em 01/11/2026. Comprova a interface, NÃO a integração real.
 * Compartilhada pelos testes de entrada (autenticacao.spec.mjs) e do S-01 (formularios-protegidos.spec.mjs).
 */
export const BASE = '/__neon_simulado';

function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}

/** Simulação mínima: usuários, sessão e perfis em memória do teste. */
export async function simularNeon(context, { usuarios = [], perfis = [], exigirVerificacao = false } = {}) {
  const estado = { usuarios: [...usuarios], perfis: [...perfis], sessao: null, chamadas: [], codigos: [], envios: [] };
  await context.route('**/js/config/public-config.js', (rota) => rota.fulfill({
    contentType: 'text/javascript',
    body: `export const CONFIG_PUBLICA = Object.freeze({ ambiente: 'teste', neonAuthUrl: '${BASE}/auth', neonDataApiUrl: '${BASE}/api' });`,
  }));
  await context.route(`**${BASE}/**`, async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(BASE, '');
    const corpo = req.postData() ? JSON.parse(req.postData()) : null;
    estado.chamadas.push(caminho);
    const json = (status, dados, cabecalhos = {}) => rota.fulfill({ status, contentType: 'application/json', headers: cabecalhos, body: JSON.stringify(dados) });
    if (caminho === '/auth/sign-up/email') {
      if (estado.usuarios.some((u) => u.email === corpo.email)) {
        // Neon real com verificação exigida: resposta neutra 200, sem criar nada.
        return exigirVerificacao ? json(200, { token: null, user: { id: 'falso', emailVerified: false } }) : json(422, { message: 'User already exists' });
      }
      const u = { id: `u${estado.usuarios.length + 1}`, name: corpo.name, email: corpo.email, senha: corpo.password, verificado: !exigirVerificacao };
      estado.usuarios.push(u);
      if (exigirVerificacao) {
        estado.codigos.push({ email: u.email, codigo: '246810' });
        return json(200, { user: { id: u.id, emailVerified: false } });
      }
      estado.sessao = u.id;
      return json(200, { user: u });
    }
    if (caminho === '/auth/sign-in/email') {
      const u = estado.usuarios.find((x) => x.email === corpo.email && x.senha === corpo.password);
      if (!u) return json(401, { message: 'Invalid email or password' });
      if (u.verificado === false) return json(403, { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' });
      estado.sessao = u.id;
      return json(200, { user: u });
    }
    if (caminho === '/auth/sign-out') {
      estado.sessao = null;
      return json(200, { success: true });
    }
    if (caminho === '/auth/get-session') {
      const u = estado.usuarios.find((x) => x.id === estado.sessao);
      if (!u) return json(200, null);
      return json(200, { user: { id: u.id, name: u.name, email: u.email, emailVerified: true } }, { 'set-auth-jwt': jwt(u.id) });
    }
    if (caminho === '/auth/email-otp/request-password-reset') {
      estado.envios.push(`reset:${corpo.email}`);
      return json(200, { success: true });
    }
    if (caminho === '/auth/email-otp/reset-password') {
      if (corpo.otp !== '135790') return json(400, { message: 'Invalid OTP' });
      const u = estado.usuarios.find((x) => x.email === corpo.email);
      if (u) u.senha = corpo.password;
      return json(200, { success: true });
    }
    if (caminho === '/auth/revoke-other-sessions') {
      estado.revogacoes = (estado.revogacoes ?? 0) + 1;
      return json(200, { status: true });
    }
    if (caminho === '/auth/change-password') {
      const u = estado.usuarios.find((x) => x.id === estado.sessao);
      if (!u || u.senha !== corpo.currentPassword) return json(400, { message: 'Invalid password' });
      u.senha = corpo.newPassword;
      estado.trocas = (estado.trocas ?? 0) + 1;
      estado.encerrouOutras = corpo.revokeOtherSessions;
      return json(200, { token: 'novo' });
    }
    if (caminho === '/auth/email-otp/send-verification-otp') {
      estado.envios.push(corpo.email);
      estado.codigos.push({ email: corpo.email, codigo: '246810' });
      return json(200, { success: true });
    }
    if (caminho === '/auth/email-otp/verify-email') {
      const ok = estado.codigos.some((c) => c.email === corpo.email && c.codigo === corpo.otp);
      if (!ok) return json(400, { message: 'Invalid OTP' });
      const u = estado.usuarios.find((x) => x.email === corpo.email);
      u.verificado = true;
      estado.sessao = u.id;
      return json(200, { status: true });
    }
    const sub = req.headers().authorization ? JSON.parse(Buffer.from(req.headers().authorization.split('.')[1], 'base64url')).sub : null;
    if (!sub) return json(401, { message: 'JWT required' });
    if (caminho === '/api/perfis_identidade') {
      return json(200, estado.perfis.filter((p) => p.auth_user_id === sub).map(({ auth_user_id, ...p }) => p));
    }
    if (caminho === '/api/rpc/garantir_perfil') {
      let p = estado.perfis.find((x) => x.auth_user_id === sub && x.tipo_conta === corpo.p_tipo_conta);
      if (!p) {
        p = { id: `p${estado.perfis.length + 1}`, auth_user_id: sub, tipo_conta: corpo.p_tipo_conta, nome: corpo.p_nome, criado_em: '2026-11-01T12:00:00Z' };
        estado.perfis.push(p);
      }
      const { auth_user_id, ...publico } = p;
      return json(200, publico);
    }
    return json(404, {});
  });
  return estado;
}
