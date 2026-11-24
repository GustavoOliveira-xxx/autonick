// Equipe: uma lista simples de pessoas com perfil, situação e ações rápidas. Convidar, trocar perfil e
// encerrar acesso viram modais curtos. As 48 caixas de permissão saem da página e viram níveis por área
// (Sem acesso · Consultar · Operar), com "Personalizar" para quem precisa do detalhe.
import { h, ic, esc, secao, casca, abrirModal, operar, aviso, ligarMenus } from '../pecas.js';

const PERFIS = [
  { id: 'gerente', nome: 'Gerente', desc: 'Administra o dia a dia e a equipe. Não fecha períodos financeiros.' },
  { id: 'vendas', nome: 'Vendas e atendimento', desc: 'Atende clientes, aceita pedidos, registra vendas e prepara orçamentos.' },
  { id: 'estoque', nome: 'Estoque', desc: 'Cadastra produtos e fornecedores e cuida das movimentações de estoque.' },
  { id: 'financeiro', nome: 'Financeiro', desc: 'Lança e registra pagamentos e recebimentos. Não fecha períodos.' },
  { id: 'consulta', nome: 'Somente consulta', desc: 'Vê tudo o que é do dia a dia, sem alterar nada.' },
];
const pessoas = [
  { id: 1, nome: 'Pessoa Dona', email: 'pessoa@teste.example', perfil: 'Proprietária', estado: 'voce' },
  { id: 2, nome: 'Eva Estoque', email: 'eva@teste.example', perfil: 'estoque', estado: 'ativo' },
  { id: 3, nome: 'Bruno Caixa', email: 'bruno@teste.example', perfil: 'vendas', estado: 'ativo' },
  { id: 4, nome: 'lia@teste.example', email: 'Convite enviado em 20/11 · vence em 6 dias', perfil: 'financeiro', estado: 'convite' },
];
const nomePerfil = (id) => PERFIS.find((p) => p.id === id)?.nome ?? id;
const AREAS = [
  ['Vendas', ['Ver vendas', 'Registrar venda', 'Aprovar venda', 'Cancelar venda', 'Dar desconto', 'Registrar recebimento', 'Exportar vendas (sensível)']],
  ['Pedidos', ['Ver pedidos', 'Aceitar pedido', 'Cancelar pedido', 'Exportar pedidos (sensível)']],
  ['Clientes', ['Ver clientes', 'Cadastrar cliente', 'Alterar cliente', 'Exportar clientes (sensível)']],
  ['Produtos', ['Ver produtos', 'Cadastrar produto', 'Alterar produto', 'Alterar preço', 'Ver custo', 'Exportar produtos (sensível)']],
  ['Estoque', ['Ver estoque', 'Propor movimentação', 'Aprovar movimentação', 'Exportar estoque (sensível)']],
  ['Orçamentos e serviços', ['Ver orçamentos', 'Criar orçamento', 'Aprovar orçamento', 'Cancelar orçamento', 'Ver ordens de serviço', 'Alterar ordens de serviço']],
  ['Agenda', ['Ver agenda', 'Alterar horários']],
  ['Financeiro', ['Ver financeiro', 'Lançar', 'Aprovar', 'Cancelar', 'Fechar o mês', 'Exportar financeiro (sensível)']],
  ['Equipe', ['Ver equipe', 'Convidar', 'Alterar perfis', 'Encerrar acessos']],
  ['Empresa e vitrine', ['Ver dados da empresa', 'Alterar dados da empresa', 'Ver vitrine', 'Alterar vitrine']],
  ['Relatórios', ['Ver relatórios', 'Exportar relatórios (sensível)']],
];
const NIVEIS_PADRAO = { gerente: 2, vendas: { Vendas: 2, Pedidos: 2, Clientes: 2, Produtos: 1, Estoque: 1, 'Orçamentos e serviços': 2, Agenda: 1 },
  estoque: { Produtos: 2, Estoque: 2, Pedidos: 1 }, financeiro: { Financeiro: 2, Vendas: 1, Clientes: 1, Relatórios: 2 }, consulta: 1 };
const nivelDe = (perfil, area) => { const n = NIVEIS_PADRAO[perfil]; return typeof n === 'number' ? (area === 'Equipe' && perfil !== 'gerente' ? 0 : n) : (n?.[area] ?? 0); };
const ROT_NIVEL = ['Sem acesso', 'Consultar', 'Operar'];

function linha(p) {
  const voce = p.estado === 'voce'; const convite = p.estado === 'convite';
  const ini = convite ? '✉' : p.nome.split(' ').map((x) => x[0]).slice(0, 2).join('');
  return `<div class="rf-pessoa" role="row" data-pessoa="${p.id}">
    <span class="rf-avatar" style="${convite ? 'background:var(--rf-sup3);color:var(--rf-ouro-txt)' : ''}" aria-hidden="true">${ini}</span>
    <div role="cell"><b>${esc(p.nome)}${voce ? ' <span class="rf-fraco">(você)</span>' : ''}</b><small>${esc(p.email)}</small></div>
    <div role="cell" class="rf-pessoa__selos"><span class="rf-chip rf-chip--ouro rf-chip--sem">${esc(voce ? p.perfil : nomePerfil(p.perfil))}</span>${voce ? '' : convite ? '<span class="rf-chip rf-chip--alerta">Convite pendente</span>' : '<span class="rf-chip rf-chip--ok">Ativo</span>'}</div>
    <div class="rf-pessoa__acoes" role="cell">${voce ? '' : `
      ${convite ? '' : `<button type="button" class="rf-bt rf-bt--s" data-perfil-de="${p.id}">${ic('editar')}Trocar perfil</button>`}
      <div class="rf-pop"><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-menu aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações para ${esc(p.nome)}">${ic('pontos')}</button>
        <div class="rf-pop__lista" role="menu" hidden>${convite ? `<button type="button" role="menuitem" data-copiar>${ic('copiar')}Copiar e-mail do convite</button><hr><button type="button" role="menuitem" class="rf-perigoso" data-cancelar="${p.id}">${ic('x')}Cancelar convite</button>`
          : `<button type="button" role="menuitem" data-ver="${p.id}">${ic('olho')}Ver o que pode fazer</button><hr><button type="button" role="menuitem" class="rf-perigoso" data-encerrar="${p.id}">${ic('sair')}Encerrar acesso</button>`}</div></div>`}</div>
  </div>`;
}

function abaPessoas() {
  return `<div class="rf-tabela-caixa" role="table" aria-label="Pessoas com acesso"><div class="rf-pessoas rf-entra" role="rowgroup">${pessoas.map(linha).join('')}</div></div>
    <details class="rf-cartao rf-cartao--p"><summary style="cursor:pointer;font-weight:600">Ex-funcionários (1)</summary><p class="rf-fraco" style="margin:8px 0 0">Eva Antiga · acesso encerrado em 01/11/2026 · motivo: fim do contrato de teste. O que ela fez continua registrado.</p></details>`;
}
function resumoPerfil(id) {
  return AREAS.map(([a]) => [a, nivelDe(id, a)]).filter(([, n]) => n > 0).map(([a, n]) => `<span class="rf-chip ${n === 2 ? 'rf-chip--ouro' : 'rf-chip--neutro'} rf-chip--sem">${a}: ${ROT_NIVEL[n].toLowerCase()}</span>`).join('');
}
function abaPerfis() {
  return `<div class="rf-secao-t"><div><h3>Perfis de acesso</h3><p>Um perfil é um conjunto de permissões com um nome do seu negócio. Mudar um perfil muda o acesso de todos que o usam.</p></div><button type="button" class="rf-bt rf-bt--s" data-novo-perfil>${ic('mais')}Criar perfil</button></div>
    <div class="rf-empresas rf-entra">${PERFIS.map((p) => `<article class="rf-empresa"><div><b style="font-size:1.02rem">${p.nome}</b><p class="rf-fraco" style="margin:2px 0 0">${p.desc}</p></div>
      <div class="rf-empresa__selos">${resumoPerfil(p.id)}</div>
      <div class="rf-empresa__pe"><span class="rf-fraco">Usado por ${pessoas.filter((x) => x.perfil === p.id).length} pessoa(s)</span><button type="button" class="rf-bt rf-bt--s" data-editar-perfil="${p.id}">${ic('editar')}Editar</button></div></article>`).join('')}</div>`;
}
function abaHistorico() {
  const ev = [['20/11/2026 14:02', 'Convite enviado para lia@teste.example (Financeiro)', 'Pessoa Dona'], ['12/11/2026 09:30', 'Perfil de Bruno Caixa trocado: Somente consulta → Vendas e atendimento', 'Pessoa Dona'],
    ['01/11/2026 10:00', 'Acesso de Eva Antiga encerrado (fim do contrato de teste)', 'Pessoa Dona'], ['01/11/2026 09:00', 'Perfil "Estoque" criado a partir do modelo', 'Pessoa Dona']];
  return `<div class="rf-tabela-caixa"><table class="rf-tabela"><caption class="visualmente-oculto">Histórico da equipe</caption><thead><tr><th>Quando</th><th>O que aconteceu</th><th>Quem fez</th></tr></thead><tbody class="rf-entra">${ev.map(([q, o, w]) => `<tr><td class="rf-fraco" style="white-space:nowrap">${q}</td><td>${o}</td><td>${w}</td></tr>`).join('')}</tbody></table></div>
    <p class="rf-fraco" style="margin:0">Registro permanente: ninguém consegue apagar ou alterar estes eventos.</p>`;
}

function editorPerfil(id) {
  const p = PERFIS.find((x) => x.id === id) ?? { id: 'novo', nome: '', desc: '' };
  const d = abrirModal(`<form class="rf-modal__painel" novalidate>
    <div class="rf-modal__cab"><div><h3>${p.nome ? `Perfil ${esc(p.nome)}` : 'Novo perfil'}</h3><p>Escolha o nível de cada área. Use "Personalizar" só se precisar do detalhe.</p></div><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-fechar aria-label="Fechar">${ic('x')}</button></div>
    <div class="rf-modal__corpo">
      <div class="rf-grade-campos"><div class="rf-campo"><label for="pf-nome">Nome do perfil</label><input id="pf-nome" value="${esc(p.nome)}" placeholder="Ex.: Caixa, Atendimento"></div>
        ${p.nome ? '' : `<div class="rf-campo"><label for="pf-modelo">Começar de um modelo <span class="rf-obr">(opcional)</span></label><select id="pf-modelo"><option value="">Em branco</option>${PERFIS.map((x) => `<option value="${x.id}">${x.nome}</option>`).join('')}</select></div>`}</div>
      <div data-areas>${AREAS.map(([a, perms]) => { const n = nivelDe(p.id, a); return `<div class="rf-nivel" data-area="${esc(a)}"><div><b>${a}</b><small data-resumo>${n === 0 ? 'Não vê esta área' : n === 1 ? 'Vê, sem alterar' : 'Vê e trabalha nesta área'}</small></div>
        <div class="rf-abas" role="radiogroup" aria-label="Nível em ${esc(a)}">${['Sem acesso', 'Consultar', 'Operar', 'Personalizar'].map((r, i) => `<button type="button" role="radio" aria-checked="${i === n}" data-n="${i}">${r}</button>`).join('')}</div>
        <div class="rf-nivel__detalhe" hidden>${perms.map((pm, i) => `<label><input type="checkbox" ${(n === 2 || (n === 1 && i === 0)) ? 'checked' : ''}>${pm.replace(' (sensível)', '')}${pm.includes('sensível') ? ' <span class="rf-chip rf-chip--alerta rf-chip--sem">sensível</span>' : ''}</label>`).join('')}</div></div>`; }).join('')}</div>
    </div>
    <div class="rf-modal__pe"><span class="rf-fraco">Você só concede o que você mesmo pode fazer.</span><button type="button" class="rf-bt rf-bt--f" data-fechar>Cancelar</button><button type="submit" class="rf-bt rf-bt--p">${ic('check')}Salvar perfil</button></div></form>`, { classe: 'rf-gaveta' });
  d.addEventListener('click', (e) => {
    const b = e.target.closest('[data-n]'); if (!b) return;
    const grupo = b.parentElement; const area = grupo.closest('[data-area]'); const n = Number(b.dataset.n);
    for (const x of grupo.children) x.setAttribute('aria-checked', String(x === b));
    area.querySelector('.rf-nivel__detalhe').hidden = n !== 3;
    if (n < 3) area.querySelectorAll('input').forEach((c, i) => { c.checked = n === 2 || (n === 1 && i === 0); });
    area.querySelector('[data-resumo]').textContent = ['Não vê esta área', 'Vê, sem alterar', 'Vê e trabalha nesta área', 'Escolha uma a uma abaixo'][n];
  });
  d.querySelector('form').addEventListener('submit', async (e) => { e.preventDefault(); if (await operar(e.submitter, 'Salvando…')) { d.close(); aviso('ok', 'Perfil salvo', 'Quem usa este perfil passa a ter o novo acesso na hora.'); } });
}

function convidar(rerender) {
  const d = abrirModal(`<form class="rf-modal__painel" novalidate>
    <div class="rf-modal__cab"><div><h3>Convidar pessoa</h3><p>A pessoa recebe o convite no e-mail e entra com a própria conta. Você nunca vê a senha dela.</p></div><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-fechar aria-label="Fechar">${ic('x')}</button></div>
    <div class="rf-modal__corpo">
      <div class="rf-campo"><label for="cv-email">E-mail da pessoa</label><input id="cv-email" type="email" autocomplete="off" aria-describedby="cv-email-e" placeholder="nome@exemplo.com"><span class="rf-erro-campo" id="cv-email-e"></span></div>
      <fieldset style="border:0;padding:0;margin:0;display:grid;gap:8px"><legend style="font-weight:600;font-size:.86rem;margin-bottom:6px">O que ela vai poder fazer</legend>
        <div class="rf-escolha">${PERFIS.map((p, i) => `<label><input type="radio" name="perfil" value="${p.id}" ${i === 1 ? 'checked' : ''}><b>${p.nome}</b><span>${p.desc}</span></label>`).join('')}</div>
        <button type="button" class="rf-mais" data-novo-perfil style="justify-self:start">${ic('mais')}Nenhum serve? Criar um perfil novo</button></fieldset>
    </div>
    <div class="rf-modal__pe"><span class="rf-fraco">O convite vale por 7 dias.</span><button type="button" class="rf-bt rf-bt--f" data-fechar>Cancelar</button><button type="submit" class="rf-bt rf-bt--p">${ic('convidar')}Enviar convite</button></div></form>`,
  { classe: 'rf-modal rf-modal--estreito', aoAbrir: (x) => x.querySelector('#cv-email').focus() });
  d.querySelector('[data-novo-perfil]').addEventListener('click', () => { d.close(); editorPerfil('novo'); });
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault(); const em = d.querySelector('#cv-email'); const v = em.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { em.setAttribute('aria-invalid', 'true'); d.querySelector('#cv-email-e').textContent = 'Digite um e-mail válido.'; em.focus(); return; }
    if (!(await operar(e.submitter, 'Enviando…'))) return;
    const perfil = new FormData(e.target).get('perfil');
    pessoas.push({ id: Date.now(), nome: v, email: 'Convite enviado agora · vence em 7 dias', perfil, estado: 'convite' });
    d.close(); rerender(); aviso('ok', 'Convite enviado', `${v} recebe o convite como ${nomePerfil(perfil)}.`);
  });
}

function trocarPerfil(p, rerender) {
  const d = abrirModal(`<form class="rf-modal__painel"><div class="rf-modal__cab"><div><h3>Trocar perfil de ${esc(p.nome)}</h3><p>Vale na hora. Fica registrado no histórico.</p></div><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-fechar aria-label="Fechar">${ic('x')}</button></div>
    <div class="rf-modal__corpo"><div class="rf-escolha">${PERFIS.map((x) => `<label><input type="radio" name="perfil" value="${x.id}" ${x.id === p.perfil ? 'checked' : ''}><b>${x.nome}${x.id === p.perfil ? ' <span class="rf-fraco">(atual)</span>' : ''}</b><span>${x.desc}</span></label>`).join('')}</div></div>
    <div class="rf-modal__pe"><button type="button" class="rf-bt rf-bt--f" data-fechar>Cancelar</button><button type="submit" class="rf-bt rf-bt--p">${ic('check')}Trocar perfil</button></div></form>`, { classe: 'rf-modal rf-modal--estreito' });
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault(); const novo = new FormData(e.target).get('perfil'); if (novo === p.perfil) { d.close(); return; }
    if (!(await operar(e.submitter, 'Trocando…'))) return; p.perfil = novo; d.close(); rerender(); aviso('ok', 'Perfil trocado', `${p.nome} agora usa ${nomePerfil(novo)}.`);
  });
}

function encerrar(p, rerender) {
  const d = abrirModal(`<form class="rf-modal__painel"><div class="rf-modal__cab"><div><h3>Encerrar acesso de ${esc(p.nome)}?</h3><p>Ela deixa de entrar nesta empresa na hora. O que ela fez continua registrado.</p></div><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-fechar aria-label="Fechar">${ic('x')}</button></div>
    <div class="rf-modal__corpo"><div class="rf-campo"><label for="enc-mot">Motivo <span class="rf-obr">(opcional, só a equipe vê)</span></label><input id="enc-mot" maxlength="300"></div></div>
    <div class="rf-modal__pe"><button type="button" class="rf-bt rf-bt--f" data-fechar>Voltar</button><button type="submit" class="rf-bt rf-bt--perigo">${ic('sair')}Encerrar acesso</button></div></form>`, { classe: 'rf-modal rf-modal--estreito' });
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault(); if (!(await operar(e.submitter, 'Encerrando…'))) return;
    pessoas.splice(pessoas.indexOf(p), 1); d.close(); rerender(); aviso('ok', 'Acesso encerrado', 'O histórico do que a pessoa fez continua registrado.');
  });
}

function pagina(palco, aba = 'pessoas') {
  const app = casca({ atual: 'equipe', trilha: ['Business', 'Gestão', 'Equipe'], titulo: 'Equipe', subtitulo: 'Quem trabalha com você e o que cada pessoa pode fazer.',
    acoes: `<button type="button" class="rf-bt rf-bt--p" data-convidar>${ic('convidar')}Convidar pessoa</button>` });
  const corpo = app.querySelector('[data-corpo]');
  const ativos = pessoas.filter((x) => x.estado !== 'convite').length; const conv = pessoas.length - ativos;
  corpo.innerHTML = `<div class="rf-rolagem-x"><div class="rf-abas" role="tablist" aria-label="Equipe">
    <button type="button" role="tab" aria-selected="${aba === 'pessoas'}" data-aba="pessoas">${ic('equipe')}Pessoas <span class="rf-n">${ativos}${conv ? ` + ${conv} convite` : ''}</span></button>
    <button type="button" role="tab" aria-selected="${aba === 'perfis'}" data-aba="perfis">${ic('escudo')}Perfis de acesso <span class="rf-n">${PERFIS.length}</span></button>
    <button type="button" role="tab" aria-selected="${aba === 'historico'}" data-aba="historico">${ic('relogio')}Histórico</button></div></div>
    <div role="tabpanel" style="display:grid;gap:14px">${aba === 'pessoas' ? abaPessoas() : aba === 'perfis' ? abaPerfis() : abaHistorico()}</div>`;
  palco.replaceChildren(app); ligarMenus(app);
  const re = () => pagina(palco, aba);
  app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-aba]'); if (t) pagina(palco, t.dataset.aba);
    if (e.target.closest('[data-convidar]')) convidar(re);
    const pf = e.target.closest('[data-perfil-de]'); if (pf) trocarPerfil(pessoas.find((x) => x.id === Number(pf.dataset.perfilDe)), re);
    const en = e.target.closest('[data-encerrar]'); if (en) encerrar(pessoas.find((x) => x.id === Number(en.dataset.encerrar)), re);
    const ca = e.target.closest('[data-cancelar]'); if (ca) { pessoas.splice(pessoas.findIndex((x) => x.id === Number(ca.dataset.cancelar)), 1); re(); aviso('ok', 'Convite cancelado'); }
    const ve = e.target.closest('[data-ver]'); if (ve) editorPerfil(pessoas.find((x) => x.id === Number(ve.dataset.ver)).perfil);
    if (e.target.closest('[data-copiar]')) aviso('ok', 'E-mail copiado');
    const ed = e.target.closest('[data-editar-perfil]'); if (ed) editorPerfil(ed.dataset.editarPerfil);
    if (e.target.closest('[data-novo-perfil]')) editorPerfil('novo');
  });
}

export function montar() {
  const s = secao({ titulo: 'Equipe', destaque: 'simplificada', texto: 'A página mostra primeiro as pessoas. Perfis e histórico ficam em abas. Permissões viram níveis por área, com o detalhe a um clique.',
    antes: 'img/antes/equipe.webp',
    objetivos: [['Adicionar alguém', 'Botão "Convidar pessoa" no topo: e-mail + escolher o que a pessoa faz, em cartões com explicação.'], ['Mudar o acesso', '"Trocar perfil" direto na linha da pessoa.'], ['Tirar o acesso', 'Menu ⋯ > Encerrar acesso, com confirmação e motivo opcional.']],
    selos: [['Funciona com o banco atual', 'ok']],
    notas: ['Antes: lista, convite, perfis, editor de 48 permissões e histórico numa página só, com 4.800 px de altura.', 'Agora: 3 abas, e a primeira cabe numa tela.', 'As permissões ganham nomes de gente ("Alterar preço", "Ver custo"), e as sensíveis vêm marcadas.', 'O editor de perfil vira uma gaveta lateral com 3 níveis por área; "Personalizar" mostra as caixas uma a uma.', 'Convites pendentes aparecem na mesma lista, com a situação e o prazo.'] });
  pagina(s.querySelector('[data-palco]')); return s;
}
