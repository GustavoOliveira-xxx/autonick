/**
 * Campo de imagem reutilizável (logo da empresa, imagem do produto): prévia, escolher, substituir e remover.
 * A validação rápida acontece aqui; o backend confere o conteúdo real, regrava a imagem e decide a permissão.
 * Sem arquivos disponíveis (backend sem API Java), mostra a alternativa visual e explica.
 */
import { el } from './dom.js';
import { ocupado } from './formulario.js';
import { arquivosDisponiveis, conferirImagem, urlDeImagem } from '../data/arquivos.js';

export function campoImagem({ id, rotulo, ajuda, urlAtual = null, alternativa, podeAlterar = true, situacao = null, aoEnviar, aoRemover }) {
  const previa = el('div', { class: 'campo-imagem__previa' }, alternativa());
  const estado = el('p', { class: 'campo__ajuda', id: `${id}-estado`, 'aria-live': 'polite' }, situacao ?? '');
  const erro = el('span', { class: 'campo__erro', id: `${id}-erro`, role: 'alert' });
  const entrada = el('input', { type: 'file', id, accept: 'image/png,image/jpeg,image/webp', class: 'visualmente-oculto', 'aria-describedby': `${id}-ajuda ${id}-erro` });
  const escolher = el('label', { for: id, class: 'botao botao--secundario', tabindex: '0', role: 'button' }, urlAtual ? 'Trocar imagem' : 'Escolher imagem');
  escolher.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.click(); } });
  const remover = el('button', { type: 'button', class: 'botao botao--texto', hidden: !urlAtual }, 'Remover');
  const mostrar = async (url) => {
    const src = url ? await urlDeImagem(url) : null;
    previa.replaceChildren(src ? el('img', { src, alt: rotulo }) : alternativa());
  };
  mostrar(urlAtual);
  entrada.addEventListener('change', () => ocupado(escolher, async () => {
    erro.textContent = '';
    const arq = entrada.files[0];
    entrada.value = '';
    const problema = conferirImagem(arq);
    if (problema) { erro.textContent = problema; return; }
    estado.textContent = 'Enviando a imagem…';
    try {
      const r = await aoEnviar(arq);
      await mostrar(r.url);
      estado.textContent = r.situacao ?? 'Imagem salva.';
      escolher.textContent = 'Trocar imagem';
      remover.hidden = false;
    } catch (e) {
      estado.textContent = situacao ?? '';
      erro.textContent = e.message || 'Não foi possível enviar a imagem.';
    }
  }));
  remover.addEventListener('click', () => ocupado(remover, async () => {
    erro.textContent = '';
    try {
      const r = await aoRemover();
      await mostrar(null);
      estado.textContent = r?.situacao ?? 'Imagem removida.';
      escolher.textContent = 'Escolher imagem';
      remover.hidden = true;
    } catch (e) { erro.textContent = e.message || 'Não foi possível remover.'; }
  }));
  const controles = !arquivosDisponiveis
    ? el('p', { class: 'campo__ajuda' }, 'O envio de imagens está disponível no AutoniCK com a API Java.')
    : podeAlterar ? el('div', { class: 'grupo-botoes' }, escolher, entrada, remover) : el('p', { class: 'campo__ajuda' }, 'Seu perfil não permite alterar esta imagem.');
  return el('div', { class: 'campo campo-imagem' }, previa,
    el('div', { class: 'pilha' }, el('strong', {}, rotulo), el('span', { class: 'campo__ajuda', id: `${id}-ajuda` }, ajuda), controles, estado, erro));
}
