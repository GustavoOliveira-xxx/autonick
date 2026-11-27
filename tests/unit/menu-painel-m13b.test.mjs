/**
 * M13b: menu da empresa por permissões, página atual e índice de conversas com mensagens novas.
 * O menu só esconde o que a pessoa não pode abrir; quem decide de verdade é o banco, tela a tela.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gruposDaEmpresa, chaveDaPagina } from '../../public/js/ui/menu-empresa.js';
import { indiceNovas } from '../../public/js/data/painel.js';

const ID = 'e0000000-0000-4000-8000-000000000013';
const chaves = (grupos) => grupos.flatMap(([, itens]) => itens.map((i) => i.chave));

test('sem nenhuma permissão: só Painel, Atividades (o banco filtra o conteúdo) e Empresa e vitrine; grupos vazios somem', () => {
  const grupos = gruposDaEmpresa(ID, () => false);
  assert.deepEqual(chaves(grupos), ['painel', 'atividades', 'empresa']);
  assert.deepEqual(grupos.map(([t]) => t), ['Operação', 'Gestão']);
});

test('cada módulo aparece só com a permissão que abre a tela', () => {
  const permissoes = new Set(['vendas.criar', 'orcamentos.visualizar', 'financeiro.visualizar']);
  const grupos = gruposDaEmpresa(ID, (c) => permissoes.has(c));
  assert.deepEqual(chaves(grupos), ['painel', 'vendas', 'solicitacoes', 'financeiro', 'atividades', 'empresa']);
});

test('estoque.visualizar abre Produtos, Estoque e Compras; Fornecedores é destino separado (pacote 27/11); a ordem dos grupos é fixa', () => {
  const grupos = gruposDaEmpresa(ID, (c) => c === 'estoque.visualizar');
  assert.deepEqual(chaves(grupos), ['painel', 'produtos', 'estoque', 'compras', 'atividades', 'empresa']);
  const fornecedores = gruposDaEmpresa(ID, (c) => c === 'fornecedores.visualizar');
  assert.deepEqual(chaves(fornecedores), ['painel', 'fornecedores', 'atividades', 'empresa']);
  assert.deepEqual(grupos.map(([t]) => t), ['Operação', 'Catálogo', 'Gestão']);
});

test('os endereços levam a empresa ativa codificada', () => {
  const [[, operacao]] = gruposDaEmpresa('a b', () => true);
  assert.equal(operacao[0].href, '/business/dashboard.html?id=a%20b');
});

test('página atual: telas de detalhe marcam o módulo da lista', () => {
  assert.equal(chaveDaPagina('/business/dashboard.html'), 'painel');
  assert.equal(chaveDaPagina('/business/venda-nova.html'), 'vendas');
  assert.equal(chaveDaPagina('/business/ordem.html'), 'ordens');
  assert.equal(chaveDaPagina('/business/financeiro-fechamento.html'), 'financeiro');
  assert.equal(chaveDaPagina('/business/atividades.html'), 'atividades');
  assert.equal(chaveDaPagina('/business/compras.html'), 'compras');
  assert.equal(chaveDaPagina('/business/fornecedores.html'), 'fornecedores');
  assert.equal(chaveDaPagina('/business/minhas-empresas.html'), null);
});

test('índice de novas: chave por tipo e id, e a OS herda as novas da solicitação', () => {
  const i = indiceNovas({ total: 4, conversas: [
    { tipo: 'solicitacao', id: 's1', os_id: 'o1', novas: 3 },
    { tipo: 'pedido', id: 'p1', os_id: null, novas: 1 },
  ] });
  assert.equal(i.get('solicitacao:s1'), 3);
  assert.equal(i.get('os:o1'), 3);
  assert.equal(i.get('pedido:p1'), 1);
  assert.equal(i.size, 3);
});

test('índice de novas: resposta vazia ou ausente não quebra a tela', () => {
  assert.equal(indiceNovas(null).size, 0);
  assert.equal(indiceNovas({ total: 0, conversas: [] }).size, 0);
});
