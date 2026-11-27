// Cena "Chamado da Forja" do sino HQ (direção CK Forja Noturna), animação principal da página inicial.
// O círculo rúnico acende, a orbe do logotipo se forma diante do sino, carrega enquanto ele se concentra, entra nos
// visores e o sino libera uma onda dourada. Tudo nasce dentro do quadro; o sino original não muda.
// Módulo puro: não depende de Three.js nem do DOM.
import { clamp, mix, CURVAS, trilha, oscila, arco, sino01, poseNeutra, misturarPoses, reagirGolpe, AMBIENTE } from '../forja3d/curvas.js';

const sai = CURVAS.sai, suave = CURVAS.suave, volta = CURVAS.volta;
const CIRC = [0, 1.15, -0.95];
const B12F = {
  dur: 5.2, fimMovimento: 4.95, enquadramento: { meiaAltura: 1.78, meiaLargura: 2.05, deslocX: 0.1, deslocY: 0.05 }, objetos: ['circulo', 'orbe'], toque: 0.4,
  fases: [['calma', 0, 0.45], ['círculo acende', 0.45, 1.35], ['orbe se forma', 0.9, 1.5], ['carga e concentração', 1.5, 2.3], ['energia entra nos visores', 2.3, 2.55], ['onda dourada', 2.55, 3.3], ['brasa e repouso', 3.3, 4.95]],
  quadro(t) {
    const p = poseNeutra(); const red = AMBIENTE.reduzido;
    const C = 2.55;
    // círculo rúnico: acende, aguenta, inflama no golpe e apaga devagar
    const forca = trilha([[0.45, 0], [1.35, 0.85, 'sai'], [2.3, 1], [C, 1], [C + 0.12, 1.45, 'sai'], [3.4, 0.9, 'suave'], [4.8, 0, 'suave']])(t);
    if (forca > 0.005) p.objetos.push({ id: 'circulo', pos: CIRC, rot: [0, 0, 0], esc: 0.78 + 0.06 * sai(clamp((t - 0.45) / 1.2)) + (t > C ? 0.04 * sino01(t, C, 0.8) : 0), forca, giro: 8 * t + (t > C ? 32 * sai(clamp((t - C) / 1.4)) : 0) });
    // orbe: forma-se diante do sino (nunca entra pela borda), carrega e viaja num arco curto
    const P0 = [0.82, 1.42, 1.05], P1 = [0.42, 1.28, 1.18], ALVO = [0, 1.05, 0.7];
    if (t > 0.9 && t < C) {
      let pos = t < 1.5 ? P0 : t < 2.3 ? arco(t, 1.5, 2.3, P0, [0.7, 1.5, 1.25], P1) : arco(t, 2.3, C, P1, [0.25, 1.3, 1.1], ALVO, 'entra');
      if (t > 1.6 && t < 2.3) pos = pos.map((v, i) => v + (i === 1 ? 0.012 * Math.sin(t * 38) : 0)); // vibra de energia
      const esc = t < 1.5 ? volta(clamp((t - 0.9) / 0.5)) : t < 2.3 ? 1 + 0.08 * sino01(t, 1.5, 0.8) : mix(1, 0.32, CURVAS.entra(clamp((t - 2.3) / 0.25)));
      p.objetos.push({ id: 'orbe', pos, rot: [0, 0, 0], esc, carga: t < 1.5 ? 0.3 : mix(0.3, 1.25, suave(clamp((t - 1.5) / 0.8))), giro: 90 * t });
      if (t < 1.35) p.hq.push({ tipo: 'faiscas', vida: clamp((t - 0.9) / 0.45), em: P0 });
      if (!red && t > 2.3) p.hq.push({ tipo: 'velocidade', vida: (t - 2.3) / 0.25, em: [0.35, 1.2, 1.0], dir: 'esquerda' });
    }
    // sino: concentração (olhos estreitos, testa baixa, leve elevação), golpe de energia e acomodação
    const foco = trilha([[0.6, 0], [1.4, 0.6, 'suave'], [2.3, 1, 'suave'], [C, 1], [C + 0.06, 0, 'sai']])(t);
    p.olhoE = p.olhoD = mix(1, 0.42, foco); p.testa.ty = -0.016 * foco; p.testa.rz = -3 * foco;
    p.sino.ty = 0.035 * foco + (t > C ? 0.05 * sino01(t, C, 0.5) : 0);
    p.sino.sy = t < C ? 1 - 0.045 * foco : 1 + oscila(t, C, C + 1.2, 0.07, 2.2, 0.35, 0.4);
    p.visor = trilha([[1.6, 0], [2.3, 0.45, 'suave'], [C, 0.6], [C + 0.08, 1, 'sai'], [3.6, 0.85], [4.9, 0, 'suave']])(t);
    reagirGolpe(p, t, C, { forca: 0.8, lado: 1, texto: 'FWOOM!', alvo: 'topo' });
    if (t >= C && t < C + 0.85) p.hq.push({ tipo: 'anel', vida: (t - C) / 0.85, em: 'cabeca' });
    if (!red && t >= C + 0.1 && t < C + 1.6) p.hq.push({ tipo: 'faiscas', vida: ((t - C - 0.1) / 0.8) % 1, em: 'cabeca' });
    p.impacto = Math.max(p.impacto, t >= C ? Math.max(0, 1 - (t - C) / 0.9) : foco * 0.25);
    if (t > 3.35) p.boca = 'canto';
    p.sino.rx = trilha([[3.1, 0], [3.6, -3, 'suave']])(t); p.testa.rz += trilha([[3.4, 0], [3.9, 4, 'suave']])(t);
    return p;
  },
};


export const CHAMADO = Object.freeze({ dur: B12F.dur, fimMovimento: B12F.fimMovimento, enquadramento: Object.freeze(B12F.enquadramento), pose: (t) => B12F.quadro(t) });

/*
 * E10 · Cena "Bong e a luva" (complementa o Chamado da Forja, não o substitui): a luva clássica do Bong entra pela direita,
 * fica um instante, dá um peteleco no aro ("BONG!"), comemora com joinha e sai. O sino reage ao golpe e volta ao repouso.
 * A geometria e os gestos da luva vêm do Animation Lab aprovado (forja3d/mao.js, objeto `mao_luva`). Módulo puro.
 */
let defLuva = null;
export function usarLuva(definicao) { defLuva = definicao; }
const BONG = {
  dur: 4.6, fimMovimento: 4.3, enquadramento: { meiaAltura: 1.78, meiaLargura: 2.4, deslocX: 0.35, deslocY: 0.05 },
  quadro(t) {
    const p = poseNeutra();
    if (!defLuva) return p;
    const E = 0.55, O = 1.15, I = 3.35, S = 3.8; // entrada, ocioso, interação (peteleco + joinha), saída
    let estado = null;
    if (t < E) estado = defLuva.entrada(t);
    else if (t < O) estado = defLuva.ocioso(t - E);
    else if (t < I) estado = defLuva.interacao(t - O, p);
    else if (t < S) estado = defLuva.saida(t - I);
    if (estado) p.objetos.push({ id: 'mao_luva', ...estado });
    for (const g of p.hq) if (g.tipo === 'texto' && g.texto === 'PLIM!') g.texto = 'BONG!';
    if (t > 2.2 && t < 3.6) p.boca = 'canto';
    return p;
  },
};
export const BONG_LUVA = Object.freeze({ dur: BONG.dur, fimMovimento: BONG.fimMovimento, enquadramento: Object.freeze(BONG.enquadramento), pose: (t) => BONG.quadro(t) });

/*
 * Laço da página inicial (ritmo C04): o sino fica cerca de 2,9 s parado entre um chamado e outro
 * (cauda imóvel da cena + pausa na pose final), depois volta suave à pose inicial e recomeça.
 */
const PARADO = 2.9;
export const LACO = Object.freeze({ cena: CHAMADO.dur, pausaFinal: PARADO - (CHAMADO.dur - CHAMADO.fimMovimento), retorno: 1.0 });
// E10: o segundo trecho do laço é a cena da luva, com o mesmo descanso de ~2,9 s. Sem a luva carregada, só o Chamado.
export const LACO_LUVA = Object.freeze({ cena: BONG_LUVA.dur, pausaFinal: PARADO - (BONG_LUVA.dur - BONG_LUVA.fimMovimento), retorno: 1.0 });
const CICLO_CHAMADO = LACO.cena + LACO.pausaFinal + LACO.retorno;
const CICLO_LUVA = LACO_LUVA.cena + LACO_LUVA.pausaFinal + LACO_LUVA.retorno;
export const DURACAO_CICLO = CICLO_CHAMADO;
export const duracaoDoLaco = () => CICLO_CHAMADO + (defLuva ? CICLO_LUVA : 0);

function trecho(cena, laco, u) {
  if (u <= laco.cena) return cena.quadro(u);
  const final = cena.quadro(laco.cena);
  if (u <= laco.cena + laco.pausaFinal) return final;
  const k = suave(clamp((u - laco.cena - laco.pausaFinal) / laco.retorno));
  return misturarPoses(final, cena.quadro(0), k);
}

/** Ciclos completos até o instante t: cada cena (Chamado ou luva, com seu descanso e retorno) conta como um ciclo. */
export function ciclosCompletos(t) {
  if (!defLuva) return Math.floor(t / CICLO_CHAMADO);
  const total = duracaoDoLaco();
  const voltas = Math.floor(t / total);
  const u = t - voltas * total;
  return voltas * 2 + (u >= CICLO_CHAMADO + CICLO_LUVA - 1e-9 ? 2 : u >= CICLO_CHAMADO ? 1 : 0);
}

/** Qual cena está no ar num instante do laço. */
export function cenaDoLaco(t) {
  const total = duracaoDoLaco();
  const u = ((t % total) + total) % total;
  return u < CICLO_CHAMADO ? CHAMADO : BONG_LUVA;
}

/** Enquadramento da câmera: muda de uma cena para a outra só durante o retorno suave (sem salto de câmera). */
export function enquadramentoDoLaco(t) {
  if (!defLuva) return CHAMADO.enquadramento;
  const total = duracaoDoLaco();
  const u = ((t % total) + total) % total;
  const A = CHAMADO.enquadramento, B = BONG_LUVA.enquadramento;
  const mistura = (x, y, k) => Object.fromEntries(Object.keys(x).map((c) => [c, mix(x[c], y[c], k)]));
  const iniRetornoA = LACO.cena + LACO.pausaFinal;
  if (u < CICLO_CHAMADO) return u < iniRetornoA ? A : mistura(A, B, suave(clamp((u - iniRetornoA) / LACO.retorno)));
  const v = u - CICLO_CHAMADO, iniRetornoB = LACO_LUVA.cena + LACO_LUVA.pausaFinal;
  return v < iniRetornoB ? B : mistura(B, A, suave(clamp((v - iniRetornoB) / LACO_LUVA.retorno)));
}

/** Pose num instante do laço. Com `soUmaVez`, toca só o Chamado e para na pose final (uso manual com movimento reduzido). */
export function poseDoLaco(t, { reduzido = false, soUmaVez = false } = {}) {
  AMBIENTE.reduzido = reduzido;
  if (soUmaVez) return trecho(B12F, LACO, Math.min(t, LACO.cena + LACO.pausaFinal));
  const total = duracaoDoLaco();
  const u = ((t % total) + total) % total;
  return u < CICLO_CHAMADO ? trecho(B12F, LACO, u) : trecho(BONG, LACO_LUVA, u - CICLO_CHAMADO);
}
