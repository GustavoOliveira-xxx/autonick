import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerQuantidade, chaveAtributos, rotuloVariacao, faixaDePreco, variacoesRepetidas } from '../../public/js/domain/variacoes.js';

test('quantidade: inteira, positiva, e com sinal só em ajuste (FIN-001 §2)', () => {
  assert.deepEqual(lerQuantidade('12'), { ok: true, valor: 12 });
  assert.deepEqual(lerQuantidade(' 1 000 '), { ok: true, valor: 1000 });
  assert.equal(lerQuantidade('1,5').ok, false);
  assert.equal(lerQuantidade('0').ok, false);
  assert.equal(lerQuantidade('-3').ok, false);
  assert.deepEqual(lerQuantidade('-3', { comSinal: true }), { ok: true, valor: -3 });
  assert.equal(lerQuantidade('2000000').ok, false);
  assert.equal(lerQuantidade('').ok, false);
  assert.equal(lerQuantidade(undefined).ok, false);
});

test('atributos: comparação igual à do banco e rótulo legível', () => {
  assert.equal(chaveAtributos({ Tamanho: ' M ', Cor: 'Azul  Claro' }), 'cor=azul claro;tamanho=m');
  assert.equal(chaveAtributos({}), '');
  assert.equal(rotuloVariacao({ atributos: { Tamanho: 'M', Cor: 'Azul' } }), 'Azul, M');
  assert.equal(rotuloVariacao({ atributos: {}, padrao: true }), 'Padrão');
  assert.deepEqual(variacoesRepetidas([{ Cor: 'Azul' }, { cor: ' azul' }, { Cor: 'Preta' }]), [1]);
});

test('faixa de preço só com variações ativas', () => {
  assert.equal(faixaDePreco([{ preco_centavos: 4990 }, { preco_centavos: 5490 }, { preco_centavos: 100, ativo: false }]), 'R$ 49,90 a R$ 54,90');
  assert.equal(faixaDePreco([{ preco_centavos: 350 }]), 'R$ 3,50');
  assert.equal(faixaDePreco([]), '');
});
