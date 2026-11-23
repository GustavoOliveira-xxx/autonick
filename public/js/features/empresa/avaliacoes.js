/**
 * Avaliações da empresa (M12; D12-11 a D12-13, D12-18 = C). A equipe com vitrine.visualizar vê as avaliações já
 * aprovadas pela CK; quem tem vitrine.alterar responde uma vez, sem edição, e a resposta também passa pela CK antes de
 * aparecer. Avaliação oculta pela moderação aparece só como indicação. A empresa pode denunciar uma avaliação.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, erroNoCampo, limparErros, ocupado, valores } from '../../ui/formulario.js';
import { novaChave } from '../../data/empresas.js';
import { avaliacoesDaEmpresa, responderAvaliacao } from '../../data/comunicacao.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador } from '../estoque/comum.js';
import { botaoDenunciar, marcaModeracaoAutor } from '../comunicacao/moderacao.js';
import { textoNota } from '../comunicacao/avaliacao.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
const ESTADO_RESPOSTA = { aguardando: 'Aguardando a análise da CK', publicada: 'Publicada', recusada: 'Recusada pela moderação' };

function formResposta(a) {
  const enviar = el('button', { type: 'submit', class: 'botao' }, 'Enviar resposta');
  const form = el('form', { class: 'pilha', novalidate: true, 'data-responder': a.id },
    campoTexto({ nome: 'texto', rotulo: 'Resposta pública', linhas: 3, max: 1000, id: `resposta-${a.id}`,
      ajuda: 'Uma resposta por avaliação, sem edição depois de enviar. Ela aparece na vitrine depois da análise da CK.' }),
    el('div', { class: 'grupo-botoes' }, enviar));
  let chave = null;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const t = (valores(form).texto ?? '').trim();
    if (t.length < 2) return erroNoCampo(form, 'texto', 'Escreva a resposta.');
    return ocupado(enviar, async () => {
      try {
        chave ??= novaChave();
        await responderAvaliacao(a.id, t, chave);
        chave = null;
        anunciar('sucesso', 'Resposta enviada para a análise da CK.');
        await carregar();
      } catch (erro) {
        if (erro.codigo !== 'NETWORK_UNKNOWN') chave = null;
        if (erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, 'texto', erro.message)) return;
        anunciar('erro', erro.message);
      }
    });
  });
  return form;
}

function cartao(a) {
  if (a.oculta) {
    return el('li', { class: 'cartao', 'data-avaliacao': a.id, 'data-oculta': '' }, el('p', {}, el('em', {}, `Avaliação ocultada pela moderação (${a.data}).`)));
  }
  const r = a.resposta;
  let resposta = null;
  if (r) {
    resposta = el('div', { class: 'cartao pilha', 'data-resposta': r.id },
      el('p', {}, el('strong', {}, 'Resposta da empresa'), ` · ${r.oculta ? 'Ocultada pela moderação' : ESTADO_RESPOSTA[r.estado] ?? r.estado}`),
      r.texto ? el('p', {}, r.texto) : el('p', {}, el('em', {}, 'Conteúdo ocultado pela moderação.')),
      r.moderacao ? marcaModeracaoAutor(r.moderacao, { anunciar, aoConcluir: carregar, oculto: r.oculta }) : null);
  }
  return el('li', { class: 'cartao pilha', 'data-avaliacao': a.id },
    el('p', {}, el('strong', {}, textoNota(a.nota)), ` · ${a.autor} · ${a.data}`),
    a.comentario ? el('p', {}, a.comentario) : null,
    resposta ?? (a.pode_responder ? formResposta(a) : null),
    el('div', { class: 'grupo-botoes' }, botaoDenunciar('avaliacao', a.id, { anunciar, descricaoAlvo: 'esta avaliação' })));
}

async function carregar() {
  mostrarCarregando(area, 'Carregando as avaliações');
  try {
    ctx = ctx ?? await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'avaliacoes'));
    if (!ctx.pode('vitrine.visualizar')) {
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não inclui as avaliações desta empresa.')));
      return;
    }
    const r = await avaliacoesDaEmpresa(ctx.id);
    concluirCarregamento(area);
    const v = r.vitrine;
    area.replaceChildren(
      el('p', { id: 'resumo-avaliacoes' }, v.media !== null && v.media !== undefined
        ? `Média na vitrine: ${String(v.media).replace('.', ',')} de 5 (${v.quantidade} avaliações).`
        : `${v.quantidade} avaliação(ões) publicada(s). A média aparece na vitrine a partir de ${v.minimo_para_media}.`),
      r.itens.length ? el('ul', { class: 'pilha', id: 'lista-avaliacoes' }, ...r.itens.map(cartao))
        : el('p', { id: 'lista-avaliacoes' }, 'Ainda não há avaliações publicadas.'));
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

carregar();
