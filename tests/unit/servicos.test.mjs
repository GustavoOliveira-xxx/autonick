import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textoEstimativa, ajudaEstimativaCliente, AVISO_ESTIMATIVA_CLIENTE, lerRespostas, textoResposta, textoValidade, instanteSaoPaulo, montarGrade, lerOpcoes } from '../../public/js/domain/servicos.js';

const nbsp = (s) => s.replace(/ /g, ' ');

test('estimativa: valor único, faixa, a partir de e análise manual', () => {
  assert.equal(nbsp(textoEstimativa({ completa: true, valor_centavos: 41750, exibicao: 'valor' })), 'R$ 417,50');
  assert.equal(nbsp(textoEstimativa({ completa: true, valor_centavos: 41750, exibicao: 'faixa', minimo_centavos: 37575, maximo_centavos: 45925 })), 'Entre R$ 375,75 e R$ 459,25');
  assert.equal(nbsp(textoEstimativa({ completa: false, tipo: 'a_partir_de', minimo_centavos: 9000 })), 'A partir de R$ 90,00');
  assert.equal(textoEstimativa({ completa: false, tipo: 'por_regras' }), 'A empresa vai analisar e enviar o orçamento');
});

test('respostas: tipos lidos sem calcular preço; obrigatória vazia vira erro de formato', () => {
  const perguntas = [{ id: 'a', tipo: 'numero', obrigatoria: true }, { id: 'b', tipo: 'sim_nao' }, { id: 'c', tipo: 'escolha_multipla' },
    { id: 'd', tipo: 'texto_curto', obrigatoria: true }];
  const r = lerRespostas(perguntas, { 'p-a': '12,5', 'p-b': 'nao', 'p-c': ['Sala', 'Quarto'], 'p-d': '' });
  assert.deepEqual(r.respostas, { a: 12.5, b: false, c: ['Sala', 'Quarto'] });
  assert.deepEqual(r.erros, [{ nome: 'p-d', mensagem: 'Responda esta pergunta.' }]);
  assert.deepEqual(lerRespostas([{ id: 'a', tipo: 'numero' }], { 'p-a': 'doze' }).erros, [{ nome: 'p-a', mensagem: 'Informe um número.' }]);
});

test('texto de resposta e validade', () => {
  assert.equal(textoResposta({ tipo: 'numero', valor: 12.5, unidade: 'm²' }), '12,5 m²');
  assert.equal(textoResposta({ tipo: 'sim_nao', valor: false }), 'Não');
  assert.equal(textoResposta({ tipo: 'escolha_multipla', valor: ['Sala', 'Quarto'] }), 'Sala, Quarto');
  assert.equal(textoValidade('2026-11-30', '2026-11-12'), 'Válido até 30/11/2026');
  assert.equal(textoValidade('2026-11-12', '2026-11-12'), 'Vence hoje');
  assert.equal(textoValidade('2026-11-11', '2026-11-12'), 'Vencida');
});

test('horário em São Paulo, grade e opções', () => {
  assert.equal(instanteSaoPaulo('2026-11-16', '09:30'), '2026-11-16T09:30:00-03:00');
  assert.equal(instanteSaoPaulo('16/11/2026', '09:30'), null);
  const g = montarGrade({ 1: [{ abre: '08:00', fecha: '12:00' }, { abre: '', fecha: '' }] });
  assert.equal(g.length, 7);
  assert.deepEqual(g[1], { dia_semana: 1, intervalos: [{ abre: '08:00', fecha: '12:00' }] });
  assert.deepEqual(g[0].intervalos, []);
  assert.deepEqual(lerOpcoes('Fosco\n\nBrilho\nfosco\n  Acetinado '), ['Fosco', 'Brilho', 'Acetinado']);
});

test('P-M11-02: aviso de valor estimado só quando a tela mostra apenas a estimativa', () => {
  const auto = { completa: true, tipo: 'por_regras', valor_centavos: 12000, rotulo: 'Orçamento gerado pelas regras da empresa, sem análise manual.' };
  assert.equal(AVISO_ESTIMATIVA_CLIENTE, 'Este é um valor estimado. Confira o orçamento antes de aceitar.');
  assert.equal(ajudaEstimativaCliente(auto), AVISO_ESTIMATIVA_CLIENTE);
  assert.equal(ajudaEstimativaCliente({ completa: true, exibicao: 'faixa', valor_centavos: 41750, minimo_centavos: 37575, maximo_centavos: 45925 }), AVISO_ESTIMATIVA_CLIENTE);
  assert.equal(ajudaEstimativaCliente({ completa: false, tipo: 'a_partir_de', minimo_centavos: 9000, rotulo: 'A partir de R$ 90,00.' }), AVISO_ESTIMATIVA_CLIENTE);
  // Orçamento já gerado e disponível para aceite: nenhum aviso.
  assert.equal(ajudaEstimativaCliente(auto, { orcamentoDisponivel: true }), null);
  // Sem valor: a explicação do banco continua.
  assert.equal(ajudaEstimativaCliente({ completa: false, tipo: 'sob_consulta', rotulo: 'Preço sob consulta: a empresa vai analisar e enviar o orçamento.' }),
    'Preço sob consulta: a empresa vai analisar e enviar o orçamento.');
  assert.equal(ajudaEstimativaCliente({ completa: false, tipo: 'por_regras' }), null);
  assert.equal(ajudaEstimativaCliente(null), null);
});
