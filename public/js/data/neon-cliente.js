/**
 * Cliente HTTP mínimo para Neon Managed Better Auth e Neon Data API (M02).
 *
 * Decisão técnica (resolução C-16): chamadas HTTP diretas, sem SDK npm,
 * para manter a PWA sem etapa de build. Endpoints conforme a documentação
 * oficial do Neon consultada em 01/11/2026:
 *  - Auth: POST /sign-up/email, POST /sign-in/email, POST /sign-out,
 *          GET /get-session (JWT no cabeçalho `set-auth-jwt`),
 *          POST /email-otp/request-password-reset e /email-otp/reset-password
 *          (recuperação por código), POST /change-password (troca com sessão);
 *  - Data API (PostgREST): GET /perfis_identidade, POST /rpc/garantir_perfil.
 *
 * Segurança (ARQ-001 §14, SEC-001):
 *  - a sessão é um cookie HttpOnly do Neon Auth (credentials: 'include');
 *  - o JWT de 15 minutos fica só em memória, nunca em localStorage;
 *  - mensagens de erro são neutras e não revelam se um e-mail existe (SEC-T22);
 *  - toda autorização acontece no banco (RLS); este módulo não decide acesso.
 */

export class ErroNeon extends Error {
  constructor(codigo, mensagem, status = null, campo = null) {
    super(mensagem);
    this.name = 'ErroNeon';
    this.codigo = codigo;
    this.status = status;
    /** Campo do formulário apontado pelo banco (VALIDATION_ERROR), quando houver. */
    this.campo = campo;
  }
}

const MENSAGENS = {
  NAO_CONFIGURADO: 'O acesso com e-mail e senha ainda não está disponível nesta versão.',
  AUTH_REQUIRED: 'Sua sessão terminou. Entre novamente.',
  CREDENCIAIS: 'E-mail ou senha incorretos.',
  CADASTRO: 'Não foi possível criar a conta com esses dados. Se você já tem conta, entre ou recupere a senha.',
  FORBIDDEN_ACTION: 'Seu perfil não permite esta ação.',
  VALIDATION_ERROR: 'Confira os dados informados.',
  RATE_LIMITED: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
  PROVIDER_UNAVAILABLE: 'O serviço está indisponível no momento. Tente novamente em instantes.',
  NETWORK_UNKNOWN: 'Não conseguimos falar com o servidor. Verifique sua conexão.',
  // M13 (D13-06): sem conexão nada sai; com a conexão caindo depois do envio, não dizemos que foi salvo.
  SEM_CONEXAO_ENVIO: 'Sem conexão. Nada foi enviado.',
  SEM_CONEXAO_LEITURA: 'Sem conexão. Não foi possível carregar as informações agora.',
  ENVIO_SEM_CONFIRMACAO: 'Não conseguimos confirmar se a operação foi registrada. Quando a conexão voltar, confira a lista antes de tentar de novo. Repetir pelo mesmo botão não duplica.',
  EMAIL_NAO_VERIFICADO: 'Confirme seu e-mail para entrar. Enviamos um código para o endereço cadastrado.',
  CODIGO_INVALIDO: 'Código incorreto ou expirado. Confira o código ou peça um novo.',
  SENHA_FRACA: 'A nova senha precisa ter de 8 a 128 caracteres.',
  SENHA_ATUAL_INCORRETA: 'A senha atual não confere.',
  TENANT_FORBIDDEN: 'Você não tem acesso a esta empresa.',
  STATE_CONFLICT: 'A situação mudou desde que você abriu a tela. Atualize antes de continuar.',
  VERSION_CONFLICT: 'Os dados mudaram desde que você abriu a tela. Atualize antes de continuar.',
  IDEMPOTENCY_CONFLICT: 'Esta operação já foi registrada com outros dados. Atualize a tela.',
  NOT_FOUND: 'Não encontramos o que você procurou.',
  INSUFFICIENT_STOCK: 'Estoque insuficiente para esta operação.',
  DISCOUNT_EXCEEDS_LIMIT: 'O desconto passa do limite do seu perfil.',
  PAYMENT_EXCEEDS_BALANCE: 'O valor é maior que o saldo em aberto.',
  PRODUCT_PAUSED: 'A venda deste produto está pausada.',
  INSUFFICIENT_FUNDS: 'Saldo insuficiente na conta escolhida.',
  PERIOD_LOCKED: 'Este mês já foi fechado. Registre a correção com a data de hoje.',
  QUOTE_EXPIRED: 'O prazo deste orçamento terminou. Peça uma atualização à empresa.',
  QUOTE_VERSION_STALE: 'Esta versão do orçamento foi substituída. Veja a versão atual.',
};

/** Códigos do API-001 que o banco devolve no campo `hint` (mensagem já em português). */
const CODIGOS_DO_BANCO = new Set(['AUTH_REQUIRED', 'FORBIDDEN_ACTION', 'TENANT_FORBIDDEN', 'VALIDATION_ERROR',
  'STATE_CONFLICT', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'NOT_FOUND', 'INSUFFICIENT_STOCK',
  'DISCOUNT_EXCEEDS_LIMIT', 'PAYMENT_EXCEEDS_BALANCE', 'PRODUCT_PAUSED', 'INSUFFICIENT_FUNDS', 'PERIOD_LOCKED',
  'QUOTE_EXPIRED', 'QUOTE_VERSION_STALE']);

/** D6-12: no máximo 2 requisições simultâneas à Data API por sessão (mitigação do D-07, sem mudar regra). */
export const MAXIMO_SIMULTANEAS = 2;

/**
 * Rastreio do D-07 (P-M08-07): cada identidade vazia vista pelo app fica registrada só na memória da aba, com o
 * caminho (sem parâmetros), o horário, quantas requisições estavam em andamento, a idade do token, a ordem da chamada
 * na sessão, se foi a primeira chamada com aquele token e o resultado da repetição. Nunca guarda token, cookie,
 * corpo nem dado pessoal. Os scripts de verificação no navegador leem `globalThis.autonickDiagnostico.d07`.
 */
export const registroD07 = [];
const LIMITE_REGISTRO_D07 = 50;
if (typeof globalThis !== 'undefined' && !globalThis.autonickDiagnostico) {
  Object.defineProperty(globalThis, 'autonickDiagnostico', { value: Object.freeze({ d07: registroD07 }), configurable: false, enumerable: false });
}

function codigoPorStatus(status) {
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'FORBIDDEN_ACTION';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'VALIDATION_ERROR';
}

/** Lê o campo `exp` (segundos) de um JWT sem validar a assinatura (só para cache). */
export function expiracaoDoJwt(jwt) {
  try {
    const carga = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(carga.padEnd(carga.length + ((4 - (carga.length % 4)) % 4), '=')));
    return Number.isFinite(json.exp) ? json.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

const sem = (url) => url.replace(/\/+$/, '');

export class ClienteNeon {
  #authUrl;
  #dataApiUrl;
  #fetch;
  #agora;
  #esperar;
  #jwt = null;
  #jwtExpiraEm = 0;
  #jwtAnonimo = null;
  #jwtAnonimoExpiraEm = 0;
  #emAndamento = 0;
  #fila = [];
  #picoSimultaneas = 0;
  #jwtObtidoEm = 0;
  #chamadasComToken = 0;
  #chamadasNaSessao = 0;

  constructor({ authUrl, dataApiUrl, fetch = globalThis.fetch?.bind(globalThis), agora = () => Date.now(), esperar = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.#authUrl = authUrl ? sem(authUrl) : null;
    this.#dataApiUrl = dataApiUrl ? sem(dataApiUrl) : null;
    this.#fetch = fetch;
    this.#agora = agora;
    this.#esperar = esperar;
  }

  /** Maior número de requisições à Data API em andamento ao mesmo tempo (diagnóstico do D6-12). */
  get picoSimultaneas() {
    return this.#picoSimultaneas;
  }

  /** Espera uma vaga na fila (D6-12). As requisições saem na ordem em que chegaram. */
  async #vaga() {
    if (this.#emAndamento >= MAXIMO_SIMULTANEAS) await new Promise((liberar) => this.#fila.push(liberar));
    this.#emAndamento += 1;
    this.#picoSimultaneas = Math.max(this.#picoSimultaneas, this.#emAndamento);
  }

  #liberarVaga() {
    this.#emAndamento -= 1;
    this.#fila.shift()?.();
  }

  get configurado() {
    return Boolean(this.#authUrl && this.#dataApiUrl);
  }

  #exigirConfiguracao() {
    if (!this.configurado) throw new ErroNeon('NAO_CONFIGURADO', MENSAGENS.NAO_CONFIGURADO);
  }

  async #requisitar(url, opcoes, mensagemErro) {
    // Operação com chave de operação = escrita (repetir com a mesma chave não duplica). O código continua
    // NETWORK_UNKNOWN para as telas manterem a chave; só a mensagem muda (M13, D13-06).
    const escrita = typeof opcoes.body === 'string' && opcoes.body.includes('"p_operation_key"');
    const envio = escrita || (opcoes.method === 'POST' && this.#authUrl && url.startsWith(this.#authUrl));
    if (globalThis.navigator?.onLine === false) {
      const erro = new ErroNeon('NETWORK_UNKNOWN', envio ? MENSAGENS.SEM_CONEXAO_ENVIO : MENSAGENS.SEM_CONEXAO_LEITURA);
      erro.naoEnviado = true;
      throw erro;
    }
    let resposta;
    try {
      resposta = await this.#fetch(url, opcoes);
    } catch {
      throw new ErroNeon('NETWORK_UNKNOWN', escrita ? MENSAGENS.ENVIO_SEM_CONFIRMACAO : MENSAGENS.NETWORK_UNKNOWN);
    }
    if (!resposta.ok) {
      let codigo = codigoPorStatus(resposta.status);
      const corpo = opcoes.headers?.Authorization || opcoes.publica ? await resposta.json().catch(() => null) : null;
      // Erro de regra vindo do banco: código no `hint`, mensagem em português, campo no `details`.
      if (CODIGOS_DO_BANCO.has(corpo?.hint)) {
        const erro = new ErroNeon(corpo.hint, corpo.message || MENSAGENS[corpo.hint], resposta.status, corpo.details || null);
        erro.regraDoBanco = true;
        throw erro;
      }
      // A Data API do Neon responde 400 para JWT ausente, inválido ou expirado.
      if (codigo === 'VALIDATION_ERROR' && /jwt|authenticat|token/i.test(corpo?.message ?? '')) codigo = 'AUTH_REQUIRED';
      throw new ErroNeon(codigo, mensagemErro?.(codigo) ?? MENSAGENS[codigo], resposta.status);
    }
    return resposta;
  }

  #auth(caminho, corpo, mensagemErro) {
    return this.#requisitar(`${this.#authUrl}${caminho}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      credentials: 'include',
      headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }, mensagemErro);
  }

  /** Cria a identidade. Retorna se o e-mail já está verificado. */
  async cadastrar({ nome, email, senha }) {
    this.#exigirConfiguracao();
    this.#descartarToken();
    const resposta = await this.#auth('/sign-up/email', { name: nome, email, password: senha },
      (codigo) => (codigo === 'VALIDATION_ERROR' ? MENSAGENS.CADASTRO : MENSAGENS[codigo]));
    const dados = await resposta.json().catch(() => null);
    return { emailVerificado: Boolean(dados?.user?.emailVerified) };
  }

  async entrar({ email, senha }) {
    this.#exigirConfiguracao();
    this.#descartarToken();
    try {
      await this.#auth('/sign-in/email', { email, password: senha },
        (codigo) => (codigo === 'VALIDATION_ERROR' || codigo === 'AUTH_REQUIRED' ? MENSAGENS.CREDENCIAIS : MENSAGENS[codigo]));
    } catch (erro) {
      // Com verificação exigida, o Auth responde 403 para e-mail não confirmado.
      if (erro.status === 403) throw new ErroNeon('EMAIL_NAO_VERIFICADO', MENSAGENS.EMAIL_NAO_VERIFICADO, 403);
      throw erro;
    }
  }

  /** Envia (ou reenvia) o código de verificação de e-mail. Resposta neutra. */
  async enviarCodigoDeVerificacao(email) {
    this.#exigirConfiguracao();
    try {
      await this.#auth('/email-otp/send-verification-otp', { email, type: 'email-verification' });
    } catch (erro) {
      if (erro.codigo === 'VALIDATION_ERROR') return;
      throw erro;
    }
  }

  /** Confirma o e-mail com o código recebido. */
  async verificarEmail({ email, codigo }) {
    this.#exigirConfiguracao();
    this.#descartarToken();
    await this.#auth('/email-otp/verify-email', { email, otp: codigo },
      (cod) => (cod === 'VALIDATION_ERROR' || cod === 'AUTH_REQUIRED' || cod === 'FORBIDDEN_ACTION' ? MENSAGENS.CODIGO_INVALIDO : MENSAGENS[cod]));
  }

  async sair() {
    this.#descartarToken();
    if (!this.configurado) return;
    await this.#auth('/sign-out', {});
  }

  /**
   * Recuperação de senha por código (Managed Better Auth, plugin email-otp).
   * O código chega pelo e-mail do próprio Neon Auth; a resposta é neutra
   * para não revelar se o e-mail existe (SEC-T22).
   */
  async pedirRedefinicaoDeSenha({ email }) {
    this.#exigirConfiguracao();
    try {
      await this.#auth('/email-otp/request-password-reset', { email });
    } catch (erro) {
      if (erro.codigo === 'VALIDATION_ERROR' || erro.codigo === 'AUTH_REQUIRED') return;
      throw erro;
    }
  }

  /**
   * Define a nova senha com o código recebido por e-mail.
   *
   * Observado no Neon real (01/11/2026): a redefinição por código NÃO encerra
   * as sessões já abertas. Por isso, em seguida entramos com a nova senha,
   * encerramos as outras sessões e saímos. Devolve se esse passo deu certo.
   */
  async redefinirSenhaComCodigo({ email, codigo, novaSenha }) {
    this.#exigirConfiguracao();
    this.#descartarToken();
    if (!novaSenha || novaSenha.length < 8 || novaSenha.length > 128) throw new ErroNeon('SENHA_FRACA', MENSAGENS.SENHA_FRACA);
    await this.#auth('/email-otp/reset-password', { email, otp: codigo, password: novaSenha },
      (cod) => (['VALIDATION_ERROR', 'AUTH_REQUIRED', 'FORBIDDEN_ACTION'].includes(cod) ? MENSAGENS.CODIGO_INVALIDO : MENSAGENS[cod]));
    try {
      await this.#auth('/sign-in/email', { email, password: novaSenha });
      await this.#auth('/revoke-other-sessions', {});
      await this.#auth('/sign-out', {});
      return { sessoesEncerradas: true };
    } catch {
      return { sessoesEncerradas: false };
    }
  }

  /**
   * Troca a senha de quem está com a sessão aberta. Por padrão encerra as
   * outras sessões da conta (outros navegadores ou aparelhos).
   */
  async trocarSenha({ atual, nova, encerrarOutras = true }) {
    this.#exigirConfiguracao();
    if (!nova || nova.length < 8 || nova.length > 128) throw new ErroNeon('SENHA_FRACA', MENSAGENS.SENHA_FRACA);
    try {
      await this.#auth('/change-password', { currentPassword: atual, newPassword: nova, revokeOtherSessions: Boolean(encerrarOutras) });
    } catch (erro) {
      if (erro.codigo === 'VALIDATION_ERROR' || erro.codigo === 'FORBIDDEN_ACTION') {
        throw new ErroNeon('SENHA_ATUAL_INCORRETA', MENSAGENS.SENHA_ATUAL_INCORRETA, erro.status);
      }
      throw erro;
    } finally {
      this.#descartarToken();
    }
  }

  /** Sessão atual ou null. Atualiza o JWT em memória a partir do cabeçalho. */
  async sessao() {
    this.#exigirConfiguracao();
    let resposta;
    try {
      resposta = await this.#auth('/get-session');
    } catch (erro) {
      if (erro.codigo === 'AUTH_REQUIRED') return null;
      throw erro;
    }
    const dados = await resposta.json().catch(() => null);
    if (!dados?.user) {
      this.#descartarToken();
      return null;
    }
    const jwt = resposta.headers.get('set-auth-jwt');
    if (jwt) {
      if (jwt !== this.#jwt) {
        this.#jwtObtidoEm = this.#agora();
        this.#chamadasComToken = 0;
      }
      this.#jwt = jwt;
      this.#jwtExpiraEm = expiracaoDoJwt(jwt);
    }
    return { usuario: { id: dados.user.id, nome: dados.user.name, email: dados.user.email, emailVerificado: Boolean(dados.user.emailVerified) } };
  }

  async #token() {
    if (this.#jwt && this.#jwtExpiraEm - this.#agora() > 30_000) return this.#jwt;
    const s = await this.sessao();
    if (!s || !this.#jwt) throw new ErroNeon('AUTH_REQUIRED', MENSAGENS.AUTH_REQUIRED, 401);
    return this.#jwt;
  }

  #descartarToken() {
    this.#jwt = null;
    this.#jwtExpiraEm = 0;
  }

  /**
   * Chamada à Data API.
   *
   * Defeito D-07 (aberto, origem não comprovada):
   * no Neon real, uma chamada com token válido às vezes chega ao banco com a
   * identidade vazia ("Sessão ausente", código AUTH_REQUIRED); a repetição funciona.
   * Repetimos UMA vez, com token renovado, só dois casos: 403 sem código de
   * regra e AUTH_REQUIRED vindo do banco. É seguro: leituras não alteram nada e
   * toda RPC que grava é idempotente (chave de operação). As demais negações de
   * regra (com código no `hint`) nunca são repetidas, e uma negação real se
   * repete na segunda tentativa.
   */
  async #dados(caminho, { metodo = 'GET', corpo, objeto = false } = {}) {
    this.#exigirConfiguracao();
    // Sem conexão, nem o token é pedido: a mensagem diz se era um envio (M13, D13-06).
    if (globalThis.navigator?.onLine === false) {
      const envio = Boolean(corpo && Object.hasOwn(corpo, 'p_operation_key'));
      const erro = new ErroNeon('NETWORK_UNKNOWN', envio ? MENSAGENS.SEM_CONEXAO_ENVIO : MENSAGENS.SEM_CONEXAO_LEITURA);
      erro.naoEnviado = true;
      throw erro;
    }
    let contexto = null;
    const chamar = async () => {
      const token = await this.#token();
      await this.#vaga();
      this.#chamadasNaSessao += 1;
      this.#chamadasComToken += 1;
      contexto = { em_andamento: this.#emAndamento, idade_token_ms: this.#agora() - this.#jwtObtidoEm,
        ordem_na_sessao: this.#chamadasNaSessao, primeira_com_token: this.#chamadasComToken === 1 };
      try {
        const r = await this.#requisitar(`${this.#dataApiUrl}${caminho}`, {
          method: metodo,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: objeto ? 'application/vnd.pgrst.object+json' : 'application/json',
            ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: corpo === undefined ? undefined : JSON.stringify(corpo),
        });
        return await r.json();   // o corpo é lido ainda dentro da vaga
      } finally {
        this.#liberarVaga();
      }
    };
    let resposta;
    try {
      resposta = await chamar();
    } catch (erro) {
      const semRegra = erro.codigo === 'FORBIDDEN_ACTION' && !erro.regraDoBanco;
      const identidadeVazia = erro.codigo === 'AUTH_REQUIRED' && erro.regraDoBanco;
      if (!semRegra && !identidadeVazia) throw erro;
      const registro = { caminho: caminho.split('?')[0], metodo, quando: new Date(this.#agora()).toISOString(),
        tipo: identidadeVazia ? 'identidade_vazia' : '403_sem_regra', ...contexto, repeticao: 'pendente' };
      if (registroD07.length >= LIMITE_REGISTRO_D07) registroD07.shift();
      registroD07.push(registro);
      if (identidadeVazia) this.#descartarToken();
      await this.#esperar(400);
      try {
        resposta = await chamar();
        registro.repeticao = 'sucesso';
      } catch (erro2) {
        registro.repeticao = `falhou:${erro2.codigo ?? 'erro'}`;
        throw erro2;
      }
    }
    return resposta;
  }

  /** Consulta GET à Data API (a filtragem real é feita por RLS no banco). */
  consultar(caminho, { objeto = false } = {}) {
    return this.#dados(caminho, { objeto });
  }

  /** Chama uma função (RPC) da Data API. A autorização acontece dentro do banco. */
  rpc(nome, corpo = {}) {
    return this.#dados(`/rpc/${nome}`, { metodo: 'POST', corpo });
  }

  /**
   * Chamada pública (M10, D10-01). No Neon, o visitante sem login também usa um JWT: o token ANÔNIMO emitido pelo
   * Neon Auth (`GET /token/anonymous`, papel `anonymous`, validade curta). Sem token, a Data API responde 401. Com ele, o
   * banco só deixa executar filtros_vitrine, buscar_vitrine e vitrine_publica. O token anônimo nunca é o da sessão da
   * pessoa e fica só na memória desta página. Passa pela mesma fila de no máximo 2 requisições (D6-12).
   */
  async #tokenAnonimo(renovar = false) {
    if (!renovar && this.#jwtAnonimo && this.#jwtAnonimoExpiraEm - this.#agora() > 60_000) return this.#jwtAnonimo;
    const r = await this.#requisitar(`${this.#authUrl}/token/anonymous`, { method: 'GET', credentials: 'omit' });
    const dados = await r.json().catch(() => null);
    if (!dados?.token) throw new ErroNeon('NETWORK_UNKNOWN', MENSAGENS.NETWORK_UNKNOWN);
    this.#jwtAnonimo = dados.token;
    this.#jwtAnonimoExpiraEm = expiracaoDoJwt(dados.token);
    return this.#jwtAnonimo;
  }

  async rpcPublica(nome, corpo = {}) {
    this.#exigirConfiguracao();
    const chamar = async (renovar) => {
      const token = await this.#tokenAnonimo(renovar);
      await this.#vaga();
      try {
        const r = await this.#requisitar(`${this.#dataApiUrl}/rpc/${nome}`, {
          method: 'POST', publica: true,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        });
        return await r.json();
      } finally {
        this.#liberarVaga();
      }
    };
    try {
      return await chamar(false);
    } catch (erro) {
      // Token anônimo vencido ou recusado: um novo token, uma vez só.
      if (erro.codigo !== 'AUTH_REQUIRED' || erro.regraDoBanco) throw erro;
      this.#jwtAnonimo = null;
      return chamar(true);
    }
  }

  /** Há sessão ativa? Sem lançar erro (para decidir entre chamada pública e com token). */
  async temSessao() {
    if (!this.configurado) return false;
    try {
      return Boolean(await this.sessao()) && Boolean(this.#jwt);
    } catch {
      return false;
    }
  }

  /** Token da sessão (renovado se estiver perto de vencer). Usado só pela demonstração local do detalhe via API Java (J03). */
  tokenDeAcesso() {
    return this.#token();
  }

  /** Perfis do titular da sessão. A filtragem real é feita por RLS no banco. */
  meusPerfis() {
    return this.#dados('/perfis_identidade?select=id,tipo_conta,nome,criado_em&order=tipo_conta.asc');
  }

  /** Cria (ou devolve, se já existir) o perfil do tipo indicado (RPC idempotente). */
  garantirPerfil(tipoConta, nome) {
    return this.#dados('/rpc/garantir_perfil', { metodo: 'POST', corpo: { p_tipo_conta: tipoConta, p_nome: nome }, objeto: true });
  }
}
