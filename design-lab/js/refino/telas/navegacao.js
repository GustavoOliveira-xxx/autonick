// Navegação e legibilidade: menu lateral, abas e a lista de problemas encontrados na visita ao app.
import { h, ic, casca } from '../pecas.js';

const PROBLEMAS = [
  ['Financeiro, todas as abas', 'Aba ativa com texto claro sobre amarelo (contraste perto de 1,9:1). Some na tela.', 'Aba ativa em superfície elevada, texto escuro/claro conforme o tema, filete dourado embaixo (acima de 7:1).'],
  ['Financeiro, Equipe, Empresa', 'Abas e seções desenhadas como links sublinhados soltos: parecem texto corrido, não navegação.', 'Componente de abas único (rf-abas) com ícone, contador e estado ativo inequívoco.'],
  ['Menu lateral (Business)', '"Entrar" aparece para quem já está logado.', 'Rodapé do menu com a pessoa logada; "Entrar" só sem sessão.'],
  ['Menu lateral (Business)', 'O menu termina no meio da página e não acompanha a rolagem; acima dele sobra uma faixa vazia.', 'Trilho lateral de altura total, fixo, com a marca no topo.'],
  ['Menu lateral (Business)', 'Itens com peso e cor muito parecidos; o item ativo depende só da cor de fundo vinho.', 'Ativo com barra dourada na borda, fundo dourado translúcido e ícone aceso; hover com ícone que se mexe.'],
  ['Bloco "Empresa ativa"', '"Trocar de empresa" é um link pequeno e sublinhado, fácil de não ver.', 'O bloco inteiro vira o botão de troca, com logo, nome e ícone de troca.'],
  ['Topo do menu', '"Leitura ampliada" e tema ocupam o lugar mais nobre, antes da empresa e do menu.', 'Preferências vão para o rodapé do menu (perfil da pessoa).'],
  ['Equipe, perfis', 'Permissões com nome técnico ("alterar preco", "Permite alterar_preco em produtos").', 'Nomes de gente ("Alterar preço") e marca "sensível" onde vale.'],
  ['Selos "Dado de teste"', 'Selo minúsculo, quase ilegível no escuro.', 'Selo maior, com contraste AA, sempre ao lado do título.'],
  ['Títulos de seção', 'O "!" amarelo antes de todo título compete com o próprio título e com alertas reais.', 'Título limpo; o "!" fica reservado para avisos.'],
  ['Formulários longos', 'Ação principal no fim de páginas de 3.000 a 5.000 px.', 'Ação principal no topo da página e barra de salvar fixa quando há alteração.'],
];

export function montar() {
  const s = h(`<section class="lb-sec"><header class="lb-cab"><h1>Navegação e <em>legibilidade</em></h1><p>Visitei as telas do Business, do Cliente e do CK Admin procurando o que some, o que parece clicável sem ser e o que é clicável sem parecer. As capturas que você citou (o "Painel" camuflado, os links crus e o financeiro) não chegaram anexadas nesta conversa, então fui direto às telas: abaixo está o que encontrei e a correção proposta.</p></header>
    <div class="lb-comparar" style="margin-top:18px">
      <div class="lb-antes"><span class="lb-rotulo">Hoje no app</span><figure tabindex="0" aria-label="Menu lateral atual"><img src="img/antes/menu.webp" alt="Menu lateral atual" loading="lazy"></figure>
        <span class="lb-rotulo">Abas de hoje</span><div class="rf-cartao rf-cartao--p lb-escuro" style="background:#120c1b;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;font-size:.86rem">
          <a href="#" data-sem-nav style="color:#ffd567;font-weight:700">Painel</a><a href="#" data-sem-nav style="color:#ffd567;font-weight:700">A pagar e a receber</a><span style="padding:4px 10px;border-radius:6px;background:linear-gradient(180deg,#ffd567,#f5b70a);color:#fff;font-weight:700">Movimentações</span><a href="#" data-sem-nav style="color:#ffd567;font-weight:700">Fechamento do mês</a></div></div>
      <div style="display:grid;gap:12px;min-width:0"><span class="lb-rotulo lb-rotulo--proposta">Proposta: menu e abas</span><div data-palco></div>
        <span class="lb-rotulo lb-rotulo--proposta">Abas (mesmo componente em todo o app)</span>
        <div class="rf-rolagem-x"><div class="rf-abas" role="tablist" aria-label="Exemplo de abas">${[['painel', 'Visão geral'], ['transferir', 'Movimentações'], ['orcamentos', 'A pagar e a receber', 3], ['check', 'Fechamento do mês'], ['estoque', 'Relatórios']].map(([i, n, c], k) => `<button type="button" role="tab" aria-selected="${k === 1}">${ic(i)}${n}${c ? ` <span class="rf-n">${c}</span>` : ''}</button>`).join('')}</div></div></div>
    </div>
    <div class="rf-secao-t" style="margin-top:24px"><div><h3>O que encontrei (${PROBLEMAS.length})</h3><p>Corrigidos no lab; nada foi mexido no app.</p></div></div>
    <div class="rf-tabela-caixa" style="margin-top:10px"><table class="rf-tabela"><thead><tr><th>Onde</th><th>Problema</th><th>Correção proposta</th></tr></thead><tbody>${PROBLEMAS.map(([o, p, c]) => `<tr><td style="white-space:nowrap"><b>${o}</b></td><td class="rf-suave">${p}</td><td>${c}</td></tr>`).join('')}</tbody></table></div></section>`);
  const app = casca({ atual: 'painel', trilha: ['Business'], titulo: 'Painel', subtitulo: 'O que precisa da sua atenção hoje.',
    acoes: `<button type="button" class="rf-bt rf-bt--p">${ic('vendas')}Nova venda</button>`,
    corpo: `<div class="rf-kpis">${[['Vendas hoje', 'R$ 312,00'], ['Pedidos novos', '3'], ['Contas desta semana', '2']].map(([a, b]) => `<div class="rf-kpi"><small>${a}</small><strong>${b}</strong></div>`).join('')}</div>` });
  app.style.minHeight = '560px';
  s.querySelector('[data-palco]').append(app);
  return s;
}
