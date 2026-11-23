/**
 * Introdução da primeira visita do Cliente (M13b; RF-186; ADR-G13b D13b-12 = A).
 * Guarda no aparelho só o indicador não sensível "introdução vista". Nenhum dado pessoal, nenhum rascunho.
 * Depois de fechada, a introdução continua disponível pelo link "Como funciona".
 */
const CHAVE = 'autonick.cliente.introducaoVista';

function vista() {
  try { return localStorage.getItem(CHAVE) === '1'; } catch { return false; }
}

export function iniciarIntroducao() {
  const secao = document.getElementById('como-funciona');
  const fechar = document.getElementById('fechar-introducao');
  const abrir = document.getElementById('abrir-introducao');
  if (!secao || !fechar || !abrir) return;
  const mostrar = (sim) => { secao.hidden = !sim; abrir.hidden = sim; };
  mostrar(!vista());
  fechar.addEventListener('click', () => {
    try { localStorage.setItem(CHAVE, '1'); } catch { /* sem armazenamento: fecha só nesta visita */ }
    mostrar(false);
    abrir.focus();
  });
  abrir.addEventListener('click', () => { mostrar(true); secao.querySelector('h2')?.focus(); });
}

// Abertura: alinha o foco dos raios ao orbe da logo (73% x 19% da arte), sem mudar o desenho do fundo (aprovado na Etapa 1).
export function alinharFocoDaCapa() {
  const capa = document.querySelector('.capa-revista');
  const arte = capa?.querySelector('.capa-revista__heroi img');
  if (!capa || !arte) return;
  const alinhar = () => {
    const c = capa.getBoundingClientRect(); const a = arte.getBoundingClientRect();
    if (!a.width) return;
    capa.style.setProperty('--foco-x', `${a.left - c.left + a.width * 0.73}px`);
    capa.style.setProperty('--foco-y', `${a.top - c.top + a.height * 0.19}px`);
  };
  if (arte.complete) alinhar(); else arte.addEventListener('load', alinhar);
  addEventListener('resize', alinhar);
}
