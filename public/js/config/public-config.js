/**
 * Configuração PÚBLICA do AutoniCK (OPS-001 §3).
 *
 * `backend` escolhe, de forma explícita, quem atende a autenticação e os dados (sem volta automática para outro):
 *  - 'neon': Neon Managed Better Auth e Neon Data API (URLs públicas abaixo);
 *  - 'java-local': API Java (Spring Boot) na mesma origem, na demonstração local;
 *  - 'java-online': API Java publicada, na mesma origem pela reescrita /api da hospedagem.
 * Com a API Java, este arquivo é gerado pela própria API (ou pela montagem da hospedagem) com os caminhos /api.
 *
 * NUNCA colocar DATABASE_URL, senhas, chaves de API ou credenciais de storage.
 * Valores nulos: o serviço ainda não foi habilitado; as telas de login informam que o acesso ainda não está
 * disponível e nada é enviado.
 */
export const CONFIG_PUBLICA = Object.freeze({
  ambiente: 'local',
  backend: 'neon',
  neonAuthUrl: null,
  neonDataApiUrl: null,
});
