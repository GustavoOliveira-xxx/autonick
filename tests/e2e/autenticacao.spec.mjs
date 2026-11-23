/**
 * Fluxos de entrada Cliente e Business (M02; ADR-001 = B).
 *
 * Estes testes usam uma SIMULAÇÃO do contrato HTTP do Neon Managed Better Auth
 * e da Data API (mesma origem, via rotas do Playwright), ajustada ao
 * comportamento observado no Neon real em 01/11/2026. Comprovam a interface,
 * NÃO a integração real (essa é feita por `npm run verificar:neon`).
 */
import { test, expect } from '@playwright/test';
import { simularNeon } from './simulacao-neon.mjs';

test('sem serviço habilitado, a entrada informa e não envia nada', async ({ page }) => {
  const enviados = [];
  page.on('request', (r) => { if (r.method() === 'POST') enviados.push(r.url()); });
  await page.goto('/cliente/entrar.html');
  await expect(page.locator('#avisos')).toContainText('O acesso não está configurado nesta cópia do app.');
  // S-01: sem acesso configurado, os formulários continuam bloqueados e dizem por quê.
  await expect(page.locator('#entrar-email')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeDisabled();
  await expect(page.locator('#form-entrar [data-aguardando]')).toContainText('o acesso não está configurado');
  expect(enviados).toEqual([]);
});

test('validação aponta campos e não chama o serviço', async ({ page, context }) => {
  const estado = await simularNeon(context);
  await page.goto('/cliente/entrar.html');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.locator('#criar-nome')).toBeFocused();
  await expect(page.locator('#criar-senha-erro')).toContainText('pelo menos 8 caracteres');
  expect(estado.chamadas).toEqual([]);
});

test('Cliente cria conta, vê a conta e sai (RF-001, RF-003, RF-005) [simulação]', async ({ page, context }) => {
  const estado = await simularNeon(context);
  await page.goto('/cliente/entrar.html');
  await page.locator('#criar-nome').fill('Pessoa Teste');
  await page.locator('#criar-email').fill('pessoa@exemplo.example');
  await page.locator('#criar-senha').fill('senha-forte-1');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/cliente\/$/);   // M11 (D11-04): sem destino de retorno, a busca do Cliente
  await page.goto('/cliente/conta.html');   // "Minha conta" continua sendo o perfil
  await expect(page.locator('#conta')).toContainText('Pessoa Teste');
  await expect(page.locator('#conta')).toContainText('Cliente');
  expect(estado.perfis.map((p) => p.tipo_conta)).toEqual(['cliente']);
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/cliente\/entrar\.html$/);
  expect(estado.sessao).toBeNull();
});

test('mesma identidade na entrada Business: perfil só é criado por escolha explícita (ADR-001 = B) [simulação]', async ({ page, context }) => {
  const estado = await simularNeon(context, {
    usuarios: [{ id: 'u1', name: 'Pessoa', email: 'pessoa@exemplo.example', senha: 'senha-forte-1' }],
    perfis: [{ id: 'p1', auth_user_id: 'u1', tipo_conta: 'cliente', nome: 'Pessoa', criado_em: '2026-11-01T12:00:00Z' }],
  });
  await page.goto('/business/entrar.html');
  await page.locator('#entrar-email').fill('pessoa@exemplo.example');
  await page.locator('#entrar-senha').fill('senha-forte-1');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('#avisos')).toContainText('Esta conta ainda não tem perfil Business');
  expect(estado.perfis).toHaveLength(1);
  await page.getByRole('button', { name: 'Criar perfil Business' }).click();
  await expect(page).toHaveURL(/\/business\/conta\.html$/);
  await expect(page.locator('#conta')).toContainText('Business');
  expect(estado.perfis.map((p) => p.tipo_conta).sort()).toEqual(['business', 'cliente']);
});

test('senha errada recebe mensagem neutra (SEC-T22) [simulação]', async ({ page, context }) => {
  await simularNeon(context, { usuarios: [{ id: 'u1', name: 'P', email: 'p@exemplo.example', senha: 'certa-123' }] });
  await page.goto('/cliente/entrar.html');
  await page.locator('#entrar-email').fill('p@exemplo.example');
  await page.locator('#entrar-senha').fill('errada-123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos.');
});

test('conta sem sessão redireciona para a entrada (RF-006) [simulação]', async ({ page, context }) => {
  await simularNeon(context);
  await page.goto('/business/conta.html');
  await expect(page).toHaveURL(/\/business\/entrar\.html$/);
});

test('esqueci a senha: código por e-mail, nova senha na mesma tela e entrada com a nova senha [simulação]', async ({ page, context }) => {
  const estado = await simularNeon(context, {
    usuarios: [{ id: 'u1', name: 'P', email: 'p@exemplo.example', senha: 'antiga-123' }],
    perfis: [{ id: 'p1', auth_user_id: 'u1', tipo_conta: 'cliente', nome: 'P', criado_em: '2026-11-01T12:00:00Z' }],
  });
  await page.goto('/cliente/entrar.html');
  await page.getByText('Esqueci minha senha').click();
  await page.locator('#senha-email').fill('p@exemplo.example');
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.locator('#nova-senha-codigo')).toBeFocused();
  expect(estado.envios).toEqual(['reset:p@exemplo.example']);
  await page.locator('#nova-senha-codigo').fill('000000');
  await page.locator('#nova-senha').fill('nova-senha-1');
  await page.locator('#nova-senha-confirmacao').fill('outra-coisa');
  await page.getByRole('button', { name: 'Criar nova senha' }).click();
  await expect(page.locator('#nova-senha-confirmacao-erro')).toHaveText('As duas senhas não são iguais.');
  await page.locator('#nova-senha-confirmacao').fill('nova-senha-1');
  await page.getByRole('button', { name: 'Criar nova senha' }).click();
  await expect(page.locator('#nova-senha-codigo-erro')).toContainText('Código incorreto ou expirado');
  await page.locator('#nova-senha-codigo').fill('135790');
  await page.getByRole('button', { name: 'Criar nova senha' }).click();
  await expect(page.locator('#avisos')).toContainText('Senha alterada. Entre com a nova senha.');
  await expect(page.locator('#avisos')).toContainText('encerramos a sua conta em outros navegadores');
  expect(estado.revogacoes).toBe(1);
  expect(estado.sessao).toBeNull();
  await expect(page.locator('#entrar-senha')).toBeFocused();
  await page.locator('#entrar-senha').fill('nova-senha-1');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/cliente\/$/);   // M11 (D11-04): sem destino de retorno, a busca do Cliente
});

test('pedido de código com e-mail desconhecido tem a mesma resposta neutra [simulação]', async ({ page, context }) => {
  await simularNeon(context);
  await page.goto('/cliente/entrar.html');
  await page.getByText('Esqueci minha senha').click();
  await page.locator('#senha-email').fill('ninguem@exemplo.example');
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.locator('#form-nova-senha')).toContainText('Se ninguem@exemplo.example estiver cadastrado');
});

test('trocar senha na conta: valida, explica senha atual errada e encerra outras sessões por padrão [simulação]', async ({ page, context }) => {
  const estado = await simularNeon(context, {
    usuarios: [{ id: 'u1', name: 'P', email: 'p@exemplo.example', senha: 'antiga-123' }],
    perfis: [{ id: 'p1', auth_user_id: 'u1', tipo_conta: 'business', nome: 'P', criado_em: '2026-11-01T12:00:00Z' }],
  });
  estado.sessao = 'u1';
  await page.goto('/business/conta.html');
  await page.locator('#form-trocar-senha').waitFor();
  await page.locator('#senha-atual').fill('errada-999');
  await page.locator('#senha-nova').fill('nova-senha-1');
  await page.locator('#senha-nova-confirmacao').fill('nova-senha-1');
  await page.getByRole('button', { name: 'Trocar senha' }).click();
  await expect(page.locator('#senha-atual-erro')).toHaveText('A senha atual não confere.');
  await page.locator('#senha-atual').fill('antiga-123');
  await page.getByRole('button', { name: 'Trocar senha' }).click();
  await expect(page.locator('#trocar-senha-status')).toContainText('Senha alterada.');
  expect(estado.trocas).toBe(1);
  expect(estado.encerrouOutras).toBe(true);
  await expect(page.locator('#senha-atual')).toHaveValue('');
});

test('verificação de e-mail exigida: cadastro pede código, erro é explicado e o perfil só nasce após confirmar [simulação]', async ({ page, context }) => {
  const estado = await simularNeon(context, { exigirVerificacao: true });
  await page.goto('/business/entrar.html');
  await page.locator('#criar-nome').fill('Gestora Teste');
  await page.locator('#criar-email').fill('gestora@exemplo.example');
  await page.locator('#criar-senha').fill('senha-forte-1');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.locator('#avisos')).toContainText('Confirme seu e-mail para continuar.');
  await expect(page.locator('#codigo-verificacao')).toBeFocused();
  expect(estado.perfis).toHaveLength(0);
  await page.locator('#codigo-verificacao').fill('111111');
  await page.getByRole('button', { name: 'Confirmar e-mail' }).click();
  await expect(page.locator('#codigo-verificacao-erro')).toContainText('Código incorreto ou expirado');
  await expect(page.locator('#codigo-verificacao')).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Enviar novo código' }).click();
  await expect(page.locator('#form-codigo [role="status"]')).toContainText('um novo código foi enviado');
  await page.locator('#codigo-verificacao').fill('246810');
  await page.getByRole('button', { name: 'Confirmar e-mail' }).click();
  await expect(page).toHaveURL(/\/business\/conta\.html$/);
  expect(estado.perfis.map((p) => p.tipo_conta)).toEqual(['business']);
});

test('login de conta não verificada pede o envio do código e mostra o formulário (D-06) [simulação]', async ({ page, context }) => {
  const estado = await simularNeon(context, {
    usuarios: [{ id: 'u1', name: 'P', email: 'p@exemplo.example', senha: 'certa-1234', verificado: false }],
  });
  await page.goto('/cliente/entrar.html');
  await page.locator('#entrar-email').fill('p@exemplo.example');
  await page.locator('#entrar-senha').fill('certa-1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('#avisos')).toContainText('Confirme seu e-mail para continuar.');
  await expect(page.locator('#avisos')).toContainText('Enviamos um código para p@exemplo.example');
  await expect(page.locator('#codigo-verificacao')).toBeVisible();
  expect(estado.envios).toEqual(['p@exemplo.example']);
  expect(estado.sessao).toBeNull();
});

test('login de conta não verificada sem conseguir enviar o código não promete envio [simulação]', async ({ page, context }) => {
  await simularNeon(context, {
    usuarios: [{ id: 'u1', name: 'P', email: 'p@exemplo.example', senha: 'certa-1234', verificado: false }],
  });
  await context.route('**/__neon_simulado/auth/email-otp/send-verification-otp', (rota) => rota.fulfill({ status: 429, contentType: 'application/json', body: '{}' }));
  await page.goto('/cliente/entrar.html');
  await page.locator('#entrar-email').fill('p@exemplo.example');
  await page.locator('#entrar-senha').fill('certa-1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('#avisos')).toContainText('Não conseguimos enviar o código agora');
  await expect(page.locator('#avisos')).not.toContainText('Enviamos um código');
  await expect(page.locator('#codigo-verificacao')).toBeVisible();
});

test('cadastro com e-mail já existente recebe a mesma resposta neutra e não cria perfil [simulação]', async ({ page, context }) => {
  const estado = await simularNeon(context, {
    exigirVerificacao: true,
    usuarios: [{ id: 'u1', name: 'P', email: 'p@exemplo.example', senha: 'certa-1234', verificado: true }],
  });
  await page.goto('/cliente/entrar.html');
  await page.locator('#criar-nome').fill('Outra Pessoa');
  await page.locator('#criar-email').fill('p@exemplo.example');
  await page.locator('#criar-senha').fill('outra-senha-1');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.locator('#avisos')).toContainText('Confirme seu e-mail para continuar.');
  expect(estado.usuarios).toHaveLength(1);
  expect(estado.perfis).toHaveLength(0);
  expect(estado.sessao).toBeNull();
});

test('D-08: entrar pela outra área encerra a sessão anterior antes de abrir outra [simulação]', async ({ page, context }) => {
  const estado = await simularNeon(context, {
    usuarios: [{ id: 'u1', name: 'P', email: 'p@exemplo.example', senha: 'certa-1234' }],
    perfis: [{ id: 'p1', auth_user_id: 'u1', tipo_conta: 'business', nome: 'P', criado_em: '2026-11-01T12:00:00Z' }],
  });
  estado.sessao = 'u1';
  await page.goto('/cliente/entrar.html');
  await page.locator('#entrar-email').fill('p@exemplo.example');
  await page.locator('#entrar-senha').fill('certa-1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('#avisos')).toContainText('Esta conta ainda não tem perfil Cliente');
  const ordem = estado.chamadas.filter((c) => c === '/auth/sign-out' || c === '/auth/sign-in/email');
  expect(ordem.slice(0, 2)).toEqual(['/auth/sign-out', '/auth/sign-in/email']);
});

// Página de apresentação (sino "Quem tocou?"): os quatro botões levam à entrada certa e cada pessoa chega à sua área.
test('apresentação: "Criar conta" de cliente e de negócio abrem a seção de cadastro da entrada certa', async ({ page }) => {
  for (const [nome, url, titulo] of [['Criar conta de cliente', /\/cliente\/entrar\.html#titulo-criar$/, 'Criar conta Cliente'],
    ['Criar conta Business', /\/business\/entrar\.html#titulo-criar$/, 'Criar conta Business']]) {
    await page.goto('/');
    await page.getByRole('link', { name: nome }).click();
    await expect(page).toHaveURL(url);
    await expect(page.locator('#titulo-criar')).toHaveText(titulo);
    await expect(page.locator('#titulo-criar')).toBeInViewport();
  }
});

test('apresentação → "Entrar como cliente": o Cliente entra e chega à busca do Cliente [simulação]', async ({ page, context }) => {
  await simularNeon(context, {
    usuarios: [{ id: 'c1', name: 'Cliente Demo', email: 'cliente.demo@autonick-teste.example', senha: 'senha-forte-1' }],
    perfis: [{ id: 'pc', auth_user_id: 'c1', tipo_conta: 'cliente', nome: 'Cliente Demo', criado_em: '2026-11-19T03:12:41Z' }],
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Entrar como cliente' }).click();
  await expect(page).toHaveURL(/\/cliente\/entrar\.html$/);
  await page.locator('#entrar-email').fill('cliente.demo@autonick-teste.example');
  await page.locator('#entrar-senha').fill('senha-forte-1');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/cliente\/$/);
});

test('apresentação → "Entrar no Business": o Gestor entra e chega à área Business [simulação]', async ({ page, context }) => {
  await simularNeon(context, {
    usuarios: [{ id: 'g1', name: 'Gestor Demo', email: 'gestor.demo@autonick-teste.example', senha: 'senha-forte-1' }],
    perfis: [{ id: 'pg', auth_user_id: 'g1', tipo_conta: 'business', nome: 'Gestor Demo', criado_em: '2026-11-19T03:13:33Z' }],
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Entrar no Business' }).click();
  await expect(page).toHaveURL(/\/business\/entrar\.html$/);
  await page.locator('#entrar-email').fill('gestor.demo@autonick-teste.example');
  await page.locator('#entrar-senha').fill('senha-forte-1');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/business\/conta\.html$/);
  await expect(page.locator('#conta')).toContainText('Business');
});
