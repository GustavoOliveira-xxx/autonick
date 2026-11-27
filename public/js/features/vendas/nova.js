/**
 * Nova venda de balcão e edição de rascunho (M06, RF-067 a RF-074; D6-02, D6-04, D6-05, D6-08, D6-13, D6-14).
 *
 * O navegador envia só variação, quantidade e desconto pedido. Preço, desconto permitido, estoque e total
 * são decididos no banco; o total mostrado aqui é prévia e vai como "total esperado": se o catálogo mudou,
 * o banco recusa e a tela mostra o novo total para a pessoa revisar.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { lerValorEmReais } from '../../domain/moeda.js';
import {
  catalogoParaVenda, meuLimiteDesconto, venda as lerVenda, criarVenda, alterarVenda, confirmarVenda,
  registrarVendaDireta, previaTotal, FORMAS,
} from '../../data/vendas.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, novaChave, dinheiro, dataDeHoje, nomeItem } from './comum.js';
import { blocoPagamento } from './pagamento-venda.js';
import { seletorCliente } from './cliente-venda.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
const vendaId = parametro('venda');
let ctx = null;
let catalogo = [];
let carrinho = []; // [{ variacao_id, produto, variacao, preco_centavos, quantidade, desconto_centavos, sob_encomenda, disponivel, tem_estoque }]
let rascunho = null;
let limite = null;
const chaves = new Map();
const chave = (acao) => { if (!chaves.has(acao)) chaves.set(acao, novaChave()); return chaves.get(acao); };

const irParaVenda = (id, extra = '') => { location.href = `/business/venda.html?id=${encodeURIComponent(ctx.id)}&venda=${encodeURIComponent(id)}${extra}`; };

function secaoCatalogo(resumo) {
  const resultado = el('ul', { class: 'lista-simples', id: 'resultado-catalogo', 'aria-live': 'polite' });
  const desenhar = (texto) => {
    const t = texto.trim().toLowerCase();
    const achados = catalogo.filter((c) => !t || `${c.produto} ${c.variacao} ${c.sku ?? ''}`.toLowerCase().includes(t)).slice(0, 12);
    resultado.replaceChildren(...(achados.length ? achados.map((c) => {
      const pausado = c.venda_pausada;
      const botao = el('button', { type: 'button', class: 'botao botao--secundario', disabled: pausado, 'data-adicionar': c.variacao_id },
        pausado ? 'Venda pausada' : 'Adicionar');
      botao.addEventListener('click', () => {
        const ja = carrinho.find((i) => i.variacao_id === c.variacao_id);
        if (ja) ja.quantidade += 1;
        else carrinho.push({ ...c, quantidade: 1, desconto_centavos: 0 });
        resumo();
        document.getElementById(`qtd-${c.variacao_id}`)?.focus();
      });
      return el('li', { class: 'cartao linha-item' },
        el('span', {}, el('strong', {}, nomeItem(c)), ` · ${dinheiro(c.preco_centavos)}`,
          c.sob_encomenda ? el('span', { class: 'chip chip--info chip--pequeno' }, 'sob encomenda') : null,
          Number.isInteger(c.disponivel) ? ` · ${c.disponivel} disponíveis` : (c.tem_estoque ? ' · em estoque' : ' · sem estoque')),
        botao);
    }) : [el('li', {}, 'Nenhum produto encontrado.')]));
  };
  const busca = campoTexto({ nome: 'busca', rotulo: 'Buscar produto por nome ou código', id: 'busca-produto' });
  busca.querySelector('input').addEventListener('input', (e) => desenhar(e.target.value));
  desenhar('');
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-catalogo' },
    el('h2', { id: 'titulo-catalogo' }, 'Produtos'), busca, resultado);
}

function lerCarrinho() {
  for (const i of carrinho) {
    const q = document.getElementById(`qtd-${i.variacao_id}`);
    if (q) i.quantidade = Number.parseInt(q.value, 10);
    const d = document.getElementById(`desc-${i.variacao_id}`);
    if (d) {
      const v = d.value.trim() ? lerValorEmReais(d.value) : { ok: true, centavos: 0 };
      i.desconto_centavos = v.ok ? v.centavos : Number.NaN;
    }
  }
}

function secaoCarrinho() {
  const podeDesconto = ctx.pode('vendas.aplicar_desconto');
  const corpo = el('div', { class: 'pilha', id: 'carrinho' });
  const totalTexto = el('p', { class: 'numero-grande', id: 'total-previa', 'aria-live': 'polite' });
  const form = el('form', { class: 'pilha', id: 'form-venda', novalidate: true });
  const resumo = () => {
    corpo.replaceChildren(...(carrinho.length ? carrinho.map((i) => {
      const remover = el('button', { type: 'button', class: 'botao botao--texto' }, el('span', { class: 'visualmente-oculto' }, `${nomeItem(i)}: `), 'Remover');
      remover.addEventListener('click', () => { carrinho = carrinho.filter((x) => x !== i); resumo(); });
      const q = campoTexto({ nome: `qtd-${i.variacao_id}`, rotulo: `Quantidade de ${nomeItem(i)}`, valor: String(i.quantidade), id: `qtd-${i.variacao_id}`, tipo: 'number' });
      q.querySelector('input').setAttribute('min', '1');
      q.querySelector('input').addEventListener('change', () => { lerCarrinho(); atualizarTotal(); });
      const aviso1 = i.sob_encomenda && Number.isInteger(i.disponivel) && i.quantidade > i.disponivel
        ? el('p', { class: 'campo__ajuda' }, 'Sob encomenda: o que faltar fica com entrega pendente, sem baixar estoque inexistente.') : null;
      return el('div', { class: 'cartao pilha', 'data-item': i.variacao_id },
        el('p', {}, el('strong', {}, nomeItem(i)), ` · ${dinheiro(i.preco_centavos)} cada`),
        el('div', { class: 'grade-filtros' }, q,
          podeDesconto ? campoTexto({ nome: `desc-${i.variacao_id}`, rotulo: `Desconto no item (R$)`, valor: i.desconto_centavos ? String(i.desconto_centavos / 100).replace('.', ',') : '', id: `desc-${i.variacao_id}` }) : null),
        aviso1, el('div', { class: 'grupo-botoes' }, remover));
    }) : [el('p', {}, 'Adicione produtos pela busca.')]));
    atualizarTotal();
  };
  const atualizarTotal = () => {
    const geral = lerValorEmReais(form.querySelector('[name="desconto_geral"]')?.value || '0');
    const p = previaTotal(carrinho.filter((i) => Number.isInteger(i.quantidade) && i.quantidade > 0),
      geral.ok ? geral.centavos : 0);
    totalTexto.textContent = `Total previsto: ${dinheiro(p.total)}${p.descontos ? ` (desconto de ${dinheiro(p.descontos)})` : ''}`;
    pagamento?.atualizar();
  };
  let pagamento = null;

  // Cliente, desconto geral, observação e pagamento.
  const totalAgora = () => {
    const geral = lerValorEmReais(form.querySelector('[name="desconto_geral"]')?.value || '0');
    return previaTotal(carrinho.filter((i) => Number.isInteger(i.quantidade) && i.quantidade > 0), geral.ok ? geral.centavos : 0).total;
  };
  const recebidoAgora = () => {
    const r = lerValorEmReais(form.querySelector('[name="recebido"]')?.value || '0');
    return r.ok ? r.centavos : 0;
  };
  pagamento = blocoPagamento({ total: totalAgora, recebido: recebidoAgora, formas: FORMAS, hoje: dataDeHoje() });
  const podeReceber = ctx.pode('vendas.registrar_recebimento') || ctx.pode('financeiro.aprovar');
  const recebimento = podeReceber ? el('fieldset', { class: 'campo pilha' }, el('legend', {}, 'Recebido agora (opcional)'),
    el('p', { class: 'campo__ajuda' }, 'Registre só o que o cliente pagou de fato (entrada). No parcelado, o valor abate a 1ª parcela. O restante fica a receber, sem duplicar a conta.'),
    el('div', { class: 'grade-filtros' },
      campoTexto({ nome: 'recebido', rotulo: 'Valor recebido (R$)', id: 'venda-recebido' }),
      campoSelecao({ nome: 'forma', rotulo: 'Forma', opcoes: FORMAS, id: 'venda-forma' }))) : null;
  recebimento?.querySelector('[name="recebido"]').addEventListener('input', () => pagamento.atualizar());
  const cliente = ctx.pode('clientes.visualizar')
    ? seletorCliente({ ctx, inicial: rascunho?.cliente_empresa_id ? { id: rascunho.cliente_empresa_id, nome: rascunho.cliente ?? 'Cliente' } : null }) : null;

  // Sem filtrar, o append do DOM escreveria "null" na tela para cada bloco que o perfil não pode ver.
  form.append(...[
    cliente?.elemento ?? null,
    podeDesconto ? campoTexto({ nome: 'desconto_geral', rotulo: 'Desconto na venda (R$)', id: 'venda-desconto',
      valor: rascunho?.desconto_geral_centavos ? (rascunho.desconto_geral_centavos / 100).toFixed(2).replace('.', ',') : '',
      ajuda: limite?.sem_limite ? 'Você não tem limite de desconto.' : `Seu limite: ${limite?.percentual ?? 0}% do valor dos produtos.` }) : null,
    el('span', { class: 'campo__erro', id: 'erro-itens', 'data-grupo': 'itens' }),
    totalTexto, pagamento.elemento, recebimento,
    campoTexto({ nome: 'observacao', rotulo: 'Observação (opcional)', max: 500, linhas: 2, id: 'venda-observacao', valor: rascunho?.observacao })].filter(Boolean));
  form.querySelector('[name="desconto_geral"]')?.addEventListener('input', atualizarTotal);

  const salvar = el('button', { type: 'button', class: 'botao botao--secundario', id: 'salvar-rascunho' }, rascunho ? 'Salvar rascunho' : 'Guardar como rascunho');
  const confirmar = ctx.pode('vendas.aprovar') ? el('button', { type: 'submit', class: 'botao', id: 'confirmar-venda' }, 'Confirmar venda') : null;
  form.append(el('div', { class: 'grupo-botoes' }, confirmar, salvar));
  if (!confirmar) form.append(el('p', { class: 'campo__ajuda' }, 'Seu perfil prepara a venda; quem tem permissão de confirmar finaliza.'));

  /** Monta dados e itens; devolve null quando há erro (já mostrado ao lado do campo). */
  const montar = () => {
    limparErros(form);
    lerCarrinho();
    if (!carrinho.length) { document.getElementById('erro-itens').textContent = 'Adicione pelo menos um produto.'; document.getElementById('busca-produto').focus(); return null; }
    for (const i of carrinho) {
      if (!Number.isInteger(i.quantidade) || i.quantidade < 1) return erroNoCampo(form, `qtd-${i.variacao_id}`, 'Use um número inteiro maior que zero.') && null;
      if (Number.isNaN(i.desconto_centavos)) return erroNoCampo(form, `desc-${i.variacao_id}`, 'Desconto inválido. Exemplo: 2,50.') && null;
    }
    const d = valores(form);
    const dados = {};
    if (d.cliente_empresa_id) dados.cliente_empresa_id = d.cliente_empresa_id;
    if (d.observacao) dados.observacao = d.observacao;
    if (d.desconto_geral) {
      const g = lerValorEmReais(d.desconto_geral);
      if (!g.ok) return erroNoCampo(form, 'desconto_geral', g.erro) && null;
      if (g.centavos) dados.desconto_geral_centavos = g.centavos;
    }
    const itens = carrinho.map((i) => (i.desconto_centavos ? { variacao_id: i.variacao_id, quantidade: i.quantidade, desconto_centavos: i.desconto_centavos }
      : { variacao_id: i.variacao_id, quantidade: i.quantidade }));
    return { dados, itens, d };
  };
  const pagamentoDe = (d) => {
    const pg = pagamento.ler(form);
    if (!pg) return null;
    if (d.recebido) {
      const r = lerValorEmReais(d.recebido);
      if (!r.ok) return erroNoCampo(form, 'recebido', r.erro) && null;
      if (!d.forma) return erroNoCampo(form, 'forma', 'Escolha a forma de pagamento.') && null;
      const limiteRecebido = pg.condicao === 'parcelado' ? pg.parcelas[0].valor_centavos : totalAgora();
      if (r.centavos > limiteRecebido) {
        return erroNoCampo(form, 'recebido', pg.condicao === 'parcelado'
          ? `No parcelado, o recebido agora abate a 1ª parcela (até ${dinheiro(limiteRecebido)}). Ajuste a 1ª parcela para ser a entrada.`
          : `O recebido não pode passar do total (${dinheiro(limiteRecebido)}).`) && null;
      }
      pg.recebimento_inicial = { valor_centavos: r.centavos, forma: d.forma };
    }
    return pg;
  };
  const tratarFalha = (acao, erro) => {
    if (erro.codigo === 'NETWORK_UNKNOWN') {
      anunciar('erro', erro.message, el('p', {}, 'Tente de novo: se a venda já tiver sido registrada, ela não será duplicada.'));
      return;
    }
    chaves.delete(acao);
    if (erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, erro.campo, erro.message)) return;
    if (erro.campo && /^[0-9a-f-]{36}$/.test(erro.campo) && erroNoCampo(form, `qtd-${erro.campo}`, erro.message)) return;
    if (erro.codigo === 'DISCOUNT_EXCEEDS_LIMIT' && erroNoCampo(form, 'desconto_geral', erro.message)) return;
    anunciar(['INSUFFICIENT_STOCK', 'PRODUCT_PAUSED', 'DISCOUNT_EXCEEDS_LIMIT', 'STATE_CONFLICT', 'VERSION_CONFLICT'].includes(erro.codigo) ? 'alerta' : 'erro', erro.message,
      erro.codigo === 'STATE_CONFLICT' && /total mudou/.test(erro.message) ? el('p', {}, 'Os preços foram atualizados no catálogo. Recarregue a página para ver os valores novos.') : null);
  };
  salvar.addEventListener('click', () => {
    const m = montar();
    if (!m) return;
    ocupado(salvar, async () => {
      try {
        const r = rascunho ? await alterarVenda(rascunho.id, m.dados, m.itens, rascunho.versao, chave('salvar'))
          : await criarVenda(ctx.id, m.dados, m.itens, chave('salvar'));
        chaves.delete('salvar');
        irParaVenda(r.id);
      } catch (erro) { tratarFalha('salvar', erro); }
    });
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const m = montar();
    if (!m) return;
    const pagamento = pagamentoDe(m.d);
    if (!pagamento) return;
    const geral = m.dados.desconto_geral_centavos ?? 0;
    const esperado = previaTotal(carrinho, geral).total;
    ocupado(confirmar, async () => {
      try {
        let r;
        if (rascunho) {
          const salvo = await alterarVenda(rascunho.id, m.dados, m.itens, rascunho.versao, chave('salvar-antes'));
          chaves.delete('salvar-antes');
          rascunho = { ...rascunho, versao: salvo.versao };
          r = await confirmarVenda(rascunho.id, pagamento, esperado, salvo.versao, chave('confirmar'));
        } else {
          r = await registrarVendaDireta(ctx.id, m.dados, m.itens, pagamento, esperado, chave('confirmar'));
        }
        chaves.delete('confirmar');
        irParaVenda(r.id, '&confirmada=1');
      } catch (erro) { tratarFalha('confirmar', erro); }
    });
  });
  resumo();
  return { secao: el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-carrinho' }, el('h2', { id: 'titulo-carrinho' }, 'Itens da venda'), corpo, form), resumo };
}

async function carregar() {
  mostrarCarregando(area, 'Preparando a venda');
  try {
    ctx = await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'vendas'));
    if (!ctx.pode('vendas.criar')) {
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não permite registrar vendas nesta empresa.')));
      return;
    }
    const [cat, lim, v] = await Promise.all([
      catalogoParaVenda(ctx.id), meuLimiteDesconto(ctx.id), vendaId ? lerVenda(vendaId) : Promise.resolve(null)]);
    catalogo = cat;
    limite = lim;
    if (v) {
      if (v.estado !== 'rascunho') { irParaVenda(v.id); return; }
      rascunho = v;
      carrinho = v.itens.map((i) => ({ ...(catalogo.find((c) => c.variacao_id === i.variacao_id) ?? { produto: i.produto, variacao: i.variacao, preco_centavos: i.preco_centavos }),
        variacao_id: i.variacao_id, quantidade: i.quantidade, desconto_centavos: i.desconto_centavos }));
    }
    document.getElementById('titulo-pagina').textContent = rascunho ? 'Rascunho de venda' : `Nova venda em ${ctx.empresa?.nome_publico ?? 'empresa'}`;
    concluirCarregamento(area);
    const carrinhoSecao = secaoCarrinho();
    area.append(secaoCatalogo(carrinhoSecao.resumo), carrinhoSecao.secao);
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { class: 'botao botao--secundario', href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
