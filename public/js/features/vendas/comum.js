/**
 * Utilidades das telas do M06 (clientes, vendas e pedidos).
 * A tela só orienta e esconde o que a pessoa não pode fazer; quem decide é o banco.
 */
import { el } from '../../ui/dom.js';
import { limparErros } from '../../ui/formulario.js';
import { formatarCentavos } from '../../domain/moeda.js';
import { ESTADO_VENDA, ENTREGA, PAGAMENTO, ESTADO_PEDIDO, ORIGEM } from '../../data/vendas.js';

export { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, quantidadeLegivel, novaChave } from '../estoque/comum.js';

export const dinheiro = (centavos) => (Number.isSafeInteger(centavos) ? formatarCentavos(centavos) : '—');
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
/** Data de hoje em São Paulo (AAAA-MM-DD). */
export const dataDeHoje = () => hoje.format(new Date());
export function somarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const dataCurta = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });
export const formatarData = (iso) => (iso ? dataCurta.format(new Date(`${iso}T12:00:00Z`)) : '');

const chip = (classe, icone, texto) => el('span', { class: `chip ${classe}` }, el('span', { 'aria-hidden': 'true' }, icone), texto);
export const chipEstadoVenda = (e) => chip({ rascunho: 'chip--neutro', confirmada: 'chip--sucesso', cancelada: 'chip--erro' }[e] ?? 'chip--neutro',
  { rascunho: '•', confirmada: '✓', cancelada: '✕' }[e] ?? '•', ESTADO_VENDA[e] ?? e);
export const chipEntrega = (e) => (e ? chip(e === 'pendente' ? 'chip--alerta' : e === 'entregue' ? 'chip--info' : 'chip--neutro',
  e === 'pendente' ? '!' : '•', ENTREGA[e] ?? e) : null);
export const chipPagamento = (p) => (p ? chip({ aberto: 'chip--alerta', parcial: 'chip--alerta', liquidado: 'chip--sucesso', cancelado: 'chip--neutro' }[p.estado] ?? 'chip--neutro',
  p.estado === 'liquidado' ? '✓' : '•', PAGAMENTO[p.estado] ?? p.estado) : null);
export const chipOrigem = (o) => chip('chip--neutro', '•', ORIGEM[o] ?? o);
export const chipPedido = (e) => chip({ solicitado: 'chip--alerta', aceito: 'chip--info', concluido: 'chip--sucesso', recusado: 'chip--erro', cancelado: 'chip--neutro' }[e] ?? 'chip--neutro',
  { solicitado: '!', aceito: '•', concluido: '✓', recusado: '✕', cancelado: '✕' }[e] ?? '•', ESTADO_PEDIDO[e] ?? e);

/**
 * Diálogo modal com formulário próprio (motivo, valor, destinos). `validar(form)` devolve os valores
 * ou null (depois de marcar o erro ao lado do campo). Devolve os valores ou null se a pessoa desistir.
 */
export function dialogoFormulario({ id, titulo, descricao = [], campos, rotuloConfirmar, rotuloCancelar = 'Voltar', validar }) {
  return new Promise((resolver) => {
    const gatilho = document.activeElement;
    const confirmar = el('button', { type: 'submit', class: 'botao' }, rotuloConfirmar);
    const cancelar = el('button', { type: 'button', class: 'botao botao--secundario' }, rotuloCancelar);
    const form = el('form', { class: 'pilha', novalidate: true, id: `${id}-form` }, ...campos, el('div', { class: 'grupo-botoes' }, confirmar, cancelar));
    const dialogo = el('dialog', { class: 'dialogo', 'aria-labelledby': `${id}-titulo`, id },
      el('div', { class: 'dialogo__corpo pilha' }, el('h2', { id: `${id}-titulo` }, titulo), ...descricao.map((t) => (t instanceof Node ? t : el('p', {}, t))), form));
    let resultado = null;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const v = validar(form);
      if (!v) return;
      resultado = v;
      dialogo.close();
    });
    cancelar.addEventListener('click', () => dialogo.close());
    dialogo.addEventListener('close', () => {
      dialogo.remove();
      if (gatilho instanceof HTMLElement) gatilho.focus();
      resolver(resultado);
    });
    document.body.append(dialogo);
    dialogo.showModal();
    form.querySelector('input, select, textarea, button')?.focus();
  });
}

/** Texto curto de um item de venda ou pedido. */
export const nomeItem = (i) => (i.variacao && i.variacao !== 'Padrão' ? `${i.produto} (${i.variacao})` : i.produto);
