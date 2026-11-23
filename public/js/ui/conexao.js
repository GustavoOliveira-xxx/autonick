/**
 * Faixa de conexão (M13, D13-06; RF-192, RNF-033, RNF-034).
 * - Sem conexão: faixa fixa explicando que nada será enviado; envio de formulários bloqueado com "Nada foi enviado".
 * - Conexão de volta: avisa e sugere atualizar a página. Nada é reenviado sozinho (D11-09).
 * Não guarda nada no aparelho.
 */
import { el } from './dom.js';
import { notificar } from './notificacoes.js';

export const TEXTO_SEM_CONEXAO = 'Sem conexão. Você pode ler o que já está na tela, mas nada será enviado até a internet voltar.';
export const TEXTO_CONEXAO_VOLTOU = 'Conexão restabelecida. Atualize a página para ver as informações mais recentes.';
export const TEXTO_NADA_ENVIADO = 'Sem conexão. Nada foi enviado.';

let iniciado = false;

function faixa() {
  let f = document.getElementById('faixa-conexao');
  if (!f) {
    f = el('div', { id: 'faixa-conexao', class: 'faixa-conexao', role: 'status', 'aria-live': 'polite', hidden: true });
    const cabecalho = document.getElementById('cabecalho');
    if (cabecalho) cabecalho.before(f);
    else document.body.prepend(f);
  }
  return f;
}

function marcarBotoes(semConexao) {
  for (const b of document.querySelectorAll('button[type="submit"], input[type="submit"]')) {
    if (semConexao) {
      b.setAttribute('aria-disabled', 'true');
      b.dataset.semConexao = '';
    } else if ('semConexao' in b.dataset) {
      b.removeAttribute('aria-disabled');
      delete b.dataset.semConexao;
    }
  }
}

function mostrarSemConexao() {
  const f = faixa();
  f.className = 'faixa-conexao faixa-conexao--sem';
  f.replaceChildren(el('strong', {}, 'Sem conexão. '), TEXTO_SEM_CONEXAO.replace(/^Sem conexão\. /, ''));
  f.hidden = false;
  document.body.dataset.semConexao = '';
  marcarBotoes(true);
}

function mostrarConexaoVoltou() {
  const f = faixa();
  f.className = 'faixa-conexao faixa-conexao--voltou';
  f.replaceChildren(
    el('span', {}, TEXTO_CONEXAO_VOLTOU),
    el('button', { type: 'button', class: 'botao botao--secundario', onclick: () => location.reload() }, 'Atualizar a página'),
    el('button', { type: 'button', class: 'botao botao--texto', onclick: () => { f.hidden = true; } }, 'Fechar aviso'),
  );
  f.hidden = false;
  delete document.body.dataset.semConexao;
  marcarBotoes(false);
}

export function iniciarConexao() {
  if (iniciado || document.body.dataset.semFaixaConexao !== undefined) return;
  iniciado = true;
  window.addEventListener('offline', mostrarSemConexao);
  window.addEventListener('online', mostrarConexaoVoltou);
  // Sem conexão, nenhum formulário é enviado: o envio é barrado antes de qualquer tela tratar o evento.
  document.addEventListener('submit', (evento) => {
    if (navigator.onLine !== false) return;
    evento.preventDefault();
    evento.stopImmediatePropagation();
    notificar(TEXTO_NADA_ENVIADO);
  }, true);
  if (navigator.onLine === false) mostrarSemConexao();
}
