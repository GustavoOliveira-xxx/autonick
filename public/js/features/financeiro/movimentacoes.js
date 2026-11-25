/**
 * Movimentações (M07, UI-044; RF-120, RF-121, RF-126, RF-129, RF-130, RF-139; D7-05, D7-06, D7-18):
 * livro-caixa pesquisável com autor e origem, entrada ou saída avulsa, transferência entre contas (que não é receita),
 * aporte e retirada só do proprietário, e estornos ligados ao original.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { abrirModal } from '../../ui/modal.js';
import { campoTexto, campoSelecao, grupoOpcoes, valores, erroNoCampo, limparErros, ocupado } from '../../ui/formulario.js';
import {
  lancamentos as lerLancamentos, contas as lerContas, categorias as lerCategorias, registrarLancamento, estornarLancamento, transferir,
  estornarTransferencia, registrarMovimentoProprietario,
} from '../../data/financeiro.js';
import { NATUREZA, TIPO_LANCAMENTO } from '../../domain/financeiro.js';
import {
  carregarFinanceiro, criarAnunciador, criarExecutorFinanceiro, dinheiro, dataDeHoje, formatarData, dialogoFormulario, ehProprietario,
  opcoesContas, contaPadrao, opcoesCategorias, centavosDoCampo, avisoRegistro, erroDeCarga,
} from './comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let contas = [];
let categorias = [];
let filtros = {};
let limite = 50;

const executar = criarExecutorFinanceiro({ area, anunciar, recarregar: () => carregar(), erroNoCampo });
const nomeConta = (id) => contas.find((c) => c.id === id)?.nome ?? 'conta';

function secaoFiltros() {
  const form = el('form', { id: 'form-filtros', class: 'pilha', role: 'search' },
    el('div', { class: 'grade-filtros' },
      campoTexto({ nome: 'de', rotulo: 'De', tipo: 'date', valor: filtros.de, id: 'filtro-de' }),
      campoTexto({ nome: 'ate', rotulo: 'Até', tipo: 'date', valor: filtros.ate, id: 'filtro-ate' }),
      campoSelecao({ nome: 'conta_id', rotulo: 'Conta', opcoes: contas.map((c) => [c.id, c.nome]), valor: filtros.conta_id, vazio: 'Todas', id: 'filtro-conta' }),
      campoSelecao({ nome: 'natureza', rotulo: 'Natureza', opcoes: Object.entries(NATUREZA), valor: filtros.natureza, vazio: 'Todas', id: 'filtro-natureza' }),
      campoTexto({ nome: 'texto', rotulo: 'Buscar na descrição', valor: filtros.texto, id: 'filtro-texto' })),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Filtrar')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    filtros = Object.fromEntries(Object.entries(valores(form)).filter(([, v]) => v));
    limite = 50;
    carregar();
  });
  return form;
}

async function pedirMotivo(id, titulo, texto) {
  return dialogoFormulario({ id, titulo, rotuloConfirmar: 'Estornar', descricao: [texto],
    campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo do estorno', obrigatorio: true, linhas: 3, max: 300, id: `${id}-motivo`, ajuda: 'De 10 a 300 caracteres.' })],
    validar: (form) => { const m = valores(form).motivo ?? ''; return m.length >= 10 ? { motivo: m } : (erroNoCampo(form, 'motivo', 'Explique com pelo menos 10 caracteres.') && null); } });
}

function acaoEstorno(l) {
  if (l.estornado || l.tipo === 'estorno') return null;
  const manual = ['receita_avulsa', 'despesa_avulsa', 'saldo_inicial'].includes(l.tipo) && ctx.pode('financeiro.cancelar');
  const dono = ['retirada', 'aporte'].includes(l.tipo) && ehProprietario(ctx);
  const transf = l.origem_tipo === 'transferencia' && l.sentido === 'saida' && ctx.pode('financeiro.cancelar');
  if (l.titulo_id && ['recebimento', 'pagamento'].includes(l.tipo)) {
    return el('a', { href: `/business/financeiro-contas.html?id=${encodeURIComponent(ctx.id)}&titulo=${encodeURIComponent(l.titulo_id)}`, class: 'botao botao--texto' }, 'Ver a conta');
  }
  if (!manual && !dono && !transf) return null;
  const botao = el('button', { type: 'button', class: 'botao botao--texto', 'data-estornar': l.id }, transf ? 'Estornar transferência' : 'Estornar');
  botao.addEventListener('click', () => ocupado(botao, async () => {
    const id = `estorno-${l.id.slice(0, 8)}`;
    const res = await pedirMotivo(id, transf ? 'Estornar a transferência?' : 'Estornar este lançamento?',
      transf ? `${dinheiro(l.valor_centavos)} voltam para ${l.conta}. Isso cria uma transferência inversa com a data de hoje; a original continua no histórico.`
        : `${dinheiro(l.valor_centavos)} em ${l.conta}. O estorno é um lançamento inverso com a data de hoje; o original continua no histórico.`);
    if (!res) return;
    await executar(`estornar-${l.id}`, null, (k) => (transf ? estornarTransferencia(l.origem_id, res.motivo, k) : estornarLancamento(l.id, res.motivo, k)),
      () => anunciar('sucesso', 'Estorno registrado.'));
  }));
  return botao;
}

function secaoLivro(r) {
  const mais = r.total > r.itens.length ? el('button', { type: 'button', class: 'botao botao--secundario', id: 'carregar-mais' }, 'Mostrar mais') : null;
  mais?.addEventListener('click', () => { limite += 50; carregar(); });
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-livro' },
    el('h2', { id: 'titulo-livro' }, `Livro-caixa (${r.total})`),
    secaoFiltros(),
    r.itens.length ? el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: 'tabela-lancamentos' },
      el('caption', { class: 'visualmente-oculto' }, 'Lançamentos do mais recente para o mais antigo'),
      el('thead', {}, el('tr', {}, ...['Data', 'Conta', 'O que foi', 'Natureza', 'Valor', 'Registrado por', 'Ações'].map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', {}, ...r.itens.map((l) => el('tr', { 'data-lancamento': l.id },
        el('th', { scope: 'row' }, formatarData(l.data)),
        el('td', { 'data-rotulo': 'Conta' }, l.conta),
        el('td', { 'data-rotulo': 'O que foi' }, el('strong', {}, TIPO_LANCAMENTO[l.tipo] ?? l.tipo), l.descricao ? ` · ${l.descricao}` : '',
          l.categoria ? el('span', { class: 'campo__ajuda' }, ` (${l.categoria})`) : null, l.estornado ? ' · estornado' : '',
          l.carga_m06 ? el('span', { class: 'campo__ajuda' }, ' · trazido das vendas') : null),
        el('td', { 'data-rotulo': 'Natureza' }, NATUREZA[l.natureza] ?? l.natureza),
        el('td', { class: 'numero', 'data-rotulo': 'Valor' }, `${l.sentido === 'entrada' ? '+' : '−'} ${dinheiro(l.valor_centavos)}`,
          el('span', { class: 'visualmente-oculto' }, l.sentido === 'entrada' ? ' (entrada)' : ' (saída)')),
        el('td', { 'data-rotulo': 'Registrado por' }, l.autor),
        el('td', { 'data-rotulo': 'Ações' }, acaoEstorno(l))))))) : el('p', { id: 'tabela-lancamentos' }, 'Nenhum lançamento encontrado.'),
    mais);
}

function secaoAvulso() {
  const categoria = el('div');
  const montar = (t) => categoria.replaceChildren(campoSelecao({ nome: 'categoria_id', rotulo: 'Categoria', obrigatorio: true, id: 'avulso-categoria',
    opcoes: opcoesCategorias(categorias, t === 'receita_avulsa' ? 'receita' : 'despesa') }));
  const form = el('form', { id: 'form-avulso', class: 'pilha', novalidate: true },
    grupoOpcoes({ nome: 'tipo', legenda: 'Tipo', opcoes: [['despesa_avulsa', 'Saída (despesa)'], ['receita_avulsa', 'Entrada (receita)']], marcados: ['despesa_avulsa'] }),
    el('div', { class: 'grade-filtros' },
      campoSelecao({ nome: 'conta_id', rotulo: 'Conta', opcoes: opcoesContas(contas), valor: contaPadrao(contas), obrigatorio: true, id: 'avulso-conta' }),
      campoTexto({ nome: 'valor', rotulo: 'Valor (R$)', obrigatorio: true, id: 'avulso-valor' }),
      campoTexto({ nome: 'data', rotulo: 'Data', tipo: 'date', valor: dataDeHoje(), id: 'avulso-data', ajuda: 'Hoje ou antes, num mês ainda aberto.' })),
    categoria,
    campoTexto({ nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, max: 300, id: 'avulso-descricao', ajuda: 'Diga o que foi, para achar depois.' }),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao', id: 'salvar-avulso' }, 'Registrar')));
  montar('despesa_avulsa');
  form.addEventListener('change', (e) => { if (e.target.name === 'tipo') montar(e.target.value); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    const centavos = centavosDoCampo(form, 'valor', erroNoCampo);
    if (centavos === null) return null;
    if (!d.categoria_id) return erroNoCampo(form, 'categoria_id', 'Escolha a categoria.');
    if (!d.descricao || d.descricao.length < 2) return erroNoCampo(form, 'descricao', 'Descreva o lançamento.');
    if (d.data > dataDeHoje()) return erroNoCampo(form, 'data', 'A data não pode estar no futuro. O que ainda vai acontecer é uma conta a pagar ou a receber.');
    return executar('avulso', form, (k) => registrarLancamento(ctx.id, { tipo: d.tipo, conta_id: d.conta_id, valor_centavos: centavos, data: d.data,
      categoria_id: d.categoria_id, descricao: d.descricao }, k), () => { fecharAcao(); anunciar('sucesso', 'Lançamento registrado.'); });
  });
  return form;
}

function secaoTransferencia() {
  const ativas = opcoesContas(contas);
  if (ativas.length < 2) return el('p', {}, 'Cadastre uma segunda conta (por exemplo, a conta do banco) para transferir entre elas.');
  const form = el('form', { id: 'form-transferencia', class: 'pilha', novalidate: true },
    el('div', { class: 'grade-filtros' },
      campoSelecao({ nome: 'conta_origem_id', rotulo: 'Sai de', opcoes: ativas, valor: contaPadrao(contas), obrigatorio: true, id: 'transf-origem' }),
      campoSelecao({ nome: 'conta_destino_id', rotulo: 'Entra em', opcoes: ativas, obrigatorio: true, id: 'transf-destino' }),
      campoTexto({ nome: 'valor', rotulo: 'Valor (R$)', obrigatorio: true, id: 'transf-valor' }),
      campoTexto({ nome: 'data', rotulo: 'Data', tipo: 'date', valor: dataDeHoje(), id: 'transf-data' })),
    campoTexto({ nome: 'descricao', rotulo: 'Descrição (opcional)', max: 300, id: 'transf-descricao', ajuda: 'Ex.: depósito do dinheiro do caixa no banco.' }),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao', id: 'salvar-transferencia' }, 'Transferir')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    const centavos = centavosDoCampo(form, 'valor', erroNoCampo);
    if (centavos === null) return null;
    if (!d.conta_destino_id) return erroNoCampo(form, 'conta_destino_id', 'Escolha a conta de destino.');
    if (d.conta_origem_id === d.conta_destino_id) return erroNoCampo(form, 'conta_destino_id', 'Escolha contas diferentes.');
    const ok = await abrirDialogo({ titulo: 'Confirmar a transferência?', rotuloConfirmar: 'Transferir', rotuloCancelar: 'Voltar',
      mensagens: [`Sai ${dinheiro(centavos)} de ${nomeConta(d.conta_origem_id)} e entra o mesmo valor em ${nomeConta(d.conta_destino_id)}.`,
        'O total da empresa não muda. Não é receita nem despesa.'] });
    if (!ok) return null;
    return executar('transferencia', form, (k) => transferir(ctx.id, { conta_origem_id: d.conta_origem_id, conta_destino_id: d.conta_destino_id,
      valor_centavos: centavos, data: d.data, ...(d.descricao ? { descricao: d.descricao } : {}) }, k),
    (t) => fecharAcao() || anunciar('sucesso', 'Transferência registrada.', el('p', {}, `${t.conta_origem}: ${dinheiro(t.saldo_origem_centavos)} · ${t.conta_destino}: ${dinheiro(t.saldo_destino_centavos)}.`)));
  });
  return form;
}

// E06: as ações do dia a dia abrem em modal a partir da barra de ações rápidas (e do Painel financeiro, pelo endereço).
let acaoAberta = null;
function fecharAcao() { acaoAberta?.fechar(); acaoAberta = null; }
function abrirAcao(titulo, descricao, corpo) {
  let alterado = false;
  corpo.addEventListener?.('input', () => { alterado = true; });
  acaoAberta = abrirModal({ titulo, descricao, corpo, tamanho: 'medio', protegerAlteracoes: () => alterado, aoFechar: () => { acaoAberta = null; } });
  acaoAberta.dialogo.querySelector('input:not([type="radio"]), select')?.focus();
}
function barraAcoes() {
  const b = (id, rotulo, ajuda, abrir) => {
    const botao = el('button', { type: 'button', class: 'cartao-acao', id, 'data-ancora-abre': '' }, el('strong', {}, rotulo), el('span', {}, ajuda));
    botao.addEventListener('click', abrir);
    return botao;
  };
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-acoes-fin' }, el('h2', { id: 'titulo-acoes-fin' }, 'Ações rápidas'),
    el('div', { class: 'grade-acoes' },
      b('acao-avulso', 'Entrada ou saída', 'Pago ou recebido na hora, sem conta a pagar ou receber.',
        () => abrirAcao('Entrada ou saída avulsa', 'Para algo pago ou recebido na hora, sem conta a pagar ou a receber.', secaoAvulso())),
      b('acao-transferencia', 'Transferir entre contas', 'Do caixa para o banco, por exemplo. Não é receita nem despesa.',
        () => abrirAcao('Transferência entre contas', 'O total da empresa não muda.', secaoTransferencia()))));
}

function secaoProprietario() {
  if (!ehProprietario(ctx)) {
    return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-dono' }, el('h2', { id: 'titulo-dono' }, 'Dinheiro do proprietário'),
      el('p', {}, 'Aportes e retiradas do proprietário são registrados só por ele.'));
  }
  const form = el('form', { id: 'form-proprietario', class: 'pilha', novalidate: true },
    grupoOpcoes({ nome: 'tipo', legenda: 'O que aconteceu', opcoes: [['retirada', 'Retirei dinheiro da empresa'], ['aporte', 'Coloquei dinheiro meu na empresa']], marcados: ['retirada'] }),
    el('div', { class: 'grade-filtros' },
      campoSelecao({ nome: 'conta_id', rotulo: 'Conta', opcoes: opcoesContas(contas), valor: contaPadrao(contas), obrigatorio: true, id: 'dono-conta' }),
      campoTexto({ nome: 'valor', rotulo: 'Valor (R$)', obrigatorio: true, id: 'dono-valor' }),
      campoTexto({ nome: 'data', rotulo: 'Data', tipo: 'date', valor: dataDeHoje(), id: 'dono-data' })),
    campoTexto({ nome: 'descricao', rotulo: 'Descrição (opcional)', max: 300, id: 'dono-descricao' }),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao', id: 'salvar-proprietario' }, 'Registrar')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    const centavos = centavosDoCampo(form, 'valor', erroNoCampo);
    if (centavos === null) return null;
    const retirada = d.tipo === 'retirada';
    const ok = await abrirDialogo({ titulo: retirada ? 'Registrar a retirada?' : 'Registrar o aporte?', rotuloConfirmar: 'Registrar', rotuloCancelar: 'Voltar',
      mensagens: [`${dinheiro(centavos)} ${retirada ? 'saem de' : 'entram em'} ${nomeConta(d.conta_id)}.`,
        retirada ? 'A retirada não é despesa da empresa e não muda o resultado estimado.' : 'O aporte não é receita da empresa e não muda o resultado estimado.'] });
    if (!ok) return null;
    return executar('proprietario', form, (k) => registrarMovimentoProprietario(ctx.id, { tipo: d.tipo, conta_id: d.conta_id, valor_centavos: centavos, data: d.data,
      ...(d.descricao ? { descricao: d.descricao } : {}) }, k), () => anunciar('sucesso', retirada ? 'Retirada registrada.' : 'Aporte registrado.'));
  });
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-dono' }, el('h2', { id: 'titulo-dono' }, 'Dinheiro do proprietário'),
    el('p', { class: 'campo__ajuda' }, 'Separado do resultado da empresa: não é receita nem despesa.'), form);
}

async function carregar() {
  mostrarCarregando(area, 'Carregando as movimentações');
  try {
    ctx = await carregarFinanceiro(area, nav, 'movimentacoes');
    if (!ctx) return;
    const [r, cs, cats] = await Promise.all([lerLancamentos(ctx.id, filtros, limite, 0), lerContas(ctx.id), lerCategorias(ctx.id)]);
    contas = cs;
    categorias = cats;
    concluirCarregamento(area);
    area.append(...[avisoRegistro(),
      ctx.pode('financeiro.aprovar') ? barraAcoes() : null,
      secaoProprietario(),
      secaoLivro(r)].filter(Boolean));
  } catch (erro) {
    erroDeCarga(area, erro, tratarErro, carregar);
  }
}

carregar();
