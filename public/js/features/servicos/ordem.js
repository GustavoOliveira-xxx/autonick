/**
 * Detalhe da ordem de serviço para a empresa (M09, RF-102 a RF-112, RF-116 a RF-118; D9-01 a D9-27): estados com versão,
 * responsável e previsão, horário por acordo e reagendamento, materiais com reserva, uso pendente e baixa, sinal e saldo
 * a receber (recebimento pelo financeiro do M07), cancelamento, custos com contestação, garantia, recorrência e linha do
 * tempo com notas internas. Cada botão só aparece com a combinação de permissões que o banco também exige.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, erroNoCampo, limparErros, ocupado, valores } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { secaoConversa } from '../comunicacao/conversa.js';
import { lerValorEmReais } from '../../domain/moeda.js';
import { instanteSaoPaulo } from '../../domain/servicos.js';
import { produtosDaEmpresa } from '../../data/estoque.js';
import { ordem as lerOrdem, mudarEstado, atualizarDados, publicarAtualizacao, registrarGarantia, gerarProxima, adicionarMaterial, reservarMaterial,
  registrarUso, decidirUso, devolverMaterial, gerarSinal, reparcelar, cancelarOs, proporCustos, responderCustos, revisarCustos, retirarCustos,
  registrarAcordo, gerarTituloCustos, proporHorario, responderReagendamento, retirarReagendamento, cancelarHorario,
  ACAO_OS, ACOES_POR_ESTADO, TIPO_CUSTO, RECORRENCIA, ESTADOS_ATIVOS } from '../../data/ordens.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, dialogoFormulario, dinheiro, dataDeHoje } from './comum.js';
import { chipOs, blocoValores, linhaDoTempoOs, blocoHorarioOs, itemReagendamento, cartaoCustos, blocoCancelamento, blocoGarantia, blocoCondicoes } from './ordens-comum.js';
import { botaoPdf, nomeDeQuemGera } from '../../pdf/baixar.js';
import { registrarExportacaoPdf } from '../../data/exportacao.js';
import { resumoOs } from '../../pdf/documentos.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
const osId = parametro('os');
let ctx = null;
let o = null;
let catalogo = null;
const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });
const ativa = () => ESTADOS_ATIVOS.includes(o.estado);
const secao = (id, titulo, ...partes) => el('section', { class: 'pilha', 'aria-labelledby': id }, el('h2', { id }, titulo), ...partes.filter(Boolean));
const texto = (min, max, mensagem) => (form, nome) => {
  const t = (valores(form)[nome] ?? '').trim();
  if (t.length < min || t.length > max) { erroNoCampo(form, nome, mensagem); return null; }
  return t;
};
// Sem acesso ao catálogo (ex.: técnico), a escolha fica entre os materiais já previstos na OS.
const opcoesCatalogo = () => {
  const doCatalogo = (catalogo ?? []).flatMap((p) => p.variacoes.map((v) => [v.id, `${p.nome}${v.padrao ? '' : ` (${v.rotulo})`}`]));
  return doCatalogo.length ? doCatalogo : o.materiais.map((m) => [m.variacao_id, `${m.produto}${m.variacao && m.variacao !== 'Padrão' ? ` (${m.variacao})` : ''}`]);
};

// --- Estados -------------------------------------------------------------------
function botoesEstado() {
  if (!o.pode.alterar) return [];
  return (ACOES_POR_ESTADO[o.estado] ?? []).filter((a) => a !== 'encerrar' || o.encerramento.empresa_pode_encerrar).map((acao) => {
    const b = el('button', { type: 'button', class: acao === 'concluir' || acao === 'iniciar' ? 'botao' : 'botao botao--secundario', 'data-acao': acao }, ACAO_OS[acao]);
    b.addEventListener('click', () => ocupado(b, async () => {
      let motivo = null;
      if (acao === 'pausar' || acao === 'reabrir') {
        const r = await dialogoFormulario({ id: `motivo-${acao}`, titulo: acao === 'pausar' ? 'Pausar a OS' : 'Reabrir para revisão', rotuloConfirmar: ACAO_OS[acao],
          descricao: [acao === 'pausar' ? 'O motivo fica só para a equipe; o cliente vê apenas que o serviço está pausado.'
            : 'O motivo aparece para o cliente no histórico da OS. Não escreva informações internas da equipe.'],
          campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, linhas: 2, max: 300, id: `motivo-${acao}-texto`,
            ajuda: acao === 'pausar' ? 'De 5 a 300 caracteres.' : 'De 10 a 300 caracteres. Visível para o cliente.' })],
          validar: (f) => { const m = texto(acao === 'pausar' ? 5 : 10, 300, 'Explique o motivo.')(f, 'motivo'); return m ? { motivo: m } : null; } });
        if (!r) return;
        motivo = r.motivo;
      }
      if (acao === 'concluir' || acao === 'encerrar') {
        const ok = await abrirDialogo({ titulo: acao === 'concluir' ? 'Informar a conclusão?' : 'Encerrar a OS?', rotuloConfirmar: ACAO_OS[acao], rotuloCancelar: 'Voltar',
          mensagens: acao === 'concluir'
            ? ['As reservas de material desta OS são liberadas.', 'Se ainda não houver, nasce a conta a receber do saldo (valor contratado menos o sinal), com vencimento hoje. Nenhum recebimento é registrado.',
              'O cliente pode confirmar o recebimento ou pedir revisão.']
            : ['A OS é encerrada pela empresa. Isso não é a confirmação de recebimento pelo cliente e não registra pagamento: a conta a receber continua como está.',
              o.encerramento.aviso] });
        if (!ok) return;
      }
      await executar(`estado-${acao}`, null, (k) => mudarEstado(o.id, acao, motivo, o.versao, k), () => anunciar('sucesso', `Ação registrada: ${ACAO_OS[acao].toLowerCase()}.`));
    }));
    return b;
  });
}

// --- Dados ---------------------------------------------------------------------
function secaoDados() {
  const dl = el('dl', { class: 'dados' }, el('dt', {}, 'Responsável'), el('dd', {}, o.responsavel ?? 'Sem responsável definido'),
    el('dt', {}, 'Previsão de conclusão'), el('dd', {}, o.previsao_conclusao ? o.previsao_conclusao.split('-').reverse().join('/') : 'Sem previsão informada'),
    el('dt', {}, 'Recorrência'), el('dd', {}, o.recorrencia ? RECORRENCIA[o.recorrencia] : 'Não recorrente'));
  if (!o.pode.alterar || o.estado === 'cancelada') return secao('titulo-dados', 'Dados da OS', dl);
  const salvar = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Salvar dados');
  const form = el('form', { class: 'pilha', id: 'form-dados', novalidate: true },
    campoSelecao({ nome: 'responsavel_auth_id', rotulo: 'Responsável', opcoes: o.equipe.map((m) => [m.auth_user_id, m.nome]), valor: o.responsavel_auth_id ?? '',
      vazio: 'Sem responsável', id: 'dados-responsavel', ajuda: 'Informativo: não há agenda por funcionário nesta etapa.' }),
    campoTexto({ nome: 'previsao_conclusao', rotulo: 'Previsão de conclusão', tipo: 'date', valor: o.previsao_conclusao ?? '', id: 'dados-previsao',
      ajuda: 'O cliente vê a previsão. Deixe em branco se não houver.' }),
    campoSelecao({ nome: 'recorrencia', rotulo: 'Recorrência', opcoes: Object.entries(RECORRENCIA), valor: o.recorrencia ?? '', vazio: 'Não recorrente', id: 'dados-recorrencia',
      ajuda: 'A próxima execução só é gerada quando você pedir, depois do encerramento.' }),
    el('div', { class: 'grupo-botoes' }, salvar));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    const dados = { responsavel_auth_id: d.responsavel_auth_id || null, previsao_conclusao: d.previsao_conclusao || null, recorrencia: d.recorrencia || null };
    return ocupado(salvar, () => executar('dados', form, (k) => atualizarDados(o.id, dados, o.versao, k), () => anunciar('sucesso', 'Dados da OS salvos.')));
  });
  return secao('titulo-dados', 'Dados da OS', dl, form);
}

// --- Horário -------------------------------------------------------------------
function secaoHorario() {
  const pend = o.reagendamentos.filter((g) => g.estado === 'pendente');
  const itens = o.reagendamentos.map((g) => {
    const acoes = [];
    if (g.estado === 'pendente' && g.proposto_por === 'cliente' && o.pode.agenda) {
      const aceitar = el('button', { type: 'button', class: 'botao', 'data-aceitar-horario': '' }, 'Aceitar este horário');
      aceitar.addEventListener('click', () => ocupado(aceitar, async () => {
        const r = await executar(`aceitar-${g.id}`, null, (k) => responderReagendamento(g.id, true, null, false, null, k), () => {});
        if (r && r.gravado === false) {
          const j = await dialogoFormulario({ id: 'aviso-reag', titulo: 'Aceitar mesmo assim?', rotuloConfirmar: 'Aceitar o horário', descricao: r.avisos.map((a) => a.mensagem),
            campos: [campoTexto({ nome: 'justificativa', rotulo: 'Justificativa (opcional)', max: 300, id: 'aviso-reag-justificativa' })], validar: (f) => valores(f) });
          if (!j) return;
          await executar(`aceitar-aviso-${g.id}`, null, (k) => responderReagendamento(g.id, true, null, true, j.justificativa, k), () => anunciar('sucesso', 'Novo horário aceito com o aviso registrado.'));
        } else if (r) anunciar('sucesso', 'Novo horário aceito.');
      }));
      const recusar = el('button', { type: 'button', class: 'botao botao--secundario', 'data-recusar-horario': '' }, 'Recusar');
      recusar.addEventListener('click', () => ocupado(recusar, async () => {
        const r = await dialogoFormulario({ id: 'recusa-reag', titulo: 'Recusar o horário pedido', rotuloConfirmar: 'Recusar', descricao: ['O cliente vê o motivo. O horário atual continua valendo.'],
          campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, max: 300, id: 'recusa-reag-motivo', ajuda: 'De 5 a 300 caracteres.' })],
          validar: (f) => { const m = texto(5, 300, 'Explique com 5 a 300 caracteres.')(f, 'motivo'); return m ? { motivo: m } : null; } });
        if (!r) return;
        await executar(`recusar-${g.id}`, null, (k) => responderReagendamento(g.id, false, r.motivo, false, null, k), () => anunciar('sucesso', 'Pedido recusado.'));
      }));
      acoes.push(aceitar, recusar);
    }
    if (g.estado === 'pendente' && g.proposto_por === 'empresa' && o.pode.agenda) {
      const retirar = el('button', { type: 'button', class: 'botao botao--secundario', 'data-retirar-horario': '' }, 'Retirar proposta');
      retirar.addEventListener('click', () => ocupado(retirar, () => executar(`retirar-${g.id}`, null, (k) => retirarReagendamento(g.id, k), () => anunciar('sucesso', 'Proposta retirada.'))));
      acoes.push(retirar);
    }
    return itemReagendamento(g, acoes);
  });
  const partes = [blocoHorarioOs(o.horario),
    o.horario?.avisos?.length ? el('p', { class: 'campo__ajuda' }, `Confirmado com aviso: ${o.horario.avisos.map((a) => a.mensagem).join(' ')}`) : null,
    el('p', { class: 'campo__ajuda' }, `Pedidos de horário do cliente nesta OS: ${o.pedidos_de_reagendamento_do_cliente}.`),
    itens.length ? el('ul', { class: 'pilha', id: 'reagendamentos' }, ...itens) : null];
  if (o.pode.agenda && ativa()) {
    const enviar = el('button', { type: 'submit', class: 'botao botao--secundario' }, o.horario ? 'Propor outro horário' : (o.origem === 'interna' ? 'Definir horário' : 'Propor horário'));
    const form = el('form', { class: 'pilha', id: 'form-horario', novalidate: true },
      el('p', { class: 'campo__ajuda' }, o.origem === 'plataforma'
        ? 'Na plataforma, o horário só vale quando o cliente concordar. Até lá, o horário atual continua.'
        : 'Solicitação interna: o horário vale na hora, com a concordância informada pelo cliente.'),
      campoTexto({ nome: 'data', rotulo: 'Data', tipo: 'date', id: 'horario-data', obrigatorio: true }),
      campoTexto({ nome: 'hora', rotulo: 'Hora de início', tipo: 'time', id: 'horario-hora', obrigatorio: true }),
      campoTexto({ nome: 'duracao', rotulo: 'Duração (minutos)', valor: 60, id: 'horario-duracao', ajuda: 'De 15 a 720.' }),
      o.horario ? campoTexto({ nome: 'motivo', rotulo: 'Motivo da mudança', obrigatorio: true, max: 300, id: 'horario-motivo', ajuda: 'O cliente vê. De 5 a 300 caracteres.' }) : null,
      o.origem === 'interna' ? el('div', { class: 'opcao' }, el('input', { type: 'checkbox', id: 'horario-concordancia', name: 'concordancia' }),
        el('label', { for: 'horario-concordancia' }, 'O cliente concordou com este horário')) : null,
      el('span', { class: 'campo__erro', 'data-grupo': 'concordancia' }),
      el('div', { class: 'grupo-botoes' }, enviar));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const d = valores(form);
      const inicio = instanteSaoPaulo(d.data, d.hora);
      if (!inicio) return erroNoCampo(form, d.data ? 'hora' : 'data', 'Informe a data e a hora.');
      if (o.horario && (d.motivo ?? '').trim().length < 5) return erroNoCampo(form, 'motivo', 'Explique com pelo menos 5 caracteres.');
      if (o.origem === 'interna' && !d.concordancia) return erroNoCampo(form, 'concordancia', 'Marque para confirmar a concordância do cliente.');
      const duracao = Number(d.duracao);
      return ocupado(enviar, async () => {
        const r = await executar('horario', form, (k) => proporHorario(o.id, inicio, duracao, d.motivo, false, null, d.concordancia, k), () => {});
        if (!r) return;
        if (r.gravado) { anunciar('sucesso', r.estado === 'aceito' ? 'Horário definido.' : 'Horário proposto. O cliente precisa concordar.'); return; }
        const j = await dialogoFormulario({ id: 'aviso-horario', titulo: 'Confirmar mesmo assim?', rotuloConfirmar: 'Confirmar', descricao: r.avisos.map((a) => a.mensagem),
          campos: [campoTexto({ nome: 'justificativa', rotulo: 'Justificativa (opcional)', max: 300, id: 'aviso-justificativa' })], validar: (f) => valores(f) });
        if (!j) return;
        await executar('horario-aviso', form, (k) => proporHorario(o.id, inicio, duracao, d.motivo, true, j.justificativa, d.concordancia, k),
          (x) => anunciar('sucesso', x.estado === 'aceito' ? 'Horário definido com o aviso registrado.' : 'Horário proposto com o aviso registrado.'));
      });
    });
    partes.push(form);
  }
  if (o.horario && ativa() && o.pode.agenda) {
    const cancelar = el('button', { type: 'button', class: 'botao botao--secundario', id: 'cancelar-horario' }, 'Cancelar só o horário');
    cancelar.addEventListener('click', () => ocupado(cancelar, async () => {
      const r = await dialogoFormulario({ id: 'cancelar-horario-d', titulo: 'Cancelar só o horário?', rotuloConfirmar: 'Cancelar horário',
        descricao: ['A ordem de serviço continua, sem horário. O cliente vê o motivo.'],
        campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, max: 300, id: 'cancelar-horario-motivo', ajuda: 'De 5 a 300 caracteres.' })],
        validar: (f) => { const m = texto(5, 300, 'Explique com 5 a 300 caracteres.')(f, 'motivo'); return m ? { motivo: m } : null; } });
      if (!r) return;
      await executar('cancelar-horario', null, (k) => cancelarHorario(o.id, r.motivo, k), () => anunciar('sucesso', 'Horário cancelado. A OS continua sem horário.'));
    }));
    partes.push(el('div', { class: 'grupo-botoes' }, cancelar));
  }
  if (pend.length) partes.unshift(aviso('alerta', 'Há proposta de horário aguardando resposta.'));
  return secao('titulo-horario', 'Horário', ...partes);
}

// --- Materiais -----------------------------------------------------------------
function secaoMateriais() {
  const linhas = o.materiais.map((m) => {
    const acoes = [];
    if (o.pode.estoque_propor && ativa()) {
      const reservado = m.reservada > 0;
      const b = el('button', { type: 'button', class: 'botao botao--secundario', 'data-reservar': m.id }, reservado ? `Desfazer reserva de ${m.produto}` : `Reservar ${m.produto}`);
      b.addEventListener('click', () => ocupado(b, () => executar(`reserva-${m.id}`, null, (k) => reservarMaterial(m.id, !reservado, k, o.id),
        () => anunciar('sucesso', reservado ? 'Reserva desfeita.' : 'Material reservado para esta OS.'))));
      acoes.push(b);
    }
    if (o.pode.alterar && o.pode.estoque_aprovar && m.usada - m.devolvida > 0) {
      const d = el('button', { type: 'button', class: 'botao botao--secundario', 'data-devolver': m.id }, `Devolver ${m.produto}`);
      d.addEventListener('click', () => ocupado(d, async () => {
        const r = await dialogoFormulario({ id: 'devolver', titulo: `Devolver ${m.produto} ao estoque`, rotuloConfirmar: 'Devolver',
          campos: [campoTexto({ nome: 'quantidade', rotulo: 'Quantidade', obrigatorio: true, id: 'devolver-qtd', ajuda: `De 1 a ${m.usada - m.devolvida}.` }),
            campoTexto({ nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, max: 300, id: 'devolver-motivo' })],
          validar: (f) => { const v = valores(f); const q = Number(v.quantidade); if (!Number.isInteger(q) || q < 1) { erroNoCampo(f, 'quantidade', 'Quantidade inteira maior que zero.'); return null; }
            const mo = texto(3, 300, 'Explique com 3 a 300 caracteres.')(f, 'motivo'); return mo ? { quantidade: q, motivo: mo } : null; } });
        if (!r) return;
        await executar(`devolver-${m.id}`, null, (k) => devolverMaterial(m.id, r.quantidade, r.motivo, k, o.id), () => anunciar('sucesso', 'Material devolvido ao estoque.'));
      }));
      acoes.push(d);
    }
    const pendentes = m.usos.filter((u) => u.estado === 'pendente');
    const blocosUso = pendentes.map((u) => {
      const b = [];
      if (o.pode.estoque_aprovar) {
        const ap = el('button', { type: 'button', class: 'botao', 'data-confirmar-uso': u.id }, 'Confirmar e baixar');
        ap.addEventListener('click', () => ocupado(ap, () => executar(`uso-${u.id}`, null, (k) => decidirUso(u.id, true, null, u.versao, k, o.id), () => anunciar('sucesso', 'Uso confirmado e baixado do estoque.'))));
        const rc = el('button', { type: 'button', class: 'botao botao--secundario', 'data-recusar-uso': u.id }, 'Recusar');
        rc.addEventListener('click', () => ocupado(rc, async () => {
          const r = await dialogoFormulario({ id: 'recusar-uso', titulo: 'Recusar o uso registrado', rotuloConfirmar: 'Recusar',
            campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, max: 300, id: 'recusar-uso-motivo' })],
            validar: (f) => { const mo = texto(3, 300, 'Explique com 3 a 300 caracteres.')(f, 'motivo'); return mo ? { motivo: mo } : null; } });
          if (!r) return;
          await executar(`uso-r-${u.id}`, null, (k) => decidirUso(u.id, false, r.motivo, u.versao, k, o.id), () => anunciar('sucesso', 'Uso recusado; o estoque não mudou.'));
        }));
        b.push(ap, rc);
      }
      return el('li', {}, `${u.quantidade} un. registradas por ${u.autor}${u.motivo ? ` (${u.motivo})` : ''}: aguardando confirmação de quem aprova o estoque. `, ...b);
    });
    return el('li', { class: 'cartao pilha', 'data-material': m.id },
      el('p', {}, el('strong', {}, m.produto), m.variacao && m.variacao !== 'Padrão' ? ` (${m.variacao})` : '', m.origem === 'orcamento' ? ' · do orçamento' : ' · adicionado'),
      el('p', {}, `Previsto ${m.prevista} · usado ${m.usada} · devolvido ${m.devolvida} · reservado ${m.reservada} · disponível no estoque ${m.disponivel ?? 0}`),
      o.ver_custo ? el('p', { class: 'campo__ajuda' }, `Custo previsto ${dinheiro(m.custo_previsto_centavos)} · custo confirmado ${dinheiro(m.custo_confirmado_centavos)}`) : null,
      blocosUso.length ? el('ul', { class: 'pilha' }, ...blocosUso) : null,
      acoes.length ? el('div', { class: 'grupo-botoes' }, ...acoes) : null);
  });
  const partes = [linhas.length ? el('ul', { class: 'pilha', id: 'materiais' }, ...linhas) : el('p', { id: 'materiais' }, 'Nenhum material previsto ou usado.')];
  if (o.pode.alterar && opcoesCatalogo().length && ['aguardando_inicio', 'em_execucao', 'pausada', 'concluida'].includes(o.estado)) {
    const enviar = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Registrar');
    const podeUso = ['em_execucao', 'pausada', 'concluida'].includes(o.estado);
    const form = el('form', { class: 'pilha', id: 'form-material', novalidate: true },
      campoSelecao({ nome: 'acao', rotulo: 'O que registrar', opcoes: [...(ativa() ? [['previsto', 'Material previsto']] : []), ...(podeUso ? [['uso', 'Material usado']] : [])], vazio: null, id: 'material-acao',
        ajuda: o.pode.estoque_aprovar ? 'O uso que você registra já baixa do estoque.' : 'O uso que você registra fica pendente até quem aprova o estoque confirmar.' }),
      campoSelecao({ nome: 'variacao', rotulo: 'Produto', opcoes: opcoesCatalogo(), vazio: null, id: 'material-variacao' }),
      campoTexto({ nome: 'quantidade', rotulo: 'Quantidade (unidades inteiras)', obrigatorio: true, id: 'material-qtd' }),
      campoTexto({ nome: 'motivo', rotulo: 'Observação (opcional)', max: 300, id: 'material-motivo' }),
      el('div', { class: 'grupo-botoes' }, enviar));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const d = valores(form);
      const q = Number(d.quantidade);
      if (!Number.isInteger(q) || q < 1) return erroNoCampo(form, 'quantidade', 'Informe uma quantidade inteira maior que zero.');
      return ocupado(enviar, () => executar(`material-${d.acao}`, form, (k) => (d.acao === 'uso' ? registrarUso(o.id, d.variacao, q, d.motivo, k) : adicionarMaterial(o.id, d.variacao, q, k)),
        (r) => anunciar('sucesso', d.acao === 'uso' ? (r.estado === 'confirmado' ? 'Uso registrado e baixado do estoque.' : 'Uso registrado; aguarda confirmação.') : 'Material previsto adicionado.')));
    });
    if (form.querySelector('[name="acao"]').options.length) partes.push(form);
  }
  return secao('titulo-materiais', 'Materiais', ...partes);
}

// --- Valores -------------------------------------------------------------------
function secaoValores() {
  const v = o.valores;
  const partes = [blocoValores(v, true)];
  if (v.titulos.length) {
    partes.push(el('ul', { class: 'pilha', id: 'titulos-os' }, ...v.titulos.map((t) => el('li', { class: 'cartao' },
      `${t.parte === 'antecipacao' ? 'Sinal' : 'Saldo'}: ${dinheiro(t.total_centavos)} · recebido ${dinheiro(t.recebido_centavos)} · ${t.estado}`,
      t.a_devolver_centavos ? ` · a devolver ${dinheiro(t.a_devolver_centavos)}` : '',
      t.parcelas?.length ? el('span', { class: 'campo__ajuda' }, ` · ${t.parcelas.length} parcela(s)`) : null))));
    partes.push(el('p', {}, el('a', { href: `/business/financeiro.html?id=${encodeURIComponent(ctx.id)}` }, 'Registrar recebimentos e devoluções no financeiro'),
      el('span', { class: 'campo__ajuda' }, ' (exige a permissão de aprovar no financeiro).')));
  }
  if (o.pode.financeiro_criar && ativa() && !v.titulos.some((t) => t.estado !== 'cancelado')) {
    const enviar = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Registrar sinal');
    const form = el('form', { class: 'pilha', id: 'form-sinal', novalidate: true },
      el('p', { class: 'campo__ajuda' }, 'Cria a conta a receber do sinal. Nada é recebido automaticamente. Na conclusão, o saldo nasce descontando o sinal.'),
      campoTexto({ nome: 'valor', rotulo: 'Valor do sinal (R$)', obrigatorio: true, id: 'sinal-valor', ajuda: `Até ${dinheiro(v.contratado_centavos)}.` }),
      campoTexto({ nome: 'vencimento', rotulo: 'Vencimento', tipo: 'date', valor: dataDeHoje(), id: 'sinal-vencimento' }),
      el('div', { class: 'grupo-botoes' }, enviar));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const d = valores(form);
      const r = lerValorEmReais(d.valor || '');
      if (!r.ok || r.centavos <= 0) return erroNoCampo(form, 'valor', r.erro ?? 'Informe um valor maior que zero.');
      return ocupado(enviar, () => executar('sinal', form, (k) => gerarSinal(o.id, r.centavos, d.vencimento, k), () => anunciar('sucesso', 'Sinal registrado como conta a receber.')));
    });
    partes.push(form);
  }
  const saldo = v.titulos.find((t) => t.parte === 'saldo' && t.estado !== 'cancelado' && t.recebido_centavos === 0);
  if (o.pode.financeiro_criar && saldo) {
    const b = el('button', { type: 'button', class: 'botao botao--secundario', id: 'reparcelar' }, 'Dividir o saldo em parcelas');
    b.addEventListener('click', () => ocupado(b, async () => {
      const campos = [0, 1, 2].flatMap((i) => [campoTexto({ nome: `v${i}`, rotulo: `Parcela ${i + 1}: valor (R$)`, id: `rep-v${i}` }),
        campoTexto({ nome: `d${i}`, rotulo: `Parcela ${i + 1}: vencimento`, tipo: 'date', id: `rep-d${i}` })]);
      const r = await dialogoFormulario({ id: 'reparcelar-d', titulo: 'Dividir o saldo', rotuloConfirmar: 'Salvar parcelas',
        descricao: [`A soma precisa ser ${dinheiro(saldo.total_centavos)}. A conta atual é cancelada com motivo e substituída.`], campos,
        validar: (f) => {
          const d = valores(f);
          const parcelas = [];
          for (let i = 0; i < 3; i += 1) {
            if (!d[`v${i}`] && !d[`d${i}`]) continue;
            const x = lerValorEmReais(d[`v${i}`] || '');
            if (!x.ok || x.centavos <= 0) { erroNoCampo(f, `v${i}`, 'Valor inválido.'); return null; }
            if (!d[`d${i}`]) { erroNoCampo(f, `d${i}`, 'Informe o vencimento.'); return null; }
            parcelas.push({ valor_centavos: x.centavos, vencimento: d[`d${i}`] });
          }
          if (parcelas.length < 2) { erroNoCampo(f, 'v1', 'Informe ao menos duas parcelas.'); return null; }
          return { parcelas };
        } });
      if (!r) return;
      await executar('reparcelar', null, (k) => reparcelar(o.id, r.parcelas, k), () => anunciar('sucesso', 'Saldo dividido em parcelas.'));
    }));
    partes.push(el('div', { class: 'grupo-botoes' }, b));
  }
  return secao('titulo-valores', 'Valores e pagamento', ...partes);
}

// --- Cancelamento e custos -----------------------------------------------------
function dialogoItensCustos(titulo, rotulo) {
  const campos = [0, 1, 2].flatMap((i) => [
    campoSelecao({ nome: `t${i}`, rotulo: `Item ${i + 1}: tipo`, opcoes: Object.entries(TIPO_CUSTO), vazio: i === 0 ? null : 'Sem item', id: `custo-t${i}` }),
    campoTexto({ nome: `d${i}`, rotulo: `Item ${i + 1}: descrição`, max: 120, id: `custo-d${i}` }),
    campoTexto({ nome: `v${i}`, rotulo: `Item ${i + 1}: valor (R$)`, id: `custo-v${i}` }),
    campoTexto({ nome: `j${i}`, rotulo: `Item ${i + 1}: justificativa`, max: 300, id: `custo-j${i}` })]);
  campos.push(campoTexto({ nome: 'justificativa', rotulo: 'Explicação geral para o cliente', obrigatorio: true, linhas: 2, max: 1000, id: 'custo-justificativa',
    ajuda: 'De 10 a 1.000 caracteres.' }));
  return dialogoFormulario({ id: 'custos-d', titulo, rotuloConfirmar: rotulo, campos,
    descricao: [`Só custos efetivamente incorridos, item por item. O total é calculado pelo sistema e não passa do valor contratado (${dinheiro(o.valores.contratado_centavos)}). `
      + 'Nenhuma multa percentual. A proposta não é dívida: o cliente aceita ou contesta.'],
    validar: (f) => {
      const d = valores(f);
      const itens = [];
      for (let i = 0; i < 3; i += 1) {
        if (!d[`t${i}`]) continue;
        const x = lerValorEmReais(d[`v${i}`] || '');
        if (!x.ok || x.centavos <= 0) { erroNoCampo(f, `v${i}`, 'Valor inválido.'); return null; }
        if ((d[`d${i}`] ?? '').trim().length < 2) { erroNoCampo(f, `d${i}`, 'Descreva o item.'); return null; }
        if ((d[`j${i}`] ?? '').trim().length < 5) { erroNoCampo(f, `j${i}`, 'Justifique com pelo menos 5 caracteres.'); return null; }
        itens.push({ tipo: d[`t${i}`], descricao: d[`d${i}`].trim(), valor_centavos: x.centavos, justificativa: d[`j${i}`].trim() });
      }
      const j = texto(10, 1000, 'Explique com 10 a 1.000 caracteres.')(f, 'justificativa');
      return j ? { itens, justificativa: j } : null;
    } });
}

function acoesCustos(p) {
  const b = [];
  const pode = o.pode.cancelar && o.pode.financeiro_criar;
  if (pode && ['pendente', 'contestada', 'acordo_proposto'].includes(p.estado)) {
    const rev = el('button', { type: 'button', class: 'botao botao--secundario', 'data-revisar-custos': p.numero }, 'Revisar proposta');
    rev.addEventListener('click', () => ocupado(rev, async () => {
      const r = await dialogoItensCustos(`Revisar a proposta ${p.numero}`, 'Enviar revisão');
      if (r) await executar(`revisar-${p.id}`, null, (k) => revisarCustos(p.id, r.itens, r.justificativa, p.versao, k), () => anunciar('sucesso', 'Proposta revisada; o cliente responde de novo.'));
    }));
    b.push(rev);
  }
  if (pode && ['pendente', 'contestada'].includes(p.estado)) {
    const ac = el('button', { type: 'button', class: 'botao botao--secundario', 'data-acordo': p.numero }, 'Registrar acordo');
    ac.addEventListener('click', () => ocupado(ac, async () => {
      const r = await dialogoFormulario({ id: 'acordo-d', titulo: 'Registrar acordo', rotuloConfirmar: 'Registrar',
        descricao: [o.origem === 'plataforma' ? 'Na plataforma, o cliente confirma o acordo pela conta dele.' : 'Solicitação interna: confirme que o cliente concordou.'],
        campos: [campoTexto({ nome: 'valor', rotulo: 'Valor do acordo (R$)', obrigatorio: true, id: 'acordo-valor', ajuda: `Até ${dinheiro(p.total_centavos)}. Zero dispensa a cobrança.` }),
          campoTexto({ nome: 'texto', rotulo: 'Descrição do acordo', obrigatorio: true, linhas: 2, max: 1000, id: 'acordo-texto' }),
          o.origem === 'interna' ? el('div', { class: 'opcao' }, el('input', { type: 'checkbox', id: 'acordo-concordancia', name: 'concordancia' }), el('label', { for: 'acordo-concordancia' }, 'O cliente concordou')) : null,
          el('span', { class: 'campo__erro', 'data-grupo': 'concordancia' })].filter(Boolean),
        validar: (f) => { const d = valores(f); const x = lerValorEmReais(d.valor || ''); if (!x.ok) { erroNoCampo(f, 'valor', x.erro); return null; }
          const t = texto(10, 1000, 'Descreva com 10 a 1.000 caracteres.')(f, 'texto'); if (!t) return null;
          if (o.origem === 'interna' && !d.concordancia) { erroNoCampo(f, 'concordancia', 'Marque para confirmar.'); return null; }
          return { valor: x.centavos, texto: t, concordancia: Boolean(d.concordancia) }; } });
      if (r) await executar(`acordo-${p.id}`, null, (k) => registrarAcordo(p.id, r.valor, r.texto, r.concordancia, p.versao, k), () => anunciar('sucesso', 'Acordo registrado.'));
    }));
    b.push(ac);
  }
  if (pode && o.origem === 'interna' && p.estado === 'pendente') {
    const rs = el('button', { type: 'button', class: 'botao botao--secundario', 'data-resposta-informada': p.numero }, 'Registrar resposta do cliente');
    rs.addEventListener('click', () => ocupado(rs, async () => {
      const r = await dialogoFormulario({ id: 'resposta-d', titulo: 'Resposta informada pelo cliente', rotuloConfirmar: 'Registrar',
        campos: [campoSelecao({ nome: 'resposta', rotulo: 'O cliente', opcoes: [['aceitar', 'Aceitou os custos'], ['contestar', 'Contestou os custos']], vazio: null, id: 'resposta-tipo' }),
          campoTexto({ nome: 'texto', rotulo: 'Contestação (se houver)', linhas: 2, max: 1000, id: 'resposta-texto' })],
        validar: (f) => { const d = valores(f); if (d.resposta === 'contestar' && (d.texto ?? '').trim().length < 10) { erroNoCampo(f, 'texto', 'Registre a contestação (10 a 1.000 caracteres).'); return null; } return d; } });
      if (r) await executar(`resposta-${p.id}`, null, (k) => responderCustos(p.id, r.resposta === 'aceitar', r.texto, p.versao, k), () => anunciar('sucesso', 'Resposta registrada.'));
    }));
    b.push(rs);
  }
  if (pode && ['pendente', 'contestada', 'acordo_proposto'].includes(p.estado) || (pode && ['aceita', 'acordo'].includes(p.estado) && !p.tem_titulo)) {
    const rt = el('button', { type: 'button', class: 'botao botao--secundario', 'data-retirar-custos': p.numero }, 'Retirar proposta');
    rt.addEventListener('click', () => ocupado(rt, async () => {
      const r = await dialogoFormulario({ id: 'retirar-d', titulo: 'Retirar a proposta de custos', rotuloConfirmar: 'Retirar',
        campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, max: 300, id: 'retirar-motivo' })],
        validar: (f) => { const m = texto(5, 300, 'Explique com 5 a 300 caracteres.')(f, 'motivo'); return m ? { motivo: m } : null; } });
      if (r) await executar(`retirar-c-${p.id}`, null, (k) => retirarCustos(p.id, r.motivo, p.versao, k), () => anunciar('sucesso', 'Proposta retirada.'));
    }));
    b.push(rt);
  }
  if (o.pode.financeiro_criar && ['aceita', 'acordo'].includes(p.estado) && !p.tem_titulo && (p.estado === 'aceita' || p.acordo_valor_centavos > 0)) {
    const t = el('button', { type: 'button', class: 'botao', 'data-titulo-custos': p.numero }, 'Criar conta a receber dos custos');
    t.addEventListener('click', () => ocupado(t, () => executar(`titulo-${p.id}`, null, (k) => gerarTituloCustos(p.id, null, k), () => anunciar('sucesso', 'Conta a receber criada. O recebimento é registrado no financeiro.'))));
    b.push(t);
  }
  return b;
}

function secaoCancelamento() {
  const partes = [blocoCondicoes(o.condicoes_cancelamento)];
  if (o.estado === 'cancelada') {
    partes.unshift(blocoCancelamento(o.cancelamento));
    const c = o.cancelamento;
    const ativaP = o.custos.some((p) => !['revisada', 'retirada'].includes(p.estado));
    if (o.pode.cancelar && o.pode.financeiro_criar && c.solicitado_por === 'cliente' && !c.arrependimento_possivel && c.tinha_condicoes && !ativaP) {
      const b = el('button', { type: 'button', class: 'botao botao--secundario', id: 'propor-custos' }, 'Propor custos de cancelamento');
      b.addEventListener('click', () => ocupado(b, async () => {
        const r = await dialogoItensCustos('Propor custos de cancelamento', 'Enviar proposta');
        if (r) await executar('propor-custos', null, (k) => proporCustos(o.id, r.itens, r.justificativa, k), () => anunciar('sucesso', 'Proposta enviada. O cliente aceita ou contesta.'));
      }));
      partes.push(el('div', { class: 'grupo-botoes' }, b));
    }
    if (o.custos.length) partes.push(el('div', { class: 'pilha', id: 'custos' }, ...o.custos.map((p) => cartaoCustos(p, acoesCustos(p)))));
  } else if (ativa() && o.pode.cancelar) {
    const b = el('button', { type: 'button', class: 'botao botao--secundario', id: 'cancelar-os' }, 'Cancelar a ordem de serviço');
    b.addEventListener('click', () => ocupado(b, async () => {
      const r = await dialogoFormulario({ id: 'cancelar-os-d', titulo: 'Cancelar a ordem de serviço?', rotuloConfirmar: 'Cancelar a OS', rotuloCancelar: 'Voltar',
        descricao: ['O horário é cancelado, as reservas são liberadas e os usos pendentes são recusados. Contas sem recebimento são canceladas; o que já foi recebido fica "a devolver" no financeiro.',
          'Nada é cobrado automaticamente.'],
        campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo (o cliente vê)', obrigatorio: true, linhas: 2, max: 300, id: 'cancelar-os-motivo', ajuda: 'De 10 a 300 caracteres.' }),
          o.origem === 'interna' ? el('div', { class: 'opcao' }, el('input', { type: 'checkbox', id: 'cancelar-os-cliente', name: 'pedido_cliente' }),
            el('label', { for: 'cancelar-os-cliente' }, 'Foi o cliente quem pediu o cancelamento')) : null].filter(Boolean),
        validar: (f) => { const m = texto(10, 300, 'Explique com 10 a 300 caracteres.')(f, 'motivo'); return m ? { motivo: m, cliente: Boolean(valores(f).pedido_cliente) } : null; } });
      if (r) await executar('cancelar-os', null, (k) => cancelarOs(o.id, r.motivo, r.cliente, k), () => anunciar('sucesso', 'Ordem de serviço cancelada.'));
    }));
    partes.push(el('div', { class: 'grupo-botoes' }, b));
  }
  return secao('titulo-cancelamento', 'Cancelamento', ...partes);
}

// --- Garantia, recorrência e linha do tempo ------------------------------------
function secaoGarantia() {
  const partes = [blocoGarantia(o.garantia) ?? el('p', {}, 'Sem garantia registrada.')];
  if (o.pode.alterar && o.estado === 'concluida') {
    const enviar = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Registrar garantia');
    const form = el('form', { class: 'pilha', id: 'form-garantia', novalidate: true },
      campoTexto({ nome: 'dias', rotulo: 'Prazo (dias)', obrigatorio: true, valor: o.garantia?.dias ?? 90, id: 'garantia-dias', ajuda: 'De 0 a 3.650.' }),
      campoTexto({ nome: 'condicoes', rotulo: 'Condições', linhas: 2, max: 1000, valor: o.garantia?.condicoes ?? '', id: 'garantia-condicoes',
        ajuda: 'O cliente vê o prazo e as condições no histórico da OS.' }),
      el('p', { class: 'campo__ajuda' }, 'A garantia oferecida pela empresa não substitui os direitos previstos em lei.'),
      el('div', { class: 'grupo-botoes' }, enviar));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const d = valores(form);
      const dias = Number(d.dias);
      if (!Number.isInteger(dias) || dias < 0 || dias > 3650) return erroNoCampo(form, 'dias', 'Informe de 0 a 3.650 dias.');
      return ocupado(enviar, () => executar('garantia', form, (k) => registrarGarantia(o.id, dias, d.condicoes, k, o.versao), () => anunciar('sucesso', 'Garantia registrada.')));
    });
    partes.push(form);
  }
  if (o.proxima) partes.push(el('p', {}, 'Próxima execução: ', el('a', { href: `/business/solicitacao.html?id=${encodeURIComponent(ctx.id)}&solicitacao=${encodeURIComponent(o.proxima.solicitacao_id)}` },
    `solicitação nº ${o.proxima.numero}`)));
  else if (o.recorrencia && o.estado === 'encerrada' && o.pode.alterar && o.pode.orcamentos_criar) {
    const b = el('button', { type: 'button', class: 'botao botao--secundario', id: 'gerar-proxima' }, 'Gerar a próxima execução');
    b.addEventListener('click', () => ocupado(b, async () => {
      const ok = await abrirDialogo({ titulo: 'Gerar a próxima execução?', rotuloConfirmar: 'Gerar', rotuloCancelar: 'Voltar',
        mensagens: ['Cria uma nova solicitação com orçamento no mesmo preço deste aceite, já enviado.', 'A próxima OS só nasce quando o cliente aceitar.'] });
      if (ok) await executar('proxima', null, (k) => gerarProxima(o.id, k), (r) => anunciar('sucesso', r.aviso));
    }));
    partes.push(el('div', { class: 'grupo-botoes' }, b));
  }
  return secao('titulo-garantia', 'Garantia e recorrência', ...partes);
}

function secaoLinhaDoTempo() {
  const partes = [linhaDoTempoOs(o.eventos)];
  if (o.pode.alterar && o.estado !== 'cancelada') {
    const enviar = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Registrar');
    const form = el('form', { class: 'pilha', id: 'form-atualizacao', novalidate: true },
      campoTexto({ nome: 'texto', rotulo: 'Atualização', linhas: 2, max: 1000, id: 'atualizacao-texto', ajuda: 'Pública: até 500 caracteres, sem contato. Nota interna: até 1.000.' }),
      el('div', { class: 'opcao' }, el('input', { type: 'checkbox', id: 'atualizacao-publica', name: 'publica' }), el('label', { for: 'atualizacao-publica' }, 'O cliente pode ver')),
      el('p', { class: 'campo__ajuda', id: 'atualizacao-visibilidade' }, 'Sem marcar, fica como nota interna: só a equipe vê. Marcado, o cliente vê no histórico da OS.'),
      el('div', { class: 'grupo-botoes' }, enviar));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const d = valores(form);
      if ((d.texto ?? '').trim().length < 2) return erroNoCampo(form, 'texto', 'Escreva a atualização.');
      return ocupado(enviar, () => executar('atualizacao', form, (k) => publicarAtualizacao(o.id, d.texto, Boolean(d.publica), k),
        () => anunciar('sucesso', d.publica ? 'Atualização publicada para o cliente.' : 'Nota interna registrada.')));
    });
    partes.push(form);
  }
  return secao('titulo-linha', 'Linha do tempo', ...partes);
}

function desenhar() {
  const topo = el('div', { class: 'pilha' },
    el('p', {}, el('a', { href: `/business/ordens.html?id=${encodeURIComponent(ctx.id)}` }, 'Voltar às ordens de serviço')),
    el('h2', { id: 'resumo-os' }, `OS nº ${o.numero} · ${o.servico} `, chipOs(o.estado)),
    el('p', {}, `Cliente: ${o.cliente_nome}${o.origem === 'interna' ? ' (balcão ou telefone)' : ''} · `,
      el('a', { href: `/business/solicitacao.html?id=${encodeURIComponent(ctx.id)}&solicitacao=${encodeURIComponent(o.solicitacao_id)}` }, `solicitação nº ${o.solicitacao_numero}`)),
    o.revisao_pendente ? aviso('alerta', 'O cliente pediu revisão. Reabra a OS para atender.') : null,
    // M13 (D13-08): resumo da OS em PDF, para quem vê as ordens de serviço; sem notas internas.
    el('p', {}, botaoPdf({ rotulo: 'Baixar resumo da OS (PDF)', id: 'baixar-pdf-os', anunciar,
      montar: async () => resumoOs(o, { empresa: ctx.empresa?.nome_publico ?? 'Empresa', usuario: await nomeDeQuemGera(), agora: new Date() }),
      registrar: (chave) => registrarExportacaoPdf(ctx.id, 'os', o.id, null, null, chave) })),
    o.estado === 'concluida' && !o.encerramento.empresa_pode_encerrar && o.encerramento.motivo ? el('p', { class: 'campo__ajuda' }, o.encerramento.motivo) : null);
  const botoes = botoesEstado();
  area.replaceChildren(topo, botoes.length ? el('div', { class: 'grupo-botoes', id: 'acoes-estado' }, ...botoes) : el('span'),
    secaoDados(), secaoHorario(), secaoMateriais(), secaoValores(), secaoCancelamento(), secaoGarantia(),
    // M12: conversa com o cliente, a mesma da solicitação (com as atualizações públicas desta OS).
    ...(o.origem === 'plataforma' ? [secaoConversa({ tipo: 'os', id: o.id, titulo: 'Conversa com o cliente', anunciar }).secao] : []),
    secaoLinhaDoTempo(),
    el('details', {}, el('summary', {}, 'Orçamento aceito'), el('p', {}, `Versão ${o.versao_aceita.numero}: ${dinheiro(o.versao_aceita.total_centavos)}`),
      el('ul', {}, ...o.versao_aceita.componentes.map((c) => el('li', {}, `${c.descricao}: ${dinheiro(c.total_centavos)}`)))));
}

async function carregar() {
  mostrarCarregando(area, 'Carregando a ordem de serviço');
  try {
    ctx = ctx ?? await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'ordens'));
    if (!ctx.pode('servicos.visualizar')) {
      area.replaceChildren(aviso('erro', 'Seu perfil não inclui ver ordens de serviço desta empresa.'));
      return;
    }
    o = await lerOrdem(osId);
    if (catalogo === null) catalogo = ctx.pode('produtos.visualizar') || ctx.pode('estoque.visualizar') ? await produtosDaEmpresa(ctx.id).catch(() => []) : [];
    concluirCarregamento(area);
    document.getElementById('titulo-pagina').textContent = `Ordem de serviço nº ${o.numero}`;
    desenhar();
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

carregar();
