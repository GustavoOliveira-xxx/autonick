/**
 * Instalação da PWA (M13, D13-02; RF-191, RNF-032).
 * - Chrome e Edge: quando o navegador oferecer o fluxo (`beforeinstallprompt`), um botão "Instalar o AutoniCK".
 * - Sem o botão: a orientação que vale para o aparelho (iPhone pelo Safari, Android, computador).
 * - Já instalado: avisa e esconde o convite.
 * Nunca abre janela que interrompe a pessoa; o convite fica só na Ajuda e em Minha conta.
 */
import { el } from './dom.js';

let convite = null;
let instaladoAgora = false;
const ouvintes = new Set();
const avisar = () => { for (const f of ouvintes) f(); };

/** Guarda o convite do navegador para usar quando a pessoa tocar no botão. Chamada pelo layout em todas as páginas. */
export function capturarInstalacao() {
  if (globalThis.__autonickInstalacao) return;
  globalThis.__autonickInstalacao = true;
  window.addEventListener('beforeinstallprompt', (evento) => {
    evento.preventDefault();
    convite = evento;
    avisar();
  });
  window.addEventListener('appinstalled', () => {
    convite = null;
    instaladoAgora = true;
    avisar();
  });
}

export function abertoComoApp(janela = globalThis) {
  return Boolean(janela.matchMedia?.('(display-mode: standalone)').matches || janela.navigator?.standalone === true);
}

/** Qual orientação mostrar. Função pura, testada na unidade. */
export function orientacao({ instalado, temConvite, agente = '', pontosDeToque = 0 }) {
  if (instalado) return 'instalado';
  if (temConvite) return 'botao';
  const ios = /iPhone|iPad|iPod/.test(agente) || (/Macintosh/.test(agente) && pontosDeToque > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(agente) ? 'ios-outro' : 'ios-safari';
  if (/Android/.test(agente)) return 'android';
  return 'computador';
}

export const TEXTOS_INSTALACAO = {
  instalado: 'O AutoniCK já está instalado e aberto como aplicativo neste aparelho.',
  botao: 'Instale o AutoniCK para abrir pela tela inicial ou pelo menu do computador, como um aplicativo. As operações continuam precisando de internet.',
  'ios-outro': 'No iPhone e no iPad, a instalação é feita pelo Safari. Abra este mesmo endereço no Safari e siga os passos que vão aparecer aqui.',
  android: 'No Android, abra o menu do Chrome (os três pontinhos) e escolha "Instalar app" ou "Adicionar à tela inicial". Se a opção não aparecer, o navegador ainda não liberou a instalação deste endereço.',
  computador: 'No computador, use o Chrome ou o Edge. Quando o navegador liberar a instalação, o botão "Instalar o AutoniCK" aparece aqui; você também pode usar o ícone de instalar na barra de endereço.',
};

function conteudo(tipo, redesenhar) {
  if (tipo === 'botao') {
    const b = el('button', { type: 'button', class: 'botao', id: 'instalar-app' }, 'Instalar o AutoniCK');
    b.addEventListener('click', async () => {
      const atual = convite;
      if (!atual) return redesenhar();
      convite = null;
      await atual.prompt();
      const escolha = await atual.userChoice.catch(() => null);
      redesenhar();
      document.getElementById('instalacao-resultado')?.replaceChildren(escolha?.outcome === 'accepted'
        ? 'O navegador está instalando o AutoniCK. O ícone aparece na tela inicial ou no menu quando terminar.'
        : 'Instalação cancelada. Você pode instalar depois, por aqui ou pelo menu do navegador.');
    });
    return [el('p', {}, TEXTOS_INSTALACAO.botao), b];
  }
  if (tipo === 'ios-safari') {
    return [
      el('p', {}, 'No iPhone e no iPad, pelo Safari:'),
      el('ol', { class: 'instalacao__passos', id: 'passos-iphone' },
        el('li', {}, 'Toque no botão Compartilhar (o quadrado com uma seta para cima).'),
        el('li', {}, 'Escolha "Adicionar à Tela de Início".'),
        el('li', {}, 'Toque em "Adicionar". O ícone do AutoniCK aparece na tela inicial.')),
      el('p', {}, 'As operações continuam precisando de internet.'),
    ];
  }
  return [el('p', { id: 'instalacao-orientacao' }, TEXTOS_INSTALACAO[tipo])];
}

/** Seção "Instalar o aplicativo" para a Ajuda e Minha conta. */
export function secaoInstalacao({ id = 'instalacao', nivel = 'h2' } = {}) {
  const corpo = el('div', { class: 'pilha', id: `${id}-corpo` });
  const redesenhar = () => {
    const tipo = orientacao({ instalado: instaladoAgora || abertoComoApp(), temConvite: Boolean(convite),
      agente: navigator.userAgent, pontosDeToque: navigator.maxTouchPoints ?? 0 });
    corpo.dataset.orientacao = tipo;
    corpo.replaceChildren(...conteudo(tipo, redesenhar));
  };
  ouvintes.add(redesenhar);
  redesenhar();
  // O resultado fica fora do corpo para continuar visível depois que o convite some.
  return el('section', { class: 'pilha', id, 'aria-labelledby': `${id}-titulo` },
    el(nivel, { id: `${id}-titulo` }, 'Instalar o aplicativo'), corpo, el('p', { id: 'instalacao-resultado', role: 'status' }));
}
