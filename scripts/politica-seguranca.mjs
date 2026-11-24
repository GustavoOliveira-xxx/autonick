/**
 * Política de segurança dos cabeçalhos HTTP, compartilhada pelo servidor local e pelas montagens estáticas da PWA.
 * Uma só fonte: qualquer montagem usa exatamente a mesma CSP já testada localmente, só com as origens públicas do
 * provedor de autenticação e dados do ambiente escolhido.
 */

/** CSP com as origens públicas do Neon (Auth e Data API) do ambiente; `extra` só para testes locais. */
export function montarCsp(origensNeon = [], extra = '') {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${origensNeon.length ? ` ${origensNeon.join(' ')}` : ''}${extra ? ` ${extra}` : ''}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Cabeçalhos fixos (além do Content-Type), iguais no servidor local e na prévia. */
export const CABECALHOS_FIXOS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
});

/** Origens (esquema + host) das URLs públicas do Neon de um ambiente. */
export const origensDoAmbiente = (amb) => (amb ? [amb.neonAuthUrl, amb.neonDataApiUrl].filter(Boolean).map((u) => new URL(u).origin) : []);
