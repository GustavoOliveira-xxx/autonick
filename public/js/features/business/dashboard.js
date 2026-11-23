/**
 * Painel real da empresa ativa (M13b; ADR-G13b D13b-09 = A). Substitui o painel do M01, que usava números inventados.
 *
 * Uma leitura no banco (painel_empresa) traz só os blocos que as permissões da pessoa abrem; bloco sem permissão não
 * aparece. Sem movimento, a tela diz isso e sugere os primeiros passos, sem preencher números de exemplo.
 */
import { iniciarLayout, mostrarMensagensNovasNoMenu } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { carregarContexto } from '../estoque/comum.js';
import { painelEmpresa } from '../../data/painel.js';
import { obterEmpresaAtiva } from '../../core/contexto-empresa.js';
import { dinheiro } from '../vendas/comum.js';

iniciarLayout();
const area = document.getElementById('painel');
const subtitulo = document.getElementById('subtitulo-painel');
const acoes = document.getElementById('acoes-painel');
const avisos = document.getElementById('avisos');

const L = (pagina, id, extra = '') => `/business/${pagina}.html?id=${encodeURIComponent(id)}${extra}`;
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const dataLonga = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const dias = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

function ficha({ numero, rotulo, extra, href, acao, principal = false, lista = null }) {
  return el('a', { class: `ficha${principal ? ' ficha--principal' : ''}`, href },
    el('span', { class: 'ficha__numero num' }, String(numero)),
    el('span', { class: 'ficha__rotulo' }, rotulo),
    lista,
    extra ? el('span', { class: 'ficha__extra' }, extra) : null,
    el('span', { class: 'ficha__ir' }, acao, el('span', { 'aria-hidden': 'true' }, ' →')));
}

function escudo(titulo, ...corpo) {
  return el('article', { class: 'escudo' }, el('div', { class: 'escudo__borda' },
    el('h3', { class: 'escudo__cab' }, titulo), el('div', { class: 'escudo__corpo' }, ...corpo)));
}

function blocoAcao(p, id) {
  const fichas = [];
  if (p.pedidos) {
    fichas.push(ficha({ principal: true, numero: p.pedidos.aguardando, rotulo: 'Pedidos aguardando aceite', href: L('pedidos-empresa', id), acao: 'Ver pedidos',
      lista: p.pedidos.ultimos.length ? el('ul', { role: 'list', class: 'ficha__lista' }, ...p.pedidos.ultimos.map((x) =>
        el('li', {}, el('span', {}, x.cliente_nome), el('span', { class: 'num' }, dinheiro(x.total_estimado_centavos))))) : null }));
  }
  if (p.orcamentos) {
    fichas.push(ficha({ numero: p.orcamentos.abertas, rotulo: 'Orçamentos para responder', href: L('solicitacoes', id), acao: 'Responder',
      extra: p.orcamentos.abertas ? `O mais antigo há ${plural(dias(p.orcamentos.mais_antiga_em), 'dia', 'dias')}` : 'Nenhum esperando resposta' }));
  }
  if (p.ordens) {
    const detalhe = [p.ordens.atrasadas ? plural(p.ordens.atrasadas, 'atrasada', 'atrasadas') : null,
      p.ordens.vencendo ? `${p.ordens.vencendo} com previsão nos próximos 3 dias` : null].filter(Boolean).join(' · ');
    fichas.push(ficha({ numero: p.ordens.em_andamento, rotulo: 'Ordens de serviço em andamento', href: L('ordens', id), acao: 'Ver OS',
      extra: detalhe || 'Nenhuma atrasada' }));
  }
  if (p.mensagens) {
    fichas.push(ficha({ numero: p.mensagens.total, rotulo: 'Mensagens novas', href: '#mensagens-novas', acao: 'Ver conversas',
      extra: p.mensagens.total ? `Em ${plural(p.mensagens.conversas.length, 'atendimento', 'atendimentos')}` : 'Tudo lido' }));
  }
  if (!fichas.length) return null;
  return el('section', { class: 'bloco', 'aria-labelledby': 'titulo-acao' },
    el('div', { class: 'bloco__cab' }, el('h2', { id: 'titulo-acao' }, 'Precisa da sua ação')),
    el('div', { class: 'acao' }, ...fichas));
}

function barrasSemanas(semanas) {
  const maior = Math.max(...semanas, 1);
  return el('div', {},
    el('div', { class: 'barras', role: 'list', 'aria-label': 'Vendas por semana neste mês' }, ...semanas.map((v, i) =>
      el('div', { class: 'barra-col', role: 'listitem', tabindex: '0', style: null, 'data-valor': dinheiro(v),
        'aria-label': `Semana ${i + 1}: ${dinheiro(v)}` }, el('span', { class: 'marca', 'data-altura': String(Math.round((v / maior) * 100)) })))),
    el('div', { class: 'barras-rotulos', 'aria-hidden': 'true' }, ...semanas.map((_, i) => el('span', {}, `Sem. ${i + 1}`))));
}

function blocoNumeros(p, id) {
  const itens = [];
  if (p.vendas) {
    const mesNome = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(`${p.vendas.mes}-15T12:00:00Z`));
    const ant = p.vendas.mes_anterior_total_centavos;
    const variacao = ant > 0 ? Math.round(((p.vendas.total_centavos - ant) / ant) * 100) : null;
    itens.push(el('div', { class: 'escudo--vendas-wrap' }, escudo(`Vendas de ${mesNome}`,
      el('p', { class: 'valor-grande num' }, dinheiro(p.vendas.total_centavos)),
      el('p', { class: 'legenda-dado' }, p.vendas.quantidade ? plural(p.vendas.quantidade, 'venda confirmada', 'vendas confirmadas') : 'Nenhuma venda confirmada neste mês',
        variacao !== null ? el('span', { class: `variacao${variacao < 0 ? ' variacao--queda' : ''}` }, ` ${variacao < 0 ? '▼' : '▲'} ${Math.abs(variacao)}% sobre o mês anterior`) : null),
      p.vendas.quantidade ? barrasSemanas(p.vendas.semanas) : el('p', {}, el('a', { href: L('venda-nova', id) }, 'Registrar a primeira venda')))));
  }
  if (p.financeiro) {
    const r = p.financeiro.receber_7_dias;
    const pg = p.financeiro.pagar_7_dias;
    itens.push(escudo('A receber · 7 dias', el('p', { class: 'valor-medio num' }, dinheiro(r.valor_centavos)),
      el('p', { class: 'legenda-dado' }, r.parcelas ? plural(r.parcelas, 'parcela', 'parcelas') : 'Nada vencendo',
        r.atrasadas ? el('span', { class: 'selo selo--alerta' }, plural(r.atrasadas, 'atrasada', 'atrasadas')) : null)));
    itens.push(escudo('A pagar · 7 dias', el('p', { class: 'valor-medio num' }, dinheiro(pg.valor_centavos)),
      el('p', { class: 'legenda-dado' }, pg.parcelas ? plural(pg.parcelas, 'conta', 'contas') : 'Nada vencendo',
        pg.atrasadas ? el('span', { class: 'selo selo--perigo' }, plural(pg.atrasadas, 'atrasada', 'atrasadas')) : null)));
    itens.push(escudo('Saldo das contas', el('p', { class: 'valor-medio num' }, dinheiro(p.financeiro.saldo_contas_centavos)),
      el('p', { class: 'legenda-dado' }, 'Registrado no AutoniCK; não é extrato bancário.')));
  }
  if (p.estoque) {
    itens.push(escudo('Estoque baixo', p.estoque.abaixo_do_minimo
      ? el('ul', { class: 'lista-estoque', role: 'list' }, ...p.estoque.itens.map((x) => el('li', {},
        el('span', { class: 'linha' }, el('span', {}, x.produto), el('span', { class: 'num' }, `${x.disponivel} de ${x.minimo}`)),
        el('span', { class: 'nivel', 'aria-hidden': 'true' }, el('i', { 'data-nivel': String(Math.min(100, Math.round((x.disponivel / Math.max(x.minimo, 1)) * 100))) })))))
      : el('p', { class: 'legenda-dado' }, 'Nenhum produto abaixo do mínimo.'),
    p.estoque.abaixo_do_minimo > p.estoque.itens.length ? el('p', {}, el('a', { href: L('estoque-empresa', id) }, `Ver os ${p.estoque.abaixo_do_minimo}`)) : null));
  }
  if (!itens.length) return null;
  return el('section', { class: 'bloco', 'aria-labelledby': 'titulo-numeros' },
    el('div', { class: 'bloco__cab' }, el('h2', { id: 'titulo-numeros' }, 'Números da empresa')),
    el('div', { class: 'indicadores' }, ...itens));
}

function blocoAgenda(p, id) {
  if (!p.agenda_hoje) return null;
  return el('section', { class: 'bloco', 'aria-labelledby': 'titulo-agenda' },
    el('div', { class: 'bloco__cab' }, el('h2', { id: 'titulo-agenda' }, 'Agenda de hoje'), el('a', { href: L('agenda', id) }, 'Abrir agenda')),
    p.agenda_hoje.length
      ? el('ol', { class: 'agenda', role: 'list' }, ...p.agenda_hoje.map((a) => el('li', {},
        el('time', { datetime: a.inicio }, hora.format(new Date(a.inicio))),
        el('div', {}, el('strong', {}, a.servico), el('span', {}, `Solicitação nº ${a.numero} · ${a.cliente}`)))))
      : el('p', { class: 'vazio-simples' }, 'Nenhum horário marcado para hoje.'));
}

function blocoMensagens(p) {
  if (!p.mensagens || !p.mensagens.total) return null;
  const link = (c) => c.tipo === 'pedido' ? L('pedidos-empresa', p.empresa.id, `#pedido-${c.id}`)
    : c.os_id ? L('ordem', p.empresa.id, `&os=${encodeURIComponent(c.os_id)}`) : L('solicitacao', p.empresa.id, `&solicitacao=${encodeURIComponent(c.id)}`);
  return el('section', { class: 'bloco', id: 'mensagens-novas', 'aria-labelledby': 'titulo-mensagens' },
    el('div', { class: 'bloco__cab' }, el('h2', { id: 'titulo-mensagens' }, 'Conversas com mensagens novas')),
    el('ul', { class: 'lista-mensagens', role: 'list' }, ...p.mensagens.conversas.map((c) => el('li', {},
      el('a', { href: link(c) }, c.rotulo), el('span', { class: 'marcador-novas' }, plural(c.novas, 'nova', 'novas'))))));
}

function primeirosPassos(ctx) {
  const passos = [
    ctx.pode('produtos.criar') ? ['Cadastrar um produto', L('produtos-empresa', ctx.id)] : null,
    ctx.pode('catalogo_servicos.alterar') ? ['Cadastrar um serviço', L('servicos', ctx.id)] : null,
    ctx.pode('financeiro.visualizar') ? ['Conferir as contas do financeiro', L('financeiro-configuracoes', ctx.id)] : null,
    ctx.pode('equipe.convidar') ? ['Convidar sua equipe', L('equipe', ctx.id)] : null,
    ctx.pode('vitrine.visualizar') ? ['Completar a vitrine e enviar para a CK', L('empresa', ctx.id)] : null,
  ].filter(Boolean);
  if (!passos.length) return null;
  return el('section', { class: 'bloco cartao primeiros-passos', 'aria-labelledby': 'titulo-passos' },
    el('div', { class: 'bloco__cab' }, el('h2', { id: 'titulo-passos' }, 'Primeiros passos')),
    el('p', {}, 'Ainda não há movimento nesta empresa. Estes atalhos ajudam a começar:'),
    el('ol', { class: 'passos' }, ...passos.map(([t, h]) => el('li', {}, el('a', { href: h }, t)))));
}

const semMovimento = (p) => !(p.pedidos?.aguardando || p.orcamentos?.abertas || p.ordens?.em_andamento || p.vendas?.quantidade
  || p.financeiro?.receber_7_dias?.parcelas || p.financeiro?.pagar_7_dias?.parcelas || p.estoque?.abaixo_do_minimo || p.mensagens?.total);

async function carregar() {
  if (!parametro('id')) {
    const ativa = obterEmpresaAtiva();
    if (ativa?.id) { location.replace(`/business/dashboard.html?id=${encodeURIComponent(ativa.id)}`); return; }
    area.replaceChildren(aviso('info', 'Escolha uma empresa para ver o painel.',
      el('p', {}, el('a', { href: '/business/minhas-empresas.html' }, 'Ver suas empresas'), ' · ', el('a', { href: '/business/onboarding.html' }, 'Cadastrar uma empresa'))));
    return;
  }
  mostrarCarregando(area, 'Carregando o painel');
  try {
    const ctx = await carregarContexto(area);
    if (!ctx) return;
    const p = await painelEmpresa(ctx.id);
    concluirCarregamento(area);
    subtitulo.textContent = `${dataLonga.format(new Date())} · ${p.empresa.nome_publico}`;
    acoes.replaceChildren(...[
      ctx.pode('vendas.criar') ? el('a', { class: 'botao botao--orbe', href: L('venda-nova', ctx.id) }, 'Nova venda') : null,
      ctx.pode('orcamentos.visualizar') ? el('a', { class: 'botao botao--secundario', href: L('solicitacoes', ctx.id) }, 'Orçamentos') : null,
      ctx.pode('financeiro.criar') ? el('a', { class: 'botao botao--secundario', href: L('financeiro-movimentacoes', ctx.id) }, 'Lançar no financeiro') : null,
    ].filter(Boolean));
    if (parametro('criada') === '1') {
      avisos.replaceChildren(el('div', { role: 'status' }, aviso('sucesso', 'Empresa cadastrada.', el('p', {}, 'O sistema já pode ser usado. A vitrine aparece para o público depois da revisão da CK.'))));
    }
    mostrarMensagensNovasNoMenu(p.mensagens?.total ?? 0);
    const partes = [blocoAcao(p, ctx.id), semMovimento(p) ? primeirosPassos(ctx) : null, blocoNumeros(p, ctx.id), blocoMensagens(p), blocoAgenda(p, ctx.id)].filter(Boolean);
    area.append(...(partes.length ? partes : [aviso('info', 'Seu perfil de acesso não inclui nenhum indicador do painel.',
      el('p', {}, el('a', { href: L('empresa', ctx.id) }, 'Ir para a página da empresa')))]));
    // Alturas das barras e níveis: aplicadas pelo CSSOM (a política de segurança bloqueia o atributo style).
    for (const m of area.querySelectorAll('[data-altura]')) m.style.height = `${m.dataset.altura}%`;
    for (const m of area.querySelectorAll('[data-nivel]')) m.style.width = `${m.dataset.nivel}%`;
    for (const c of area.querySelectorAll('.barra-col')) c.style.setProperty('--h', `${c.querySelector('[data-altura]').dataset.altura}%`);
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}
carregar();
