/**
 * Retorno interno depois do login (M10, D10-13): só caminhos da própria área do Cliente, nunca endereço externo,
 * caminho relativo ao protocolo (`//`), barra invertida ou subida de pasta. Qualquer outro valor é ignorado.
 */
export function destinoSeguro(volta, area) {
  if (typeof volta !== 'string' || area !== 'cliente') return null;
  if (!/^\/cliente\/[A-Za-z0-9._~\-/?=&%]*$/.test(volta) || volta.startsWith('//') || volta.includes('\\') || volta.includes('..')) return null;
  return volta;
}

/** Endereço da entrada do Cliente que volta para `destino` depois do login. */
export const entrarEVoltar = (destino) => `/cliente/entrar.html?volta=${encodeURIComponent(destino)}`;
