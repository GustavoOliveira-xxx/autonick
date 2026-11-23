/**
 * Gerador de PDF no navegador (M13, D13-07 = A). Recebe a biblioteca pdf-lib (código aberto, MIT, guardada no próprio app)
 * e uma descrição do documento; devolve os bytes do PDF. Não acessa rede, não guarda nada.
 *
 * Regras de paginação (D13-07): nenhuma linha de tabela é cortada entre páginas; o cabeçalho da tabela se repete em cada
 * página; o bloco de totais nunca é separado (se não couber, vai inteiro para a página seguinte, com o cabeçalho de novo);
 * o título de um bloco não fica sozinho no fim da página. Rodapé com "Página X de Y" e a identificação do documento.
 *
 * Descrição: { titulo, linhas: [texto], nota, rodape, geradoEm: Date, blocos: [
 *   { tipo: 'tabela', titulo?, colunas: [{ rotulo, peso, direita? }], linhas: [[texto]], totais?: [[texto]], vazio? },
 *   { tipo: 'pares', titulo?, pares: [[rotulo, valor]] },
 *   { tipo: 'texto', titulo?, paragrafos: [texto] } ] }
 */
const A4 = [595.28, 841.89];
const MARGEM = 40;
const TOPO = A4[1] - MARGEM;
const BASE = 64;                    // abaixo disto fica só o rodapé
const LARGURA = A4[0] - 2 * MARGEM;
const CORPO = 9;
const ENTRELINHA = 11.5;
const RESPIRO = 3;

// Caracteres fora do conjunto da fonte padrão (WinAnsi) viram equivalentes legíveis.
const TROCAS = { '—': '-', '–': '-', '‑': '-', '−': '-', '…': '...', '→': '->', '≤': '<=', '≥': '>=',
  ' ': ' ', ' ': ' ', '​': '', '‘': "'", '’': "'", '“': '"', '”': '"', '•': '-' };

export async function gerarPdf(PDFLib, doc) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const preto = rgb(0.11, 0.09, 0.14);
  const cinza = rgb(0.36, 0.33, 0.4);
  const linhaCor = rgb(0.6, 0.57, 0.65);
  const cacheCaracteres = new Map();

  const seguro = (texto, fonte = normal) => {
    let s = String(texto ?? '').replace(/[—–‑−…→≤≥  ​‘’“”•]/g, (c) => TROCAS[c]);
    s = s.replace(/\r?\n/g, ' ');
    let saida = '';
    for (const c of s) {
      if (!cacheCaracteres.has(c)) {
        let pode = true;
        try { fonte.widthOfTextAtSize(c, CORPO); } catch { pode = false; }
        cacheCaracteres.set(c, pode);
      }
      saida += cacheCaracteres.get(c) ? c : '?';
    }
    return saida;
  };
  const largura = (texto, fonte, tamanho) => fonte.widthOfTextAtSize(texto, tamanho);
  /** Quebra o texto em linhas que cabem na largura (palavras longas são partidas). */
  const quebrar = (texto, fonte, tamanho, max) => {
    const palavras = seguro(texto, fonte).split(' ');
    const linhas = [];
    let atual = '';
    for (let palavra of palavras) {
      while (largura(palavra, fonte, tamanho) > max) {
        let corte = palavra.length - 1;
        while (corte > 1 && largura(palavra.slice(0, corte), fonte, tamanho) > max) corte -= 1;
        if (atual) { linhas.push(atual); atual = ''; }
        linhas.push(palavra.slice(0, corte));
        palavra = palavra.slice(corte);
      }
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (largura(tentativa, fonte, tamanho) <= max) atual = tentativa;
      else { linhas.push(atual); atual = palavra; }
    }
    linhas.push(atual);
    return linhas;
  };

  let pagina;
  let y;
  const novaPagina = () => {
    pagina = pdf.addPage(A4);
    y = TOPO;
  };
  const escrever = (texto, x, fonte, tamanho, cor = preto) => pagina.drawText(texto, { x, y, size: tamanho, font: fonte, color: cor });
  const cabe = (altura) => y - altura >= BASE;

  // Cabeçalho do documento
  novaPagina();
  for (const l of quebrar(doc.titulo, negrito, 15, LARGURA)) { y -= 17; escrever(l, MARGEM, negrito, 15); }
  y -= 6;
  for (const texto of doc.linhas ?? []) {
    for (const l of quebrar(texto, normal, CORPO + 0.5, LARGURA)) { y -= ENTRELINHA; escrever(l, MARGEM, normal, CORPO + 0.5, cinza); }
  }
  if (doc.nota) {
    y -= 6;
    for (const l of quebrar(doc.nota, negrito, CORPO + 1, LARGURA)) { y -= ENTRELINHA + 1; escrever(l, MARGEM, negrito, CORPO + 1); }
  }
  y -= 10;

  const tituloBloco = (titulo, alturaMinimaSeguinte) => {
    if (!titulo) return;
    const linhas = quebrar(titulo, negrito, 11, LARGURA);
    if (!cabe(linhas.length * 14 + 6 + alturaMinimaSeguinte)) novaPagina();
    for (const l of linhas) { y -= 14; escrever(l, MARGEM, negrito, 11); }
    y -= 6;
  };

  for (const bloco of doc.blocos ?? []) {
    if (bloco.tipo === 'texto') {
      const paragrafos = bloco.paragrafos.map((p) => quebrar(p, normal, CORPO, LARGURA));
      tituloBloco(bloco.titulo, (paragrafos[0]?.length ?? 1) * ENTRELINHA);
      for (const linhas of paragrafos) {
        for (const l of linhas) {
          if (!cabe(ENTRELINHA)) novaPagina();
          y -= ENTRELINHA;
          escrever(l, MARGEM, normal, CORPO);
        }
        y -= 4;
      }
      y -= 8;
      continue;
    }
    if (bloco.tipo === 'pares') {
      const larguraRotulo = LARGURA * 0.36;
      const pares = bloco.pares.map(([r, v]) => [quebrar(r, negrito, CORPO, larguraRotulo - 6), quebrar(v, normal, CORPO, LARGURA - larguraRotulo)]);
      const alturaPar = ([r, v]) => Math.max(r.length, v.length) * ENTRELINHA + RESPIRO;
      tituloBloco(bloco.titulo, pares.length ? alturaPar(pares[0]) : 0);
      for (const par of pares) {
        if (!cabe(alturaPar(par))) novaPagina();
        const inicio = y;
        par[0].forEach((l, i) => { y = inicio - (i + 1) * ENTRELINHA; escrever(l, MARGEM, negrito, CORPO); });
        par[1].forEach((l, i) => { y = inicio - (i + 1) * ENTRELINHA; escrever(l, MARGEM + larguraRotulo, normal, CORPO); });
        y = inicio - alturaPar(par);
      }
      y -= 8;
      continue;
    }
    // Tabela
    const soma = bloco.colunas.reduce((t, c) => t + (c.peso ?? 1), 0);
    const larguras = bloco.colunas.map((c) => (LARGURA * (c.peso ?? 1)) / soma);
    const xs = larguras.map((_, i) => MARGEM + larguras.slice(0, i).reduce((t, w) => t + w, 0));
    const prepararLinha = (celulas, fonte) => celulas.map((c, i) => quebrar(c, fonte, CORPO, larguras[i] - 6));
    const alturaLinha = (linha) => Math.max(...linha.map((c) => c.length)) * ENTRELINHA + RESPIRO;
    const cabecalho = prepararLinha(bloco.colunas.map((c) => c.rotulo), negrito);
    const desenharLinha = (linha, fonte) => {
      const inicio = y;
      linha.forEach((linhasCelula, i) => {
        const direita = bloco.colunas[i].direita;
        linhasCelula.forEach((texto, n) => {
          y = inicio - (n + 1) * ENTRELINHA;
          const x = direita ? xs[i] + larguras[i] - 3 - largura(texto, fonte, CORPO) : xs[i] + 3;
          escrever(texto, x, fonte, CORPO);
        });
      });
      y = inicio - alturaLinha(linha);
    };
    const tracar = (espessura = 0.6) => pagina.drawLine({ start: { x: MARGEM, y: y + 1 }, end: { x: MARGEM + LARGURA, y: y + 1 }, thickness: espessura, color: linhaCor });
    const desenharCabecalho = (continuacao) => {
      if (continuacao && bloco.titulo) { y -= 12; escrever(seguro(`${bloco.titulo} (continuação)`, normal), MARGEM, normal, CORPO, cinza); y -= 4; }
      desenharLinha(cabecalho, negrito);
      tracar(0.8);
      y -= 2;
    };
    const linhas = bloco.linhas.map((l) => prepararLinha(l, normal));
    const totais = (bloco.totais ?? []).map((l) => prepararLinha(l, negrito));
    const alturaTotais = totais.reduce((t, l) => t + alturaLinha(l), 0) + (totais.length ? 6 : 0);
    tituloBloco(bloco.titulo, alturaLinha(cabecalho) + (linhas[0] ? alturaLinha(linhas[0]) : ENTRELINHA));
    desenharCabecalho(false);
    if (!linhas.length) {
      y -= ENTRELINHA;
      escrever(seguro(bloco.vazio ?? 'Nada no período escolhido.'), MARGEM + 3, normal, CORPO, cinza);
      y -= RESPIRO;
    }
    for (const linha of linhas) {
      if (!cabe(alturaLinha(linha))) { novaPagina(); desenharCabecalho(true); }
      desenharLinha(linha, normal);
    }
    if (totais.length) {
      if (!cabe(alturaTotais)) { novaPagina(); desenharCabecalho(true); }
      y -= 2;
      tracar(1);
      y -= 4;
      for (const linha of totais) desenharLinha(linha, negrito);
    }
    y -= 12;
  }

  // Rodapé em todas as páginas
  const paginas = pdf.getPages();
  const rodape = quebrar(doc.rodape ?? '', normal, 7.5, LARGURA - 90)[0] ?? '';
  paginas.forEach((p, i) => {
    const contagem = `Página ${i + 1} de ${paginas.length}`;
    p.drawLine({ start: { x: MARGEM, y: 46 }, end: { x: MARGEM + LARGURA, y: 46 }, thickness: 0.5, color: linhaCor });
    p.drawText(rodape, { x: MARGEM, y: 34, size: 7.5, font: normal, color: cinza });
    p.drawText(contagem, { x: MARGEM + LARGURA - largura(contagem, normal, 7.5), y: 34, size: 7.5, font: normal, color: cinza });
  });

  pdf.setTitle(seguro(doc.titulo));
  pdf.setAuthor('AutoniCK');
  pdf.setCreator('AutoniCK (versão de desenvolvimento)');
  pdf.setProducer('pdf-lib');
  pdf.setLanguage('pt-BR');
  if (doc.geradoEm) { pdf.setCreationDate(doc.geradoEm); pdf.setModificationDate(doc.geradoEm); }
  return pdf.save({ useObjectStreams: false });
}

/** Limites da área útil, para os testes conferirem que nada sai da página. */
export const AREA_UTIL = { largura: A4[0], altura: A4[1], margem: MARGEM, base: BASE };
