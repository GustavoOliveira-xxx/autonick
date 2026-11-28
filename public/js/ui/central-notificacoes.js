/**
 * Central de notificações (E08): sino com contador de não lidas no menu (Business) e no cabeçalho (Cliente).
 * A lista abre num modal: título, texto curto, empresa e quando; abrir uma notificação marca como lida e leva ao link
 * interno; "Marcar todas como lidas"; preferências por tipo. Só aparece com sessão confirmada.
 */
import { el } from './dom.js';
import { abrirModal } from './modal.js';
import { minhasNotificacoes, marcarLidas, preferencias, definirPreferencia, TIPOS_NOTIFICACAO } from '../data/notificacoes.js';

const quando = (iso) => {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
};

function iconeSino() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'icone'); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '/assets/icons/icones.svg#i-sino'); s.append(u);
  return s;
}

export function botaoNotificacoes() {
  const contador = el('span', { class: 'contador', id: 'contador-notificacoes', hidden: true });
  const rotulo = el('span', { class: 'botao-notificacoes__rotulo' }, 'Notificações');
  const b = el('button', { type: 'button', class: 'botao-notificacoes', id: 'abrir-notificacoes', hidden: true, 'aria-haspopup': 'dialog' }, iconeSino(), rotulo, contador);
  const atualizar = (n) => {
    contador.hidden = !n;
    contador.textContent = n > 99 ? '99+' : String(n);
    b.setAttribute('aria-label', n ? `Notificações: ${n} não ${n === 1 ? 'lida' : 'lidas'}` : 'Notificações');
  };
  const carregarContagem = async () => {
    try { const r = await minhasNotificacoes(null, 1); if (r && typeof r === 'object' && 'nao_lidas' in r) { b.hidden = false; atualizar(Number(r.nao_lidas) || 0); } } catch { /* sem sessão ou sem rede */ }
  };
  document.addEventListener('autonick:sessao', (e) => { if (e.detail?.autenticado) carregarContagem(); else b.hidden = true; });
  b.addEventListener('click', () => abrirCentral(b, atualizar));
  carregarContagem();
  return b;
}

async function abrirCentral(origem, atualizarContador) {
  const lista = el('ul', { class: 'lista-notificacoes', id: 'lista-notificacoes', 'aria-live': 'polite' }, el('li', { class: 'campo__ajuda' }, 'Carregando…'));
  const mais = el('button', { type: 'button', class: 'botao botao--secundario', hidden: true }, 'Mostrar mais antigas');
  const todas = el('button', { type: 'button', class: 'botao botao--secundario', id: 'marcar-todas' }, 'Marcar todas como lidas');
  const prefs = el('details', { class: 'detalhes-opcionais', id: 'preferencias-notificacao' }, el('summary', {}, 'Quais avisos receber'), el('p', { class: 'campo__ajuda' }, 'Carregando…'));
  let itens = [];
  let naoLidas = 0;
  const desenhar = () => {
    lista.replaceChildren(...(itens.length ? itens.map((n) => {
      const a = el('a', { class: `notificacao-item${n.lida ? '' : ' notificacao-item--nova'}`, href: n.link },
        el('strong', {}, n.titulo), n.texto ? el('span', {}, n.texto) : null,
        el('small', {}, [n.empresa, quando(n.criada_em), n.lida ? null : 'não lida'].filter(Boolean).join(' · ')));
      a.addEventListener('click', async (e) => {
        if (n.lida) return;
        e.preventDefault();
        try { await marcarLidas([n.id]); } catch { /* segue para o link mesmo assim */ }
        location.assign(n.link);
      });
      return el('li', {}, a);
    }) : [el('li', { class: 'estado-vazio' }, el('p', {}, 'Nenhuma notificação por enquanto. Avisos de pedidos, orçamentos, serviços e aprovações aparecem aqui.'))]));
    atualizarContador(naoLidas);
    todas.disabled = !naoLidas;
  };
  const carregar = async (antes = null) => {
    const r = await minhasNotificacoes(antes, 20);
    const novos = Array.isArray(r?.itens) ? r.itens : [];
    itens = antes ? [...itens, ...novos] : novos;
    naoLidas = Number(r?.nao_lidas) || 0;
    mais.hidden = !r?.mais;
    desenhar();
  };
  mais.addEventListener('click', () => carregar(itens.at(-1)?.criada_em ?? null));
  todas.addEventListener('click', async () => {
    try { await marcarLidas(null); itens = itens.map((n) => ({ ...n, lida: true })); naoLidas = 0; desenhar(); } catch { /* mantém como estava */ }
  });
  abrirModal({ titulo: 'Notificações', descricao: 'Só dentro do AutoniCK. Não enviamos e-mail, SMS nem push.', corpo: el('div', { class: 'pilha' }, lista, mais, prefs),
    rodape: [todas], tamanho: 'medio', aoFechar: () => origem?.focus() });
  try { await carregar(); } catch (erro) { lista.replaceChildren(el('li', {}, erro.message || 'Não foi possível carregar.')); }
  try {
    const p = await preferencias();
    prefs.replaceChildren(prefs.firstChild, ...Object.entries(TIPOS_NOTIFICACAO).map(([tipo, rotulo]) => {
      const c = el('input', { type: 'checkbox', id: `pref-${tipo}`, checked: p?.[tipo] !== false });
      c.addEventListener('change', () => definirPreferencia(tipo, c.checked).catch(() => { c.checked = !c.checked; }));
      return el('label', { class: 'opcao', for: `pref-${tipo}` }, c, rotulo);
    }));
  } catch { prefs.hidden = true; }
}
