/**
 * Botão "Baixar PDF" (M13, D13-07, D13-10). Ordem: monta o documento com os dados que a tela já tem, gera o arquivo no
 * navegador, registra no banco (que confere a permissão de origem) e só então entrega o arquivo. Nada fica guardado no app
 * nem no cache: o arquivo existe só no aparelho de quem baixou. Sem conexão, nada é gerado nem registrado.
 */
import { el } from '../ui/dom.js';
import { ocupado } from '../ui/formulario.js';
import { novaChave } from '../data/empresas.js';
import { neon } from '../data/sessao.js';
import { gerarPdf } from './gerador.js';

let biblioteca = null;
const carregarBiblioteca = async () => {
  biblioteca ??= await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  return biblioteca;
};

function entregar(bytes, nome) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = el('a', { href: url, download: nome, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Nome de quem gera, para o cabeçalho do documento. */
export async function nomeDeQuemGera() {
  const s = await neon.sessao().catch(() => null);
  return s?.usuario?.nome || 'pessoa da equipe';
}

/**
 * @param {{ rotulo: string, id: string, montar: () => Promise<object>, registrar: (chave: string) => Promise<unknown>,
 *   anunciar: (tipo: string, texto: string, ...extra) => void }} opcoes
 */
export function botaoPdf({ rotulo, id, montar, registrar, anunciar }) {
  let chave = null;
  const b = el('button', { type: 'button', class: 'botao botao--secundario', id, 'data-pdf': id }, rotulo);
  b.addEventListener('click', () => ocupado(b, async () => {
    if (navigator.onLine === false) return anunciar('erro', 'Sem conexão. Nenhum PDF foi gerado.');
    try {
      const descricao = await montar();
      const bytes = await gerarPdf(await carregarBiblioteca(), descricao);
      chave ??= novaChave();
      await registrar(chave);
      chave = null;
      entregar(bytes, descricao.arquivo);
      anunciar('sucesso', `PDF gerado: ${descricao.arquivo}.`, el('p', {}, 'O arquivo fica só no seu aparelho; o AutoniCK registra apenas que ele foi gerado.'));
    } catch (erro) {
      if (erro.codigo !== 'NETWORK_UNKNOWN') chave = null;
      anunciar('erro', erro.codigo ? erro.message : 'Não foi possível gerar o PDF. Tente de novo.',
        erro.codigo === 'NETWORK_UNKNOWN' ? el('p', {}, 'Nenhum arquivo foi entregue. Tente de novo quando a conexão voltar.') : null);
    }
  }));
  return b;
}
