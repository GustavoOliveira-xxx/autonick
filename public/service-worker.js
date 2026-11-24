/*
 * Service worker do AutoniCK (RF-191, ARQ-001 §14, OPS-I11).
 *
 * Regras:
 *  - guarda SOMENTE arquivos estáticos versionados listados em ARQUIVOS;
 *  - nunca guarda respostas de API, autenticação, dados privados ou
 *    qualquer recurso de outra origem;
 *  - páginas HTML vêm sempre da rede; sem conexão, mostra offline.html
 *    (nenhuma operação é simulada offline, RNF-033, FCT-092);
 *  - M13 (D13-04): a Ajuda é a única página de conteúdo que abre sem conexão
 *    (texto fixo, sem dado de ninguém); conversas, dados privados, relatórios
 *    e PDFs nunca entram no cache.
 */
const VERSAO = 'autonick-estatico-v0.16.0';  // Evolução integrada: navegação viva, tema claro revisado e símbolo capacete-sino

// Páginas que abrem sem conexão (a rede tem prioridade; o cache é só reserva).
const PAGINAS_SEM_CONEXAO = ['/ajuda.html'];

const ARQUIVOS = [
  '/offline.html',
  '/ajuda.html',
  '/js/features/ajuda.js',
  '/js/versao.js',
  '/js/ui/conexao.js',
  '/js/ui/instalacao.js',
  '/manifest.webmanifest',
  '/css/tokens.css',
  '/css/reset.css',
  '/css/base.css',
  '/css/componentes.css',
  '/css/forja.css',
  '/js/features/offline.js',
  '/js/ui/layout.js',
  '/js/ui/navegacao-viva.js',
  '/js/tema-inicial.js',
  '/assets/brand/autonick-capacete-sino.svg',
  '/js/ui/dom.js',
  '/js/ui/notificacoes.js',
  '/js/ui/sw-registro.js',
  '/js/core/contexto-empresa.js',
  '/js/ui/menu-empresa.js',
  '/assets/icons/icones.svg',
  '/assets/brand/autonick-geral-320.webp',
  '/assets/brand/autonick-empresarial-320.webp',
  '/assets/fonts/ibm-plex-sans-latin-400-normal.woff2',
  '/assets/fonts/ibm-plex-sans-latin-600-normal.woff2',
  '/assets/fonts/ibm-plex-sans-latin-700-normal.woff2',
  '/assets/fonts/barlow-condensed-latin-800-normal.woff2',
  '/assets/fonts/barlow-condensed-latin-800-italic.woff2',
  '/assets/fonts/ibm-plex-mono-latin-400-normal.woff2',
  '/assets/fonts/atkinson-hyperlegible-latin-400-normal.woff2',
  '/assets/fonts/atkinson-hyperlegible-latin-700-normal.woff2',
  '/assets/icons/favicon-32.png',
  '/assets/icons/icone-180.png',
  '/assets/icons/icone-192.png',
  '/assets/icons/icone-512.png',
  '/assets/forja/sino-mini.webp',
  '/assets/forja/etiqueta-ck.webp',
  '/assets/forja/selo-ck.webp',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(VERSAO).then((cache) => cache.addAll(ARQUIVOS)));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((nome) => nome !== VERSAO).map((nome) => caches.delete(nome))),
    ),
  );
});

self.addEventListener('message', (evento) => {
  if (evento.data?.tipo === 'ATIVAR_AGORA') self.skipWaiting();
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;

  if (pedido.mode === 'navigate') {
    if (PAGINAS_SEM_CONEXAO.includes(url.pathname)) {
      evento.respondWith(fetch(new Request(pedido, { cache: 'no-store' }))
        .then((resposta) => {
          if (resposta.ok) {
            const copia = resposta.clone();
            evento.waitUntil(caches.open(VERSAO).then((cache) => cache.put(url.pathname, copia)));
          }
          return resposta;
        })
        .catch(() => caches.match(url.pathname).then((guardada) => guardada ?? caches.match('/offline.html'))));
      return;
    }
    // Sem o cache HTTP do navegador: sem conexão, nenhuma página com login abre de cópia antiga.
    evento.respondWith(fetch(new Request(pedido, { cache: 'no-store' })).catch(() => caches.match('/offline.html')));
    return;
  }

  if (ARQUIVOS.includes(url.pathname)) {
    evento.respondWith(caches.match(url.pathname).then((guardado) => guardado ?? fetch(pedido)));
  }
  // Demais pedidos seguem direto para a rede, sem cache.
});
