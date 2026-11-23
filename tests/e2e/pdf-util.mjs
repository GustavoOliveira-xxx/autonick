/** Lê o PDF baixado na tela e devolve o texto de cada página (M13, D13-07): conferência do conteúdo do arquivo. */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'node:url';

const FONTES = `${fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url))}/`;

export async function lerPdfBaixado(download) {
  const partes = await (await download.createReadStream()).toArray();
  const bytes = new Uint8Array(Buffer.concat(partes));
  const assinatura = new TextDecoder().decode(bytes.slice(0, 5));
  const doc = await getDocument({ data: bytes, isEvalSupported: false, standardFontDataUrl: FONTES }).promise;
  const paginas = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    paginas.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ').replace(/\s+/g, ' '));
  }
  return { assinatura, paginas, texto: paginas.join('\n') };
}
