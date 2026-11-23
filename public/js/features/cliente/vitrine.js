/**
 * UI-005 e UI-006: perfil público de empresa aprovada (RF-151, RF-152, RF-153; M10).
 * Só a versão aprovada e os itens que a empresa publicou (D10-03 = C, D10-04 = B); nunca estoque, custos, regras de
 * preço ou dados privados. Link pelo UUID; indisponível e inexistente têm a mesma resposta (D10-11).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { iniciarPerfil } from './vitrine-tela.js';

iniciarLayout();
iniciarPerfil('publico');
