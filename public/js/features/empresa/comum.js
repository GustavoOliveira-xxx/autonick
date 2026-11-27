/**
 * Utilidades das telas de empresa, equipe e do painel CK (M03 e M04).
 * A tela só orienta: quem decide acesso é o banco (RLS e RPCs).
 */
import { el } from '../../ui/dom.js';
import { aviso } from '../../ui/estados.js';
import { neon } from '../../data/sessao.js';
import { SITUACOES_VITRINE } from '../../data/empresas.js';

export const CHIP_SITUACAO = {
  publicada: ['chip--sucesso', '✓'],
  em_analise: ['chip--info', '…'],
  correcao_solicitada: ['chip--alerta', '!'],
  rascunho: ['chip--neutro', '•'],
  rejeitada: ['chip--erro', '✕'],
  suspensa: ['chip--erro', '✕'],
};

export function chipSituacao(situacao) {
  const [classe, icone] = CHIP_SITUACAO[situacao] ?? ['chip--neutro', '•'];
  return el('span', { class: `chip ${classe}` }, el('span', { 'aria-hidden': 'true' }, icone), `Vitrine: ${SITUACOES_VITRINE[situacao] ?? situacao}`);
}

export const chipErp = () => el('span', { class: 'chip chip--sucesso' }, el('span', { 'aria-hidden': 'true' }, '✓'), 'ERP: ativo');

/** Papel da pessoa na empresa (M04). */
export const chipPapel = (papel, perfilNome) => el('span', { class: 'chip chip--info' }, el('span', { 'aria-hidden': 'true' }, papel === 'proprietario' ? '★' : '•'),
  papel === 'proprietario' ? 'Você é proprietário' : `Seu acesso: ${perfilNome ?? 'funcionário'}`);

/** Empresa criada por testes automatizados (empresas [TESTE]). */
export const chipTeste = () => el('span', { class: 'chip chip--alerta' }, el('span', { 'aria-hidden': 'true' }, '!'), 'Dado de teste');

/** Mensagem para quem perdeu o acesso (desligamento ou saída) ou nunca teve (MINI-ESPEC_M04 §6). */
export function semAcesso(container) {
  container.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Você não tem mais acesso a esta empresa.',
    el('p', {}, 'Se isso for um engano, fale com quem administra a empresa.'),
    el('p', {}, el('a', { class: 'botao botao--secundario', href: '/business/minhas-empresas.html' }, 'Ver suas empresas')))));
}

/**
 * Garante serviço configurado e sessão; devolve a sessão ou null (já orientando a pessoa).
 * `perfil`: exige o perfil Business da identidade (verificado de novo no banco a cada ação).
 */
// M11 (D11-04, D11-09): na área do Cliente, a entrada volta para a mesma tela (o destino é validado na entrada).
const comVolta = (entrada) => (entrada.startsWith('/cliente/') && location.pathname.startsWith('/cliente/')
  ? `${entrada}?volta=${encodeURIComponent(location.pathname + location.search)}` : entrada);

export async function exigirSessao(container, { perfil = 'business', entrada = '/business/entrar.html' } = {}) {
  if (!neon.configurado) {
    container.replaceChildren(aviso('info', 'Esta área ainda não está disponível nesta versão.',
      el('p', {}, 'Ela funciona no ambiente de desenvolvimento conectado ao banco de dados.')));
    return null;
  }
  const sessao = await neon.sessao();
  if (!sessao) {
    container.replaceChildren(aviso('info', 'Entre na sua conta para continuar.',
      el('p', {}, el('a', { class: 'botao botao--secundario', href: comVolta(entrada) }, 'Ir para a entrada'))));
    return null;
  }
  if (perfil) {
    const perfis = await neon.meusPerfis();
    if (!perfis.some((p) => p.tipo_conta === perfil)) {
      const nome = perfil === 'cliente' ? 'Cliente' : 'Business';
      container.replaceChildren(aviso('alerta', `Esta conta ainda não tem perfil ${nome}.`,
        el('p', {}, el('a', { class: 'botao botao--secundario', href: comVolta(entrada) }, `Criar o perfil ${nome} na entrada`))));
      return null;
    }
  }
  return sessao;
}

const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
export const formatarDataHora = (iso) => (iso ? dataHora.format(new Date(iso)) : '');

export const ROTULOS_EVENTOS = {
  empresa_criada: 'Empresa criada',
  enviada_para_analise: 'Vitrine enviada para análise',
  aprovada: 'Aprovada para publicação',
  correcao_solicitada: 'Correção solicitada pela CK',
  rejeitada: 'Não aprovada pela CK',
  alteracao_enviada: 'Alteração enviada para análise',
  alteracao_aprovada: 'Alteração aprovada',
  alteracao_correcao_solicitada: 'Correção pedida na alteração',
  alteracao_rejeitada: 'Alteração não aprovada',
  alteracao_direta: 'Alteração de menor risco publicada',
  moderacao_mantida: 'Alteração mantida pela CK',
  moderacao_correcao_pedida: 'CK pediu correção de alteração publicada',
  moderacao_restaurada: 'CK restaurou a versão anterior',
  suspensa: 'Vitrine suspensa pela CK',
  reativada: 'Vitrine reativada pela CK',
  contestacao_aberta: 'Contestação enviada',
  contestacao_em_revisao: 'Contestação em revisão pela CK',
  contestacao_deferida: 'Contestação aceita',
  contestacao_indeferida: 'Contestação não aceita',
};

/** Lista de eventos sem identificar a pessoa da CK (MINI-ESPEC §8). */
export function listaHistorico(eventos) {
  if (!eventos.length) return el('p', {}, 'Nenhum evento registrado.');
  return el('ol', { class: 'lista-simples' }, ...eventos.map((ev) => el('li', {},
    el('p', {}, el('strong', {}, ROTULOS_EVENTOS[ev.tipo] ?? ev.tipo), ` · ${formatarDataHora(ev.criado_em)} · `,
      ev.papel_ator === 'ck' ? 'Equipe CK' : 'Gestor'),
    ev.motivo ? el('p', {}, `Motivo: ${ev.motivo}`) : null,
    ev.gravidade ? el('p', {}, `Gravidade: ${ev.gravidade === 'grave' ? 'grave' : 'comum'}${ev.fundamento ? ` (${ev.fundamento.replace('_', ' ')})` : ''}`) : null,
  )));
}
