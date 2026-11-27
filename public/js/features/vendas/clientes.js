/**
 * Clientes da empresa (M06; pacote 27/11): consulta primeiro (lista com busca sem acento por nome, documento, telefone e
 * e-mail), "Adicionar cliente" em modal (PF/PJ, CPF/CNPJ opcional, endereço com CEP), edição com versão,
 * desativação e ficha do cliente (E05: resumo, vendas, pedidos, orçamentos e OS, cada parte com a permissão da área).
 * O vínculo com a conta pública só nasce do pedido aceito (D6-11).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoSelecao, erroNoCampo, ocupado } from '../../ui/formulario.js';
import { barraConsulta, vazio } from '../../ui/consulta.js';
import { documentoParaLista, mascararDocumento } from '../../domain/documentos.js';
import { enderecoEmLinha } from '../../ui/cadastro-pessoa.js';
import { abrirCadastroCliente } from './cliente-modal.js';
import { clientes as lerClientes, definirClienteAtivo, fichaCliente, ESTADO_VENDA } from '../../data/vendas.js';
import { ESTADO_OS } from '../../data/ordens.js';
import { ESTADO_SOLICITACAO } from '../../data/servicos.js';
import { abrirModal } from '../../ui/modal.js';
import { abas } from '../../ui/abas.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, dinheiro, chipPedido } from './comum.js';
import { formatarDataHora } from '../empresa/comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let lista = [];
let busca = parametro('busca') ?? '';

const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });

function abrirEdicao(c, origem) {
  abrirCadastroCliente({ ctx, atual: c, origem, aoSalvar: async () => { await carregar(); anunciar('sucesso', 'Cliente atualizado.'); } });
}

function abrirNovo(origem) {
  abrirCadastroCliente({ ctx, origem, aoSalvar: async (r) => { await carregar(); anunciar('sucesso', `Cliente "${r.nome}" cadastrado.`); },
    usarExistente: (item) => abrirFicha(item.id) });
}

function linha(c) {
  const ficha = el('button', { type: 'button', class: 'botao botao--secundario', 'data-ficha': c.id }, 'Abrir ficha', el('span', { class: 'visualmente-oculto' }, ` de ${c.nome}`));
  ficha.addEventListener('click', () => abrirFicha(c.id, ficha));
  const acoes = [ficha];
  if (ctx.pode('clientes.alterar')) {
    const editar = el('button', { type: 'button', class: 'botao botao--secundario', 'data-editar': c.id }, 'Editar', el('span', { class: 'visualmente-oculto' }, ` ${c.nome}`));
    editar.addEventListener('click', () => abrirEdicao(c, editar));
    const ativar = el('button', { type: 'button', class: 'botao botao--texto', 'data-ativo': c.id }, c.ativo ? 'Desativar' : 'Reativar', el('span', { class: 'visualmente-oculto' }, ` ${c.nome}`));
    ativar.addEventListener('click', () => ocupado(ativar, () => executar(`ativo-${c.id}`, null, (k) => definirClienteAtivo(c.id, !c.ativo, c.versao, k),
      () => anunciar('sucesso', c.ativo ? 'Cliente desativado. O histórico continua guardado.' : 'Cliente reativado.'))));
    acoes.push(editar, ativar);
  }
  const doc = c.documento ? documentoParaLista(c.documento) : null;
  return el('tr', { 'data-cliente': c.id, class: c.ativo ? null : 'inativo' },
    el('th', { scope: 'row' }, el('strong', {}, c.nome),
      c.nome_fantasia ? el('span', { class: 'sub' }, c.nome_fantasia) : null,
      el('span', { class: 'sub' }, [c.tipo_pessoa === 'pj' ? 'Pessoa jurídica' : 'Pessoa física', doc].filter(Boolean).join(' · ')),
      c.ativo ? null : el('span', { class: 'chip chip--neutro chip--pequeno' }, 'desativado'),
      c.conta_vinculada ? el('span', { class: 'chip chip--info chip--pequeno' }, 'cliente do app') : null),
    el('td', { 'data-rotulo': 'Contato' }, [formatarTelefone(c.telefone), c.email].filter(Boolean).join(' · ') || 'Sem contato'),
    el('td', { 'data-rotulo': 'Cidade' }, [c.cidade, c.uf].filter(Boolean).join('/') || '—'),
    el('td', { 'data-rotulo': 'Vendas', class: 'numero' }, String(c.vendas ?? 0)),
    el('td', { 'data-rotulo': 'Ações' }, el('div', { class: 'acoes-linha' }, ...acoes)));
}

function formatarTelefone(t) {
  if (!t) return '';
  return t.length >= 10 ? `(${t.slice(0, 2)}) ${t.slice(2, -4)}-${t.slice(-4)}` : t;
}

const q = encodeURIComponent;
const linhaFicha = (href, titulo, extra, data) => el('li', { class: 'linha-ficha' }, el('a', { href }, titulo), el('span', { class: 'campo__ajuda' }, [extra, data && formatarDataHora(data)].filter(Boolean).join(' · ')));

/** Ficha do cliente num modal: o banco decide quais partes a pessoa pode ver. */
async function abrirFicha(clienteId, origem = null) {
  const corpo = el('div', { class: 'pilha', 'aria-live': 'polite' }, el('p', {}, 'Carregando a ficha…'));
  const modal = abrirModal({ titulo: 'Ficha do cliente', corpo, tamanho: 'grande', aoFechar: () => origem?.focus() });
  try {
    const f = await fichaCliente(clienteId);
    const c = f.cliente;
    modal.dialogo.querySelector('h2')?.replaceChildren(`Ficha de ${c.nome}`);
    const id = ctx.id;
    const blocos = [];
    if (f.vendas) blocos.push({ chave: 'ficha-vendas', titulo: 'Vendas', contador: f.vendas.length, painel: f.vendas.length
      ? el('ul', { class: 'lista-simples' }, ...f.vendas.map((v) => linhaFicha(`/business/venda.html?id=${q(id)}&venda=${q(v.id)}`, `Venda nº ${v.numero}`,
        `${dinheiro(v.total_centavos)} · ${ESTADO_VENDA[v.estado] ?? v.estado}`, v.data))) : el('p', {}, 'Nenhuma venda ainda.') });
    if (f.solicitacoes) blocos.push({ chave: 'ficha-orcamentos', titulo: 'Orçamentos', contador: f.solicitacoes.length, painel: f.solicitacoes.length
      ? el('ul', { class: 'lista-simples' }, ...f.solicitacoes.map((x) => linhaFicha(`/business/solicitacao.html?id=${q(id)}&solicitacao=${q(x.id)}`,
        `Nº ${x.numero} · ${x.servico}`, ESTADO_SOLICITACAO[x.estado] ?? x.estado, x.data))) : el('p', {}, 'Nenhum orçamento.') });
    if (f.ordens) blocos.push({ chave: 'ficha-os', titulo: 'Ordens de serviço', contador: f.ordens.length, painel: f.ordens.length
      ? el('ul', { class: 'lista-simples' }, ...f.ordens.map((o) => linhaFicha(`/business/ordem.html?id=${q(id)}&os=${q(o.id)}`,
        `OS nº ${o.numero} · ${o.servico}`, ESTADO_OS[o.estado] ?? o.estado, o.data))) : el('p', {}, 'Nenhuma ordem de serviço.') });
    if (f.pedidos) blocos.push({ chave: 'ficha-pedidos', titulo: 'Pedidos', contador: f.pedidos.length, painel: f.pedidos.length
      ? el('ul', { class: 'lista-simples' }, ...f.pedidos.map((p) => el('li', { class: 'linha-ficha' }, el('span', {}, 'Pedido '), chipPedido(p.estado),
        el('span', { class: 'campo__ajuda' }, `${dinheiro(p.total_centavos)} · ${formatarDataHora(p.data)}`)))) : el('p', {}, 'Nenhum pedido.') });
    const resumo = el('div', { class: 'resumo-ficha' },
      el('div', {}, el('small', {}, 'Contato'), el('strong', {}, [c.telefone, c.email].filter(Boolean).join(' · ') || 'Sem contato')),
      c.documento ? el('div', {}, el('small', {}, c.tipo_pessoa === 'pj' ? 'CNPJ' : 'CPF'), el('strong', {}, mascararDocumento(c.documento, c.tipo_pessoa))) : null,
      enderecoEmLinha(c) ? el('div', {}, el('small', {}, 'Endereço'), el('strong', {}, enderecoEmLinha(c))) : null,
      c.nome_fantasia ? el('div', {}, el('small', {}, 'Nome fantasia'), el('strong', {}, c.nome_fantasia)) : null,
      el('div', {}, el('small', {}, 'Cliente desde'), el('strong', {}, new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(c.desde)))),
      f.resumo ? el('div', {}, el('small', {}, 'Compras confirmadas'), el('strong', {}, `${f.resumo.vendas} · ${dinheiro(f.resumo.total_centavos)}`)) : null,
      f.resumo ? el('div', {}, el('small', {}, 'Última compra'), el('strong', {}, f.resumo.ultima_compra ? formatarDataHora(f.resumo.ultima_compra) : 'Nenhuma')) : null);
    const acoes = el('div', { class: 'grupo-botoes' },
      ctx.pode('vendas.criar') ? el('a', { class: 'botao', href: `/business/venda-nova.html?id=${q(id)}` }, 'Nova venda') : null,
      c.telefone ? el('a', { class: 'botao botao--secundario', href: `tel:+55${c.telefone}` }, 'Ligar') : null);
    corpo.replaceChildren(...[resumo,
      c.observacoes ? el('p', { class: 'campo__ajuda' }, `Observações: ${c.observacoes}`) : null,
      c.conta_vinculada ? el('p', {}, el('span', { class: 'chip chip--info' }, 'Cliente do app')) : null,
      acoes,
      blocos.length ? abas({ rotulo: 'Histórico do cliente', itens: blocos, aoTrocar: () => {} }).elemento
        : el('p', { class: 'campo__ajuda' }, 'Seu perfil não inclui vendas, orçamentos, ordens de serviço nem pedidos.')].filter(Boolean));
  } catch (erro) {
    corpo.replaceChildren(aviso('erro', erro.message || 'Não foi possível abrir a ficha.'));
  }
}

let situacao = 'ativos';
const corpoLista = el('div', { id: 'resultado-clientes', 'aria-live': 'polite' });

function desenharLista() {
  const visiveis = lista.filter((c) => situacao === 'todos' || (situacao === 'ativos' ? c.ativo : !c.ativo));
  document.getElementById('titulo-clientes')?.replaceChildren(`Clientes (${visiveis.length}${lista.length >= 100 ? '+' : ''})`);
  corpoLista.replaceChildren(visiveis.length
    ? el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: 'lista-clientes' },
      el('caption', { class: 'visualmente-oculto' }, 'Clientes da empresa'),
      el('thead', {}, el('tr', {}, ...['Cliente', 'Contato', 'Cidade', 'Vendas', 'Ações'].map((c) => el('th', { scope: 'col', class: c === 'Vendas' ? 'numero' : null }, c)))),
      el('tbody', {}, ...visiveis.map(linha))))
    : vazio(busca ? `Nenhum cliente encontrado para "${busca}".` : (situacao === 'inativos' ? 'Nenhum cliente desativado.' : 'Nenhum cliente cadastrado ainda.'),
      !busca && ctx.pode('clientes.criar') && situacao !== 'inativos' ? botaoNovo('nao-ha-clientes') : null, 'lista-clientes'));
}

function botaoNovo(id = 'novo-cliente') {
  const b = el('button', { type: 'button', class: 'botao', id }, 'Adicionar cliente');
  b.addEventListener('click', () => abrirNovo(b));
  return b;
}

function secaoLista() {
  const filtroSituacao = campoSelecao({ nome: 'situacao', rotulo: 'Situação', opcoes: [['ativos', 'Ativos'], ['inativos', 'Desativados'], ['todos', 'Todos']], valor: situacao, vazio: null, id: 'filtro-situacao' });
  filtroSituacao.querySelector('select').addEventListener('change', (e) => { situacao = e.target.value; desenharLista(); });
  const barra = barraConsulta({ id: 'busca-cliente', rotulo: 'Buscar clientes', valor: busca, dica: 'Nome, razão social, CPF/CNPJ, telefone ou e-mail',
    aoBuscar: async (v) => { busca = v; lista = await lerClientes(ctx.id, busca, 100, 0); desenharLista(); barra.anunciar(`${lista.length} clientes encontrados.`); },
    acoes: [ctx.pode('clientes.criar') ? botaoNovo() : null], filtros: [filtroSituacao] });
  const secao = el('section', { class: 'pilha', 'aria-labelledby': 'titulo-clientes' }, el('h2', { id: 'titulo-clientes' }, 'Clientes'), barra.elemento,
    el('p', { class: 'campo__ajuda' }, 'Para vender sem identificar ninguém, use "Consumidor não identificado" na venda.'), corpoLista);
  return secao;
}

async function carregar() {
  mostrarCarregando(area, 'Carregando os clientes');
  try {
    ctx = await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'clientes'));
    if (!ctx.pode('clientes.visualizar')) {
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não inclui os clientes desta empresa.')));
      return;
    }
    lista = await lerClientes(ctx.id, busca, 100, 0);
    document.getElementById('titulo-pagina').textContent = `Clientes de ${ctx.empresa?.nome_publico ?? 'empresa'}`;
    concluirCarregamento(area);
    area.append(secaoLista());
    desenharLista();
    const pedida = parametro('ficha');
    if (pedida && /^[0-9a-f-]{36}$/.test(pedida)) {
      history.replaceState(history.state, '', location.href.replace(/([?&])ficha=[^&#]*&?/, '$1').replace(/[?&]$/, ''));
      abrirFicha(pedida, document.querySelector(`[data-ficha="${pedida}"]`));
    }
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
