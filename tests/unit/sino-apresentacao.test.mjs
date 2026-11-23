/**
 * Laço do sino da página de apresentação (cena "Quem tocou?", opção A).
 * O módulo de animação é puro, então dá para conferir o tempo, a continuidade e as regras da cena sem navegador.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUEM_TOCOU, LACO, DURACAO_CICLO, poseDoLaco } from '../../public/js/ui/sino-hq/animacao-quem-tocou.js';

const vetor = (p) => [p.sino.rx, p.sino.ry, p.sino.rz, p.sino.sy, p.badalo.rx, p.badalo.rz, p.testa.ty, p.testa.rz, p.olhoE, p.olhoD,
  p.camera.az, p.camera.el, p.camera.dist, p.camera.alvoY];
const QUADRO = 1 / 60;

test('cena de 7 a 8 s, pausa de 3 a 4 s na pose final e retorno suave', () => {
  assert.ok(LACO.cena >= 7 && LACO.cena <= 8, `cena ${LACO.cena}`);
  assert.ok(LACO.pausaFinal >= 3 && LACO.pausaFinal <= 4, `pausa ${LACO.pausaFinal}`);
  assert.ok(LACO.retorno > 0.5 && LACO.retorno <= 1.5, `retorno ${LACO.retorno}`);
  assert.equal(DURACAO_CICLO, LACO.cena + LACO.pausaFinal + LACO.retorno);
  const final = JSON.stringify(poseDoLaco(LACO.cena));
  for (let t = LACO.cena; t <= LACO.cena + LACO.pausaFinal; t += 0.25) assert.equal(JSON.stringify(poseDoLaco(t)), final, `pausa em ${t}`);
});

test('o fim de um ciclo é exatamente o começo do próximo (sem salto no reinício)', () => {
  const fim = vetor(poseDoLaco(DURACAO_CICLO - 1e-9));
  const inicio = vetor(poseDoLaco(0));
  fim.forEach((v, i) => assert.ok(Math.abs(v - inicio[i]) < 1e-6, `componente ${i}: ${v} × ${inicio[i]}`));
  assert.equal(poseDoLaco(DURACAO_CICLO - 1e-9).boca, poseDoLaco(0).boca);
  assert.deepEqual(vetor(poseDoLaco(DURACAO_CICLO + 2.5)), vetor(poseDoLaco(2.5)), 'segundo ciclo igual ao primeiro');
});

test('dois ciclos a 60 quadros por segundo sem saltos no corpo do sino nem na câmera', () => {
  let anterior = vetor(poseDoLaco(0)); let maior = 0; let quando = 0;
  for (let t = QUADRO; t <= 2 * DURACAO_CICLO + QUADRO; t += QUADRO) {
    const atual = vetor(poseDoLaco(t));
    const d = Math.max(Math.abs(atual[0] - anterior[0]), Math.abs(atual[1] - anterior[1]), Math.abs(atual[2] - anterior[2]));
    if (d > maior) { maior = d; quando = t; }
    // câmera sem degrau (unidades do modelo; o sino tem cerca de 2,3 de altura)
    assert.ok(Math.abs(atual[12] - anterior[12]) < 0.02 && Math.abs(atual[13] - anterior[13]) < 0.02, `câmera em ${t.toFixed(2)} s`);
    anterior = atual;
  }
  assert.ok(maior <= 1.5, `maior variação ${maior.toFixed(2)}° em ${quando.toFixed(2)} s`);
});

test('a cena mantém as batidas aprovadas: contato no aro, badalo atrasado, piscada e sorriso de canto sustentado', () => {
  const c = QUEM_TOCOU.contato;
  assert.ok(Math.hypot(...poseDoLaco(c).martelo.desloc) < 1e-9, 'no contato o martelo está na pose de contato (ponta no aro)');
  assert.ok(Math.abs(poseDoLaco(c).martelo.giro) < 1e-9, 'sem giro no contato');
  assert.ok(poseDoLaco(c + 0.01).hq.some((g) => g.tipo === 'toc'), 'TOC! no impacto');
  assert.equal(poseDoLaco(c + 0.05).badalo.rz, 0, 'badalo ainda parado logo depois do contato');
  assert.notEqual(poseDoLaco(c + 0.2).badalo.rz, 0, 'badalo reage depois');
  let piscou = false; let canto = 0;
  for (let t = c; t <= LACO.cena + LACO.pausaFinal; t += 0.01) {
    const p = poseDoLaco(t);
    if (p.olhoE < 0.2 && p.olhoD > 0.8) piscou = true;
    if (p.boca === 'canto') canto += 0.01;
  }
  assert.ok(piscou, 'pisca um olho só');
  assert.ok(canto >= 1.5 + LACO.pausaFinal - 0.05, `sorriso de canto visível por ${canto.toFixed(2)} s`);
  assert.equal(poseDoLaco(LACO.cena).martelo, null, 'o martelo já saiu na pose final');
});

test('uma boca por vez e nenhum efeito sobrando no retorno', () => {
  for (let t = 0; t < DURACAO_CICLO; t += 0.02) {
    const p = poseDoLaco(t);
    assert.ok(['neutra', 'o', 'canto'].includes(p.boca), `boca em ${t}`);
    if (t > LACO.cena) { assert.equal(p.martelo, null); assert.equal(p.hq.length, 0); assert.equal(p.fx.estrela + p.fx.onda1 + p.fx.onda2, 0); }
  }
});

test('movimento reduzido sob pedido: toca uma vez e para na pose final, sem voltar', () => {
  const fim = JSON.stringify(poseDoLaco(LACO.cena + LACO.pausaFinal, { soUmaVez: true }));
  assert.equal(JSON.stringify(poseDoLaco(DURACAO_CICLO + 5, { soUmaVez: true })), fim);
  assert.equal(poseDoLaco(DURACAO_CICLO + 5, { soUmaVez: true }).boca, 'canto');
});
