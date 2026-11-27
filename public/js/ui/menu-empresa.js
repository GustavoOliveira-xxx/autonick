/**
 * Módulos do ERP da empresa ativa, agrupados como no protótipo aprovado (M13b, Etapa 1). Uma única lista para o menu da
 * área Business e para a navegação dentro das telas. Cada item só aparece com a permissão que abre a tela; quem decide de
 * verdade é o banco, tela a tela.
 */
const L = (pagina, id) => `/business/${pagina}.html?id=${encodeURIComponent(id)}`;

/** pode(c) devolve se a pessoa tem a permissão; sem lista de permissões conhecida, mostra todos os módulos. */
export function gruposDaEmpresa(id, pode) {
  const grupos = [
    ['Operação', [
      ['painel', L('dashboard', id), 'Painel', 'i-painel', true],
      ['vendas', L('vendas', id), 'Vendas', 'i-sacola', pode('vendas.visualizar') || pode('vendas.criar')],
      ['pedidos', L('pedidos-empresa', id), 'Pedidos', 'i-lista', pode('pedidos.visualizar')],
      ['solicitacoes', L('solicitacoes', id), 'Orçamentos', 'i-balao', pode('orcamentos.visualizar')],
      ['ordens', L('ordens', id), 'Ordens de serviço', 'i-ferramenta', pode('servicos.visualizar')],
      ['agenda', L('agenda', id), 'Agenda', 'i-agenda', pode('agenda.visualizar')],
    ]],
    ['Catálogo', [
      ['produtos', L('produtos-empresa', id), 'Produtos', 'i-caixa', pode('produtos.visualizar') || pode('estoque.visualizar')],
      ['estoque', L('estoque-empresa', id), 'Estoque', 'i-caixa', pode('estoque.visualizar')],
      ['servicos', L('servicos', id), 'Serviços', 'i-tesoura', pode('catalogo_servicos.visualizar')],
      ['fornecedores', L('fornecedores', id), 'Fornecedores', 'i-carro', pode('fornecedores.visualizar')],
      ['compras', L('compras', id), 'Compras', 'i-sacola', pode('estoque.visualizar')],
    ]],
    ['Gestão', [
      ['financeiro', L('financeiro', id), 'Financeiro', 'i-moeda', pode('financeiro.visualizar')],
      ['clientes', L('clientes', id), 'Clientes', 'i-pessoa', pode('clientes.visualizar')],
      ['equipe', L('equipe', id), 'Equipe', 'i-equipe', pode('equipe.visualizar')],
      ['avaliacoes', L('avaliacoes', id), 'Avaliações', 'i-estrela', pode('vitrine.visualizar')],
      ['atividades', L('atividades', id), 'Atividades', 'i-relogio', true],
      ['empresa', L('empresa', id), 'Empresa e vitrine', 'i-vitrine', true],
    ]],
  ];
  return grupos.map(([titulo, itens]) => [titulo, itens.filter((i) => i[4]).map(([chave, href, rotulo, icone]) => ({ chave, href, rotulo, icone }))])
    .filter(([, itens]) => itens.length);
}

/** Qual item corresponde à página atual (pelo nome do arquivo). */
export function chaveDaPagina(caminho = location.pathname) {
  const arquivo = caminho.split('/').pop().replace('.html', '');
  return {
    dashboard: 'painel', vendas: 'vendas', 'venda-nova': 'vendas', venda: 'vendas', 'pedidos-empresa': 'pedidos', solicitacoes: 'solicitacoes',
    solicitacao: 'solicitacoes', ordens: 'ordens', ordem: 'ordens', agenda: 'agenda', 'produtos-empresa': 'produtos', produto: 'produtos',
    'estoque-empresa': 'estoque', servicos: 'servicos', servico: 'servicos', fornecedores: 'fornecedores', compras: 'compras', financeiro: 'financeiro',
    'financeiro-contas': 'financeiro', 'financeiro-movimentacoes': 'financeiro', 'financeiro-relatorios': 'financeiro', 'financeiro-fechamento': 'financeiro',
    'financeiro-configuracoes': 'financeiro', clientes: 'clientes', equipe: 'equipe', avaliacoes: 'avaliacoes', empresa: 'empresa', atividades: 'atividades',
  }[arquivo] ?? null;
}
