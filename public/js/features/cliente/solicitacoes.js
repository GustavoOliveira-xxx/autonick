/**
 * Cliente: minhas solicitações (M08, tela mínima; D8-02, D8-13 a D8-16, D8-20). O cliente vê só as próprias, sem notas
 * internas nem dados do catálogo da empresa. Aceita só a versão atual e dentro da validade, confirmando as condições;
 * pode pedir revisão, recusar ou cancelar antes do aceite. Nada é cobrado por aqui.
 */
import { secaoAnexos } from '../../ui/anexos.js';
import { marcarNovas } from '../comunicacao/marcador.js';
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { textoHorario } from '../../domain/servicos.js';
import { minhasSolicitacoes, minhaSolicitacao, aceitarOrcamento, recusarOrcamento, pedirRevisao, cancelarSolicitacao,
  MOTIVO_RECUSA } from '../../data/servicos.js';
import { novaChave } from '../../data/empresas.js';
import { exigirSessao, formatarDataHora } from '../empresa/comum.js';
import { avisoSuspensao } from './jornada.js';
import { montarMomento } from '../../ui/forja3d/momentos.js';
import { secaoConversa } from '../comunicacao/conversa.js';
import { chipSolicitacao, cartaoVersao, linhaDoTempo, blocoRespostas, blocoEstimativa, blocoHorario, dinheiro, dataDeHoje, dialogoFormulario } from '../servicos/comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const avisos = document.getElementById('avisos');
const chaves = new Map();
const chave = (a) => { if (!chaves.has(a)) chaves.set(a, novaChave()); return chaves.get(a); };
let aberta = parametro('s');

function anunciar(tipo, texto, ...extra) {
  avisos.replaceChildren(el('div', { role: tipo === 'erro' ? 'alert' : 'status' }, aviso(tipo, texto, ...extra)));
  avisos.scrollIntoView({ block: 'nearest' });
}

async function agir(acao, chamada, sucesso, form = null) {
  try {
    const r = await chamada(chave(acao));
    chaves.delete(acao);
    await carregar();
    sucesso?.(r);
  } catch (erro) {
    if (erro.codigo === 'NETWORK_UNKNOWN') return anunciar('erro', erro.message, el('p', {}, 'Tente de novo: a ação não será duplicada.'));
    chaves.delete(acao);
    if (erro.codigo === 'VALIDATION_ERROR' && form && erroNoCampo(form, erro.campo, erro.message)) return null;
    if (['QUOTE_VERSION_STALE', 'QUOTE_EXPIRED', 'STATE_CONFLICT'].includes(erro.codigo)) await carregar();
    anunciar(erro.codigo === 'QUOTE_EXPIRED' || erro.codigo === 'QUOTE_VERSION_STALE' ? 'alerta' : 'erro', erro.message);
  }
  return null;
}

function acoesVigente(s, v) {
  if (!['orcamento_enviado', 'revisao_pedida'].includes(s.estado) || v.id !== s.versao_vigente_id || v.estado !== 'enviada') return [];
  const vencida = v.estado_exibicao === 'vencida';
  const aceitar = el('button', { type: 'button', class: 'botao', 'data-aceitar': v.numero }, 'Aceitar este orçamento');
  // D11-06: com a vitrine da empresa suspensa, o aceite fica congelado (o banco também recusa); recusar e cancelar seguem.
  aceitar.disabled = vencida || Boolean(s.suspensao);
  aceitar.addEventListener('click', () => ocupado(aceitar, async () => {
    const r = await dialogoFormulario({ id: 'aceite', titulo: `Aceitar a versão ${v.numero} por ${dinheiro(v.total_centavos)}?`, rotuloConfirmar: 'Aceitar',
      descricao: [v.condicoes ? `Condições: ${v.condicoes}` : 'Sem condições adicionais.',
        s.politica_cancelamento ? `Política de cancelamento: ${s.politica_cancelamento.texto}` : 'A empresa não informou política de cancelamento.', s.horario ? `Horário definido pela empresa: ${textoHorario(s.horario.inicio, s.horario.fim)}.` : 'O horário ainda será combinado com a empresa.',
        'Aceitar registra o acordo. Nada é cobrado por aqui; o pagamento é combinado diretamente com a empresa.'],
      campos: [el('div', { class: 'opcao' }, el('input', { type: 'checkbox', id: 'aceite-condicoes', name: 'condicoes' }),
        el('label', { for: 'aceite-condicoes' }, 'Li e aceito o orçamento e as condições acima')), el('span', { class: 'campo__erro', 'data-grupo': 'condicoes' })],
      validar: (form) => (valores(form).condicoes ? {} : (erroNoCampo(form, 'condicoes', 'Marque para confirmar.') && null)) });
    if (!r) return;
    await agir(`aceitar-${v.id}`, (k) => aceitarOrcamento(s.id, v.id, k), () => {
      // IC06: o carimbo bate só depois que o banco registrou o aceite.
      const lugar = el('div', { class: 'aviso__momento' });
      anunciar('sucesso', 'Orçamento aceito. A ordem de serviço foi criada; acompanhe em Meus serviços.', lugar);
      montarMomento(lugar, 'IC06', { tamanho: 'p' }).disparar();
    });
  }));
  const recusar = el('button', { type: 'button', class: 'botao botao--secundario', 'data-recusar': v.numero }, 'Recusar');
  recusar.addEventListener('click', () => ocupado(recusar, async () => {
    const r = await dialogoFormulario({ id: 'recusa', titulo: 'Recusar o orçamento?', rotuloConfirmar: 'Recusar',
      descricao: ['A solicitação é encerrada. Se só quiser mudar algo, prefira pedir revisão. Nenhuma cobrança é gerada.'],
      campos: [campoSelecao({ nome: 'opcao', rotulo: 'Motivo', opcoes: Object.entries(MOTIVO_RECUSA), vazio: null, id: 'recusa-opcao' }),
        campoTexto({ nome: 'texto', rotulo: 'Comentário (opcional)', max: 300, id: 'recusa-texto' })],
      validar: (form) => valores(form) });
    if (!r) return;
    await agir(`recusar-${v.id}`, (k) => recusarOrcamento(s.id, v.id, { opcao: r.opcao, texto: r.texto || null }, k), () => anunciar('sucesso', 'Orçamento recusado.'));
  }));
  const revisar = el('button', { type: 'button', class: 'botao botao--secundario', 'data-revisao': v.numero }, 'Pedir revisão');
  revisar.addEventListener('click', () => ocupado(revisar, async () => {
    const r = await dialogoFormulario({ id: 'revisao', titulo: 'Pedir revisão do orçamento', rotuloConfirmar: 'Enviar pedido',
      descricao: ['A versão atual continua valendo até a empresa enviar outra.'],
      campos: [campoTexto({ nome: 'texto', rotulo: 'O que precisa mudar?', obrigatorio: true, linhas: 3, max: 1000, id: 'revisao-texto' })],
      validar: (form) => { const t = valores(form).texto ?? ''; return t.length >= 5 ? { texto: t } : (erroNoCampo(form, 'texto', 'Explique com pelo menos 5 caracteres.') && null); } });
    if (!r) return;
    await agir(`revisao-${v.id}`, (k) => pedirRevisao(s.id, r.texto, k), () => anunciar('sucesso', 'Pedido de revisão enviado à empresa.'));
  }));
  return [aceitar, revisar, recusar];
}

/**
 * IC04: enquanto a empresa não respondeu, o balão fica parado (sem fingir que alguém está digitando).
 * Quando existe um orçamento enviado esperando a resposta do cliente, ele vira alerta; o "PLIM" toca uma vez por versão.
 */
function balaoOrcamento(s, versoes) {
  const aguardando = ['nova', 'em_analise'].includes(s.estado) && !versoes.length;
  const vigente = ['orcamento_enviado', 'revisao_pedida'].includes(s.estado) ? versoes.find((v) => v.id === s.versao_vigente_id && v.estado === 'enviada') : null;
  if (!aguardando && !vigente) return null;
  const lugar = el('div', { class: 'balao-orcamento' });
  const balao = montarMomento(lugar, 'IC04', { tamanho: 'p' });
  if (aguardando) { balao.definir({ fase: 'aguardando' }); return lugar; }
  const marca = `autonick:orcamento-visto:${vigente.id}`;
  let visto = false;
  try { visto = localStorage.getItem(marca) === '1'; localStorage.setItem(marca, '1'); } catch { visto = false; }
  balao.definir({ fase: 'chegou', inicio: visto ? (t) => t - 60 : 'agora' });
  return lugar;
}

function detalhe(s) {
  const hoje = dataDeHoje();
  const partes = [el('p', {}, el('a', { class: 'botao botao--secundario', href: '/cliente/solicitacoes.html' }, 'Voltar às solicitações')),
    el('h2', { id: 'resumo' }, `Nº ${s.numero} · ${s.servico} · ${s.empresa} `, chipSolicitacao(s.estado_exibicao, true))];
  partes.push(avisoSuspensao(s.suspensao, ['nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida'].includes(s.estado) ? 'pendente' : 'aceito'));
  if (s.estado === 'aceita') partes.push(aviso('sucesso', 'Orçamento aceito.', el('p', {}, 'A empresa vai dar andamento ao serviço. Nada é cobrado por aqui.'),
    s.os ? el('p', {}, el('a', { class: 'botao botao--secundario', href: `/cliente/ordens.html?os=${encodeURIComponent(s.os.id)}`, id: 'link-os' }, `Acompanhar a ordem de serviço nº ${s.os.numero}`)) : null));
  if (s.politica_cancelamento) partes.push(el('p', { class: 'campo__ajuda', id: 'politica-cancelamento' }, `Política de cancelamento da empresa: ${s.politica_cancelamento.texto}`));
  if (s.motivo_encerramento) partes.push(el('p', {}, `Motivo do encerramento: ${s.motivo_encerramento}`));
  if (s.estado_exibicao === 'vencido') partes.push(aviso('alerta', 'O prazo deste orçamento terminou. Peça uma atualização à empresa.'));
  partes.push(blocoHorario(s.horario));
  const versoes = s.versoes.filter((v) => !['rascunho', 'aguardando_aprovacao'].includes(v.estado));
  partes.push(el('section', { class: 'pilha', 'aria-labelledby': 'titulo-orcamentos' }, el('h2', { id: 'titulo-orcamentos' }, 'Orçamentos'),
    balaoOrcamento(s, versoes),
    versoes.length ? el('div', { class: 'pilha', id: 'versoes' }, ...versoes.map((v) => cartaoVersao(v, hoje, acoesVigente(s, v))))
      : el('p', { id: 'versoes' }, 'A empresa ainda não enviou orçamento.')));
  partes.push(el('section', { class: 'pilha', 'aria-labelledby': 'titulo-pedido' }, el('h2', { id: 'titulo-pedido' }, 'O que você pediu'), blocoRespostas(s),
    blocoEstimativa(s.estimativa, 'estimativa', { cliente: true, orcamentoDisponivel: versoes.length > 0 })));
  // M12 (D12-01, D12-02): a conversa do atendimento (a mesma da OS) junta as mensagens do M08 e as novas; a linha do
  // tempo mostra só os demais eventos, para não repetir as mensagens.
  partes.push(secaoAnexos({ solicitacaoId: s.id, podeEnviar: ['nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida', 'aceita'].includes(s.estado),
    ajuda: 'Opcional: fotos do que precisa de conserto ou documentos que ajudem no orçamento. Só você e a empresa veem.' }));
  partes.push(secaoConversa({ tipo: 'solicitacao', id: s.id, titulo: 'Conversa com a empresa', anunciar }).secao);
  partes.push(el('section', { class: 'pilha', 'aria-labelledby': 'titulo-andamento' }, el('h2', { id: 'titulo-andamento' }, 'Andamento'),
    linhaDoTempo(s.eventos.filter((e) => e.tipo !== 'mensagem'))));
  if (['nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida'].includes(s.estado)) {
    const cancelar = el('button', { type: 'button', class: 'botao botao--secundario', id: 'cancelar-solicitacao' }, 'Cancelar a solicitação');
    cancelar.addEventListener('click', () => ocupado(cancelar, async () => {
      const r = await dialogoFormulario({ id: 'cancelar', titulo: 'Cancelar a solicitação?', rotuloConfirmar: 'Cancelar solicitação', rotuloCancelar: 'Voltar',
        descricao: ['Antes do aceite, cancelar não gera cobrança nenhuma.'], campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo (opcional)', max: 300, id: 'cancelar-motivo' })],
        validar: (form) => valores(form) });
      if (!r) return;
      await agir('cancelar', (k) => cancelarSolicitacao(s.id, r.motivo, k), () => anunciar('sucesso', 'Solicitação cancelada.'));
    }));
    partes.push(el('div', { class: 'grupo-botoes' }, cancelar));
  }
  return partes.filter(Boolean);
}

async function carregar() {
  mostrarCarregando(area, 'Carregando suas solicitações');
  try {
    if (!(await exigirSessao(area, { perfil: 'cliente', entrada: '/cliente/entrar.html' }))) return;
    if (aberta) {
      const s = await minhaSolicitacao(aberta);
      concluirCarregamento(area);
      area.replaceChildren(...detalhe(s));
      return;
    }
    const lista = await minhasSolicitacoes();
    concluirCarregamento(area);
    // D11-03: novas solicitações começam pela vitrine.
    area.replaceChildren(el('p', {}, el('a', { class: 'botao botao--secundario', href: '/cliente/', class: 'botao' }, 'Buscar um serviço para pedir orçamento')),
      lista.length ? el('ul', { class: 'pilha', id: 'minhas-solicitacoes' }, ...lista.map((s) => {
        const abrir = el('a', { href: `/cliente/solicitacoes.html?s=${encodeURIComponent(s.id)}` }, `Nº ${s.numero} · ${s.servico}`);
        abrir.addEventListener('click', (e) => { e.preventDefault(); aberta = s.id; history.pushState({}, '', abrir.href); carregar(); });
        return el('li', { class: 'cartao pilha', 'data-conversa': `solicitacao:${s.id}` }, el('h3', {}, abrir, ' ', chipSolicitacao(s.estado_exibicao, true)),
          el('p', {}, `${s.empresa} · ${formatarDataHora(s.criado_em)}`),
          s.total_vigente_centavos ? el('p', {}, `Orçamento: ${dinheiro(s.total_vigente_centavos)}`) : null,
          s.horario ? el('p', {}, `Horário: ${textoHorario(s.horario.inicio, s.horario.fim)}`) : null,
          s.suspensao ? el('p', { class: 'chip chip--alerta chip--quebra', 'data-suspensao': s.suspensao }, 'Vitrine da empresa suspensa') : null);
      })) : el('p', { id: 'minhas-solicitacoes' }, 'Você ainda não fez nenhuma solicitação.'));
    marcarNovas(area);
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

window.addEventListener('popstate', () => { aberta = parametro('s'); carregar(); });
carregar();
