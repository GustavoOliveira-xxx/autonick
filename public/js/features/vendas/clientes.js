/**
 * Clientes da empresa (M06, RF-033 a RF-038): cadastro mínimo sem CPF (D6-10), busca, edição com versão,
 * desativação e histórico de vendas e pedidos. O vínculo com a conta pública só nasce do pedido aceito (D6-11).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { clientes as lerClientes, criarCliente, alterarCliente, definirClienteAtivo, historicoCliente } from '../../data/vendas.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, dinheiro, chipEstadoVenda, chipPedido } from './comum.js';
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
  const historico = el('div', { class: 'pilha', 'aria-live': 'polite' });
  const detalhes = el('details', {}, el('summary', {}, 'Histórico de compras'), historico);
  if (ctx.pode('vendas.visualizar')) {
    detalhes.addEventListener('toggle', async () => {
      if (!detalhes.open || historico.childElementCount) return;
      historico.append(el('p', {}, 'Carregando…'));
      try {
        const h = await historicoCliente(c.id);
        historico.replaceChildren(...[
          h.vendas.length ? el('ul', { class: 'lista-simples' }, ...h.vendas.map((v) => el('li', {},
            el('a', { href: `/business/venda.html?id=${encodeURIComponent(ctx.id)}&venda=${encodeURIComponent(v.id)}` }, `Venda nº ${v.numero}`),
            ` · ${dinheiro(v.total_centavos)} · ${formatarDataHora(v.confirmada_em)} `, chipEstadoVenda(v.estado))))
            : el('p', {}, 'Nenhuma venda ainda.'),
          h.pedidos.length ? el('ul', { class: 'lista-simples' }, ...h.pedidos.map((p) => el('li', {}, `Pedido de ${formatarDataHora(p.criado_em)} · ${dinheiro(p.total_centavos)} `, chipPedido(p.estado)))) : null].filter(Boolean));
      } catch (erro) {
        historico.replaceChildren(aviso('erro', erro.message));
      }
    });
  }
  return el('li', { class: 'cartao pilha', 'data-cliente': c.id },
    el('h3', { class: 'cartao__titulo' }, c.nome, c.ativo ? null : el('span', { class: 'chip chip--neutro chip--pequeno' }, 'desativado'),
      c.conta_vinculada ? el('span', { class: 'chip chip--info chip--pequeno' }, 'cliente do app') : null),
    el('p', { class: 'cartao__meta' }, [c.telefone, c.email].filter(Boolean).join(' · ') || 'Sem contato registrado',
      ` · ${c.vendas} ${c.vendas === 1 ? 'venda' : 'vendas'}`),
    c.observacoes ? el('p', {}, c.observacoes) : null,
    ctx.pode('vendas.visualizar') ? detalhes : null,
    acoes.length ? el('div', { class: 'pilha' }, ...acoes) : null);
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
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
