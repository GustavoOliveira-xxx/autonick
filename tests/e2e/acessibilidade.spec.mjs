/**
 * Verificação automática com axe (WCAG 2.0/2.1/2.2 A e AA, meta oficial
 * pela ADR-G01). Não substitui avaliação manual nem testes com pessoas.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PAGINAS, escolherEmpresa } from './paginas.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const largura of [375, 1440]) {
  for (const caminho of PAGINAS) {
    test(`axe sem violações em ${largura}px: ${caminho}`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      await escolherEmpresa(page);
      await page.goto(caminho);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      const resultado = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const resumo = resultado.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(resumo).toEqual([]);
    });
  }
}
