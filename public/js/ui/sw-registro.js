/**
 * Registro do service worker (RF-191) e aviso de nova versão (OPS-I11; M13, D13-03).
 * - A nova versão só entra quando a pessoa toca em "Atualizar" nesta aba; nada recarrega sozinho.
 * - Se outra aba ativar a nova versão, esta aba só avisa (não recarrega um formulário em uso).
 * - Procura nova versão ao abrir e ao voltar para a aba.
 * O service worker guarda só arquivos estáticos do app; nunca dados.
 */
import { notificar } from './notificacoes.js';

let pediuAtualizacao = false;
let avisoMostrado = false;

function avisarNovaVersao(trabalhador) {
  if (avisoMostrado || !trabalhador) return;
  avisoMostrado = true;
  notificar('Há uma nova versão do AutoniCK.', {
    acao: {
      rotulo: 'Atualizar',
      aoClicar: () => {
        pediuAtualizacao = true;
        trabalhador.postMessage({ tipo: 'ATIVAR_AGORA' });
      },
    },
  });
}

export function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const registro = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      if (registro.waiting && navigator.serviceWorker.controller) avisarNovaVersao(registro.waiting);
      registro.addEventListener('updatefound', () => {
        const novo = registro.installing;
        novo?.addEventListener('statechange', () => {
          if (novo.state === 'installed' && navigator.serviceWorker.controller) avisarNovaVersao(novo);
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registro.update().catch(() => {});
      });
      let tratado = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (tratado) return;
        tratado = true;
        if (pediuAtualizacao) {
          location.reload();
          return;
        }
        notificar('O AutoniCK foi atualizado em outra janela. Atualize esta página quando terminar o que está fazendo.', {
          acao: { rotulo: 'Atualizar a página', aoClicar: () => location.reload() },
        });
      });
    } catch {
      // Sem service worker, o app continua funcionando online.
    }
  });
}
