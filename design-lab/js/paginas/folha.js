// Folha de componentes reais do AutoniCK, com comportamento, para as linguagens de microinteração (H).
import { h } from '../ui.js';

let n = 0;
export function folhaComponentes(ling = 'H01', { compacta = false } = {}) {
  const k = `hc${++n}`;
  const blocos = [
    ['Botões', `<div class="hc-linha"><button type="button" class="bt-ck">Nova venda</button><button type="button" class="bt-ck bt-ck--sec">Orçamentos</button><button type="button" class="bt-ck bt-ck--perigo">Excluir</button><button type="button" class="bt-ck" disabled aria-disabled="true">Sem permissão</button></div>`],
    ['Cartão (ficha)', `<a class="hc-card" href="#${k}-c" onclick="return false"><b>2</b><span style="font-weight:700">Ordens de serviço em andamento</span><span style="font-size:.85rem;color:#4b4158">Nenhuma atrasada</span><span class="hc-link" style="font-size:.9rem">Ver OS →</span></a>`],
    ['Campos e validação', `<div class="hc-campo" data-campo><label for="${k}-e">E-mail do cliente</label><input id="${k}-e" type="email" placeholder="nome@exemplo.com" aria-describedby="${k}-em"><small id="${k}-em">Saia do campo para validar.</small></div>
      <div class="hc-campo"><label for="${k}-s">Forma de pagamento</label><select id="${k}-s"><option>Pix</option><option>Dinheiro</option><option>Cartão</option></select></div>`],
    ['Seleção', `<label class="hc-check"><input type="checkbox" checked> Enviar comprovante</label><label class="hc-check"><input type="checkbox"> Separar no estoque</label><div class="hc-linha"><label class="hc-check"><input type="radio" name="${k}-r" checked> Retirada</label><label class="hc-check"><input type="radio" name="${k}-r"> Entrega</label></div>`],
    ['Abas', `<div class="hc-abas"><div role="tablist" aria-label="Detalhes da OS"><button type="button" role="tab" aria-selected="true" aria-controls="${k}-p1" id="${k}-t1">Resumo</button><button type="button" role="tab" aria-selected="false" aria-controls="${k}-p2" id="${k}-t2" tabindex="-1">Materiais</button><button type="button" role="tab" aria-selected="false" aria-controls="${k}-p3" id="${k}-t3" tabindex="-1">Histórico</button></div>
      <div role="tabpanel" id="${k}-p1" aria-labelledby="${k}-t1">Troca de tela · Iniciada às 14:10.</div><div role="tabpanel" id="${k}-p2" aria-labelledby="${k}-t2" hidden>Tela 6.1" · 1 unidade reservada.</div><div role="tabpanel" id="${k}-p3" aria-labelledby="${k}-t3" hidden>Criada · Aceita pelo cliente · Iniciada.</div></div>`],
    ['Menu', `<ul class="hc-menu"><li><a href="#${k}-m" aria-current="page" onclick="return false">Painel</a></li><li><a href="#${k}-m" onclick="return false">Vendas</a></li><li><a href="#${k}-m" onclick="return false">Estoque</a></li></ul><p><a class="hc-link" href="#${k}-l" onclick="return false">Link de texto: ver histórico completo</a></p>`],
    ['Notificação e modal', `<div class="hc-linha"><button type="button" class="bt-ck bt-ck--sec" data-toast>Mostrar notificação</button><button type="button" class="bt-ck bt-ck--sec" data-modal>Abrir modal</button></div><div class="hc-toast-area"><p class="hc-toast" role="status" hidden>✓ Pedido aceito. O cliente foi avisado.</p></div>
      <dialog class="hc-modal" aria-labelledby="${k}-mt"><h3 id="${k}-mt">Cancelar a venda?</h3><p>A venda volta para o estoque e o cliente é avisado.</p><div class="hc-linha"><button type="button" class="bt-ck bt-ck--perigo" data-fechar>Cancelar venda</button><button type="button" class="bt-ck bt-ck--sec" data-fechar>Voltar</button></div></dialog>`],
    ['Dica (tooltip) e estados', `<div class="hc-linha"><span class="hc-dica-alvo"><button type="button" class="bt-ck bt-ck--sec" aria-describedby="${k}-d">Reservado: 3</button><span class="hc-dica" role="tooltip" id="${k}-d">Separado para pedidos ainda não entregues</span></span></div>
      <div class="hc-linha"><span class="hc-chip hc-chip--ok">✓ Concluída</span><span class="hc-chip hc-chip--info">• Aguardando início</span><span class="hc-chip hc-chip--alerta">! Estoque baixo</span><span class="hc-chip hc-chip--erro">✕ Recusada</span></div>`],
    ['Tabela', `<table class="hc-tabela"><thead><tr><th data-ord>Produto ↕</th><th>Disponível</th></tr></thead><tbody><tr><td>Capa de silicone</td><td>1</td></tr><tr><td>Película 3D</td><td>12</td></tr><tr><td>Cabo USB-C</td><td>7</td></tr></tbody></table><button type="button" class="bt-ck bt-ck--sec" data-atualiza style="justify-self:start">Simular baixa de estoque</button>`],
    ['Progresso e confirmação', `<div class="hc-progresso" role="progressbar" aria-label="Etapas da OS" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100"><i style="--v:40%"></i></div><button type="button" class="bt-ck bt-ck--sec" data-avanca style="justify-self:start">Avançar etapa</button>
      <div class="hc-confirma" hidden><b>Excluir "Capa de silicone"?</b><span>O histórico de vendas continua guardado.</span><div class="hc-linha"><button type="button" class="bt-ck bt-ck--perigo" data-nao>Excluir</button><button type="button" class="bt-ck bt-ck--sec" data-nao>Manter</button></div></div><button type="button" class="bt-ck bt-ck--perigo" data-pede style="justify-self:start">Excluir produto</button>`],
    ['Erro e estado vazio', `<p class="hc-erro-msg" role="alert"><b>!</b><span>Não deu para salvar: o valor precisa ser maior que zero.</span></p><div class="hc-vazio"><b>Nenhum orçamento</b><span>Quando um cliente pedir um orçamento, ele aparece aqui.</span></div>`],
    ['Expandir e recolher', `<details class="hc-acordeao"><summary>Dados da empresa</summary><div class="hc-acordeao-corpo">[TESTE] Conserta Celular · Campinas (SP)</div></details><details class="hc-acordeao" open><summary>Horário de atendimento</summary><div class="hc-acordeao-corpo">Seg. a sex., 9h às 18h.</div></details>`],
  ];
  const lista = compacta ? blocos.filter(([t]) => ['Botões', 'Campos e validação', 'Seleção', 'Dica (tooltip) e estados', 'Notificação e modal'].includes(t)) : blocos;
  const el = h(`<div class="hc papel-ck" data-ling="${ling}">${lista.map(([t, c]) => `<section class="hc-bloco"><h4>${t}</h4>${c}</section>`).join('')}</div>`);
  // comportamento
  el.querySelectorAll('[data-campo] input').forEach((i) => i.addEventListener('blur', () => {
    const c = i.closest('[data-campo]'); const m = c.querySelector('small'); const v = i.value.trim();
    if (!v) { c.dataset.v = ''; m.textContent = 'Saia do campo para validar.'; } else if (/^\S+@\S+\.\S+$/.test(v)) { c.dataset.v = 'ok'; m.textContent = '✓ E-mail válido.'; } else { c.dataset.v = 'erro'; m.textContent = 'Falta o @ ou o domínio (ex.: nome@exemplo.com).'; i.setAttribute('aria-invalid', 'true'); return; }
    i.removeAttribute('aria-invalid');
  }));
  el.querySelectorAll('[role="tablist"]').forEach((tl) => {
    const tabs = [...tl.querySelectorAll('[role="tab"]')];
    const ativar = (t) => { tabs.forEach((x) => { const sim = x === t; x.setAttribute('aria-selected', String(sim)); x.tabIndex = sim ? 0 : -1; el.querySelector(`#${x.getAttribute('aria-controls')}`).hidden = !sim; }); t.focus(); };
    tl.addEventListener('click', (e) => { const t = e.target.closest('[role="tab"]'); if (t) ativar(t); });
    tl.addEventListener('keydown', (e) => { const i = tabs.indexOf(document.activeElement); if (e.key === 'ArrowRight') ativar(tabs[(i + 1) % tabs.length]); if (e.key === 'ArrowLeft') ativar(tabs[(i - 1 + tabs.length) % tabs.length]); });
  });
  let tt = 0; el.querySelectorAll('[data-toast]').forEach((b) => b.addEventListener('click', () => { const t = el.querySelector('.hc-toast'); t.hidden = true; void t.offsetWidth; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 3200); }));
  el.querySelectorAll('[data-modal]').forEach((b) => b.addEventListener('click', () => { const d = el.querySelector('dialog'); try { d.showModal(); } catch { d.setAttribute('open', ''); } }));
  el.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => el.querySelector('dialog').close()));
  el.querySelectorAll('[data-ord]').forEach((th) => th.addEventListener('click', () => { const tb = th.closest('table').tBodies[0]; const rows = [...tb.rows].reverse(); tb.append(...rows); }));
  el.querySelectorAll('[data-atualiza]').forEach((b) => b.addEventListener('click', () => { const r = el.querySelector('.hc-tabela tbody tr:nth-child(2)'); const c = r.cells[1]; c.textContent = Math.max(0, Number(c.textContent) - 1); r.classList.remove('hc-atualizada'); void r.offsetWidth; r.classList.add('hc-atualizada'); }));
  el.querySelectorAll('[data-avanca]').forEach((b) => b.addEventListener('click', () => { const p = el.querySelector('.hc-progresso'); const v = (Number(p.getAttribute('aria-valuenow')) + 20) % 120; p.setAttribute('aria-valuenow', v); p.querySelector('i').style.setProperty('--v', `${v}%`); }));
  el.querySelectorAll('[data-pede]').forEach((b) => b.addEventListener('click', () => { el.querySelector('.hc-confirma').hidden = false; b.hidden = true; }));
  el.querySelectorAll('[data-nao]').forEach((b) => b.addEventListener('click', () => { el.querySelector('.hc-confirma').hidden = true; el.querySelector('[data-pede]').hidden = false; }));
  return el;
}
