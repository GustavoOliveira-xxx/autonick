/**
 * Gera as capturas de tela do manifesto (M13, D13-02): página inicial pública, sem login e sem dados de ninguém.
 * Uso: node scripts/gerar-capturas-manifesto.mjs  (sobe o servidor local na porta 4190 e fecha no fim)
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORTA = 4190;
const srv = spawn(process.execPath, ['scripts/servidor-local.mjs'], { env: { ...process.env, PORTA: String(PORTA) }, stdio: 'ignore' });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORTA}/`)).ok) break; } catch { /* ainda subindo */ }
    await espera(200);
  }
  const navegador = await chromium.launch();
  for (const [nome, largura, altura] of [['inicio-estreita', 540, 1200], ['inicio-larga', 1280, 800]]) {
    const pagina = await navegador.newPage({ viewport: { width: largura, height: altura }, deviceScaleFactor: 1, locale: 'pt-BR' });
    await pagina.goto(`http://127.0.0.1:${PORTA}/`);
    await pagina.waitForLoadState('networkidle');
    await pagina.screenshot({ path: `public/assets/capturas/${nome}.png` });
    await pagina.close();
  }
  await navegador.close();
} finally {
  srv.kill();
}
