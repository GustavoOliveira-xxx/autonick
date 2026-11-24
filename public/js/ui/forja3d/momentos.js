/**
 * Momentos 3D nas telas (categoria I da direção CK Forja Noturna).
 *
 * montarMomento(lugar, 'IB02') cria uma cena decorativa (aria-hidden: o texto da tela já diz o que aconteceu).
 * A cena fica parada até disparar() ser chamado DEPOIS de uma confirmação real do sistema.
 * Sem WebGL, a cena some e a tela continua igual. Com movimento reduzido, mostra o estado final sem animar.
 * O Three.js só é baixado quando a primeira cena aparece; o sino, só quando a cena precisa dele.
 */
import { obterMotor } from './motor.js';
import { CENAS_I, amostrasDe } from './cenas.js';

const ESTILO = Object.freeze({ modo: 'hq', luz: 'forja', contorno: true });
const enquadramentos = new Map();
const reduzido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function montarMomento(lugar, id, { tamanho = 'm', continua = false, inicial = {} } = {}) {
  const cena = CENAS_I[id];
  const el = document.createElement('div');
  el.className = `momento-3d momento-3d--${tamanho}`;
  el.setAttribute('aria-hidden', 'true');
  el.dataset.momento = id;
  lugar.append(el);
  const mem = { ...inicial }; let v = null, morto = false, timer = 0;
  const pronto = obterMotor().then(async (m) => {
    if (cena.sino) await m.carregarSino();
    if (morto || !el.isConnected) return null;
    if (!enquadramentos.has(id)) enquadramentos.set(id, m.enquadrarTrajetoria(amostrasDe(cena), { comSino: Boolean(cena.sino) }));
    v = m.criarVista(el, { fonte: (t, ctx) => cena.quadro(t, mem, ctx), enquadramento: enquadramentos.get(id), sino: Boolean(cena.sino), estilo: ESTILO });
    el.classList.add('momento-3d--pronto');
    if (continua && !reduzido()) v.tocar();
    return v;
  }).catch(() => { el.hidden = true; return null; });
  const tocarPor = (s) => { if (!v) return; clearTimeout(timer); v.tocar(); timer = setTimeout(() => v?.pausar(), s * 1000); };
  return {
    elemento: el, pronto, mem,
    /** Evento real aconteceu: anima o momento uma vez (ou mostra o estado final, com movimento reduzido). */
    async disparar(campos = {}) {
      await pronto; if (!v) return;
      Object.assign(mem, campos);
      if (reduzido()) { mem.inicio = v.t - (cena.dur + 0.5); v.redesenhar(); return; }
      mem.inicio = v.t; tocarPor(cena.dur + 0.8);
    },
    /**
     * Atualiza o estado (por exemplo, fase de uma operação em andamento). 'agora' marca o instante atual;
     * uma função recebe o instante atual e devolve o valor (ex.: (t) => [t, t + 0.3]).
     */
    async definir(campos = {}, { manter = false, duracao = 1.6 } = {}) {
      await pronto; if (!v) return;
      const agora = reduzido() ? v.t - 60 : v.t;
      for (const [k, val] of Object.entries(campos)) mem[k] = val === 'agora' ? agora : typeof val === 'function' ? val(agora) : val;
      if (reduzido()) { v.redesenhar(); return; }
      if (manter) { clearTimeout(timer); v.tocar(); } else tocarPor(duracao);
    },
    destruir() { morto = true; clearTimeout(timer); v?.liberar(); el.remove(); },
  };
}

/**
 * Estado vazio com um momento 3D ao lado do texto (ex.: IB02, caixa CK no estoque vazio).
 * O texto continua sendo a informação; a cena é decorativa e entra uma vez.
 */
export function vazioComMomento(id, atributos, ...conteudo) {
  const caixa = document.createElement('div');
  caixa.className = 'estado-vazio com-momento';
  for (const [k, v] of Object.entries(atributos ?? {})) if (v != null) caixa.setAttribute(k, v);
  const texto = document.createElement('div');
  texto.append(...conteudo.filter(Boolean).map((c) => (typeof c === 'string' ? Object.assign(document.createElement('p'), { textContent: c }) : c)));
  caixa.append(texto);
  montarMomento(caixa, id).disparar();
  return caixa;
}
