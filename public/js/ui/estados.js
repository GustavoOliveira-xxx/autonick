/**
 * Estados de tela obrigatórios (UX-001 §8, RF-188, RF-189, RNF-022).
 * Mensagens em linguagem simples (UX-001 §7).
 */
import { el, limpar } from './dom.js';

export function mostrarCarregando(container, rotulo = 'Carregando informações') {
  limpar(container);
  container.setAttribute('aria-busy', 'true');
  container.append(
    el('div', { class: 'esqueleto', role: 'status' },
      el('span', { class: 'visualmente-oculto' }, `${rotulo}…`),
      el('div', { class: 'esqueleto__linha', 'aria-hidden': 'true' }),
      el('div', { class: 'esqueleto__linha', 'aria-hidden': 'true' }),
      el('div', { class: 'esqueleto__linha', 'aria-hidden': 'true' }),
    ),
  );
}

export function concluirCarregamento(container) {
  container.removeAttribute('aria-busy');
  limpar(container);
}

export function aviso(tipo, titulo, ...conteudo) {
  const icones = { info: 'i', sucesso: '✓', alerta: '!', erro: '✕' };
  const prefixos = { info: 'Informação', sucesso: 'Sucesso', alerta: 'Atenção', erro: 'Erro' };
  return el('div', { class: `aviso aviso--${tipo}` },
    el('span', { class: 'aviso__icone', 'aria-hidden': 'true' }, icones[tipo]),
    el('div', { class: 'aviso__corpo' },
      el('p', {}, el('strong', {}, `${prefixos[tipo]}: `), titulo),
      ...conteudo,
    ),
  );
}

export function mostrarVazio(container, { titulo, texto, acao } = {}) {
  concluirCarregamento(container);
  container.append(
    el('div', { class: 'estado-vazio', role: 'status' },
      el('h2', {}, titulo),
      texto ? el('p', {}, texto) : null,
      acao ?? null,
    ),
  );
}

export function mostrarErro(container, { mensagem, aoTentarNovamente } = {}) {
  concluirCarregamento(container);
  const botao = aoTentarNovamente
    ? el('button', { type: 'button', class: 'botao botao--secundario', onclick: aoTentarNovamente }, 'Tentar novamente')
    : null;
  container.append(
    el('div', { role: 'alert' },
      aviso('erro', mensagem ?? 'Não conseguimos carregar as informações agora.',
        el('p', {}, 'Verifique sua conexão. Nenhuma informação foi alterada.'),
        botao),
    ),
  );
}

export function mostrarNegado(container, mensagem = 'Seu perfil não permite esta ação nesta empresa.') {
  concluirCarregamento(container);
  container.append(
    el('div', { role: 'alert' },
      aviso('alerta', mensagem,
        el('p', {}, 'Se você precisa deste acesso, fale com quem administra a empresa.'),
        el('a', { href: '/business/empresas.html' }, 'Voltar para minhas empresas')),
    ),
  );
}

/** Direciona o erro do repositório para o estado de tela adequado. */
export function tratarErro(container, erro, aoTentarNovamente) {
  if (erro?.codigo === 'FORBIDDEN_ACTION' || erro?.codigo === 'TENANT_FORBIDDEN') {
    mostrarNegado(container, erro.message);
  } else if (erro?.codigo === 'NOT_FOUND') {
    concluirCarregamento(container);
    container.append(el('div', { role: 'alert' }, aviso('info', erro.message)));
  } else {
    mostrarErro(container, { mensagem: erro?.message, aoTentarNovamente });
  }
}
