/**
 * Telas do M08 (serviços, orçamentos e agenda básica) com SIMULAÇÃO do contrato da Data API. Comprovam a interface:
 * o navegador nunca envia preço nem total, a estimativa é rotulada como não definitiva, o rascunho vai para aprovação
 * quando o perfil não aprova, o aviso de horário pede confirmação explícita, nota interna marcada, aceite só com as
 * condições confirmadas, versão substituída tratada, acessibilidade e 360 px. As regras reais estão em
 * tests/db/servicos.test.mjs e em verificar:neon:m08.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { lerPdfBaixado } from './pdf-util.mjs';

const BASE = '/__neon_simulado';
const EMP = 'e0000000-0000-4000-8000-000000000008';
const AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const TODAS = ['catalogo_servicos.visualizar', 'catalogo_servicos.alterar', 'orcamentos.visualizar', 'orcamentos.criar', 'orcamentos.aprovar',
  'orcamentos.cancelar', 'agenda.visualizar', 'agenda.alterar', 'produtos.visualizar', 'clientes.visualizar'];
const S1 = 's0000000-0000-4000-8000-000000000001';
const SV = 'v0000000-0000-4000-8000-000000000001';
const PQ = { area: 'q0000000-0000-4000-8000-000000000001', acab: 'q0000000-0000-4000-8000-000000000002', mover: 'q0000000-0000-4000-8000-000000000003' };

function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const servico = (extra = {}) => ({ id: SV, empresa_id: EMP, nome: 'Pintura de parede', descricao: 'Parede interna.', categoria_id: null, categoria: null,
  politica_preco: 'por_regras', preco_centavos: null, duracao_min: 120, validade_dias: 15, modalidade: 'analise_manual', exibicao: 'faixa', faixa_percentual: 10,
  ativo: true, versao: 3, solicitacoes_abertas: 1,
  perguntas: [
    { id: PQ.area, ordem: 1, texto: 'Área a pintar', tipo: 'numero', obrigatoria: true, configuracao: { unidade: 'm²', minimo: 1, maximo: 500, casas: 1 } },
    { id: PQ.acab, ordem: 2, texto: 'Acabamento', tipo: 'escolha_unica', obrigatoria: true, configuracao: { opcoes: ['Fosco', 'Brilho'] } },
    { id: PQ.mover, ordem: 3, texto: 'Precisa mover móveis?', tipo: 'sim_nao', obrigatoria: false, configuracao: {} }],
  regras: [{ id: 'r1', ordem: 1, tipo: 'valor_base', pergunta_id: null, rotulo: 'Visita', parametros: { valor_centavos: 5000 } },
    { id: 'r2', ordem: 2, tipo: 'por_quantidade', pergunta_id: PQ.area, rotulo: 'Pintura por m²', parametros: { valor_unitario_centavos: 2500 } }], ...extra });
const estimativa = { completa: true, tipo: 'por_regras', valor_centavos: 41750, minimo_centavos: 37575, maximo_centavos: 45925, exibicao: 'faixa',
  base: [{ rotulo: 'Visita', valor_centavos: 5000 }, { rotulo: 'Pintura por m²', valor_centavos: 31250 }], faltando: [],
  rotulo: 'Estimativa, não é o valor final. O valor só vale depois do orçamento da empresa.' };
const versao = (n, estado, extra = {}) => ({ id: `ver-${n}`, numero: n, tipo: 'manual', estado, estado_exibicao: estado, subtotal_centavos: 39250, desconto_itens_centavos: 0,
  desconto_geral_centavos: 0, total_centavos: 39250, valido_ate: '2099-12-31', prazo_execucao: '2 dias', condicoes: 'Tinta por conta do cliente.', versao: 2,
  componentes: [{ ordem: 1, tipo: 'mao_de_obra', descricao: 'Pintura', quantidade: 12.5, valor_unitario_centavos: 2500, desconto_centavos: 0, total_centavos: 31250 },
    { ordem: 2, tipo: 'material', descricao: 'Massa e lixa', quantidade: 2, valor_unitario_centavos: 4000, desconto_centavos: 0, total_centavos: 8000 }], ...extra });
const solicitacao = (extra = {}) => ({ id: S1, empresa_id: EMP, numero: 7, servico_id: SV, servico: 'Pintura de parede', empresa: 'Pintores Fictícios', origem: 'plataforma',
  cliente_nome: 'Cliente Carla', relato: 'Pintar a sala, parede com mofo.', cidade: 'Campinas', bairro: 'Cambuí',
  preferencia: { datas: ['2099-01-10'], turno: 'manha', observacao: 'Cedo', reserva: false },
  respostas: [{ pergunta_id: PQ.area, texto: 'Área a pintar', tipo: 'numero', valor: 12.5, unidade: 'm²' }, { pergunta_id: PQ.acab, texto: 'Acabamento', tipo: 'escolha_unica', valor: 'Fosco' }],
  estimativa, estado: 'em_analise', estado_exibicao: 'em_analise', versao: 4, versao_vigente_id: null, versoes: [], horario: null, historico_horarios: [],
  servico_atual: { versao: 3, ativo: true, validade_dias: 15, duracao_min: 120 }, horarios_gerais: [], limite_desconto_percentual: 10,
  eventos: [{ id: 'e1', tipo: 'criada', autor_tipo: 'cliente', autor: 'Cliente Carla', texto: null, dados: {}, interno: false, criado_em: '2026-11-12T12:00:00Z' },
    { id: 'e2', tipo: 'nota_interna', autor_tipo: 'equipe', autor: 'Ana', texto: 'Ligar antes', dados: {}, interno: true, criado_em: '2026-11-12T12:05:00Z' }],
  pode: { criar: true, aprovar: false, cancelar: true, agenda: true }, ...extra });
const grade = Array.from({ length: 7 }, (_, d) => ({ dia_semana: d, intervalos: d > 0 && d < 6 ? [{ abre: '08:00', fecha: '12:00' }] : [] }));

async function simular(context, { permissoes = TODAS, tipo = 'business', erros = {}, sol = solicitacao(), minha = null } = {}) {
  const estado = { chamadas: [], corpos: {}, horario: 0 };
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
      case '/api/empresas': return json(200, [{ id: EMP, nome_publico: 'Pintores Fictícios', versao: 1, dado_de_teste: true, situacao_vitrine: 'publicada' }]);
      case '/api/categorias_plataforma': return json(200, [{ id: 'c1', nome: 'Construção e reformas', slug: 'construcao' }]);
      case '/api/rpc/minhas_permissoes': return json(200, { membro_id: 'm', papel: 'funcionario', perfil_id: null, perfil_nome: 'Atendimento', permissoes });
      case '/api/rpc/servicos_da_empresa': return json(200, [servico(), servico({ id: 'sv2', nome: 'Troca de óleo', politica_preco: 'fixo', preco_centavos: 9000, perguntas: [], regras: [] })]);
      case '/api/rpc/criar_servico': return json(200, servico({ id: 'sv3', nome: corpo.p_dados.nome }));
      case '/api/rpc/alterar_servico': case '/api/rpc/salvar_formulario_servico': case '/api/rpc/salvar_regras_servico': return json(200, { ...servico(), regras_desativadas: 0 });
      case '/api/rpc/estimar_servico': return json(200, estimativa);
      case '/api/rpc/solicitacoes_da_empresa': return json(200, { contagem: { em_analise: 1, aceita: 2 }, total: 1, itens: [{ id: S1, numero: 7, servico: 'Pintura de parede',
        cliente_nome: 'Cliente Carla', origem: 'plataforma', estado: 'em_analise', estado_exibicao: 'em_analise', total_vigente_centavos: null, estimativa, criado_em: '2026-11-12T12:00:00Z',
        horario: null, tem_rascunho: false, aguardando_aprovacao: false }] });
      case '/api/rpc/clientes_da_empresa': return json(200, [{ id: 'cl1', nome: 'Seu Joaquim', ativo: true }]);
      case '/api/rpc/produtos_da_empresa': return json(200, [{ id: 'pr1', nome: 'Graxa', finalidade: 'uso_interno', variacoes: [{ id: 'va1', padrao: true, rotulo: 'Padrão' }] }]);
      case '/api/rpc/solicitacao_detalhe': return json(200, sol);
      case '/api/rpc/salvar_rascunho_orcamento': sol.versoes = [versao(1, 'rascunho', { criada_por: 'Ana' })]; return json(200, sol.versoes[0]);
      case '/api/rpc/enviar_orcamento': sol.versoes = [versao(1, 'aguardando_aprovacao', { criada_por: 'Ana' })]; return json(200, sol.versoes[0]);
      case '/api/rpc/registrar_mensagem': return json(200, sol);
      case '/api/rpc/confirmar_horario':
        estado.horario += 1;
        if (!corpo.p_aceitar_avisos) return json(200, { confirmado: false, avisos: [{ tipo: 'sobreposicao', mensagem: 'Sobrepõe o horário da solicitação nº 3 (16/11 09:00 a 10:00).' }] });
        sol.horario = { inicio: corpo.p_inicio, fim: corpo.p_inicio, confirmado_pela_empresa: true, aviso: 'Horário definido pela empresa. Se não puder, peça outro horário pela mensagem.' };
        return json(200, { confirmado: true, avisos: [{ tipo: 'sobreposicao' }], horario: { id: 'h1', inicio: corpo.p_inicio } });
      // M09: a agenda passou a usar a visão operacional (D9-17); a grade e as solicitações sem horário continuam.
      case '/api/rpc/agenda_operacional': return json(200, { periodo: { de: corpo.p_de, ate: corpo.p_ate }, grade, aviso: 'Filtro por responsável é informativo.', equipe: [],
        confirmados: [{ solicitacao_id: S1, solicitacao_numero: 7, os_id: null, servico: 'Pintura de parede', cliente_nome: 'Cliente Carla', estado: 'orcamento_enviado',
          inicio: `${corpo.p_de}T12:00:00Z`, fim: `${corpo.p_de}T14:00:00Z`, avisos: [] }], propostos: [], os_sem_horario: [],
        solicitacoes_sem_horario: [{ solicitacao_id: 's2', numero: 8, servico: 'Pintura de parede', cliente_nome: 'Cliente César', estado: 'nova', preferencia: { datas: ['2099-01-12'], turno: 'tarde' } }] });
      case '/api/rpc/salvar_horarios_empresa': return json(200, { grade: corpo.p_grade });
      case '/api/rpc/excecoes_agenda': return json(200, estado.excecoes ?? []);
      case '/api/rpc/compromissos_agenda': return json(200, estado.compromissos ?? []);
      case '/api/rpc/salvar_compromisso_agenda': {
        estado.tentativas = [...(estado.tentativas ?? []), corpo];
        const avisos = [{ tipo: 'compromisso', mensagem: 'Sobrepõe o compromisso "Visita" (10/01 10:00 a 11:00).' }];
        if (!corpo.p_aceitar_avisos) return json(200, { gravado: false, avisos });
        const c = { id: 'c1', tipo: corpo.p_dados.tipo, titulo: corpo.p_dados.titulo, inicio: corpo.p_dados.inicio,
          fim: new Date(Date.parse(corpo.p_dados.inicio) + corpo.p_dados.duracao_min * 60000).toISOString(), avisos, versao: 1, criado_por: 'Pessoa' };
        estado.compromissos = [c];
        return json(200, { gravado: true, avisos, compromisso: c });
      }
      case '/api/rpc/salvar_excecao_agenda': {
        const x = { id: 'x1', data: corpo.p_data, tipo: corpo.p_tipo, intervalos: corpo.p_intervalos, motivo: corpo.p_motivo, criado_por: 'Pessoa' };
        estado.excecoes = [x];
        return json(200, x);
      }
      case '/api/rpc/empresas_para_pedido': return json(200, [{ id: EMP, nome: 'Pintores Fictícios', cidade: 'Campinas' }]);
      case '/api/rpc/servicos_para_cliente': return json(200, { empresa: { id: EMP, nome: 'Pintores Fictícios' }, horarios: grade, aviso: 'A estimativa não é o valor final.',
        servicos: [(({ regras, solicitacoes_abertas, ...x }) => x)(servico())] });
      case '/api/rpc/criar_solicitacao': return json(200, { ...solicitacao(), estado: 'nova', numero: 9 });
      case '/api/rpc/minhas_solicitacoes': return json(200, [{ id: S1, numero: 7, empresa: 'Pintores Fictícios', servico: 'Pintura de parede', estado: 'orcamento_enviado',
        estado_exibicao: 'orcamento_enviado', total_vigente_centavos: 39250, valido_ate: '2099-12-31', criado_em: '2026-11-12T12:00:00Z', horario: null }]);
      case '/api/rpc/minha_solicitacao': return json(200, minha);
      case '/api/rpc/aceitar_orcamento': minha.estado = 'aceita'; minha.estado_exibicao = 'aceita'; return json(200, minha);
      case '/api/rpc/registrar_exportacao_pdf': estado.pdf = corpo; return json(200, { registrado: true, documento: corpo.p_documento, formato: 'pdf' });
      default: return json(404, {});
    }
  });
  return estado;
}

const pronto = (page) => expect(page.locator('#conteudo-pagina [aria-busy="true"]')).toHaveCount(0);
const axe = async (page) => expect((await new AxeBuilder({ page }).withTags(AXE).analyze()).violations).toEqual([]);

test('catálogo: preço exigido no fixo, nada de total enviado; modalidade automática explicada [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/servicos.html?id=${EMP}`);
  await expect(page.locator('#lista-servicos [data-servico]')).toHaveCount(2);
  await expect(page.locator('#lista-servicos')).toContainText('Calculado por regras');
  await page.locator('#abrir-novo-servico').click();   // pacote 27/11: lista primeiro, cadastro sob demanda
  await page.locator('#novo-servico-nome').fill('Troca de chuveiro');
  await page.locator('#novo-servico-politica').selectOption('fixo');
  await page.locator('#novo-servico [type="submit"]').click();
  await expect(page.locator('#novo-servico-preco-erro')).toContainText(/valor|Informe/i);
  await page.locator('#novo-servico-preco').fill('150,00');
  await page.locator('#novo-servico [type="submit"]').click();
  await expect(page.locator('#avisos')).toContainText('cadastrado');
  expect(estado.corpos['/api/rpc/criar_servico'].p_dados).toMatchObject({ nome: 'Troca de chuveiro', politica_preco: 'fixo', preco_centavos: 15000, modalidade: 'analise_manual' });
  expect(JSON.stringify(estado.corpos['/api/rpc/criar_servico'])).not.toContain('total');
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Serviços', exact: true })).toHaveAttribute('aria-current', 'page');
  await axe(page);
});

test('formulário e regras: pergunta nova salva; simulação mostra faixa e o aviso de não definitiva [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/servico.html?id=${EMP}&servico=${SV}`);
  await expect(page.locator('[data-pergunta]')).toHaveCount(3);
  await page.locator('#adicionar-pergunta').click();
  await page.locator('#perg-3-texto').fill('Cor desejada');
  await page.locator('#form-perguntas [type="submit"]').click();
  await expect(page.locator('#avisos')).toContainText('Formulário salvo');
  expect(estado.corpos['/api/rpc/salvar_formulario_servico'].p_perguntas.at(-1)).toMatchObject({ texto: 'Cor desejada', tipo: 'texto_curto' });
  expect(estado.corpos['/api/rpc/salvar_formulario_servico'].p_perguntas[0].id).toBe(PQ.area);
  await page.locator('#sim-' + PQ.area).fill('12,5');
  await page.locator('#form-simulacao [type="submit"]').click();
  await expect(page.locator('#estimativa-simulada')).toContainText('Entre R$');
  await expect(page.locator('#estimativa-simulada')).toContainText('não é o valor final');
  expect(estado.corpos['/api/rpc/estimar_servico'].p_respostas[PQ.area]).toBe(12.5);
  await axe(page);
});

test('solicitação: rascunho sem total, envio vai para aprovação, aviso de horário pede confirmação e nota interna marcada [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/solicitacao.html?id=${EMP}&solicitacao=${S1}`);
  await expect(page.locator('#respostas')).toContainText('12,5 m²');
  await expect(page.locator('#respostas')).toContainText('não é reserva');
  await expect(page.locator('#linha-do-tempo')).toContainText('só a equipe vê');
  await expect(page.locator('[data-item]')).toHaveCount(2);   // vem da base da estimativa
  await page.locator('#item-0-descricao').fill('Pintura da sala');
  await page.locator('#form-orcamento [type="submit"]').click();
  await expect(page.locator('#avisos')).toContainText('Rascunho da versão 1');
  const r = estado.corpos['/api/rpc/salvar_rascunho_orcamento'];
  expect(r.p_dados.componentes[0]).toMatchObject({ descricao: 'Pintura da sala', quantidade: 1, valor_unitario_centavos: 5000 });
  expect(JSON.stringify(r)).not.toContain('total');
  await page.locator('[data-enviar="1"]').click();
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.locator('#avisos')).toContainText('aguardando aprovação interna');
  // Horário com aviso de sobreposição: nada é gravado até a confirmação explícita.
  await page.locator('#horario-data').fill('2099-01-10');
  await page.locator('#horario-hora').fill('09:00');
  await page.locator('#form-horario [type="submit"]').click();
  await expect(page.locator('#aviso-horario')).toContainText('Sobrepõe o horário');
  expect(estado.corpos['/api/rpc/confirmar_horario'].p_aceitar_avisos).toBe(false);
  await page.locator('#aviso-justificativa').fill('Dois pintores no dia');
  await page.getByRole('button', { name: 'Confirmar o horário' }).click();
  await expect(page.locator('#avisos')).toContainText('aviso registrado');
  expect(estado.corpos['/api/rpc/confirmar_horario']).toMatchObject({ p_aceitar_avisos: true, p_justificativa: 'Dois pintores no dia', p_inicio: '2099-01-10T09:00:00-03:00' });
  await page.locator('#mensagem-texto').fill('Cliente pediu desconto');
  await page.locator('#form-mensagem [type="submit"]').click();
  await expect(page.locator('#avisos')).toContainText('Nota interna registrada');
  expect(estado.corpos['/api/rpc/registrar_mensagem'].p_interna).toBe(true);
  await axe(page);
});

test('sem orcamentos.criar: sem editor e sem mensagem; sem agenda.alterar: sem definir horário [simulação]', async ({ page, context }) => {
  await simular(context, { permissoes: ['orcamentos.visualizar'] });
  await page.goto(`/business/solicitacao.html?id=${EMP}&solicitacao=${S1}`);
  await pronto(page);
  await expect(page.locator('#respostas')).toBeVisible();
  await expect(page.locator('#form-orcamento')).toHaveCount(0);
  await expect(page.locator('#form-mensagem')).toHaveCount(0);
  await expect(page.locator('#form-horario')).toHaveCount(0);
});

test('agenda: grade com 2 intervalos por dia; confirmados e sem horário com a preferência (não é reserva) [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/agenda.html?id=${EMP}`);
  await expect(page.locator('#confirmados')).toContainText('Solicitação nº 7');
  await expect(page.locator('#sem-horario')).toContainText('não é reserva');
  await page.getByRole('tab', { name: 'Horários de atendimento' }).click();
  await page.locator('#d1-1-abre').fill('13:00');
  await page.locator('#form-grade [type="submit"]').click();
  await expect(page.locator('#d1-1-fecha-erro')).toContainText('abertura e fechamento');
  await page.locator('#d1-1-fecha').fill('18:00');
  await page.locator('#form-grade [type="submit"]').click();
  await expect(page.locator('#avisos')).toContainText('salvos');
  const g = estado.corpos['/api/rpc/salvar_horarios_empresa'].p_grade;
  expect(g).toHaveLength(7);
  expect(g[1].intervalos).toEqual([{ abre: '08:00', fecha: '12:00' }, { abre: '13:00', fecha: '18:00' }]);
  expect(g[0].intervalos).toEqual([]);
  await axe(page);
});

test('agenda E04: visão Mês e exceção de horário especial validada antes de enviar [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/agenda.html?id=${EMP}`);
  await expect(page.locator('#confirmados')).toContainText('Solicitação nº 7');
  await page.locator('[data-visao="mes"]').click();
  await expect(page.locator('#confirmados .mes__dia')).toHaveCount(42);
  await expect(page.locator('#confirmados')).toContainText('Sol. 7');
  await page.getByRole('tab', { name: /Feriados e exceções/ }).click();
  const amanha = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await page.locator('#excecao-data').fill(amanha);
  await page.getByLabel('Horário especial').check();
  await page.locator('#excecao-abre1').fill('14:00');
  await page.locator('#excecao-fecha1').fill('10:00');
  await page.locator('#excecao-motivo').fill('Meio período');
  await page.getByRole('button', { name: 'Salvar exceção' }).click();
  await expect(page.locator('#excecao-fecha1-erro')).toContainText('depois da abertura');
  expect(estado.corpos['/api/rpc/salvar_excecao_agenda']).toBeUndefined();
  await page.locator('#excecao-abre1').fill('09:00');
  await page.locator('#excecao-fecha1').fill('12:00');
  await page.getByRole('button', { name: 'Salvar exceção' }).click();
  await expect(page.locator('#avisos')).toContainText('Exceção salva');
  expect(estado.corpos['/api/rpc/salvar_excecao_agenda']).toMatchObject({ p_data: amanha, p_tipo: 'horario_especial', p_intervalos: [{ abre: '09:00', fecha: '12:00' }], p_motivo: 'Meio período' });
  await expect(page.getByRole('tab', { name: /Feriados e exceções/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#lista-excecoes')).toContainText('Horário especial: 09:00 às 12:00');
  await axe(page);
});

test('agenda E04: compromisso com conflito só grava depois de "Salvar mesmo assim", com chave nova [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/agenda.html?id=${EMP}`);
  await page.getByRole('button', { name: 'Novo compromisso' }).click();
  const modal = page.getByRole('dialog', { name: 'Novo compromisso' });
  await modal.getByRole('button', { name: 'Criar compromisso' }).click();
  await expect(page.locator('#compromisso-titulo-erro')).toContainText('título');
  await page.locator('#compromisso-titulo').fill('Reunião com fornecedor');
  await page.locator('#compromisso-hora').fill('10:30');
  await modal.getByRole('button', { name: 'Criar compromisso' }).click();
  await expect(modal).toContainText('Sobrepõe o compromisso "Visita"');
  await expect(modal).toContainText('Nada foi gravado ainda.');
  await axe(page);
  await modal.getByRole('button', { name: 'Salvar mesmo assim' }).click();
  await expect(page.locator('#avisos')).toContainText('Compromisso criado.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const [primeira, segunda] = estado.tentativas;
  expect(primeira.p_aceitar_avisos).toBe(false);
  expect(segunda.p_aceitar_avisos).toBe(true);
  expect(segunda.p_operation_key).not.toEqual(primeira.p_operation_key);
  expect(segunda.p_dados).toMatchObject({ tipo: 'compromisso', titulo: 'Reunião com fornecedor', duracao_min: 60 });
  await expect(page.locator('[data-interno="c1"]')).toContainText('Reunião com fornecedor');
});

test('orçamentos E05: visão Funil com colunas das etapas reais, contagens do banco e link para o orçamento [simulação]', async ({ page, context }) => {
  const estado = await simular(context);
  await page.goto(`/business/solicitacoes.html?id=${EMP}`);
  await page.locator('[data-visao="funil"]').click();
  await expect(page.locator('.funil__coluna')).toHaveCount(5);
  await expect(page.locator('[data-etapa="em_analise"]')).toContainText('Nº 7');
  await expect(page.locator('[data-etapa="em_analise"] .abas__contador')).toHaveText('1');
  await expect(page.locator('[data-etapa="nova"]')).toContainText('Nada nesta etapa.');
  await expect(page).toHaveURL(/#funil$/);
  expect(estado.corpos['/api/rpc/solicitacoes_da_empresa']).toBeTruthy();
  await page.reload();
  await expect(page.locator('#funil')).toBeVisible();
  await axe(page);
});

test('cliente pede orçamento: estimativa do banco, respostas sem preço, sem endereço, preferência opcional [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { tipo: 'cliente' });
  // M11 (D11-03): a tela abre com a empresa vinda da vitrine; não há seletor avulso de empresas.
  await page.goto(`/cliente/servicos.html?empresa=${EMP}`);
  await expect(page.locator('#cli-empresa')).toHaveCount(0);
  await page.locator(`[data-escolher="${SV}"]`).click();
  await page.locator('#form-solicitacao [type="submit"]').click();
  await expect(page.locator(`#cli-${PQ.area}-erro`)).toContainText('Responda');
  await page.locator(`#cli-${PQ.area}`).fill('12,5');
  await page.locator(`#cli-${PQ.acab}`).selectOption('Fosco');
  await page.locator('#ver-estimativa').click();
  // P-M11-02: na tela que mostra só a estimativa, o Cliente vê o aviso fixo de valor estimado.
  await expect(page.locator('#estimativa')).toContainText('Este é um valor estimado. Confira o orçamento antes de aceitar.');
  await page.locator('#cli-relato').fill('Pintar a sala, parede com mofo.');
  await page.locator('#cli-data1').fill('2099-01-10');
  await page.locator('#form-solicitacao [type="submit"]').click();
  await expect(page.locator('#conteudo-pagina')).toContainText('Nenhum horário foi reservado');
  const c = estado.corpos['/api/rpc/criar_solicitacao'];
  expect(c.p_dados.respostas).toEqual({ [PQ.area]: 12.5, [PQ.acab]: 'Fosco' });
  expect(c.p_dados.preferencia).toMatchObject({ datas: ['2099-01-10'], turno: 'qualquer' });
  expect(JSON.stringify(c)).not.toMatch(/preco|total|endereco/);
  await axe(page);
});

test('cliente aceita só com as condições marcadas; versão substituída é avisada e a tela atualiza [simulação]', async ({ page, context }) => {
  const minha = solicitacao({ estado: 'orcamento_enviado', estado_exibicao: 'orcamento_enviado', versao_vigente_id: 'ver-2',
    versoes: [versao(2, 'enviada'), versao(1, 'substituida')], eventos: [solicitacao().eventos[0]] });
  for (const v of minha.versoes) delete v.criada_por;
  const estado = await simular(context, { tipo: 'cliente', minha, erros: { '/api/rpc/aceitar_orcamento': [{ code: 'P0001', hint: 'QUOTE_VERSION_STALE', message: 'Esta versão do orçamento foi substituída. Veja a versão atual.', details: '' }] } });
  await page.goto(`/cliente/solicitacoes.html?s=${S1}`);
  await expect(page.locator('[data-versao]')).toHaveCount(2);
  await expect(page.locator('[data-aceitar]')).toHaveCount(1);
  await expect(page.locator('#linha-do-tempo')).not.toContainText('Ligar antes');
  await page.locator('[data-aceitar="2"]').click();
  await page.getByRole('button', { name: 'Aceitar', exact: true }).click();
  await expect(page.locator('#aceite')).toContainText('Marque para confirmar');
  await page.locator('#aceite-condicoes').check();
  await page.getByRole('button', { name: 'Aceitar', exact: true }).click();
  await expect(page.locator('#avisos')).toContainText('foi substituída');
  await page.locator('[data-aceitar="2"]').click();
  await page.locator('#aceite-condicoes').check();
  await page.getByRole('button', { name: 'Aceitar', exact: true }).click();
  await expect(page.locator('#avisos')).toContainText('Orçamento aceito');
  expect(estado.corpos['/api/rpc/aceitar_orcamento']).toMatchObject({ p_solicitacao_id: S1, p_versao_id: 'ver-2', p_condicoes_aceitas: true });
  await axe(page);
});

for (const caminho of [`/business/servicos.html?id=${EMP}`, `/business/servico.html?id=${EMP}&servico=${SV}`, `/business/solicitacoes.html?id=${EMP}`,
  `/business/solicitacao.html?id=${EMP}&solicitacao=${S1}`, `/business/agenda.html?id=${EMP}`]) {
  test(`360 px sem rolagem horizontal: ${caminho.split('?')[0]} [simulação]`, async ({ page, context }) => {
    await simular(context);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(caminho);
    await pronto(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test('M13: comprovante só do orçamento aceito, com itens e total; sem versão aceita não há botão [simulação]', async ({ page, context }) => {
  const estado = await simular(context, { sol: solicitacao({ estado: 'aceita', estado_exibicao: 'aceita', os: { id: 'os-1', numero: 3 },
    versoes: [versao(2, 'aceita', { aceite: { aceito_em: '2026-11-16T13:00:00Z' } }), versao(1, 'substituida')] }) });
  await page.goto(`/business/solicitacao.html?id=${EMP}&solicitacao=${S1}`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar comprovante do orçamento aceito (PDF)' }).click();
  const pdf = await lerPdfBaixado(await download);
  for (const t of ['Comprovante de orçamento aceito: solicitação nº 7, versão 2', 'Pintura de parede', 'Pintura', 'Massa e lixa', 'R$ 392,50',
    'Tinta por conta do cliente.', 'Documento interno, sem valor fiscal.']) expect(pdf.texto).toContain(t);
  expect(estado.pdf).toMatchObject({ p_documento: 'orcamento', p_referencia_id: 'ver-2' });
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await simular(context, { sol: solicitacao({ versoes: [versao(1, 'enviada')] }) });
  await page.goto(`/business/solicitacao.html?id=${EMP}&solicitacao=${S1}`);
  await expect(page.locator('#versoes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Baixar comprovante do orçamento aceito (PDF)' })).toHaveCount(0);
});
