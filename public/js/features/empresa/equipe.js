/**
 * Equipe da empresa (M04, UI-047; simplificada no E04): abas Pessoas, Perfis de acesso e Histórico;
 * "Adicionar colaborador" num modal; perfis montados por níveis por área (sem acesso, consultar, operar, personalizar).
 *
 * A tela mostra só o que a pessoa pode fazer agora e explica o que falta, mas
 * quem decide é o banco a cada ação (permissão atual, delegação limitada D4-2,
 * versão e chave de operação). Qualquer recusa do banco atualiza a tela.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { definirEmpresaAtiva } from '../../core/contexto-empresa.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { abrirModal } from '../../ui/modal.js';
import { abas } from '../../ui/abas.js';
import { iniciais } from '../../ui/seletor-empresa.js';
import { empresa as lerEmpresa, novaChave } from '../../data/empresas.js';
import {
  catalogo, minhasPermissoes, membros as lerMembros, historicoEquipe, perfis as lerPerfis, convitesPendentes,
  criarPerfil, alterarPerfil, desativarPerfil, convidar, cancelarConvite, trocarPerfilDoMembro, desligar,
  MODELOS, ROTULOS_EVENTOS_EQUIPE, papelLegivel, definirDescontoMaximo,
} from '../../data/equipe.js';
import { exigirSessao, chipTeste, semAcesso, formatarDataHora } from './comum.js';

iniciarLayout();
const id = parametro('id');
const area = document.getElementById('equipe');
const avisos = document.getElementById('avisos');
const titulo = document.getElementById('titulo-equipe');
const voltar = document.getElementById('voltar-empresa');

/** Chaves de operação por ação e alvo: reaproveitadas só quando a resposta se perdeu na rede. */
const chaves = new Map();
const chave = (acao) => {
  if (!chaves.has(acao)) chaves.set(acao, novaChave());
  return chaves.get(acao);
};
const concluir = (acao) => chaves.delete(acao);

let estado = null; // { acesso, pode, minhas, catalogo, perfis, membros, convites, historico, empresa }
let abaAtiva = ({ perfis: 'perfis', 'titulo-form-perfil': 'perfis', 'titulo-perfis': 'perfis', historico: 'historico', 'titulo-historico-equipe': 'historico' })[location.hash.slice(1)] ?? 'pessoas';
let modalConvite = null;
let trocarAba = null;

function anunciar(tipo, texto, ...extra) {
  avisos.replaceChildren(el('div', { role: tipo === 'erro' ? 'alert' : 'status' }, aviso(tipo, texto, ...extra)));
  // Com o modal de convite aberto, o aviso aparece também dentro dele (a página fica atrás do modal).
  const noModal = modalConvite?.dialogo.isConnected ? modalConvite.dialogo.querySelector('[data-avisos-modal]') : null;
  if (noModal) noModal.replaceChildren(aviso(tipo, texto, ...extra.map((x) => (x instanceof Node ? x.cloneNode(true) : x))));
  else avisos.scrollIntoView({ block: 'nearest' });
}

/** Executa uma ação no banco com tratamento uniforme de falhas. */
async function executar(acao, form, chamada, sucesso) {
  try {
    const r = await chamada(chave(acao));
    concluir(acao);
    await carregar();
    sucesso(r);
  } catch (erro) {
    if (erro.codigo === 'NETWORK_UNKNOWN') {
      anunciar('erro', erro.message, el('p', {}, 'Tente novamente: se a ação já tiver sido registrada, ela não será duplicada.'));
      return;
    }
    concluir(acao);
    if (erro.codigo === 'TENANT_FORBIDDEN') {
      semAcesso(area);
      return;
    }
    if (erro.codigo === 'VALIDATION_ERROR' && form && erroNoCampo(form, erro.campo, erro.message)) return;
    if (['FORBIDDEN_ACTION', 'VERSION_CONFLICT', 'STATE_CONFLICT', 'NOT_FOUND'].includes(erro.codigo)) {
      await carregar();
      anunciar(erro.codigo === 'FORBIDDEN_ACTION' ? 'erro' : 'alerta', erro.message, el('p', {}, 'Atualizamos a tela com a situação atual.'));
      return;
    }
    anunciar('erro', erro.message);
  }
}

// --- Regras de exibição (espelham D4-2; o banco confere de novo) -------------

const proprietario = () => estado.acesso.papel === 'proprietario';
const contidoNasMinhas = (codigos) => proprietario() || codigos.every((c) => estado.minhas.has(c));
const perfilPorId = (perfilId) => estado.perfis.find((p) => p.id === perfilId) ?? null;
const codigosDoPerfil = (p) => (p?.perfil_permissoes ?? []).map((x) => x.codigo);
const perfisConcediveis = () => estado.perfis.filter((p) => contidoNasMinhas(codigosDoPerfil(p)));
const opcoesPerfis = (lista) => lista.map((p) => [p.id, `${p.nome} (${codigosDoPerfil(p).length} permissões)`]);
const meuPerfilId = () => estado.acesso.perfil_id;

// --- Membros ------------------------------------------------------------------

function acoesDoMembro(m) {
  if (m.eu) return el('p', { class: 'campo__ajuda' }, 'Este é você. Para mudar o seu acesso, peça a outra pessoa que administre a equipe.');
  if (m.papel === 'proprietario') return el('p', { class: 'campo__ajuda' }, 'O acesso do proprietário não pode ser alterado nem encerrado.');
  const pode = estado.pode;
  if (!pode('equipe.alterar') && !pode('equipe.revogar')) return null;
  if (!contidoNasMinhas(codigosDoPerfil(perfilPorId(m.perfil_id)))) {
    return el('p', { class: 'campo__ajuda' }, 'Esta pessoa tem permissões que você não tem. Só o proprietário ou alguém com acesso maior pode mudar o acesso dela.');
  }
  const partes = [];
  if (pode('equipe.alterar')) {
    const opcoes = perfisConcediveis().filter((p) => p.id !== m.perfil_id);
    if (opcoes.length) {
      const botao = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Trocar perfil');
      const form = el('form', { class: 'pilha', novalidate: true, 'data-membro': m.membro_id },
        campoSelecao({ nome: 'perfil_id', rotulo: `Novo perfil de acesso para ${m.nome}`, opcoes: opcoesPerfis(opcoes), obrigatorio: true, id: `trocar-${m.membro_id}` }),
        el('div', { class: 'grupo-botoes' }, botao));
      form.addEventListener('submit', (evento) => {
        evento.preventDefault();
        limparErros(form);
        const { perfil_id: perfilId } = valores(form);
        if (!perfilId) {
          erroNoCampo(form, 'perfil_id', 'Escolha um perfil.');
          return;
        }
        ocupado(botao, () => executar(`trocar-${m.membro_id}`, form,
          (k) => trocarPerfilDoMembro(m.membro_id, perfilId, m.versao, k),
          (r) => anunciar('sucesso', `Perfil de ${m.nome} trocado para ${r.perfil_nome}.`, el('p', {}, 'A mudança já vale na próxima ação dessa pessoa.'))));
      });
      partes.push(form);
    }
  }
  if (pode('equipe.revogar')) {
    const botao = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Encerrar acesso');
    const form = el('form', { class: 'pilha', novalidate: true },
      campoTexto({ nome: 'motivo', rotulo: 'Motivo do encerramento', linhas: 2, max: 300, id: `motivo-${m.membro_id}`,
        ajuda: 'Opcional. Fica no histórico da equipe, visível só para quem administra a equipe.' }),
      el('div', { class: 'grupo-botoes' }, botao));
    form.addEventListener('submit', (evento) => {
      evento.preventDefault();
      limparErros(form);
      const { motivo } = valores(form);
      ocupado(botao, async () => {
        const ok = await abrirDialogo({ titulo: `Encerrar o acesso de ${m.nome}?`,
          mensagens: ['O acesso a esta empresa acaba na hora, mesmo que a pessoa esteja com o aplicativo aberto.',
            'O histórico do que ela fez continua registrado. Para voltar, será preciso um novo convite.'],
          rotuloConfirmar: 'Encerrar acesso', rotuloCancelar: 'Cancelar' });
        if (!ok) return;
        await executar(`desligar-${m.membro_id}`, form, (k) => desligar(m.membro_id, motivo, k),
          () => anunciar('sucesso', `Acesso encerrado. O histórico do que ${m.nome} fez continua registrado.`));
      });
    });
    partes.push(form);
  }
  if (!partes.length) return null;
  return el('details', { class: 'pilha' }, el('summary', {}, `Gerenciar acesso de ${m.nome}`), ...partes);
}

function cartaoMembro(m) {
  return el('li', { class: 'cartao pilha cartao-pessoa', 'data-membro': m.membro_id },
    el('div', { class: 'cartao-pessoa__topo' },
      el('span', { class: 'avatar-pessoa', 'aria-hidden': 'true' }, iniciais(m.nome || m.email)),
      el('div', {}, el('h3', { class: 'cartao__titulo' }, m.nome || m.email, m.eu ? ' (você)' : ''),
        el('p', { class: 'cartao__meta' }, m.email))),
    el('p', { class: 'opcoes' }, el('span', { class: 'chip chip--info' }, el('span', { 'aria-hidden': 'true' }, m.papel === 'proprietario' ? '★' : '•'),
      papelLegivel(m.papel, m.perfil_nome))),
    el('p', {}, `Na equipe desde ${formatarDataHora(m.desde)}.`),
    acoesDoMembro(m));
}

function secaoMembros() {
  const ativos = estado.membros.filter((m) => m.estado === 'ativo');
  const antigos = estado.membros.filter((m) => m.estado !== 'ativo');
  const acoes = [];
  if (estado.pode('equipe.convidar')) {
    if (perfisConcediveis().length) {
      const adicionar = el('button', { type: 'button', class: 'botao', id: 'adicionar-colaborador', 'data-ancora-abre': '' }, 'Adicionar colaborador');
      adicionar.addEventListener('click', abrirConvite);
      acoes.push(adicionar);
    } else {
      const irPerfis = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Criar um perfil de acesso');
      irPerfis.addEventListener('click', () => trocarAba?.('perfis'));
      acoes.push(aviso('info', 'Crie um perfil de acesso antes de convidar alguém.',
        el('p', {}, 'O perfil define o que a pessoa poderá fazer. Use um dos modelos prontos em "Perfis de acesso".'), el('p', {}, irPerfis)));
    }
  }
  return el('div', { class: 'pilha-grande' },
    el('section', { class: 'pilha', 'aria-labelledby': 'titulo-membros' },
      el('div', { class: 'cabecalho-secao' }, el('h2', { id: 'titulo-membros' }, `Pessoas com acesso (${ativos.length})`), ...acoes.filter((a) => a.tagName === 'BUTTON')),
      ...acoes.filter((a) => a.tagName !== 'BUTTON'),
      el('ul', { class: 'lista-simples grade-pessoas' }, ...ativos.map(cartaoMembro)),
      antigos.length ? el('details', { class: 'cartao pilha' },
        el('summary', {}, `Ex-funcionários (${antigos.length})`),
        el('p', { class: 'campo__ajuda' }, 'O acesso destas pessoas foi encerrado. O que elas fizeram continua no histórico.'),
        el('ul', { class: 'lista-simples' }, ...antigos.map((m) => el('li', {},
          el('p', {}, el('strong', {}, m.nome || m.email), ` · ${m.email}`),
          el('p', {}, `${m.motivo_encerramento === 'saiu' ? 'Saiu da empresa' : 'Acesso encerrado'} em ${formatarDataHora(m.encerrado_em)}. Último perfil: ${m.perfil_nome ?? 'sem perfil'}.`))))) : null),
    secaoConvitesPendentes());
}

// --- Convites -----------------------------------------------------------------

/** "Adicionar colaborador": convite por e-mail com um perfil de acesso, num modal. O banco confere a delegação. */
function abrirConvite() {
  const opcoes = perfisConcediveis();
  const botao = el('button', { type: 'submit', class: 'botao', form: 'form-convite' }, 'Criar convite');
  const form = el('form', { id: 'form-convite', class: 'pilha', novalidate: true },
    el('div', { 'data-avisos-modal': '' }),
    campoTexto({ nome: 'email', rotulo: 'E-mail da pessoa', tipo: 'email', obrigatorio: true, max: 254, id: 'convite-email', autocomplete: 'email',
      ajuda: 'A pessoa entra no AutoniCK com este e-mail, confirmado, e aceita o convite. Você nunca define nem vê a senha dela.' }),
    campoSelecao({ nome: 'perfil_id', rotulo: 'Perfil de acesso', obrigatorio: true, opcoes: opcoesPerfis(opcoes), id: 'convite-perfil',
      ajuda: proprietario() ? 'O perfil define o que a pessoa pode fazer. Você pode trocá-lo depois.' : 'Aparecem só os perfis com permissões que você também tem.' }),
    el('div', { class: 'resumo-perfil', id: 'convite-resumo', 'aria-live': 'polite' }));
  const resumo = () => {
    const p = perfilPorId(form.querySelector('#convite-perfil').value);
    form.querySelector('#convite-resumo').replaceChildren(...(p ? [el('p', { class: 'campo__ajuda' }, `Com o perfil "${p.nome}", a pessoa poderá: `,
      resumoModulos(codigosDoPerfil(p)) || 'nada ainda (perfil sem permissões).')] : []));
  };
  form.querySelector('#convite-perfil').addEventListener('change', resumo);
  let alterado = false;
  form.addEventListener('input', () => { alterado = true; });
  const cancelar = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Cancelar');
  modalConvite = abrirModal({ titulo: 'Adicionar colaborador', descricao: 'A pessoa recebe acesso só ao que o perfil permite. Tudo fica no histórico da equipe.',
    corpo: form, rodape: [cancelar, botao], tamanho: 'estreito', protegerAlteracoes: () => alterado, aoFechar: () => { modalConvite = null; } });
  cancelar.addEventListener('click', () => modalConvite?.dialogo.dispatchEvent(new Event('cancel', { cancelable: true })));
  form.querySelector('#convite-email').focus();
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limparErros(form);
    const dados = valores(form);
    if (!dados.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dados.email)) {
      erroNoCampo(form, 'email', 'Informe um e-mail válido.');
      return;
    }
    if (!dados.perfil_id) {
      erroNoCampo(form, 'perfil_id', 'Escolha um perfil de acesso.');
      return;
    }
    ocupado(botao, () => executar('convidar', form, (k) => convidar(id, dados.email, dados.perfil_id, k), (r) => {
      alterado = false;
      modalConvite?.fechar();
      anunciar('sucesso', 'Convite criado.', el('p', {}, `Avise a pessoa para entrar no AutoniCK com o e-mail ${r.email}; o convite vale até ${formatarDataHora(r.expira_em)}.`),
        el('p', {}, 'O AutoniCK ainda não envia e-mails: o aviso é por sua conta.'));
    }));
  });
}

function secaoConvitesPendentes() {
  const pode = estado.pode;
  const pendentes = estado.convites;
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-convites' },
    el('h2', { id: 'titulo-convites' }, `Convites aguardando resposta (${pendentes.length})`),
    !pendentes.length ? el('p', {}, 'Nenhum convite pendente.') : el('ul', { class: 'lista-simples' }, ...pendentes.map((c) => {
      const expirado = new Date(c.expira_em) <= new Date();
      const cancelar = pode('equipe.convidar') ? el('button', { type: 'button', class: 'botao botao--texto' }, 'Cancelar convite') : null;
      cancelar?.addEventListener('click', () => ocupado(cancelar, async () => {
        const ok = await abrirDialogo({ titulo: 'Cancelar convite?', mensagens: [`${c.email} não poderá mais usar este convite.`],
          rotuloConfirmar: 'Cancelar convite', rotuloCancelar: 'Manter convite' });
        if (!ok) return;
        await executar(`cancelar-${c.id}`, null, (k) => cancelarConvite(c.id, k), () => anunciar('sucesso', 'Convite cancelado.'));
      }));
      return el('li', { class: 'pilha' },
        el('p', {}, el('strong', {}, c.email), ` · ${perfilPorId(c.perfil_permissao_id)?.nome ?? 'perfil desativado'}`),
        el('p', { class: 'campo__ajuda' }, expirado ? 'Expirado. Crie um novo convite se ainda quiser a pessoa na equipe.' : `Vale até ${formatarDataHora(c.expira_em)}.`),
        cancelar);
    })));
}

/** Resumo em linguagem simples: "Estoque (operar), Vendas (consultar)…". */
function resumoModulos(codigos) {
  return gruposDoCatalogo().map((g) => [g.nome, nivelDoModulo(g, new Set(codigos))]).filter(([, n]) => n !== 'nenhum')
    .map(([nome, n]) => `${nome} (${NIVEIS[n].curto})`).join(', ');
}

// --- Perfis de acesso -----------------------------------------------------------

// Níveis por módulo (E04): atalhos sobre o catálogo real de permissões. "Consultar" = as permissões de visualizar do módulo;
// "Operar" = todas as não sensíveis; sensíveis (fechar período, ver custo, aplicar desconto…) só marcando uma a uma.
const NIVEIS = {
  nenhum: { rotulo: 'Sem acesso', curto: 'sem acesso' },
  consultar: { rotulo: 'Consultar', curto: 'consultar' },
  operar: { rotulo: 'Operar', curto: 'operar' },
  personalizado: { rotulo: 'Personalizar', curto: 'algumas ações' },
};
function gruposDoCatalogo() {
  const modulos = [];
  for (const p of estado.catalogo) {
    let grupo = modulos.find((g) => g.modulo === p.modulo);
    if (!grupo) modulos.push(grupo = { modulo: p.modulo, nome: p.modulo_nome, itens: [] });
    grupo.itens.push(p);
  }
  return modulos;
}
const codigosDoNivel = (g, nivel) => (nivel === 'consultar' ? g.itens.filter((p) => p.codigo.endsWith('.visualizar'))
  : nivel === 'operar' ? g.itens.filter((p) => !p.sensivel) : []).map((p) => p.codigo);
const mesmoConjunto = (a, b) => a.length === b.length && a.every((c) => b.includes(c));
function nivelDoModulo(g, marcadas) {
  const doModulo = g.itens.map((p) => p.codigo).filter((c) => marcadas.has(c));
  if (!doModulo.length) return 'nenhum';
  const consultar = codigosDoNivel(g, 'consultar');
  if (consultar.length && mesmoConjunto(doModulo, consultar)) return 'consultar';
  if (mesmoConjunto(doModulo, codigosDoNivel(g, 'operar'))) return 'operar';
  return 'personalizado';
}

function matrizPermissoes(form, marcadas) {
  const modulos = gruposDoCatalogo();
  const contador = el('p', { class: 'campo__ajuda', 'aria-live': 'polite', id: 'perfil-contador' });
  const sincronizadores = [];
  const atualizar = () => {
    const n = form.querySelectorAll('input[name="permissoes"]:checked').length;
    contador.textContent = `${n} de ${estado.catalogo.length} permissões escolhidas.`;
    for (const f of sincronizadores) f();
  };
  const grupos = modulos.map((g) => {
    const chaveModulo = g.modulo.replace(/[^a-z0-9_-]/gi, '');
    const caixas = g.itens.map((p) => {
      const idCaixa = `perm-${p.codigo.replace('.', '-')}`;
      const bloqueada = !contidoNasMinhas([p.codigo]);
      return el('div', { class: 'opcao opcao--permissao' },
        el('input', { id: idCaixa, type: 'checkbox', name: 'permissoes', value: p.codigo, checked: marcadas.includes(p.codigo),
          disabled: bloqueada, 'aria-describedby': `${idCaixa}-desc` }),
        el('label', { for: idCaixa }, p.acao_nome, p.sensivel ? el('span', { class: 'chip chip--alerta chip--pequeno' }, 'sensível') : null),
        el('span', { id: `${idCaixa}-desc`, class: 'campo__ajuda' }, p.descricao, bloqueada ? ' Você não tem esta permissão, por isso não pode concedê-la.' : ''));
    });
    const caixa = (codigo) => form.querySelector(`#perm-${codigo.replace('.', '-')}`);
    const detalhes = el('details', { class: 'modulo-permissoes__detalhe' }, el('summary', {}, `Ajustar uma a uma (${g.itens.length})`),
      el('div', { class: 'opcoes opcoes--coluna' }, ...caixas));
    const temConsulta = codigosDoNivel(g, 'consultar').length > 0;
    const radios = Object.entries(NIVEIS).map(([nivel, info]) => {
      const idRadio = `nivel-${chaveModulo}-${nivel}`;
      const entrada = el('input', { type: 'radio', id: idRadio, name: `nivel-${chaveModulo}`, value: nivel, 'data-nivel': nivel,
        disabled: nivel === 'consultar' && !temConsulta });
      entrada.addEventListener('change', () => {
        if (nivel === 'personalizado') { detalhes.open = true; detalhes.querySelector('input:not(:disabled)')?.focus(); return; }
        const quer = codigosDoNivel(g, nivel);
        for (const p of g.itens) { const c = caixa(p.codigo); if (!c.disabled) c.checked = quer.includes(p.codigo); }
        atualizar();
      });
      return el('span', { class: 'nivel-acesso' }, entrada, el('label', { for: idRadio }, info.rotulo));
    });
    const situacao = el('span', { class: 'campo__ajuda modulo-permissoes__situacao' });
    sincronizadores.push(() => {
      const atual = nivelDoModulo(g, new Set([...form.querySelectorAll('input[name="permissoes"]:checked')].map((c) => c.value)));
      for (const r of radios) { const i = r.querySelector('input'); i.checked = i.value === atual; }
      const n = g.itens.filter((p) => caixa(p.codigo)?.checked).length;
      situacao.textContent = `${n} de ${g.itens.length}`;
      if (atual === 'personalizado') detalhes.open = true;
    });
    return el('fieldset', { class: 'campo modulo-permissoes' },
      el('legend', {}, g.nome, ' ', situacao),
      el('div', { class: 'niveis-acesso', role: 'radiogroup', 'aria-label': `Nível de acesso em ${g.nome}` }, ...radios),
      detalhes);
  });
  form.addEventListener('change', (e) => { if (e.target === form || e.target.name === 'permissoes') atualizar(); });
  queueMicrotask(atualizar);
  return el('div', { class: 'pilha' },
    el('p', { class: 'campo__ajuda' }, 'Em cada área, escolha: Sem acesso, Consultar (só ver), Operar (ver e fazer o dia a dia, sem ações sensíveis) ou Personalizar (marcar uma a uma).'),
    el('span', { class: 'campo__erro', 'data-grupo': 'permissoes', id: 'perfil-permissoes-erro' }),
    contador, el('div', { class: 'grade-permissoes' }, ...grupos));
}

function formularioPerfil(perfil = null) {
  const editando = Boolean(perfil);
  const botao = el('button', { type: 'submit', class: 'botao' }, editando ? 'Salvar perfil' : 'Criar perfil');
  const form = el('form', { id: 'form-perfil', class: 'pilha', novalidate: true });
  const modelos = editando ? null : el('div', { class: 'pilha' },
    el('p', {}, 'Comece de um modelo e ajuste o que precisar, ou marque as permissões uma a uma.'),
    el('div', { class: 'grupo-botoes' }, ...MODELOS.map((m) => {
      const b = el('button', { type: 'button', class: 'botao botao--secundario', title: m.descricao }, m.nome);
      b.addEventListener('click', () => {
        const codigos = m.permissoes(estado.catalogo.map((p) => p.codigo));
        let fora = 0;
        for (const c of form.querySelectorAll('input[name="permissoes"]')) {
          const quer = codigos.includes(c.value);
          if (quer && c.disabled) fora += 1;
          c.checked = quer && !c.disabled;
        }
        const nome = form.querySelector('[name="nome"]');
        if (!nome.value.trim()) nome.value = m.nome;
        const descricao = form.querySelector('[name="descricao"]');
        if (!descricao.value.trim()) descricao.value = m.descricao;
        form.dispatchEvent(new Event('change'));
        anunciar('info', `Modelo "${m.nome}" aplicado. Revise as permissões antes de salvar.`,
          fora ? el('p', {}, `${fora} permissões do modelo ficaram de fora porque você não as tem.`) : null);
      });
      return b;
    })));
  form.append(
    campoTexto({ nome: 'nome', rotulo: 'Nome do perfil', obrigatorio: true, max: 60, valor: perfil?.nome ?? '', id: 'perfil-nome',
      ajuda: 'Use um nome do seu negócio, por exemplo "Caixa" ou "Atendimento".' }),
    campoTexto({ nome: 'descricao', rotulo: 'Descrição', max: 300, linhas: 2, valor: perfil?.descricao ?? '', id: 'perfil-descricao' }),
    ...(modelos ? [modelos] : []),
    matrizPermissoes(form, codigosDoPerfil(perfil)),
    el('div', { class: 'grupo-botoes' }, botao,
      editando ? el('a', { class: 'botao botao--texto', href: `/business/equipe.html?id=${encodeURIComponent(id)}#perfis` }, 'Cancelar edição') : null));
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limparErros(form);
    const dados = valores(form);
    const permissoes = [...form.querySelectorAll('input[name="permissoes"]:checked')].map((c) => c.value);
    if (!dados.nome || dados.nome.length < 2) {
      erroNoCampo(form, 'nome', 'Dê um nome ao perfil (2 a 60 caracteres).');
      return;
    }
    if (!permissoes.length) {
      document.getElementById('perfil-permissoes-erro').textContent = 'Escolha pelo menos uma permissão.';
      form.querySelector('input[name="permissoes"]:not(:disabled)')?.focus();
      return;
    }
    ocupado(botao, () => (editando
      ? executar(`perfil-${perfil.id}`, form, (k) => alterarPerfil(perfil.id, dados.nome, dados.descricao, permissoes, perfil.versao, k), () => {
        history.replaceState(null, '', `${location.pathname}?id=${encodeURIComponent(id)}`);
        anunciar('sucesso', `Perfil "${dados.nome}" salvo.`, el('p', {}, 'Quem usa este perfil passa a ter as novas permissões na próxima ação.'));
      })
      : executar('perfil-novo', form, (k) => criarPerfil(id, dados.nome, dados.descricao, permissoes, k),
        () => anunciar('sucesso', `Perfil "${dados.nome}" criado.`, el('p', {}, 'Agora você pode usá-lo nos convites.')))));
  });
  return el('div', { class: 'cartao pilha' }, el('h3', { id: 'titulo-form-perfil' }, editando ? `Editar perfil "${perfil.nome}"` : 'Novo perfil de acesso'), form);
}

/** Limite de desconto do perfil (D6-04): visível a quem vê a equipe; só o proprietário altera. */
function blocoDesconto(p) {
  const atual = p.desconto_maximo_percentual === null || p.desconto_maximo_percentual === undefined ? 0 : Number(p.desconto_maximo_percentual);
  const texto = el('p', { class: 'cartao__meta' }, `Desconto máximo: ${String(atual).replace('.', ',')}% do valor dos produtos.`);
  if (!proprietario()) return texto;
  const idCampo = `desconto-${p.id}`;
  const botao = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Salvar limite');
  const form = el('form', { class: 'pilha', novalidate: true },
    campoTexto({ nome: 'percentual', rotulo: 'Desconto máximo (%)', valor: String(atual).replace('.', ','), id: idCampo,
      ajuda: 'De 0 a 100. Acima do limite, só o proprietário confirma a venda.' }),
    el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const bruto = (valores(form).percentual ?? '').replace(',', '.');
    const n = Number(bruto);
    if (bruto === '' || !Number.isFinite(n) || n < 0 || n > 100 || !/^\d{1,3}(\.\d{1,2})?$/.test(bruto)) {
      erroNoCampo(form, 'percentual', 'Use um número de 0 a 100, com até duas casas.');
      return;
    }
    ocupado(botao, () => executar(`desconto-${p.id}`, form, (k) => definirDescontoMaximo(p.id, n, p.versao, k),
      () => anunciar('sucesso', `Limite de desconto do perfil "${p.nome}" salvo.`)));
  });
  return el('div', { class: 'pilha' }, texto, el('details', {}, el('summary', {}, 'Alterar limite de desconto'), form));
}

function cartaoPerfil(p) {
  const usam = estado.membros.filter((m) => m.estado === 'ativo' && m.perfil_id === p.id);
  const codigos = codigosDoPerfil(p);
  const modulos = [...new Set(estado.catalogo.filter((c) => codigos.includes(c.codigo)).map((c) => c.modulo_nome))];
  const acoes = [];
  if (estado.pode('equipe.alterar')) {
    if (p.id === meuPerfilId()) {
      acoes.push(el('p', { class: 'campo__ajuda' }, 'Este é o seu perfil. Para alterá-lo, peça a outra pessoa que administre a equipe.'));
    } else if (!contidoNasMinhas(codigos)) {
      acoes.push(el('p', { class: 'campo__ajuda' }, 'Este perfil tem permissões que você não tem; você não pode alterá-lo.'));
    } else {
      acoes.push(el('a', { class: 'botao botao--secundario', href: `/business/equipe.html?id=${encodeURIComponent(id)}&perfil=${encodeURIComponent(p.id)}#titulo-form-perfil` }, 'Editar'));
      const desativar = el('button', { type: 'button', class: 'botao botao--texto' }, 'Desativar');
      desativar.addEventListener('click', () => ocupado(desativar, async () => {
        const ok = await abrirDialogo({ titulo: `Desativar o perfil "${p.nome}"?`,
          mensagens: ['O perfil deixa de aparecer nas escolhas. Só é possível desativar um perfil que ninguém usa e sem convites pendentes.'],
          rotuloConfirmar: 'Desativar perfil', rotuloCancelar: 'Manter perfil' });
        if (!ok) return;
        await executar(`desativar-${p.id}`, null, (k) => desativarPerfil(p.id, p.versao, k), () => anunciar('sucesso', `Perfil "${p.nome}" desativado.`));
      }));
      acoes.push(desativar);
    }
  }
  return el('li', { class: 'cartao pilha', 'data-perfil': p.id },
    el('h3', { class: 'cartao__titulo' }, p.nome),
    p.descricao ? el('p', {}, p.descricao) : null,
    codigos.includes('vendas.aplicar_desconto') ? blocoDesconto(p) : null,
    el('p', { class: 'cartao__meta' }, `${codigos.length} permissões · usado por ${usam.length} ${usam.length === 1 ? 'pessoa' : 'pessoas'}`),
    el('p', { class: 'resumo-perfil' }, resumoModulos(codigos) || 'Sem permissões.'),
    el('details', {}, el('summary', {}, 'Ver permissões'),
      el('ul', { class: 'lista-simples' }, ...modulos.map((nome) => el('li', {},
        el('strong', {}, `${nome}: `),
        estado.catalogo.filter((c) => c.modulo_nome === nome && codigos.includes(c.codigo)).map((c) => c.acao_nome).join(', '))))),
    acoes.length ? el('div', { class: 'grupo-botoes' }, ...acoes) : null);
}

function secaoPerfis() {
  const editarId = parametro('perfil');
  const emEdicao = editarId ? estado.perfis.find((p) => p.id === editarId) : null;
  const podeEditar = estado.pode('equipe.alterar');
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-perfis' },
    el('h2', { id: 'titulo-perfis' }, 'Perfis de acesso'),
    el('p', {}, 'Um perfil é um conjunto de permissões com um nome do seu negócio. Mudar um perfil muda o acesso de todos que o usam.'),
    estado.perfis.length ? el('ul', { class: 'lista-simples' }, ...estado.perfis.map(cartaoPerfil)) : el('p', {}, 'Nenhum perfil criado ainda.'),
    podeEditar ? formularioPerfil(emEdicao && emEdicao.id !== meuPerfilId() && contidoNasMinhas(codigosDoPerfil(emEdicao)) ? emEdicao : null) : null);
}

// --- Histórico ----------------------------------------------------------------

const nomeDaPermissao = (codigo) => {
  const p = estado.catalogo.find((c) => c.codigo === codigo);
  return p ? `${p.modulo_nome}: ${p.acao_nome}` : codigo;
};

function descreverEvento(ev) {
  const d = ev.detalhes ?? {};
  const partes = [];
  if (ev.alvo_nome && ev.alvo_nome !== ev.ator_nome) partes.push(`Pessoa: ${ev.alvo_nome}`);
  if (d.email) partes.push(`E-mail: ${d.email}`);
  if (d.perfil) partes.push(`Perfil: ${d.perfil}`);
  if (d.nome) partes.push(`Perfil: ${d.nome}`);
  if (d.nome_antes && d.nome_antes !== d.nome_depois) partes.push(`Nome: ${d.nome_antes} → ${d.nome_depois}`);
  else if (d.nome_depois) partes.push(`Perfil: ${d.nome_depois}`);
  if (d.perfil_depois) partes.push(`Perfil: ${d.perfil_antes ?? 'nenhum'} → ${d.perfil_depois}`);
  if (d.incluidas?.length) partes.push(`Incluídas: ${d.incluidas.map(nomeDaPermissao).join(', ')}`);
  if (d.retiradas?.length) partes.push(`Retiradas: ${d.retiradas.map(nomeDaPermissao).join(', ')}`);
  if (d.motivo) partes.push(`Motivo: ${d.motivo}`);
  return partes.join(' · ');
}

function secaoHistorico() {
  const eventos = estado.historico;
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-historico-equipe' },
    el('h2', { id: 'titulo-historico-equipe' }, 'Histórico da equipe'),
    el('p', { class: 'campo__ajuda' }, 'Registro permanente: ninguém consegue apagar ou alterar estes eventos.'),
    eventos.length
      ? el('ol', { class: 'lista-simples' }, ...eventos.map((ev) => el('li', {},
        el('p', {}, el('strong', {}, ROTULOS_EVENTOS_EQUIPE[ev.tipo] ?? ev.tipo), ` · ${formatarDataHora(ev.criado_em)} · por ${ev.ator_nome ?? 'pessoa removida'}`),
        descreverEvento(ev) ? el('p', {}, descreverEvento(ev)) : null)))
      : el('p', {}, 'Nenhum evento registrado.'));
}

// --- Carregamento ---------------------------------------------------------------

async function carregar() {
  if (!id) {
    area.replaceChildren(aviso('info', 'Empresa não informada.', el('p', {}, el('a', { href: '/business/minhas-empresas.html' }, 'Ver suas empresas'))));
    return;
  }
  voltar.href = `/business/empresa.html?id=${encodeURIComponent(id)}`;
  mostrarCarregando(area, 'Carregando a equipe');
  try {
    if (!(await exigirSessao(area))) return;
    let acesso;
    try {
      acesso = await minhasPermissoes(id);
    } catch (erro) {
      if (erro.codigo === 'TENANT_FORBIDDEN') {
        modalConvite?.fechar();
        semAcesso(area);
        return;
      }
      throw erro;
    }
    const minhas = new Set(acesso.permissoes);
    const pode = (codigo) => minhas.has(codigo);
    if (!pode('equipe.visualizar')) {
      modalConvite?.fechar();
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não inclui a equipe desta empresa.',
        el('p', {}, el('a', { href: `/business/empresa.html?id=${encodeURIComponent(id)}` }, 'Voltar para a empresa')))));
      return;
    }
    const [empresa, cat, perfis, membros, convites, historico] = await Promise.all([
      lerEmpresa(id), catalogo(), lerPerfis(id), lerMembros(id), convitesPendentes(id), historicoEquipe(id)]);
    estado = { acesso, pode, minhas, empresa, catalogo: cat, perfis, membros, convites, historico };
    definirEmpresaAtiva({ id, nome: empresa?.nome_publico, papel: acesso.papel, permissoes: acesso.permissoes, dado_de_teste: empresa?.dado_de_teste });
    titulo.textContent = `Equipe de ${empresa?.nome_publico ?? 'empresa'}`;
    document.title = `Equipe de ${empresa?.nome_publico ?? 'empresa'} | AutoniCK Business`;
    concluirCarregamento(area);
    if (modalConvite && !pode('equipe.convidar')) modalConvite.fechar();
    const ativos = membros.filter((m) => m.estado === 'ativo').length;
    const grupoAbas = abas({ rotulo: 'Partes da equipe', ativa: abaAtiva, aoTrocar: (k) => { abaAtiva = k; },
      itens: [
        { chave: 'pessoas', titulo: 'Pessoas', contador: ativos, painel: secaoMembros() },
        { chave: 'perfis', titulo: 'Perfis de acesso', contador: perfis.length, painel: secaoPerfis() },
        { chave: 'historico', titulo: 'Histórico', painel: secaoHistorico() },
      ] });
    trocarAba = (k) => { grupoAbas.ativar(k, { focar: true }); };
    area.append(...[
      empresa?.dado_de_teste ? el('p', { class: 'opcoes' }, chipTeste()) : null,
      grupoAbas.elemento,
    ].filter(Boolean));
    const alvo = location.hash.slice(1);
    if (alvo && !['pessoas', 'perfis', 'historico'].includes(alvo)) document.getElementById(alvo)?.scrollIntoView({ block: 'start' });
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
