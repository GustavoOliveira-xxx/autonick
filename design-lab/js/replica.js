// Réplica funcional da home e do painel Business, com o sino 3D (motor compartilhado), as composições de fundo (A),
// os fundos animados (E), as direções (J), o estilo de botão, o feedback de clique (F) e o loader (G).

import { obterMotor, URL_POSTER } from './motor/motor.js';
import { ANIMACOES, RITMOS, criarLaco } from './motor/animacoes.js';
import { OBJETOS } from './motor/objetos.js';
import { clamp, mix } from './motor/curvas.js';
import { ligarBotao, SIMULACAO } from './feedback.js';
import { criarLoader } from './loaders.js';
import { RUNTIME } from './estado.js';

export const LOGO = 'public/assets/brand/autonick-geral-320.webp';
export const LOGO_EMP = 'public/assets/brand/autonick-empresarial-320.webp';
export const ORIGINAL = Object.freeze({ a: 'A00', e: 'E00', ie: 2, dir: 'J00', pos: 'direita', escala: 1, anim: 'B00', ritmo: 'C01', ritmoSeg: null, objeto: null, botao: 'orbe', feedback: 'F00', loader: 'G01', ling: 'H01' });
const ENQ_LARGO = { meiaAltura: 1.75, meiaLargura: 3.05, deslocX: 0.85 };
const ENQ_ESQ = { meiaAltura: 1.75, meiaLargura: 3.05, deslocX: -0.7 };
const COM_FOCO_FIXO = new Set(['A00']);

let runasURL = null;
function runas() {
  if (runasURL) return runasURL;
  const cv = document.createElement('canvas'); cv.width = cv.height = 640; const c = cv.getContext('2d'); c.translate(320, 320);
  c.strokeStyle = 'rgba(255,223,126,0.85)'; c.fillStyle = 'rgba(255,223,126,0.85)';
  for (const [r, l] of [[300, 5], [276, 2], [205, 2], [180, 4]]) { c.lineWidth = l; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke(); }
  for (let i = 0; i < 24; i++) {
    c.save(); c.rotate((i / 24) * Math.PI * 2); c.translate(0, -240); c.lineWidth = 3;
    if (i % 4 === 0) { c.beginPath(); c.arc(0, 0, 16, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.moveTo(-10, -10); c.lineTo(10, 10); c.moveTo(10, -10); c.lineTo(-10, 10); c.stroke(); }
    else if (i % 2) { c.beginPath(); c.moveTo(0, -14); c.lineTo(0, 14); c.moveTo(-10, 0); c.lineTo(10, 0); c.stroke(); }
    else { c.beginPath(); for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; const rr = k % 2 ? 4 : 12; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath(); c.fill(); }
    c.restore();
  }
  for (let i = 0; i < 72; i++) { c.save(); c.rotate((i / 72) * Math.PI * 2); c.fillRect(-1.5, -298, 3, i % 6 ? 10 : 22); c.restore(); }
  runasURL = `url(${cv.toDataURL('image/png')})`; return runasURL;
}

const htmlHome = () => `
<p class="rp-faixa"><strong>VERSÃO DE DESENVOLVIMENTO</strong>: use apenas dados de teste. As telas com login gravam o que você envia no banco de dados de desenvolvimento.</p>
<header class="rp-cab"><div class="rp-cab-in">
  <span class="rp-marca"><img src="${LOGO}" alt=""><span>Autoni<b>CK</b></span></span>
  <nav class="rp-nav" aria-label="Principal (réplica)"><a aria-current="page">Início</a><a>Encontrar serviços</a><a>Gerenciar meu negócio</a><a>Ajuda</a></nav>
  <button type="button" class="rp-leitura" tabindex="-1"><b>Aa</b><span> Leitura ampliada</span></button>
  <button type="button" class="rp-bt rp-entrar" tabindex="-1">Entrar</button>
</div></header>
<div class="rp-carga"></div>
<section class="rp-heroi">
  <div class="rp-fundo" aria-hidden="true"><div class="rp-base"></div><div class="rp-chao"></div><div class="rp-raios"></div><div class="rp-aura"></div><div class="rp-circulo"></div><div class="rp-painel"><i></i></div><canvas class="rp-fx"></canvas><div class="rp-ret"></div><div class="rp-moldura"></div><div class="rp-onda"></div><div class="rp-luz"></div></div>
  <div class="rp-heroi-in">
    <div class="rp-texto">
      <h1>Bem-vindo ao AutoniCK</h1>
      <p class="rp-resumo">Encontre negócios e serviços perto de você ou organize as vendas, o estoque e o atendimento do seu negócio.</p>
      <div class="rp-perfis area-escura-msg">
        <div class="rp-perfil"><p class="rp-perfil-t"><b>Sou cliente</b> <span>encontrar negócios e serviços</span></p><div class="rp-acoes"><button type="button" class="rp-bt rp-bt--orbe"><span class="fb-rot">Criar conta</span></button><button type="button" class="rp-bt rp-bt--sec"><span class="fb-rot">Entrar</span></button></div></div>
        <div class="rp-perfil"><p class="rp-perfil-t"><b>Tenho um negócio</b> <span>organizar vendas, estoque e atendimento</span></p><div class="rp-acoes"><button type="button" class="rp-bt rp-bt--orbe"><span class="fb-rot">Criar conta</span></button><button type="button" class="rp-bt rp-bt--sec"><span class="fb-rot">Entrar</span></button></div></div>
      </div>
    </div>
    <div class="rp-sino"><div class="rp-sino-palco"><img class="poster-3d" src="${URL_POSTER}" alt="Sino do AutoniCK (imagem estática, usada enquanto o 3D carrega ou sem WebGL)"></div></div>
  </div>
</section>
<section class="rp-abaixo"><h2>O que você quer fazer?</h2><div class="rp-escolhas">
  <article class="rp-escolha"><h3>Encontrar produtos e serviços</h3><p>Pesquise por nome, serviço, cidade ou bairro. Não precisa criar conta para olhar.</p><button type="button" class="rp-bt" tabindex="-1">Começar a busca</button></article>
  <article class="rp-escolha"><h3>Gerenciar meu negócio</h3><p>Produtos, estoque, vendas e serviços da sua empresa em um só lugar.</p><button type="button" class="rp-bt" tabindex="-1">Ir para o AutoniCK Business</button></article>
</div></section>`;

const itemMenu = (n, cur, cont) => `<li${cur ? ' aria-current="page"' : ''}><i></i>${n}${cont ? `<span class="contagem">${cont}</span>` : ''}</li>`;
const htmlPainel = () => `
<p class="rpb-faixa"><strong>DEMONSTRAÇÃO</strong> Dados fictícios no seu computador. Nenhum pagamento é real.</p>
<div class="rpb-grade">
  <aside class="rpb-lateral"><span class="rp-marca"><img src="${LOGO_EMP}" alt=""><span>Autoni<b>CK</b><small>EMPRESARIAL</small></span></span>
    <div class="rpb-empresa"><small>EMPRESA ATIVA</small>[TESTE] Conserta Celular</div>
    <p class="rpb-grupo">OPERAÇÃO</p><ul class="rpb-menu">${itemMenu('Painel', true, 1)}${itemMenu('Vendas')}${itemMenu('Pedidos')}${itemMenu('Orçamentos')}${itemMenu('Ordens de serviço')}${itemMenu('Agenda')}</ul>
    <p class="rpb-grupo">CATÁLOGO</p><ul class="rpb-menu">${itemMenu('Produtos')}${itemMenu('Estoque')}${itemMenu('Serviços')}</ul>
    <p class="rpb-grupo">GESTÃO</p><ul class="rpb-menu">${itemMenu('Financeiro')}${itemMenu('Clientes')}</ul>
  </aside>
  <main class="rpb-main">
    <div class="rpb-cab"><div><h1>Painel</h1><p>segunda-feira, 23 de novembro · [TESTE] Conserta Celular</p></div>
      <div class="rpb-acoes-topo"><button type="button" class="rp-bt rp-bt--orbe" tabindex="-1">Nova venda</button><button type="button" class="rp-bt rp-bt--sec" tabindex="-1">Orçamentos</button><button type="button" class="rp-bt rp-bt--sec" tabindex="-1">Lançar no financeiro</button></div></div>
    <h2>Precisa da sua ação</h2>
    <div class="rpb-fichas">
      <div class="rpb-ficha"><b>1</b><span>Pedidos aguardando aceite</span><small>Cida Ramos · R$ 69,00</small><a>Ver pedidos →</a></div>
      <div class="rpb-ficha"><b>0</b><span>Orçamentos para responder</span><small>Nenhum esperando</small><a>Responder →</a></div>
      <div class="rpb-ficha"><b>2</b><span>Ordens de serviço em andamento</span><small>Nenhuma atrasada</small><a>Ver OS →</a></div>
      <div class="rpb-ficha"><b>1</b><span>Mensagens novas</span><small>Em 1 atendimento</small><a>Ver conversas →</a></div>
    </div>
    <h2>Números da empresa</h2>
    <div class="rpb-indicadores">
      <div class="rpb-escudo"><div class="rpb-escudo-in"><div class="rpb-escudo-cab">Vendas de novembro</div><div class="rpb-escudo-corpo"><span class="rpb-valor">R$ 304,00</span><span class="rpb-legenda">3 vendas confirmadas</span><div class="rpb-barras"><i style="height:6%"></i><i style="height:6%"></i><i style="height:6%"></i><i style="height:94%"></i></div></div></div></div>
      <div class="rpb-col"><div class="rpb-escudo"><div class="rpb-escudo-in"><div class="rpb-escudo-cab">A receber · 7 dias</div><div class="rpb-escudo-corpo"><span class="rpb-valor">R$ 300,00</span><span class="rpb-legenda">2 parcelas</span></div></div></div>
        <div class="rpb-escudo"><div class="rpb-escudo-in"><div class="rpb-escudo-cab">Saldo das contas</div><div class="rpb-escudo-corpo"><span class="rpb-valor">R$ 184,00</span><span class="rpb-legenda">Registrado no AutoniCK; não é extrato bancário.</span></div></div></div></div>
      <div class="rpb-col"><div class="rpb-escudo"><div class="rpb-escudo-in"><div class="rpb-escudo-cab">A pagar · 7 dias</div><div class="rpb-escudo-corpo"><span class="rpb-valor">R$ 1.500,00</span><span class="rpb-legenda">1 conta</span></div></div></div>
        <div class="rpb-escudo"><div class="rpb-escudo-in"><div class="rpb-escudo-cab">Estoque baixo</div><div class="rpb-escudo-corpo"><span class="rpb-legenda" style="display:flex;justify-content:space-between;font-weight:700;color:inherit">Capa de silicone <span>1 de 5</span></span><span class="rpb-nivel"><i></i></span></div></div></div></div>
    </div>
  </main>
</div>`;

/* ---------- relógio único para os efeitos de canvas dos fundos ---------- */
const comFx = new Set(); let rafFx = 0, ultimoFx = 0;
function tiqueFx(agora) {
  rafFx = 0; const dt = ultimoFx ? Math.min(0.05, (agora - ultimoFx) / 1000) : 0; ultimoFx = agora;
  let continuar = false;
  for (const h of comFx) if (h.fxAtivo()) { h.desenharFx(dt); continuar = true; }
  if (continuar && !document.hidden) rafFx = requestAnimationFrame(tiqueFx); else ultimoFx = 0;
}
export function agendarFx() { if (!rafFx) rafFx = requestAnimationFrame(tiqueFx); }
document.addEventListener('visibilitychange', agendarFx);

const IE = { 1: 0.5, 2: 1, 3: 1.6 };
const posRel = (el, anc) => { let x = 0, y = 0, n = el; while (n && n !== anc) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } return { x, y }; };

/**
 * Cria uma réplica dentro de `host`.
 * op: { tela: 'home' | 'business', largura (px de projeto), recorte: 'heroi' | 'tudo', miniatura, tocando, t }
 */
export function criarReplica(host, cfgIni = {}, op = {}) {
  const tela = op.tela ?? 'home';
  const cfg = { ...ORIGINAL, ...cfgIni };
  let largura = op.largura ?? 1280;
  const raiz = document.createElement('div'); raiz.className = tela === 'business' ? 'rpb' : 'rp';
  const esc = document.createElement('div'); esc.className = 'rp-escala'; esc.innerHTML = tela === 'business' ? htmlPainel() : htmlHome();
  raiz.append(esc); host.append(raiz);
  const heroi = esc.querySelector('.rp-heroi'); const palco = esc.querySelector('.rp-sino-palco'); const fx = esc.querySelector('.rp-fx'); const onda = esc.querySelector('.rp-onda');
  let k = 1, geo = null, vista = null, laco = null, destruido = false, visivel = false, foco = null, focoRepouso = null, ultimoImp = 0, ultimoInfo = null;
  const estadoFx = { ondas: [], faiscas: [], t: 0, ponteiro: null, imp: 0, rz: 0 };
  const botoes = [];

  function medir() {
    k = raiz.clientWidth / largura || 1;
    esc.style.width = `${largura}px`; esc.style.transform = `scale(${k})`;
    const h = op.recorte === 'heroi' && heroi ? heroi.offsetTop + heroi.offsetHeight : esc.offsetHeight;
    raiz.style.height = `${Math.ceil(h * k)}px`;
    if (heroi && palco) {
      const p = posRel(palco, heroi); geo = { x: p.x, y: p.y, w: palco.offsetWidth, h: palco.offsetHeight, hw: heroi.offsetWidth, hh: heroi.offsetHeight };
      const cx = p.x + geo.w * 0.42, cy = p.y + geo.h * 0.5; focoRepouso = focoRepouso ?? { x: cx, y: cy };
      aplicarFoco(true); vista?.redesenhar();
      if (fx) { const dpr = Math.min(window.devicePixelRatio || 1, 2); const s = Math.min(1.2, k * dpr); fx.width = Math.round(geo.hw * s); fx.height = Math.round(geo.hh * s); fx.__s = s; }
    }
  }
  function aplicarFoco(forcar = false) {
    if (!heroi || !geo) return;
    const br = geo.w * 0.27; const base = focoRepouso ?? { x: geo.x + geo.w / 2, y: geo.y + geo.h / 2 };
    heroi.style.setProperty('--bx', `${base.x}px`); heroi.style.setProperty('--by', `${base.y}px`); heroi.style.setProperty('--br', `${br}px`); heroi.style.setProperty('--bb', `${base.y + br * 1.02}px`);
    if (COM_FOCO_FIXO.has(cfg.a)) { heroi.style.setProperty('--fx', '82%'); heroi.style.setProperty('--fy', '40%'); }
    else if (cfg.a !== 'A02' || forcar || !foco) { const f = cfg.a === 'A02' && foco ? foco : base; heroi.style.setProperty('--fx', `${f.x}px`); heroi.style.setProperty('--fy', `${f.y}px`); }
    if (cfg.a === 'A04') { const pl = geo.hw * 0.5 + 18, pw = geo.hw * 0.5 - 36; heroi.style.setProperty('--pfx', `${((base.x - pl) / pw) * 100}%`); heroi.style.setProperty('--pfy', `${((base.y - 18) / (geo.hh - 36)) * 100}%`); }
  }

  function aoQuadro(d) {
    if (!geo || destruido) return;
    ultimoInfo = d.info;
    const cx = geo.x + d.sino.x * geo.w, cy = geo.y + d.sino.y * geo.h;
    if (!focoRepouso || recalibrar) { focoRepouso = { x: cx, y: cy }; recalibrar = false; aplicarFoco(true); }
    if (cfg.a === 'A02') { foco = foco ? { x: mix(foco.x, cx, 0.12), y: mix(foco.y, cy, 0.12) } : { x: cx, y: cy }; heroi.style.setProperty('--fx', `${foco.x}px`); heroi.style.setProperty('--fy', `${foco.y}px`); }
    const imp = d.impacto || 0; estadoFx.imp = imp; estadoFx.rz = d.rz || 0; estadoFx.cx = cx; estadoFx.cy = cy;
    heroi.style.setProperty('--imp', imp.toFixed(3)); heroi.style.setProperty('--rz', (d.rz || 0).toFixed(2));
    if (!estadoFx.ponteiro && cfg.e === 'E09') { heroi.style.setProperty('--lx', `${(cx / geo.hw) * 100}%`); heroi.style.setProperty('--ly', `${(cy / geo.hh) * 100}%`); }
    if (imp > 0.8 && ultimoImp <= 0.8) impacto();
    ultimoImp = imp;
  }
  let recalibrar = true;
  function impacto() {
    if (RUNTIME.reduzido) return;
    if (cfg.a === 'A08' && onda) { onda.classList.remove('rp-dispara'); void onda.offsetWidth; onda.classList.add('rp-dispara'); }
    if (cfg.e === 'E07') { raiz.classList.remove('rp-brilha'); void raiz.offsetWidth; raiz.classList.add('rp-brilha'); setTimeout(() => raiz.classList.remove('rp-brilha'), 950); }
    const n = { 1: 1, 2: 2, 3: 3 }[cfg.ie] ?? 2;
    if (cfg.e === 'E06') for (let i = 0; i < n; i++) estadoFx.ondas.push({ t: estadoFx.t + i * 0.14 });
    if (cfg.e === 'E08') for (let i = 0; i < 5 * n; i++) estadoFx.faiscas.push(novaFaisca(true));
    agendarFx();
  }

  /* ---------- efeitos de canvas (E03, E06, E08) ---------- */
  function novaFaisca(rajada) {
    const br = (geo?.w ?? 300) * 0.27; const a = Math.random() * Math.PI * 2; const r = br * (rajada ? 0.9 : 1.1 + Math.random() * 0.6);
    const v = rajada ? 120 + Math.random() * 160 : 0;
    return { x: (estadoFx.cx ?? 0) + Math.cos(a) * r, y: (estadoFx.cy ?? 0) + Math.sin(a) * r * 0.8, vx: Math.cos(a) * v, vy: rajada ? Math.sin(a) * v : -(22 + Math.random() * 28), vida: 0, dur: rajada ? 0.9 : 2.2 + Math.random(), tam: 4 + Math.random() * 6, giro: Math.random() * 6 };
  }
  const ctl = {
    fxAtivo: () => !destruido && visivel && !RUNTIME.pausado && !RUNTIME.reduzido && ['E03', 'E06', 'E08'].includes(cfg.e) && (vista ? vista.tocando : !op.miniatura),
    desenharFx(dt) {
      if (!geo || !fx.width) return;
      dt *= RUNTIME.velocidade; estadoFx.t += dt;
      const c = fx.getContext('2d'); const s = fx.__s || 1; c.setTransform(s, 0, 0, s, 0, 0); c.clearRect(0, 0, geo.hw, geo.hh);
      const iE = IE[cfg.ie] ?? 1; const cx = estadoFx.cx ?? geo.x + geo.w / 2, cy = estadoFx.cy ?? geo.y + geo.h / 2; const t = estadoFx.t;
      if (cfg.e === 'E03') {
        c.fillStyle = 'rgba(255,236,170,0.55)'; const passo = 12; const alcance = geo.hw * 0.55; const anelR = (1 - estadoFx.imp) * geo.hw * 0.6;
        for (let y = passo / 2; y < geo.hh; y += passo) for (let x = passo / 2; x < geo.hw; x += passo) {
          const d = Math.hypot(x - cx, y - cy); const queda = Math.exp(-d / alcance);
          let r = 0.6 + (0.6 + 0.8 * iE) * Math.max(0, Math.sin(d / 34 - t * 2.4)) * queda;
          if (estadoFx.imp > 0.02) r += 2.4 * estadoFx.imp * Math.exp(-(((d - anelR) / 34) ** 2));
          if (r < 0.7) continue; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
        }
      }
      if (cfg.e === 'E06') {
        const br = geo.w * 0.27; estadoFx.ondas = estadoFx.ondas.filter((o) => t - o.t < 1.3);
        for (const o of estadoFx.ondas) { const u = t - o.t; if (u < 0) continue; const r = br + u * 420 * Math.sqrt(iE); const a = 1 - u / 1.3;
          c.globalAlpha = a; c.lineWidth = 9; c.strokeStyle = '#16111f'; c.beginPath(); c.arc(cx, cy, r, 0, 6.283); c.stroke(); c.lineWidth = 4.5; c.strokeStyle = '#ffdf7e'; c.stroke(); }
        c.globalAlpha = 1;
      }
      if (cfg.e === 'E08') {
        if (Math.random() < dt * 1.6 * iE && estadoFx.faiscas.length < 14 * iE) estadoFx.faiscas.push(novaFaisca(false));
        estadoFx.faiscas = estadoFx.faiscas.filter((f) => f.vida < f.dur);
        for (const f of estadoFx.faiscas) {
          f.vida += dt; f.x += (f.vx + Math.sin(f.vida * 3 + f.giro) * 12) * dt; f.y += f.vy * dt; f.vx *= 0.97; if (f.dur < 1) f.vy *= 0.97;
          const k2 = f.vida / f.dur; const a = k2 < 0.15 ? k2 / 0.15 : 1 - k2; const r = f.tam * (0.6 + 0.4 * Math.sin(f.vida * 8));
          c.globalAlpha = a; c.save(); c.translate(f.x, f.y); c.rotate(f.giro + f.vida); c.beginPath();
          for (let i = 0; i < 8; i++) { const ang = (i * Math.PI) / 4; const rr = i % 2 ? r * 0.3 : r; c.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr); }
          c.closePath(); c.fillStyle = '#ffdf7e'; c.fill(); c.lineWidth = 1.6; c.strokeStyle = '#16111f'; c.stroke(); c.restore();
        }
        c.globalAlpha = 1;
      }
    },
  };
  comFx.add(ctl);

  /* ---------- sino 3D ---------- */
  function fonte(t, ctx) {
    const an = ANIMACOES[cfg.anim];
    if (!RUNTIME.laco && an && !an.livre) t = Math.min(t, an.dur); // sem laço: toca uma vez e para na pose final
    const r = laco.quadro(t, ctx);
    if (cfg.objeto && OBJETOS[cfg.objeto] && !r.pose.objetos.some((o) => o.id === cfg.objeto)) {
      const d = OBJETOS[cfg.objeto]; const e = d.ocioso(t % 24);
      const pos = [...(e.pos ?? d.pouso)]; pos[1] += (r.pose.impacto || 0) * 0.12;
      r.pose.objetos = [...r.pose.objetos, { id: cfg.objeto, ...e, pos }];
    }
    if (cfg.a === 'A10') { r.pose.camera.el -= 7; }
    return r;
  }
  function enquadramento() {
    const a = ANIMACOES[cfg.anim] ?? ANIMACOES.B00;
    if (cfg.objeto && a.enquadramento.meiaLargura < 2.5) return (OBJETOS[cfg.objeto]?.pouso[0] ?? 1) < 0 ? ENQ_ESQ : ENQ_LARGO;
    return a.enquadramento;
  }
  function montarLaco() {
    const a = ANIMACOES[cfg.anim] ?? ANIMACOES.B00;
    laco = criarLaco(a, RITMOS[cfg.ritmo] ?? RITMOS.C01, { personalizado: cfg.ritmoSeg });
  }
  montarLaco();
  if (palco) {
    obterMotor().then((motor) => {
      if (destruido) return;
      vista = motor.criarVista(palco, {
        fonte, enquadramento: enquadramento(), miniatura: op.miniatura, tocando: op.tocando ?? true, t: op.t ?? 0, aoQuadro, ponteiro: cfg.anim === 'B09',
        zoom: zoom(), aoTocar: (v) => { const a = ANIMACOES[cfg.anim]; if (a?.livre) return; if (!v.tocando || op.miniatura) return; v.irPara(laco.ciclo(v.t).ini + (a?.toque ?? 0)); },
      });
      palco.classList.add('com-3d'); palco.querySelector('.poster-3d')?.remove();
      op.aoPronto?.(vista);
    }).catch((e) => { palco.classList.add('sem-3d'); palco.title = '3D indisponível: ' + e.message; });
  }
  function zoom() { return (cfg.escala ?? 1) * (cfg.a === 'A10' ? 1.3 : 1); }

  /* ---------- botões (feedback F e loader G) ---------- */
  function ligarBotoes() {
    for (const b of botoes) b.destruir(); botoes.length = 0;
    if (op.miniatura || cfg.feedback === 'F00') return;
    const carga = esc.querySelector('.rp-carga');
    for (const btn of esc.querySelectorAll('.rp-perfil .rp-bt')) {
      let ld = null;
      botoes.push(ligarBotao(btn, {
        estilo: cfg.feedback, simulacao: SIMULACAO, rotulos: { processando: 'Abrindo…', sucesso: 'Pronto', erro: 'Tentar de novo' },
        aoEvento: (nome) => { if (/indicador de processamento/.test(nome) && carga && ['G01', 'G04'].includes(cfg.loader)) { ld = criarLoader(cfg.loader, carga); ld.iniciar(); } op.aoEvento?.(nome); },
        aoFim: (r) => { ld?.concluir(r === 'sucesso'); setTimeout(() => { if (carga) carga.innerHTML = ''; }, 700); },
      }));
    }
  }

  function aplicarAtributos() {
    raiz.dataset.a = cfg.a; raiz.dataset.e = cfg.e; raiz.dataset.dir = cfg.dir; raiz.dataset.pos = cfg.pos; raiz.dataset.botao = cfg.botao; raiz.dataset.ling = cfg.ling;
    raiz.style.setProperty('--ie', cfg.ie); raiz.style.setProperty('--iE', IE[cfg.ie] ?? 1); raiz.style.setProperty('--esc-sino', cfg.pos === 'centro' ? 0.7 : 1);
    if (cfg.a === 'A07') raiz.style.setProperty('--runas', runas());
    if (cfg.a === 'A09' && cfg.pos === 'direita') raiz.dataset.pos = 'centro';
    if (op.miniatura) raiz.dataset.parado = ''; else delete raiz.dataset.parado;
  }
  aplicarAtributos(); ligarBotoes();

  /* ---------- ponteiro e rolagem ---------- */
  const aoMover = (e) => {
    if (!geo) return; const r = heroi.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = ((e.clientY - r.top) / r.height) * 2 - 1;
    estadoFx.ponteiro = { x, y }; heroi.style.setProperty('--px', x.toFixed(3)); heroi.style.setProperty('--py', y.toFixed(3));
    heroi.style.setProperty('--lx', `${((x + 1) / 2) * 100}%`); heroi.style.setProperty('--ly', `${((y + 1) / 2) * 100}%`);
  };
  const aoSair = () => { estadoFx.ponteiro = null; heroi?.style.setProperty('--px', 0); heroi?.style.setProperty('--py', 0); };
  if (heroi && !op.miniatura) { heroi.addEventListener('pointermove', aoMover); heroi.addEventListener('pointerleave', aoSair); }
  const rolador = host.closest('.moldura--rolavel');
  const aoRolar = () => { if (heroi) raiz.style.setProperty('--rol', clamp(rolador.scrollTop / Math.max(1, heroi.offsetHeight * k)).toFixed(3)); };
  rolador?.addEventListener('scroll', aoRolar, { passive: true });

  const ro = new ResizeObserver(() => medir()); ro.observe(raiz); ro.observe(esc);
  const io = new IntersectionObserver((es) => { visivel = es.some((e) => e.isIntersecting); if (visivel) agendarFx(); }); io.observe(raiz);
  requestAnimationFrame(medir);

  return {
    raiz, cfg, get vista() { return vista; }, get info() { return ultimoInfo; }, get laco() { return laco; },
    /** Distância, em px do herói (largura de projeto), entre o centro dos raios e o centro do sino em repouso. */
    desvio() {
      if (!geo || !focoRepouso) return null;
      const f = COM_FOCO_FIXO.has(cfg.a) ? { x: geo.hw * 0.82, y: geo.hh * 0.4 } : (cfg.a === 'A02' && foco ? foco : focoRepouso);
      return { dx: f.x - focoRepouso.x, dy: f.y - focoRepouso.y, d: Math.hypot(f.x - focoRepouso.x, f.y - focoRepouso.y), hw: geo.hw };
    },
    definir(parcial = {}) {
      const antes = { ...cfg }; Object.assign(cfg, parcial);
      if (parcial.largura) { largura = parcial.largura; delete cfg.largura; }
      aplicarAtributos();
      const mudouAnim = antes.anim !== cfg.anim || antes.ritmo !== cfg.ritmo || antes.ritmoSeg !== cfg.ritmoSeg;
      if (mudouAnim) montarLaco();
      if (vista) {
        vista.atualizar({ enquadramento: enquadramento(), zoom: zoom() });
        if (mudouAnim || antes.objeto !== cfg.objeto || antes.a !== cfg.a) { vista.ctx.memoria = {}; if (!op.miniatura) vista.irPara(0); recalibrar = true; }
      }
      if (antes.feedback !== cfg.feedback) ligarBotoes();
      if (antes.a !== cfg.a || antes.pos !== cfg.pos || antes.escala !== cfg.escala) { recalibrar = true; foco = null; focoRepouso = null; }
      estadoFx.ondas = []; estadoFx.faiscas = [];
      requestAnimationFrame(medir); agendarFx();
    },
    tocar() { vista?.tocar(); delete raiz.dataset.parado; agendarFx(); },
    pausar() { vista?.pausar(); if (op.miniatura) raiz.dataset.parado = ''; },
    reiniciar() { vista?.irPara(0); estadoFx.ondas = []; estadoFx.faiscas = []; },
    larguraProjeto(l) { largura = l; requestAnimationFrame(medir); },
    destruir() { destruido = true; comFx.delete(ctl); ro.disconnect(); io.disconnect(); vista?.liberar(); for (const b of botoes) b.destruir(); rolador?.removeEventListener('scroll', aoRolar); raiz.remove(); },
  };
}
