/**
 * Demonstração do AutoniCK pela API Java, com dados FICTÍCIOS: faixa em todas as telas e entrada rápida como uma
 * pessoa fictícia (Cliente, Gestor, Funcionário ou Administração CK). Só aparece quando a configuração pública diz
 * que a demonstração está ativa. A entrada passa pela API (cookie HttpOnly da demonstração); nenhuma senha real.
 */
import { CONFIG_PUBLICA } from '../config/public-config.js';
import { enderecosDoBackend } from '../data/sessao.js';
import { el } from './dom.js';

export const demonstracaoAtiva = (config = CONFIG_PUBLICA) => Boolean(config?.demonstracao?.ativa);

export function mostrarFaixaDemonstracao(config = CONFIG_PUBLICA) {
  if (!demonstracaoAtiva(config) || document.getElementById('faixa-demonstracao')) return;
  const publica = Boolean(config.demonstracao.publica);
  const faixa = el('div', { id: 'faixa-demonstracao', class: 'faixa-demo', role: 'note' },
    el('strong', {}, 'DEMONSTRAÇÃO'), ' ',
    publica
      ? 'Empresas, pessoas e valores fictícios, só seus nesta visita. Nenhum pagamento é real.'
      : 'Dados fictícios no seu computador, pela API Java e PostgreSQL. Nenhum pagamento é real.');
  // A faixa fixa das páginas fala do banco de desenvolvimento: na demonstração, ela é substituída por esta.
  const antiga = document.querySelector('body > .faixa-demo');
  if (antiga) antiga.replaceWith(faixa); else document.body.prepend(faixa);
}

/** Destino depois de entrar, pela área da pessoa. */
export function destinoDaPessoa(pessoa, destinoPadrao) {
  if (pessoa.area === 'ck') return '/ck-admin/';
  return destinoPadrao;
}

/**
 * Monta, no container, os botões "Entrar como ..." das pessoas fictícias da área (cliente ou business).
 * Devolve uma promessa que termina quando a lista foi desenhada (ou falhou, com aviso).
 */
export async function montarEntradaDemonstracao(container, { tipo, destino, buscar = globalThis.fetch.bind(globalThis) }) {
  if (!demonstracaoAtiva() || !container) return;
  const { authUrl } = enderecosDoBackend();
  const titulo = el('h2', { id: 'titulo-demonstracao' }, 'Entrar na demonstração');
  const situacao = el('p', { role: 'status' }, 'Carregando as pessoas fictícias...');
  const lista = el('ul', { role: 'list', class: 'pilha' });
  container.replaceChildren(el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-demonstracao' }, titulo, situacao, lista));
  let dados;
  try {
    const r = await buscar(`${authUrl}/demo/pessoas`, { credentials: 'same-origin' });
    if (!r.ok) throw new Error();
    dados = await r.json();
  } catch {
    situacao.textContent = 'Não foi possível carregar as pessoas fictícias. Confira se a API Java está ligada.';
    return;
  }
  const daArea = (dados.pessoas ?? []).filter((p) => (tipo === 'business' ? p.area !== 'cliente' : p.area === 'cliente'));
  situacao.textContent = dados.publica
    ? 'Escolha uma pessoa. Na primeira entrada, a demonstração cria empresas fictícias só para você.'
    : `Escolha uma pessoa fictícia. ${dados.senha ? `Também é possível entrar pelo formulário com a senha ${dados.senha}.` : ''}`.trim();
  for (const p of daArea) {
    const botao = el('button', { type: 'button', class: 'botao', 'data-pessoa': p.pessoa }, `Entrar como ${p.nome}`);
    botao.addEventListener('click', async () => {
      botao.disabled = true;
      botao.setAttribute('aria-busy', 'true');
      situacao.textContent = dados.publica ? 'Preparando a sua demonstração...' : 'Entrando...';
      try {
        const r = await buscar(`${authUrl}/demo/entrar`, { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pessoa: p.pessoa }) });
        const corpo = await r.json().catch(() => null);
        if (!r.ok) throw new Error(corpo?.message ?? 'Não foi possível entrar agora.');
        location.assign(destinoDaPessoa(p, destino));
      } catch (erro) {
        situacao.textContent = erro.message || 'Não foi possível entrar agora.';
        botao.disabled = false;
        botao.removeAttribute('aria-busy');
      }
    });
    lista.append(el('li', {}, botao, p.descricao ? el('p', { class: 'campo__ajuda' }, p.descricao) : null));
  }
}
