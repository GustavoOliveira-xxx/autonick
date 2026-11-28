/**
 * Autocompletar acessível (padrão combobox da WAI-ARIA): digitar busca no servidor com espera curta (debounce), a lista
 * mostra poucos resultados por vez com "Mostrar mais", setas sobem e descem, Enter escolhe, Esc fecha. Respostas
 * atrasadas de buscas antigas são descartadas. Nada da base inteira vai para o navegador.
 *
 * buscar(texto, deslocamento) => Promise<{ itens: [], mais: boolean }>
 */
import { el } from './dom.js';

let sequencia = 0;

export function autocompletar({ id, rotulo, dica = '', ajuda = null, buscar, rotuloItem, detalheItem = () => '', aoEscolher, minimo = 0,
  espera = 250, vazioTexto = 'Nada encontrado.', acaoExtra = null }) {
  const idLista = `${id}-lista`;
  const entrada = el('input', { type: 'text', id, role: 'combobox', autocomplete: 'off', 'aria-autocomplete': 'list', 'aria-expanded': 'false',
    'aria-controls': idLista, placeholder: dica, 'aria-describedby': [ajuda ? `${id}-ajuda` : null, `${id}-estado`, `${id}-erro`].filter(Boolean).join(' ') });
  const lista = el('ul', { id: idLista, role: 'listbox', class: 'autocompletar__lista', hidden: true, 'aria-label': rotulo });
  const estado = el('span', { id: `${id}-estado`, class: 'visualmente-oculto', 'aria-live': 'polite' });
  const rodape = el('div', { class: 'autocompletar__rodape', hidden: true });
  const painel = el('div', { class: 'autocompletar__painel', hidden: true }, lista, rodape);
  let itens = [];
  let ativo = -1;
  let texto = '';
  let mais = false;
  let relogio = null;
  let atual = 0;

  const fechar = () => { painel.hidden = true; lista.hidden = true; rodape.hidden = true; entrada.setAttribute('aria-expanded', 'false'); entrada.removeAttribute('aria-activedescendant'); ativo = -1; };
  const marcar = (i) => {
    ativo = i;
    for (const [n, li] of [...lista.children].entries()) li.setAttribute('aria-selected', String(n === i));
    const alvo = lista.children[i];
    if (alvo?.id) { entrada.setAttribute('aria-activedescendant', alvo.id); alvo.scrollIntoView?.({ block: 'nearest' }); } else entrada.removeAttribute('aria-activedescendant');
  };
  const escolher = (i) => {
    const item = itens[i];
    if (!item) return;
    fechar();
    aoEscolher(item);
  };
  const desenhar = () => {
    lista.replaceChildren(...(itens.length ? itens.map((item, i) => {
      const li = el('li', { role: 'option', id: `${id}-op-${i}`, class: 'autocompletar__opcao', 'aria-selected': 'false' },
        el('span', { class: 'autocompletar__titulo' }, rotuloItem(item)), detalheItem(item) ? el('span', { class: 'autocompletar__detalhe' }, detalheItem(item)) : null);
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => escolher(i));
      return li;
    }) : [el('li', { class: 'autocompletar__vazio', role: 'presentation' }, vazioTexto)]));
    const botaoMais = mais ? el('button', { type: 'button', class: 'botao botao--texto', id: `${id}-mais` }, 'Mostrar mais') : null;
    botaoMais?.addEventListener('mousedown', (e) => e.preventDefault());
    botaoMais?.addEventListener('click', () => consultar(texto, itens.length));
    rodape.replaceChildren(...[botaoMais, acaoExtra?.()].filter(Boolean));
    lista.hidden = false;
    painel.hidden = false;
    rodape.hidden = !rodape.childElementCount;
    entrada.setAttribute('aria-expanded', 'true');
    estado.textContent = itens.length ? `${itens.length} resultado${itens.length > 1 ? 's' : ''}${mais ? ', há mais' : ''}. Use as setas para escolher.` : vazioTexto;
  };
  async function consultar(t, deslocamento = 0) {
    const minha = ++atual;
    texto = t;
    lista.setAttribute('aria-busy', 'true');
    try {
      const r = await buscar(t, deslocamento);
      if (minha !== atual) return;
      const novos = Array.isArray(r?.itens) ? r.itens : [];
      itens = deslocamento ? [...itens, ...novos] : novos;
      mais = Boolean(r?.mais);
      desenhar();
      if (deslocamento) marcar(deslocamento);
    } catch (erro) {
      if (minha !== atual) return;
      itens = [];
      mais = false;
      lista.replaceChildren(el('li', { class: 'autocompletar__vazio', role: 'presentation' }, erro?.message || 'Não foi possível buscar agora.'));
      lista.hidden = false;
      painel.hidden = false;
      entrada.setAttribute('aria-expanded', 'true');
      estado.textContent = 'Não foi possível buscar agora.';
    } finally {
      if (minha === atual) lista.removeAttribute('aria-busy');
    }
  }
  const agendar = () => {
    clearTimeout(relogio);
    const t = entrada.value.trim();
    if (t.length < minimo) { fechar(); return; }
    relogio = setTimeout(() => consultar(t, 0), espera);
  };
  entrada.addEventListener('input', agendar);
  entrada.addEventListener('focus', () => { if (!entrada.value.trim() && minimo === 0) agendar(); });
  entrada.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (lista.hidden) agendar(); else marcar(Math.min(ativo + 1, itens.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(Math.max(ativo - 1, 0)); }
    else if (e.key === 'Enter') {
      // Enter na busca nunca envia o formulário: escolhe o item destacado (ou o primeiro); sem lista ainda, busca na hora.
      e.preventDefault();
      if (!lista.hidden && itens.length) escolher(ativo >= 0 ? ativo : 0);
      else { clearTimeout(relogio); const t = entrada.value.trim(); if (t.length >= minimo) consultar(t, 0); }
    }
    else if (e.key === 'Escape') { if (!lista.hidden) { e.preventDefault(); e.stopPropagation(); fechar(); } }
  });
  entrada.addEventListener('blur', () => setTimeout(fechar, 150));
  const elemento = el('div', { class: 'campo autocompletar' },
    el('label', { for: id }, rotulo),
    ajuda ? el('span', { class: 'campo__ajuda', id: `${id}-ajuda` }, ajuda) : null,
    el('div', { class: 'autocompletar__caixa' }, entrada, painel), estado,
    el('span', { class: 'campo__erro', id: `${id}-erro` }));
  return { elemento, entrada, fechar, limpar: () => { entrada.value = ''; itens = []; fechar(); }, id: `ac-${++sequencia}` };
}
