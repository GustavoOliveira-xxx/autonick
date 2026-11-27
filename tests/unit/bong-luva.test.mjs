/**
 * E10: laço da página inicial com o "Chamado da Forja" seguido de "Bong e a luva".
 * Sem a luva carregada, o laço é só o Chamado (comportamento anterior). Com ela: alternância, "BONG!" no peteleco, luva só
 * durante a cena dela, descanso de ~2,9 s em cada cena e nenhuma quebra de pose ou de câmera nas emendas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as laco from '../../public/js/ui/sino-hq/animacao-chamado-forja.js';
import { OBJETOS } from '../../public/js/ui/forja3d/objetos.js';
import '../../public/js/ui/forja3d/mao.js';

const vetor = (p) => [p.sino.rx, p.sino.ry, p.sino.rz, p.sino.sy, p.sino.ty, p.badalo.rz, p.olhoE, p.olhoD, p.testa.ty];

test('sem a luva: o laço é só o Chamado da Forja', () => {
  assert.equal(laco.duracaoDoLaco(), laco.DURACAO_CICLO);
  assert.deepEqual(laco.enquadramentoDoLaco(3), laco.CHAMADO.enquadramento);
});

test('com a luva: alterna as cenas, BONG! no golpe e a luva só aparece na cena dela', () => {
  laco.usarLuva(OBJETOS.mao_luva);
  const total = laco.duracaoDoLaco();
  assert.ok(total > laco.DURACAO_CICLO + 6, `laço total ${total}`);
  assert.ok(Math.abs(laco.LACO_LUVA.pausaFinal + (laco.BONG_LUVA.dur - laco.BONG_LUVA.fimMovimento) - 2.9) < 1e-9, 'descanso de 2,9 s');
  const inicioLuva = laco.DURACAO_CICLO;
  let bong = false; let luvaNoChamado = false; let luvaNaCena = false;
  for (let t = 0; t < total; t += 0.02) {
    const p = laco.poseDoLaco(t);
    const temLuva = p.objetos.some((o) => o.id === 'mao_luva');
    if (t < inicioLuva && temLuva) luvaNoChamado = true;
    if (t >= inicioLuva && temLuva) luvaNaCena = true;
    if (p.hq.some((g) => g.tipo === 'texto' && g.texto === 'BONG!')) bong = true;
    assert.ok(!p.hq.some((g) => g.texto === 'PLIM!'), 'na home o texto é BONG!');
  }
  assert.equal(luvaNoChamado, false);
  assert.equal(luvaNaCena, true);
  assert.equal(bong, true);
  const final = laco.poseDoLaco(inicioLuva + laco.LACO_LUVA.cena + 0.5);
  assert.ok(!final.objetos.some((o) => o.id === 'mao_luva'), 'a luva já saiu no descanso');
});

test('emendas sem salto: pose e câmera contínuas entre as cenas e na volta ao início', () => {
  const total = laco.duracaoDoLaco();
  const QUADRO = 1 / 60;
  for (const emenda of [laco.DURACAO_CICLO, total]) {
    const a = vetor(laco.poseDoLaco(emenda - 1e-6)), b = vetor(laco.poseDoLaco(emenda + 1e-6));
    a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-3, `pose salta na emenda ${emenda} (${i}: ${v} → ${b[i]})`));
    const ea = laco.enquadramentoDoLaco(emenda - 1e-6), eb = laco.enquadramentoDoLaco(emenda + 1e-6);
    for (const c of Object.keys(ea)) assert.ok(Math.abs(ea[c] - eb[c]) < 1e-3, `câmera salta na emenda ${emenda} (${c})`);
  }
  let maior = 0;
  for (let t = QUADRO; t < total; t += QUADRO) {
    const a = laco.enquadramentoDoLaco(t - QUADRO), b = laco.enquadramentoDoLaco(t);
    for (const c of Object.keys(a)) maior = Math.max(maior, Math.abs(a[c] - b[c]));
  }
  assert.ok(maior < 0.02, `maior passo de câmera por quadro: ${maior}`);
  assert.ok(laco.poseDoLaco(1, { soUmaVez: true }), 'movimento reduzido toca só o Chamado');
  assert.equal(laco.ciclosCompletos(laco.DURACAO_CICLO - 0.01), 0);
  assert.equal(laco.ciclosCompletos(laco.DURACAO_CICLO + 0.01), 1, 'o Chamado completo conta um ciclo');
  assert.equal(laco.ciclosCompletos(total + 0.01), 2, 'Chamado e luva: dois ciclos');
});
