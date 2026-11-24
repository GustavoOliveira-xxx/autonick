// Estado do laboratório: escolhas por categoria, favoritas, observações e a montagem do combinador.
// Fica só no navegador (localStorage). Nada vai para o banco do AutoniCK nem para servidor algum.
// Se o armazenamento não estiver disponível (janela privada, bloqueio), tudo funciona e só não é lembrado.

const CHAVE = 'autonick-design-lab-v1';

/** Configuração em tempo de execução da bancada (não é salva). */
export const RUNTIME = { reduzido: false, reduzidoSistema: false, pausado: false, velocidade: 1, intensidade: 1, laco: true };

function vazio() {
  return { versao: 1, escolhas: {}, favoritos: [], notas: {}, combinador: null, loadersPorContexto: {}, intensidadeE: 2, atualizado: null };
}
function ler() {
  try { const t = localStorage.getItem(CHAVE); if (!t) return vazio(); const d = JSON.parse(t); return { ...vazio(), ...d }; } catch { return vazio(); }
}
const ouvintes = new Set();
export const loja = {
  d: ler(),
  persistente: (() => { try { localStorage.setItem(CHAVE + ':t', '1'); localStorage.removeItem(CHAVE + ':t'); return true; } catch { return false; } })(),
  salvar() { this.d.atualizado = new Date().toISOString(); try { localStorage.setItem(CHAVE, JSON.stringify(this.d)); } catch { /* sem armazenamento: segue na memória */ } for (const f of ouvintes) f(this.d); },
  ouvir(f) { ouvintes.add(f); return () => ouvintes.delete(f); },
  escolher(cat, id) { if (this.d.escolhas[cat] === id) delete this.d.escolhas[cat]; else this.d.escolhas[cat] = id; this.salvar(); },
  escolhida: (cat) => loja.d.escolhas[cat] ?? null,
  favoritar(id) { const i = this.d.favoritos.indexOf(id); if (i >= 0) this.d.favoritos.splice(i, 1); else this.d.favoritos.push(id); this.salvar(); },
  favorita: (id) => loja.d.favoritos.includes(id),
  anotar(cat, texto) { this.d.notas[cat] = texto; this.salvar(); },
  importar(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('O conteúdo colado não é um JSON de escolhas.');
    const base = vazio();
    for (const k of Object.keys(base)) if (k in obj) base[k] = obj[k];
    if (obj.escolhas && typeof obj.escolhas !== 'object') throw new Error('Campo "escolhas" inválido.');
    this.d = base; this.salvar();
  },
  zerar() { this.d = vazio(); this.salvar(); },
};
