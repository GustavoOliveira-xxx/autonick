/**
 * Cálculos de estoque para exibição (FIN-001 §2, RN-012, RF-060).
 *
 * Estes cálculos são PRÉVIAS de interface. A disponibilidade com
 * autoridade, a reserva e a baixa acontecem no banco, em transação
 * com trava e idempotência (BDD-001 §7, FIN-I08). Nada aqui altera
 * estoque.
 */

function exigirQuantidade(valor, nome) {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new RangeError(`${nome} deve ser um número inteiro maior ou igual a zero.`);
  }
}

/**
 * disponível = físico - reservas válidas (reserva não reduz o físico).
 * @param {{fisico: number, reservado: number}} saldo
 * @returns {number}
 */
export function calcularDisponivel({ fisico, reservado }) {
  exigirQuantidade(fisico, 'Estoque físico');
  exigirQuantidade(reservado, 'Quantidade reservada');
  if (reservado > fisico) {
    throw new RangeError('Reservas maiores que o estoque físico indicam inconsistência; verificar no servidor.');
  }
  return fisico - reservado;
}

/**
 * Prévia de reserva: indica se a quantidade cabe no disponível mostrado.
 * O servidor pode recusar mesmo quando a prévia diz que cabe (FIN-001 §2).
 * @param {number} disponivel
 * @param {number} quantidade
 * @param {{sobEncomenda?: boolean}} [opcoes]
 */
export function previaReserva(disponivel, quantidade, { sobEncomenda = false } = {}) {
  exigirQuantidade(disponivel, 'Disponível');
  if (!Number.isSafeInteger(quantidade) || quantidade <= 0) {
    return { cabe: false, motivo: 'Informe uma quantidade inteira maior que zero.' };
  }
  if (quantidade <= disponivel || sobEncomenda) {
    return { cabe: true, motivo: null };
  }
  return { cabe: false, motivo: 'Não há unidades disponíveis suficientes para concluir.' };
}

/**
 * Resume as variações de um produto. O estoque mínimo é definido por
 * produto (P156, RF-057; resolução C-07).
 * @param {{estoqueMinimo: number|null, variacoes: {fisico: number, reservado: number}[]}} produto
 */
export function resumirProduto(produto) {
  let fisico = 0;
  let reservado = 0;
  for (const variacao of produto.variacoes) {
    calcularDisponivel(variacao);
    fisico += variacao.fisico;
    reservado += variacao.reservado;
  }
  const disponivel = fisico - reservado;
  const minimo = produto.estoqueMinimo;
  const abaixoDoMinimo = Number.isSafeInteger(minimo) ? disponivel < minimo : false;
  return { fisico, reservado, disponivel, abaixoDoMinimo };
}
