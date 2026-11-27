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
import { contarAte } from '../../ui/pecas-forja.js';

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
      el('p', { class: 'valor-grande num', 'data-centavos': String(p.vendas.total_centavos) }, dinheiro(p.vendas.total_centavos)),
      el('p', { class: 'legenda-dado' }, p.vendas.quantidade ? plural(p.vendas.quantidade, 'venda confirmada', 'vendas confirmadas') : 'Nenhuma venda confirmada neste mês',
        variacao !== null ? el('span', { class: `variacao${variacao < 0 ? ' variacao--queda' : ''}` }, ` ${variacao < 0 ? '▼' : '▲'} ${Math.abs(variacao)}% sobre o mês anterior`) : null),
      p.vendas.quantidade ? barrasSemanas(p.vendas.semanas) : el('p', {}, el('a', { class: 'botao botao--secundario', href: L('venda-nova', id) }, 'Registrar a primeira venda')))));
  }
  if (p.financeiro) {
    const r = p.financeiro.receber_7_dias;
    const pg = p.financeiro.pagar_7_dias;
    itens.push(escudo('A receber · 7 dias', el('p', { class: 'valor-medio num', 'data-centavos': String(r.valor_centavos) }, dinheiro(r.valor_centavos)),
      el('p', { class: 'legenda-dado' }, r.parcelas ? plural(r.parcelas, 'parcela', 'parcelas') : 'Nada vencendo',
        r.atrasadas ? el('span', { class: 'selo selo--alerta' }, plural(r.atrasadas, 'atrasada', 'atrasadas')) : null)));
    itens.push(escudo('A pagar · 7 dias', el('p', { class: 'valor-medio num', 'data-centavos': String(pg.valor_centavos) }, dinheiro(pg.valor_centavos)),
      el('p', { class: 'legenda-dado' }, pg.parcelas ? plural(pg.parcelas, 'conta', 'contas') : 'Nada vencendo',
        pg.atrasadas ? el('span', { class: 'selo selo--perigo' }, plural(pg.atrasadas, 'atrasada', 'atrasadas')) : null)));
    itens.push(escudo('Saldo das contas', el('p', { class: 'valor-medio num', 'data-centavos': String(p.financeiro.saldo_contas_centavos) }, dinheiro(p.financeiro.saldo_contas_centavos)),
      el('p', { class: 'legenda-dado' }, 'Registrado no AutoniCK; não é extrato bancário.')));
  }
  if (p.estoque) {
    itens.push(escudo('Estoque baixo', p.estoque.abaixo_do_minimo
      ? el('ul', { class: 'lista-estoque', role: 'list' }, ...p.estoque.itens.map((x) => el('li', {},
        el('span', { class: 'linha' }, el('span', {}, x.produto), el('span', { class: 'num' }, `${x.disponivel} de ${x.minimo}`)),
        el('span', { class: 'nivel', 'aria-hidden': 'true' }, el('i', { 'data-nivel': String(Math.min(100, Math.round((x.disponivel / Math.max(x.minimo, 1)) * 100))) })))))
      : el('p', { class: 'legenda-dado' }, 'Nenhum produto abaixo do mínimo.'),
    p.estoque.abaixo_do_minimo > p.estoque.itens.length ? el('p', {}, el('a', { class: 'botao botao--secundario', href: L('estoque-empresa', id) }, `Ver os ${p.estoque.abaixo_do_minimo}`)) : null));
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

/**
 * IB01 (preparado): a moeda CK gira ao lado das vendas do mês quando uma META EXISTENTE é atingida.
 * O AutoniCK ainda não tem cadastro de metas; quando o painel passar a trazer `vendas.meta_centavos`, a celebração
 * acontece sozinha, uma vez, sincronizada com a contagem. Sem meta, nada é celebrado.
 */
async function celebrarMeta(p) {
  // E06: a celebração das metas agora fica no bloco "Metas" (dados reais); aqui só se o painel trouxer a meta junto.
  const meta = p.vendas?.meta_centavos;
  if (!Number.isFinite(meta) || meta <= 0 || p.vendas.total_centavos < meta) return;
  const lugar = area.querySelector('.escudo--vendas-wrap .escudo__corpo');
  if (!lugar) return;
  const { montarMomento } = await import('../../ui/forja3d/momentos.js');
  lugar.classList.add('com-momento');
  montarMomento(lugar, 'IB01', { tamanho: 'p' }).disparar();
}

// E06: metas do mês. O realizado vem do banco (vendas e OS reais); a comemoração acontece uma vez por meta, só quando atingida.
const fmtNumero = new Intl.NumberFormat('pt-BR');
const valorMeta = (tipo, v) => (tipo === 'receita_vendas' ? dinheiro(v) : fmtNumero.format(v));
function lembrarComemoracao(chave) {
  try { if (localStorage.getItem(chave)) return false; localStorage.setItem(chave, '1'); return true; } catch { return true; }
}
async function blocoMetas(ctx) {
  const [{ metasDaEmpresa, definirMeta, TIPOS_META }, { abrirModal }, { campoTexto, limparErros, erroNoCampo, ocupado, valores }, { novaChave }, { lerValorEmReais }] = await Promise.all([
    import('../../data/metas.js'), import('../../ui/modal.js'), import('../../ui/formulario.js'), import('../../data/empresas.js'), import('../../domain/moeda.js')]);
  const m = await metasDaEmpresa(ctx.id).catch(() => null);
  if (!m || (!m.metas.length && !m.pode_definir) || !m.tipos_visiveis.length) return null;
  const mesNome = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(`${m.mes}T12:00:00Z`));
  const lista = m.metas.map((x) => el('li', { class: `meta${x.atingida ? ' meta--atingida' : ''}`, 'data-meta': x.tipo },
    el('div', { class: 'meta__topo' }, el('strong', {}, TIPOS_META[x.tipo]?.nome ?? x.tipo),
      el('span', {}, `${valorMeta(x.tipo, x.realizado)} de ${valorMeta(x.tipo, x.alvo)}`)),
    el('span', { class: 'meta__barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.min(100, x.percentual)),
      'aria-label': `${TIPOS_META[x.tipo]?.nome}: ${x.percentual}%` }, el('i', { 'data-nivel': String(Math.min(100, x.percentual)) })),
    el('span', { class: 'campo__ajuda' }, x.atingida ? 'Meta atingida!' : `${x.percentual}% · faltam ${valorMeta(x.tipo, x.alvo - x.realizado)}`)));
  const definir = m.pode_definir ? el('button', { type: 'button', class: 'botao botao--secundario' }, m.metas.length ? 'Ajustar metas' : 'Definir metas do mês') : null;
  definir?.addEventListener('click', () => {
    const tipos = m.tipos_visiveis.length ? m.tipos_visiveis : Object.keys(TIPOS_META);
    const atual = Object.fromEntries(m.metas.map((x) => [x.tipo, x.alvo]));
    const salvar = el('button', { type: 'submit', class: 'botao', form: 'form-metas' }, 'Salvar metas');
    const form = el('form', { id: 'form-metas', class: 'pilha', novalidate: true },
      el('p', { class: 'campo__ajuda' }, 'Deixe em branco para não ter meta. O realizado é calculado das vendas e OS do mês; ninguém digita.'),
      ...tipos.map((t) => campoTexto({ nome: t, rotulo: `${TIPOS_META[t].nome} (${TIPOS_META[t].unidade})`, id: `meta-${t}`, ajuda: TIPOS_META[t].ajuda,
        valor: atual[t] ? (t === 'receita_vendas' ? (atual[t] / 100).toFixed(2).replace('.', ',') : String(atual[t])) : '' })));
    const modal = abrirModal({ titulo: `Metas de ${mesNome}`, corpo: form, rodape: [salvar], tamanho: 'estreito' });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const d = valores(form);
      const pedidos = [];
      for (const t of tipos) {
        const bruto = (d[t] ?? '').trim();
        let alvo = null;
        if (bruto) {
          if (t === 'receita_vendas') {
            const r = lerValorEmReais(bruto);
            if (!r.ok || r.centavos <= 0) { erroNoCampo(form, t, r.ok ? 'Informe um valor maior que zero.' : r.erro); return; }
            alvo = r.centavos;
          } else {
            alvo = /^\d+$/.test(bruto) ? Number(bruto) : NaN;
            if (!Number.isSafeInteger(alvo) || alvo <= 0) { erroNoCampo(form, t, 'Use um número inteiro maior que zero.'); return; }
          }
        }
        if ((atual[t] ?? null) !== alvo) pedidos.push([t, alvo]);
      }
      ocupado(salvar, async () => {
        try {
          for (const [t, alvo] of pedidos) await definirMeta(ctx.id, t, m.mes, alvo, novaChave());
          modal.fechar();
          carregar();
        } catch (erro) {
          if (!(erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, erro.campo === 'alvo' ? pedidos[0]?.[0] : erro.campo, erro.message))) form.prepend(aviso('erro', erro.message));
        }
      });
    });
  });
  const bloco = escudo(`Metas de ${mesNome}`,
    lista.length ? el('ul', { class: 'lista-simples metas', role: 'list' }, ...lista) : el('p', {}, 'Nenhuma meta para este mês. Defina uma para acompanhar o progresso aqui.'),
    definir);
  bloco.id = 'bloco-metas';
  const atingidas = m.metas.filter((x) => x.atingida && lembrarComemoracao(`autonick.metaComemorada.${ctx.id}.${m.mes}.${x.tipo}.${x.alvo}`));
  if (atingidas.length) {
    queueMicrotask(async () => {
      const lugar = bloco.querySelector(`[data-meta="${atingidas[0].tipo}"]`);
      if (!lugar) return;
      const { montarMomento } = await import('../../ui/forja3d/momentos.js');
      lugar.classList.add('com-momento');
      montarMomento(lugar, 'IB01', { tamanho: 'p' }).disparar();
    });
  }
  return bloco;
}

async function carregar() {
  if (!parametro('id')) {
    const ativa = obterEmpresaAtiva();
    if (ativa?.id) { location.replace(`/business/dashboard.html?id=${encodeURIComponent(ativa.id)}`); return; }
    area.replaceChildren(aviso('info', 'Escolha uma empresa para ver o painel.',
      el('p', {}, el('a', { class: 'botao botao--secundario', href: '/business/minhas-empresas.html' }, 'Ver suas empresas'), ' ', el('a', { class: 'botao botao--secundario', href: '/business/minhas-empresas.html?cadastrar=1' }, 'Cadastrar uma empresa'))));
    return;
  }
  mostrarCarregando(area, 'Carregando o painel');
  area.querySelector('.esqueleto')?.classList.add('esqueleto--cartoes');
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
    const metas = await blocoMetas(ctx).catch(() => null);
    const partes = [blocoAcao(p, ctx.id), semMovimento(p) ? primeirosPassos(ctx) : null, metas, blocoNumeros(p, ctx.id), blocoMensagens(p), blocoAgenda(p, ctx.id)].filter(Boolean);
    area.append(...(partes.length ? partes : [aviso('info', 'Seu perfil de acesso não inclui nenhum indicador do painel.',
      el('p', {}, el('a', { class: 'botao botao--secundario', href: L('empresa', ctx.id) }, 'Ir para a página da empresa')))]));
    // Alturas das barras e níveis: aplicadas pelo CSSOM (a política de segurança bloqueia o atributo style).
    for (const m of area.querySelectorAll('[data-altura]')) m.style.height = `${m.dataset.altura}%`;
    for (const m of area.querySelectorAll('[data-nivel]')) m.style.width = `${m.dataset.nivel}%`;
    for (const c of area.querySelectorAll('.barra-col')) c.style.setProperty('--h', `${c.querySelector('[data-altura]').dataset.altura}%`);
    // Indicadores entram contando até o valor real que veio do banco.
    for (const v of area.querySelectorAll('[data-centavos]')) contarAte(v, Number(v.dataset.centavos), dinheiro);
    celebrarMeta(p);
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}
carregar();
