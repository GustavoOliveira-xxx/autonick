/** UI-055: aviso de falta de conexão (RF-192, RNF-033). */
import { iniciarLayout } from '../ui/layout.js';

iniciarLayout();
document.getElementById('tentar-novamente')?.addEventListener('click', () => {
  location.reload();
});
