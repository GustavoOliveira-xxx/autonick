/**
 * M13 (D13-07): gerador de PDF. Usa a mesma pdf-lib do app (node_modules) e lê o arquivo gerado com o pdf.js (só nos
 * testes) para conferir o conteúdo e a paginação: nenhuma linha de tabela cortada, cabeçalho repetido, totais juntos e
 * dentro da página, acentos e "R$" corretos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as PDFLib from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { gerarPdf, AREA_UTIL } from '../../public/js/pdf/gerador.js';

async function ler(bytes) {
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false }).promise;
  const paginas = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const p = await doc.getPage(i);
    const itens = (await p.getTextContent()).items.filter((it) => it.str.trim());
    paginas.push(itens.map((it) => ({ texto: it.str, x: it.transform[4], y: it.transform[5], largura: it.width })));
  }
  const meta = await doc.getMetadata();
  return { paginas, meta: meta.info };
}
const linhasDaPagina = (itens) => {
  const porY = new Map();
  for (const it of itens) {
    const chave = Math.round(it.y);
    porY.set(chave, [...(porY.get(chave) ?? []), it].sort((a, b) => a.x - b.x));
  }
  return [...porY.entries()].sort((a, b) => b[0] - a[0]).map(([, its]) => its.map((i) => i.texto).join(' '));
};
const base = (extra = {}) => ({ titulo: 'Entradas e saídas por categoria', linhas: ['Empresa: Costura da Olga', 'Período: 01/11/2026 a 17/11/2026'],
  nota: 'Documento interno, sem valor fiscal.', rodape: 'AutoniCK, versão de desenvolvimento: dados de teste.', geradoEm: new Date('2026-11-17T15:00:00Z'), ...extra });

test('conteúdo legível, acentos e moeda corretos, metadados e nota de documento interno', async () => {
  const bytes = await gerarPdf(PDFLib, base({ blocos: [{ tipo: 'tabela', titulo: 'Categorias',
    colunas: [{ rotulo: 'Categoria', peso: 3 }, { rotulo: 'Entradas', peso: 2, direita: true }],
    linhas: [['Serviços de costura e ajustes', 'R$ 1.234,56'], ['Conferências — ação', 'R$ 987,00']],
    totais: [['Total', 'R$ 2.221,56']] }] }));
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  const { paginas, meta } = await ler(bytes);
  assert.equal(paginas.length, 1);
  const texto = linhasDaPagina(paginas[0]).join('\n');
  for (const esperado of ['Entradas e saídas por categoria', 'Empresa: Costura da Olga', 'Documento interno, sem valor fiscal.',
    'Serviços de costura e ajustes', 'R$ 1.234,56', 'Conferências - ação', 'Total', 'R$ 2.221,56', 'Página 1 de 1']) {
    assert.ok(texto.includes(esperado), `faltou "${esperado}" em:\n${texto}`);
  }
  assert.equal(meta.Title, 'Entradas e saídas por categoria');
  assert.equal(meta.Author, 'AutoniCK');
});

test('tabela longa: várias páginas, cada linha uma única vez e inteira, cabeçalho repetido, totais juntos e dentro da página', async () => {
  const linhas = Array.from({ length: 180 }, (_, i) => [`Lançamento ${String(i + 1).padStart(3, '0')} ${i % 7 === 0 ? 'com descrição bem mais longa que ocupa duas linhas na coluna estreita da tabela' : ''}`.trim(), `R$ ${i + 1},00`]);
  const bytes = await gerarPdf(PDFLib, base({ blocos: [{ tipo: 'tabela', titulo: 'Lançamentos',
    colunas: [{ rotulo: 'Descrição', peso: 2 }, { rotulo: 'Valor', peso: 1, direita: true }], linhas,
    totais: [['Total de entradas', 'R$ 16.290,00'], ['Total de saídas', 'R$ 0,00'], ['Líquido', 'R$ 16.290,00']] }] }));
  const { paginas } = await ler(bytes);
  assert.ok(paginas.length >= 5, `esperava várias páginas, veio ${paginas.length}`);
  const todas = paginas.map(linhasDaPagina);
  for (let i = 1; i <= 180; i += 1) {
    const id = `Lançamento ${String(i).padStart(3, '0')}`;
    const ocorrencias = todas.flat().filter((l) => l.includes(id));
    assert.equal(ocorrencias.length, 1, `${id} aparece ${ocorrencias.length} vezes`);
  }
  // Linha de duas partes: as duas partes estão na mesma página (a linha não foi cortada entre páginas).
  for (let i = 1; i <= 180; i += 7) {
    const id = `Lançamento ${String(i).padStart(3, '0')}`;
    const pagina = todas.findIndex((p) => p.some((l) => l.includes(id)));
    assert.ok(todas[pagina].some((l) => l.includes('da tabela')), `${id}: o fim do texto da linha ficou em outra página`);
  }
  for (let p = 1; p < paginas.length; p += 1) {
    assert.ok(todas[p].some((l) => l.includes('Descrição') && l.includes('Valor')), `cabeçalho repetido na página ${p + 1}`);
    assert.ok(todas[p].some((l) => l.includes('Lançamentos (continuação)')), `aviso de continuação na página ${p + 1}`);
  }
  const ultima = todas.at(-1);
  for (const t of ['Total de entradas', 'Total de saídas', 'Líquido']) assert.ok(ultima.some((l) => l.includes(t)), `${t} na última página, junto dos demais totais`);
  for (const [n, itens] of paginas.entries()) {
    assert.ok(todas[n].some((l) => l.includes(`Página ${n + 1} de ${paginas.length}`)));
    for (const it of itens) {
      assert.ok(it.x >= AREA_UTIL.margem - 0.5 && it.x + it.largura <= AREA_UTIL.largura - AREA_UTIL.margem + 0.5, `fora da largura: "${it.texto}"`);
      assert.ok(it.y >= 30 && it.y <= AREA_UTIL.altura - AREA_UTIL.margem, `fora da altura: "${it.texto}" em y=${it.y}`);
      const ehRodape = it.y < AREA_UTIL.base - 10;
      if (ehRodape) assert.match(it.texto, /AutoniCK|Página/, `só o rodapé fica abaixo da área útil: "${it.texto}"`);
    }
  }
});

test('totais que não cabem no fim da página vão inteiros para a seguinte, com o cabeçalho', async () => {
  // Procura um número de linhas que deixe a página quase cheia, para forçar o bloco de totais a mudar de página.
  for (let n = 30; n <= 130; n += 1) {
    const linhas = Array.from({ length: n }, (_, i) => [`Item ${i + 1}`, `R$ ${i},00`]);
    const totais = [['Total A', 'R$ 1,00'], ['Total B', 'R$ 2,00'], ['Total C', 'R$ 3,00'], ['Total D', 'R$ 4,00']];
    const { paginas } = await ler(await gerarPdf(PDFLib, base({ blocos: [{ tipo: 'tabela', titulo: 'Itens', colunas: [{ rotulo: 'Item' }, { rotulo: 'Valor', direita: true }], linhas, totais }] })));
    const todas = paginas.map(linhasDaPagina);
    const paginaDe = (t) => todas.findIndex((p) => p.some((l) => l.startsWith(t)));
    const ps = ['Total A', 'Total B', 'Total C', 'Total D'].map(paginaDe);
    assert.ok(ps.every((p) => p === ps[0]), `n=${n}: totais separados entre páginas ${ps}`);
    if (ps[0] > paginaDe(`Item ${n}`)) {
      assert.ok(todas[ps[0]].some((l) => l.includes('Item') && l.includes('Valor')), 'cabeçalho antes dos totais na página nova');
      return;
    }
  }
  assert.fail('nenhum caso levou os totais para a página seguinte');
});

test('relatório vazio, pares e texto longo; caracteres fora da fonte não quebram o arquivo', async () => {
  const bytes = await gerarPdf(PDFLib, base({ blocos: [
    { tipo: 'tabela', titulo: 'Sem movimento', colunas: [{ rotulo: 'Categoria' }, { rotulo: 'Valor' }], linhas: [], vazio: 'Nada no período escolhido.' },
    { tipo: 'pares', titulo: 'Dados', pares: [['Cliente', 'Cida'], ['Observação', 'x'.repeat(400)]] },
    { tipo: 'texto', titulo: 'Condições', paragrafos: ['Emoji 🙂 e ≥ não estão na fonte padrão; o arquivo continua válido.'] },
  ] }));
  const { paginas } = await ler(bytes);
  const texto = paginas.flatMap(linhasDaPagina).join('\n');
  assert.ok(texto.includes('Nada no período escolhido.'));
  assert.ok(texto.includes('Cliente') && texto.includes('Cida'));
  assert.ok(texto.includes('>= não estão na fonte padrão'));
});
