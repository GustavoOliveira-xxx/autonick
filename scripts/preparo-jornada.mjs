/**
 * Preparo comum dos roteiros reais depois do M11 (ADR-G11: D11-01, D11-02, D11-08), só no branch `desenvolvimento` e só
 * com contas `@autonick-teste.example`. Substitui a prática antiga "empresa publicada por SQL, sem cartão": a empresa
 * fictícia passa pela aprovação real do cartão (CK fictícia TEMPORÁRIA), os itens usados pelo cliente são publicados pela
 * função do próprio app e as contas fictícias que pedem recebem autorização de demonstração auditada. Nenhuma regra é
 * afrouxada: os roteiros passam a cumprir as mesmas condições que um cliente cumpre.
 * O encerramento revoga a CK fictícia e as autorizações e deve rodar mesmo se o roteiro falhar no meio.
 */

const DOMINIO = '@autonick-teste.example';

/** SQL operacional auditado do preparo: marca as empresas, concede a CK fictícia e autoriza as contas que pedem. */
export function sqlPreparo({ roteiro, empresas = [], ck = null, demo = [], dias = 1 }) {
  return [
    ...empresas.map((id) => `select app_private.marcar_empresa_de_teste('${id}', '${roteiro}: empresa fictícia');`),
    ...(ck ? [`select app_private.conceder_ck_admin(u.id::text, '${roteiro}: CK fictícia temporária para aprovar o cartão') from neon_auth."user" u where u.id::text = '${ck}' and u.email like '%${DOMINIO}' and u."emailVerified";`] : []),
    ...demo.map((id) => `select app_private.autorizar_demonstracao(u.id::text, '${roteiro}: conta fictícia que pede pela vitrine (M11, D11-08)', '${roteiro} (SQL operacional)', ${dias}) from neon_auth."user" u where u.id::text = '${id}' and u.email like '%${DOMINIO}' and u."emailVerified";`),
  ].join('\n');
}

/** SQL do encerramento: revoga as autorizações abertas das contas e a CK fictícia (as duas funções são idempotentes). */
export function sqlEncerramento({ roteiro, ck = null, demo = [] }) {
  return [
    ...demo.map((id) => `select app_private.revogar_demonstracao('${id}', '${roteiro}: fim da rodada', '${roteiro} (SQL operacional)');`),
    ...(ck ? [`select app_private.revogar_ck_admin('${ck}', '${roteiro}: fim da CK fictícia temporária');`] : []),
  ].join('\n');
}

/** Envia o cartão para análise (proprietária) e aprova com a CK fictícia: o caminho real de publicação. */
export async function aprovarCartao({ rpc, get, dono, ck, empresaId, k }) {
  const versao = (await get(dono, `/empresas?id=eq.${empresaId}&select=versao`)).dados?.[0]?.versao;
  const env = await rpc(dono, 'enviar_vitrine_para_analise', { p_empresa_id: empresaId, p_expected_version: versao, p_operation_key: k() });
  const sol = (await get(ck, `/solicitacoes_publicacao?empresa_id=eq.${empresaId}&estado=eq.aberta&select=id`)).dados?.[0]?.id;
  const dec = await rpc(ck, 'ck_decidir_solicitacao', { p_solicitacao_id: sol, p_decisao: 'aprovar', p_motivo: null, p_campos: null, p_operation_key: k() });
  return { ok: env.status === 200 && dec.status === 200, detalhe: `${env.status}/${dec.status}` };
}

/**
 * Versão atual de um item, lida pelas funções do próprio app (a Data API não expõe as tabelas `servicos` e `produtos`
 * ao gestor): `servicos_da_empresa` para serviço e `produtos_da_empresa` para produto.
 */
async function versaoAtual({ rpc, dono, empresaId, tipo, id }) {
  const funcao = tipo === 'servico' ? 'servicos_da_empresa' : 'produtos_da_empresa';
  const r = await rpc(dono, funcao, { p_empresa_id: empresaId });
  return (Array.isArray(r.dados) ? r.dados : []).find((x) => x.id === id)?.versao;
}

/** Publica (ou retira) um produto da vitrine, com a versão lida por `produtos_da_empresa`. */
export async function publicarProduto({ rpc, dono, empresaId, produtoId, exibir = true, k }) {
  const versao = await versaoAtual({ rpc, dono, empresaId, tipo: 'produto', id: produtoId });
  const r = await rpc(dono, 'definir_vitrine_produto', { p_produto_id: produtoId, p_exibir: exibir, p_expected_version: versao, p_operation_key: k() });
  return r.status === 200;
}

/** Publica (ou retira) um serviço da vitrine, com a versão lida por `servicos_da_empresa`. */
export async function publicarServico({ rpc, dono, empresaId, servicoId, exibir = true, k }) {
  const versao = await versaoAtual({ rpc, dono, empresaId, tipo: 'servico', id: servicoId });
  const r = await rpc(dono, 'definir_vitrine_servico', { p_servico_id: servicoId, p_exibir: exibir, p_expected_version: versao, p_operation_key: k() });
  return r.status === 200;
}
