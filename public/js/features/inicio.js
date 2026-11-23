/** Páginas simples: início, entrada Business, ajuda e área restrita. */
import { iniciarLayout } from '../ui/layout.js';

iniciarLayout();

// Página de apresentação: o sino 3D é um componente à parte, carregado depois do texto e dos botões.
// Se o módulo não carregar, a imagem estática do HTML continua no lugar.
const sino = document.querySelector('[data-heroi-sino]');
if (sino) {
  import('../ui/sino-hq/heroi-sino.js')
    .then(({ montarHeroiSino }) => montarHeroiSino(sino))
    .catch((erro) => console.warn('Sino 3D indisponível; a imagem estática continua no lugar.', erro));
}
