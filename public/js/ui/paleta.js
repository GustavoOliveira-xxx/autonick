/**
 * Paleta de comandos do Business (E05): Ctrl+K (ou ⌘K) em qualquer tela com empresa ativa.
 *
 * - Ir para: as áreas do menu que o perfil da pessoa permite (mesma regra do menu lateral).
 * - Ações rápidas: atalhos para criar (venda, cliente, produto, compromisso, lançamento, colaborador), só com a permissão.
 * - Fixados: áreas e ações marcadas com a estrela, guardadas no servidor por pessoa e empresa (favoritos).
 * - Registros: busca no banco (busca_global), em que cada grupo só vem com a permissão da área.
 * Padrão de combobox: o foco fica no campo; setas mudam a opção ativa (aria-activedescendant); Enter abre; Esc fecha.
 */
import { el } from './dom.js';
import { abrirModal } from './modal.js';
import { obterEmpresaAtiva } from '../core/contexto-empresa.js';
import { gruposDaEmpresa } from './menu-empresa.js';

const sem = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const q = (id) => encodeURIComponent(id);

export function acoesRapidas(id, pode) {
  return [
    { chave: 'acao:nova-venda', rotulo: 'Nova venda', href: `/business/venda-nova.html?id=${q(id)}`, pode: pode('vendas.criar'), termos: 'vender balcao' },
    { chave: 'acao:novo-cliente', rotulo: 'Cadastrar cliente', href: `/business/clientes.html?id=${q(id)}#titulo-novo-cliente`, pode: pode('clientes.criar'), termos: 'cliente novo' },
    { chave: 'acao:novo-produto', rotulo: 'Cadastrar produto', href: `/business/produtos-empresa.html?id=${q(id)}#titulo-novo-produto`, pode: pode('produtos.criar'), termos: 'produto novo item' },
    { chave: 'acao:novo-compromisso', rotulo: 'Novo compromisso na agenda', href: `/business/agenda.html?id=${q(id)}#novo-compromisso`, pode: pode('agenda.alterar'), termos: 'agendar visita reuniao bloquear' },
    { chave: 'acao:lancamento', rotulo: 'Lançar no financeiro', href: `/business/financeiro-movimentacoes.html?id=${q(id)}`, pode: pode('financeiro.criar'), termos: 'pagar receber despesa receita conta' },
    { chave: 'acao:colaborador', rotulo: 'Adicionar colaborador', href: `/business/equipe.html?id=${q(id)}#adicionar-colaborador`, pode: pode('equipe.convidar'), termos: 'convidar funcionario equipe' },
  ].filter((a) => a.pode);
}

const DESTINO = {
  clientes: (id, r) => `/business/clientes.html?id=${q(id)}&busca=${q(r.titulo)}&ficha=${q(r.id)}`,
  produtos: (id, r) => `/business/produto.html?id=${q(id)}&produto=${q(r.id)}`,
  servicos: (id, r) => `/business/servico.html?id=${q(id)}&servico=${q(r.id)}`,
  ordens: (id, r) => `/business/ordem.html?id=${q(id)}&os=${q(r.id)}`,
  solicitacoes: (id, r) => `/business/solicitacao.html?id=${q(id)}&solicitacao=${q(r.id)}`,
  vendas: (id, r) => `/business/venda.html?id=${q(id)}&venda=${q(r.id)}`,
  fornecedores: (id) => `/business/fornecedores.html?id=${q(id)}`,
};
const NOMES = { clientes: 'Clientes', produtos: 'Produtos', servicos: 'Serviços oferecidos', ordens: 'Ordens de serviço', solicitacoes: 'Orçamentos', vendas: 'Vendas', fornecedores: 'Fornecedores' };
const SELOS = { clientes: 'Cliente', produtos: 'Produto', servicos: 'Serviço', ordens: 'OS', solicitacoes: 'Orçam.', vendas: 'Venda', fornecedores: 'Fornec.' };
let rotulosEstado = null;
async function estadosLegiveis() {
  if (!rotulosEstado) {
    const [o, s, v] = await Promise.all([import('../data/ordens.js'), import('../data/servicos.js'), import('../data/vendas.js')]);
    rotulosEstado = { ordens: o.ESTADO_OS, solicitacoes: s.ESTADO_SOLICITACAO, vendas: v.ESTADO_VENDA };
  }
  return rotulosEstado;
}

let aberta = null;

export async function abrirPaleta() {
  const ativa = obterEmpresaAtiva();
  if (!ativa || aberta) return;
  const pode = (c) => !ativa.permissoes || ativa.permissoes.includes(c);
  const modulos = gruposDaEmpresa(ativa.id, pode).flatMap(([grupo, itens]) => itens.map((i) => ({ chave: `modulo:${i.chave}`, rotulo: i.rotulo, href: i.href, grupo })));
  const acoes = acoesRapidas(ativa.id, pode);
  const entrada = el('input', { type: 'text', class: 'paleta__campo', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'paleta-lista',
    'aria-autocomplete': 'list', 'aria-label': 'Buscar áreas, ações e registros', placeholder: 'Buscar cliente, OS, produto… ou ir para uma área', autocomplete: 'off', spellcheck: 'false' });
  const lista = el('div', { class: 'paleta__lista', id: 'paleta-lista', role: 'listbox', 'aria-label': 'Resultados' });
  const estado = el('p', { class: 'paleta__estado', 'aria-live': 'polite' });
  const dica = el('p', { class: 'paleta__dica', 'aria-hidden': 'true' }, el('kbd', {}, '↑'), el('kbd', {}, '↓'), ' escolher · ', el('kbd', {}, 'Enter'), ' abrir · ', el('kbd', {}, 'Esc'), ' fechar');
  const modal = abrirModal({ titulo: 'Buscar e ir para', corpo: el('div', { class: 'paleta' }, entrada, estado, lista, dica), tamanho: 'medio', rotulo: 'paleta',
    aoFechar: () => { aberta = null; } });
  aberta = modal;
  modal.dialogo.classList.add('modal--paleta');
  entrada.focus();

  let fixados = new Set();
  let registros = null;
  let opcoes = [];
  let ativo = 0;
  let pedido = 0;
  let relogio = 0;
  import('../data/favoritos.js').then(({ meusFavoritos }) => meusFavoritos(ativa.id)).then((f) => {
    fixados = new Set((f ?? []).filter((x) => x.tipo === 'modulo' || x.tipo === 'acao').map((x) => x.chave));
    desenhar();
  }).catch(() => {});

  const fixar = async (item, botao) => {
    botao.disabled = true;
    try {
      const { alternarFavorito } = await import('../data/favoritos.js');
      const r = await alternarFavorito(item.chave.startsWith('acao:') ? 'acao' : 'modulo', item.chave, { empresaId: ativa.id, rotulo: item.rotulo });
      if (r.favorito) fixados.add(item.chave); else fixados.delete(item.chave);
      estado.textContent = r.favorito ? `"${item.rotulo}" fixado.` : `"${item.rotulo}" desafixado.`;
      document.dispatchEvent(new CustomEvent('autonick:favoritos'));
      desenhar();
    } catch (erro) {
      botao.disabled = false;
      estado.textContent = erro.message || 'Não foi possível fixar.';
    }
  };

  function linha(item, i) {
    const opcao = el('div', { class: 'paleta__opcao', role: 'option', id: `paleta-op-${i}`, 'aria-selected': String(i === ativo), 'data-indice': i },
      el('span', { class: 'paleta__tipo', 'aria-hidden': 'true' }, item.tipo),
      el('span', { class: 'paleta__texto' }, el('strong', {}, item.rotulo), item.detalhe ? el('small', {}, item.detalhe) : null));
    opcao.addEventListener('mousemove', () => { if (ativo !== i) { ativo = i; marcar(); } });
    opcao.addEventListener('click', () => ir(item));
    if (item.fixavel) {
      const marcado = fixados.has(item.chave);
      const estrela = el('button', { type: 'button', class: 'paleta__fixar', tabindex: '-1', 'aria-pressed': String(marcado),
        'aria-label': `${marcado ? 'Desafixar' : 'Fixar'} ${item.rotulo}`, title: marcado ? 'Desafixar' : 'Fixar no topo do menu' }, '★');
      estrela.addEventListener('click', (e) => { e.stopPropagation(); fixar(item, estrela); });
      opcao.append(estrela);
    }
    return opcao;
  }

  function desenhar() {
    const t = sem(entrada.value.trim());
    const casa = (item) => !t || sem(`${item.rotulo} ${item.grupo ?? ''} ${item.termos ?? ''}`).includes(t);
    const grupos = [];
    const fix = [...modulos, ...acoes].filter((m) => fixados.has(m.chave) && casa(m));
    if (fix.length) grupos.push(['Fixados', fix.map((m) => ({ ...m, tipo: m.chave.startsWith('acao:') ? 'Ação' : 'Área', fixavel: true }))]);
    const acs = acoes.filter((a) => !fixados.has(a.chave) && casa(a));
    if (acs.length) grupos.push(['Ações rápidas', acs.map((a) => ({ ...a, tipo: 'Ação', fixavel: true }))]);
    const mods = modulos.filter((m) => !fixados.has(m.chave) && casa(m));
    if (mods.length) grupos.push(['Ir para', mods.map((m) => ({ ...m, tipo: 'Área', detalhe: m.grupo, fixavel: true }))]);
    if (registros) {
      for (const [g, itens] of Object.entries(registros)) {
        if (itens?.length) grupos.push([NOMES[g] ?? g, itens.map((r) => ({ rotulo: r.titulo, href: DESTINO[g]?.(ativa.id, r), tipo: SELOS[g] ?? '•',
          detalhe: [r.detalhe, r.estado ? (rotulosEstado?.[g]?.[r.estado] ?? r.estado) : null].filter(Boolean).join(' · ') || null }))]);
      }
    }
    opcoes = grupos.flatMap(([, itens]) => itens);
    ativo = Math.min(ativo, Math.max(0, opcoes.length - 1));
    let i = 0;
    lista.replaceChildren(...grupos.map(([titulo, itens]) => el('div', { class: 'paleta__grupo', role: 'group', 'aria-label': titulo },
      el('p', { class: 'paleta__titulo-grupo', 'aria-hidden': 'true' }, titulo), ...itens.map((item) => linha(item, i++)))));
    if (!opcoes.length) lista.replaceChildren(el('p', { class: 'paleta__vazio' }, t.length >= 2 && registros === null ? 'Buscando…' : 'Nada encontrado. Tente outro nome ou número.'));
    marcar();
  }
  function marcar() {
    for (const o of lista.querySelectorAll('[role="option"]')) o.setAttribute('aria-selected', String(Number(o.dataset.indice) === ativo));
    const atual = lista.querySelector(`#paleta-op-${ativo}`);
    if (atual) { entrada.setAttribute('aria-activedescendant', atual.id); atual.scrollIntoView({ block: 'nearest' }); } else entrada.removeAttribute('aria-activedescendant');
  }
  function ir(item) {
    if (!item?.href) return;
    modal.fechar();
    location.assign(item.href);
  }
  async function buscarNoBanco(texto) {
    const meu = ++pedido;
    try {
      const { neon } = await import('../data/sessao.js');
      const [r] = await Promise.all([neon.rpc('busca_global', { p_empresa_id: ativa.id, p_texto: texto }), estadosLegiveis().catch(() => null)]);
      if (meu !== pedido) return;
      registros = r?.grupos ?? {};
      const total = Object.values(registros).reduce((s, g) => s + (g?.length ?? 0), 0);
      estado.textContent = total ? `${total} ${total === 1 ? 'registro encontrado' : 'registros encontrados'}.` : 'Nenhum registro com esse texto.';
    } catch (erro) {
      if (meu !== pedido) return;
      registros = {};
      estado.textContent = erro.codigo === 'RATE_LIMITED' ? erro.message : 'A busca nos registros não respondeu agora. As áreas e ações continuam disponíveis.';
    }
    desenhar();
  }
  entrada.addEventListener('input', () => {
    ativo = 0;
    clearTimeout(relogio);
    const t = entrada.value.trim();
    const buscavel = t.length >= 2 || /^\d$/.test(t);
    registros = buscavel ? null : undefined;
    estado.textContent = '';
    if (buscavel) relogio = setTimeout(() => buscarNoBanco(t), 250);
    desenhar();
  });
  entrada.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!opcoes.length) return;
      ativo = (ativo + (e.key === 'ArrowDown' ? 1 : -1) + opcoes.length) % opcoes.length;
      marcar();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      ir(opcoes[ativo]);
    }
  });
  desenhar();
}

/** Atalho global e botão no menu. */
export function iniciarPaleta() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      if (!obterEmpresaAtiva()) return;
      e.preventDefault();
      abrirPaleta();
    }
  });
}
