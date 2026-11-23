/** Ajuda (M13): abre também sem conexão (D13-04); orientação de instalação (D13-02) e versão do app (D13-03). */
import { iniciarLayout } from '../ui/layout.js';
import { secaoInstalacao } from '../ui/instalacao.js';
import { VERSAO_APP } from '../versao.js';

iniciarLayout();
document.getElementById('ajuda-instalacao')?.replaceWith(secaoInstalacao({ id: 'instalacao' }));
const versao = document.getElementById('versao-app');
if (versao) versao.textContent = `Versão ${VERSAO_APP} (desenvolvimento).`;
