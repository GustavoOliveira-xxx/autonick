/** Direção CK Forja Noturna: tema escuro padrão com opção clara, indicador F14 só durante a operação e momentos só depois do evento. */
import { test, expect } from '@playwright/test';

const luminancia = (cor) => {
  const [r, g, b] = cor.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

test('tema escuro por padrão; o botão troca para o claro, a escolha fica guardada e volta ao escuro', async ({ page }) => {
  await page.goto('/ajuda.html');
  const fundo = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(luminancia(await fundo())).toBeLessThan(0.2);
  const botao = page.locator('button[data-tema]');
  await expect(botao).toHaveAttribute('aria-pressed', 'false');
  await botao.click();
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'claro');
  await expect(botao).toHaveAttribute('aria-pressed', 'true');
  expect(luminancia(await fundo())).toBeGreaterThan(0.8);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'claro');
  await page.locator('button[data-tema]').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-tema', 'claro');
});

test('F14: o contorno só aparece em operação que passa do limiar e some quando ela termina', async ({ page }) => {
  await page.goto('/ajuda.html');
  const r = await page.evaluate(async () => {
    const { ocupado } = await import('/js/ui/formulario.js');
    const botao = Object.assign(document.createElement('button'), { type: 'submit', className: 'botao', textContent: 'Salvar' });
    document.body.append(botao);
    let apareceuRapida = false;
    const obs = new MutationObserver(() => { if (botao.querySelector('.contorno-corre')) apareceuRapida = true; });
    obs.observe(botao, { childList: true });
    await ocupado(botao, () => new Promise((ok) => setTimeout(ok, 30)));
    obs.disconnect();
    let durante = null;
    await ocupado(botao, () => new Promise((ok) => setTimeout(() => {
      durante = { contorno: Boolean(botao.querySelector('.contorno-corre')), sino: Boolean(botao.querySelector('.sininho-salvando')), ocupado: botao.getAttribute('aria-busy') };
      ok();
    }, 400)));
    const depois = { contorno: Boolean(botao.querySelector('.contorno-corre')), sino: Boolean(botao.querySelector('.sininho-salvando')), desabilitado: botao.disabled };
    botao.remove();
    return { apareceuRapida, durante, depois };
  });
  expect(r.apareceuRapida).toBe(false);
  expect(r.durante).toEqual({ contorno: true, sino: true, ocupado: 'true' });
  expect(r.depois).toEqual({ contorno: false, sino: false, desabilitado: false });
});

test('momentos 3D: nenhum aparece sozinho; quando montados, são decorativos e não recebem foco', async ({ page }) => {
  await page.goto('/ajuda.html');
  await expect(page.locator('.momento-3d')).toHaveCount(0);
  const r = await page.evaluate(async () => {
    const { montarMomento } = await import('/js/ui/forja3d/momentos.js');
    const lugar = document.createElement('div'); document.body.append(lugar);
    const m = montarMomento(lugar, 'IB06', { tamanho: 'p' });
    const el = m.elemento;
    const info = { oculto: el.getAttribute('aria-hidden'), focaveis: el.querySelectorAll('a, button, input, [tabindex]').length };
    m.destruir();
    return { ...info, removido: !el.isConnected };
  });
  expect(r).toEqual({ oculto: 'true', focaveis: 0, removido: true });
});

test('movimento reduzido: indicadores da forja sem animação', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ajuda.html');
  const r = await page.evaluate(() => {
    const botao = Object.assign(document.createElement('button'), { className: 'botao botao--processando', textContent: 'x' });
    botao.innerHTML = '<svg class="contorno-corre"><rect pathLength="100"></rect></svg><span class="sininho-salvando"></span>';
    document.body.append(botao);
    const nomes = (s) => getComputedStyle(botao.querySelector(s)).animationName;
    const out = { rect: nomes('.contorno-corre rect'), sino: nomes('.sininho-salvando') };
    botao.remove();
    return out;
  });
  expect(r.rect).toBe('none');
  expect(r.sino).toBe('none');
});
