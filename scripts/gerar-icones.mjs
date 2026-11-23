/**
 * Gera os ícones PNG PROVISÓRIOS da PWA (ADR-G02, M3 = B).
 *
 * Ícone neutro, sem o personagem das logos: quadrado escuro, anel
 * dourado e as letras "AK" na fonte Atkinson Hyperlegible (OFL).
 * Não deriva da arte original e não pretende ser marca oficial.
 *
 * Uso: npm run icones   (requer Chromium do Playwright)
 */
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const fonte = (await readFile(`${raiz}public/assets/fonts/atkinson-hyperlegible-latin-700-normal.woff2`)).toString('base64');

function svg({ mascaravel }) {
  // Ícone "maskable" mantém o conteúdo na zona segura central (80%).
  const escala = mascaravel ? 0.72 : 1;
  const deslocamento = (512 - 512 * escala) / 2;
  const fundo = mascaravel
    ? '<rect width="512" height="512" fill="#17121f"/>'
    : '<rect width="512" height="512" rx="104" fill="#17121f"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    ${fundo}
    <g transform="translate(${deslocamento} ${deslocamento}) scale(${escala})">
      <circle cx="256" cy="256" r="178" fill="none" stroke="#f2b705" stroke-width="22"/>
      <text x="256" y="300" text-anchor="middle" font-family="AK" font-weight="700" font-size="168" fill="#ffffff" letter-spacing="4">AK</text>
    </g>
  </svg>`;
}

const pagina = (conteudo) => `<!doctype html><html><head><style>
  @font-face { font-family: "AK"; src: url(data:font/woff2;base64,${fonte}) format("woff2"); font-weight: 700; }
  html, body { margin: 0; background: transparent; }
  svg { display: block; width: 100vw; height: 100vh; }
</style></head><body>${conteudo}</body></html>`;

const saidas = [
  ['favicon-32.png', 32, false],
  ['icone-180.png', 180, false],
  ['icone-192.png', 192, false],
  ['icone-512.png', 512, false],
  ['icone-maskable-512.png', 512, true],
];

const navegador = await chromium.launch();
for (const [nome, tamanho, mascaravel] of saidas) {
  const p = await navegador.newPage({ viewport: { width: tamanho, height: tamanho } });
  await p.setContent(pagina(svg({ mascaravel })));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${raiz}public/assets/icons/${nome}`, omitBackground: true });
  await p.close();
  console.log('gerado', nome);
}
await navegador.close();
