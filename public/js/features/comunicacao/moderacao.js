/**
 * Denúncia e contestação na interface (M12; D12-16, D12-18 = C, D12-22). O banco confere quem pode denunciar o quê
 * (conta logada; mensagem só por participante) e quem é a parte afetada; aqui só abrimos o diálogo e mostramos o retorno.
 * Quem foi denunciado nunca sabe quem denunciou.
 */
import { el } from '../../ui/dom.js';
import { campoTexto, campoSelecao, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { dialogoFormulario } from '../vendas/comum.js';
import { novaChave } from '../../data/empresas.js';
import { CATEGORIAS_DENUNCIA, denunciar, contestarModeracao } from '../../data/comunicacao.js';

const avisoPadrao = (tipo, texto) => {
  const alvo = document.getElementById('avisos');
  if (!alvo) return;
  alvo.replaceChildren(el('div', { role: tipo === 'erro' ? 'alert' : 'status', class: `aviso aviso--${tipo}` }, el('p', {}, texto)));
  alvo.scrollIntoView({ block: 'nearest' });
};

/** Executa com uma chave estável enquanto a resposta for incerta (a repetição não duplica a operação). */
async function comChave(estado, chamada) {
  estado.chave ??= novaChave();
  const r = await chamada(estado.chave);
  estado.chave = null;
  return r;
}

export function botaoDenunciar(alvoTipo, alvoId, { rotulo = 'Denunciar', anunciar = avisoPadrao, descricaoAlvo = 'este conteúdo' } = {}) {
  const botao = el('button', { type: 'button', class: 'botao botao--texto', 'data-denunciar': alvoTipo, 'data-alvo': alvoId }, rotulo);
  const estado = { chave: null };
  botao.addEventListener('click', () => ocupado(botao, async () => {
    const r = await dialogoFormulario({ id: 'denuncia', titulo: `Denunciar ${descricaoAlvo}`, rotuloConfirmar: 'Enviar denúncia',
      descricao: ['A equipe da CK analisa a denúncia e decide com justificativa. Quem foi denunciado não sabe quem denunciou.',
        'A CK vê só o conteúdo denunciado e os dados necessários para analisá-lo.'],
      campos: [campoSelecao({ nome: 'categoria', rotulo: 'Motivo', opcoes: Object.entries(CATEGORIAS_DENUNCIA), obrigatorio: true, id: 'denuncia-categoria' }),
        campoTexto({ nome: 'descricao', rotulo: 'Descreva o problema (opcional; obrigatório em "Outro motivo")', linhas: 3, max: 1000, id: 'denuncia-descricao' })],
      validar: (form) => {
        const v = valores(form);
        if (!v.categoria) return erroNoCampo(form, 'categoria', 'Escolha o motivo.') && null;
        if (v.categoria === 'outro' && (v.descricao ?? '').trim().length < 10) return erroNoCampo(form, 'descricao', 'Descreva o problema com pelo menos 10 caracteres.') && null;
        return v;
      } });
    if (!r) return;
    try {
      const d = await comChave(estado, (k) => denunciar(alvoTipo, alvoId, r.categoria, r.descricao || null, k));
      anunciar('sucesso', `Denúncia registrada (protocolo nº ${d.protocolo}). Acompanhe em "Minha conta".`);
    } catch (erro) {
      if (erro.codigo !== 'NETWORK_UNKNOWN') estado.chave = null;
      anunciar('erro', erro.codigo === 'NETWORK_UNKNOWN' ? `${erro.message} Tente de novo: a denúncia não será duplicada.` : erro.message);
    }
  }));
  return botao;
}

/** Contestação da parte afetada (uma por decisão). */
export function botaoContestar(decisaoId, { anunciar = avisoPadrao, aoConcluir } = {}) {
  const botao = el('button', { type: 'button', class: 'botao botao--secundario', 'data-contestar': decisaoId }, 'Contestar a decisão');
  const estado = { chave: null };
  botao.addEventListener('click', () => ocupado(botao, async () => {
    const r = await dialogoFormulario({ id: 'contestacao', titulo: 'Contestar a decisão da moderação', rotuloConfirmar: 'Enviar contestação',
      descricao: ['Cada decisão pode ser contestada uma vez. Outra pessoa da CK analisa, quando houver alguém disponível.'],
      campos: [campoTexto({ nome: 'motivo', rotulo: 'Por que a decisão deve ser revista?', obrigatorio: true, linhas: 3, max: 1000, id: 'contestacao-motivo' })],
      validar: (form) => {
        const v = valores(form);
        return (v.motivo ?? '').trim().length >= 10 ? v : (erroNoCampo(form, 'motivo', 'Explique com pelo menos 10 caracteres.') && null);
      } });
    if (!r) return;
    try {
      await comChave(estado, (k) => contestarModeracao(decisaoId, r.motivo, k));
      anunciar('sucesso', 'Contestação enviada. Você verá o resultado aqui.');
      await aoConcluir?.();
    } catch (erro) {
      if (erro.codigo !== 'NETWORK_UNKNOWN') estado.chave = null;
      anunciar('erro', erro.message);
    }
  }));
  return botao;
}

const RESULTADO = { restaurar: 'decisão revista: conteúdo restaurado', manter: 'decisão mantida' };
const ESTADO_CONTESTACAO = { aberta: 'contestação enviada, aguardando análise', em_revisao: 'contestação em análise', decidida: 'contestação analisada' };

/** Marca de moderação para o autor (D12-18 = C): o próprio conteúdo continua visível para ele, com o motivo resumido. */
export function marcaModeracaoAutor(moderacao, { anunciar, aoConcluir, oculto = true } = {}) {
  if (!moderacao) return null;
  const c = moderacao.contestacao;
  return el('div', { class: 'pilha', 'data-moderacao': moderacao.medida },
    el('p', { class: 'chip chip--alerta chip--quebra' }, oculto ? 'Oculto para os outros pela moderação' : 'Recusado pela moderação'),
    moderacao.motivo ? el('p', { class: 'campo__ajuda' }, `Motivo: ${moderacao.motivo}`) : null,
    c ? el('p', { class: 'campo__ajuda', 'data-contestacao': c.estado }, `Situação: ${ESTADO_CONTESTACAO[c.estado] ?? c.estado}${c.resultado ? ` (${RESULTADO[c.resultado] ?? c.resultado})` : ''}.`) : null,
    moderacao.pode_contestar ? botaoContestar(moderacao.decisao_id, { anunciar, aoConcluir }) : null);
}
