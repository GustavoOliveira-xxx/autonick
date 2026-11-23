/**
 * Telas do M09 (ordens de serviço, agenda operacional e "Meus serviços" do cliente) com SIMULAÇÃO do contrato da Data API.
 * Comprovam a interface: a versão da OS vai em cada mudança de estado, a pausa pede motivo, valores saem em centavos e o
 * navegador nunca envia o valor contratado nem totais de custos, avisos de horário pedem confirmação explícita, o técnico
 * não vê ações financeiras, de cancelamento nem de reserva, o cliente vê o aviso de arrependimento e responde a horários
 * e custos, acessibilidade e 360 px. As regras reais estão em tests/db/ordens-servico.test.mjs e em verificar:neon:m09.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { lerPdfBaixado } from './pdf-util.mjs';

const BASE = '/__neon_simulado';
const EMP = 'e0000000-0000-4000-8000-000000000009';
const OS = 'o0000000-0000-4000-8000-000000000001';
const AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const GERENTE = ['servicos.visualizar', 'servicos.alterar', 'servicos.cancelar', 'agenda.visualizar', 'agenda.alterar', 'estoque.visualizar', 'estoque.propor',
  'financeiro.criar', 'orcamentos.visualizar', 'orcamentos.criar', 'orcamentos.aprovar', 'produtos.visualizar'];
const TECNICO = ['servicos.visualizar', 'servicos.alterar', 'agenda.visualizar'];

function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const valores = (extra = {}) => ({ contratado_centavos: 33000, recebido_centavos: 0, saldo_pendente_centavos: 0, a_devolver_centavos: 0, situacao: 'sem_cobranca',
  aviso: 'Situação conforme os registros da empresa; registro manual não é confirmação bancária nem pagamento pela plataforma.', ...extra });
const ordem = (extra = {}) => ({ id: OS, numero: 2, empresa_id: EMP, empresa: 'Elétrica Fictícia', solicitacao_id: 's1', solicitacao_numero: 5, servico: 'Instalação elétrica',
  origem: 'plataforma', cliente_nome: 'Cliente Clara', estado: 'aguardando_inicio', previsao_conclusao: null, aceita_em: '2026-11-12T12:00:00Z', iniciada_em: null,
  concluida_em: null, encerrada_em: null, cancelada_em: null, encerrada_por: null, revisao_pendente: false, garantia: null, recorrencia: null, proxima: null,
  valores: valores({ antecipado_centavos: 0, titulado_centavos: 0, a_titular_centavos: 33000, titulos: [] }),
  versao_aceita: { numero: 1, total_centavos: 33000, componentes: [{ descricao: 'Instalação', total_centavos: 30000 }, { descricao: 'Cabo', total_centavos: 3000 }] },
  condicoes_cancelamento: { politica: { versao: 2, texto: 'Depois do início: só deslocamento e material já usado.' }, condicoes: null },
  horario: null, reagendamentos: [], pedidos_de_reagendamento_do_cliente: 0, cancelamento: null, custos: [],
  eventos: [{ id: 'e1', tipo: 'criada', autor_tipo: 'sistema', autor: 'AutoniCK', texto: null, dados: {}, interno: false, criado_em: '2026-11-12T12:00:00Z' },
    { id: 'e2', tipo: 'nota_interna', autor_tipo: 'equipe', autor: 'Gil', texto: 'Cliente prefere à tarde', dados: {}, interno: true, criado_em: '2026-11-12T12:05:00Z' }],
  encerramento: { empresa_pode_encerrar: false, a_partir_de: null, motivo: null, aviso: 'O encerramento é administrativo e não elimina direitos legais de garantia, reclamação ou contestação.' },
  versao: 4, cliente_id: 'c1', responsavel_auth_id: null, responsavel: null, ver_custo: false,
  materiais: [{ id: 'm1', variacao_id: 'va1', descricao: 'Cabo', produto: 'Cabo flexível', variacao: 'Padrão', origem: 'orcamento', prevista: 3, usada: 0, devolvida: 0,
    reservada: 0, disponivel: 10, versao: 1, usos: [] }],
  pode: { alterar: true, cancelar: true, estoque_propor: true, estoque_aprovar: false, financeiro_criar: true, financeiro_aprovar: false, agenda: true, orcamentos_criar: true },
  equipe: [{ auth_user_id: 'u-tec', nome: 'Técnico Téo' }, { auth_user_id: 'u1', nome: 'Gerente Gil' }], ...extra });
const paraCliente = (o) => {
  const { materiais, pode, equipe, cliente_id: _c, responsavel_auth_id: _r, responsavel: _p, ver_custo: _v, ...resto } = o;
  return { ...resto, valores: valores(), eventos: o.eventos.filter((e) => !e.interno) };
};

async function simular(context, { permissoes = GERENTE, tipo = 'business', os = ordem(), minha = null, erros = {} } = {}) {
  const estado = { corpos: {}, chamadas: [] };
  await context.route('**/js/config/public-config.js', (rota) => rota.fulfill({ contentType: 'text/javascript',
    body: `export const CONFIG_PUBLICA = Object.freeze({ ambiente: 'teste', neonAuthUrl: '${BASE}/auth', neonDataApiUrl: '${BASE}/api' });` }));
  await context.route(`**${BASE}/**`, async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(BASE, '');
    const corpo = req.postData() ? JSON.parse(req.postData()) : null;
    estado.chamadas.push(caminho);
    estado.corpos[caminho] = corpo;
    const json = (status, d, cab = {}) => rota.fulfill({ status, contentType: 'application/json', headers: cab, body: JSON.stringify(d) });
    if (caminho === '/auth/get-session') return json(200, { user: { id: 'u1', name: 'Pessoa', email: 'p@autonick-teste.example', emailVerified: true } }, { 'set-auth-jwt': jwt('u1') });
    if (erros[caminho]?.length) return json(400, erros[caminho].shift());
    switch (caminho) {
      case '/api/perfis_identidade': return json(200, [{ id: 'p1', tipo_conta: tipo, nome: 'Pessoa', criado_em: '2026-11-01T12:00:00Z' }]);
      case '/api/empresas': return json(200, [{ id: EMP, nome_publico: 'Elétrica Fictícia', versao: 1, dado_de_teste: true, situacao_vitrine: 'publicada' }]);
      case '/api/rpc/minhas_permissoes': return json(200, { membro_id: 'm', papel: 'funcionario', perfil_id: null, perfil_nome: 'Serviços', permissoes });
      case '/api/rpc/produtos_da_empresa': return json(200, [{ id: 'pr1', nome: 'Cabo flexível', finalidade: 'uso_interno', variacoes: [{ id: 'va1', padrao: true, rotulo: 'Padrão' }] }]);
      case '/api/rpc/ordens_da_empresa': return json(200, { contagem: { aguardando_inicio: 1, concluida: 2 }, total: 1, equipe: os.equipe,
        itens: [{ id: OS, numero: 2, solicitacao_numero: 5, servico: 'Instalação elétrica', cliente_nome: 'Cliente Clara', origem: 'plataforma', estado: os.estado,
          responsavel: 'Técnico Téo', previsao_conclusao: hoje, revisao_pendente: true, contratado_centavos: 33000, horario: null, reagendamento_pendente: true,
          usos_pendentes: 1, encerramento: os.encerramento, criado_em: '2026-11-12T12:00:00Z' }] });
      case '/api/rpc/os_detalhe': return json(200, os);
      case '/api/rpc/mudar_estado_os': os.estado = { iniciar: 'em_execucao', pausar: 'pausada', retomar: 'em_execucao', concluir: 'concluida' }[corpo.p_acao] ?? os.estado; os.versao += 1; return json(200, os);
      case '/api/rpc/registrar_uso_material': return json(200, { uso_id: 'u9', estado: 'pendente', materiais: os.materiais });
      case '/api/rpc/gerar_antecipacao_os': return json(200, os.valores);
      case '/api/rpc/propor_horario_os':
        if (!corpo.p_aceitar_avisos) return json(200, { gravado: false, avisos: [{ tipo: 'sobreposicao', mensagem: 'Sobrepõe o horário da solicitação nº 3 (16/11 09:00 a 10:00).' }] });
        return json(200, { gravado: true, estado: 'pendente', avisos: [{ tipo: 'sobreposicao' }], reagendamento_id: 'g1' });
      case '/api/rpc/cancelar_os': os.estado = 'cancelada'; return json(200, os);
      case '/api/rpc/propor_custos_cancelamento': return json(200, os);
      case '/api/rpc/agenda_operacional': return json(200, { periodo: { de: corpo.p_de, ate: corpo.p_ate }, aviso: 'Filtro por responsável é informativo.',
        grade: Array.from({ length: 7 }, (_, d) => ({ dia_semana: d, intervalos: [] })), equipe: os.equipe,
        confirmados: [{ solicitacao_id: 's1', solicitacao_numero: 5, os_id: OS, os_numero: 2, os_estado: 'aguardando_inicio', servico: 'Instalação elétrica',
          cliente_nome: 'Cliente Clara', estado: 'aceita', responsavel: 'Técnico Téo', inicio: `${corpo.p_de}T12:00:00Z`, fim: `${corpo.p_de}T14:00:00Z`, avisos: [],
          menos_de_24h: false, reagendamento_pendente: true }],
        propostos: [{ reagendamento_id: 'g2', os_id: OS, os_numero: 2, servico: 'Instalação elétrica', cliente_nome: 'Cliente Clara', tipo: 'alteracao', proposto_por: 'cliente',
          inicio: `${corpo.p_de}T18:00:00Z`, fim: `${corpo.p_de}T19:00:00Z`, motivo: 'Viagem', avisos: [] }],
        os_sem_horario: [{ os_id: 'o2', os_numero: 3, servico: 'Revisão do quadro', cliente_nome: 'Cliente Cauã', estado: 'em_execucao', proposta_pendente: false }],
        solicitacoes_sem_horario: [] });
      case '/api/rpc/minhas_os': return json(200, [{ id: OS, numero: 2, empresa: 'Elétrica Fictícia', servico: 'Instalação elétrica', estado: minha.estado,
        solicitacao_id: 's1', criado_em: '2026-11-12T12:00:00Z', horario: null, acao_pendente: 'responder_horario' }]);
      case '/api/rpc/minha_os': return json(200, minha);
      case '/api/rpc/responder_reagendamento': minha.reagendamentos[0].estado = corpo.p_aceitar ? 'aceito' : 'recusado'; return json(200, { gravado: true, estado: minha.reagendamentos[0].estado });
      case '/api/rpc/pedir_reagendamento_os': case '/api/rpc/responder_custos': case '/api/rpc/cancelar_os_cliente': return json(200, minha);
      case '/api/rpc/registrar_exportacao_pdf': estado.pdf = corpo; return json(200, { registrado: true, documento: corpo.p_documento, formato: 'pdf' });
      default: return json(404, {});
    }
  });
  return estado;
}

const pronto = (page) => expect(page.locator('#conteudo-pagina [aria-busy="true"]')).toHaveCount(0);
const axe = async (page) => expect((await new AxeBuilder({ page }).withTags(AXE).analyze()).violations).toEqual([]);

test('lista de OS: filtros pela situação e responsável, pendências visíveis, menu marcado [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/ordens.html?id=${EMP}`);
  await expect(page.locator('#ordens [data-os]')).toHaveCount(1);
  await expect(page.locator('[data-pendencias]')).toContainText('revisão pedida pelo cliente');
  await expect(page.locator('[data-pendencias]')).toContainText('1 uso(s) de material a confirmar');
  await expect(page.locator('#contagem')).toContainText('Concluída: 2');
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Ordens de serviço', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.locator('#filtro-estado').selectOption('concluida');
  await page.locator('#filtro-responsavel').selectOption('u-tec');
  await page.locator('#form-filtros [type="submit"]').click();
  await pronto(page);
  expect(estado.corpos['/api/rpc/ordens_da_empresa'].p_filtros).toEqual({ estado: 'concluida', responsavel: 'u-tec' });
  await axe(page);
});

test('OS para o gerente: versão em cada estado, pausa pede motivo, horário com aviso confirmado, sinal em centavos, cancelamento com motivo [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/ordem.html?id=${EMP}&os=${OS}`);
  await expect(page.locator('#resumo-os')).toContainText('OS nº 2');
  await expect(page.locator('#linha-do-tempo')).toContainText('só a equipe vê');
  await expect(page.locator('#condicoes-cancelamento')).toContainText('não prevalecem sobre direitos');
  await page.locator('[data-acao="iniciar"]').click();
  await expect(page.locator('#avisos')).toContainText('iniciar');
  expect(estado.corpos['/api/rpc/mudar_estado_os']).toMatchObject({ p_os_id: OS, p_acao: 'iniciar', p_expected_version: 4 });
  await page.locator('[data-acao="pausar"]').click();
  await page.locator('#motivo-pausar').getByRole('button', { name: 'Pausar' }).click();
  await expect(page.locator('#motivo-pausar')).toContainText('Explique o motivo');
  await page.locator('#motivo-pausar-texto').fill('Aguardando a peça do fornecedor.');
  await page.locator('#motivo-pausar').getByRole('button', { name: 'Pausar' }).click();
  await expect(page.locator('#avisos')).toContainText('pausar');
  expect(estado.corpos['/api/rpc/mudar_estado_os']).toMatchObject({ p_acao: 'pausar', p_motivo: 'Aguardando a peça do fornecedor.', p_expected_version: 5 });
  // Horário: avisos sem gravar até a confirmação explícita.
  await page.locator('#horario-data').fill('2099-01-10');
  await page.locator('#horario-hora').fill('09:00');
  await page.locator('#form-horario [type="submit"]').click();
  await expect(page.locator('#aviso-horario')).toContainText('Sobrepõe o horário');
  expect(estado.corpos['/api/rpc/propor_horario_os'].p_aceitar_avisos).toBe(false);
  await page.locator('#aviso-justificativa').fill('Dois técnicos no dia');
  await page.locator('#aviso-horario').getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.locator('#avisos')).toContainText(/proposto/);
  expect(estado.corpos['/api/rpc/propor_horario_os']).toMatchObject({ p_aceitar_avisos: true, p_justificativa: 'Dois técnicos no dia', p_inicio: '2099-01-10T09:00:00-03:00' });
  // Sinal: centavos, nunca o valor contratado.
  await page.locator('#sinal-valor').fill('100,00');
  await page.locator('#form-sinal [type="submit"]').click();
  await expect(page.locator('#avisos')).toContainText('Sinal registrado');
  expect(estado.corpos['/api/rpc/gerar_antecipacao_os']).toMatchObject({ p_os_id: OS, p_valor_centavos: 10000 });
  expect(JSON.stringify(estado.corpos['/api/rpc/gerar_antecipacao_os'])).not.toMatch(/contratado|total/);
  await axe(page);
  // Cancelamento: motivo obrigatório (10 a 300).
  await page.locator('#cancelar-os').click();
  await page.locator('#cancelar-os-motivo').fill('curto');
  await page.getByRole('button', { name: 'Cancelar a OS' }).click();
  await expect(page.locator('#cancelar-os-d')).toContainText('10 a 300');
  await page.locator('#cancelar-os-motivo').fill('Sem material para atender agora.');
  await page.getByRole('button', { name: 'Cancelar a OS' }).click();
  await expect(page.locator('#avisos')).toContainText('cancelada');
  expect(estado.corpos['/api/rpc/cancelar_os']).toMatchObject({ p_motivo: 'Sem material para atender agora.', p_a_pedido_do_cliente: false });
});

test('técnico: registra uso (fica pendente) mas não vê sinal, cancelamento, reserva nem custo [simulação]', async ({ page, context }) => {
  const os = ordem({ estado: 'em_execucao', pode: { alterar: true, cancelar: false, estoque_propor: false, estoque_aprovar: false, financeiro_criar: false,
    financeiro_aprovar: false, agenda: false, orcamentos_criar: false } });
  const estado = await simular(context, { permissoes: TECNICO, os });
  await page.goto(`/business/ordem.html?id=${EMP}&os=${OS}`);
  await pronto(page);
  await expect(page.locator('#form-sinal')).toHaveCount(0);
  await expect(page.locator('#cancelar-os')).toHaveCount(0);
  await expect(page.locator('[data-reservar]')).toHaveCount(0);
  await expect(page.locator('#form-horario')).toHaveCount(0);
  await expect(page.locator('#materiais')).not.toContainText('Custo');
  await page.locator('#material-acao').selectOption('uso');
  await page.locator('#material-qtd').fill('2');
  await page.locator('#form-material [type="submit"]').click();
  await expect(page.locator('#avisos')).toContainText('aguarda confirmação');
  expect(estado.corpos['/api/rpc/registrar_uso_material']).toMatchObject({ p_os_id: OS, p_variacao_id: 'va1', p_quantidade: 2 });
});

test('OS cancelada pelo cliente: custos item por item, total calculado pelo banco [simulação]', async ({ page, context }) => {
  const os = ordem({ estado: 'cancelada', cancelamento: { solicitado_por: 'cliente', motivo: 'Desisti', estado_no_momento: 'em_execucao', criado_em: '2026-11-13T12:00:00Z',
    arrependimento_possivel: false, tinha_condicoes: true, aviso_arrependimento: null } });
  const estado = await simular(context, { os });
  await page.goto(`/business/ordem.html?id=${EMP}&os=${OS}`);
  await expect(page.locator('#cancelamento')).toContainText('a pedido do cliente');
  await page.locator('#propor-custos').click();
  await page.locator('#custo-d0').fill('Ida e volta');
  await page.locator('#custo-v0').fill('30,00');
  await page.locator('#custo-j0').fill('Equipe foi ao endereço.');
  await page.locator('#custo-justificativa').fill('Custos efetivamente incorridos até o cancelamento.');
  await page.getByRole('button', { name: 'Enviar proposta' }).click();
  await expect(page.locator('#avisos')).toContainText('aceita ou contesta');
  const c = estado.corpos['/api/rpc/propor_custos_cancelamento'];
  expect(c.p_itens).toEqual([{ tipo: 'material_usado', descricao: 'Ida e volta', valor_centavos: 3000, justificativa: 'Equipe foi ao endereço.' }]);
  expect(JSON.stringify(c)).not.toMatch(/total|percentual/);
});

test('agenda operacional: confirmados por dia, propostos e OS sem horário; filtro por responsável [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/agenda.html?id=${EMP}`);
  await expect(page.locator('#confirmados [data-compromisso="os"]')).toContainText('OS nº 2');
  await expect(page.locator('#confirmados')).toContainText('continua valendo');
  await expect(page.locator('#propostos')).toContainText('pedido pelo cliente, aguarda a empresa');
  await expect(page.locator('#os-sem-horario')).toContainText('OS nº 3');
  await expect(page.locator('#confirmados [data-dia]')).toHaveCount(7);
  await page.locator('#agenda-visao').selectOption('dia');
  await page.locator('#agenda-responsavel').selectOption('u-tec');
  await page.locator('#form-periodo [type="submit"]').click();
  await pronto(page);
  expect(estado.corpos['/api/rpc/agenda_operacional']).toMatchObject({ p_de: hoje, p_ate: hoje, p_responsavel: 'u-tec' });
  await expect(page.locator('#confirmados [data-dia]')).toHaveCount(1);
  await axe(page);
});

test('cliente: aceita o horário proposto, pede outro com motivo, vê aviso de arrependimento e nada interno [simulação]', async ({ page, context }) => {
  const minha = paraCliente(ordem({ reagendamentos: [{ id: 'g1', tipo: 'definicao', proposto_por: 'empresa', inicio: '2099-01-10T12:00:00Z', fim: '2099-01-10T13:00:00Z',
    motivo: null, estado: 'pendente', resposta_motivo: null, respondido_em: null, concordancia_informada: false, criado_em: '2026-11-13T12:00:00Z', menos_de_24h: false }] }));
  const estado = await simular(context, { tipo: 'cliente', minha });
  await page.goto('/cliente/ordens.html');
  await expect(page.locator('[data-acao-pendente="responder_horario"]')).toContainText('A empresa propôs um horário');
  await page.getByRole('link', { name: 'OS nº 2 · Instalação elétrica' }).click();
  await expect(page.locator('#linha-do-tempo')).not.toContainText('prefere à tarde');
  await expect(page.locator('#valores')).toContainText('não é confirmação bancária');
  await expect(page.locator('#materiais')).toHaveCount(0);
  await page.locator('[data-aceitar-horario]').click();
  await expect(page.locator('#avisos')).toContainText('Horário combinado');
  expect(estado.corpos['/api/rpc/responder_reagendamento']).toMatchObject({ p_reagendamento_id: 'g1', p_aceitar: true });
  await page.locator('#pedir-horario').click();
  await page.locator('#pedir-data').fill('2099-01-11');
  await page.locator('#pedir-hora').fill('15:00');
  await page.locator('#pedir-motivo').fill('Viagem de trabalho nesta data.');
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.locator('#avisos')).toContainText('Pedido enviado');
  expect(estado.corpos['/api/rpc/pedir_reagendamento_os']).toMatchObject({ p_os_id: OS, p_inicio: '2099-01-11T15:00:00-03:00', p_motivo: 'Viagem de trabalho nesta data.' });
  await page.locator('#cancelar-os').click();
  await expect(page.locator('#cancelar-os-d')).toContainText('em até 7 dias do aceite e antes do início');
  await expect(page.locator('#cancelar-os-d')).toContainText('a empresa não pode impedir');
  await page.getByRole('button', { name: 'Voltar' }).click();
  await axe(page);
});

test('cliente contesta custos com texto; acordo e aceite exigem confirmação [simulação]', async ({ page, context }) => {
  const minha = paraCliente(ordem({ estado: 'cancelada', cancelamento: { solicitado_por: 'cliente', motivo: null, estado_no_momento: 'em_execucao', criado_em: '2026-11-13T12:00:00Z',
    arrependimento_possivel: false, tinha_condicoes: true, aviso_arrependimento: null },
  custos: [{ id: 'pc1', numero: 1, itens: [{ tipo: 'deslocamento', descricao: 'Ida e volta', valor_centavos: 3000, justificativa: 'Fomos ao local.' }], justificativa: 'Custos do deslocamento.',
    total_centavos: 3000, estado: 'pendente', contestacao: null, resposta_por: null, respondida_em: null, acordo_valor_centavos: null, acordo_texto: null,
    motivo_retirada: null, tem_titulo: false, versao: 1, criado_em: '2026-11-13T12:10:00Z', aviso: 'Proposta de custos não é dívida: só vale com a sua concordância ou um acordo registrado.' }] }));
  const estado = await simular(context, { tipo: 'cliente', minha });
  await page.goto(`/cliente/ordens.html?os=${OS}`);
  await expect(page.locator('[data-proposta="1"]')).toContainText('não é dívida');
  await page.locator('[data-contestar-custos="1"]').click();
  await page.locator('#contestar-texto').fill('curto');
  await page.getByRole('button', { name: 'Enviar contestação' }).click();
  await expect(page.locator('#contestar-d')).toContainText('10 a 1.000');
  await page.locator('#contestar-texto').fill('Ninguém veio ao endereço nesse dia.');
  await page.getByRole('button', { name: 'Enviar contestação' }).click();
  await expect(page.locator('#avisos')).toContainText('Contestação enviada');
  expect(estado.corpos['/api/rpc/responder_custos']).toMatchObject({ p_proposta_id: 'pc1', p_aceitar: false, p_contestacao: 'Ninguém veio ao endereço nesse dia.', p_expected_version: 1 });
  await axe(page);
});

for (const [caminho, tipo] of [[`/business/ordens.html?id=${EMP}`, 'business'], [`/business/ordem.html?id=${EMP}&os=${OS}`, 'business'],
  [`/business/agenda.html?id=${EMP}`, 'business'], [`/cliente/ordens.html?os=${OS}`, 'cliente']]) {
  test(`360 px sem rolagem horizontal: ${caminho.split('?')[0]} [simulação]`, async ({ page, context }) => {
    await simular(context, { tipo, minha: paraCliente(ordem()) });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(caminho);
    await pronto(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test('M13: resumo da OS em PDF sem notas internas; registro com a OS; sem servicos.visualizar não há tela [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/ordem.html?id=${EMP}&os=${OS}`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar resumo da OS (PDF)' }).click();
  const arquivo = await download;
  expect(arquivo.suggestedFilename()).toBe('os-eletrica-ficticia-numero-2.pdf');
  const pdf = await lerPdfBaixado(arquivo);
  for (const t of ['Resumo da ordem de serviço nº 2', 'Instalação elétrica', 'Cliente Clara', 'Aguardando início', 'Orçamento aceito (versão 1)', 'Instalação', 'Cabo',
    'R$ 330,00', 'Documento interno, sem valor fiscal.']) expect(pdf.texto).toContain(t);
  expect(pdf.texto).not.toContain('Cliente prefere à tarde');
  expect(estado.pdf).toMatchObject({ p_empresa_id: EMP, p_documento: 'os', p_referencia_id: OS });
  const r = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(r.violations).toEqual([]);
});
