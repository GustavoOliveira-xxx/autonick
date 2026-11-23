/**
 * Criação segura de elementos. Textos entram sempre como nós de texto,
 * nunca como HTML, para evitar injeção (DEV-001 §8, XSS).
 */
export function el(tag, atributos = {}, ...filhos) {
  const elemento = document.createElement(tag);
  for (const [nome, valor] of Object.entries(atributos)) {
    if (valor === false || valor === null || valor === undefined) continue;
    if (nome === 'class') elemento.className = valor;
    else if (nome === 'dataset') Object.assign(elemento.dataset, valor);
    else if (nome.startsWith('on') && typeof valor === 'function') elemento.addEventListener(nome.slice(2), valor);
    else elemento.setAttribute(nome, valor === true ? '' : String(valor));
  }
  for (const filho of filhos.flat()) {
    if (filho === null || filho === undefined || filho === false) continue;
    elemento.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  return elemento;
}

export function limpar(container) {
  container.replaceChildren();
  return container;
}

/** Lê um parâmetro da URL atual. */
export function parametro(nome) {
  return new URLSearchParams(location.search).get(nome);
}
