/**
 * UI-002 e UI-004: busca do Cliente em lista (RF-141 a RF-146, RF-148, RF-150; M10). No M11 (D11-04), para quem está
 * logado, a mesma página mostra também "Precisa da sua ação" com as pendências da própria conta.
 * Rota pública: o conjunto é fixo ("publico") e nenhum parâmetro de URL inclui dados fictícios (D10-14).
 * Sem mapa e sem GPS nesta versão (D10-09, D10-10: RF-147 e RF-149 parcialmente atendidos).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { iniciarBusca } from './vitrine-tela.js';
import { mostrarMinhaAcao } from './minha-acao.js';
import { iniciarIntroducao, alinharFocoDaCapa } from './introducao.js';

iniciarLayout();
iniciarBusca('publico');
mostrarMinhaAcao(document.getElementById('minha-acao'));
iniciarIntroducao();
alinharFocoDaCapa();
