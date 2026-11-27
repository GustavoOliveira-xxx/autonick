/**
 * Cliente: meus serviços contratados (M09; D9-12 a D9-15, D9-18 a D9-20, D9-24, D9-25, D9-28). O cliente vê só as próprias
 * OS, sem notas internas, custos internos nem dados do financeiro da empresa. Pode responder a propostas de horário, pedir
 * outro horário (limites da CK, com exceção justificada), cancelar só o horário, cancelar o serviço antes da conclusão
 * (vale na hora, sem cobrança automática), responder a custos de cancelamento, pedir revisão e confirmar o recebimento.
 */
import { marcarNovas } from '../comunicacao/marcador.js';
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { instanteSaoPaulo, textoHorario } from '../../domain/servicos.js';
import { minhasOrdens, minhaOrdem, responderReagendamento, pedirReagendamento, retirarReagendamento, cancelarHorario, cancelarOs,
  responderCustos, pedirRevisaoOs, confirmarRecebimento, ESTADOS_ATIVOS } from '../../data/ordens.js';
import { novaChave } from '../../data/empresas.js';
import { exigirSessao, formatarDataHora } from '../empresa/comum.js';
import { avisoSuspensao } from './jornada.js';
import { montarMomento } from '../../ui/forja3d/momentos.js';
import { secaoConversa } from '../comunicacao/conversa.js';
import { secaoAvaliacaoCliente } from '../comunicacao/avaliacao.js';
import { dialogoFormulario } from '../servicos/comum.js';
import { checklistOsCliente } from '../../data/ordens.js';
import { chipOs, blocoValores, linhaDoTempoOs, blocoHorarioOs, itemReagendamento, cartaoCustos, blocoCancelamento, blocoGarantia, blocoCondicoes } from '../servicos/ordens-comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const avisos = document.getElementById('avisos');
const chaves = new Map();
const chave = (a) => { if (!chaves.has(a)) chaves.set(a, novaChave()); return chaves.get(a); };
let aberta = parametro('os');
const ACAO = { responder_horario: 'A empresa propôs um horário', responder_custos: 'Há custos de cancelamento para você responder',
  confirmar_recebimento: 'A empresa informou a conclusão' };
const texto = (min, max, mensagem) => (form, nome) => {
  const t = (valores(form)[nome] ?? '').trim();
  if (t.length < min || t.length > max) { erroNoCampo(form, nome, mensagem); return null; }
  return t;
};

function anunciar(tipo, t, ...extra) {
  avisos.replaceChildren(el('div', { role: tipo === 'erro' ? 'alert' : 'status' }, aviso(tipo, t, ...extra)));
  avisos.scrollIntoView({ block: 'nearest' });
}

async function agir(acao, chamada, sucesso) {
  try {
    const r = await chamada(chave(acao));
    chaves.delete(acao);
    await carregar();
    sucesso?.(r);
    return r;
  } catch (erro) {
    if (erro.codigo === 'NETWORK_UNKNOWN') { anunciar('erro', erro.message, el('p', {}, 'Tente de novo: a ação não será duplicada.')); return null; }
    chaves.delete(acao);
    if (['STATE_CONFLICT', 'VERSION_CONFLICT'].includes(erro.codigo)) await carregar();
    anunciar('erro', erro.message);
  }
  return null;
}

function secaoHorario(o) {
  const ativa = ESTADOS_ATIVOS.includes(o.estado);
  const itens = o.reagendamentos.map((g) => {
    const acoes = [];
    if (g.estado === 'pendente' && g.proposto_por === 'empresa') {
      const aceitar = el('button', { type: 'button', class: 'botao', 'data-aceitar-horario': '' }, 'Concordo com este horário');
      aceitar.addEventListener('click', () => ocupado(aceitar, () => agir(`aceitar-${g.id}`, (k) => responderReagendamento(g.id, true, null, false, null, k),
        () => anunciar('sucesso', 'Horário combinado.'))));
      const recusar = el('button', { type: 'button', class: 'botao botao--secundario', 'data-recusar-horario': '' }, 'Não posso neste horário');
      recusar.addEventListener('click', () => ocupado(recusar, async () => {
        const r = await dialogoFormulario({ id: 'recusa-horario', titulo: 'Recusar o horário proposto', rotuloConfirmar: 'Recusar',
          descricao: ['O horário atual (se houver) continua valendo. Você pode pedir outro horário em seguida.'],
          campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo (opcional)', max: 300, id: 'recusa-horario-motivo' })], validar: (f) => valores(f) });
        if (r) await agir(`recusar-${g.id}`, (k) => responderReagendamento(g.id, false, r.motivo, false, null, k), () => anunciar('sucesso', 'Horário recusado.'));
      }));
      acoes.push(aceitar, recusar);
    }
    if (g.estado === 'pendente' && g.proposto_por === 'cliente') {
      const retirar = el('button', { type: 'button', class: 'botao botao--secundario', 'data-retirar-horario': '' }, 'Retirar meu pedido');
      retirar.addEventListener('click', () => ocupado(retirar, () => agir(`retirar-${g.id}`, (k) => retirarReagendamento(g.id, k), () => anunciar('sucesso', 'Pedido retirado.'))));
      acoes.push(retirar);
    }
    return itemReagendamento(g, acoes);
  });
  const partes = [blocoHorarioOs(o.horario), itens.length ? el('ul', { class: 'pilha', id: 'reagendamentos' }, ...itens) : null];
  if (ativa) {
    const botoes = [];
    const pedir = el('button', { type: 'button', class: 'botao botao--secundario', id: 'pedir-horario' }, o.horario ? 'Pedir outro horário' : 'Sugerir um horário');
    pedir.addEventListener('click', () => ocupado(pedir, async () => {
      const r = await dialogoFormulario({ id: 'pedir-horario-d', titulo: o.horario ? 'Pedir outro horário' : 'Sugerir um horário', rotuloConfirmar: 'Enviar pedido',
        descricao: ['A empresa precisa concordar. Até lá, o horário atual continua valendo.', `Pedidos feitos nesta OS: ${o.pedidos_de_reagendamento_do_cliente}.`],
        campos: [campoTexto({ nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true, id: 'pedir-data' }),
          campoTexto({ nome: 'hora', rotulo: 'Hora', tipo: 'time', obrigatorio: true, id: 'pedir-hora' }),
          campoTexto({ nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, max: 300, id: 'pedir-motivo', ajuda: 'De 5 a 300 caracteres, sem telefone ou e-mail.' }),
          campoTexto({ nome: 'excepcional', rotulo: 'Situação excepcional (só se o limite de pedidos tiver sido atingido)', max: 300, id: 'pedir-excepcional',
            ajuda: 'Se a plataforma avisar que o limite foi atingido, explique aqui (20 a 300 caracteres).' })],
        validar: (f) => { const d = valores(f); const inicio = instanteSaoPaulo(d.data, d.hora); if (!inicio) { erroNoCampo(f, d.data ? 'hora' : 'data', 'Informe a data e a hora.'); return null; }
          const m = texto(5, 300, 'Explique com 5 a 300 caracteres.')(f, 'motivo'); return m ? { inicio, motivo: m, excepcional: d.excepcional } : null; } });
      if (r) await agir('pedir-horario', (k) => pedirReagendamento(o.id, r.inicio, null, r.motivo, r.excepcional, k), () => anunciar('sucesso', 'Pedido enviado à empresa.'));
    }));
    botoes.push(pedir);
    if (o.horario) {
      const cancelar = el('button', { type: 'button', class: 'botao botao--secundario', id: 'cancelar-horario' }, 'Cancelar só o horário');
      cancelar.addEventListener('click', () => ocupado(cancelar, async () => {
        const r = await dialogoFormulario({ id: 'cancelar-horario-d', titulo: 'Cancelar só o horário?', rotuloConfirmar: 'Cancelar o horário',
          descricao: ['O serviço continua contratado, sem horário. Para desistir do serviço, use "Cancelar o serviço".'],
          campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, max: 300, id: 'cancelar-horario-motivo', ajuda: 'De 5 a 300 caracteres.' })],
          validar: (f) => { const m = texto(5, 300, 'Explique com 5 a 300 caracteres.')(f, 'motivo'); return m ? { motivo: m } : null; } });
        if (r) await agir('cancelar-horario', (k) => cancelarHorario(o.id, r.motivo, k), () => anunciar('sucesso', 'Horário cancelado. O serviço continua.'));
      }));
      botoes.push(cancelar);
    }
    partes.push(el('div', { class: 'grupo-botoes' }, ...botoes));
  }
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-horario' }, el('h2', { id: 'titulo-horario' }, 'Horário'), ...partes.filter(Boolean));
}

function acoesCustos(p) {
  if (!['pendente', 'acordo_proposto'].includes(p.estado)) return [];
  const aceitar = el('button', { type: 'button', class: 'botao', 'data-aceitar-custos': p.numero }, p.estado === 'pendente' ? 'Aceito estes custos' : 'Confirmo o acordo');
  aceitar.addEventListener('click', () => ocupado(aceitar, async () => {
    const ok = await abrirDialogo({ titulo: p.estado === 'pendente' ? 'Aceitar os custos?' : 'Confirmar o acordo?', rotuloConfirmar: 'Confirmar', rotuloCancelar: 'Voltar',
      mensagens: ['Com a sua concordância, a empresa pode registrar a cobrança. O pagamento é combinado diretamente com ela; nada é cobrado pela plataforma.'] });
    if (ok) await agir(`custos-${p.id}`, (k) => responderCustos(p.id, true, null, p.versao, k), () => anunciar('sucesso', 'Resposta registrada.'));
  }));
  const contestar = el('button', { type: 'button', class: 'botao botao--secundario', 'data-contestar-custos': p.numero }, 'Contestar');
  contestar.addEventListener('click', () => ocupado(contestar, async () => {
    const r = await dialogoFormulario({ id: 'contestar-d', titulo: 'Contestar os custos', rotuloConfirmar: 'Enviar contestação',
      descricao: ['Contestado, nada vira dívida: a empresa revisa, retira ou propõe um acordo.'],
      campos: [campoTexto({ nome: 'texto', rotulo: 'Por que você contesta?', obrigatorio: true, linhas: 3, max: 1000, id: 'contestar-texto', ajuda: 'De 10 a 1.000 caracteres.' })],
      validar: (f) => { const t = texto(10, 1000, 'Explique com 10 a 1.000 caracteres.')(f, 'texto'); return t ? { texto: t } : null; } });
    if (r) await agir(`contestar-${p.id}`, (k) => responderCustos(p.id, false, r.texto, p.versao, k), () => anunciar('sucesso', 'Contestação enviada.'));
  }));
  return [aceitar, contestar];
}

function detalhe(o) {
  const partes = [el('p', {}, el('a', { class: 'botao botao--secundario', href: '/cliente/ordens.html' }, 'Voltar aos meus serviços')),
    el('h2', { id: 'resumo-os' }, `OS nº ${o.numero} · ${o.servico} · ${o.empresa} `, chipOs(o.estado)),
    el('p', {}, el('a', { class: 'botao botao--secundario', href: `/cliente/solicitacoes.html?s=${encodeURIComponent(o.solicitacao_id)}` }, `Ver a solicitação nº ${o.solicitacao_numero} e o orçamento aceito`)),
    o.previsao_conclusao ? el('p', {}, `Previsão de conclusão informada pela empresa: ${o.previsao_conclusao.split('-').reverse().join('/')}`) : null,
    // D11-06 e D11-07: a OS já aceita continua; o aviso não traz a justificativa interna da CK.
    avisoSuspensao(o.suspensao, 'aceito')];
  if (o.estado === 'concluida') {
    const botoes = [];
    const confirmar = el('button', { type: 'button', class: 'botao', id: 'confirmar-recebimento' }, 'Confirmar que recebi o serviço');
    confirmar.addEventListener('click', () => ocupado(confirmar, async () => {
      const ok = await abrirDialogo({ titulo: 'Confirmar o recebimento?', rotuloConfirmar: 'Confirmar', rotuloCancelar: 'Voltar',
        mensagens: ['A OS é encerrada. Isso não elimina seus direitos de garantia ou reclamação previstos em lei.'] });
      if (ok) await agir('confirmar', (k) => confirmarRecebimento(o.id, k, o.versao), () => {
        // IC05: a chave toca o sino só depois que o banco registrou a confirmação do recebimento.
        const lugar = el('div', { class: 'aviso__momento' });
        anunciar('sucesso', 'Recebimento confirmado. Obrigado!', lugar);
        montarMomento(lugar, 'IC05', { tamanho: 'm' }).disparar();
      });
    }));
    if (!o.revisao_pendente) {
      const revisar = el('button', { type: 'button', class: 'botao botao--secundario', id: 'pedir-revisao' }, 'Pedir revisão');
      revisar.addEventListener('click', () => ocupado(revisar, async () => {
        const r = await dialogoFormulario({ id: 'revisao-os', titulo: 'Pedir revisão do serviço', rotuloConfirmar: 'Enviar pedido',
          campos: [campoTexto({ nome: 'texto', rotulo: 'O que precisa ser revisto?', obrigatorio: true, linhas: 3, max: 1000, id: 'revisao-os-texto', ajuda: 'De 10 a 1.000 caracteres.' })],
          validar: (f) => { const t = texto(10, 1000, 'Explique com 10 a 1.000 caracteres.')(f, 'texto'); return t ? { texto: t } : null; } });
        if (r) await agir('revisao', (k) => pedirRevisaoOs(o.id, r.texto, k, o.versao), () => anunciar('sucesso', 'Pedido de revisão enviado. A empresa não pode encerrar a OS enquanto ele estiver aberto.'));
      }));
      botoes.push(revisar);
    }
    partes.push(aviso('info', o.revisao_pendente ? 'Seu pedido de revisão está com a empresa.' : 'A empresa informou que o serviço foi concluído.',
      el('p', {}, 'Confirme se recebeu ou peça revisão. Sem resposta, a empresa pode encerrar a OS 7 dias depois da conclusão.')),
    el('div', { class: 'grupo-botoes' }, confirmar, ...botoes));
  }
  // E07: etapas do checklist que a empresa marcou como visíveis ao cliente (só texto e situação).
  if (o.etapas?.length) {
    const feitas = o.etapas.filter((x) => x.concluido).length;
    partes.push(el('section', { class: 'pilha', 'aria-labelledby': 'titulo-etapas' }, el('h2', { id: 'titulo-etapas' }, `Etapas do serviço (${feitas} de ${o.etapas.length})`),
      el('ul', { class: 'lista-simples checklist', id: 'etapas-servico' }, ...o.etapas.map((x) => el('li', { class: `checklist__item${x.concluido ? ' checklist__item--feito' : ''}` },
        el('span', {}, el('span', { 'aria-hidden': 'true' }, x.concluido ? '✓ ' : '○ '), x.texto, el('span', { class: 'visualmente-oculto' }, x.concluido ? ' (feito)' : ' (pendente)')))))));
  }
  partes.push(el('section', { class: 'pilha', 'aria-labelledby': 'titulo-valores' }, el('h2', { id: 'titulo-valores' }, 'Valor e pagamento'), blocoValores(o.valores)));
  partes.push(secaoHorario(o));
  if (o.garantia) partes.push(el('section', { class: 'pilha', 'aria-labelledby': 'titulo-garantia' }, el('h2', { id: 'titulo-garantia' }, 'Garantia'), blocoGarantia(o.garantia)));
  const canc = [blocoCondicoes(o.condicoes_cancelamento)];
  if (o.estado === 'cancelada') {
    canc.unshift(blocoCancelamento(o.cancelamento));
    if (o.custos.length) canc.push(el('div', { class: 'pilha', id: 'custos' }, ...o.custos.map((p) => cartaoCustos(p, acoesCustos(p)))));
  } else if (ESTADOS_ATIVOS.includes(o.estado)) {
    const cancelar = el('button', { type: 'button', class: 'botao botao--secundario', id: 'cancelar-os' }, 'Cancelar o serviço');
    cancelar.addEventListener('click', () => ocupado(cancelar, async () => {
      const r = await dialogoFormulario({ id: 'cancelar-os-d', titulo: 'Cancelar o serviço?', rotuloConfirmar: 'Cancelar o serviço', rotuloCancelar: 'Voltar',
        descricao: ['O cancelamento vale na hora e a empresa não pode impedir. Nada é cobrado automaticamente.',
          'Contratação pela plataforma, em até 7 dias do aceite e antes do início do serviço: não há custos de cancelamento (regra sujeita a revisão jurídica).',
          'Depois disso, a empresa só pode propor custos se o orçamento aceito trazia condições de cancelamento; você aceita ou contesta.'],
        campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo (opcional)', max: 300, id: 'cancelar-os-motivo' })], validar: (f) => valores(f) });
      if (r) await agir('cancelar-os', (k) => cancelarOs(o.id, r.motivo, false, k), () => anunciar('sucesso', 'Serviço cancelado.'));
    }));
    canc.push(el('div', { class: 'grupo-botoes' }, cancelar));
  }
  partes.push(el('section', { class: 'pilha', 'aria-labelledby': 'titulo-cancelamento' }, el('h2', { id: 'titulo-cancelamento' }, 'Cancelamento'), ...canc.filter(Boolean)));
  // M12: a conversa é a mesma da solicitação (mensagens anteriores ao aceite e atualizações públicas da OS); a linha do
  // tempo mostra os demais eventos, sem repetir as atualizações. Avaliação só com a OS encerrada (D12-09).
  partes.push(secaoConversa({ tipo: 'os', id: o.id, titulo: 'Conversa com a empresa', anunciar }).secao);
  if (['concluida', 'encerrada'].includes(o.estado)) partes.push(secaoAvaliacaoCliente(o.id, { anunciar }));
  partes.push(el('section', { class: 'pilha', 'aria-labelledby': 'titulo-andamento' }, el('h2', { id: 'titulo-andamento' }, 'Andamento'),
    linhaDoTempoOs(o.eventos.filter((e) => e.tipo !== 'atualizacao'))));
  return partes.filter(Boolean);
}

async function carregar() {
  mostrarCarregando(area, 'Carregando seus serviços');
  try {
    if (!(await exigirSessao(area, { perfil: 'cliente', entrada: '/cliente/entrar.html' }))) return;
    if (aberta) {
      const o = await minhaOrdem(aberta);
      o.etapas = await checklistOsCliente(o.id).catch(() => []);
      concluirCarregamento(area);
      area.replaceChildren(...detalhe(o));
      return;
    }
    const lista = await minhasOrdens();
    concluirCarregamento(area);
    area.replaceChildren(lista.length ? el('ul', { class: 'pilha', id: 'minhas-os' }, ...lista.map((o) => {
      const abrir = el('a', { href: `/cliente/ordens.html?os=${encodeURIComponent(o.id)}` }, `OS nº ${o.numero} · ${o.servico}`);
      abrir.addEventListener('click', (e) => { e.preventDefault(); aberta = o.id; history.pushState({}, '', abrir.href); carregar(); });
      return el('li', { class: 'cartao pilha', 'data-conversa': `os:${o.id}` }, el('h3', {}, abrir, ' ', chipOs(o.estado)),
        el('p', {}, `${o.empresa} · ${formatarDataHora(o.criado_em)}`),
        o.horario ? el('p', {}, `Horário: ${textoHorario(o.horario.inicio, o.horario.fim)}`) : null,
        o.acao_pendente ? el('p', { class: 'campo__ajuda', 'data-acao-pendente': o.acao_pendente }, `${ACAO[o.acao_pendente]}: abra para responder.`) : null,
        o.suspensao ? el('p', { class: 'chip chip--alerta chip--quebra', 'data-suspensao': o.suspensao }, 'Vitrine da empresa suspensa') : null);
    })) : el('p', { id: 'minhas-os' }, 'Você ainda não tem serviços contratados. Eles aparecem aqui quando você aceita um orçamento.'));
    marcarNovas(area);
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

window.addEventListener('popstate', () => { aberta = parametro('os'); carregar(); });
carregar();
