// Marca: convivência entre a logo completa, um símbolo simplificado em SVG e a marca escrita.
import { h, SIMBOLO } from '../pecas.js';

export function montar() {
  const usos = [
    ['Topo do sistema', 'Símbolo + "AutoniCK" escrito. Leve, nítido em qualquer tela.', `<div style="display:flex;gap:9px;align-items:center;padding:10px 14px;border-radius:10px;background:var(--rf-trilho);color:#ece3d4"><span style="width:30px;height:30px">${SIMBOLO}</span><b style="font:800 italic 1.2rem/1 var(--rf-titulo);text-transform:uppercase">Autoni<span style="color:#ffd567">CK</span></b></div>`],
    ['Favicon e ícone do app', 'O símbolo é legível a 16 px; a logo completa vira uma mancha.', `<div class="rf-favicons"><div><span style="width:16px;height:16px">${SIMBOLO}</span>16</div><div><span style="width:32px;height:32px">${SIMBOLO}</span>32</div><div><span style="width:48px;height:48px;border-radius:12px;background:#120c1b;padding:6px">${SIMBOLO}</span>Ícone</div><div><img src="../public/assets/icons/favicon-32.png" alt="" width="32" height="32">Hoje</div></div>`],
    ['Carregamento', 'O símbolo balança enquanto algo carrega de verdade.', `<span class="rf-simbolo rf-simbolo--balanca" style="display:block">${SIMBOLO}</span>`],
    ['Estado vazio', 'Símbolo grande e apagado, com o texto explicando o que fazer.', `<div style="display:grid;gap:6px;justify-items:center;color:var(--rf-fraco);font-size:.82rem"><span style="width:56px;height:56px;opacity:.45;filter:grayscale(.6)">${SIMBOLO}</span>Nenhuma venda hoje ainda</div>`],
    ['Menu recolhido', 'Só o símbolo, no trilho de 64 px.', `<div style="width:64px;padding:10px 0;border-radius:10px;background:var(--rf-trilho);display:grid;justify-items:center;gap:10px"><span style="width:32px;height:32px">${SIMBOLO}</span><span style="width:22px;height:3px;border-radius:2px;background:#f5b70a"></span></div>`],
    ['Logo completa', 'Continua na home, no splash, nos PDFs e nos e-mails: onde há espaço para ela brilhar.', `<img src="../public/assets/brand/autonick-geral-320.webp" alt="Logo completa do AutoniCK" width="110" height="107">`],
  ];
  return h(`<section class="lb-sec"><header class="lb-cab"><h1>Marca em <em>camadas</em></h1><p>A logo completa continua sendo a assinatura. Para tamanhos pequenos e usos repetidos (topo, ícones, loaders, estados vazios) o app passa a usar um símbolo simplificado em SVG. O símbolo daqui é <b>provisório</b>, só para ocupar o lugar certo: o definitivo pode vir de outro trabalho e entra trocando um único arquivo.</p></header>
    <div class="rf-marcas" style="margin-top:18px">${usos.map(([t, d, demo]) => `<article class="rf-marca-uso"><div class="rf-marca-uso__palco">${demo}</div><b>${t}</b><p>${d}</p></article>`).join('')}</div>
    <ul class="lb-notas" style="margin-top:16px"><li>Preparação: o símbolo fica num arquivo só (<code>assets/brand/simbolo.svg</code> no app) e todos os usos leem dele. Trocar o desenho não exige mexer nas telas.</li><li>A escrita "AutoniCK" é texto com a fonte da marca, não imagem: fica nítida, acessível e muda de cor com o tema.</li><li>Regra de uso: abaixo de 64 px, símbolo; acima de 120 px com espaço livre, logo completa.</li></ul></section>`);
}
