/**
 * Conversa do atendimento (M12; D12-01 a D12-07). Uma por atendimento: a solicitação e a OS que nasce dela compartilham
 * a mesma; o pedido de produto tem a sua. O banco junta, sem cópia, as mensagens novas, as do M08 e as atualizações
 * públicas da OS; notas internas nunca vêm.
 *
 * Atualização (D12-04): com a tela aberta e a aba visível, consulta o banco a cada 20 segundos, com espera maior depois
 * de falhas e pausa com a aba oculta; o botão "Atualizar" consulta na hora. Não é tempo real (RF-159 PARCIAL).
 */
import { el } from '../../ui/dom.js';
import { campoTexto, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { novaChave } from '../../data/empresas.js';
import { conversaAtendimento, enviarMensagem } from '../../data/comunicacao.js';
import { marcarConversaLida } from '../../data/painel.js';
import { formatarDataHora } from '../empresa/comum.js';
import { botaoDenunciar, marcaModeracaoAutor } from './moderacao.js';

export const INTERVALO_MS = 20000;
const MAXIMO_MS = 160000;

function rotuloAutor(item, papel) {
  if (item.tipo === 'atualizacao') return 'Atualização da empresa';
  if (item.proprio) return 'Você';
  if (item.autor === 'cliente') return papel === 'cliente' ? 'Você' : 'Cliente';
  return papel === 'cliente' ? 'Empresa' : 'Equipe da empresa';
}

/** Monta a seção da conversa. Devolve { secao, parar } (parar encerra a consulta periódica). */
export function secaoConversa({ tipo, id, titulo = 'Conversa', anunciar } = {}) {
  const lista = el('ol', { class: 'pilha conversa', id: 'conversa-itens', 'aria-live': 'polite' });
  const estadoTexto = el('p', { class: 'campo__ajuda', id: 'conversa-estado' }, 'Carregando a conversa…');
  const rodape = el('div', { class: 'pilha', id: 'conversa-rodape' });
  const atualizar = el('button', { type: 'button', class: 'botao botao--texto', id: 'conversa-atualizar' }, 'Atualizar');
  const secao = el('section', { class: 'pilha', 'aria-labelledby': 'titulo-conversa', id: 'conversa', 'data-tipo': tipo },
    el('h2', { id: 'titulo-conversa' }, titulo),
    el('p', { class: 'campo__ajuda' }, 'A conversa é atualizada a cada 20 segundos enquanto esta tela estiver aberta.'),
    estadoTexto, lista, el('div', { class: 'grupo-botoes' }, atualizar), rodape);
  let timer = null;
  let espera = INTERVALO_MS;
  let parado = false;
  let rascunho = '';
  let chaveEnvio = null;
  let assinatura = '';

  function agendar() {
    clearTimeout(timer);
    if (parado) return;
    timer = setTimeout(() => {
      if (!secao.isConnected) return parar();
      if (document.visibilityState !== 'visible') return agendar();
      return carregar();
    }, espera);
  }

  function itemDaConversa(i, papel) {
    const corpo = [];
    if (i.oculta && i.texto === null) {
      corpo.push(el('p', { 'data-oculta': '' }, el('em', {}, 'Conteúdo ocultado pela moderação.')));
    } else {
      corpo.push(el('p', { class: 'conversa__texto' }, i.texto));
      if (i.oculta) corpo.push(marcaModeracaoAutor(i.moderacao, { anunciar, aoConcluir: carregar }));
    }
    const podeDenunciar = !i.proprio && !i.oculta;
    return el('li', { class: `cartao pilha${i.proprio ? ' conversa__item--proprio' : ''}`, 'data-item': i.id, 'data-autor': i.autor, 'data-tipo-item': i.tipo },
      el('p', {}, el('strong', {}, rotuloAutor(i, papel)), ` · ${formatarDataHora(i.criado_em)}`),
      ...corpo,
      podeDenunciar ? el('div', { class: 'grupo-botoes' }, botaoDenunciar(i.alvo_tipo, i.id, { anunciar, descricaoAlvo: 'esta mensagem' })) : null);
  }

  function formulario(c) {
    if (!c.pode_enviar) return el('p', { class: 'campo__ajuda', id: 'conversa-bloqueio' }, c.bloqueio);
    const enviar = el('button', { type: 'submit', class: 'botao' }, 'Enviar mensagem');
    const form = el('form', { class: 'pilha', id: 'form-conversa', novalidate: true },
      campoTexto({ nome: 'texto', rotulo: 'Mensagem', linhas: 3, max: 1000, id: 'conversa-texto', valor: rascunho,
        ajuda: `${c.aviso} Até ${c.limite_diario} mensagens por dia nesta conversa.` }),
      el('div', { class: 'grupo-botoes' }, enviar));
    form.querySelector('textarea')?.addEventListener('input', (e) => { rascunho = e.target.value; });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const texto = (valores(form).texto ?? '').trim();
      if (!texto) return erroNoCampo(form, 'texto', 'Escreva a mensagem.');
      return ocupado(enviar, async () => {
        chaveEnvio ??= novaChave();
        try {
          await enviarMensagem(tipo, id, texto, chaveEnvio);
          chaveEnvio = null;
          rascunho = '';
          await carregar({ focar: true });
        } catch (erro) {
          if (erro.codigo !== 'NETWORK_UNKNOWN') chaveEnvio = null;
          if (erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, 'texto', erro.message)) return;
          anunciar?.('erro', erro.codigo === 'NETWORK_UNKNOWN' ? `${erro.message} Tente de novo: a mensagem não será duplicada.` : erro.message);
          if (erro.codigo === 'STATE_CONFLICT') await carregar();
        }
      });
    });
    return form;
  }

  let lidoAte = null;
  async function carregar({ focar = false } = {}) {
    clearTimeout(timer);
    try {
      const c = await conversaAtendimento(tipo, id);
      espera = INTERVALO_MS;
      const nova = JSON.stringify([c.itens, c.pode_enviar, c.bloqueio, c.suspensao]);
      if (nova !== assinatura) {
        assinatura = nova;
        lista.replaceChildren(...c.itens.map((i) => itemDaConversa(i, c.papel)));
        estadoTexto.textContent = c.itens.length ? `${c.rotulo}: ${c.itens.length} ${c.itens.length === 1 ? 'mensagem' : 'mensagens'}.` : `${c.rotulo}: nenhuma mensagem ainda.`;
        rodape.replaceChildren(...[
          c.suspensao ? el('p', { class: 'chip chip--alerta chip--quebra', 'data-conversa-suspensao': c.suspensao },
            'A vitrine desta empresa está suspensa. A conversa continua neste atendimento.') : null,
          formulario(c)].filter(Boolean));
      }
      // M13b (D13b-10): com a conversa visível, marca como lida até o último item mostrado. Falha aqui não afeta a conversa.
      const ultimo = c.itens.reduce((m, i) => (i.criado_em > m ? i.criado_em : m), '');
      if (ultimo && ultimo !== lidoAte && document.visibilityState === 'visible') {
        lidoAte = ultimo;
        marcarConversaLida(tipo, id, ultimo).catch(() => { lidoAte = null; });
      }
      if (focar) document.getElementById('conversa-texto')?.focus();
    } catch (erro) {
      espera = Math.min(espera * 2, MAXIMO_MS);
      estadoTexto.textContent = `Não foi possível atualizar a conversa agora (${erro.message}). Tentaremos de novo em ${Math.round(espera / 1000)} segundos.`;
    }
    agendar();
  }

  function parar() {
    parado = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', aoMudarVisibilidade);
  }
  function aoMudarVisibilidade() {
    if (document.visibilityState === 'visible' && !parado && secao.isConnected) carregar();
  }
  document.addEventListener('visibilitychange', aoMudarVisibilidade);
  atualizar.addEventListener('click', () => ocupado(atualizar, () => carregar()));
  carregar();
  return { secao, parar, recarregar: carregar };
}
