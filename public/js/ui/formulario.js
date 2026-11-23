/**
 * Campos de formulário acessíveis (M03): rótulo visível, ajuda e erro ligados
 * por aria-describedby, erro ao lado do campo sem apagar o que foi digitado.
 */
import { el } from './dom.js';

let contador = 0;
const unico = (base) => `${base}-${++contador}`;

/** Campo de texto, e-mail, telefone ou área de texto. */
export function campoTexto({ nome, rotulo, valor = '', tipo = 'text', ajuda = null, obrigatorio = false, max = null, linhas = 0, autocomplete = 'off', id = null }) {
  const idCampo = id ?? unico(nome);
  const descritores = [ajuda ? `${idCampo}-ajuda` : null, `${idCampo}-erro`].filter(Boolean).join(' ');
  const atributos = {
    id: idCampo, name: nome, 'aria-describedby': descritores, autocomplete,
    maxlength: max, 'aria-required': obrigatorio ? 'true' : null,
  };
  const entrada = linhas
    ? el('textarea', { ...atributos, rows: linhas }, valor ?? '')
    : el('input', { ...atributos, type: tipo, value: valor ?? '' });
  return el('div', { class: 'campo' },
    el('label', { for: idCampo }, rotulo, obrigatorio ? el('span', { class: 'obrigatorio' }, ' (obrigatório)') : null),
    ajuda ? el('span', { id: `${idCampo}-ajuda`, class: 'campo__ajuda' }, ajuda) : null,
    entrada,
    el('span', { id: `${idCampo}-erro`, class: 'campo__erro' }),
  );
}

/** Lista de seleção com opções [valor, rótulo]. */
export function campoSelecao({ nome, rotulo, opcoes, valor = '', ajuda = null, obrigatorio = false, id = null, vazio = 'Escolha uma opção' }) {
  const idCampo = id ?? unico(nome);
  const descritores = [ajuda ? `${idCampo}-ajuda` : null, `${idCampo}-erro`].filter(Boolean).join(' ');
  const selecao = el('select', { id: idCampo, name: nome, 'aria-describedby': descritores, 'aria-required': obrigatorio ? 'true' : null },
    vazio ? el('option', { value: '' }, vazio) : null,
    ...opcoes.map(([v, r]) => el('option', { value: v, selected: String(v) === String(valor ?? '') }, r)));
  return el('div', { class: 'campo' },
    el('label', { for: idCampo }, rotulo, obrigatorio ? el('span', { class: 'obrigatorio' }, ' (obrigatório)') : null),
    ajuda ? el('span', { id: `${idCampo}-ajuda`, class: 'campo__ajuda' }, ajuda) : null,
    selecao,
    el('span', { id: `${idCampo}-erro`, class: 'campo__erro' }),
  );
}

/** Grupo de opções (rádio ou caixa de seleção) dentro de fieldset com legenda. */
export function grupoOpcoes({ nome, legenda, opcoes, tipo = 'radio', marcados = [], ajuda = null }) {
  const idGrupo = unico(nome);
  return el('fieldset', { class: 'campo', 'aria-describedby': [ajuda ? `${idGrupo}-ajuda` : null, `${idGrupo}-erro`].filter(Boolean).join(' ') },
    el('legend', {}, legenda),
    ajuda ? el('span', { id: `${idGrupo}-ajuda`, class: 'campo__ajuda' }, ajuda) : null,
    el('div', { class: 'opcoes' }, ...opcoes.map(([valor, rotulo]) => {
      const idOpcao = `${idGrupo}-${valor}`;
      return el('div', { class: 'opcao' },
        el('input', { id: idOpcao, type: tipo, name: nome, value: valor, checked: marcados.includes(valor) }),
        el('label', { for: idOpcao }, rotulo));
    })),
    el('span', { id: `${idGrupo}-erro`, class: 'campo__erro', 'data-grupo': nome }),
  );
}

export function limparErros(form) {
  for (const erro of form.querySelectorAll('.campo__erro')) erro.textContent = '';
  for (const campo of form.querySelectorAll('[aria-invalid]')) campo.setAttribute('aria-invalid', 'false');
}

/** Mostra a mensagem ao lado do campo indicado pelo banco. Retorna true se encontrou o campo. */
export function erroNoCampo(form, nome, mensagem) {
  const campo = form.querySelector(`[name="${CSS.escape(nome ?? '')}"]`);
  if (!campo) return false;
  const erro = campo.type === 'radio' || campo.type === 'checkbox'
    ? form.querySelector(`[data-grupo="${CSS.escape(nome)}"]`)
    : document.getElementById(`${campo.id}-erro`);
  if (!erro) return false;
  erro.textContent = mensagem;
  if (campo.type !== 'radio' && campo.type !== 'checkbox') campo.setAttribute('aria-invalid', 'true');
  campo.focus();
  return true;
}

/** Desabilita o botão enquanto a ação roda (evita clique duplo). */
export async function ocupado(botao, acao) {
  const tinhaFoco = document.activeElement === botao;
  botao.disabled = true;
  botao.setAttribute('aria-busy', 'true');
  try {
    return await acao();
  } finally {
    botao.disabled = false;
    botao.removeAttribute('aria-busy');
    // Botão desabilitado perde o foco (inclusive o devolvido por um diálogo de confirmação). Se o foco ficou perdido
    // na página e o botão continua nela, ele volta para o botão, e quem usa teclado não perde o lugar (WCAG 2.4.3).
    const perdido = !document.activeElement || document.activeElement === document.body;
    if (tinhaFoco && perdido && botao.isConnected) botao.focus();
  }
}

/** Valores preenchidos do formulário como objeto (textos aparados). */
export function valores(form) {
  const dados = {};
  for (const [chave, valor] of new FormData(form).entries()) {
    if (chave in dados) dados[chave] = [].concat(dados[chave], valor);
    else dados[chave] = typeof valor === 'string' ? valor.trim() : valor;
  }
  return dados;
}
