// CK Admin: aprovar ou revisar com rapidez. Cada envio é uma linha com as diferenças e as decisões ao lado;
// o motivo só é pedido quando a decisão exige.
import { h, ic, esc, operar, aviso } from '../pecas.js';

const FILA = [
  { id: 1, nome: 'Doces da Vila', tipo: 'Alteração de vitrine', quando: 'há 2 h', dif: [['Descrição pública', 'Bolos caseiros desde 2010.', 'Bolos e doces caseiros desde 2010. Encomendas com 2 dias.'], ['Horário', 'Seg. a sex. 8h–18h', 'Seg. a sáb. 8h–18h']] },
  { id: 2, nome: 'Conserta Celular Centro', tipo: 'Publicação inicial', quando: 'há 5 h', dif: [['Categoria', '', 'Assistência técnica'], ['Área de atendimento', '', 'Centro e Bela Vista']] },
  { id: 3, nome: 'Pintores Fictícios', tipo: 'Nova análise após contestação', quando: 'ontem', dif: [['Nome do negócio', 'Pintores Ficticios', 'Pintores Fictícios']] },
];

export function montar() {
  const s = h(`<section class="lb-sec"><header class="lb-cab"><h1>CK Admin: <em>decidir rápido</em></h1><p>Cada envio mostra só o que mudou (antes → depois) e as três decisões ao lado. "Aprovar" é um clique; "Pedir correção" abre o motivo na própria linha; "Rejeitar" fica no menu, com confirmação.</p></header>
    <div class="lb-selos" style="margin-top:12px"><span class="lb-selo lb-selo--ok">Funciona com o banco atual</span></div>
    <div class="rf-tabela-caixa" style="margin-top:14px" data-fila></div></section>`);
  const caixa = s.querySelector('[data-fila]');
  const desenhar = () => {
    caixa.innerHTML = FILA.length ? FILA.map((f) => `<article class="rf-pessoa" style="grid-template-columns:minmax(0,1fr) auto;align-items:start" data-item="${f.id}">
      <div style="display:grid;gap:8px"><div><b>${esc(f.nome)}</b> <span class="rf-chip rf-chip--info">${f.tipo}</span> <span class="rf-fraco">${f.quando}</span></div>
        <dl style="display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0;font-size:.86rem">${f.dif.map(([c, a, d]) => `<dt class="rf-fraco">${c}</dt><dd style="margin:0">${a ? `<s class="rf-fraco">${esc(a)}</s> → ` : ''}<b>${esc(d)}</b></dd>`).join('')}</dl>
        <div data-motivo hidden style="display:grid;gap:6px"><div class="rf-campo"><label for="mot-${f.id}">O que precisa ser corrigido? <span class="rf-obr">(o gestor vai ler)</span></label><textarea id="mot-${f.id}" rows="2"></textarea></div><div><button type="button" class="rf-bt rf-bt--s" data-enviar-correcao>Enviar pedido de correção</button></div></div></div>
      <div class="rf-acoes"><button type="button" class="rf-bt rf-bt--p" data-aprovar>${ic('check')}Aprovar</button><button type="button" class="rf-bt rf-bt--s" data-corrigir>Pedir correção</button>
        <div class="rf-pop"><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-menu aria-haspopup="menu" aria-expanded="false" aria-label="Mais decisões">${ic('pontos')}</button><div class="rf-pop__lista" role="menu" hidden><button type="button" role="menuitem" class="rf-perigoso" data-rejeitar>${ic('x')}Rejeitar…</button></div></div></div></article>`).join('')
      : `<div class="rf-vazio">${ic('check', 'width="28" height="28"')}Fila vazia. Tudo decidido.</div>`;
  };
  desenhar();
  const tirar = (id) => { FILA.splice(FILA.findIndex((x) => x.id === id), 1); desenhar(); };
  caixa.addEventListener('click', async (e) => {
    const linha = e.target.closest('[data-item]'); if (!linha) return; const id = Number(linha.dataset.item); const nome = FILA.find((x) => x.id === id)?.nome;
    const m = e.target.closest('[data-menu]'); if (m) { const l = m.nextElementSibling; l.hidden = !l.hidden; m.setAttribute('aria-expanded', String(!l.hidden)); }
    const ap = e.target.closest('[data-aprovar]'); if (ap && await operar(ap, 'Aprovando…')) { tirar(id); aviso('ok', `${nome} aprovado`, 'A vitrine pública foi atualizada.'); }
    if (e.target.closest('[data-corrigir]')) { const bx = linha.querySelector('[data-motivo]'); bx.hidden = !bx.hidden; if (!bx.hidden) bx.querySelector('textarea').focus(); }
    const ec = e.target.closest('[data-enviar-correcao]');
    if (ec) { const t = linha.querySelector('textarea'); if (t.value.trim().length < 10) { t.setAttribute('aria-invalid', 'true'); aviso('erro', 'Explique com pelo menos 10 caracteres'); t.focus(); return; } if (await operar(ec, 'Enviando…')) { tirar(id); aviso('ok', 'Correção pedida', `${nome} recebe o motivo.`); } }
    if (e.target.closest('[data-rejeitar]')) aviso('erro', 'No app, rejeitar abre a confirmação com motivo obrigatório');
  });
  return s;
}
