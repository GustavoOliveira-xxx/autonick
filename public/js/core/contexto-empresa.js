/**
 * Empresa ativa da área Business (M13b; RF-014, UC-005).
 *
 * Guarda na sessão desta aba só o que o menu e o cabeçalho precisam: identificador, nome público, papel e a lista de
 * permissões lida do banco na última tela aberta. É conveniência de interface: cada tela confere de novo a permissão no
 * banco, e o banco decide cada operação (ARQ-001 §5). Fechar a aba apaga tudo. Trocar de empresa avisa os ouvintes.
 */
const CHAVE = 'autonick.empresaAtiva';
const ouvintes = new Set();
let emMemoria = null;

function armazenamento() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Devolve { id, nome, papel, permissoes, dado_de_teste } ou null. */
export function obterEmpresaAtiva() {
  try {
    const bruto = armazenamento()?.getItem(CHAVE);
    if (bruto) return JSON.parse(bruto);
  } catch {
    // Armazenamento indisponível ou conteúdo antigo: segue com a memória.
  }
  return emMemoria;
}

export function definirEmpresaAtiva(empresa) {
  const anterior = obterEmpresaAtiva();
  const atual = empresa ? {
    id: String(empresa.id),
    nome: empresa.nome ?? null,
    papel: empresa.papel ?? null,
    permissoes: Array.isArray(empresa.permissoes) ? [...empresa.permissoes] : null,
    dado_de_teste: Boolean(empresa.dado_de_teste),
  } : null;
  emMemoria = atual;
  try {
    const s = armazenamento();
    if (s) {
      if (atual) s.setItem(CHAVE, JSON.stringify(atual)); else s.removeItem(CHAVE);
    }
  } catch {
    // Janela privada sem armazenamento: fica só em memória.
  }
  if (JSON.stringify(anterior) !== JSON.stringify(atual)) for (const o of ouvintes) o({ anterior, atual });
}

export const limparEmpresaAtiva = () => definirEmpresaAtiva(null);

export function aoTrocarEmpresa(ouvinte) {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}
