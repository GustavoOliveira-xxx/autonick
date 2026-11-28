/**
 * Fotos e documentos de uma solicitação (E08: solicitação guiada com anexos opcionais). Cliente titular e equipe com
 * permissão de orçamentos anexam PNG, JPG, WebP ou PDF; o backend Java confere o conteúdo real, o tamanho e a permissão
 * (manutencao.arquivo_registrar) e só devolve a lista para quem pode ver. Sem a API Java, mostra o motivo.
 */
import { el } from './dom.js';
import { ocupado } from './formulario.js';
import { arquivosDisponiveis, arquivosDoRegistro, enviarArquivo, urlDeImagem, LIMITES_PADRAO, TIPOS_IMAGEM } from '../data/arquivos.js';

const tamanho = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function secaoAnexos({ solicitacaoId, titulo = 'Fotos e documentos', podeEnviar = true, ajuda = null }) {
  const lista = el('ul', { class: 'lista-anexos', id: 'lista-anexos', 'aria-live': 'polite' }, el('li', { class: 'campo__ajuda' }, 'Carregando…'));
  const erro = el('p', { class: 'campo__erro', role: 'alert', id: 'anexo-erro' });
  const entrada = el('input', { type: 'file', id: 'anexo-arquivo', class: 'visualmente-oculto', accept: 'image/png,image/jpeg,image/webp,application/pdf' });
  const escolher = el('label', { for: 'anexo-arquivo', class: 'botao botao--secundario', role: 'button', tabindex: '0' }, 'Anexar foto ou PDF');
  escolher.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.click(); } });
  const carregar = async () => {
    try {
      const itens = await arquivosDoRegistro('solicitacao', solicitacaoId);
      const l = Array.isArray(itens) ? itens : [];
      lista.replaceChildren(...(l.length ? l.map((a) => {
        const abrir = el('button', { type: 'button', class: 'botao botao--texto' }, a.tipo_mime === 'application/pdf' ? 'Abrir PDF' : 'Ver imagem',
          el('span', { class: 'visualmente-oculto' }, ` ${a.nome_original ?? ''}`));
        abrir.addEventListener('click', () => ocupado(abrir, async () => {
          const u = await urlDeImagem(a.url);
          if (u) window.open(u, '_blank', 'noopener'); else erro.textContent = 'Não foi possível abrir o arquivo.';
        }));
        return el('li', { class: 'linha-ficha' }, el('span', {}, el('strong', {}, a.nome_original || 'Arquivo'), ` · ${tamanho(a.tamanho_bytes)}`), abrir);
      }) : [el('li', { class: 'campo__ajuda' }, 'Nenhum arquivo anexado.')]));
    } catch (e) { lista.replaceChildren(el('li', {}, e.message || 'Não foi possível listar os arquivos.')); }
  };
  entrada.addEventListener('change', () => ocupado(escolher, async () => {
    erro.textContent = '';
    const arq = entrada.files[0];
    entrada.value = '';
    if (!arq) return;
    const pdf = arq.type === 'application/pdf';
    if (!pdf && !TIPOS_IMAGEM.includes(arq.type)) { erro.textContent = 'Use PNG, JPG, WebP ou PDF.'; return; }
    const limite = pdf ? LIMITES_PADRAO.documentoKb : LIMITES_PADRAO.imagemKb;
    if (arq.size > limite * 1024) { erro.textContent = `O arquivo passa de ${Math.round(limite / 1024)} MB.`; return; }
    try {
      await enviarArquivo(arq, { finalidade: 'anexo_solicitacao', referenciaTipo: 'solicitacao', referenciaId: solicitacaoId, chave: crypto.randomUUID() });
      await carregar();
    } catch (e) { erro.textContent = e.message || 'Não foi possível enviar o arquivo.'; }
  }));
  if (arquivosDisponiveis) carregar(); else lista.replaceChildren(el('li', { class: 'campo__ajuda' }, 'Anexos funcionam no AutoniCK com a API Java.'));
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-anexos', id: 'anexos' }, el('h2', { id: 'titulo-anexos' }, titulo),
    ajuda ? el('p', { class: 'campo__ajuda' }, ajuda) : null, lista,
    podeEnviar && arquivosDisponiveis ? el('div', { class: 'grupo-botoes' }, escolher, entrada) : null, erro);
}
