/**
 * Instância única do cliente de dados, conforme o backend escolhido EXPLICITAMENTE na configuração pública:
 * Neon (Auth + Data API) ou API Java (mesmo contrato de pedidos e respostas, em /api/auth e /api/dados).
 * Um backend desconhecido deixa o acesso desligado: nunca há volta silenciosa para outro backend.
 */
import { ClienteNeon } from './neon-cliente.js';
import { CONFIG_PUBLICA } from '../config/public-config.js';

export const BACKENDS = Object.freeze(['neon', 'java-local', 'java-online']);

export function enderecosDoBackend(config = CONFIG_PUBLICA) {
  const backend = config?.backend ?? 'neon';
  if (!BACKENDS.includes(backend)) return { backend, authUrl: null, dataApiUrl: null };
  if (backend === 'neon') return { backend, authUrl: config.neonAuthUrl ?? null, dataApiUrl: config.neonDataApiUrl ?? null };
  const base = typeof config.apiJava === 'string' ? config.apiJava.replace(/\/+$/, '') : '/api';
  return { backend, authUrl: `${base}/auth`, dataApiUrl: `${base}/dados` };
}

const enderecos = enderecosDoBackend();

export const backendAtivo = enderecos.backend;

export const neon = new ClienteNeon({ authUrl: enderecos.authUrl, dataApiUrl: enderecos.dataApiUrl });

// Demonstração (dados fictícios): faixa em todas as telas que usam dados.
if (CONFIG_PUBLICA.demonstracao?.ativa && typeof document !== 'undefined') {
  import('../ui/demonstracao.js').then((m) => m.mostrarFaixaDemonstracao()).catch(() => {});
}
