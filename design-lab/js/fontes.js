// Fontes locais do AutoniCK (licença OFL), carregadas por FontFace a partir de public/assets/fonts.
const F = (familia, arquivo, desc = {}) => ({ familia, url: new URL(`../public/assets/fonts/${arquivo}`, import.meta.url).href, desc });
const LISTA = [
  F('IBM Plex Sans', 'ibm-plex-sans-latin-400-normal.woff2', { weight: '400' }),
  F('IBM Plex Sans', 'ibm-plex-sans-latin-600-normal.woff2', { weight: '600' }),
  F('IBM Plex Sans', 'ibm-plex-sans-latin-700-normal.woff2', { weight: '700' }),
  F('Barlow Condensed', 'barlow-condensed-latin-800-normal.woff2', { weight: '800' }),
  F('Barlow Condensed', 'barlow-condensed-latin-800-italic.woff2', { weight: '800', style: 'italic' }),
  F('IBM Plex Mono', 'ibm-plex-mono-latin-400-normal.woff2', { weight: '400' }),
];
export async function carregarFontes() {
  await Promise.all(LISTA.map(async ({ familia, url, desc }) => {
    try { const r = await fetch(url); if (!r.ok) return; const f = new FontFace(familia, await r.arrayBuffer(), desc); await f.load(); document.fonts.add(f); } catch { /* segue com a fonte reserva */ }
  }));
}
