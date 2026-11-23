/**
 * Contas, categorias e recorrências (M07, UI-046; RF-121, RF-125, RF-128; D7-02 a D7-04, D7-08, D7-09, D7-17):
 * contas identificadas só pelo nome (sem dados bancários), saldo inicial como lançamento, caixa nunca negativo,
 * categorias iniciais editáveis, despesas recorrentes mensais ou anuais e a conferência de saldos do proprietário.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, valores, erroNoCampo, limparErros, ocupado } from '../../ui/formulario.js';
import {
  contas as lerContas, categorias as lerCategorias, recorrencias as lerRecorrencias, criarConta, alterarConta, definirContaAtiva, definirContaPadrao,
  criarCategoria, alterarCategoria, definirCategoriaAtiva, criarRecorrencia, alterarRecorrencia, definirRecorrenciaAtiva, reconciliar,
} from '../../data/financeiro.js';
import { TIPOS_CONTA, TIPO_CONTA, mesPorExtenso, inicioDoMes } from '../../domain/financeiro.js';
import {
  carregarFinanceiro, criarAnunciador, criarExecutorFinanceiro, dinheiro, dataDeHoje, formatarData, dialogoFormulario, ehProprietario,
  opcoesCategorias, centavosDoCampo, reaisParaCampo, avisoRegistro, erroDeCarga,
} from './comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let categorias = [];

const executar = criarExecutorFinanceiro({ area, anunciar, recarregar: () => carregar(), erroNoCampo });
const caixaNegativo = () => el('p', { class: 'campo__ajuda' }, 'O caixa (dinheiro físico) nunca fica negativo. Banco, carteira e outro só ficam negativos se você marcar essa opção.');

function caixaDeSelecao(nome, rotulo, marcado, id) {
  return el('div', { class: 'campo' }, el('div', { class: 'opcao' },
    el('input', { type: 'checkbox', name: nome, id, value: 'sim', checked: marcado, 'aria-describedby': `${id}-erro` }), el('label', { for: id }, rotulo)),
    el('span', { id: `${id}-erro`, class: 'campo__erro', 'data-grupo': nome }));
}

function botao(texto, atributos, acao) {
  const b = el('button', { type: 'button', class: 'botao botao--texto', ...atributos }, texto);
  b.addEventListener('click', () => ocupado(b, acao));
  return b;
}

function secaoContas(lista) {
  const podeCriar = ctx.pode('financeiro.criar');
  const linhas = lista.map((c) => el('tr', { 'data-conta': c.id },
    el('th', { scope: 'row' }, c.nome, c.padrao ? el('span', { class: 'chip chip--info chip--pequeno' }, 'padrão') : null),
    el('td', { 'data-rotulo': 'Tipo' }, TIPO_CONTA[c.tipo] ?? c.tipo),
    el('td', { class: 'numero', 'data-rotulo': 'Saldo' }, dinheiro(c.saldo_centavos)),
    el('td', { 'data-rotulo': 'Situação' }, c.ativa ? 'Ativa' : 'Desativada', c.permite_negativo ? ' · aceita saldo negativo' : ''),
    el('td', { 'data-rotulo': 'Ações' }, podeCriar ? el('span', { class: 'opcoes' },
      botao('Editar', { 'data-editar-conta': c.id }, async () => {
        const res = await dialogoFormulario({ id: 'editar-conta', titulo: `Editar ${c.nome}`, rotuloConfirmar: 'Salvar',
          campos: [campoTexto({ nome: 'nome', rotulo: 'Nome', valor: c.nome, obrigatorio: true, max: 80, id: 'editar-conta-nome' }),
            c.tipo === 'caixa' ? caixaNegativo() : caixaDeSelecao('permite_negativo', 'Aceita saldo negativo (por exemplo, limite do banco)', c.permite_negativo, 'editar-conta-negativo')],
          validar: (form) => { const d = valores(form); return d.nome?.length >= 2 ? d : (erroNoCampo(form, 'nome', 'Dê um nome (2 a 80 caracteres).') && null); } });
        if (!res) return;
        await executar(`conta-${c.id}`, null, (k) => alterarConta(c.id, { nome: res.nome, ...(c.tipo === 'caixa' ? {} : { permite_negativo: res.permite_negativo === 'sim' }) }, c.versao, k),
          () => anunciar('sucesso', 'Conta atualizada.'));
      }),
      c.ativa && !c.padrao ? botao('Tornar padrão', { 'data-padrao': c.id }, () => executar(`padrao-${c.id}`, null, (k) => definirContaPadrao(c.id, c.versao, k),
        () => anunciar('sucesso', `${c.nome} agora recebe os valores quando ninguém escolhe outra conta.`))) : null,
      !c.padrao ? botao(c.ativa ? 'Desativar' : 'Reativar', { 'data-ativar-conta': c.id }, () => executar(`ativa-${c.id}`, null,
        (k) => definirContaAtiva(c.id, !c.ativa, c.versao, k), () => anunciar('sucesso', c.ativa ? 'Conta desativada.' : 'Conta reativada.'))) : null) : null)));
  const form = podeCriar ? el('form', { id: 'form-nova-conta', class: 'pilha', novalidate: true },
    el('div', { class: 'grade-filtros' },
      campoTexto({ nome: 'nome', rotulo: 'Nome da conta', obrigatorio: true, max: 80, id: 'conta-nome', ajuda: 'Ex.: Banco do bairro, Maquininha. Não informe agência nem número.' }),
      campoSelecao({ nome: 'tipo', rotulo: 'Tipo', opcoes: TIPOS_CONTA, valor: 'banco', obrigatorio: true, vazio: null, id: 'conta-tipo' }),
      campoTexto({ nome: 'saldo_inicial', rotulo: 'Saldo inicial (R$, opcional)', id: 'conta-saldo' }),
      campoTexto({ nome: 'data_saldo_inicial', rotulo: 'Data do saldo inicial', tipo: 'date', valor: dataDeHoje(), id: 'conta-data' })),
    caixaDeSelecao('permite_negativo', 'Aceita saldo negativo (não vale para caixa)', false, 'conta-negativo'), caixaNegativo(),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao', id: 'salvar-nova-conta' }, 'Criar conta'))) : null;
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    if (!d.nome || d.nome.length < 2) return erroNoCampo(form, 'nome', 'Dê um nome (2 a 80 caracteres).');
    if (d.tipo === 'caixa' && d.permite_negativo === 'sim') return erroNoCampo(form, 'permite_negativo', 'O caixa físico nunca fica negativo.');
    const saldo = centavosDoCampo(form, 'saldo_inicial', erroNoCampo, { obrigatorio: false, minimo: 0 });
    if (saldo === null) return null;
    return executar('nova-conta', form, (k) => criarConta(ctx.id, { nome: d.nome, tipo: d.tipo, permite_negativo: d.permite_negativo === 'sim',
      ...(saldo ? { saldo_inicial_centavos: saldo, data_saldo_inicial: d.data_saldo_inicial } : {}) }, k), (c) => anunciar('sucesso', `Conta "${c.nome}" criada.`));
  });
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-contas' }, el('h2', { id: 'titulo-contas' }, 'Contas e caixas'),
    el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: 'tabela-contas' },
      el('caption', { class: 'visualmente-oculto' }, 'Contas e caixas da empresa'),
      el('thead', {}, el('tr', {}, ...['Conta', 'Tipo', 'Saldo', 'Situação', 'Ações'].map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', {}, ...linhas))),
    form ? el('h3', {}, 'Nova conta') : null, form);
}

function listaCategorias(tipo) {
  const podeCriar = ctx.pode('financeiro.criar');
  return el('ul', { class: 'lista-simples', id: `categorias-${tipo}` }, ...categorias.filter((c) => c.tipo === tipo).map((c) => el('li', { class: 'linha-item', 'data-categoria': c.id },
    el('span', {}, c.nome, c.sistema ? el('span', { class: 'chip chip--neutro chip--pequeno' }, 'do sistema') : null, c.ativa ? '' : ' · desativada'),
    podeCriar && !c.sistema ? el('span', { class: 'opcoes' },
      botao('Renomear', { 'data-renomear': c.id }, async () => {
        const res = await dialogoFormulario({ id: 'renomear-categoria', titulo: `Renomear ${c.nome}`, rotuloConfirmar: 'Salvar',
          campos: [campoTexto({ nome: 'nome', rotulo: 'Nome', valor: c.nome, obrigatorio: true, max: 60, id: 'renomear-categoria-nome' })],
          validar: (form) => { const d = valores(form); return d.nome?.length >= 2 ? d : (erroNoCampo(form, 'nome', 'Dê um nome (2 a 60 caracteres).') && null); } });
        if (!res) return;
        await executar(`categoria-${c.id}`, null, (k) => alterarCategoria(c.id, { nome: res.nome }, c.versao, k), () => anunciar('sucesso', 'Categoria renomeada.'));
      }),
      botao(c.ativa ? 'Desativar' : 'Reativar', { 'data-ativar-categoria': c.id }, () => executar(`cat-ativa-${c.id}`, null,
        (k) => definirCategoriaAtiva(c.id, !c.ativa, c.versao, k), () => anunciar('sucesso', c.ativa ? 'Categoria desativada.' : 'Categoria reativada.')))) : null)));
}

function secaoCategorias() {
  const form = ctx.pode('financeiro.criar') ? el('form', { id: 'form-nova-categoria', class: 'pilha', novalidate: true },
    el('div', { class: 'grade-filtros' },
      campoSelecao({ nome: 'tipo', rotulo: 'Tipo', opcoes: [['despesa', 'Despesa'], ['receita', 'Receita']], valor: 'despesa', vazio: null, id: 'categoria-tipo' }),
      campoTexto({ nome: 'nome', rotulo: 'Nome', obrigatorio: true, max: 60, id: 'categoria-nome' })),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao', id: 'salvar-categoria' }, 'Criar categoria'))) : null;
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    if (!d.nome || d.nome.length < 2) return erroNoCampo(form, 'nome', 'Dê um nome (2 a 60 caracteres).');
    return executar('nova-categoria', form, (k) => criarCategoria(ctx.id, d, k), () => anunciar('sucesso', 'Categoria criada.'));
  });
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-categorias' }, el('h2', { id: 'titulo-categorias' }, 'Categorias'),
    el('p', { class: 'campo__ajuda' }, 'Transferências entre contas e o dinheiro do proprietário não são categorias: o sistema separa sozinho.'),
    el('div', { class: 'grade-2' }, el('div', { class: 'pilha' }, el('h3', {}, 'Receitas'), listaCategorias('receita')),
      el('div', { class: 'pilha' }, el('h3', {}, 'Despesas'), listaCategorias('despesa'))),
    form);
}

function secaoRecorrencias(lista) {
  const podeCriar = ctx.pode('financeiro.criar');
  const itens = lista.map((r) => el('li', { class: 'cartao pilha', 'data-recorrencia': r.id },
    el('p', {}, el('strong', {}, r.descricao), ` · ${dinheiro(r.valor_centavos)} · ${r.periodicidade === 'mensal' ? 'todo mês' : 'todo ano'} no dia ${r.dia_vencimento}`,
      ` · ${r.categoria}${r.ativa ? '' : ' · pausada'}`),
    el('p', { class: 'campo__ajuda' }, `Desde ${mesPorExtenso(r.inicio)}${r.fim ? ` até ${mesPorExtenso(r.fim)}` : ''}. Contas geradas: ${r.gerados}.`,
      r.previstos.length ? ` Previstas: ${r.previstos.map((p) => `${formatarData(p.vencimento)} (${dinheiro(p.valor_centavos)})`).join(', ')}.` : ''),
    podeCriar ? el('span', { class: 'opcoes' },
      botao('Alterar', { 'data-alterar-recorrencia': r.id }, async () => {
        const res = await dialogoFormulario({ id: 'alterar-recorrencia', titulo: `Alterar ${r.descricao}`, rotuloConfirmar: 'Salvar',
          descricao: ['Vale para as próximas contas geradas. As já geradas não mudam.'],
          campos: [campoTexto({ nome: 'valor', rotulo: 'Valor (R$)', valor: reaisParaCampo(r.valor_centavos), obrigatorio: true, id: 'alterar-recorrencia-valor' }),
            campoTexto({ nome: 'dia', rotulo: 'Dia do vencimento (1 a 31)', valor: String(r.dia_vencimento), obrigatorio: true, id: 'alterar-recorrencia-dia', tipo: 'number' })],
          validar: (form) => {
            const centavos = centavosDoCampo(form, 'valor', erroNoCampo);
            if (centavos === null) return null;
            const dia = Number(valores(form).dia);
            if (!Number.isInteger(dia) || dia < 1 || dia > 31) return erroNoCampo(form, 'dia', 'Escolha um dia de 1 a 31.') && null;
            return { valor_centavos: centavos, dia_vencimento: dia };
          } });
        if (!res) return;
        await executar(`rec-${r.id}`, null, (k) => alterarRecorrencia(r.id, res, r.versao, k), () => anunciar('sucesso', 'Recorrência alterada.'));
      }),
      botao(r.ativa ? 'Pausar' : 'Retomar', { 'data-ativar-recorrencia': r.id }, () => executar(`rec-ativa-${r.id}`, null,
        (k) => definirRecorrenciaAtiva(r.id, !r.ativa, r.versao, k), () => anunciar('sucesso', r.ativa ? 'Recorrência pausada.' : 'Recorrência retomada.')))) : null));
  const form = podeCriar ? el('form', { id: 'form-recorrencia', class: 'pilha', novalidate: true },
    el('div', { class: 'grade-filtros' },
      campoTexto({ nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, max: 120, id: 'rec-descricao', ajuda: 'Ex.: Aluguel, Internet.' }),
      campoTexto({ nome: 'valor', rotulo: 'Valor (R$)', obrigatorio: true, id: 'rec-valor' }),
      campoSelecao({ nome: 'categoria_id', rotulo: 'Categoria', opcoes: opcoesCategorias(categorias, 'despesa'), obrigatorio: true, id: 'rec-categoria' }),
      campoSelecao({ nome: 'periodicidade', rotulo: 'Repete', opcoes: [['mensal', 'Todo mês'], ['anual', 'Todo ano']], valor: 'mensal', vazio: null, id: 'rec-periodicidade' }),
      campoTexto({ nome: 'dia', rotulo: 'Dia do vencimento (1 a 31)', tipo: 'number', obrigatorio: true, id: 'rec-dia', ajuda: 'Se o mês não tiver esse dia, vence no último dia do mês.' }),
      campoTexto({ nome: 'inicio', rotulo: 'A partir de', tipo: 'date', valor: inicioDoMes(dataDeHoje()), id: 'rec-inicio' })),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao', id: 'salvar-recorrencia' }, 'Criar recorrência'))) : null;
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    if (!d.descricao || d.descricao.length < 2) return erroNoCampo(form, 'descricao', 'Descreva a despesa.');
    const centavos = centavosDoCampo(form, 'valor', erroNoCampo);
    if (centavos === null) return null;
    if (!d.categoria_id) return erroNoCampo(form, 'categoria_id', 'Escolha a categoria.');
    const dia = Number(d.dia);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) return erroNoCampo(form, 'dia', 'Escolha um dia de 1 a 31.');
    return executar('nova-recorrencia', form, (k) => criarRecorrencia(ctx.id, { descricao: d.descricao, valor_centavos: centavos, categoria_id: d.categoria_id,
      periodicidade: d.periodicidade, dia_vencimento: dia, inicio: d.inicio || inicioDoMes(dataDeHoje()) }, k), () => anunciar('sucesso', 'Recorrência criada.',
      el('p', {}, 'As contas do mês aparecem quando alguém abre o painel do financeiro.')));
  });
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-recorrencias' }, el('h2', { id: 'titulo-recorrencias' }, 'Despesas recorrentes'),
    el('p', { class: 'campo__ajuda', id: 'aviso-geracao' }, 'As contas de cada mês são geradas quando alguém abre o financeiro, sem duplicar. Não há processamento automático contínuo.'),
    lista.length ? el('ul', { class: 'lista-simples', id: 'lista-recorrencias' }, ...itens) : el('p', { id: 'lista-recorrencias' }, 'Nenhuma despesa recorrente.'),
    form ? el('h3', {}, 'Nova despesa recorrente') : null, form);
}

function secaoConferencia() {
  if (!ehProprietario(ctx)) return null;
  const saida = el('div', { id: 'resultado-conferencia', 'aria-live': 'polite' });
  const b = el('button', { type: 'button', class: 'botao botao--secundario', id: 'conferir-saldos' }, 'Conferir saldos agora');
  b.addEventListener('click', () => ocupado(b, async () => {
    try {
      const r = await reconciliar(ctx.id);
      saida.replaceChildren(r.ok ? aviso('sucesso', 'Tudo confere: cada saldo é a soma dos lançamentos e cada conta bate com os pagamentos registrados.')
        : aviso('erro', 'Encontramos diferenças. Guarde esta tela e avise o suporte do projeto.',
          el('ul', {}, ...r.contas_divergentes.map((c) => el('li', {}, `${c.conta}: saldo ${dinheiro(c.saldo_centavos)}, lançamentos ${dinheiro(c.soma_lancamentos_centavos)}`)),
            ...r.titulos_divergentes.map((t) => el('li', {}, `${t.titulo}: registrado ${dinheiro(t.baixado_centavos)}, soma ${dinheiro(t.soma_baixas_centavos)}`)))));
    } catch (erro) {
      saida.replaceChildren(aviso('erro', erro.message));
    }
  }));
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-conferencia' }, el('h2', { id: 'titulo-conferencia' }, 'Conferência de saldos'),
    el('p', { class: 'campo__ajuda' }, 'Só o proprietário. Confere se nada foi gravado fora das regras.'), b, saida);
}

async function carregar() {
  mostrarCarregando(area, 'Carregando as configurações');
  try {
    ctx = await carregarFinanceiro(area, nav, 'configuracoes');
    if (!ctx) return;
    const [cs, cats, recs] = await Promise.all([lerContas(ctx.id), lerCategorias(ctx.id), lerRecorrencias(ctx.id)]);
    categorias = cats;
    concluirCarregamento(area);
    area.append(...[avisoRegistro(), secaoContas(cs), secaoCategorias(), secaoRecorrencias(recs), secaoConferencia()].filter(Boolean));
  } catch (erro) {
    erroDeCarga(area, erro, tratarErro, carregar);
  }
}

carregar();
