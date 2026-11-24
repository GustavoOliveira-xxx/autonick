// Tema claro revisado, lado a lado com o escuro, sobre os mesmos componentes.
import { h, ic } from '../pecas.js';

const amostra = () => `<div style="display:grid;gap:12px">
  <div class="rf-secao-t"><h3>Movimentações</h3><div class="rf-acoes"><button type="button" class="rf-bt rf-bt--s">${ic('saida')}Saída</button><button type="button" class="rf-bt rf-bt--p">${ic('entrada')}Entrada</button></div></div>
  <div class="rf-abas" role="tablist" aria-label="Amostra"><button type="button" role="tab" aria-selected="false">Visão geral</button><button type="button" role="tab" aria-selected="true">Movimentações</button><button type="button" role="tab" aria-selected="false">Relatórios</button></div>
  <div class="rf-kpis"><div class="rf-kpi"><small>Caixa da empresa</small><strong>R$ 1.284,50</strong><span>saldo agora</span></div><div class="rf-kpi"><small>Banco do bairro</small><strong>R$ 9.123,00</strong><span>saldo agora</span></div></div>
  <div class="rf-tabela-caixa"><table class="rf-tabela"><thead><tr><th>Data</th><th>O que foi</th><th class="rf-num">Valor</th></tr></thead><tbody>
    <tr><td><b>24/11</b></td><td>Venda nº 118<br><span class="rf-fraco">Receita · Bruno Caixa</span></td><td class="rf-num rf-entrada">+ R$ 86,50</td></tr>
    <tr><td><b>24/11</b></td><td>Fornecedores<br><span class="rf-fraco">Despesa · Pessoa Dona</span></td><td class="rf-num rf-saida">− R$ 234,00</td></tr></tbody></table></div>
  <div class="rf-grade-campos"><div class="rf-campo"><label>Descrição <input value="Conta de luz" style="margin-top:5px"></label></div><div class="rf-campo"><label>Conta <select style="margin-top:5px"><option>Caixa da empresa</option></select></label></div></div>
  <div style="display:flex;flex-wrap:wrap;gap:6px"><span class="rf-chip rf-chip--ok">Confirmada</span><span class="rf-chip rf-chip--alerta">Aguardando</span><span class="rf-chip rf-chip--erro">Cancelada</span><span class="rf-chip rf-chip--info">Em análise</span><span class="rf-chip rf-chip--ouro rf-chip--sem">Vendas e atendimento</span></div>
</div>`;

export function montar() {
  const s = h(`<section class="lb-sec"><header class="lb-cab"><h1>Tema claro <em>revisado</em></h1><p>O claro deixa de ser o escuro invertido. Fundo de papel quente com uma retícula leve, cartões brancos com borda dourada clara, dourado mais escuro para texto (contraste AA) e o trilho lateral continua escuro: é ele que carrega a identidade CK nos dois temas.</p></header>
    <div class="lb-objetivo" style="margin-top:14px"><div class="lb-obj"><b>Superfícies</b><p>Papel #F5EFE4 no fundo, branco nos cartões, #FBF7EF nos campos e cabeçalhos de tabela.</p></div><div class="lb-obj"><b>Dourado</b><p>#E3A008 para preencher; #8A5600 para texto e ícones (6,4:1 no branco).</p></div><div class="lb-obj"><b>Sombras</b><p>Quentes e curtas (marrom a 6–16%), em vez de cinza azulado.</p></div><div class="lb-obj"><b>Estados</b><p>Verde, âmbar, vermelho e azul escurecidos para passar de 4,5:1 sobre fundos claros.</p></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;margin-top:18px">
      <div style="display:grid;gap:8px"><span class="lb-rotulo">Escuro (principal)</span><div class="lb-escuro rf-cartao rf-cartao--p" style="background:var(--rf-fundo)">${amostra()}</div></div>
      <div style="display:grid;gap:8px"><span class="lb-rotulo lb-rotulo--proposta">Claro revisado</span><div class="lb-claro rf-cartao rf-cartao--p" style="background:var(--rf-fundo) radial-gradient(circle, rgb(138 86 0 / 0.07) 1px, transparent 1.4px) 0 0 / 10px 10px">${amostra()}</div></div>
      <div style="display:grid;gap:8px"><span class="lb-rotulo">Claro de hoje</span><figure tabindex="0" aria-label="Captura do tema claro atual (role para ver)" style="margin:0;border-radius:12px;overflow:hidden;border:1px solid var(--rf-linha);max-height:560px;overflow-y:auto"><img src="img/antes/claro.webp" alt="Tema claro atual" style="width:100%;height:auto" loading="lazy"></figure></div>
    </div>
    <p class="rf-fraco" style="margin-top:12px">Use o botão "Claro" no topo do lab para ver todas as outras seções (Empresas, Equipe, Agenda, Financeiro) no tema claro.</p></section>`);
  return s;
}
