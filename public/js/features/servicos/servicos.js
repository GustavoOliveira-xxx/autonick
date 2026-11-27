/**
 * Serviços oferecidos (M08, RF-084, RF-085, RF-092, RF-093; D8-04, D8-05, D8-08, D8-09, D8-12): cadastro, preço,
 * categoria empresarial opcional, validade padrão, modalidade (análise manual por padrão) e desativação sem apagar.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, erroNoCampo, limparErros, ocupado, valores } from '../../ui/formulario.js';
import { lerValorEmReais } from '../../domain/moeda.js';
import { categorias as lerCategorias } from '../../data/empresas.js';
import { servicosDaEmpresa, criarServico, alterarServico, definirServicoAtivo, POLITICA, MODALIDADE } from '../../data/servicos.js';
import { politicaCancelamento, salvarPolitica } from '../../data/ordens.js';
import { definirVitrineServico } from '../../data/vitrine.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, dinheiro } from './comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let cats = [];
let editando = null;
const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });

function formServico(s = null) {
  const id = s ? `editar-${s.id.slice(0, 8)}` : 'novo-servico';
  const form = el('form', { class: 'pilha cartao', id, novalidate: true },
    el('h2', {}, s ? `Editar ${s.nome}` : 'Novo serviço'),
    campoTexto({ nome: 'nome', rotulo: 'Nome', obrigatorio: true, max: 80, valor: s?.nome, id: `${id}-nome` }),
    campoTexto({ nome: 'descricao', rotulo: 'Descrição', linhas: 3, max: 1000, valor: s?.descricao, id: `${id}-descricao`, ajuda: 'O que está incluído. Até 1.000 caracteres.' }),
    campoSelecao({ nome: 'categoria_id', rotulo: 'Categoria (opcional)', opcoes: cats.map((c) => [c.id, c.nome]), valor: s?.categoria_id ?? '', id: `${id}-categoria`,
      vazio: 'Sem categoria', ajuda: 'Uma das categorias empresariais oficiais. Não precisa ser a da empresa.' }),
    campoSelecao({ nome: 'politica_preco', rotulo: 'Como o preço é informado', obrigatorio: true, opcoes: Object.entries(POLITICA), valor: s?.politica_preco ?? '', id: `${id}-politica` }),
    campoTexto({ nome: 'preco', rotulo: 'Preço (R$)', valor: s?.preco_centavos ? (s.preco_centavos / 100).toFixed(2).replace('.', ',') : '', id: `${id}-preco`,
      ajuda: 'Obrigatório para preço fixo, "a partir de" e pacote. Ignorado em sob consulta.' }),
    campoTexto({ nome: 'duracao_min', rotulo: 'Duração estimada (minutos, opcional)', valor: s?.duracao_min ?? '', id: `${id}-duracao`, ajuda: 'De 15 a 720. Sugere o fim do horário na agenda.' }),
    campoTexto({ nome: 'validade_dias', rotulo: 'Validade do orçamento (dias)', valor: s?.validade_dias ?? 15, id: `${id}-validade`, ajuda: 'De 1 a 90. Vencido, só com nova versão.' }),
    campoSelecao({ nome: 'modalidade', rotulo: 'Confirmação', opcoes: Object.entries(MODALIDADE), valor: s?.modalidade ?? 'analise_manual', vazio: null, id: `${id}-modalidade`,
      ajuda: 'Orçamento automático só para preço por regras: com todas as respostas, a versão 1 é enviada sozinha e o cliente pode aceitar.' }),
    campoSelecao({ nome: 'exibicao', rotulo: 'Mostrar a estimativa como', opcoes: [['valor', 'Valor único'], ['faixa', 'Faixa (para mais e para menos)']], valor: s?.exibicao ?? 'valor', vazio: null, id: `${id}-exibicao` }),
    campoTexto({ nome: 'faixa_percentual', rotulo: 'Faixa (%)', valor: s?.faixa_percentual ?? 0, id: `${id}-faixa`, ajuda: 'De 1% a 50%, só quando mostrar faixa.' }),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao' }, s ? 'Salvar alterações' : 'Cadastrar serviço'),
      s ? el('button', { type: 'button', class: 'botao botao--secundario', 'data-cancelar': '1' }, 'Cancelar') : null));
  form.querySelector('[data-cancelar]')?.addEventListener('click', () => { editando = null; carregar(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    if (!d.nome) return erroNoCampo(form, 'nome', 'Informe o nome.');
    if (!d.politica_preco) return erroNoCampo(form, 'politica_preco', 'Escolha como o preço é informado.');
    const dados = { nome: d.nome, descricao: d.descricao || null, categoria_id: d.categoria_id || null, politica_preco: d.politica_preco,
      modalidade: d.modalidade, exibicao: d.exibicao, faixa_percentual: Number(d.faixa_percentual || 0), validade_dias: Number(d.validade_dias || 15),
      duracao_min: d.duracao_min ? Number(d.duracao_min) : null };
    if (['fixo', 'a_partir_de', 'pacote'].includes(d.politica_preco)) {
      const v = lerValorEmReais(d.preco);
      if (!v.ok) return erroNoCampo(form, 'preco', v.erro);
      dados.preco_centavos = v.centavos;
    }
    const botao = form.querySelector('[type="submit"]');
    return ocupado(botao, () => executar(id, form, (k) => (s ? alterarServico(s.id, dados, s.versao, k) : criarServico(ctx.id, dados, k)),
      (r) => { editando = null; anunciar('sucesso', s ? 'Serviço atualizado.' : `Serviço "${r.nome}" cadastrado.`,
        el('p', {}, el('a', { class: 'botao botao--secundario', href: `/business/servico.html?id=${encodeURIComponent(ctx.id)}&servico=${encodeURIComponent(r.id)}` }, 'Montar o formulário e as regras'))); }));
  });
  return form;
}

function cartao(s) {
  const preco = s.politica_preco === 'sob_consulta' ? 'Sob consulta' : s.politica_preco === 'por_regras' ? 'Calculado por regras' : `${POLITICA[s.politica_preco]}: ${dinheiro(s.preco_centavos)}`;
  const botoes = [el('a', { class: 'botao botao--secundario', href: `/business/servico.html?id=${encodeURIComponent(ctx.id)}&servico=${encodeURIComponent(s.id)}` }, 'Formulário e regras')];
  if (ctx.pode('catalogo_servicos.alterar')) {
    const editar = el('button', { type: 'button', class: 'botao botao--secundario', 'data-editar': s.id }, 'Editar');
    editar.addEventListener('click', () => { editando = s.id; desenhar(); });
    const ativo = el('button', { type: 'button', class: 'botao botao--secundario', 'data-ativo': s.id }, s.ativo ? 'Desativar' : 'Reativar');
    ativo.addEventListener('click', () => ocupado(ativo, () => executar(`ativo-${s.id}`, null, (k) => definirServicoAtivo(s.id, !s.ativo, s.versao, k),
      () => anunciar('sucesso', s.ativo ? 'Serviço desativado. As solicitações abertas continuam.' : 'Serviço reativado.'))));
    botoes.push(editar, ativo);
    // M10 (D10-04 = B): serviço ativo não é público por si; a empresa decide, e nada é publicado sozinho.
    if (ctx.pode('vitrine.alterar') && (s.ativo || s.exibir_na_vitrine)) {
      const vitrine = el('button', { type: 'button', class: 'botao botao--secundario', 'data-vitrine': s.id },
        s.exibir_na_vitrine ? 'Tirar da vitrine' : 'Mostrar na vitrine');
      vitrine.addEventListener('click', () => ocupado(vitrine, () => executar(`vitrine-${s.id}`, null,
        (k) => definirVitrineServico(s.id, !s.exibir_na_vitrine, s.versao, k),
        () => anunciar('sucesso', s.exibir_na_vitrine ? 'Serviço retirado da vitrine. Ele continua disponível para quem já é cliente.' : 'Serviço publicado na vitrine.'))));
      botoes.push(vitrine);
    }
  }
  return el('li', { class: 'cartao pilha', 'data-servico': s.id },
    el('h3', {}, s.nome, s.ativo ? '' : ' (desativado)'),
    el('p', { class: 'opcoes', 'data-situacao-vitrine': s.exibir_na_vitrine ? 'na_vitrine' : 'fora' },
      s.exibir_na_vitrine && s.ativo ? el('span', { class: 'chip chip--sucesso' }, 'Na vitrine') : el('span', { class: 'chip chip--neutro' }, 'Fora da vitrine')),
    el('p', {}, preco, ' · ', MODALIDADE[s.modalidade], s.categoria ? ` · ${s.categoria}` : ''),
    el('p', { class: 'campo__ajuda' }, `${s.perguntas.length} pergunta(s), ${s.regras.length} regra(s), validade de ${s.validade_dias} dia(s), ${s.solicitacoes_abertas} solicitação(ões) aberta(s).`),
    s.modalidade === 'orcamento_automatico' && !s.regras.length ? aviso('alerta', 'Sem regras, o orçamento automático não acontece: tudo vai para análise manual.') : null,
    editando === s.id ? formServico(s) : el('div', { class: 'grupo-botoes' }, ...botoes));
}

// Política de cancelamento (D9-16): texto versionado, mostrado no orçamento e gravado no aceite.
let politica = null;
function secaoPolitica() {
  if (!politica) return null;
  const partes = [politica.ativa ? el('p', { id: 'politica-ativa' }, el('strong', {}, `Versão ${politica.ativa.versao}: `), politica.ativa.texto)
    : el('p', { id: 'politica-ativa' }, 'Sem política: cancelamentos depois do aceite não têm custos a cobrar, salvo condições escritas no próprio orçamento.'),
  el('p', { class: 'campo__ajuda' }, politica.aviso)];
  if (ctx.pode('servicos.cancelar') && ctx.pode('orcamentos.aprovar')) {
    const salvar = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Salvar nova versão');
    const form = el('form', { class: 'pilha', id: 'form-politica', novalidate: true },
      campoTexto({ nome: 'texto', rotulo: 'Texto da política', linhas: 4, max: 2000, valor: politica.ativa?.texto ?? '', id: 'politica-texto',
        ajuda: 'De 20 a 2.000 caracteres, sem contato. Só custos efetivamente incorridos e demonstrados; nada de multa percentual. Deixe vazio para retirar a política.' }),
      el('div', { class: 'grupo-botoes' }, salvar));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const t = (valores(form).texto ?? '').trim();
      if (t && t.length < 20) return erroNoCampo(form, 'texto', 'Use de 20 a 2.000 caracteres, ou deixe vazio para retirar.');
      return ocupado(salvar, () => executar('politica', form, (k) => salvarPolitica(ctx.id, t, k), (r) => anunciar('sucesso', r.ativa ? `Política salva (versão ${r.versao}). Vale para os próximos aceites.` : 'Política retirada.')));
    });
    partes.push(form);
  }
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-politica' }, el('h2', { id: 'titulo-politica' }, 'Política de cancelamento'), ...partes);
}

let lista = [];
function desenhar() {
  area.replaceChildren(...[
    ctx.pode('catalogo_servicos.alterar') && !editando ? formServico() : null,
    secaoPolitica(),
    el('section', { class: 'pilha', 'aria-labelledby': 'titulo-lista' }, el('h2', { id: 'titulo-lista' }, 'Serviços cadastrados'),
      lista.length ? el('ul', { class: 'pilha', id: 'lista-servicos' }, ...lista.map(cartao)) : el('p', { id: 'lista-servicos' }, 'Nenhum serviço cadastrado ainda.'))].filter(Boolean));
}

async function carregar() {
  mostrarCarregando(area, 'Carregando os serviços');
  try {
    ctx = ctx ?? await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'servicos'));
    if (!ctx.pode('catalogo_servicos.visualizar')) {
      area.replaceChildren(aviso('erro', 'Seu perfil não inclui ver os serviços desta empresa.'));
      return;
    }
    [lista, cats, politica] = await Promise.all([servicosDaEmpresa(ctx.id), cats.length ? cats : lerCategorias().catch(() => []),
      ctx.pode('orcamentos.visualizar') ? politicaCancelamento(ctx.id).catch(() => null) : null]);
    concluirCarregamento(area);
    desenhar();
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

carregar();
