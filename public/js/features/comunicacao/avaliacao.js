/**
 * Avaliação do atendimento pelo Cliente (M12; D12-09 a D12-13). Só o titular avalia, uma vez por OS encerrada, em até 60
 * dias; sem edição depois de enviar; pode retirar (e não avaliar de novo). A avaliação só aparece na vitrine depois da
 * aprovação da CK, como "Cliente verificado", com mês e ano. Sem imagem (RF-163 PARCIAL, ADR-006 = B).
 */
import { el } from '../../ui/dom.js';
import { campoTexto, grupoOpcoes, erroNoCampo, limparErros, ocupado, valores } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { novaChave } from '../../data/empresas.js';
import { minhaAvaliacaoOs, avaliarOs, retirarAvaliacao } from '../../data/comunicacao.js';
import { formatarDataHora } from '../empresa/comum.js';
import { marcaModeracaoAutor } from './moderacao.js';

const ESTADO = {
  aguardando: ['chip--alerta', 'Aguardando a análise da CK'],
  publicada: ['chip--sucesso', 'Publicada na vitrine'],
  recusada: ['chip--erro', 'Recusada pela moderação'],
  retirada: ['chip--neutro', 'Retirada por você'],
};

export const textoNota = (n) => `Nota ${n} de 5`;

function cartaoMinha(a, { anunciar, recarregar }) {
  const [classe, rotulo] = a.oculta ? ['chip--alerta', 'Ocultada pela moderação'] : ESTADO[a.estado] ?? ['chip--neutro', a.estado];
  const retirar = ['aguardando', 'publicada'].includes(a.estado)
    ? el('button', { type: 'button', class: 'botao botao--secundario', id: 'retirar-avaliacao' }, 'Retirar a avaliação') : null;
  let chave = null;
  retirar?.addEventListener('click', () => ocupado(retirar, async () => {
    const ok = await abrirDialogo({ titulo: 'Retirar a avaliação?', rotuloConfirmar: 'Retirar', rotuloCancelar: 'Voltar',
      mensagens: ['A avaliação deixa de aparecer na vitrine e não será possível avaliar este atendimento de novo.'] });
    if (!ok) return;
    try {
      chave ??= novaChave();
      await retirarAvaliacao(a.id, chave);
      chave = null;
      anunciar?.('sucesso', 'Avaliação retirada.');
      await recarregar();
    } catch (erro) {
      if (erro.codigo !== 'NETWORK_UNKNOWN') chave = null;
      anunciar?.('erro', erro.message);
    }
  }));
  return el('div', { class: 'cartao pilha', id: 'minha-avaliacao', 'data-estado': a.oculta ? 'oculta' : a.estado },
    el('p', {}, el('strong', {}, textoNota(a.nota)), ' ', el('span', { class: `chip ${classe}` }, rotulo)),
    a.comentario ? el('p', {}, a.comentario) : null,
    el('p', { class: 'campo__ajuda' }, `Enviada em ${formatarDataHora(a.criado_em)}.`),
    a.moderacao ? marcaModeracaoAutor(a.moderacao, { anunciar, aoConcluir: recarregar, oculto: a.oculta }) : null,
    a.resposta ? el('div', { class: 'cartao pilha', id: 'resposta-empresa' }, el('p', {}, el('strong', {}, `Resposta da empresa (${a.resposta.data})`)),
      el('p', {}, a.resposta.texto)) : null,
    retirar ? el('div', { class: 'grupo-botoes' }, retirar) : null);
}

function formulario(osId, prazo, { anunciar, recarregar }) {
  const enviar = el('button', { type: 'submit', class: 'botao' }, 'Enviar avaliação');
  const form = el('form', { class: 'pilha', id: 'form-avaliacao', novalidate: true },
    grupoOpcoes({ nome: 'nota', legenda: 'Sua nota (obrigatória)', opcoes: [5, 4, 3, 2, 1].map((n) => [String(n), `${n} de 5`]) }),
    campoTexto({ nome: 'comentario', rotulo: 'Comentário (opcional)', linhas: 3, max: 1000, id: 'avaliacao-comentario',
      ajuda: 'Não inclua telefone, e-mail ou endereço.' }),
    el('p', { class: 'campo__ajuda' }, 'A avaliação aparece na vitrine depois da análise da CK, como "Cliente verificado", sem o seu nome. Depois de enviar não é possível editar; você pode retirá-la.'),
    prazo ? el('p', { class: 'campo__ajuda' }, `Você pode avaliar até ${formatarDataHora(prazo)}.`) : null,
    el('div', { class: 'grupo-botoes' }, enviar));
  let chave = null;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const v = valores(form);
    if (!v.nota) return erroNoCampo(form, 'nota', 'Escolha uma nota de 1 a 5.');
    return ocupado(enviar, async () => {
      try {
        chave ??= novaChave();
        await avaliarOs(osId, Number(v.nota), v.comentario || null, chave);
        chave = null;
        anunciar?.('sucesso', 'Avaliação enviada. Ela aparece na vitrine depois da análise da CK.');
        await recarregar();
      } catch (erro) {
        if (erro.codigo !== 'NETWORK_UNKNOWN') chave = null;
        if (erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, erro.campo ?? 'nota', erro.message)) return;
        anunciar?.('erro', erro.message);
      }
    });
  });
  return form;
}

/** Seção "Avaliação" da OS do Cliente. */
export function secaoAvaliacaoCliente(osId, { anunciar } = {}) {
  const corpo = el('div', { class: 'pilha' }, el('p', { class: 'campo__ajuda' }, 'Carregando…'));
  const secao = el('section', { class: 'pilha', 'aria-labelledby': 'titulo-avaliacao', id: 'avaliacao' },
    el('h2', { id: 'titulo-avaliacao' }, 'Avaliação do atendimento'), corpo);
  async function recarregar() {
    try {
      const r = await minhaAvaliacaoOs(osId);
      if (r.avaliacao) corpo.replaceChildren(cartaoMinha(r.avaliacao, { anunciar, recarregar }));
      else if (r.elegivel) corpo.replaceChildren(formulario(osId, r.prazo_ate, { anunciar, recarregar }));
      else corpo.replaceChildren(el('p', { id: 'avaliacao-indisponivel' }, r.motivo));
    } catch (erro) {
      corpo.replaceChildren(el('p', { class: 'campo__ajuda' }, `Não foi possível carregar a avaliação (${erro.message}).`));
    }
  }
  recarregar();
  return secao;
}

/** Bloco de avaliações da vitrine (D12-13, D12-14): média só a partir de 3; ocultas só como indicação. */
export function blocoAvaliacoesVitrine(av, { logado = false, botaoDenunciar } = {}) {
  if (!av) return null;
  const titulo = av.media !== null && av.media !== undefined
    ? `Avaliações: média ${String(av.media).replace('.', ',')} de 5 (${av.quantidade})`
    : `Avaliações (${av.quantidade})`;
  const itens = av.itens.map((i) => (i.oculta
    ? el('li', { class: 'cartao', 'data-avaliacao': i.id, 'data-oculta': '' }, el('p', {}, el('em', {}, `Avaliação ocultada pela moderação (${i.data}).`)))
    : el('li', { class: 'cartao pilha', 'data-avaliacao': i.id },
      el('p', {}, el('strong', {}, textoNota(i.nota)), ` · ${i.autor} · ${i.data}`),
      i.comentario ? el('p', {}, i.comentario) : null,
      i.resposta ? el('div', { class: 'cartao pilha', 'data-resposta': i.resposta.id },
        el('p', {}, el('strong', {}, `Resposta da empresa (${i.resposta.data})`)), el('p', {}, i.resposta.texto),
        logado && botaoDenunciar ? el('div', { class: 'grupo-botoes' }, botaoDenunciar('resposta', i.resposta.id, { descricaoAlvo: 'esta resposta' })) : null) : null,
      logado && botaoDenunciar ? el('div', { class: 'grupo-botoes' }, botaoDenunciar('avaliacao', i.id, { descricaoAlvo: 'esta avaliação' })) : null)));
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-avaliacoes', id: 'avaliacoes' },
    el('h2', { id: 'titulo-avaliacoes' }, titulo),
    av.media === null || av.media === undefined
      ? el('p', { class: 'campo__ajuda', id: 'avaliacoes-sem-media' }, `A média aparece a partir de ${av.minimo_para_media} avaliações publicadas.`) : null,
    el('p', { class: 'campo__ajuda' }, 'Só clientes com atendimento encerrado pela plataforma avaliam. Toda avaliação passa pela análise da CK antes de aparecer.'),
    itens.length ? el('ul', { class: 'pilha' }, ...itens) : el('p', {}, 'Ainda não há avaliações publicadas.'));
}
