// Categoria G · indicadores de carregamento do AutoniCK.
// Cada loader expõe iniciar(), progresso(0..1) (quando a operação informa progresso real), concluir(ok) e parar().
// Nenhum loader tem duração própria: ele aparece enquanto a operação (simulada) dura e some quando ela termina.

import { ICONES } from './feedback.js';

const SVG_SINO = `<svg viewBox="0 0 64 64" aria-hidden="true"><g class="ld-sino-corpo"><path d="M32 6v6" stroke="#16111f" stroke-width="4" stroke-linecap="round"/>
<path d="M15 47c-3 0-5-1.4-5-3.3 0-2.3 3.3-3.6 4-7.6l1.6-9.3A16.6 16.6 0 0 1 32 13a16.6 16.6 0 0 1 16.4 13.8l1.6 9.3c.7 4 4 5.3 4 7.6 0 1.9-2 3.3-5 3.3z" fill="#f5b70a" stroke="#16111f" stroke-width="3.2" stroke-linejoin="round"/>
<path d="M20 30l8 2M44 30l-8 2" stroke="#16111f" stroke-width="3" stroke-linecap="round"/><path d="M21 33.5l6 1.2M43 33.5l-6 1.2" stroke="#6ea13e" stroke-width="3" stroke-linecap="round"/>
<path d="M27 41h10" stroke="#16111f" stroke-width="3" stroke-linecap="round"/></g><circle class="ld-sino-badalo" cx="32" cy="53" r="4.5" fill="#16111f"/></svg>`;
const SVG_ENGRENAGEM = `<svg viewBox="0 0 48 48" aria-hidden="true"><g class="ld-gira">${ICONES.engrenagem.replace('<svg viewBox="0 0 24 24" aria-hidden="true">', '<g transform="scale(2)">').replace('</svg>', '</g>')}</g></svg>`;

export const LOADERS = {
  G01: { nome: 'Fio dourado no topo', html: '<div class="ld ld-fio" role="progressbar" aria-label="Carregando a página"><i></i></div>' },
  G02: { nome: 'Sininho', html: `<div class="ld ld-sininho" role="status"><span class="ld-ic">${SVG_SINO}</span><span class="ld-txt">Carregando…</span></div>` },
  G03: { nome: 'Engrenagem CK', html: `<div class="ld ld-engr" role="status"><span class="ld-ic">${SVG_ENGRENAGEM}</span><span class="ld-txt">Processando…</span></div>` },
  G04: { nome: 'Linhas de velocidade', html: '<div class="ld ld-linhas" role="status"><span class="ld-faixa"></span><span class="ld-txt">Abrindo…</span></div>' },
  G05: { nome: 'Barra forjada', html: '<div class="ld ld-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="ld-trilho"><i></i></span><span class="ld-txt"><b>0%</b> gerando documento</span></div>' },
  G06: { nome: 'Esqueleto com retícula', html: '<div class="ld ld-esq" role="status" aria-label="Carregando registros"><i></i><i></i><i></i><i></i></div>' },
  G07: { nome: 'Card carregando', html: '<div class="ld ld-card" role="status" aria-label="Carregando indicador"><span class="ld-card-cab"></span><span class="ld-card-num">R$ <b>···</b></span><span class="ld-card-leg"></span></div>' },
  G08: { nome: 'Sino 3D', html: '<div class="ld ld-3d" role="status"><span class="ld-3d-palco"></span><span class="ld-txt">Preparando…</span></div>' },
  G09: { nome: 'Etapas reais', html: '<ol class="ld ld-etapas" role="status"><li>Validando lançamentos</li><li>Calculando saldo do dia</li><li>Registrando fechamento</li></ol>' },
  G10: { nome: 'Linha de estoque', html: '<div class="ld ld-linha" role="status"><span class="ld-prod">Capa de silicone</span><span class="ld-val"><s>5</s> <b>4</b></span><span class="ld-chip"><i></i>atualizando</span></div>' },
  G11: { nome: 'Abertura do app', html: '<div class="ld ld-splash" role="progressbar" aria-label="Abrindo o AutoniCK"><span class="ld-anel"><img alt="" src="public/assets/brand/autonick-geral-320.webp"></span><span class="ld-txt">Preparando o AutoniCK</span></div>' },
  G12: { nome: 'Orbe pulsante', html: '<div class="ld ld-orbe" role="status"><i></i><span class="ld-txt">Um instante…</span></div>' },
  G13: { nome: 'No próprio botão', html: '<div class="ld ld-botao"><button type="button" class="ld-bt" disabled><span class="ld-spin"></span><span>Salvando…</span></button></div>' },
};

/** Monta um loader dentro de `alvo`. Devolve o controle. */
export function criarLoader(tipo, alvo, { aoMontar3D } = {}) {
  const def = LOADERS[tipo] ?? LOADERS.G01;
  alvo.innerHTML = def.html;
  const el = alvo.firstElementChild; el.dataset.estado = 'parado';
  let p = 0, trickle = 0;
  const atualizar = () => {
    el.style.setProperty('--p', p);
    if (tipo === 'G05') { el.setAttribute('aria-valuenow', Math.round(p * 100)); el.querySelector('b').textContent = `${Math.round(p * 100)}%`; }
    if (tipo === 'G09') [...el.children].forEach((li, i) => { const n = el.children.length; li.dataset.e = p >= (i + 1) / n ? 'feito' : p >= i / n ? 'agora' : ''; });
    if (tipo === 'G11') el.style.setProperty('--p', p);
  };
  if (tipo === 'G08') aoMontar3D?.(el.querySelector('.ld-3d-palco'));
  return {
    el,
    iniciar() {
      p = 0; el.dataset.estado = 'ativo'; atualizar();
      if (tipo === 'G01' || tipo === 'G11') { clearInterval(trickle); trickle = setInterval(() => { p = p + (0.85 - p) * 0.08; atualizar(); }, 120); } // avança devagar sem nunca "fingir" o fim
    },
    progresso(v) { if (tipo === 'G01' || tipo === 'G11') return; p = Math.max(p, Math.min(1, v)); atualizar(); },
    concluir(ok = true) { clearInterval(trickle); p = 1; atualizar(); el.dataset.estado = ok ? 'feito' : 'falhou'; },
    parar() { clearInterval(trickle); el.dataset.estado = 'parado'; },
  };
}

/** Contextos de uso e a sugestão de loader para cada um (o usuário pode trocar e salvar). */
export const CONTEXTOS = [
  { id: 'navegacao', nome: 'Navegação entre páginas', sugestao: 'G01', bloqueia: false, porque: 'Não cobre a tela: a página atual continua legível até a próxima chegar.' },
  { id: 'consulta', nome: 'Consulta de registros', sugestao: 'G06', bloqueia: false, porque: 'Reserva o espaço da tabela; nada pula quando os dados chegam.' },
  { id: 'salvamento', nome: 'Salvamento de formulário', sugestao: 'G13', bloqueia: false, porque: 'O indicador fica onde a pessoa clicou; o formulário continua visível.' },
  { id: 'financeiro', nome: 'Processamento financeiro', sugestao: 'G09', bloqueia: true, porque: 'Mostra as etapas reais; quem fecha o caixa sabe em que ponto está.' },
  { id: 'estoque', nome: 'Atualização de estoque', sugestao: 'G10', bloqueia: false, porque: 'Só a linha alterada mostra o trabalho; o resto da lista segue usável.' },
  { id: 'dashboard', nome: 'Carregamento de dashboards', sugestao: 'G07', bloqueia: false, porque: 'Cada indicador chega na sua hora, sem esperar o mais lento.' },
  { id: 'documentos', nome: 'Geração de documentos', sugestao: 'G05', bloqueia: false, porque: 'Geração de PDF pode informar progresso real; barra determinada.' },
  { id: 'inicializacao', nome: 'Inicialização do aplicativo', sugestao: 'G11', bloqueia: true, porque: 'Único momento de tela cheia: o app ainda não tem conteúdo para mostrar.' },
];
