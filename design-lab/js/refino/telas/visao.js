// Visão geral: a diretriz (tarefa primeiro), o mapa de objetivos e onde cada um foi resolvido no lab.
import { h, ic } from '../pecas.js';

const TAREFAS = [
  ['Rastrear uma venda', 'Vendas → filtrar → abrir → rolar até o andamento', 'Ctrl K → digitar "118" → etapas da venda num painel', 'paleta'],
  ['Lançar uma saída simples', 'Financeiro → Movimentações → achar o 1º de 3 formulários → preencher 6 campos', '"Saiu dinheiro" → valor → categoria → Registrar', 'financeiro'],
  ['Trocar de empresa', 'Link pequeno "Trocar de empresa" → página com lista e cadastro misturados', 'Clicar no bloco da empresa no menu → escolher (de qualquer tela)', 'empresas'],
  ['Adicionar um funcionário', 'Equipe → rolar até "Convidar pessoa" → escolher perfil sem saber o que ele faz', '"Convidar pessoa" no topo → e-mail → perfil em cartões com explicação', 'equipe'],
  ['Configurar horários', 'Agenda → rolar até o fim → 28 campos de hora soltos', 'Aba "Horários" → modelo "Comercial" → ajustar → Salvar', 'agenda'],
  ['Cliente: em que etapa está o serviço', 'Abrir a OS e ler a linha do tempo inteira', 'Etapas no topo da OS: o que já foi, o que está agora e o que vem', 'paleta'],
  ['Admin: aprovar com rapidez', 'Rolar a fila e preencher o formulário de cada item', 'Botões Aprovar / Pedir correção na própria linha; motivo só quando precisa', 'admin'],
];

export function montar() {
  return h(`<section class="lb-sec"><header class="lb-cab"><h1>Refino de UX, <em>dinamismo</em> e marca</h1><p>Proposta para aprovação. Nada aqui foi aplicado ao app: o lab usa dados fictícios e simula o servidor (latência e resultado no topo). A diretriz que guiou tudo: <b>a tarefa mais comum de cada tela vem primeiro, num clique; o resto fica a um clique de distância, não na frente.</b></p></header>
    <div class="lb-objetivo" style="margin-top:16px">
      <div class="lb-obj"><b>Hierarquia</b><p>Uma ação principal dourada por tela, no topo. Secundárias em contorno. Contextuais no menu ⋯ da linha.</p></div>
      <div class="lb-obj"><b>Densidade</b><p>Abas no lugar de páginas de 5.000 px. Formulários em modais curtos, com padrões já preenchidos.</p></div>
      <div class="lb-obj"><b>Feedback</b><p>Resposta visual no toque (0 ms), indicador só se demorar (120 ms), confirmação só com a resposta real.</p></div>
      <div class="lb-obj"><b>Atalho universal</b><p>"Ir para…" (Ctrl K) no menu: ações e registros por nome ou número, em qualquer tela.</p></div>
    </div>
    <div class="rf-secao-t" style="margin-top:22px"><div><h3>Objetivos reais, antes e depois</h3><p>Clique em "Ver" para abrir a parte do lab correspondente.</p></div><button type="button" class="rf-bt rf-bt--p" data-paleta>${ic('busca')}Experimentar "Ir para…" <span class="rf-kbd">Ctrl K</span></button></div>
    <div class="rf-tabela-caixa" style="margin-top:10px"><table class="rf-tabela"><thead><tr><th>Quero…</th><th>Hoje</th><th>Na proposta</th><th></th></tr></thead><tbody>
      ${TAREFAS.map(([t, a, d, s]) => `<tr><td><b>${t}</b></td><td class="rf-suave">${a}</td><td>${d}</td><td>${s === 'paleta' ? `<button type="button" class="rf-bt rf-bt--f" data-paleta>Ver</button>` : `<a class="rf-bt rf-bt--f" href="#${s}">Ver</a>`}</td></tr>`).join('')}</tbody></table></div>
    <div class="rf-secao-t" style="margin-top:22px"><div><h3>Também no lab</h3></div></div>
    <div class="lb-objetivo" style="margin-top:10px">${[['clique', 'Clique e carregamento', 'Três estilos de clique e nove indicadores por contexto.'], ['navegacao', 'Navegação e legibilidade', 'Menu lateral, abas e 11 problemas corrigidos.'], ['tema', 'Tema claro', 'Lado a lado com o escuro e com o claro de hoje.'], ['marca', 'Marca em camadas', 'Logo completa, símbolo em SVG e onde usar cada um.'], ['animacoes', 'Lab de animações', 'Sino, objetos 3D e a nova mãozinha (página própria).']]
      .map(([id, t, d]) => `<a class="lb-obj" href="${id === 'animacoes' ? 'animacoes.html' : `#${id}`}" style="text-decoration:none;color:inherit"><b>${t} →</b><p>${d}</p></a>`).join('')}</div></section>`);
}
