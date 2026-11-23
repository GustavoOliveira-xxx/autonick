/**
 * Telas da vitrine do M10 (UI-002, UI-004, UI-005, UI-006): busca em lista e perfil da empresa.
 *
 * Duas superfícies com o MESMO desenho e conjuntos de dados diferentes, escolhidos pelo arquivo de entrada de cada
 * página e nunca por parâmetro de URL (D10-14):
 *   - `publico`: rota pública (`/cliente/`, `/cliente/empresa.html`), papel `anonymous` no banco; nunca dado fictício.
 *   - `demonstracao`: área separada (`/cliente/demonstracao*.html`), só para conta fictícia autorizada, com a faixa.
 * Sem mapa e sem GPS (D10-09, D10-10): a localização é a cidade e o bairro escolhidos pela pessoa.
 * Quem decide o que aparece é o banco; a tela só desenha.
 */
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { formatarCentavos } from '../../domain/moeda.js';
import { entrarEVoltar } from '../../domain/retorno.js';
import { neon } from '../../data/sessao.js';
import { blocoAvaliacoesVitrine } from '../comunicacao/avaliacao.js';
import { botaoDenunciar } from '../comunicacao/moderacao.js';
import {
  filtrosVitrine, buscarVitrine, vitrinePublica, filtrosDemonstracao, buscarDemonstracao, vitrineDemonstracao,
  minhaAutorizacaoDemonstracao, POLITICA_VITRINE, MODALIDADE, FAIXA,
} from '../../data/vitrine.js';

const MODOS = {
  publico: { filtros: filtrosVitrine, buscar: buscarVitrine, perfil: vitrinePublica, busca: '/cliente/', empresa: '/cliente/empresa.html' },
  demonstracao: { filtros: filtrosDemonstracao, buscar: buscarDemonstracao, perfil: vitrineDemonstracao,
    busca: '/cliente/demonstracao.html', empresa: '/cliente/demonstracao-empresa.html' },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVES = ['termo', 'tipo', 'categoria_id', 'categoria_produto_id', 'cidade', 'bairro', 'modalidade', 'ampliar'];

export const indisponivel = () => aviso('info', 'Esta área ainda não está disponível nesta versão.',
  el('p', {}, 'Ela funciona no ambiente de desenvolvimento conectado ao banco de dados.'));

export function monograma(nome, categoria, grande = false) {
  const n = [...(categoria ?? '')].reduce((t, c) => t + c.codePointAt(0), 0) % 4;
  return el('span', { class: `monograma monograma--${n}${grande ? ' monograma--grande' : ''}`, 'aria-hidden': 'true' },
    (nome ?? '?').trim().charAt(0).toLocaleUpperCase('pt-BR'));
}

const faixaDemonstracao = () => el('p', { class: 'chip chip--alerta chip--quebra', 'data-demonstracao': '' }, el('span', { 'aria-hidden': 'true' }, '!'),
  'DEMONSTRAÇÃO: empresas e dados fictícios');

export function precoServico(s) {
  switch (s.politica_preco) {
    case 'fixo': return formatarCentavos(s.preco_centavos);
    case 'a_partir_de': return `A partir de ${formatarCentavos(s.preco_centavos)}`;
    case 'pacote': return `Pacote: ${formatarCentavos(s.preco_centavos)}`;
    case 'sob_consulta': return 'Sob consulta';
    default: return 'Estimativa ao responder o formulário (não é o valor final)';
  }
}

// --- Área de demonstração: confere a autorização antes de qualquer leitura (o banco confere de novo) ------------------
async function exigirDemonstracao(area) {
  if (!(await neon.temSessao())) {
    area.replaceChildren(aviso('info', 'A área de demonstração é só para contas de demonstração autorizadas.',
      el('p', {}, el('a', { href: entrarEVoltar(location.pathname + location.search) }, 'Entrar com a conta de demonstração'))));
    return false;
  }
  const a = await minhaAutorizacaoDemonstracao();
  if (!a.autorizada) {
    area.replaceChildren(aviso('alerta', 'Área disponível só para contas de demonstração autorizadas.',
      el('p', {}, 'Esta conta não tem autorização válida. A autorização é dada pela equipe do projeto e vale por até 30 dias.')));
    return false;
  }
  return a;
}

// --- Busca ---------------------------------------------------------------------
function lerUrl() {
  const u = new URLSearchParams(location.search);
  const f = {};
  for (const c of CHAVES) if (u.get(c)) f[c] = u.get(c);
  return { filtros: f, pagina: Math.min(Math.max(Number(u.get('pagina')) || 1, 1), 5) };
}
function gravarUrl(filtros, pagina) {
  const u = new URLSearchParams();
  for (const c of CHAVES) if (filtros[c]) u.set(c, filtros[c]);
  if (pagina > 1) u.set('pagina', String(pagina));
  history.replaceState(null, '', `${location.pathname}${u.size ? `?${u}` : ''}`);
}

function cartaoResultado(i, modo) {
  const href = `${MODOS[modo].empresa}?e=${encodeURIComponent(i.empresa_id)}`;
  const achados = i.itens_que_casaram.length
    ? el('p', {}, 'Encontrado em: ', i.itens_que_casaram.map((x) => `${x.tipo === 'servico' ? 'serviço' : 'produto'} "${x.nome}"`).join('; '), '.') : null;
  return el('li', { class: 'cartao cartao-vitrine', 'data-empresa': i.empresa_id },
    monograma(i.nome_publico, i.categoria),
    el('div', { class: 'pilha' },
      el('h3', { class: 'cartao__titulo' }, el('a', { href }, i.nome_publico)),
      el('p', { class: 'cartao__meta' }, `${i.categoria ?? 'Sem categoria'} · ${i.bairro ? `${i.bairro}, ` : ''}${i.cidade} · ${MODALIDADE[i.modalidade] ?? i.modalidade}`),
      achados,
      el('p', { class: 'opcoes' }, el('span', { class: 'chip chip--sucesso' }, el('span', { 'aria-hidden': 'true' }, '✓'), i.selo),
        modo === 'demonstracao' ? el('span', { class: 'chip chip--alerta' }, 'Demonstração') : null)));
}

export async function iniciarBusca(modo) {
  const M = MODOS[modo];
  const form = document.getElementById('form-busca');
  const resultados = document.getElementById('resultados');
  const contagem = document.getElementById('contagem');
  const ordem = document.getElementById('ordem');
  if (!neon.configurado) { form.hidden = true; resultados.replaceChildren(indisponivel()); return; }
  if (modo === 'demonstracao') {
    const ok = await exigirDemonstracao(resultados);
    if (!ok) { form.hidden = true; return; }
    document.getElementById('validade-demonstracao')?.replaceChildren(
      `Autorização válida até ${new Date(ok.expira_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`);
  }
  let estado = lerUrl();
  let opcoes;
  try {
    opcoes = await M.filtros();
  } catch (erro) {
    tratarErro(resultados, erro, () => iniciarBusca(modo));
    return;
  }
  const encher = (sel, lista, todos) => sel.replaceChildren(el('option', { value: '' }, todos), ...lista.map((o) => el('option', { value: o.id ?? o.nome }, o.nome)));
  encher(form.categoria_id, opcoes.categorias_negocio, 'Todas');
  encher(form.categoria_produto_id, opcoes.categorias_produto, 'Todas');
  encher(form.cidade, opcoes.cidades, 'Todas as cidades');
  const bairros = document.getElementById('lista-bairros');
  const atualizarBairros = () => bairros.replaceChildren(...opcoes.bairros
    .filter((b) => b.cidade.localeCompare(form.cidade.value, 'pt-BR', { sensitivity: 'base' }) === 0).map((b) => el('option', { value: b.nome })));
  for (const c of ['termo', 'tipo', 'categoria_id', 'categoria_produto_id', 'cidade', 'bairro', 'modalidade']) {
    if (estado.filtros[c] !== undefined) form[c].value = estado.filtros[c];
  }
  atualizarBairros();
  form.cidade.addEventListener('change', () => { atualizarBairros(); if (!form.cidade.value) form.bairro.value = ''; });

  const erroBairro = document.getElementById('bairro-erro');
  async function pesquisar() {
    gravarUrl(estado.filtros, estado.pagina);
    mostrarCarregando(resultados, 'Buscando estabelecimentos');
    contagem.textContent = 'Buscando…';
    ordem.textContent = '';
    try {
      const r = await M.buscar(estado.filtros, estado.pagina);
      concluirCarregamento(resultados);
      ordem.textContent = r.ordem;
      contagem.textContent = r.total === 0 ? 'Nenhum resultado.'
        : r.mais_de_100 ? 'Mais de 100 estabelecimentos encontrados. Refine a busca.'
          : r.total === 1 ? '1 estabelecimento encontrado.' : `${r.total} estabelecimentos encontrados.`;
      const partes = [];
      if (modo === 'demonstracao') partes.push(faixaDemonstracao());
      if (!r.itens.length) {
        partes.push(el('div', { class: 'estado-vazio' }, el('h3', {}, 'Nenhum estabelecimento com estes filtros.'),
          el('p', {}, estado.filtros.cidade ? 'Você pode ampliar a região ou mudar a busca.' : 'Tente outra palavra ou remova algum filtro.')));
      } else if (estado.filtros.ampliar) {
        // Depois da ação explícita, as faixas aparecem com títulos (nunca como distância).
        for (const faixa of ['mesmo_bairro', 'mesma_cidade', 'outros']) {
          const grupo = r.itens.filter((i) => i.faixa === faixa);
          if (grupo.length) {
            partes.push(el('section', { class: 'pilha faixa-resultados', 'data-faixa': faixa, 'aria-label': FAIXA[faixa] },
              el('h3', {}, faixa === 'mesmo_bairro' ? `${FAIXA[faixa]} (${estado.filtros.bairro})` : faixa === 'mesma_cidade' ? `${FAIXA[faixa]} (${estado.filtros.cidade})` : FAIXA[faixa]),
              el('ul', { role: 'list', class: 'resultados' }, grupo.map((i) => cartaoResultado(i, modo)))));
          }
        }
      } else {
        partes.push(el('ul', { role: 'list', class: 'resultados', id: 'lista-resultados' }, r.itens.map((i) => cartaoResultado(i, modo))));
      }
      partes.push(acoesAmpliar(r));
      resultados.replaceChildren(...partes.filter(Boolean));
    } catch (erro) {
      contagem.textContent = '';
      if (erro.codigo === 'VALIDATION_ERROR' && erro.campo === 'bairro') { erroBairro.textContent = erro.message; form.bairro.focus(); }
      tratarErro(resultados, erro, pesquisar);
    }
  }

  function botao(texto, aoClicar, dado) {
    const b = el('button', { type: 'button', class: 'botao botao--secundario', 'data-acao': dado }, texto);
    b.addEventListener('click', aoClicar);
    return b;
  }
  function acoesAmpliar(r) {
    const f = estado.filtros;
    const ir = (mudanca, pagina = 1) => { estado = { filtros: { ...f, ...mudanca }, pagina }; for (const k of Object.keys(estado.filtros)) if (estado.filtros[k] === null) delete estado.filtros[k]; return pesquisar(); };
    const acoes = [];
    if (f.cidade && f.bairro && !f.ampliar) acoes.push(botao(`Ver também outros bairros de ${f.cidade}`, () => ir({ ampliar: 'bairro' }), 'ampliar-bairro'));
    if (f.cidade && f.ampliar !== 'cidade') acoes.push(botao('Ver também outras cidades', () => ir({ ampliar: 'cidade' }), 'ampliar-cidade'));
    if (f.ampliar) acoes.push(botao(`Voltar só para ${f.bairro ?? f.cidade}`, () => ir({ ampliar: null }), 'voltar-filtro'));
    if (estado.pagina > 1) acoes.push(botao('Página anterior', () => ir({}, estado.pagina - 1), 'pagina-anterior'));
    if (r.ha_mais) acoes.push(botao('Próxima página', () => ir({}, estado.pagina + 1), 'pagina-seguinte'));
    if (Object.keys(f).length) acoes.push(botao('Limpar filtros', () => { form.reset(); atualizarBairros(); estado = { filtros: {}, pagina: 1 }; return pesquisar(); }, 'limpar'));
    const extra = estado.pagina === 5 && (r.total > 100 || r.mais_de_100) ? el('p', { class: 'campo__ajuda' }, 'Mostramos até 5 páginas por busca. Refine a busca para ver outros resultados.') : null;
    return acoes.length || extra ? el('div', { class: 'pilha' }, el('div', { class: 'paginacao' }, ...acoes), extra) : null;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    erroBairro.textContent = '';
    form.bairro.removeAttribute('aria-invalid');
    const d = Object.fromEntries(new FormData(form));
    if (d.bairro?.trim() && !d.cidade) {
      erroBairro.textContent = 'Escolha a cidade antes do bairro.';
      form.bairro.setAttribute('aria-invalid', 'true');
      form.bairro.focus();
      return;
    }
    const filtros = {};
    for (const c of CHAVES) if (d[c]?.trim()) filtros[c] = d[c].trim();
    if (filtros.tipo === 'tudo') delete filtros.tipo;
    estado = { filtros, pagina: 1 };
    pesquisar();
  });
  pesquisar();
}

// --- Perfil --------------------------------------------------------------------
export async function iniciarPerfil(modo) {
  const M = MODOS[modo];
  const area = document.getElementById('vitrine');
  const titulo = document.getElementById('titulo-vitrine');
  const voltar = document.getElementById('voltar-busca');
  if (voltar) voltar.href = M.busca;
  if (!neon.configurado) { titulo.textContent = 'Vitrine'; area.replaceChildren(indisponivel()); return; }
  if (modo === 'demonstracao' && !(await exigirDemonstracao(area))) { titulo.textContent = 'Área de demonstração'; return; }
  const id = parametro('e');
  const naoDisponivel = () => {
    titulo.textContent = 'Vitrine indisponível';
    area.replaceChildren(aviso('info', 'Esta vitrine não está disponível.', el('p', {}, el('a', { href: M.busca }, 'Voltar para a busca'))));
  };
  if (!id || !UUID.test(id)) { naoDisponivel(); return; }
  mostrarCarregando(area, 'Carregando a vitrine');
  let v;
  let logado;
  try {
    [v, logado] = await Promise.all([M.perfil(id), neon.temSessao()]);
  } catch (erro) {
    if (erro.codigo === 'NOT_FOUND') { naoDisponivel(); return; }
    titulo.textContent = 'Vitrine';
    tratarErro(area, erro, () => iniciarPerfil(modo));
    return;
  }
  concluirCarregamento(area);
  const e = v.empresa;
  titulo.textContent = e.nome_publico;
  document.title = `${e.nome_publico} | AutoniCK`;
  // A origem só serve para o link de volta; o banco decide o que pode ser pedido (D11-01, D11-08).
  const origem = modo === 'demonstracao' ? '&origem=demonstracao' : '';
  const destino = (caminho) => (logado ? `${caminho}${origem}` : entrarEVoltar(`${caminho}${origem}`));
  const linkOrcamento = (s) => el('a', { class: 'botao', href: destino(`/cliente/servicos.html?empresa=${encodeURIComponent(e.id)}&servico=${encodeURIComponent(s.id)}`),
    'data-orcamento': s.id }, logado ? 'Pedir orçamento' : 'Entrar para pedir orçamento');
  // D11-05: "Pedir" em cada produto elegível, sem prometer estoque nem pagamento.
  const linkPedir = (p) => el('a', { class: 'botao botao--secundario', href: destino(`/cliente/pedidos.html?empresa=${encodeURIComponent(e.id)}&produto=${encodeURIComponent(p.id)}`),
    'data-pedir': p.id, 'aria-label': `${logado ? 'Pedir' : 'Entrar para pedir'} ${p.nome}` }, logado ? 'Pedir' : 'Entrar para pedir');
  const partes = [];
  if (modo === 'demonstracao') partes.push(faixaDemonstracao());
  partes.push(el('div', { class: 'cartao-vitrine' }, monograma(e.nome_publico, e.categoria, true),
    el('div', { class: 'pilha' },
      el('p', {}, el('span', { class: 'chip chip--sucesso' }, el('span', { 'aria-hidden': 'true' }, '✓'), e.selo)),
      el('p', { class: 'texto-suave' }, 'O selo indica que a CK revisou o cadastro para publicação. Não é verificação de CNPJ nem garantia comercial.'),
      e.descricao_publica ? el('p', {}, e.descricao_publica) : null,
      el('dl', { class: 'dados' },
        el('dt', {}, 'Categoria'), el('dd', {}, e.categoria ?? 'Sem categoria'),
        el('dt', {}, 'Atendimento'), el('dd', {}, MODALIDADE[e.modalidade] ?? e.modalidade),
        el('dt', {}, 'Região'), el('dd', {}, `${e.bairro ? `${e.bairro}, ` : ''}${e.cidade} (${e.uf})`),
        e.area_atendimento ? el('dt', {}, 'Área de atendimento') : null, e.area_atendimento ? el('dd', {}, e.area_atendimento) : null,
        e.horario_funcionamento ? el('dt', {}, 'Horário') : null, e.horario_funcionamento ? el('dd', {}, e.horario_funcionamento) : null))));
  // D10-20 (restritivo): só os contatos que a empresa divulga, e só para quem está logado.
  if (v.contatos && Object.keys(v.contatos).length) {
    partes.push(el('section', { class: 'pilha', 'aria-labelledby': 'titulo-contatos', id: 'contatos' }, el('h2', { id: 'titulo-contatos' }, 'Contatos divulgados pela empresa'),
      el('dl', { class: 'dados' },
        v.contatos.telefone_publico ? el('dt', {}, 'Telefone') : null, v.contatos.telefone_publico ? el('dd', {}, v.contatos.telefone_publico) : null,
        v.contatos.whatsapp_publico ? el('dt', {}, 'WhatsApp') : null, v.contatos.whatsapp_publico ? el('dd', {}, v.contatos.whatsapp_publico) : null,
        v.contatos.email_publico ? el('dt', {}, 'E-mail') : null, v.contatos.email_publico ? el('dd', {}, v.contatos.email_publico) : null)));
  } else if (!logado) {
    partes.push(el('p', { id: 'contatos', class: 'campo__ajuda' }, 'Os contatos que a empresa divulga aparecem depois que você entra na sua conta. ',
      el('a', { href: entrarEVoltar(location.pathname + location.search) }, 'Entrar')));
  }
  if (v.sem_itens) partes.push(aviso('info', 'Esta empresa ainda não tem itens na vitrine.'));
  if (v.servicos.length) {
    partes.push(el('section', { 'aria-labelledby': 'titulo-servicos', class: 'pilha' }, el('h2', { id: 'titulo-servicos' }, 'Serviços'),
      el('ul', { role: 'list', class: 'grade', id: 'lista-servicos' }, v.servicos.map((s) => el('li', { class: 'cartao pilha', 'data-servico': s.id },
        el('h3', { class: 'cartao__titulo' }, s.nome),
        el('p', {}, el('strong', {}, precoServico(s))),
        s.duracao_min ? el('p', { class: 'cartao__meta' }, `Duração aproximada: ${s.duracao_min} min`) : null,
        s.descricao ? el('p', {}, s.descricao) : null,
        s.pacote ? el('p', {}, `Inclui: ${[...s.pacote.incluidos, ...(s.pacote.outros_incluidos ? [`mais ${s.pacote.outros_incluidos} serviço(s)`] : [])].join(', ')}.`) : null,
        linkOrcamento(s))))));
  }
  if (v.produtos.length) {
    partes.push(el('section', { 'aria-labelledby': 'titulo-produtos', class: 'pilha' }, el('h2', { id: 'titulo-produtos' }, 'Produtos'),
      el('ul', { role: 'list', class: 'grade', id: 'lista-produtos' }, v.produtos.map((p) => el('li', { class: 'cartao pilha', 'data-produto': p.id },
        el('h3', { class: 'cartao__titulo' }, p.nome),
        p.categoria ? el('p', { class: 'cartao__meta' }, p.categoria) : null,
        p.descricao ? el('p', {}, p.descricao) : null,
        el('ul', {}, ...p.variacoes.map((x) => el('li', {}, `${x.rotulo}: ${formatarCentavos(x.preco_centavos)}`))),
        p.sob_encomenda ? el('p', {}, el('span', { class: 'chip chip--info' }, 'Sob encomenda')) : null,
        linkPedir(p)))),
      el('p', { class: 'campo__ajuda' }, 'A empresa confirma a disponibilidade ao responder ao pedido. Nada é cobrado pelo app: o pedido não é um pagamento.'),
      el('p', {}, el('a', { class: 'botao botao--secundario', href: destino(`/cliente/pedidos.html?empresa=${encodeURIComponent(e.id)}`), id: 'fazer-pedido' },
        logado ? 'Fazer pedido com vários produtos' : 'Entrar para fazer pedido'))));
  }
  // M12 (D12-13, D12-14): avaliações publicadas, "Cliente verificado", média só a partir de 3; denúncia só com login.
  partes.push(blocoAvaliacoesVitrine(v.avaliacoes, { logado, botaoDenunciar }));
  if (logado) partes.push(el('div', { class: 'grupo-botoes', id: 'denunciar-empresa' }, botaoDenunciar('empresa', e.id, { rotulo: 'Denunciar esta empresa', descricaoAlvo: 'esta empresa' })));
  partes.push(el('p', { class: 'campo__ajuda' }, 'Fotos ainda não estão disponíveis. Estoque e custos nunca aparecem na vitrine.'));
  area.replaceChildren(...partes.filter(Boolean));
}

export { POLITICA_VITRINE };
