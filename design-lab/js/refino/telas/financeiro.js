// Financeiro · Movimentações: o objetivo mais comum (lançar algo que entrou ou saiu) vira um botão grande.
// Os três formulários empilhados viram modais curtos; o livro-caixa ganha filtros compactos, carregamento
// com linhas fantasma e entrada em sequência curta.
import { ic, esc, secao, casca, abrirModal, operar, aviso, simular, SIM, ligarMenus } from '../pecas.js';

const CONTAS = ['Caixa da empresa', 'Banco do bairro', 'Conta digital'];
const CATS_SAIDA = ['Aluguel', 'Fornecedores', 'Frete', 'Salários', 'Energia e água', 'Impostos'];
const CATS_ENTRADA = ['Vendas no balcão', 'Serviços', 'Outras receitas'];
const mov = [
  { d: '24/11', conta: 'Caixa da empresa', o: 'Venda nº 118 · balcão', tipo: 'Receita', v: 8650, quem: 'Bruno Caixa' },
  { d: '24/11', conta: 'Banco do bairro', o: 'Fornecedores · Embalagens Sul', tipo: 'Despesa', v: -23400, quem: 'Pessoa Dona' },
  { d: '23/11', conta: 'Caixa da empresa → Banco do bairro', o: 'Transferência · depósito do caixa', tipo: 'Transferência', v: 50000, quem: 'Pessoa Dona' },
  { d: '22/11', conta: 'Caixa da empresa', o: 'Frete · entrega de farinha', tipo: 'Despesa', v: -1200, quem: 'Pessoa Dona' },
  { d: '21/11', conta: 'Conta digital', o: 'Serviço · bolo de aniversário', tipo: 'Receita', v: 18000, quem: 'Bruno Caixa' },
  { d: '20/11', conta: 'Caixa da empresa', o: 'Retirada do proprietário', tipo: 'Proprietário', v: -30000, quem: 'Pessoa Dona' },
];
const reais = (c) => `${c < 0 ? '− ' : ''}R$ ${(Math.abs(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const ABAS = [['visao', 'Visão geral', 'painel'], ['mov', 'Movimentações', 'transferir'], ['contas', 'A pagar e a receber', 'orcamentos'], ['fech', 'Fechamento do mês', 'check'], ['rel', 'Relatórios', 'estoque'], ['conf', 'Configurações', 'engrenagem']];

function tabela(lista) {
  if (!lista.length) return `<div class="rf-vazio">${ic('busca', 'width="28" height="28"')}Nada encontrado com estes filtros.<button type="button" class="rf-bt rf-bt--f" data-limpar>Limpar filtros</button></div>`;
  return `<div class="rf-tabela-caixa"><table class="rf-tabela"><caption class="visualmente-oculto">Livro-caixa</caption><thead><tr><th>Data</th><th>O que foi</th><th>Conta</th><th class="rf-num">Valor</th><th><span class="visualmente-oculto">Ações</span></th></tr></thead>
    <tbody class="rf-entra">${lista.map((m, i) => `<tr><td style="white-space:nowrap"><b>${m.d}</b></td><td><b>${esc(m.o)}</b><br><span class="rf-fraco">${m.tipo} · por ${esc(m.quem)}</span></td><td class="rf-suave">${esc(m.conta)}</td>
      <td class="rf-num ${m.tipo === 'Transferência' ? 'rf-suave' : m.v < 0 ? 'rf-saida' : 'rf-entrada'}">${m.tipo === 'Transferência' ? '⇄ ' : m.v > 0 ? '+ ' : ''}${reais(m.tipo === 'Transferência' ? Math.abs(m.v) : m.v)}</td>
      <td style="text-align:right"><div class="rf-pop"><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-menu aria-haspopup="menu" aria-expanded="false" aria-label="Ações para ${esc(m.o)}">${ic('pontos')}</button><div class="rf-pop__lista" role="menu" hidden><button type="button" role="menuitem">${ic('olho')}Ver detalhes</button><hr><button type="button" role="menuitem" class="rf-perigoso" data-estornar="${i}">${ic('atualizar')}Estornar</button></div></div></td></tr>`).join('')}</tbody></table></div>`;
}
const esqueleto = () => `<div class="rf-tabela-caixa" aria-busy="true" aria-label="Carregando o livro-caixa"><table class="rf-tabela"><thead><tr><th>Data</th><th>O que foi</th><th>Conta</th><th class="rf-num">Valor</th><th></th></tr></thead><tbody>${Array.from({ length: 5 }, () => '<tr><td><span class="rf-esq" style="width:42px"></span></td><td><span class="rf-esq" style="width:70%"></span><span class="rf-esq" style="width:40%;margin-top:6px;height:9px"></span></td><td><span class="rf-esq" style="width:80%"></span></td><td><span class="rf-esq" style="width:70px;margin-left:auto"></span></td><td></td></tr>').join('')}</tbody></table></div>`;

function abaMov() {
  const saldos = [['Caixa da empresa', 128450], ['Banco do bairro', 912300], ['Conta digital', 45000]];
  return `<div class="rf-acoes-grandes">
      <button type="button" class="rf-acao-g rf-acao-g--entrada" data-lancar="entrada"><i>${ic('entrada')}</i><b>Entrou dinheiro</b><span>Receita avulsa, sem conta a receber</span></button>
      <button type="button" class="rf-acao-g rf-acao-g--saida" data-lancar="saida"><i>${ic('saida')}</i><b>Saiu dinheiro</b><span>Despesa paga na hora</span></button>
      <button type="button" class="rf-acao-g rf-acao-g--transf" data-lancar="transf"><i>${ic('transferir')}</i><b>Transferir</b><span>Entre contas da empresa</span></button>
      <button type="button" class="rf-acao-g rf-acao-g--dono" data-lancar="dono"><i>${ic('dono')}</i><b>Dinheiro do dono</b><span>Retirada ou aporte</span></button></div>
    <div class="rf-kpis">${saldos.map(([c, v]) => `<div class="rf-kpi"><small>${c}</small><strong>${reais(v)}</strong><span>saldo agora</span></div>`).join('')}</div>
    <div class="rf-secao-t"><div><h3>Livro-caixa</h3><p>Tudo o que entrou e saiu, com quem registrou.</p></div><span data-status></span></div>
    <div class="rf-filtros" role="group" aria-label="Filtros">
      <div class="rf-abas" role="group" aria-label="Período">${['Este mês', 'Mês passado', 'Últimos 90 dias'].map((p, i) => `<button type="button" aria-pressed="${i === 0}" data-periodo="${p}">${p}</button>`).join('')}</div>
      <div class="rf-campo"><select aria-label="Conta" data-conta><option value="">Todas as contas</option>${CONTAS.map((c) => `<option>${c}</option>`).join('')}</select></div>
      <div class="rf-campo rf-busca">${ic('busca')}<input type="search" placeholder="Buscar na descrição" aria-label="Buscar na descrição" data-busca></div>
      <button type="button" class="rf-mais" aria-expanded="false" data-mais-filtros>Mais filtros ${ic('baixo')}</button></div>
    <div class="rf-filtros" data-filtros-extra hidden><div class="rf-campo"><label for="f-de">De</label><input id="f-de" type="date"></div><div class="rf-campo"><label for="f-ate">Até</label><input id="f-ate" type="date"></div>
      <div class="rf-campo"><label for="f-nat">Natureza</label><select id="f-nat"><option>Todas</option><option>Receita</option><option>Despesa</option><option>Transferência</option><option>Proprietário</option></select></div></div>
    <div data-livro>${tabela(mov)}</div>`;
}
function abaVisao() {
  return `<div class="rf-kpis">${[['Entrou no mês', 'R$ 18.640,00', '+12% que outubro'], ['Saiu no mês', 'R$ 9.315,40', 'inclui fornecedores'], ['A receber (7 dias)', 'R$ 2.180,00', '3 parcelas'], ['A pagar (7 dias)', 'R$ 1.450,00', '2 contas']].map(([a, b, c]) => `<div class="rf-kpi"><small>${a}</small><strong>${b}</strong><span>${c}</span></div>`).join('')}</div>
    <div class="rf-cartao rf-cartao--p"><b>Próximos passos</b><p class="rf-fraco" style="margin:4px 0 0">2 contas vencem esta semana. O mês de outubro está aberto há 24 dias: feche quando conferir o caixa.</p></div>`;
}

function lancar(tipo, aoSalvar) {
  const T = { entrada: ['Entrou dinheiro', 'Registre uma receita recebida agora.', 'Registrar entrada', CATS_ENTRADA], saida: ['Saiu dinheiro', 'Registre uma despesa já paga.', 'Registrar saída', CATS_SAIDA],
    transf: ['Transferir entre contas', 'Não é receita nem despesa: só muda o dinheiro de lugar.', 'Transferir', null], dono: ['Dinheiro do dono', 'Fica separado do resultado da empresa.', 'Registrar', null] }[tipo];
  const d = abrirModal(`<form class="rf-modal__painel" novalidate><div class="rf-modal__cab"><div><h3>${T[0]}</h3><p>${T[1]}</p></div><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-fechar aria-label="Fechar">${ic('x')}</button></div>
    <div class="rf-modal__corpo">
      ${tipo === 'dono' ? `<div class="rf-escolha" role="radiogroup" aria-label="O que aconteceu"><label><input type="radio" name="dir" value="retirada" checked><b>Retirei da empresa</b><span>Pró-labore ou retirada pessoal.</span></label><label><input type="radio" name="dir" value="aporte"><b>Coloquei na empresa</b><span>Dinheiro seu para o caixa.</span></label></div>` : ''}
      <div class="rf-campo"><label for="lc-valor">Valor</label><div class="rf-valor"><span>R$</span><input id="lc-valor" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-describedby="lc-valor-e"></div><span class="rf-erro-campo" id="lc-valor-e"></span></div>
      ${T[3] ? `<div class="rf-campo"><span class="rf-rot" id="lc-cat-r">Categoria</span><div class="rf-opcoes-chips" role="radiogroup" aria-labelledby="lc-cat-r">${T[3].map((c, i) => `<button type="button" role="radio" aria-checked="${i === 0}" aria-pressed="${i === 0}" data-cat>${c}</button>`).join('')}<button type="button" aria-pressed="false" data-outra>+ Outra</button></div></div>` : ''}
      ${tipo === 'transf' ? `<div class="rf-grade-campos" style="align-items:end"><div class="rf-campo"><label for="lc-de">Sai de</label><select id="lc-de">${CONTAS.map((c) => `<option>${c}</option>`).join('')}</select></div>
        <div class="rf-campo"><label for="lc-para">Entra em</label><select id="lc-para">${CONTAS.map((c, i) => `<option ${i === 1 ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>` : `<div class="rf-campo"><label for="lc-desc">Descrição</label><input id="lc-desc" placeholder="${tipo === 'saida' ? 'Ex.: conta de luz de novembro' : 'Ex.: encomenda paga no Pix'}"><span class="rf-ajuda">Ajuda a achar depois.</span></div>`}
      <button type="button" class="rf-mais" aria-expanded="false" data-mais>Conta e data ${ic('baixo')}</button>
      <div class="rf-grade-campos" data-mais-campos hidden>${tipo === 'transf' ? '' : `<div class="rf-campo"><label for="lc-conta">Conta</label><select id="lc-conta">${CONTAS.map((c) => `<option>${c}</option>`).join('')}</select></div>`}
        <div class="rf-campo"><label for="lc-data">Data</label><input id="lc-data" type="date" value="2026-11-24"><span class="rf-ajuda">Hoje ou antes, num mês ainda aberto.</span></div></div>
      <p class="rf-fraco" style="margin:0" data-resumo>Padrão: ${tipo === 'transf' ? 'hoje' : 'Caixa da empresa, hoje'}.</p>
    </div>
    <div class="rf-modal__pe"><button type="button" class="rf-bt rf-bt--f" data-fechar>Cancelar</button><button type="submit" class="rf-bt rf-bt--p">${ic('check')}${T[2]}</button></div></form>`,
  { classe: 'rf-modal rf-modal--estreito', aoAbrir: (x) => x.querySelector('#lc-valor').focus() });
  d.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]'); if (c) for (const b of c.parentElement.querySelectorAll('[data-cat]')) { b.setAttribute('aria-pressed', String(b === c)); b.setAttribute('aria-checked', String(b === c)); }
    const m = e.target.closest('[data-mais]'); if (m) { const ab = m.getAttribute('aria-expanded') !== 'true'; m.setAttribute('aria-expanded', String(ab)); d.querySelector('[data-mais-campos]').hidden = !ab; d.querySelector('[data-resumo]').hidden = ab; }
  });
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault(); const vi = d.querySelector('#lc-valor'); const v = Number(vi.value.replace(/\./g, '').replace(',', '.'));
    if (!v || v <= 0) { vi.closest('.rf-valor').style.borderColor = 'var(--rf-erro)'; d.querySelector('#lc-valor-e').textContent = 'Digite um valor maior que zero.'; vi.focus(); return; }
    if (tipo === 'transf' && d.querySelector('#lc-de').value === d.querySelector('#lc-para').value) { aviso('erro', 'Escolha contas diferentes'); return; }
    if (!(await operar(e.submitter, 'Registrando…'))) return;
    const cat = d.querySelector('[data-cat][aria-pressed="true"]')?.textContent; const desc = d.querySelector('#lc-desc')?.value.trim();
    const sinal = tipo === 'saida' || (tipo === 'dono' && new FormData(e.target).get('dir') === 'retirada') ? -1 : 1;
    mov.unshift({ d: '24/11', conta: tipo === 'transf' ? `${d.querySelector('#lc-de').value} → ${d.querySelector('#lc-para').value}` : (d.querySelector('#lc-conta')?.value ?? CONTAS[0]),
      o: tipo === 'transf' ? 'Transferência' : `${cat ?? (sinal < 0 ? 'Retirada do proprietário' : 'Aporte do proprietário')}${desc ? ` · ${desc}` : ''}`, tipo: { entrada: 'Receita', saida: 'Despesa', transf: 'Transferência', dono: 'Proprietário' }[tipo], v: Math.round(v * 100) * sinal, quem: 'Pessoa Dona' });
    d.close(); aoSalvar(); aviso('ok', { entrada: 'Entrada registrada', saida: 'Saída registrada', transf: 'Transferência registrada', dono: sinal < 0 ? 'Retirada registrada' : 'Aporte registrado' }[tipo], reais(Math.round(v * 100)));
  });
}

function pagina(palco, aba = 'mov') {
  const app = casca({ atual: 'financeiro', trilha: ['Business', 'Gestão', 'Financeiro'], titulo: 'Financeiro', subtitulo: 'Valores registrados à mão. Nenhum dinheiro é movimentado pelo AutoniCK.',
    acoes: `<button type="button" class="rf-bt rf-bt--s" data-lancar="saida">${ic('saida')}Saída</button><button type="button" class="rf-bt rf-bt--p" data-lancar="entrada">${ic('entrada')}Entrada</button>` });
  const corpo = app.querySelector('[data-corpo]');
  corpo.innerHTML = `<nav class="rf-rolagem-x" aria-label="Seções do financeiro"><div class="rf-abas">${ABAS.map(([id, n, i]) => `<a href="#" data-aba="${id}" ${id === aba ? 'aria-current="page"' : ''}>${ic(i)}${n}</a>`).join('')}</div></nav>
    <div style="display:grid;gap:14px" data-conteudo>${aba === 'mov' ? abaMov() : aba === 'visao' ? abaVisao() : `<div class="rf-vazio">Esta aba segue o mesmo padrão; o lab detalha Movimentações e Visão geral.</div>`}</div>`;
  palco.replaceChildren(app); ligarMenus(app);
  const filtros = { busca: '', conta: '' };
  const recarregar = async () => {
    const livro = corpo.querySelector('[data-livro]'); const st = corpo.querySelector('[data-status]'); if (!livro) return;
    const t = setTimeout(() => { livro.innerHTML = esqueleto(); st.innerHTML = `<span class="rf-atualizando">${ic('atualizar')}Atualizando</span>`; }, SIM.limiar);
    try { await simular(Math.min(SIM.latencia, 1400)); } catch { /* lab: a lista local continua valendo */ }
    clearTimeout(t); st.innerHTML = '';
    livro.innerHTML = tabela(mov.filter((m) => (!filtros.conta || m.conta.includes(filtros.conta)) && (!filtros.busca || m.o.toLowerCase().includes(filtros.busca))));
  };
  let tBusca = 0;
  app.addEventListener('click', (e) => {
    const a = e.target.closest('[data-aba]'); if (a) { e.preventDefault(); pagina(palco, a.dataset.aba); return; }
    const l = e.target.closest('[data-lancar]'); if (l) lancar(l.dataset.lancar, () => recarregar());
    const p = e.target.closest('[data-periodo]'); if (p) { for (const b of p.parentElement.children) b.setAttribute('aria-pressed', String(b === p)); recarregar(); }
    const mf = e.target.closest('[data-mais-filtros]'); if (mf) { const ab = mf.getAttribute('aria-expanded') !== 'true'; mf.setAttribute('aria-expanded', String(ab)); corpo.querySelector('[data-filtros-extra]').hidden = !ab; }
    if (e.target.closest('[data-limpar]')) { filtros.busca = ''; filtros.conta = ''; corpo.querySelector('[data-busca]').value = ''; corpo.querySelector('[data-conta]').value = ''; recarregar(); }
    const es = e.target.closest('[data-estornar]'); if (es) { const m = mov[Number(es.dataset.estornar)]; abrirModal(`<form class="rf-modal__painel"><div class="rf-modal__cab"><div><h3>Estornar lançamento?</h3><p>${esc(m.o)} · ${reais(m.v)}. O original fica no histórico e um lançamento contrário é criado.</p></div></div><div class="rf-modal__pe"><button type="button" class="rf-bt rf-bt--f" data-fechar>Voltar</button><button type="submit" class="rf-bt rf-bt--perigo">Estornar</button></div></form>`, { classe: 'rf-modal rf-modal--estreito' })
      .querySelector('form').addEventListener('submit', async (ev) => { ev.preventDefault(); if (await operar(ev.submitter, 'Estornando…')) { ev.target.closest('dialog').close(); mov.unshift({ ...m, o: `Estorno · ${m.o}`, v: -m.v }); recarregar(); aviso('ok', 'Estorno registrado'); } }); }
  });
  app.addEventListener('input', (e) => { if (e.target.matches('[data-busca]')) { clearTimeout(tBusca); tBusca = setTimeout(() => { filtros.busca = e.target.value.trim().toLowerCase(); recarregar(); }, 250); } });
  app.addEventListener('change', (e) => { if (e.target.matches('[data-conta]')) { filtros.conta = e.target.value; recarregar(); } });
}

export function montar() {
  const s = secao({ titulo: 'Financeiro', destaque: 'mais leve', texto: 'Quem abre Movimentações quase sempre quer lançar algo que entrou ou saiu. Esse vira o primeiro clique; o resto sai do caminho.',
    antes: 'img/antes/financeiro.webp',
    objetivos: [['Lançar uma saída', '"Saiu dinheiro" → valor → categoria → pronto. Conta e data já vêm preenchidas.'], ['Achar um lançamento', 'Período em abas, conta e busca na mesma linha; datas e natureza em "Mais filtros".'], ['Ver os saldos', 'Saldo de cada conta logo abaixo das ações.']],
    selos: [['Funciona com o banco atual', 'ok']],
    notas: ['As abas do financeiro deixam de ser links sublinhados: viram abas de verdade, com ícone e item ativo legível (antes o texto ficava branco sobre amarelo).', 'Os três formulários empilhados (avulso, transferência, dono) viram 4 botões grandes que abrem modais curtos.', 'Valor em destaque, categorias em chips e "Conta e data" recolhidos com o padrão já escolhido.', 'Filtrar mostra linhas fantasma e o selo "Atualizando"; as linhas entram em sequência curta.', 'Estorno vai para o menu ⋯ da linha, com confirmação explicando o que acontece.'] });
  pagina(s.querySelector('[data-palco]')); return s;
}
