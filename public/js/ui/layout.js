/**
 * Casca compartilhada: cabeçalho, menu, rodapé, leitura ampliada e barra de atalhos do celular (M13b).
 *
 * A área vem de `<body data-area="...">`: publico, cliente, business ou ck. Na área Business, o menu é montado a partir da
 * empresa ativa real (core/contexto-empresa.js), com os módulos que as permissões dela abrem; sem empresa ativa, o menu
 * leva às empresas da pessoa e ao cadastro. Nada de dados de exemplo: o M01 saiu das telas operacionais.
 * Logos: só cópias otimizadas autorizadas (ADR-G02); os originais em referencias/ ficam intocados.
 */
import { el } from './dom.js';
import { obterEmpresaAtiva, aoTrocarEmpresa } from '../core/contexto-empresa.js';
import { gruposDaEmpresa, chaveDaPagina } from './menu-empresa.js';
import { registrarServiceWorker } from './sw-registro.js';
import { iniciarConexao } from './conexao.js';
import { capturarInstalacao, abertoComoApp } from './instalacao.js';
import { iniciarNavegacaoViva } from './navegacao-viva.js';

const NS = 'http://www.w3.org/2000/svg';
/** Ícone do conjunto próprio do AutoniCK (assets/icons/icones.svg), sempre decorativo. */
export function icone(nome, classe = 'icone') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', classe);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `/assets/icons/icones.svg#${nome}`);
  svg.append(use);
  return svg;
}

const MENUS = {
  publico: [['/', 'Início'], ['/cliente/', 'Encontrar serviços'], ['/business/', 'Gerenciar meu negócio'], ['/ajuda.html', 'Ajuda']],
  cliente: [['/cliente/', 'Buscar'], ['/cliente/pedidos.html', 'Meus pedidos'], ['/cliente/solicitacoes.html', 'Minhas solicitações'],
    ['/cliente/ordens.html', 'Meus serviços'], ['/cliente/conta.html', 'Minha conta']],
  ck: [['/ck-admin/', 'Painel CK'], ['/', 'Início'], ['/ajuda.html', 'Ajuda']],
};
const ATALHOS_CLIENTE = [['/cliente/', 'Buscar', 'i-lupa'], ['/cliente/pedidos.html', 'Pedidos', 'i-sacola'],
  ['/cliente/solicitacoes.html', 'Orçamentos', 'i-balao'], ['/cliente/ordens.html', 'Serviços', 'i-ferramenta'], ['/cliente/conta.html', 'Conta', 'i-pessoa']];

function caminhoAtual() {
  const p = location.pathname;
  return p.endsWith('/index.html') ? p.slice(0, -'index.html'.length) : p;
}

// ---- Leitura ampliada (D13b-05): troca a fonte do corpo; preferência só neste aparelho, nada pessoal ----
const CHAVE_LEITURA = 'autonick.preferencia.leitura';
function lerPreferencia() {
  try { return localStorage.getItem(CHAVE_LEITURA) === 'ampliada'; } catch { return false; }
}
function aplicarLeitura(ligada) {
  document.documentElement.dataset.leitura = ligada ? 'ampliada' : '';
  for (const b of document.querySelectorAll('button[data-leitura]')) b.setAttribute('aria-pressed', String(ligada));
}
function botaoLeitura() {
  const b = el('button', { type: 'button', class: 'leitura', 'data-leitura': '', 'aria-pressed': String(lerPreferencia()) },
    el('b', { 'aria-hidden': 'true' }, 'Aa'), el('span', { class: 'leitura__rotulo', 'aria-hidden': 'true' }, 'Leitura ampliada'),
    el('span', { class: 'visualmente-oculto' }, 'Leitura ampliada (fonte para baixa visão)'));
  b.addEventListener('click', () => {
    const ligar = b.getAttribute('aria-pressed') !== 'true';
    try { if (ligar) localStorage.setItem(CHAVE_LEITURA, 'ampliada'); else localStorage.removeItem(CHAVE_LEITURA); } catch { /* sem armazenamento */ }
    aplicarLeitura(ligar);
  });
  return b;
}

// ---- Tema: escuro (CK Forja Noturna) é o principal; o claro (M13b) fica como opção, só neste aparelho ----
const CHAVE_TEMA = 'autonick.preferencia.tema';
function lerTemaClaro() {
  try { return localStorage.getItem(CHAVE_TEMA) === 'claro'; } catch { return false; }
}
function aplicarTema(claro) {
  if (claro) document.documentElement.dataset.tema = 'claro'; else delete document.documentElement.dataset.tema;
  for (const b of document.querySelectorAll('button[data-tema]')) b.setAttribute('aria-pressed', String(claro));
}
function botaoTema() {
  const b = el('button', { type: 'button', class: 'leitura tema', 'data-tema': '', 'aria-pressed': String(lerTemaClaro()) },
    el('b', { 'aria-hidden': 'true' }, '◐'), el('span', { class: 'leitura__rotulo', 'aria-hidden': 'true' }, 'Tema claro'),
    el('span', { class: 'visualmente-oculto' }, 'Tema claro'));
  b.addEventListener('click', () => {
    const claro = b.getAttribute('aria-pressed') !== 'true';
    try { if (claro) localStorage.setItem(CHAVE_TEMA, 'claro'); else localStorage.removeItem(CHAVE_TEMA); } catch { /* sem armazenamento */ }
    aplicarTema(claro);
  });
  return b;
}

function marca(area) {
  const empresarial = area === 'business';
  return el('a', { href: empresarial ? '/business/' : area === 'ck' ? '/ck-admin/' : '/', class: 'marca',
    'aria-label': `AutoniCK${empresarial ? ' Business' : area === 'ck' ? ' Admin' : ''}, página inicial` },
  el('img', { class: 'marca__logo', src: '/assets/brand/autonick-capacete-sino.svg', width: '256', height: '256', alt: '', decoding: 'async' }),
  el('span', { class: 'marca__texto', 'aria-hidden': 'true' }, 'Autoni', el('b', {}, 'CK'),
    empresarial ? el('small', {}, 'Business') : area === 'ck' ? el('small', {}, 'Admin · sala de controle') : null));
}

function navSimples(area) {
  const atual = caminhoAtual();
  return el('nav', { class: 'navegacao cabecalho__nav', 'aria-label': 'Principal' },
    el('ul', { role: 'list' }, ...(MENUS[area] ?? MENUS.publico).map(([href, rotulo]) =>
      el('li', {}, el('a', { href, 'aria-current': href === atual ? 'page' : null }, rotulo)))));
}

// ---- Área Business: menu da empresa ativa ----
async function sair(botao) {
  botao.disabled = true;
  try {
    const { neon } = await import('../data/sessao.js');
    await neon.sair();
    const { limparEmpresaAtiva } = await import('../core/contexto-empresa.js');
    limparEmpresaAtiva();
    location.assign('/business/');
  } catch {
    botao.disabled = false;
    location.assign('/business/conta.html');
  }
}

function menuBusiness() {
  const ativa = obterEmpresaAtiva();
  const sessaoConfirmada = Boolean(ativa) || sessaoAtiva;
  const atual = caminhoAtual();
  const chave = chaveDaPagina();
  const item = (href, rotulo, nomeIcone, marcado, extra = null) => el('li', {},
    el('a', { href, 'aria-current': marcado ? 'page' : null }, icone(nomeIcone), el('span', {}, rotulo), extra));
  const grupos = ativa
    ? gruposDaEmpresa(ativa.id, (c) => !ativa.permissoes || ativa.permissoes.includes(c)).map(([titulo, itens]) =>
      el('div', { class: 'menu-grupo' }, el('h2', { class: 'menu-grupo__titulo' }, titulo),
        el('ul', { role: 'list' }, ...itens.map((i) => item(i.href, i.rotulo, i.icone, i.chave === chave, i.chave === 'painel' ? el('span', { class: 'contador', id: 'contador-mensagens', hidden: true }) : null)))))
    : [el('div', { class: 'menu-grupo' }, el('ul', { role: 'list' },
      item('/business/minhas-empresas.html', 'Minhas empresas', 'i-vitrine', atual === '/business/minhas-empresas.html'),
      item('/business/minhas-empresas.html?cadastrar=1', 'Cadastrar empresa', 'i-escudo', false)))];
  const botaoSair = el('button', { type: 'button', class: 'menu-sair' }, icone('i-sair'), el('span', {}, 'Sair'));
  botaoSair.addEventListener('click', () => sair(botaoSair));
  return el('nav', { class: 'menu-lateral', id: 'menu-principal', 'aria-label': 'Principal' },
    ...[grupos].flat(),
    el('div', { class: 'menu-grupo menu-grupo--rodape' }, el('ul', { role: 'list' },
      ativa ? item('/business/minhas-empresas.html', 'Minhas empresas', 'i-vitrine', atual === '/business/minhas-empresas.html') : null,
      item('/business/conta.html', 'Minha conta', 'i-pessoa', atual === '/business/conta.html'),
      sessaoConfirmada ? null : item('/business/entrar.html', 'Entrar', 'i-seta', atual === '/business/entrar.html'),
      item('/ajuda.html', 'Ajuda', 'i-balao', false),
      el('li', {}, botaoSair))));
}

function blocoEmpresaAtiva() {
  const ativa = obterEmpresaAtiva();
  const bloco = el('a', { class: 'empresa-ativa', id: 'empresa-ativa', href: '/business/minhas-empresas.html', 'data-trocar-empresa': '',
    'aria-label': ativa ? `Empresa ativa: ${ativa.nome}. Trocar de empresa` : 'Escolher empresa' },
  el('span', { class: 'empresa-ativa__logo', 'aria-hidden': 'true' }, iniciaisDe(ativa?.nome)),
  el('span', { class: 'empresa-ativa__texto' },
    el('span', { class: 'empresa-ativa__rotulo' }, 'Empresa ativa'),
    el('strong', {}, ativa?.nome ?? 'Nenhuma selecionada'),
    el('span', { class: 'empresa-ativa__acao' }, ativa ? 'Trocar de empresa' : 'Escolher empresa')),
  icone('i-seta', 'icone empresa-ativa__icone'));
  if (ativa) {
    // Logo da empresa (se houver): lida com o token, sem atrasar o menu.
    import('../data/arquivos.js').then(async ({ arquivosDisponiveis, logosDasMinhasEmpresas, urlDeImagem }) => {
      if (!arquivosDisponiveis) return;
      const logos = await logosDasMinhasEmpresas();
      const src = await urlDeImagem(logos?.[ativa.id]?.logo_url);
      if (src) bloco.querySelector('.empresa-ativa__logo')?.replaceChildren(el('img', { src, alt: '', width: '40', height: '40', decoding: 'async' }));
    }).catch(() => {});
  }
  return bloco;
}
const iniciaisDe = (nome) => String(nome ?? '').replace(/\[[^\]]*\]/g, '').split(/\s+/).filter((p) => p.length > 2).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'CK';

function montarCabecalho(area) {
  if (area === 'business') {
    const botaoMenu = el('button', { type: 'button', class: 'botao-menu', 'aria-controls': 'menu-principal', 'aria-expanded': 'false' },
      icone('i-menu'), el('span', {}, 'Menu'));
    botaoMenu.addEventListener('click', () => {
      const aberto = botaoMenu.getAttribute('aria-expanded') !== 'true';
      botaoMenu.setAttribute('aria-expanded', String(aberto));
      document.body.classList.toggle('menu-aberto', aberto);
      if (aberto) document.getElementById('menu-principal')?.querySelector('a, button')?.focus();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('menu-aberto')) { botaoMenu.click(); botaoMenu.focus(); }
    });
    return [el('div', { class: 'cabecalho__interno' },
      el('div', { class: 'cabecalho__topo' }, marca(area), botaoLeitura(), botaoTema(), botaoMenu),
      blocoEmpresaAtiva(), menuBusiness())];
  }
  // A Ajuda precisa abrir sem conexão: a casca não importa a configuração do ambiente (ela não fica no cache).
  const ambiente = area === 'ck' ? el('span', { class: 'ambiente' }, 'versão de desenvolvimento') : null;
  const entrar = area === 'cliente' ? el('a', { class: 'botao botao--orbe botao--entrar', id: 'acesso-cabecalho', href: '/cliente/entrar.html' }, 'Entrar') : null;
  return [el('div', { class: 'cabecalho__interno' }, marca(area), ambiente, navSimples(area), botaoLeitura(), botaoTema(), entrar)];
}

function barraCelular(area) {
  if (area !== 'cliente') return null;
  const atual = caminhoAtual();
  return el('nav', { class: 'barra-celular', 'aria-label': 'Atalhos' },
    ...ATALHOS_CLIENTE.map(([href, rotulo, nome]) => el('a', { href, 'aria-current': href === atual ? 'page' : null }, icone(nome), rotulo)));
}

function montarRodape() {
  return el('div', { class: 'rodape__interno' },
    el('p', {}, 'AutoniCK, um produto CK Group. Versão de desenvolvimento: use apenas dados de teste.'),
    el('nav', { 'aria-label': 'Rodapé' }, el('ul', { role: 'list' },
      el('li', {}, el('a', { href: '/ajuda.html' }, 'Ajuda')),
      el('li', {}, el('a', { href: '/ajuda.html#privacidade' }, 'Privacidade nesta versão')))));
}

let sessaoAtiva = false;
/** Business: com sessão confirmada, o menu não oferece mais "Entrar". */
function acompanharSessaoNoMenu() {
  document.addEventListener('autonick:sessao', (e) => {
    const confirmada = Boolean(e.detail?.autenticado);
    if (confirmada === sessaoAtiva) return;
    sessaoAtiva = confirmada;
    document.getElementById('menu-principal')?.replaceWith(menuBusiness());
  });
}

/** Cliente com sessão confirmada pela própria tela não vê mais "Entrar" (a conta já está no menu e na barra do celular). */
function acompanharSessaoNoCabecalho() {
  document.addEventListener('autonick:sessao', (e) => {
    const link = document.getElementById('acesso-cabecalho');
    if (link) link.hidden = Boolean(e.detail?.autenticado);
  });
}

/**
 * G08 expressivo: no app instalado, a primeira tela da sessão mostra o sino enquanto a página ainda carrega de verdade.
 * Some no evento load (ou na hora, se a página já carregou). Nenhum atraso é inventado.
 */
function aberturaDoApp() {
  if (!abertoComoApp() || document.readyState === 'complete') return;
  try { if (sessionStorage.getItem('autonick:abertura') === '1') return; sessionStorage.setItem('autonick:abertura', '1'); } catch { return; }
  const tela = el('div', { class: 'abertura-app', 'aria-hidden': 'true' }, el('span', { class: 'abertura-app__sino' }), el('span', { class: 'abertura-app__nome' }, 'AutoniCK'));
  document.body.append(tela);
  const sair = () => { tela.classList.add('abertura-app--saindo'); setTimeout(() => tela.remove(), 260); };
  window.addEventListener('load', sair, { once: true });
}

export function iniciarLayout() {
  const area = document.body.dataset.area ?? 'publico';
  aberturaDoApp();
  aplicarLeitura(lerPreferencia());
  aplicarTema(lerTemaClaro());
  if (area === 'cliente') acompanharSessaoNoCabecalho();
  if (area === 'business') acompanharSessaoNoMenu();
  iniciarNavegacaoViva();
  document.getElementById('cabecalho')?.replaceChildren(...montarCabecalho(area));
  document.getElementById('rodape')?.replaceChildren(montarRodape());
  const atalhos = barraCelular(area);
  if (atalhos && !document.querySelector('.barra-celular')) { document.body.append(atalhos); document.body.classList.add('com-barra-celular'); }
  if (area === 'business') {
    aoTrocarEmpresa(() => atualizarEmpresaAtivaNoCabecalho());
    // Troca rápida: o bloco "Empresa ativa" abre o seletor (sem JavaScript, o link leva a Minhas empresas).
    document.addEventListener('click', (e) => {
      const gatilho = e.target.closest?.('[data-trocar-empresa]');
      if (!gatilho || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      import('./seletor-empresa.js').then((m) => m.abrirSeletorEmpresas()).catch(() => location.assign(gatilho.href));
    });
  }
  registrarServiceWorker();
  capturarInstalacao();
  iniciarConexao();
}

/** Redesenha o bloco da empresa ativa e o menu (chamado quando a tela confirma a empresa no banco). */
export function atualizarEmpresaAtivaNoCabecalho() {
  if (document.body.dataset.area !== 'business') return;
  document.getElementById('empresa-ativa')?.replaceWith(blocoEmpresaAtiva());
  document.getElementById('menu-principal')?.replaceWith(menuBusiness());
}

/** Mostra a quantidade de mensagens novas no item Painel do menu (quando a tela já tiver o número). */
export function mostrarMensagensNovasNoMenu(total) {
  const c = document.getElementById('contador-mensagens');
  if (!c) return;
  c.hidden = !total;
  c.replaceChildren(...(total ? [String(total), el('span', { class: 'visualmente-oculto' }, total === 1 ? ' mensagem nova' : ' mensagens novas')] : []));
}
