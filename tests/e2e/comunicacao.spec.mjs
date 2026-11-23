/**
 * Telas do M12 (conversa, avaliações, denúncias e moderação) com SIMULAÇÃO do contrato da Data API. Comprovam a
 * interface: conversa única da solicitação até a OS e a do pedido, sem notas internas nem mensagens repetidas na linha do
 * tempo; consulta a cada 20 segundos só com a aba visível (não é tempo real); bloqueio de envio e aviso de suspensão;
 * ocultação com indicação para os demais e o próprio texto com o motivo para o autor (D12-18 = C), contestação; denúncia
 * sem revelar quem denunciou; avaliação só da OS encerrada, sem imagem, retirada, recusa com motivo resumido; vitrine com
 * "Cliente verificado" e média só a partir de 3; resposta da empresa; painel CK com impedimento e só o conteúdo
 * denunciado; "Minhas denúncias"; 360 px e acessibilidade. As regras reais estão em tests/db/comunicacao-avaliacoes.test.mjs
 * e em verificar:neon:m12.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = '/__neon_simulado';
const AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const EMP = 'a1200000-0000-4000-8000-000000000001';
const S1 = 'e1200000-0000-4000-8000-000000000001';
const OS = 'f1200000-0000-4000-8000-000000000001';
const PED = 'c1200000-0000-4000-8000-000000000001';
const AV = 'b1200000-0000-4000-8000-000000000001';

function jwt(sub, role = 'authenticated') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role, exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}
const item = (id, extra = {}) => ({ id, alvo_tipo: 'mensagem', tipo: 'mensagem', autor: 'cliente', proprio: false, oculta: false, texto: `Texto ${id}`,
  moderacao: null, criado_em: '2026-11-17T12:00:00Z', ...extra });
const conversa = (extra = {}) => ({ tipo: 'solicitacao', rotulo: 'Solicitação nº 3', papel: 'cliente', pode_enviar: true, bloqueio: null, envio_ate: null,
  suspensao: null, limite_diario: 50, aviso: 'Não compartilhe senhas, códigos nem dados de pagamento.', atualizar_a_cada_s: 20,
  itens: [item('m08', { alvo_tipo: 'mensagem_m08', proprio: true, texto: 'Mensagem antiga do M08.' }),
    item('m1', { autor: 'empresa', texto: 'Sexta às 14h, combinado.' }),
    item('a1', { alvo_tipo: 'atualizacao_os', tipo: 'atualizacao', autor: 'empresa', texto: 'Barra medida e alfinetada.' })], ...extra });
const solicitacao = (extra = {}) => ({ id: S1, empresa_id: EMP, numero: 3, servico_id: 's', servico: 'Barra de calça', empresa: 'Costura da Olga', origem: 'plataforma',
  cliente_nome: 'Cida', relato: 'Fazer a barra.', cidade: null, bairro: null, preferencia: null, respostas: [], estimativa: null,
  estado: 'em_analise', estado_exibicao: 'em_analise', versao: 2, versao_vigente_id: null, versoes: [], horario: null, historico_horarios: [], suspensao: null,
  eventos: [{ id: 'e1', tipo: 'criada', autor_tipo: 'cliente', autor: 'Cida', texto: null, dados: {}, interno: false, criado_em: '2026-11-14T12:00:00Z' },
    { id: 'm08', tipo: 'mensagem', autor_tipo: 'cliente', autor: 'Cida', texto: 'Mensagem antiga do M08.', dados: {}, interno: false, criado_em: '2026-11-14T12:01:00Z' }],
  ...extra });
const valores = { contratado_centavos: 12000, recebido_centavos: 0, saldo_pendente_centavos: 0, a_devolver_centavos: 0, situacao: 'sem_cobranca', aviso: 'Registro manual.' };
const ordem = (extra = {}) => ({ id: OS, numero: 2, empresa_id: EMP, empresa: 'Costura da Olga', solicitacao_id: S1, solicitacao_numero: 3, servico: 'Barra de calça',
  origem: 'plataforma', cliente_nome: 'Cida', estado: 'encerrada', previsao_conclusao: null, aceita_em: '2026-11-12T12:00:00Z', iniciada_em: '2026-11-12T13:00:00Z',
  concluida_em: '2026-11-13T12:00:00Z', encerrada_em: '2026-11-14T12:00:00Z', cancelada_em: null, encerrada_por: 'cliente', revisao_pendente: false, garantia: null,
  recorrencia: null, proxima: null, valores, versao_aceita: { numero: 1, total_centavos: 12000, componentes: [{ descricao: 'Barra', total_centavos: 12000 }] },
  condicoes_cancelamento: { politica: null, condicoes: null }, horario: null, reagendamentos: [], pedidos_de_reagendamento_do_cliente: 0, cancelamento: null, custos: [],
  eventos: [{ id: 'o1', tipo: 'criada', autor_tipo: 'sistema', autor: 'AutoniCK', texto: null, dados: {}, interno: false, criado_em: '2026-11-12T12:00:00Z' },
    { id: 'a1', tipo: 'atualizacao', autor_tipo: 'equipe', autor: 'Equipe', texto: 'Barra medida e alfinetada.', dados: {}, interno: false, criado_em: '2026-11-12T14:00:00Z' }],
  encerramento: { empresa_pode_encerrar: false, a_partir_de: null, motivo: null, aviso: 'O encerramento é administrativo.' }, versao: 6, suspensao: null, acao_pendente: null, ...extra });

async function simular(context, { logado = true, tipo = 'cliente', rpc = {}, permissoes = ['vitrine.visualizar', 'vitrine.alterar', 'pedidos.visualizar', 'pedidos.aprovar'] } = {}) {
  const estado = { corpos: {}, chamadas: [], contagem: {} };
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
      return logado ? json(200, { user: { id: 'u1', name: 'Cida', email: 'cida@autonick-teste.example', emailVerified: true } }, { 'set-auth-jwt': jwt('u1') }) : json(200, {});
    }
    if (caminho === '/auth/token/anonymous') return json(200, { token: jwt('anon', 'anonymous'), expires_at: new Date(Date.now() + 900000).toISOString() });
    const nome = caminho.replace('/api/rpc/', '');
    if (caminho.startsWith('/api/rpc/') && rpc[nome] !== undefined) {
      const r = typeof rpc[nome] === 'function' ? rpc[nome](corpo, estado) : rpc[nome];
      return r?.__erro ? json(400, r.__erro) : json(200, r);
    }
    switch (caminho) {
      case '/api/perfis_identidade': return json(200, [{ id: 'p1', tipo_conta: tipo, nome: 'Cida', criado_em: '2026-11-01T12:00:00Z' }]);
      case '/api/rpc/minhas_permissoes': return json(200, { membro_id: 'm1', perfil_id: null, papel: 'funcionario', perfil_nome: 'Equipe', permissoes });
      case '/api/empresas': return json(200, [{ id: EMP, nome_publico: 'Costura da Olga', situacao_vitrine: 'publicada', situacao_erp: 'ativa', dado_de_teste: false, versao: 1 }]);
      default:
        if (caminho.startsWith('/api/rpc/')) return json(404, {});
        return json(200, []);
    }
  });
  return estado;
}
const axe = async (page) => expect((await new AxeBuilder({ page }).withTags(AXE).analyze()).violations).toEqual([]);
const semRolagem = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

test('conversa da solicitação: leitura unificada, sem repetir mensagens na linha do tempo; envio com chave [simulação]', async ({ page, context }) => {
  const itens = conversa().itens;
  const estado = await simular(context, { rpc: {
    minha_solicitacao: solicitacao(),
    conversa_atendimento: () => conversa({ itens }),
    enviar_mensagem: (c) => { const n = item(`n${itens.length}`, { proprio: true, texto: c.p_texto }); itens.push(n); return n; },
  } });
  await page.goto(`/cliente/solicitacoes.html?s=${S1}`);
  const lista = page.locator('#conversa-itens');
  await expect(lista.locator('[data-item]')).toHaveCount(3);
  await expect(lista.locator('[data-item="m08"]')).toContainText('Você');
  await expect(lista.locator('[data-item="a1"]')).toContainText('Atualização da empresa');
  await expect(lista.locator('[data-item="m1"]')).toContainText('Empresa');
  await expect(page.locator('#linha-do-tempo')).not.toContainText('Mensagem antiga do M08.');
  await expect(page.locator('#conversa')).toContainText('a cada 20 segundos');
  await page.locator('#form-conversa [type="submit"]').click();
  await expect(page.locator('#conversa-texto-erro')).toContainText('Escreva a mensagem');
  await page.locator('#conversa-texto').fill('Pode ser na sexta?');
  await page.locator('#form-conversa [type="submit"]').click();
  await expect(lista.locator('[data-item]')).toHaveCount(4);
  expect(estado.corpos['/api/rpc/enviar_mensagem']).toMatchObject({ p_tipo: 'solicitacao', p_id: S1, p_texto: 'Pode ser na sexta?' });
  expect(estado.corpos['/api/rpc/enviar_mensagem'].p_operation_key).toBeTruthy();
  expect(estado.chamadas).not.toContain('/api/rpc/registrar_mensagem');
  await axe(page);
});

test('consulta a cada 20 s só com a aba visível; "Atualizar" consulta na hora (não é tempo real) [simulação]', async ({ page, context }) => {
  await page.clock.install();
  const estado = await simular(context, { rpc: { minha_solicitacao: solicitacao(), conversa_atendimento: conversa() } });
  await page.goto(`/cliente/solicitacoes.html?s=${S1}`);
  await expect(page.locator('#conversa-itens [data-item]')).toHaveCount(3);
  const n0 = estado.contagem['/api/rpc/conversa_atendimento'];
  await page.clock.runFor(20500);
  await expect.poll(() => estado.contagem['/api/rpc/conversa_atendimento']).toBe(n0 + 1);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(41000);
  expect(estado.contagem['/api/rpc/conversa_atendimento']).toBe(n0 + 1);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => estado.contagem['/api/rpc/conversa_atendimento']).toBe(n0 + 2);
  await page.locator('#conversa-atualizar').click();
  await expect.poll(() => estado.contagem['/api/rpc/conversa_atendimento']).toBe(n0 + 3);
});

test('ocultação (D12-18 = C): os demais veem só a indicação; o autor vê o texto, o motivo e contesta [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { rpc: {
    minha_solicitacao: solicitacao(),
    conversa_atendimento: conversa({ itens: [
      item('x1', { autor: 'empresa', oculta: true, texto: null }),
      item('x2', { proprio: true, oculta: true, texto: 'Meu texto ocultado.', moderacao: { decisao_id: 'd1', medida: 'ocultar', motivo: 'Mensagem considerada ofensiva.',
        data: '2026-11-17T12:00:00Z', contestacao: null, pode_contestar: true } })] }),
    contestar_moderacao: { id: 'c1', estado: 'aberta' },
  } });
  await page.goto(`/cliente/solicitacoes.html?s=${S1}`);
  const outro = page.locator('[data-item="x1"]');
  await expect(outro).toContainText('Conteúdo ocultado pela moderação.');
  await expect(outro.locator('[data-denunciar]')).toHaveCount(0);
  const meu = page.locator('[data-item="x2"]');
  await expect(meu).toContainText('Meu texto ocultado.');
  await expect(meu).toContainText('Oculto para os outros pela moderação');
  await expect(meu).toContainText('Motivo: Mensagem considerada ofensiva.');
  await meu.locator('[data-contestar="d1"]').click();
  await page.locator('#contestacao-motivo').fill('Foi um mal-entendido, peço revisão.');
  await page.getByRole('button', { name: 'Enviar contestação' }).click();
  await expect(page.locator('#avisos')).toContainText('Contestação enviada');
  expect(estado.corpos['/api/rpc/contestar_moderacao']).toMatchObject({ p_decisao_id: 'd1', p_motivo: 'Foi um mal-entendido, peço revisão.' });
  await axe(page);
});

test('denúncia de mensagem: motivo obrigatório, protocolo e nenhuma identificação de quem denunciou [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { rpc: { minha_solicitacao: solicitacao(), conversa_atendimento: conversa(),
    denunciar: { protocolo: 41, estado: 'aberta', alvo_tipo: 'mensagem' } } });
  await page.goto(`/cliente/solicitacoes.html?s=${S1}`);
  await expect(page.locator('[data-item="m08"] [data-denunciar]')).toHaveCount(0);
  await page.locator('[data-item="m1"] [data-denunciar]').click();
  await expect(page.locator('#denuncia')).toContainText('Quem foi denunciado não sabe quem denunciou');
  await page.getByRole('button', { name: 'Enviar denúncia' }).click();
  await expect(page.locator('#denuncia-categoria-erro')).toContainText('Escolha o motivo');
  await page.locator('#denuncia-categoria').selectOption('outro');
  await page.getByRole('button', { name: 'Enviar denúncia' }).click();
  await expect(page.locator('#denuncia-descricao-erro')).toContainText('pelo menos 10');
  await page.locator('#denuncia-descricao').fill('A empresa me ofendeu na conversa.');
  await page.getByRole('button', { name: 'Enviar denúncia' }).click();
  await expect(page.locator('#avisos')).toContainText('protocolo nº 41');
  expect(estado.corpos['/api/rpc/denunciar']).toMatchObject({ p_alvo_tipo: 'mensagem', p_alvo_id: 'm1', p_categoria: 'outro' });
});

test('conversa só leitura depois do prazo e aviso de suspensão sem dados internos [simulação]', async ({ page, context }) => {
  await simular(context, { rpc: { minha_solicitacao: solicitacao(),
    conversa_atendimento: conversa({ pode_enviar: false, bloqueio: 'O prazo para enviar mensagens neste atendimento terminou: a conversa fica só para leitura.', suspensao: 'grave' }) } });
  await page.goto(`/cliente/solicitacoes.html?s=${S1}`);
  await expect(page.locator('#conversa-bloqueio')).toContainText('só para leitura');
  await expect(page.locator('#form-conversa')).toHaveCount(0);
  await expect(page.locator('[data-conversa-suspensao="grave"]')).toContainText('A conversa continua neste atendimento.');
  await page.setViewportSize({ width: 360, height: 800 });
  await semRolagem(page);
  await axe(page);
});

test('OS encerrada: conversa da OS e avaliação sem imagem; nota obrigatória; envio fica aguardando a CK [simulação]', async ({ page, context }) => {
  let avaliada = null;
  const estado = await simular(context, { rpc: {
    minha_os: ordem(),
    conversa_atendimento: conversa({ rotulo: 'OS nº 2 (solicitação nº 3)' }),
    minha_avaliacao_os: () => (avaliada ? { elegivel: false, motivo: 'Este atendimento já foi avaliado.', prazo_ate: null, avaliacao: avaliada }
      : { elegivel: true, motivo: null, prazo_ate: '2027-01-13T12:00:00Z', avaliacao: null }),
    avaliar_os: (c) => { avaliada = { id: AV, os_id: OS, nota: c.p_nota, comentario: c.p_comentario, estado: 'aguardando', oculta: false, criado_em: '2026-11-17T12:00:00Z', moderacao: null, resposta: null }; return avaliada; },
  } });
  await page.goto(`/cliente/ordens.html?os=${OS}`);
  await expect(page.locator('#conversa')).toHaveAttribute('data-tipo', 'os');
  await expect(page.locator('#conversa-estado')).toContainText('OS nº 2');
  expect(estado.corpos['/api/rpc/conversa_atendimento']).toMatchObject({ p_tipo: 'os', p_id: OS });
  await expect(page.locator('#linha-do-tempo')).not.toContainText('Barra medida e alfinetada.');
  const form = page.locator('#form-avaliacao');
  await expect(form).toContainText('Cliente verificado');
  await expect(form.locator('input[type="file"]')).toHaveCount(0);
  await form.locator('[type="submit"]').click();
  await expect(form).toContainText('Escolha uma nota de 1 a 5');
  await form.getByLabel('5 de 5').check();
  await page.locator('#avaliacao-comentario').fill('Serviço caprichado.');
  await form.locator('[type="submit"]').click();
  await expect(page.locator('#minha-avaliacao')).toContainText('Aguardando a análise da CK');
  expect(estado.corpos['/api/rpc/avaliar_os']).toMatchObject({ p_os_id: OS, p_nota: 5, p_comentario: 'Serviço caprichado.' });
  await axe(page);
});

test('avaliação recusada com motivo resumido e contestação; publicada com resposta pode ser retirada [simulação]', async ({ page, context }) => {
  let av = { id: AV, os_id: OS, nota: 2, comentario: 'Demorou.', estado: 'recusada', oculta: false, criado_em: '2026-11-17T12:00:00Z', resposta: null,
    moderacao: { decisao_id: 'd9', medida: 'recusar', motivo: 'Comentário com linguagem imprópria.', data: '2026-11-17T13:00:00Z', contestacao: null, pode_contestar: true } };
  const estado = await simular(context, { rpc: {
    minha_os: ordem(), conversa_atendimento: conversa(),
    minha_avaliacao_os: () => ({ elegivel: false, motivo: 'Este atendimento já foi avaliado.', prazo_ate: null, avaliacao: av }),
    retirar_avaliacao: () => { av = { ...av, estado: 'retirada' }; return av; },
  } });
  await page.goto(`/cliente/ordens.html?os=${OS}`);
  await expect(page.locator('#minha-avaliacao')).toContainText('Recusada pela moderação');
  await expect(page.locator('#minha-avaliacao')).toContainText('Motivo: Comentário com linguagem imprópria.');
  await expect(page.locator('#minha-avaliacao [data-contestar="d9"]')).toBeVisible();
  await expect(page.locator('#retirar-avaliacao')).toHaveCount(0);
  av = { ...av, estado: 'publicada', moderacao: null, resposta: { texto: 'Obrigada pela confiança!', data: '11/2026' } };
  await page.reload();
  await expect(page.locator('#resposta-empresa')).toContainText('Obrigada pela confiança!');
  await page.locator('#retirar-avaliacao').click();
  await page.getByRole('button', { name: 'Retirar', exact: true }).click();
  await expect(page.locator('#minha-avaliacao')).toContainText('Retirada por você');
  expect(estado.corpos['/api/rpc/retirar_avaliacao'].p_avaliacao_id).toBe(AV);
});

const perfilVitrine = (avaliacoes) => ({ empresa: { id: EMP, nome_publico: 'Costura da Olga', categoria: 'Costura e moda', modalidade: 'ambos', cidade: 'Campinas', uf: 'SP',
  bairro: 'Cambuí', area_atendimento: null, descricao_publica: null, horario_funcionamento: null, selo: 'Aprovado para publicação' },
  servicos: [], produtos: [], sem_itens: true, avaliacoes });
const avaliacoesVitrine = (extra = {}) => ({ quantidade: 2, media: null, minimo_para_media: 3, itens: [
  { id: 'v1', oculta: false, nota: 5, comentario: 'Ótimo atendimento.', autor: 'Cliente verificado', data: '11/2026', resposta: { id: 'r1', texto: 'Obrigada!', data: '11/2026' } },
  { id: 'v2', oculta: true, data: '10/2026' },
  { id: 'v3', oculta: false, nota: 4, comentario: null, autor: 'Cliente verificado', data: '10/2026', resposta: null }], ...extra });

test('vitrine pública: "Cliente verificado", média só a partir de 3, oculta só como indicação; visitante não denuncia [simulação]', async ({ page, context }) => {
  await simular(context, { logado: false, rpc: { vitrine_publica: perfilVitrine(avaliacoesVitrine()) } });
  await page.goto(`/cliente/empresa.html?e=${EMP}`);
  const sec = page.locator('#avaliacoes');
  await expect(sec.locator('h2')).toHaveText('Avaliações (2)');
  await expect(page.locator('#avaliacoes-sem-media')).toContainText('a partir de 3');
  await expect(sec.locator('[data-avaliacao="v1"]')).toContainText('Nota 5 de 5 · Cliente verificado · 11/2026');
  await expect(sec.locator('[data-avaliacao="v1"] [data-resposta="r1"]')).toContainText('Obrigada!');
  await expect(sec.locator('[data-avaliacao="v2"]')).toContainText('Avaliação ocultada pela moderação');
  await expect(sec.locator('[data-avaliacao="v2"]')).not.toContainText('Nota');
  await expect(page.locator('[data-denunciar]')).toHaveCount(0);
  await axe(page);
});

test('vitrine com login: média com 3 ou mais; denunciar empresa, avaliação e resposta [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { rpc: { vitrine_publica: perfilVitrine(avaliacoesVitrine({ quantidade: 3, media: 4.3 })),
    denunciar: { protocolo: 7, estado: 'aberta', alvo_tipo: 'avaliacao' } } });
  await page.goto(`/cliente/empresa.html?e=${EMP}`);
  await expect(page.locator('#avaliacoes h2')).toHaveText('Avaliações: média 4,3 de 5 (3)');
  await expect(page.locator('#denunciar-empresa [data-denunciar="empresa"]')).toBeVisible();
  await expect(page.locator('[data-resposta="r1"] [data-denunciar="resposta"]')).toBeVisible();
  await page.locator('[data-avaliacao="v3"] [data-denunciar="avaliacao"]').click();
  await page.locator('#denuncia-categoria').selectOption('falso');
  await page.getByRole('button', { name: 'Enviar denúncia' }).click();
  await expect(page.locator('#avisos')).toContainText('protocolo nº 7');
  expect(estado.corpos['/api/rpc/denunciar']).toMatchObject({ p_alvo_tipo: 'avaliacao', p_alvo_id: 'v3', p_categoria: 'falso' });
});

test('conversa do pedido de produto aberta sob demanda, uma por vez [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { rpc: {
    meus_pedidos: [{ id: PED, empresa: 'Costura da Olga', empresa_id: EMP, estado: 'aceito', total_centavos: 800, criado_em: '2026-11-17T12:00:00Z', versao: 2,
      itens: [{ produto: 'Linha', variacao: 'Padrão', quantidade: 1, preco_centavos: 800 }], suspensao: null, motivo: null, entrega: null }],
    conversa_atendimento: conversa({ tipo: 'pedido', rotulo: 'Pedido de 17/11/2026', itens: [item('p1', { autor: 'empresa', texto: 'Temos na cor azul.' })] }),
  } });
  await page.goto('/cliente/pedidos.html');
  await page.locator(`[data-abrir-conversa="${PED}"]`).click();
  await expect(page.locator('#conversa-itens [data-item="p1"]')).toContainText('Temos na cor azul.');
  expect(estado.corpos['/api/rpc/conversa_atendimento']).toMatchObject({ p_tipo: 'pedido', p_id: PED });
  await page.locator(`[data-abrir-conversa="${PED}"]`).click();
  await expect(page.locator('#conversa')).toHaveCount(0);
});

test('empresa: avaliações publicadas, resposta única moderada e resposta oculta vista pelo autor [simulação]', async ({ page, context }) => {
  let itens = [{ id: 'v1', oculta: false, nota: 5, comentario: 'Ótimo.', autor: 'Cliente verificado', data: '11/2026', pode_responder: true, resposta: null },
    { id: 'v2', oculta: true, data: '10/2026' },
    { id: 'v3', oculta: false, nota: 3, comentario: null, autor: 'Cliente verificado', data: '10/2026', pode_responder: false,
      resposta: { id: 'r3', estado: 'publicada', oculta: true, proprio: true, texto: 'Minha resposta.', moderacao: { decisao_id: 'd3', medida: 'ocultar',
        motivo: 'Resposta com dado pessoal.', data: '2026-11-17T12:00:00Z', contestacao: { estado: 'decidida', resultado: 'manter' }, pode_contestar: false } } }];
  const estado = await simular(context, { tipo: 'business', rpc: {
    avaliacoes_da_empresa: () => ({ vitrine: { quantidade: 2, media: null, minimo_para_media: 3 }, itens }),
    responder_avaliacao: (c) => { itens = itens.map((i) => (i.id === c.p_avaliacao_id ? { ...i, pode_responder: false,
      resposta: { id: 'r1', estado: 'aguardando', oculta: false, proprio: true, texto: c.p_texto, moderacao: null } } : i)); return { id: 'r1', estado: 'aguardando' }; },
  } });
  await page.goto(`/business/avaliacoes.html?id=${EMP}`);
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Avaliações', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-avaliacao="v2"]')).toContainText('Avaliação ocultada pela moderação');
  await expect(page.locator('[data-resposta="r3"]')).toContainText('Minha resposta.');
  await expect(page.locator('[data-resposta="r3"]')).toContainText('decisão mantida');
  await page.locator('#resposta-v1').fill('Obrigada pela confiança!');
  await page.locator('[data-responder="v1"] [type="submit"]').click();
  await expect(page.locator('[data-avaliacao="v1"]')).toContainText('Aguardando a análise da CK');
  expect(estado.corpos['/api/rpc/responder_avaliacao']).toMatchObject({ p_avaliacao_id: 'v1', p_texto: 'Obrigada pela confiança!' });
  await axe(page);
});

test('painel CK: pré-moderação, denúncia só com o conteúdo denunciado, impedimento e administrador único [simulação]', async ({ page, context }) => {
  let fila = {
    avaliacoes: [{ id: 'av1', empresa: 'Costura da Olga', conteudo: { nota: 5, comentario: 'Ligue 11 99999-0000.', estado: 'aguardando', data: '2026-11-17T12:00:00Z', sinaliza_contato: true, oculto: false }, impedimento: null }],
    respostas: [],
    denuncias: [
      { id: 'dn1', protocolo: 41, alvo_tipo: 'mensagem', empresa_id: EMP, empresa: 'Costura da Olga', categoria: 'ofensivo', descricao: 'Fui ofendida.', estado: 'em_analise',
        criado_em: '2026-11-17T12:00:00Z', assumida_por_mim: true, assumida: true,
        conteudo: { texto: 'Mensagem ofensiva da empresa.', autor: 'empresa', data: '2026-11-17T11:00:00Z', atendimento: 'OS nº 2', oculto: false }, impedimento: null },
      { id: 'dn2', protocolo: 42, alvo_tipo: 'empresa', empresa_id: EMP, empresa: 'Costura da Olga', categoria: 'golpe', descricao: null, estado: 'aberta',
        criado_em: '2026-11-17T12:00:00Z', assumida_por_mim: false, assumida: false, conteudo: { nome_publico: 'Costura da Olga', oculto: false },
        impedimento: 'Você é membro desta empresa e não pode decidir sobre ela (conflito de interesse).' }],
    contestacoes: [{ id: 'ct1', estado: 'em_revisao', motivo: 'Não era spam.', criado_em: '2026-11-17T12:00:00Z', empresa: 'Costura da Olga', alvo_tipo: 'mensagem',
      decisao: { medida: 'ocultar', motivo: 'Mensagem considerada spam.', justificativa: 'Conteúdo repetitivo.', decidida_por_mim: true, data: '2026-11-17T11:30:00Z' },
      conteudo: { texto: 'Orçamento enviado.', autor: 'empresa', data: '2026-11-17T11:00:00Z', atendimento: 'OS nº 2', oculto: true }, assumida_por_mim: true, assumida: true, impedimento: null }],
  };
  const estado = await simular(context, { tipo: 'business', rpc: {
    sou_ck_admin: true, ck_listar_empresas: [], ck_limites: [], ck_historico_limites: [],
    ck_fila_moderacao: () => fila,
    ck_moderar_publicacao: () => { fila = { ...fila, avaliacoes: [] }; return { decisao_id: 'x', medida: 'aprovar' }; },
    ck_decidir_denuncia: () => { fila = { ...fila, denuncias: fila.denuncias.filter((d) => d.id !== 'dn1') }; return { decisao_id: 'y', medida: 'ocultar' }; },
  } });
  await page.goto('/ck-admin/');
  const av = page.locator('[data-moderar-avaliacao="av1"]');
  await expect(av).toContainText('Comentário com telefone, e-mail ou endereço');
  await av.getByLabel('Aprovar e publicar').check();
  await av.getByRole('button', { name: 'Registrar decisão' }).click();
  await expect(page.locator('#avisos')).toContainText('Decisão registrada');
  expect(estado.corpos['/api/rpc/ck_moderar_publicacao']).toMatchObject({ p_alvo_tipo: 'avaliacao', p_alvo_id: 'av1', p_medida: 'aprovar' });
  const den = page.locator('[data-denuncia="41"]');
  await expect(den.locator('[data-conteudo-denunciado]')).toContainText('Só esta mensagem é mostrada');
  await expect(page.locator('[data-denuncia="42"]')).toContainText('conflito de interesse');
  await expect(page.locator('[data-denuncia="42"] [data-assumir]')).toHaveCount(0);
  await expect(page.locator('[data-contestacao-moderacao="ct1"]')).toContainText('Não há outra pessoa da CK elegível');
  await den.getByLabel('Ocultar o conteúdo').check();
  await den.getByRole('button', { name: 'Registrar decisão' }).click();
  await expect(den.locator('[name="motivo_resumo"]').locator('xpath=..')).toContainText('pelo menos 10');
  await den.locator('[name="motivo_resumo"]').fill('Mensagem ofensiva ocultada.');
  await den.locator('[name="justificativa"]').fill('Linguagem ofensiva contra a cliente.');
  await den.getByRole('button', { name: 'Registrar decisão' }).click();
  await expect(page.locator('[data-denuncia="41"]')).toHaveCount(0);
  expect(estado.corpos['/api/rpc/ck_decidir_denuncia']).toMatchObject({ p_denuncia_id: 'dn1', p_medida: 'ocultar' });
  await axe(page);
});

test('minha conta: denúncias da própria conta com resultado genérico [simulação]', async ({ page, context }) => {
  await simular(context, { rpc: { minhas_denuncias: [{ protocolo: 41, alvo_tipo: 'mensagem', categoria: 'ofensivo', estado: 'resolvida', criado_em: '2026-11-17T12:00:00Z',
    resolvida_em: '2026-11-17T13:00:00Z', resultado: 'Analisada: a CK tomou as medidas cabíveis.' }] } });
  await page.goto('/cliente/conta.html');
  await expect(page.locator('#minhas-denuncias [data-protocolo="41"]')).toContainText('Analisada: a CK tomou as medidas cabíveis.');
});
