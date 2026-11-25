/**
 * Clientes da empresa (M06, RF-033 a RF-038): cadastro mínimo sem CPF (D6-10), busca, edição com versão,
 * desativação e ficha do cliente (E05: resumo, vendas, pedidos, orçamentos e OS, cada parte com a permissão da área).
 * O vínculo com a conta pública só nasce do pedido aceito (D6-11).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { clientes as lerClientes, criarCliente, alterarCliente, definirClienteAtivo, fichaCliente, ESTADO_VENDA } from '../../data/vendas.js';
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

/** Lê o formulário de cliente; devolve os dados ou null (com o erro ao lado do campo). */
function dadosCliente(form) {
  const d = valores(form);
  if (!d.nome || d.nome.length < 2) return erroNoCampo(form, 'nome', 'Informe o nome (pelo menos 2 letras).') && null;
  if (d.telefone && !/^\d{10,13}$/.test(d.telefone.replace(/\D/g, ''))) return erroNoCampo(form, 'telefone', 'Informe o telefone com DDD.') && null;
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return erroNoCampo(form, 'email', 'Informe um e-mail válido.') && null;
  return { nome: d.nome, telefone: d.telefone || null, email: d.email || null, observacoes: d.observacoes || null };
}

function camposCliente(prefixo, c = {}) {
  return [
    campoTexto({ nome: 'nome', rotulo: 'Nome', obrigatorio: true, max: 120, valor: c.nome, id: `${prefixo}-nome`, autocomplete: 'off' }),
    el('div', { class: 'grade-filtros' },
      campoTexto({ nome: 'telefone', rotulo: 'Telefone com DDD', tipo: 'tel', max: 20, valor: c.telefone, id: `${prefixo}-telefone` }),
      campoTexto({ nome: 'email', rotulo: 'E-mail', tipo: 'email', max: 254, valor: c.email, id: `${prefixo}-email` })),
    campoTexto({ nome: 'observacoes', rotulo: 'Observações', max: 500, linhas: 2, valor: c.observacoes, id: `${prefixo}-observacoes`,
      ajuda: 'Só o necessário para atender. Não registre CPF nem dados sensíveis.' }),
  ];
}

function secaoNovo() {
  if (!ctx.pode('clientes.criar')) return null;
  const botao = el('button', { type: 'submit', class: 'botao' }, 'Cadastrar cliente');
  const form = el('form', { id: 'form-cliente', class: 'pilha', novalidate: true }, ...camposCliente('novo'), el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = dadosCliente(form);
    if (!d) return;
    ocupado(botao, () => executar('criar', form, (k) => criarCliente(ctx.id, d, k), (r) => {
      form.reset();
      anunciar('sucesso', `Cliente "${r.nome}" cadastrado.`);
    }));
  });
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-novo-cliente' },
    el('h2', { id: 'titulo-novo-cliente' }, 'Novo cliente'),
    el('p', {}, 'Só o nome é obrigatório. Para vender sem identificar ninguém, use "Consumidor não identificado" na venda.'), form);
}

function cartao(c) {
  const acoes = [];
  if (ctx.pode('clientes.alterar')) {
    const botao = el('button', { type: 'submit', class: 'botao' }, 'Salvar alterações');
    const form = el('form', { class: 'pilha', novalidate: true }, ...camposCliente(`c-${c.id}`, c), el('div', { class: 'grupo-botoes' }, botao));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const d = dadosCliente(form);
      if (!d) return;
      ocupado(botao, () => executar(`alterar-${c.id}`, form, (k) => alterarCliente(c.id, d, c.versao, k), () => anunciar('sucesso', 'Cliente atualizado.')));
    });
    acoes.push(el('details', {}, el('summary', {}, 'Editar'), form));
    const ativar = el('button', { type: 'button', class: 'botao botao--texto' }, c.ativo ? 'Desativar' : 'Reativar');
    ativar.addEventListener('click', () => ocupado(ativar, () => executar(`ativo-${c.id}`, null, (k) => definirClienteAtivo(c.id, !c.ativo, c.versao, k),
      () => anunciar('sucesso', c.ativo ? 'Cliente desativado. O histórico continua guardado.' : 'Cliente reativado.'))));
    acoes.push(ativar);
  }
  const ficha = el('button', { type: 'button', class: 'botao botao--secundario', 'data-ficha': c.id }, 'Abrir ficha');
  ficha.addEventListener('click', () => abrirFicha(c.id, ficha));
  return el('li', { class: 'cartao pilha', 'data-cliente': c.id },
    el('h3', { class: 'cartao__titulo' }, c.nome, c.ativo ? null : el('span', { class: 'chip chip--neutro chip--pequeno' }, 'desativado'),
      c.conta_vinculada ? el('span', { class: 'chip chip--info chip--pequeno' }, 'cliente do app') : null),
    el('p', { class: 'cartao__meta' }, [c.telefone, c.email].filter(Boolean).join(' · ') || 'Sem contato registrado',
      ` · ${c.vendas} ${c.vendas === 1 ? 'venda' : 'vendas'}`),
    c.observacoes ? el('p', {}, c.observacoes) : null,
    el('div', { class: 'grupo-botoes' }, ficha),
    acoes.length ? el('div', { class: 'pilha' }, ...acoes) : null);
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
      el('div', {}, el('small', {}, 'Cliente desde'), el('strong', {}, formatarDataHora(c.desde).split(' ')[0])),
      f.resumo ? el('div', {}, el('small', {}, 'Compras confirmadas'), el('strong', {}, `${f.resumo.vendas} · ${dinheiro(f.resumo.total_centavos)}`)) : null,
      f.resumo ? el('div', {}, el('small', {}, 'Última compra'), el('strong', {}, f.resumo.ultima_compra ? formatarDataHora(f.resumo.ultima_compra) : 'Nenhuma')) : null);
    const acoes = el('div', { class: 'grupo-botoes' },
      ctx.pode('vendas.criar') ? el('a', { class: 'botao', href: `/business/venda-nova.html?id=${q(id)}` }, 'Nova venda') : null,
      c.telefone ? el('a', { class: 'botao botao--secundario', href: `tel:+55${c.telefone}` }, 'Ligar') : null);
    corpo.replaceChildren(resumo,
      c.observacoes ? el('p', { class: 'campo__ajuda' }, `Observações: ${c.observacoes}`) : null,
      c.conta_vinculada ? el('p', {}, el('span', { class: 'chip chip--info' }, 'Cliente do app')) : null,
      acoes,
      blocos.length ? abas({ rotulo: 'Histórico do cliente', itens: blocos, aoTrocar: () => {} }).elemento
        : el('p', { class: 'campo__ajuda' }, 'Seu perfil não inclui vendas, orçamentos, ordens de serviço nem pedidos.'));
  } catch (erro) {
    corpo.replaceChildren(aviso('erro', erro.message || 'Não foi possível abrir a ficha.'));
  }
}

function secaoLista() {
  const form = el('form', { class: 'grade-filtros', role: 'search', id: 'form-busca' },
    campoTexto({ nome: 'busca', rotulo: 'Buscar por nome ou telefone', valor: busca, id: 'busca-cliente' }),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Buscar')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busca = valores(form).busca ?? '';
    carregar();
  });
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-clientes' },
    el('h2', { id: 'titulo-clientes' }, `Clientes (${lista.length})`), form,
    lista.length ? el('ul', { class: 'lista-simples', id: 'lista-clientes' }, ...lista.map(cartao))
      : el('p', { id: 'lista-clientes' }, busca ? 'Nenhum cliente encontrado com essa busca.' : 'Nenhum cliente cadastrado ainda.'));
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
    area.append(...[secaoNovo(), secaoLista()].filter(Boolean));
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
