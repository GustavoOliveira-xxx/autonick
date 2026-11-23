/**
 * Moderação no painel CK (M12; RF-166, RF-172; D12-11, D12-12, D12-17, D12-18, D12-22). Pré-moderação de avaliações e
 * respostas; denúncias com só o conteúdo denunciado e os dados necessários (nunca a conversa inteira nem quem denunciou);
 * contestações decididas por outra pessoa da CK quando houver alguém elegível. Impedimentos (membro da empresa, autor do
 * conteúdo, quem denunciou) vêm do banco, que também recusa a ação.
 */
import { el } from '../../ui/dom.js';
import { aviso } from '../../ui/estados.js';
import { campoTexto, grupoOpcoes, ocupado } from '../../ui/formulario.js';
import { formatarDataHora } from '../empresa/comum.js';
import { CATEGORIAS_DENUNCIA, ckModerarPublicacao, ckAssumirDenuncia, ckDecidirDenuncia, ckAssumirContestacaoModeracao,
  ckDecidirContestacaoModeracao } from '../../data/comunicacao.js';

const ALVO = { empresa: 'Empresa', avaliacao: 'Avaliação', resposta: 'Resposta da empresa', mensagem: 'Mensagem da conversa',
  mensagem_m08: 'Mensagem da conversa', atualizacao_os: 'Atualização pública da OS' };
const MEDIDA = { arquivar: 'Arquivar', ocultar: 'Ocultar o conteúdo', encaminhar_suspensao: 'Encaminhar à suspensão da vitrine',
  aprovar: 'Aprovar', recusar: 'Recusar', restaurar: 'Restaurar (rever a decisão)', manter: 'Manter a decisão' };

const campoMotivo = (obrigatorio) => campoTexto({ nome: 'motivo_resumo', rotulo: `Motivo resumido para as partes${obrigatorio ? '' : ' (opcional)'}`,
  linhas: 2, max: 300, ajuda: 'De 10 a 300 caracteres. A parte afetada vê este texto; nunca quem denunciou.' });
const campoJustificativa = (obrigatorio) => campoTexto({ nome: 'justificativa', rotulo: `Justificativa interna${obrigatorio ? '' : ' (opcional)'}`,
  linhas: 3, max: 2000, ajuda: 'De 20 a 2.000 caracteres. Fica no registro imutável da decisão, visível só para a CK.' });

/** Conteúdo mínimo mostrado à CK. */
function conteudo(tipo, c) {
  if (!c) return null;
  if (tipo === 'avaliacao') return el('div', { class: 'cartao pilha' }, el('p', {}, el('strong', {}, `Nota ${c.nota} de 5`)), c.comentario ? el('p', {}, c.comentario) : null,
    c.sinaliza_contato ? el('p', { class: 'chip chip--alerta' }, 'Comentário com telefone, e-mail ou endereço') : null);
  if (tipo === 'resposta') return el('div', { class: 'cartao pilha' }, el('p', {}, c.texto),
    c.avaliacao ? el('p', { class: 'campo__ajuda' }, `Responde à avaliação: nota ${c.avaliacao.nota} de 5${c.avaliacao.comentario ? `, "${c.avaliacao.comentario}"` : ''}`) : null,
    c.sinaliza_contato ? el('p', { class: 'chip chip--alerta' }, 'Resposta com telefone, e-mail ou endereço') : null);
  if (tipo === 'empresa') return el('p', {}, `Empresa: ${c.nome_publico}`);
  return el('div', { class: 'cartao pilha', 'data-conteudo-denunciado': '' },
    el('p', {}, el('strong', {}, c.autor === 'cliente' ? 'Escrita pelo cliente' : 'Escrita pela empresa'), ` · ${formatarDataHora(c.data)} · ${c.atendimento ?? ''}`),
    el('p', {}, c.texto),
    el('p', { class: 'campo__ajuda' }, 'Só esta mensagem é mostrada; o restante da conversa não fica disponível para a CK.'));
}

const impedido = (texto) => (texto ? aviso('alerta', 'Você não pode decidir este item.', el('p', {}, texto)) : null);

function botaoAssumir(rotulo, item, executar, { anunciar, carregar, chave }) {
  const b = el('button', { type: 'button', class: 'botao botao--secundario', 'data-assumir': item }, rotulo);
  b.addEventListener('click', () => ocupado(b, async () => {
    try {
      await executar(chave(item));
      await carregar();
      anunciar('sucesso', 'Análise assumida. Decida quando concluir.');
    } catch (erro) {
      anunciar('erro', erro.message);
      await carregar();
    }
  }));
  return b;
}

function itemPublicacao(tipo, x, { formDecisao }) {
  const item = `pub-${tipo}-${x.id}`;
  return el('li', { class: 'cartao pilha', [`data-moderar-${tipo}`]: x.id },
    el('h3', { class: 'cartao__titulo' }, `${tipo === 'avaliacao' ? 'Avaliação' : 'Resposta'} de ${x.empresa}`),
    conteudo(tipo, x.conteudo),
    el('p', { class: 'campo__ajuda' }, `Enviada em ${formatarDataHora(x.conteudo?.data)}. Só aparece na vitrine depois de aprovada.`),
    impedido(x.impedimento) ?? formDecisao({
      item, titulo: `Decisão sobre a ${tipo === 'avaliacao' ? 'avaliação' : 'resposta'}`, botao: 'Registrar decisão',
      campos: [grupoOpcoes({ nome: 'medida', legenda: 'Decisão', opcoes: [['aprovar', 'Aprovar e publicar'], ['recusar', 'Recusar']] }),
        campoMotivo(false), campoJustificativa(false)],
      validar: (d) => (!d.medida ? ['medida', 'Escolha aprovar ou recusar.']
        : d.medida === 'recusar' && (d.motivo_resumo ?? '').trim().length < 10 ? ['motivo_resumo', 'Escreva o motivo resumido da recusa (pelo menos 10 caracteres).']
          : d.medida === 'recusar' && (d.justificativa ?? '').trim().length < 20 ? ['justificativa', 'Justifique a recusa (pelo menos 20 caracteres).'] : null),
      executar: (d, k) => ckModerarPublicacao(tipo, x.id, d.medida, d.motivo_resumo || null, d.justificativa || null, k),
      sucesso: 'Decisão registrada.' }));
}

function itemDenuncia(d, ajuda) {
  const { formDecisao } = ajuda;
  let acao;
  if (d.impedimento) acao = impedido(d.impedimento);
  else if (d.estado === 'aberta') acao = el('div', { class: 'grupo-botoes' }, botaoAssumir('Assumir a análise', `assumir-den-${d.id}`, (k) => ckAssumirDenuncia(d.id, k), ajuda));
  else if (!d.assumida_por_mim) acao = el('p', { class: 'campo__ajuda' }, 'Em análise por outra pessoa da CK.');
  else {
    const medidas = d.alvo_tipo === 'empresa' ? ['arquivar', 'encaminhar_suspensao'] : ['arquivar', 'ocultar'];
    acao = formDecisao({ item: `den-${d.id}`, titulo: `Decisão da denúncia ${d.protocolo}`, botao: 'Registrar decisão',
      campos: [grupoOpcoes({ nome: 'medida', legenda: 'Medida', opcoes: medidas.map((m) => [m, MEDIDA[m]]) }), campoMotivo(true), campoJustificativa(true)],
      validar: (v) => (!v.medida ? ['medida', 'Escolha a medida.']
        : (v.motivo_resumo ?? '').trim().length < 10 ? ['motivo_resumo', 'Escreva o motivo resumido (pelo menos 10 caracteres).']
          : (v.justificativa ?? '').trim().length < 20 ? ['justificativa', 'Justifique a decisão (pelo menos 20 caracteres).'] : null),
      executar: (v, k) => ckDecidirDenuncia(d.id, v.medida, v.motivo_resumo, v.justificativa, k),
      sucesso: d.alvo_tipo === 'empresa' ? 'Decisão registrada. Se encaminhou à suspensão, use "Suspender a vitrine" na lista de empresas.' : 'Decisão registrada.' });
  }
  return el('li', { class: 'cartao pilha', 'data-denuncia': d.protocolo },
    el('h3', { class: 'cartao__titulo' }, `Denúncia nº ${d.protocolo} · ${ALVO[d.alvo_tipo] ?? d.alvo_tipo}`),
    el('p', {}, `${d.empresa} · ${CATEGORIAS_DENUNCIA[d.categoria] ?? d.categoria} · ${formatarDataHora(d.criado_em)} · ${d.estado === 'aberta' ? 'aberta' : 'em análise'}`),
    d.descricao ? el('p', {}, `Relato: ${d.descricao}`) : null,
    d.conteudo?.oculto ? el('p', { class: 'chip chip--alerta' }, 'Conteúdo já ocultado') : null,
    conteudo(d.alvo_tipo, d.conteudo),
    acao);
}

function itemContestacao(c, ajuda) {
  const { formDecisao } = ajuda;
  let acao;
  if (c.impedimento) acao = impedido(c.impedimento);
  else if (c.estado === 'aberta') acao = el('div', { class: 'grupo-botoes' }, botaoAssumir('Assumir a contestação', `assumir-ct-${c.id}`, (k) => ckAssumirContestacaoModeracao(c.id, k), ajuda));
  else if (!c.assumida_por_mim) acao = el('p', { class: 'campo__ajuda' }, 'Em análise por outra pessoa da CK.');
  else {
    acao = formDecisao({ item: `ct-${c.id}`, titulo: 'Decisão da contestação', botao: 'Registrar decisão',
      campos: [grupoOpcoes({ nome: 'medida', legenda: 'Decisão', opcoes: [['restaurar', MEDIDA.restaurar], ['manter', MEDIDA.manter]] }), campoMotivo(true), campoJustificativa(true)],
      validar: (v) => (!v.medida ? ['medida', 'Escolha a decisão.']
        : (v.motivo_resumo ?? '').trim().length < 10 ? ['motivo_resumo', 'Escreva o motivo resumido (pelo menos 10 caracteres).']
          : (v.justificativa ?? '').trim().length < 20 ? ['justificativa', 'Justifique a decisão (pelo menos 20 caracteres).'] : null),
      executar: (v, k) => ckDecidirContestacaoModeracao(c.id, v.medida, v.motivo_resumo, v.justificativa, k),
      sucesso: 'Decisão da contestação registrada.' });
  }
  return el('li', { class: 'cartao pilha', 'data-contestacao-moderacao': c.id },
    el('h3', { class: 'cartao__titulo' }, `Contestação · ${ALVO[c.alvo_tipo] ?? c.alvo_tipo} · ${c.empresa}`),
    el('p', {}, `Decisão contestada: ${MEDIDA[c.decisao.medida] ?? c.decisao.medida} em ${formatarDataHora(c.decisao.data)}${c.decisao.decidida_por_mim ? ' (decidida por você)' : ''}`),
    c.decisao.motivo ? el('p', {}, `Motivo dado às partes: ${c.decisao.motivo}`) : null,
    c.decisao.justificativa ? el('p', { class: 'campo__ajuda' }, `Justificativa registrada: ${c.decisao.justificativa}`) : null,
    el('p', {}, `Contestação: ${c.motivo}`),
    c.decisao.decidida_por_mim && !c.impedimento
      ? el('p', { class: 'chip chip--alerta chip--quebra' }, 'Não há outra pessoa da CK elegível: a decisão fica registrada como tomada pela mesma pessoa.') : null,
    conteudo(c.alvo_tipo, c.conteudo),
    acao);
}

/** Seções de moderação do painel. `ajuda`: { formDecisao, anunciar, carregar, chave, secao }. */
export function secoesModeracao(fila, ajuda) {
  const { secao } = ajuda;
  if (!fila) return [el('section', { class: 'pilha', id: 'moderacao-indisponivel' }, aviso('alerta', 'Não foi possível carregar a moderação agora.',
    el('p', {}, 'Recarregue a página para tentar de novo.')))];
  return [
    secao('titulo-mod-avaliacoes', 'Avaliações aguardando análise', fila.avaliacoes.map((x) => itemPublicacao('avaliacao', x, ajuda)), 'Nenhuma avaliação aguardando análise.'),
    secao('titulo-mod-respostas', 'Respostas de empresas aguardando análise', fila.respostas.map((x) => itemPublicacao('resposta', x, ajuda)), 'Nenhuma resposta aguardando análise.'),
    secao('titulo-mod-denuncias', 'Denúncias', fila.denuncias.map((d) => itemDenuncia(d, ajuda)), 'Nenhuma denúncia em aberto.'),
    secao('titulo-mod-contestacoes', 'Contestações de moderação', fila.contestacoes.map((c) => itemContestacao(c, ajuda)), 'Nenhuma contestação de moderação em aberto.'),
  ];
}
