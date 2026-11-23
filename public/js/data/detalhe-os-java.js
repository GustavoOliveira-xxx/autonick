/**
 * Ordens de serviço pelas rotas próprias da API Java (ADR-J01 e ADR-J02): detalhe e listas do Cliente e da empresa;
 * escritas da empresa (iniciar, pausar, retomar, informar conclusão, reabrir, encerrar, acompanhamento, garantia e
 * materiais) e do Cliente (confirmar recebimento e pedir revisão). Ativa quando:
 *  - o backend configurado é Java (`java-local` ou `java-online`), com as rotas em /api na mesma origem; ou
 *  - na demonstração antiga do J03 (ambiente "demo-java-local", API atrás de um caminho como "/api-java"), só com a
 *    página aberta em 127.0.0.1, localhost ou [::1].
 * Com o backend Neon, as telas continuam usando só o Neon.
 *
 * Se a API Java falhar, a tela mostra a falha: não há volta silenciosa para o Neon nem para o simulador.
 */
import { CONFIG_PUBLICA } from '../config/public-config.js';
import { ErroNeon } from './neon-cliente.js';
import { neon } from './sessao.js';

const HOSTS_LOCAIS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
export const MENSAGEM_FALHA_JAVA = 'Não foi possível consultar o detalhe na API Java. Confira se ela está ligada e tente de novo.';
export const MENSAGEM_FALHA_LISTA_JAVA = 'Não foi possível consultar a lista na API Java. Confira se ela está ligada e tente de novo.';
export const MENSAGEM_FALHA_INICIAR_JAVA = 'Não foi possível confirmar o início da OS pela API Java. Confira se ela está ligada e tente de novo: se o início já tiver sido registrado, ele não será repetido.';
export const MENSAGEM_FALHA_PAUSAR_JAVA = 'Não foi possível confirmar a pausa da OS pela API Java. Confira se ela está ligada e tente de novo com o mesmo motivo: se a pausa já tiver sido registrada, ela não será repetida.';
export const MENSAGEM_FALHA_CONCLUIR_JAVA = 'Não foi possível confirmar a conclusão da OS pela API Java. Confira se ela está ligada e tente de novo: se a conclusão já tiver sido registrada, ela não será repetida.';
export const MENSAGEM_FALHA_REABRIR_JAVA = 'Não foi possível confirmar a reabertura da OS pela API Java. Confira se ela está ligada e tente de novo com o mesmo motivo: se a reabertura já tiver sido registrada, ela não será repetida.';
export const MENSAGEM_FALHA_ENCERRAR_JAVA = 'Não foi possível confirmar o encerramento da OS pela API Java. Confira se ela está ligada e tente de novo: se o encerramento já tiver sido registrado, ele não será repetido.';
export const MENSAGEM_FALHA_ATUALIZACAO_JAVA = 'Não foi possível confirmar o registro na linha do tempo pela API Java. Confira se ela está ligada e tente de novo com o mesmo texto: se já tiver sido registrado, não será repetido.';
export const MENSAGEM_FALHA_DADOS_JAVA = 'Não foi possível confirmar os dados da OS pela API Java. Confira se ela está ligada e tente de novo com os mesmos dados: se já tiverem sido salvos, não serão repetidos.';
export const MENSAGEM_FALHA_GARANTIA_JAVA = 'Não foi possível confirmar a garantia pela API Java. Confira se ela está ligada e tente de novo com os mesmos dados: se já tiver sido registrada, não será repetida.';
export const MENSAGEM_FALHA_MATERIAL_JAVA = 'Não foi possível confirmar a operação de material pela API Java. Confira se ela está ligada e tente de novo com os mesmos dados: se já tiver sido registrada, não será repetida.';
export const MENSAGEM_FALHA_CONFIRMAR_JAVA = 'Não foi possível confirmar o recebimento pela API Java. Confira se ela está ligada e tente de novo: se a confirmação já tiver sido registrada, ela não será repetida.';
export const MENSAGEM_FALHA_REVISAO_JAVA = 'Não foi possível confirmar o pedido de revisão pela API Java. Confira se ela está ligada e tente de novo com o mesmo texto: se o pedido já tiver sido registrado, ele não será repetido.';
export const MENSAGEM_FALHA_RETOMAR_JAVA = 'Não foi possível confirmar a retomada da OS pela API Java. Confira se ela está ligada e tente de novo: se a retomada já tiver sido registrada, ela não será repetida.';
/** Erros de regra que a API Java devolve com o mesmo código e a mesma mensagem da função SQL. */
const CODIGOS_DE_REGRA = new Set(['TENANT_FORBIDDEN', 'FORBIDDEN_ACTION', 'VALIDATION_ERROR']);
// PERIOD_LOCKED (J07): a conclusão cria a conta a receber do saldo e o mês financeiro está fechado.
// INSUFFICIENT_STOCK (J11): o motor de estoque do M05 recusa reservar ou baixar além do disponível.
const CODIGOS_DE_CONFLITO = new Set(['VERSION_CONFLICT', 'STATE_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'PERIOD_LOCKED', 'INSUFFICIENT_STOCK']);

export function detalheViaJavaAtivo(config = CONFIG_PUBLICA, host = globalThis.location?.hostname) {
  // Backend Java escolhido na configuração: as OS usam as rotas próprias da API (J03 a J11), na mesma origem.
  if (config?.backend === 'java-local' || config?.backend === 'java-online') return true;
  return config?.ambiente === 'demo-java-local'
    && typeof config.demoApiJava === 'string' && /^\/[a-z0-9-]+$/.test(config.demoApiJava)
    && HOSTS_LOCAIS.has(host);
}

/** Com o backend Java, as rotas ficam em /api na mesma origem; na demonstração antiga (J03), atrás de /api-java. */
function baseApiJava(config) {
  if (config?.backend === 'java-local' || config?.backend === 'java-online') return (config.apiJava ?? '/api').replace(/\/+$/, '');
  return config.demoApiJava;
}

/**
 * Pedido à API Java pela mesma origem, com o token da sessão. Devolve o mesmo JSON da função SQL. Em GET, falha de
 * rede ou da API vira API_JAVA_INDISPONIVEL; numa escrita (`corpo`), vira NETWORK_UNKNOWN, para a tela manter a mesma
 * chave de operação e não afirmar que nada mudou (o banco pode ter gravado antes de a resposta se perder).
 */
async function consultarJava(caminho, falha, { config = CONFIG_PUBLICA, buscar = globalThis.fetch.bind(globalThis), token, corpo } = {}) {
  const acesso = token ?? await neon.tokenDeAcesso();
  const escrita = corpo !== undefined;
  const codigoFalha = escrita ? 'NETWORK_UNKNOWN' : 'API_JAVA_INDISPONIVEL';
  let resposta;
  try {
    resposta = await buscar(`${baseApiJava(config)}${caminho}`, {
      method: escrita ? 'POST' : 'GET',
      headers: escrita
        ? { Authorization: `Bearer ${acesso}`, Accept: 'application/json', 'Content-Type': 'application/json' }
        : { Authorization: `Bearer ${acesso}`, Accept: 'application/json' },
      ...(escrita ? { body: JSON.stringify(corpo) } : {}),
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    throw new ErroNeon(codigoFalha, falha);
  }
  if (resposta.ok) {
    try { return await resposta.json(); }
    catch { throw new ErroNeon(codigoFalha, falha, resposta.status); }
  }
  const erro = await resposta.json().catch(() => null);
  if (resposta.status === 404) throw new ErroNeon('NOT_FOUND', erro?.mensagem ?? 'Ordem de serviço não encontrada.', 404);
  if (resposta.status === 401) throw new ErroNeon('AUTH_REQUIRED', 'Sessão ausente ou expirada.', 401);
  if ((resposta.status === 400 || resposta.status === 403) && CODIGOS_DE_REGRA.has(erro?.codigo) && typeof erro?.mensagem === 'string') {
    throw new ErroNeon(erro.codigo, erro.mensagem, resposta.status);
  }
  if (resposta.status === 409 && CODIGOS_DE_CONFLITO.has(erro?.codigo) && typeof erro?.mensagem === 'string') {
    throw new ErroNeon(erro.codigo, erro.mensagem, 409);
  }
  throw new ErroNeon(codigoFalha, falha, resposta.status);
}

/** `area`: "cliente" (minha_os) ou "business" (os_detalhe). */
export function detalheJava(area, osId, opcoes) {
  return consultarJava(`/${area}/ordens-servico/${encodeURIComponent(osId)}`, MENSAGEM_FALHA_JAVA, opcoes);
}

/** Lista do Cliente (minhas_os). */
export function minhasOrdensJava(opcoes) {
  return consultarJava('/cliente/ordens-servico', MENSAGEM_FALHA_LISTA_JAVA, opcoes);
}

/** Lista da empresa (ordens_da_empresa): mesmos filtros (estado, responsavel, busca), limite e deslocamento. */
export function ordensDaEmpresaJava(empresaId, filtros = {}, limite = 50, deslocamento = 0, opcoes) {
  const q = new URLSearchParams();
  for (const chave of ['estado', 'responsavel', 'busca']) {
    const valor = filtros?.[chave];
    if (valor !== undefined && valor !== null && String(valor) !== '') q.set(chave, String(valor));
  }
  q.set('limite', String(limite));
  q.set('deslocamento', String(deslocamento));
  return consultarJava(`/empresas/${encodeURIComponent(empresaId)}/ordens-servico?${q}`, MENSAGEM_FALHA_LISTA_JAVA, opcoes);
}

/** J05: inicia a OS pela API Java (ação fixa na rota; o corpo leva só a versão esperada e a chave da operação). */
export function iniciarOsJava(osId, versao, chave, opcoes) {
  return consultarJava(`/business/ordens-servico/${encodeURIComponent(osId)}/iniciar`, MENSAGEM_FALHA_INICIAR_JAVA,
    { ...opcoes, corpo: { versao, chave } });
}

// Só vive nesta página e não persiste dados da pausa. Se o resultado for incerto, reaproveita a requisição original.
const escritasPendentes = new Map();

async function escreverEstadoJava(acao, osId, falha, corpo, opcoes, area = 'business') {
  const id = JSON.stringify([area, acao, osId, corpo.chave]);
  const original = escritasPendentes.get(id);
  // Uma repetição incerta reenvia o pedido ORIGINAL (mesma versão); conteúdo diferente com a mesma chave não é enviado.
  const conteudo = ({ versao, chave, ...resto }) => JSON.stringify(resto);
  if (original && conteudo(original) !== conteudo(corpo)) {
    const campo = original.motivo !== corpo.motivo ? 'O motivo' : original.texto !== corpo.texto ? 'O texto' : 'O conteúdo';
    throw new ErroNeon('NETWORK_UNKNOWN', `${campo} difere da tentativa anterior. Repita com o original ou recarregue para consultar a OS.`);
  }
  const pedido = original ?? corpo;
  escritasPendentes.set(id, pedido);
  try {
    const resultado = await consultarJava(`/${area}/ordens-servico/${encodeURIComponent(osId)}/${acao}`, falha,
      { ...opcoes, corpo: pedido });
    escritasPendentes.delete(id);
    return resultado;
  } catch (erro) {
    if (erro.codigo !== 'NETWORK_UNKNOWN') escritasPendentes.delete(id);
    throw erro;
  }
}

/** J06: pausa a OS pela API Java; o corpo leva a versão, a chave e o motivo (só para a equipe). */
export function pausarOsJava(osId, versao, chave, motivo, opcoes) {
  return escreverEstadoJava('pausar', osId, MENSAGEM_FALHA_PAUSAR_JAVA, { versao, chave, motivo }, opcoes);
}

/** J06: retoma a OS pela API Java; sem motivo (a rota não aceita texto livre). */
export function retomarOsJava(osId, versao, chave, opcoes) {
  return escreverEstadoJava('retomar', osId, MENSAGEM_FALHA_RETOMAR_JAVA, { versao, chave }, opcoes);
}

/** J07: informa a conclusão pela API Java; sem texto (na função SQL, o texto da conclusão seria público). */
export function concluirOsJava(osId, versao, chave, opcoes) {
  return escreverEstadoJava('concluir', osId, MENSAGEM_FALHA_CONCLUIR_JAVA, { versao, chave }, opcoes);
}

/** J09: reabre para revisão pela API Java; o motivo (10 a 300) é PÚBLICO no histórico da OS. */
export function reabrirOsJava(osId, versao, chave, motivo, opcoes) {
  return escreverEstadoJava('reabrir', osId, MENSAGEM_FALHA_REABRIR_JAVA, { versao, chave, motivo }, opcoes);
}

/** J09: encerramento pela empresa pela API Java, só quando a regra do banco permite; sem texto. */
export function encerrarOsJava(osId, versao, chave, opcoes) {
  return escreverEstadoJava('encerrar', osId, MENSAGEM_FALHA_ENCERRAR_JAVA, { versao, chave }, opcoes);
}

/**
 * J10: atualização na linha do tempo pela API Java. `publica` true: o cliente vê (até 500, sem contato); false: nota
 * interna, só a equipe vê (até 1.000). Sem versão: só acrescenta um evento; a chave evita duplicar.
 */
export function publicarAtualizacaoJava(osId, chave, texto, publica, opcoes) {
  return escreverEstadoJava('publicar-atualizacao', osId, MENSAGEM_FALHA_ATUALIZACAO_JAVA, { chave, texto, publica: Boolean(publica) }, opcoes);
}

/** J10: responsável, previsão e recorrência (só os campos enviados mudam), com a versão da tela. */
export function atualizarDadosJava(osId, versao, chave, dados, opcoes) {
  return escreverEstadoJava('atualizar-dados', osId, MENSAGEM_FALHA_DADOS_JAVA, { versao, chave, dados }, opcoes);
}

/** J10: garantia na OS concluída, com a versão da tela (a API confere); prazo e condições ficam visíveis ao cliente. */
export function registrarGarantiaJava(osId, versao, chave, dias, condicoes, opcoes) {
  return escreverEstadoJava('registrar-garantia', osId, MENSAGEM_FALHA_GARANTIA_JAVA, { versao, chave, dias, condicoes: condicoes ?? null }, opcoes);
}

// J11: materiais e estoque da OS. As ações sobre um material ou um registro de uso levam também o id da OS na rota; a API
// confere que o item é desta OS. Quantidades, estoque e estados continuam decididos pelo banco.
const item = (...partes) => partes.map((p) => encodeURIComponent(p)).join('/');

/** Material previsto (soma à quantidade já prevista da mesma variação). */
export function adicionarMaterialJava(osId, chave, variacaoId, quantidade, opcoes) {
  return escreverEstadoJava('materiais', osId, MENSAGEM_FALHA_MATERIAL_JAVA, { chave, variacao_id: variacaoId, quantidade }, opcoes);
}

/** Reserva o que falta usar (`reservar` true) ou desfaz a reserva. */
export function reservarMaterialJava(osId, materialId, chave, reservar, opcoes) {
  return escreverEstadoJava(item('materiais', materialId, 'reserva'), osId, MENSAGEM_FALHA_MATERIAL_JAVA, { chave, reservar: Boolean(reservar) }, opcoes);
}

/** Uso de material: baixa na hora para quem aprova o estoque; pendente para os demais. */
export function registrarUsoJava(osId, chave, variacaoId, quantidade, motivo, opcoes) {
  return escreverEstadoJava('usos-material', osId, MENSAGEM_FALHA_MATERIAL_JAVA, { chave, variacao_id: variacaoId, quantidade, motivo: motivo || null }, opcoes);
}

/** Confirma ou recusa um uso pendente; `versao` é a do registro de uso. */
export function decidirUsoJava(osId, usoId, versao, chave, aprovar, motivo, opcoes) {
  return escreverEstadoJava(item('usos-material', usoId, 'decisao'), osId, MENSAGEM_FALHA_MATERIAL_JAVA,
    { versao, chave, aprovar: Boolean(aprovar), motivo: aprovar ? null : motivo }, opcoes);
}

/** Devolve ao estoque parte do que foi baixado. */
export function devolverMaterialJava(osId, materialId, chave, quantidade, motivo, opcoes) {
  return escreverEstadoJava(item('materiais', materialId, 'devolucao'), osId, MENSAGEM_FALHA_MATERIAL_JAVA, { chave, quantidade, motivo }, opcoes);
}

/**
 * J08: o Cliente titular confirma que recebeu o serviço. O corpo leva a versão que a tela mostra e a chave; a API
 * recusa com VERSION_CONFLICT se a OS mudou desde então. Não registra pagamento.
 */
export function confirmarRecebimentoJava(osId, versao, chave, opcoes) {
  return escreverEstadoJava('confirmar-recebimento', osId, MENSAGEM_FALHA_CONFIRMAR_JAVA, { versao, chave }, opcoes, 'cliente');
}

/** J08: o Cliente titular pede revisão (texto de 10 a 1.000, sem contato); a OS continua concluída. */
export function pedirRevisaoJava(osId, versao, chave, texto, opcoes) {
  return escreverEstadoJava('pedir-revisao', osId, MENSAGEM_FALHA_REVISAO_JAVA, { versao, chave, texto }, opcoes, 'cliente');
}
