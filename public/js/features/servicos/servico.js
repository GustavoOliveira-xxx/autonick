/**
 * Formulário e regras de um serviço (M08, RF-087, RF-088; D8-06, D8-07, D8-08): até 15 perguntas de tipos fechados,
 * regras fixas (valor base, por quantidade, por opção, adicional se sim, mínimo) e simulação da estimativa pelo banco.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, erroNoCampo, limparErros, ocupado, valores } from '../../ui/formulario.js';
import { lerValorEmReais } from '../../domain/moeda.js';
import { lerOpcoes, lerRespostas } from '../../domain/servicos.js';
import { servicosDaEmpresa, salvarFormulario, salvarRegras, estimar, TIPO_PERGUNTA, TIPO_REGRA, POLITICA } from '../../data/servicos.js';
import { salvarItensPacote } from '../../data/ordens.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, camposDoFormulario, blocoEstimativa } from './comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
const servicoId = parametro('servico');
let ctx = null;
let s = null;
let rascunho = [];
let regras = [];
const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });
const centavosParaTexto = (c) => (Number.isSafeInteger(c) ? (c / 100).toFixed(2).replace('.', ',') : '');

function linhaPergunta(p, i) {
  const id = `perg-${i}`;
  const linha = el('fieldset', { class: 'cartao pilha', 'data-pergunta': i },
    el('legend', {}, `Pergunta ${i + 1}`),
    campoTexto({ nome: `${id}-texto`, rotulo: 'Texto da pergunta', obrigatorio: true, max: 200, valor: p.texto, id: `${id}-texto`,
      ajuda: 'Pergunte só o necessário. Documentos (CPF, RG), cartão e senha são recusados.' }),
    campoSelecao({ nome: `${id}-tipo`, rotulo: 'Tipo de resposta', opcoes: Object.entries(TIPO_PERGUNTA), valor: p.tipo, vazio: null, id: `${id}-tipo` }),
    campoTexto({ nome: `${id}-opcoes`, rotulo: 'Opções (uma por linha)', linhas: 3, valor: (p.configuracao?.opcoes ?? []).join('\n'), id: `${id}-opcoes`,
      ajuda: 'Só para escolha única ou múltipla: de 2 a 10 opções.' }),
    campoTexto({ nome: `${id}-unidade`, rotulo: 'Unidade (só número)', max: 20, valor: p.configuracao?.unidade ?? '', id: `${id}-unidade` }),
    campoTexto({ nome: `${id}-minimo`, rotulo: 'Mínimo (só número)', valor: p.configuracao?.minimo ?? '', id: `${id}-minimo` }),
    campoTexto({ nome: `${id}-maximo`, rotulo: 'Máximo (só número)', valor: p.configuracao?.maximo ?? '', id: `${id}-maximo` }),
    el('div', { class: 'opcao' }, el('input', { type: 'checkbox', id: `${id}-obrigatoria`, name: `${id}-obrigatoria`, checked: Boolean(p.obrigatoria) }),
      el('label', { for: `${id}-obrigatoria` }, 'Resposta obrigatória')));
  const remover = el('button', { type: 'button', class: 'botao botao--secundario', 'data-remover': i }, `Remover pergunta ${i + 1}`);
  remover.addEventListener('click', () => { lerFormulario(); rascunho.splice(i, 1); desenhar(); });
  linha.append(remover);
  return linha;
}

function lerFormulario() {
  const form = document.getElementById('form-perguntas');
  if (!form) return;
  const d = valores(form);
  rascunho = rascunho.map((p, i) => {
    const id = `perg-${i}`;
    const tipo = d[`${id}-tipo`];
    const configuracao = {};
    if (['escolha_unica', 'escolha_multipla'].includes(tipo)) configuracao.opcoes = lerOpcoes(d[`${id}-opcoes`]);
    if (tipo === 'numero') {
      if (d[`${id}-unidade`]) configuracao.unidade = d[`${id}-unidade`];
      if (d[`${id}-minimo`] !== '') configuracao.minimo = Number(String(d[`${id}-minimo`]).replace(',', '.'));
      if (d[`${id}-maximo`] !== '') configuracao.maximo = Number(String(d[`${id}-maximo`]).replace(',', '.'));
      configuracao.casas = 2;
    }
    return { ...(p.id ? { id: p.id } : {}), texto: d[`${id}-texto`], tipo, obrigatoria: Boolean(d[`${id}-obrigatoria`]), configuracao };
  });
}

function secaoPerguntas() {
  const pode = ctx.pode('catalogo_servicos.alterar');
  const form = el('form', { class: 'pilha', id: 'form-perguntas', novalidate: true }, ...rascunho.map(linhaPergunta));
  if (pode) {
    const adicionar = el('button', { type: 'button', class: 'botao botao--secundario', id: 'adicionar-pergunta' }, 'Adicionar pergunta');
    adicionar.disabled = rascunho.length >= 15;
    adicionar.addEventListener('click', () => { lerFormulario(); rascunho.push({ texto: '', tipo: 'texto_curto', obrigatoria: false, configuracao: {} }); desenhar(); });
    const salvar = el('button', { type: 'submit', class: 'botao' }, 'Salvar formulário');
    form.append(el('div', { class: 'grupo-botoes' }, adicionar, salvar));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      lerFormulario();
      const vazia = rascunho.findIndex((p) => !p.texto);
      if (vazia >= 0) return erroNoCampo(form, `perg-${vazia}-texto`, 'Escreva a pergunta.');
      return ocupado(salvar, () => executar('formulario', form, (k) => salvarFormulario(s.id, rascunho, s.versao, k),
        (r) => anunciar('sucesso', 'Formulário salvo.', r.regras_desativadas ? el('p', {}, `${r.regras_desativadas} regra(s) deixaram de valer porque a pergunta mudou ou saiu.`) : null)));
    });
  }
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-perguntas' }, el('h2', { id: 'titulo-perguntas' }, `Perguntas (${rascunho.length} de 15)`),
    rascunho.length ? null : el('p', {}, 'Sem perguntas: o cliente só escreve o relato.'), form);
}

function linhaRegra(r, i) {
  const id = `regra-${i}`;
  const perguntas = s.perguntas.filter((p) => (r.tipo === 'por_quantidade' ? p.tipo === 'numero' : r.tipo === 'se_sim' ? p.tipo === 'sim_nao'
    : ['escolha_unica', 'escolha_multipla'].includes(p.tipo)));
  const pergunta = s.perguntas.find((p) => p.id === r.pergunta_id);
  const campos = [
    campoSelecao({ nome: `${id}-tipo`, rotulo: 'Tipo de regra', opcoes: Object.entries(TIPO_REGRA), valor: r.tipo, vazio: null, id: `${id}-tipo` }),
    campoTexto({ nome: `${id}-rotulo`, rotulo: 'Nome mostrado ao cliente', obrigatorio: true, max: 80, valor: r.rotulo, id: `${id}-rotulo` }),
  ];
  if (['por_quantidade', 'por_opcao', 'se_sim'].includes(r.tipo)) {
    campos.push(campoSelecao({ nome: `${id}-pergunta`, rotulo: 'Pergunta usada', opcoes: perguntas.map((p) => [p.id, p.texto]), valor: r.pergunta_id ?? '', id: `${id}-pergunta` }));
  }
  if (r.tipo === 'por_quantidade') {
    campos.push(campoTexto({ nome: `${id}-valor`, rotulo: 'Valor por unidade (R$)', valor: centavosParaTexto(r.parametros?.valor_unitario_centavos), id: `${id}-valor` }));
  } else if (r.tipo === 'por_opcao') {
    for (const o of pergunta?.configuracao?.opcoes ?? []) {
      campos.push(campoTexto({ nome: `${id}-op-${o}`, rotulo: `Adicional para "${o}" (R$)`, valor: centavosParaTexto(r.parametros?.valores?.[o] ?? 0), id: `${id}-op-${encodeURIComponent(o)}` }));
    }
  } else {
    campos.push(campoTexto({ nome: `${id}-valor`, rotulo: 'Valor (R$)', valor: centavosParaTexto(r.parametros?.valor_centavos), id: `${id}-valor` }));
  }
  const remover = el('button', { type: 'button', class: 'botao botao--secundario', 'data-remover-regra': i }, `Remover regra ${i + 1}`);
  remover.addEventListener('click', () => { lerRegras(); regras.splice(i, 1); desenhar(); });
  const fs = el('fieldset', { class: 'cartao pilha', 'data-regra': i }, el('legend', {}, `Regra ${i + 1}`), ...campos, remover);
  fs.querySelector(`[name="${id}-tipo"]`).addEventListener('change', () => { lerRegras(); desenhar(); });
  fs.querySelector(`[name="${id}-pergunta"]`)?.addEventListener('change', () => { lerRegras(); desenhar(); });
  return fs;
}

function lerRegras(validar = false) {
  const form = document.getElementById('form-regras');
  if (!form) return true;
  const d = valores(form);
  const lido = [];
  for (let i = 0; i < regras.length; i += 1) {
    const id = `regra-${i}`;
    const tipo = d[`${id}-tipo`];
    const r = { tipo, rotulo: d[`${id}-rotulo`], ...(d[`${id}-pergunta`] ? { pergunta_id: d[`${id}-pergunta`] } : {}), parametros: {} };
    const valor = (texto) => { const v = lerValorEmReais(texto || '0'); return v.ok ? v.centavos : null; };
    if (tipo === 'por_quantidade') r.valor_unitario_centavos = valor(d[`${id}-valor`]);
    else if (tipo === 'por_opcao') {
      const p = s.perguntas.find((x) => x.id === r.pergunta_id);
      r.valores = Object.fromEntries((p?.configuracao?.opcoes ?? []).map((o) => [o, valor(d[`${id}-op-${o}`])]));
    } else r.valor_centavos = valor(d[`${id}-valor`]);
    if (validar && [r.valor_centavos, r.valor_unitario_centavos, ...Object.values(r.valores ?? {})].some((x) => x === null)) {
      erroNoCampo(form, `${id}-valor`, 'Valor inválido.');
      return false;
    }
    r.parametros = { valor_centavos: r.valor_centavos, valor_unitario_centavos: r.valor_unitario_centavos, valores: r.valores };
    lido.push(r);
  }
  regras = lido;
  return true;
}

function secaoRegras() {
  if (s.politica_preco !== 'por_regras') {
    return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-regras' }, el('h2', { id: 'titulo-regras' }, 'Regras de estimativa'),
      el('p', {}, `O preço deste serviço é "${POLITICA[s.politica_preco]}". Regras só valem para preço calculado por regras.`));
  }
  const form = el('form', { class: 'pilha', id: 'form-regras', novalidate: true }, ...regras.map(linhaRegra));
  if (ctx.pode('catalogo_servicos.alterar')) {
    const adicionar = el('button', { type: 'button', class: 'botao botao--secundario', id: 'adicionar-regra' }, 'Adicionar regra');
    adicionar.addEventListener('click', () => { lerRegras(); regras.push({ tipo: 'valor_base', rotulo: 'Valor base', parametros: {} }); desenhar(); });
    const salvar = el('button', { type: 'submit', class: 'botao' }, 'Salvar regras');
    form.append(el('div', { class: 'grupo-botoes' }, adicionar, salvar));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      if (!lerRegras(true)) return null;
      const envio = regras.map(({ parametros, ...r }) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)));
      return ocupado(salvar, () => executar('regras', form, (k) => salvarRegras(s.id, envio, s.versao, k), () => anunciar('sucesso', 'Regras salvas.')));
    });
  }
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-regras' }, el('h2', { id: 'titulo-regras' }, 'Regras de estimativa'),
    el('p', { class: 'campo__ajuda' }, 'Os valores são somados em ordem; o mínimo vale no fim. Faltando uma resposta usada por uma regra, a solicitação vai para análise manual.'), form);
}

function secaoSimulacao() {
  const resultado = el('div', { id: 'resultado-simulacao' });
  const botao = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Simular estimativa');
  const form = el('form', { class: 'pilha', id: 'form-simulacao', novalidate: true }, ...camposDoFormulario(s.perguntas, 'sim'), el('div', { class: 'grupo-botoes' }, botao), resultado);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const { respostas, erros } = lerRespostas(s.perguntas.map((p) => ({ ...p, obrigatoria: false })), valores(form));
    if (erros.length) return erroNoCampo(form, erros[0].nome, erros[0].mensagem);
    return ocupado(botao, async () => {
      try {
        resultado.replaceChildren(blocoEstimativa(await estimar(s.id, respostas), 'estimativa-simulada'));
      } catch (erro) {
        if (erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, `p-${erro.campo}`, erro.message)) return;
        anunciar('erro', erro.message);
      }
    });
  });
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-simulacao' }, el('h2', { id: 'titulo-simulacao' }, 'Simular como o cliente vê'),
    el('p', { class: 'campo__ajuda' }, 'O cálculo é feito pelo banco com as regras salvas, sempre com o mesmo resultado para as mesmas respostas.'), form);
}

// Pacote (D9-22): 2 a 10 serviços ativos da empresa, preço fechado; os incluídos não somam valor.
let todos = [];
function secaoPacote() {
  if (s.politica_preco !== 'pacote') return null;
  const candidatos = todos.filter((x) => x.id !== s.id && x.ativo && x.politica_preco !== 'pacote');
  const marcados = new Set((s.itens_pacote ?? []).map((i) => i.servico_id));
  const partes = [el('p', { class: 'campo__ajuda' }, 'O cliente vê o pacote como um serviço com preço fechado. Os serviços incluídos aparecem sem valor próprio, para nada ser contado em dobro.')];
  if (!ctx.pode('catalogo_servicos.alterar')) {
    partes.push(el('ul', { id: 'itens-pacote' }, ...(s.itens_pacote ?? []).map((i) => el('li', {}, i.nome))));
  } else {
    const salvar = el('button', { type: 'submit', class: 'botao' }, 'Salvar serviços do pacote');
    const form = el('form', { class: 'pilha', id: 'form-pacote', novalidate: true },
      el('fieldset', { class: 'pilha' }, el('legend', {}, 'Serviços incluídos (de 2 a 10)'),
        ...candidatos.map((x) => el('div', { class: 'opcao' }, el('input', { type: 'checkbox', id: `pacote-${x.id}`, name: 'item', value: x.id, checked: marcados.has(x.id) || null }),
          el('label', { for: `pacote-${x.id}` }, x.nome))),
        el('span', { class: 'campo__erro', 'data-grupo': 'item' })),
      el('div', { class: 'grupo-botoes' }, salvar));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const itens = [...form.querySelectorAll('input[name="item"]:checked')].map((i) => i.value);
      if (itens.length < 2 || itens.length > 10) return erroNoCampo(form, 'item', 'Escolha de 2 a 10 serviços.');
      return ocupado(salvar, () => executar('pacote', form, (k) => salvarItensPacote(s.id, itens, s.versao, k), () => anunciar('sucesso', 'Serviços do pacote salvos.')));
    });
    partes.push(candidatos.length >= 2 ? form : aviso('alerta', 'Cadastre ao menos dois outros serviços ativos para montar o pacote.'));
  }
  if ((s.itens_pacote ?? []).length < 2) partes.unshift(aviso('alerta', 'Sem os serviços incluídos, o pacote não recebe pedidos.'));
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-pacote' }, el('h2', { id: 'titulo-pacote' }, 'Serviços do pacote'), ...partes);
}

function desenhar() {
  area.replaceChildren(el('p', {}, el('a', { href: `/business/servicos.html?id=${encodeURIComponent(ctx.id)}` }, 'Voltar aos serviços')),
    el('h2', { id: 'nome-servico' }, s.nome), secaoPacote() ?? el('span'), secaoPerguntas(), secaoRegras(), secaoSimulacao());
}

async function carregar() {
  mostrarCarregando(area, 'Carregando o serviço');
  try {
    ctx = ctx ?? await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'servicos'));
    if (!ctx.pode('catalogo_servicos.visualizar')) {
      area.replaceChildren(aviso('erro', 'Seu perfil não inclui ver os serviços desta empresa.'));
      return;
    }
    todos = await servicosDaEmpresa(ctx.id);
    s = todos.find((x) => x.id === servicoId);
    concluirCarregamento(area);
    if (!s) {
      area.replaceChildren(aviso('info', 'Serviço não encontrado.'));
      return;
    }
    document.getElementById('titulo-pagina').textContent = `Formulário e regras: ${s.nome}`;
    rascunho = s.perguntas.map((p) => ({ ...p }));
    regras = s.regras.map((r) => ({ ...r }));
    desenhar();
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

carregar();
