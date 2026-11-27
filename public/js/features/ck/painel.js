/**
 * Painel CK (M03): fila de análise, moderação de alterações diretas,
 * contestações e suspensão/reativação de vitrines. Toda decisão é
 * autorizada e validada no banco; a tela só organiza as ações.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, grupoOpcoes, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { neon } from '../../data/sessao.js';
import {
  souCkAdmin, ckEmpresas, ckFila, ckModeracoes, ckContestacoes, ckHistorico, categorias,
  ckDecidirSolicitacao, ckSuspender, ckReativar, ckAssumirContestacao, ckDecidirContestacao, ckModerar,
  novaChave, ROTULOS_CAMPOS, CAMPOS_RELEVANTES, CAMPOS_MENOR_RISCO, MODALIDADES, FUNDAMENTOS,
} from '../../data/empresas.js';
import { exigirSessao, chipSituacao, chipTeste, listaHistorico, formatarDataHora } from '../empresa/comum.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { ckLimites, ckDefinirLimite, ckHistoricoLimites, NOME_LIMITE } from '../../data/vitrine.js';
import { ckFilaModeracao } from '../../data/comunicacao.js';
import { secoesModeracao } from './moderacao.js';
import { montarMomento } from '../../ui/forja3d/momentos.js';
import { urlDeImagem } from '../../data/arquivos.js';
import { abas } from '../../ui/abas.js';


iniciarLayout();
const painel = document.getElementById('painel');
const avisos = document.getElementById('avisos');
const chaves = new Map();
const chave = (item) => {
  if (!chaves.has(item)) chaves.set(item, novaChave());
  return chaves.get(item);
};
let usuarioAtual = null;
let mapaCategorias = new Map();

function anunciar(tipo, texto, ...extra) {
  avisos.replaceChildren(el('div', { role: tipo === 'erro' ? 'alert' : 'status' }, aviso(tipo, texto, ...extra)));
  avisos.scrollIntoView({ block: 'nearest' });
}

const valorLegivel = (campo, valor) => {
  if (valor === null || valor === undefined || valor === '') return '(vazio)';
  if (campo === 'categoria_id') return mapaCategorias.get(valor) ?? valor;
  if (campo === 'modalidade') return MODALIDADES[valor] ?? valor;
  return String(valor);
};

/**
 * Formulário de decisão com tratamento padrão: valida no cliente só o óbvio,
 * mostra o erro do banco ao lado do campo e recarrega o painel após sucesso.
 */
/** Momento 3D ao lado do aviso de sucesso, só depois que o banco confirmou a ação (IA01, IA02, IA06). */
function anunciarComMomento(texto, id) {
  if (!id) { anunciar('sucesso', texto); return; }
  const lugar = el('div', { class: 'aviso__momento' });
  anunciar('sucesso', texto, lugar);
  montarMomento(lugar, id, { tamanho: 'p' }).disparar();
}

function formDecisao({ item, titulo, campos, botao, validar, executar, sucesso, momento = null }) {
  const enviar = el('button', { type: 'submit', class: 'botao' }, botao);
  const form = el('form', { class: 'pilha', novalidate: true, 'aria-label': titulo }, ...campos, el('div', { class: 'grupo-botoes' }, enviar));
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limparErros(form);
    const dados = valores(form);
    const problema = validar?.(dados);
    if (problema) {
      erroNoCampo(form, problema[0], problema[1]);
      return;
    }
    ocupado(enviar, async () => {
      try {
        await executar(dados, chave(item));
        chaves.delete(item);
        await carregar();
        anunciarComMomento(sucesso, typeof momento === 'function' ? momento(dados) : momento);
      } catch (erro) {
        if (erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, mapearCampo(erro.campo), erro.message)) return;
        if (erro.codigo !== 'NETWORK_UNKNOWN') chaves.delete(item);
        if (['STATE_CONFLICT', 'VERSION_CONFLICT'].includes(erro.codigo)) {
          await carregar();
          anunciar('alerta', 'Esta pendência mudou enquanto você decidia. O painel foi atualizado.', el('p', {}, erro.message));
          return;
        }
        anunciar('erro', erro.message);
      }
    });
  });
  return form;
}

const mapearCampo = (campo) => ({ campos: 'campos', motivo: 'motivo', justificativa: 'justificativa', gravidade: 'gravidade', fundamento: 'fundamento', decisao: 'decisao' })[campo] ?? campo;

const motivoCampo = (rotulo = 'Motivo', ajuda = 'Obrigatório para pedir correção ou rejeitar (pelo menos 10 caracteres). O gestor verá este texto.') =>
  campoTexto({ nome: 'motivo', rotulo, linhas: 3, max: 2000, ajuda });

// E03: a CK vê a logo enviada (e a publicada hoje, numa alteração) antes de decidir.
function miniLogo(id) {
  const caixa = el('span', { class: 'logo-empresa logo-empresa--g' }, '—');
  if (id) urlDeImagem(`/api/arquivos/${id}`).then((src) => { if (src) caixa.replaceChildren(el('img', { src, alt: '' })); }).catch(() => {});
  return caixa;
}
function linhaLogo(s, atual) {
  const publicada = atual?.logo_arquivo_id ?? null;
  if (s.tipo === 'alteracao' ? s.logo_arquivo_id === publicada : !s.logo_arquivo_id) return [];
  return [el('dt', {}, 'Logo'), el('dd', { class: 'grupo-botoes' },
    s.logo_arquivo_id ? miniLogo(s.logo_arquivo_id) : el('span', {}, 'Sem logo (as iniciais aparecem no lugar)'),
    s.tipo === 'alteracao' ? el('span', { class: 'campo__ajuda' }, publicada ? 'publicada hoje: ' : '(hoje: sem logo)') : null,
    s.tipo === 'alteracao' && publicada ? miniLogo(publicada) : null)];
}

function itemFila(s, publicados) {
  const d = s.dados_publicos;
  const atual = publicados.get(s.empresa_id);
  const campos = s.tipo === 'alteracao'
    ? CAMPOS_RELEVANTES.filter((c) => (d[c] ?? null) !== (atual?.[c] ?? null))
    : [...CAMPOS_RELEVANTES, ...CAMPOS_MENOR_RISCO].filter((c) => d[c]);
  const form = formDecisao({
    item: `sol-${s.id}`,
    titulo: `Decisão sobre ${d.nome_publico}`,
    botao: 'Registrar decisão',
    sucesso: 'Decisão registrada.',
    campos: [
      grupoOpcoes({ nome: 'decisao', legenda: 'Decisão', opcoes: [['aprovar', 'Aprovar para publicação'], ['pedir_correcao', 'Pedir correção'], ['rejeitar', 'Rejeitar']] }),
      grupoOpcoes({ nome: 'campos', legenda: 'Campos a corrigir (só para pedir correção)', tipo: 'checkbox',
        opcoes: [...CAMPOS_RELEVANTES, ...CAMPOS_MENOR_RISCO].filter((c) => c !== 'uf').map((c) => [c, ROTULOS_CAMPOS[c]]) }),
      motivoCampo(),
    ],
    validar: (v) => {
      if (!v.decisao) return ['decisao', 'Escolha a decisão.'];
      if (v.decisao !== 'aprovar' && (!v.motivo || v.motivo.length < 10)) return ['motivo', 'Explique o motivo com pelo menos 10 caracteres.'];
      if (v.decisao === 'pedir_correcao' && !v.campos) return ['campos', 'Marque os campos que precisam de correção.'];
      return null;
    },
    executar: (v, k) => ckDecidirSolicitacao(s.id, v.decisao, v.motivo, [].concat(v.campos ?? []), k),
    momento: (v) => (v.decisao === 'aprovar' ? 'IA01' : null),
  });
  return el('li', { class: 'cartao pilha' },
    el('h3', { class: 'cartao__titulo' }, d.nome_publico),
    el('p', { class: 'cartao__meta' }, `${s.tipo === 'alteracao' ? 'Alteração de vitrine publicada' : s.origem_contestacao_id ? 'Nova análise após contestação' : 'Publicação inicial'} · enviada em ${formatarDataHora(s.enviada_em)}`),
    el('dl', { class: 'dados' }, ...campos.flatMap((c) => [
      el('dt', {}, ROTULOS_CAMPOS[c]),
      el('dd', {}, valorLegivel(c, d[c]), s.tipo === 'alteracao' ? el('span', { class: 'campo__ajuda' }, ` (publicado hoje: ${valorLegivel(c, atual?.[c])})`) : null),
    ]), ...linhaLogo(s, atual)),
    form);
}

function itemModeracao(m, nomes) {
  const form = formDecisao({
    item: `mod-${m.id}`,
    titulo: `Moderação de ${nomes.get(m.empresa_id) ?? 'empresa'}`,
    botao: 'Registrar moderação',
    sucesso: 'Moderação registrada.',
    campos: [
      grupoOpcoes({ nome: 'decisao', legenda: 'Decisão', opcoes: [['manter', 'Manter'], ['pedir_correcao', 'Pedir correção (mantém no ar)'], ['restaurar', 'Restaurar a versão anterior']] }),
      motivoCampo('Motivo', 'Obrigatório para pedir correção ou restaurar (pelo menos 10 caracteres).'),
    ],
    validar: (v) => {
      if (!v.decisao) return ['decisao', 'Escolha a decisão.'];
      if (v.decisao !== 'manter' && (!v.motivo || v.motivo.length < 10)) return ['motivo', 'Explique o motivo com pelo menos 10 caracteres.'];
      return null;
    },
    executar: (v, k) => ckModerar(m.id, v.decisao, v.motivo, k),
  });
  return el('li', { class: 'cartao pilha' },
    el('h3', { class: 'cartao__titulo' }, nomes.get(m.empresa_id) ?? 'Empresa'),
    el('p', { class: 'cartao__meta' }, `Publicada direto em ${formatarDataHora(m.criada_em)}`),
    el('dl', { class: 'dados' }, ...Object.keys(m.depois).flatMap((c) => [
      el('dt', {}, ROTULOS_CAMPOS[c] ?? c),
      el('dd', {}, el('span', {}, `Antes: ${valorLegivel(c, m.antes[c])}`), el('br'), el('span', {}, `Agora: ${valorLegivel(c, m.depois[c])}`)),
    ])),
    form);
}

function itemContestacao(c, nomes) {
  const cabecalho = [
    el('h3', { class: 'cartao__titulo' }, nomes.get(c.empresa_id) ?? 'Empresa'),
    el('p', { class: 'cartao__meta' }, `Contesta uma ${c.tipo_decisao === 'rejeicao' ? 'rejeição' : 'suspensão'} · aberta em ${formatarDataHora(c.aberta_em)}`),
    el('p', {}, el('strong', {}, 'Motivo do gestor: '), c.motivo_gestor),
  ];
  if (c.estado === 'aberta') {
    const assumir = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Assumir revisão');
    assumir.addEventListener('click', () => ocupado(assumir, async () => {
      try {
        await ckAssumirContestacao(c.id, chave(`assumir-${c.id}`));
        chaves.delete(`assumir-${c.id}`);
        await carregar();
        anunciar('sucesso', 'Contestação em revisão. Agora registre a decisão.');
      } catch (erro) {
        if (erro.codigo !== 'NETWORK_UNKNOWN') chaves.delete(`assumir-${c.id}`);
        if (erro.codigo === 'STATE_CONFLICT') await carregar();
        anunciar(erro.codigo === 'STATE_CONFLICT' ? 'alerta' : 'erro', erro.message);
      }
    }));
    return el('li', { class: 'cartao pilha' }, ...cabecalho, el('div', { class: 'grupo-botoes' }, assumir));
  }
  const form = formDecisao({
    item: `cont-${c.id}`,
    titulo: `Decisão da contestação de ${nomes.get(c.empresa_id) ?? 'empresa'}`,
    botao: 'Registrar decisão da contestação',
    sucesso: 'Decisão da contestação registrada.',
    campos: [
      grupoOpcoes({ nome: 'decisao', legenda: 'Decisão', opcoes: [['deferir', c.tipo_decisao === 'rejeicao' ? 'Aceitar (nova análise)' : 'Aceitar (republicar vitrine)'], ['indeferir', 'Não aceitar']] }),
      campoTexto({ nome: 'justificativa', rotulo: 'Justificativa', linhas: 4, max: 2000,
        ajuda: 'Obrigatória (pelo menos 20 caracteres). Se você tomou a decisão original, isso fica registrado no histórico.' }),
    ],
    validar: (v) => {
      if (!v.decisao) return ['decisao', 'Escolha a decisão.'];
      if (!v.justificativa || v.justificativa.length < 20) return ['justificativa', 'Justifique com pelo menos 20 caracteres.'];
      return null;
    },
    executar: (v, k) => ckDecidirContestacao(c.id, v.decisao, v.justificativa, k),
  });
  return el('li', { class: 'cartao pilha' }, ...cabecalho, el('p', {}, 'Situação: em revisão.'), form);
}

function itemEmpresa(e) {
  const acoes = [];
  if (e.situacao_vitrine === 'publicada') {
    acoes.push(formDecisao({
      item: `susp-${e.id}`,
      titulo: `Suspender a vitrine de ${e.nome_publico}`,
      botao: 'Suspender vitrine',
      sucesso: 'Vitrine suspensa. Ela saiu da projeção pública.',
      campos: [
        el('h4', {}, 'Suspender vitrine'),
        grupoOpcoes({ nome: 'gravidade', legenda: 'Gravidade', opcoes: [['comum', 'Comum'], ['grave', 'Grave (fraude, risco ao consumidor ou exigência legal)']] }),
        campoSelecao({ nome: 'fundamento', rotulo: 'Fundamento (obrigatório se grave)', opcoes: Object.entries(FUNDAMENTOS), vazio: 'Sem fundamento (suspensão comum)' }),
        motivoCampo('Motivo da suspensão', 'Obrigatório (pelo menos 10 caracteres). O gestor verá este texto.'),
      ],
      validar: (v) => {
        if (!v.gravidade) return ['gravidade', 'Escolha a gravidade.'];
        if (v.gravidade === 'grave' && !v.fundamento) return ['fundamento', 'Suspensão grave exige fundamento.'];
        if (v.gravidade === 'comum' && v.fundamento) return ['fundamento', 'Fundamento só se aplica à suspensão grave.'];
        if (!v.motivo || v.motivo.length < 10) return ['motivo', 'Explique o motivo com pelo menos 10 caracteres.'];
        return null;
      },
      executar: (v, k) => ckSuspender(e.id, v.motivo, v.gravidade, v.fundamento, k),
      momento: 'IA02',
    }));
  }
  if (e.situacao_vitrine === 'suspensa') {
    acoes.push(formDecisao({
      item: `reat-${e.id}`,
      titulo: `Reativar a vitrine de ${e.nome_publico}`,
      botao: 'Reativar vitrine',
      sucesso: 'Vitrine reativada com a última versão aprovada.',
      campos: [el('h4', {}, 'Reativar vitrine'), motivoCampo('Motivo da reativação', 'Obrigatório (pelo menos 10 caracteres).')],
      validar: (v) => (!v.motivo || v.motivo.length < 10 ? ['motivo', 'Explique o motivo com pelo menos 10 caracteres.'] : null),
      executar: (v, k) => ckReativar(e.id, v.motivo, k),
    }));
  }
  const destino = el('div', { class: 'pilha' });
  const verHistorico = el('button', { type: 'button', class: 'botao botao--texto', 'aria-expanded': 'false' }, 'Ver histórico completo');
  verHistorico.addEventListener('click', () => ocupado(verHistorico, async () => {
    if (verHistorico.getAttribute('aria-expanded') === 'true') {
      destino.replaceChildren();
      verHistorico.setAttribute('aria-expanded', 'false');
      return;
    }
    try {
      const eventos = (await ckHistorico(e.id)).reverse()
        .map((ev) => ({ ...ev, motivo: ev.motivo ? `${ev.motivo}${ev.ator_auth_id === usuarioAtual ? ' (decisão sua)' : ''}` : ev.motivo }));
      destino.replaceChildren(listaHistorico(eventos));
      verHistorico.setAttribute('aria-expanded', 'true');
    } catch (erro) {
      anunciar('erro', erro.message);
    }
  }));
  return el('li', { class: 'cartao pilha' },
    el('h3', { class: 'cartao__titulo' }, e.nome_publico),
    el('p', { class: 'cartao__meta' }, `${e.cidade} (${e.uf})`),
    el('p', { class: 'opcoes' }, chipSituacao(e.situacao_vitrine), e.dado_de_teste ? chipTeste() : null),
    e.suspensao_gravidade ? el('p', {}, `Suspensão ${e.suspensao_gravidade}${e.suspensao_fundamento ? `: ${FUNDAMENTOS[e.suspensao_fundamento]}` : ''}`) : null,
    ...acoes,
    verHistorico, destino);
}

// Limites da plataforma (P-M08-02; D10-23 = A): só administrador CK; motivo obrigatório; histórico; nenhum dado de cliente.
let abaCk = ['filas', 'empresas', 'parametros', 'saude', 'auditoria'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'filas';

function agruparPorCategoria(limites, itens) {
  const grupos = new Map();
  limites.forEach((l, i) => { const c = l.categoria ?? 'Geral'; if (!grupos.has(c)) grupos.set(c, []); grupos.get(c).push(itens[i]); });
  return [...grupos].map(([c, lis]) => el('section', { class: 'pilha', 'aria-label': c, 'data-grupo-limites': c }, el('h3', {}, c), el('ul', { class: 'lista-simples grade-parametros' }, ...lis)));
}

// --- E09: saúde da plataforma e auditoria administrativa -------------------------------------------
const bytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.ceil(n / 1024)} KB`);
function secaoSaude(s) {
  if (!s?.banco || !s.filas) return el('section', { class: 'pilha', id: 'saude' }, el('h2', {}, 'Saúde da plataforma'), aviso('erro', 'Não foi possível consultar a saúde agora.'));
  const ficha = (rotulo, valor, extra) => el('div', { class: 'cartao pilha' }, el('small', { class: 'campo__ajuda' }, rotulo), el('strong', {}, valor), extra ? el('span', { class: 'campo__ajuda' }, extra) : null);
  const filas = s.filas.publicacao + s.filas.contestacoes + s.filas.moderacoes;
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-saude', id: 'saude' },
    el('h2', { id: 'titulo-saude' }, 'Saúde da plataforma'),
    el('p', { class: 'campo__ajuda' }, `Verificado em ${formatarDataHora(s.verificado_em)}. Leitura direta do banco, sem dados de clientes.`),
    el('div', { class: 'resumo-ficha' },
      ficha('Banco de dados', `PostgreSQL ${s.banco.versao}`, `${bytes(s.banco.tamanho_bytes)} · fuso ${s.banco.fuso}`),
      ficha('Migrations registradas', String(s.migracoes.total), `última: ${s.migracoes.ultimas[0]?.id ?? '—'}`),
      ficha('Arquivos ativos', String(s.arquivos.ativos), `${bytes(s.arquivos.bytes_ativos)} · ${s.arquivos.removidos_em_retencao} removidos em retenção`),
      ficha('Empresas', String(s.contagens.empresas), `${s.contagens.vitrines_publicadas} vitrines publicadas · ${s.contagens.empresas_de_teste} de teste`),
      ficha('Filas pendentes', String(filas), `${s.filas.publicacao} publicação · ${s.filas.contestacoes} contestação · ${s.filas.moderacoes} moderação`)),
    el('details', {}, el('summary', {}, 'Últimas migrations'), el('ul', { class: 'lista-simples' }, ...s.migracoes.ultimas.map((m) => el('li', {}, el('strong', {}, m.id), ` · ${m.descricao}`)))));
}
const TEXTO_AUDITORIA = { 'ck.limite_alterado': 'alterou um limite da plataforma', 'ck_admin.concedido': 'recebeu acesso de administração CK', 'ck_admin.revogado': 'perdeu o acesso de administração CK',
  'moderacao.publicacao_decidida': 'decidiu a moderação de uma avaliação ou resposta', 'moderacao.denuncia_aberta': 'abriu uma denúncia', 'moderacao.denuncia_assumida': 'assumiu uma denúncia',
  'moderacao.denuncia_decidida': 'decidiu uma denúncia', 'moderacao.contestacao_aberta': 'abriu uma contestação de moderação', 'moderacao.contestacao_decidida': 'decidiu uma contestação de moderação',
  'ck.solicitacao.aprovar': 'aprovou uma vitrine para publicação', 'ck.solicitacao.pedir_correcao': 'pediu correção de uma vitrine', 'ck.solicitacao.rejeitar': 'rejeitou uma vitrine' };
function textoAuditoria(a) {
  if (TEXTO_AUDITORIA[a.tipo]) return TEXTO_AUDITORIA[a.tipo];
  return a.tipo.replace(/^ck(_admin)?\./, '').replaceAll('.', ' · ').replaceAll('_', ' ');
}
function secaoAuditoria(r) {
  if (!Array.isArray(r?.itens)) return el('section', { class: 'pilha', id: 'auditoria' }, el('h2', {}, 'Auditoria administrativa'), aviso('erro', 'Não foi possível consultar a auditoria agora.'));
  const lista = el('ul', { class: 'lista-simples', id: 'lista-auditoria' });
  const linha = (a) => el('li', { class: 'atividade' }, el('span', { class: 'atividade__hora' }, formatarDataHora(a.criado_em).split(' ').pop()),
    el('span', {}, el('strong', {}, a.ator), ` ${textoAuditoria(a)}`, a.empresa ? ` · ${a.empresa}` : '', a.dados?.motivo ? ` · motivo: ${a.dados.motivo}` : '',
      el('span', { class: 'campo__ajuda' }, ` · ${formatarDataHora(a.criado_em)}`)));
  lista.append(...r.itens.map(linha));
  let ultima = r.itens.at(-1)?.criado_em;
  const mais = el('button', { type: 'button', class: 'botao botao--secundario', hidden: !r.mais }, 'Ver registros mais antigos');
  mais.addEventListener('click', () => ocupado(mais, async () => {
    const prox = await neon.rpc('ck_auditoria', { p_antes: ultima, p_limite: 40 });
    lista.append(...prox.itens.map(linha)); ultima = prox.itens.at(-1)?.criado_em ?? ultima; mais.hidden = !prox.mais;
  }));
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-auditoria', id: 'auditoria' },
    el('h2', { id: 'titulo-auditoria' }, 'Auditoria administrativa'),
    el('p', { class: 'campo__ajuda' }, 'Decisões da CK, moderação e mudanças de limites. Registro permanente.'),
    r.itens.length ? lista : el('p', { id: 'lista-auditoria' }, 'Nenhum registro ainda.'), mais);
}

function secaoLimites(limites, historico) {
  if (!limites) {
    return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-limites', id: 'limites' }, el('h2', { id: 'titulo-limites' }, 'Limites da plataforma'),
      aviso('erro', 'Não conseguimos carregar os limites agora.', el('p', {}, 'O restante do painel continua disponível. Recarregue a página para tentar de novo.')));
  }
  const itens = limites.map((l) => {
    const nome = l.nome && l.nome !== l.chave ? l.nome : NOME_LIMITE[l.chave] ?? l.descricao;
    const id = `limite-${l.chave}`;
    const salvar = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Alterar limite');
    const form = el('form', { class: 'pilha', novalidate: true, 'data-limite': l.chave },
      campoTexto({ nome: 'valor', rotulo: `Novo valor (de ${l.minimo} a ${l.maximo})`, tipo: 'number', valor: String(l.valor), obrigatorio: true, id: `${id}-valor` }),
      campoTexto({ nome: 'motivo', rotulo: 'Motivo da mudança', obrigatorio: true, max: 300, id: `${id}-motivo`, ajuda: 'De 10 a 300 caracteres. Fica no histórico.' }),
      el('div', { class: 'grupo-botoes' }, salvar));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const d = valores(form);
      const valor = Number(d.valor);
      if (!Number.isInteger(valor) || valor < l.minimo || valor > l.maximo) return erroNoCampo(form, 'valor', `O valor vai de ${l.minimo} a ${l.maximo}.`);
      if (valor === l.valor) return erroNoCampo(form, 'valor', 'O valor é igual ao atual.');
      const motivo = (d.motivo ?? '').trim();
      if (motivo.length < 10 || motivo.length > 300) return erroNoCampo(form, 'motivo', 'Explique a mudança (10 a 300 caracteres).');
      return ocupado(salvar, async () => {
        const ok = await abrirDialogo({ titulo: 'Confirmar a mudança do limite?', rotuloConfirmar: 'Alterar limite', rotuloCancelar: 'Voltar',
          mensagens: [`${nome}: de ${l.valor} para ${valor}.`, 'Vale para todas as empresas a partir da próxima solicitação.', `Motivo: ${motivo}`] });
        if (!ok) return;
        // IA03: a engrenagem gira só enquanto a gravação real acontece e desacelera quando ela termina.
        let engrenagem = null;
        const sinal = setTimeout(() => {
          engrenagem = montarMomento(salvar.parentElement, 'IA03', { tamanho: 'p' });
          engrenagem.definir({ fase: 'calculando' }, { manter: true });
        }, 120);
        try {
          await ckDefinirLimite(l.chave, valor, motivo, chave(`limite-${l.chave}-${valor}-${motivo}`));
          clearTimeout(sinal); engrenagem?.destruir(); engrenagem = null;
          await carregar();
          anunciarComMomento(`Limite alterado: ${nome} agora é ${valor}.`, 'IA06');
        } catch (erro) {
          if (erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, erro.campo ?? 'valor', erro.message)) return;
          anunciar('erro', erro.message);
        } finally {
          clearTimeout(sinal);
          engrenagem?.destruir();
        }
      });
    });
    // E09: restaurar o padrão preenche o formulário; a mudança continua exigindo motivo e confirmação.
    const padrao = Number.isInteger(l.valor_padrao) && l.valor_padrao !== l.valor ? el('button', { type: 'button', class: 'botao botao--texto' }, `Restaurar o padrão (${l.valor_padrao})`) : null;
    padrao?.addEventListener('click', () => {
      form.querySelector(`#${id}-valor`).value = String(l.valor_padrao);
      const m = form.querySelector(`#${id}-motivo`); if (!m.value.trim()) m.value = 'Restaurado ao valor padrão da plataforma.';
      form.querySelector('button[type="submit"]').focus();
    });
    if (padrao) form.querySelector('.grupo-botoes').append(padrao);
    return el('li', { class: 'cartao pilha', 'data-limite-item': l.chave, 'data-categoria': l.categoria ?? 'Geral' },
      el('h3', { class: 'cartao__titulo' }, nome, l.unidade ? el('span', { class: 'campo__ajuda' }, ` (${l.unidade})`) : null),
      el('dl', { class: 'dados' }, el('dt', {}, 'Valor atual'), el('dd', { 'data-valor': '' }, String(l.valor)),
        el('dt', {}, 'Faixa permitida'), el('dd', {}, `${l.minimo} a ${l.maximo}`),
        Number.isInteger(l.valor_padrao) ? el('dt', {}, 'Padrão') : null, Number.isInteger(l.valor_padrao) ? el('dd', {}, String(l.valor_padrao)) : null,
        el('dt', {}, 'Descrição'), el('dd', {}, l.descricao),
        el('dt', {}, 'Última alteração'), el('dd', {}, formatarDataHora(l.atualizado_em))),
      form);
  });
  const linhas = historico.map((h) => el('li', { class: 'cartao' },
    el('p', {}, el('strong', {}, NOME_LIMITE[h.chave] ?? h.chave), `: de ${h.antes} para ${h.depois}`),
    el('p', { class: 'cartao__meta' }, `${h.autor ?? 'Administração CK'} · ${formatarDataHora(h.quando)}`),
    el('p', {}, `Motivo: ${h.motivo}`)));
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-limites', id: 'limites' },
    el('h2', { id: 'titulo-limites' }, 'Limites da plataforma'),
    el('p', { class: 'campo__ajuda' }, 'Os limites valem para todas as empresas. Mudar um limite não dá acesso a dados de clientes, solicitações ou pedidos.'),
    ...agruparPorCategoria(limites, itens),
    el('h3', {}, 'Histórico das alterações'),
    linhas.length ? el('ul', { class: 'lista-simples', id: 'historico-limites' }, ...linhas) : el('p', { id: 'historico-limites' }, 'Nenhuma alteração registrada.'));
}

const secao = (id, titulo, itens, vazio) => el('section', { class: 'pilha', 'aria-labelledby': id },
  el('h2', { id }, `${titulo} (${itens.length})`),
  itens.length ? el('ul', { class: 'lista-simples' }, ...itens) : el('p', {}, vazio));

async function carregar() {
  mostrarCarregando(painel, 'Carregando o painel');
  try {
    const sessao = await exigirSessao(painel, { perfil: null });
    if (!sessao) return;
    usuarioAtual = sessao.usuario.id;
    if (!(await souCkAdmin())) {
      concluirCarregamento(painel);
      painel.append(el('div', { role: 'alert' }, aviso('alerta', 'Esta área é exclusiva da equipe da CK. Sua conta não tem esse papel.',
        el('p', {}, el('a', { href: '/' }, 'Voltar para o início')))));
      return;
    }
    const [empresas, fila, moderacoes, conts, cats, limites, historicoLimites, filaM12, saude, auditoria] = await Promise.all([ckEmpresas(), ckFila(), ckModeracoes(),
      ckContestacoes(), categorias(), ckLimites().catch(() => null), ckHistoricoLimites().catch(() => []), ckFilaModeracao().catch(() => null),
      neon.rpc('ck_saude', {}).catch(() => null), neon.rpc('ck_auditoria', { p_antes: null, p_limite: 40 }).catch(() => null)]);
    mapaCategorias = new Map(cats.map((c) => [c.id, c.nome]));
    const nomes = new Map(empresas.map((e) => [e.id, e.nome_publico]));
    const idsAlteracao = fila.filter((s) => s.tipo === 'alteracao').map((s) => s.empresa_id);
    const publicados = new Map((idsAlteracao.length
      ? await neon.consultar(`/public_empresa_cards?empresa_id=in.(${idsAlteracao.join(',')})&select=*`)
      : []).map((c) => [c.empresa_id, c]));
    concluirCarregamento(painel);
    // E09: o painel em abas; as filas (o trabalho do dia) vêm primeiro.
    const pendentes = fila.length + moderacoes.length + conts.filter((c) => ['aberta', 'em_revisao'].includes(c.estado)).length;
    const grupo = abas({ rotulo: 'Partes do painel CK', ativa: abaCk, aoTrocar: (k) => { abaCk = k; },
      itens: [
        { chave: 'filas', titulo: 'Filas', contador: pendentes, painel: el('div', { class: 'pilha-grande' },
          secao('titulo-fila', 'Fila de análise', fila.map((s) => itemFila(s, publicados)), 'Nenhum envio aguardando análise.'),
          secao('titulo-moderacao', 'Alterações publicadas direto para moderar', moderacoes.map((m) => itemModeracao(m, nomes)), 'Nenhuma alteração aguardando moderação.'),
          secao('titulo-contestacoes', 'Contestações', conts.map((c) => itemContestacao(c, nomes)), 'Nenhuma contestação em andamento.'),
          // M12: pré-moderação de avaliações e respostas, denúncias e contestações de moderação.
          ...secoesModeracao(filaM12, { formDecisao, anunciar, carregar, chave, secao })) },
        { chave: 'empresas', titulo: 'Empresas', contador: empresas.length, painel: secao('titulo-empresas', 'Empresas', empresas.map(itemEmpresa), 'Nenhuma empresa cadastrada.') },
        { chave: 'parametros', titulo: 'Parâmetros', painel: secaoLimites(limites, historicoLimites) },
        { chave: 'saude', titulo: 'Saúde', painel: secaoSaude(saude) },
        { chave: 'auditoria', titulo: 'Auditoria', painel: secaoAuditoria(auditoria) },
      ] });
    painel.append(grupo.elemento);
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      painel.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(painel, erro, carregar);
  }
}

carregar();
