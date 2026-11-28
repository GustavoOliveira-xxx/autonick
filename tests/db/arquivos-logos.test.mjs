/**
 * Testes de banco do E03 (migrations 202611250001, 202611250002 e 202611250003).
 * - Metadados de arquivos: permissão por finalidade, outra empresa negada, limites de tamanho, dimensão e cota, idempotência.
 * - Leitura: membro lê, outra empresa e visitante não; logo só fica pública depois da aprovação da CK.
 * - Logo: vale na hora no ERP; a vitrine mantém a aprovada até nova aprovação; a logo publicada não pode ser removida.
 * - Imagem de produto: só do próprio produto; pública só com produto na vitrine de empresa publicada.
 * - Favoritos: só de empresas em que a pessoa é membro; alternar liga e desliga.
 * - Privilégios: anônimo só nas leituras da vitrine; papéis da API não chegam ao schema manutencao.
 * PostgreSQL LOCAL com emulação do Neon; banco descartável.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const TODAS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();

const ID = (n) => `ea030000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-e03@teste.example', nome: 'Dona Olga', tipo: 'business' },
  OUT: { id: ID(2), email: 'outra-e03@teste.example', nome: 'Dona de Outra', tipo: 'business' },
  C: { id: ID(3), email: 'cliente-e03@teste.example', nome: 'Cliente Cida', tipo: 'cliente' },
  CK: { id: ID(4), email: 'ck-e03@teste.example', nome: 'Admin CK', tipo: null },
};
let chave = 0;
const k = () => `e03-teste-${String(++chave).padStart(4, '0')}`;
const q = (t) => (t === null || t === undefined ? 'NULL' : `'${String(t).replace(/'/g, "''")}'`);
const j = (o) => `${q(JSON.stringify(o))}::jsonb`;
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const rpc = (p, nome, args = '') => comoPapel(banco.url, { sub: p.id }, `SELECT public.${nome}(${args})::text`);
function ok(p, nome, args = '') {
  const r = rpc(p, nome, args);
  assert.ok(r.ok, `${nome}: ${r.erro}`);
  return JSON.parse(r.saida);
}
function falha(r, padrao) {
  assert.equal(r.ok, false, `deveria falhar com ${padrao}`);
  assert.match(r.erro, new RegExp(padrao), r.erro);
}
const versao = (tabela, id) => Number(adm(`SELECT versao FROM public.${tabela} WHERE id = ${q(id)}`));
// A API Java chama o schema manutencao com o próprio papel (aqui, o administrador) e as claims da pessoa.
const api = (sub, comando) => comoPapel(banco.url, { papel: 'postgres', sub }, comando);
function registrar(p, empresa, finalidade, { tipo = 'image/png', tamanho = 50_000, largura = 512, altura = 512, ref = [null, null], chaveOp = k(), sha = null } = {}) {
  return api(p?.id ?? null, `SELECT manutencao.arquivo_registrar(${q(empresa)}, ${q(finalidade)}, ${q(tipo)}, ${tamanho}, ${largura}, ${altura},
    ${q(sha ?? 'a'.repeat(63) + String(chave % 10))}, 'logo.png', ${q(ref[0])}, ${q(ref[1])}, ${q(chaveOp)})::text`);
}
const registrado = (...a) => { const r = registrar(...a); assert.ok(r.ok, r.erro); return JSON.parse(r.saida); };
const leitura = (sub, id) => api(sub, `SELECT coalesce(manutencao.arquivo_para_leitura(${q(id)})::text, 'nada')`).saida;
const aprovar = (empresa) => {
  ok(P.O, 'enviar_vitrine_para_analise', `${q(empresa)}, ${versao('empresas', empresa)}, ${q(k())}`);
  ok(P.CK, 'ck_decidir_solicitacao', `${q(adm(`SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(empresa)} AND estado = 'aberta'`))}, 'aprovar', NULL, NULL, ${q(k())}`);
};

const E = {};

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
    if (p.tipo) assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil(${q(p.tipo)}, ${q(p.nome)})`).ok);
  }
  adm(`SELECT app_private.conceder_ck_admin(${q(P.CK.id)}, 'teste E03')`);
  const nova = (dono, nome) => ok(dono, 'criar_empresa', `${j({ nome_publico: nome, modalidade: 'ambos', categoria_id: adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'costura-moda'"),
    cidade: 'Campinas', uf: 'SP', email_contato: 'privado-e03@teste.example' })}, ${q(k())}`).id;
  E.a = nova(P.O, 'Costura da Olga');
  E.b = nova(P.OUT, 'Outra Costura');
});
after(() => banco?.encerrar());

test('registro de logo: membro com empresa.alterar registra; outra empresa e cliente são negados; idempotente', opcoes, () => {
  const chaveOp = k();
  const a = registrado(P.O, E.a, 'logo_empresa', { chaveOp });
  assert.equal(a.finalidade, 'logo_empresa');
  assert.equal(a.url, `/api/arquivos/${a.id}`);
  assert.equal(registrado(P.O, E.a, 'logo_empresa', { chaveOp }).id, a.id, 'mesma chave devolve o mesmo registro');
  falha(registrar(P.OUT, E.a, 'logo_empresa'), 'TENANT_FORBIDDEN|acesso');
  falha(registrar(P.C, E.a, 'logo_empresa'), 'TENANT_FORBIDDEN|acesso');
  falha(registrar(null, E.a, 'logo_empresa'), 'AUTH_REQUIRED|Entre');
  falha(registrar(P.O, E.a, 'logo_empresa', { tipo: 'application/pdf' }), 'PNG, JPG ou WebP');
  falha(registrar(P.O, E.a, 'logo_empresa', { tipo: 'image/svg+xml' }), 'não aceito');
  falha(registrar(P.O, E.a, 'arquivo_qualquer'), 'Finalidade');
  E.logo1 = a.id;
});

test('limites de tamanho, dimensão e cota vêm dos parâmetros da plataforma', opcoes, () => {
  falha(registrar(P.O, E.a, 'logo_empresa', { tamanho: 2048 * 1024 + 1 }), 'limite de 2048 KB');
  falha(registrar(P.O, E.a, 'logo_empresa', { largura: 5000 }), 'Dimensões');
  falha(registrar(P.O, E.a, 'logo_empresa', { largura: 16, altura: 16 }), 'Dimensões');
  // Cota mínima (20 MB): enche com imagens de 2 MB até a recusa.
  adm("UPDATE app_private.limites_plataforma SET valor = minimo WHERE chave = 'arquivos_cota_empresa_mb'");
  const extras = [];
  try {
    let r;
    for (let i = 0; i < 12; i += 1) {
      r = registrar(P.O, E.a, 'logo_empresa', { tamanho: 2_000_000 });
      if (!r.ok) break;
      extras.push(JSON.parse(r.saida).id);
    }
    falha(r, 'LIMIT_REACHED|espaço');
    assert.ok(extras.length >= 9 && extras.length <= 10, `cabem 9 ou 10 imagens de 2 MB em 20 MB (${extras.length})`);
    for (const id of extras) ok(P.O, 'arquivo_remover', `${q(id)}, ${q(k())}`);
    assert.ok(registrar(P.O, E.a, 'logo_empresa', { tamanho: 2_000_000 }).ok, 'removidos deixam de contar na cota');
  } finally {
    adm("UPDATE app_private.limites_plataforma SET valor = valor_padrao WHERE chave = 'arquivos_cota_empresa_mb'");
  }
  assert.equal(adm("SELECT valor FROM app_private.limites_plataforma WHERE chave = 'arquivos_cota_empresa_mb'"), '200');
});

test('logo vale na hora no ERP; leitura só para membros enquanto a vitrine não for aprovada', opcoes, () => {
  const r = ok(P.O, 'definir_logo_empresa', `${q(E.a)}, ${q(E.logo1)}, ${q(k())}`);
  assert.equal(r.logo_id, E.logo1);
  assert.equal(r.logo_vitrine_id, null);
  assert.equal(r.pendente, true);
  assert.equal(ok(P.O, 'logos_das_minhas_empresas')[E.a].logo_id, E.logo1);
  assert.equal(ok(P.OUT, 'logos_das_minhas_empresas')[E.a], undefined);
  falha(rpc(P.OUT, 'definir_logo_empresa', `${q(E.a)}, ${q(E.logo1)}, ${q(k())}`), 'TENANT_FORBIDDEN|acesso');
  // Logo de outra empresa não pode ser ligada à minha.
  const deOutra = registrado(P.OUT, E.b, 'logo_empresa').id;
  falha(rpc(P.O, 'definir_logo_empresa', `${q(E.a)}, ${q(deOutra)}, ${q(k())}`), 'NOT_FOUND|não encontrada');
  assert.notEqual(leitura(P.O.id, E.logo1), 'nada');
  assert.equal(leitura(P.OUT.id, E.logo1), 'nada');
  assert.equal(leitura(P.C.id, E.logo1), 'nada');
  assert.equal(leitura(null, E.logo1), 'nada');
  assert.deepEqual(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.logos_publicos(ARRAY[${q(E.a)}]::uuid[])::text`).saida, '{}');
});

test('aprovação da CK publica a logo; troca posterior só aparece na vitrine depois de nova aprovação', opcoes, () => {
  aprovar(E.a);
  const pub = JSON.parse(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.logos_publicos(ARRAY[${q(E.a)}, ${q(E.b)}]::uuid[])::text`).saida);
  assert.deepEqual(pub, { [E.a]: `/api/arquivos/${E.logo1}` }, 'só a empresa publicada, com a logo aprovada');
  assert.match(leitura(null, E.logo1), /"publico": true/);
  falha(rpc(P.O, 'arquivo_remover', `${q(E.logo1)}, ${q(k())}`), 'STATE_CONFLICT|publicada');
  const logo2 = registrado(P.O, E.a, 'logo_empresa').id;
  assert.equal(leitura(P.CK.id, logo2), 'nada', 'antes de ser enviada, nem a CK vê a logo nova');
  const r = ok(P.O, 'definir_logo_empresa', `${q(E.a)}, ${q(logo2)}, ${q(k())}`);
  assert.equal(r.logo_id, logo2);
  assert.equal(r.logo_vitrine_id, E.logo1);
  assert.equal(r.pendente, true);
  assert.equal(JSON.parse(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.logos_publicos(ARRAY[${q(E.a)}]::uuid[])::text`).saida)[E.a], `/api/arquivos/${E.logo1}`);
  assert.equal(leitura(null, logo2), 'nada', 'a logo nova não fica pública antes da análise');
  // Em análise: a CK vê a logo enviada; a empresa não consegue removê-la; ninguém de fora a vê.
  ok(P.O, 'enviar_vitrine_para_analise', `${q(E.a)}, ${versao('empresas', E.a)}, ${q(k())}`);
  assert.notEqual(leitura(P.CK.id, logo2), 'nada');
  assert.equal(leitura(P.OUT.id, logo2), 'nada');
  falha(rpc(P.O, 'arquivo_remover', `${q(logo2)}, ${q(k())}`), 'em análise');
  assert.equal(comoPapel(banco.url, { sub: P.CK.id }, `SELECT logo_arquivo_id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(E.a)} AND estado = 'aberta'`).saida, logo2);
  ok(P.CK, 'ck_decidir_solicitacao', `${q(adm(`SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(E.a)} AND estado = 'aberta'`))}, 'aprovar', NULL, NULL, ${q(k())}`);
  assert.equal(JSON.parse(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.logos_publicos(ARRAY[${q(E.a)}]::uuid[])::text`).saida)[E.a], `/api/arquivos/${logo2}`);
  assert.equal(leitura(null, E.logo1), 'nada', 'a logo antiga deixou de ser pública');
  const removida = ok(P.O, 'arquivo_remover', `${q(E.logo1)}, ${q(k())}`);
  assert.equal(removida.estado, 'removido');
  assert.equal(leitura(P.O.id, E.logo1), 'nada');
  assert.ok(Number(adm(`SELECT count(*) FROM app_private.eventos_auditoria WHERE recurso_id = ${q(E.logo1)}`)) >= 2, 'envio e remoção auditados');
});

test('imagem de produto: só do próprio produto; pública só no produto exibido na vitrine publicada', opcoes, () => {
  const prod = ok(P.O, 'criar_produto', `${q(E.a)}, ${j({ nome: 'Barra pronta', finalidade: 'comercializavel', preco_centavos: 2500 })}, NULL, ${q(k())}`).id;
  const deOutra = ok(P.OUT, 'criar_produto', `${q(E.b)}, ${j({ nome: 'Linha', finalidade: 'comercializavel', preco_centavos: 500 })}, NULL, ${q(k())}`).id;
  falha(registrar(P.O, E.a, 'imagem_produto', { ref: ['produto', deOutra] }), 'Produto não encontrado');
  const img = registrado(P.O, E.a, 'imagem_produto', { ref: ['produto', prod] }).id;
  const outraImg = registrado(P.O, E.a, 'imagem_produto', { ref: ['produto', prod] }).id;
  falha(rpc(P.OUT, 'definir_imagem_produto', `${q(prod)}, ${q(img)}, ${q(k())}`), 'NOT_FOUND|não encontrado');
  assert.equal(ok(P.O, 'definir_imagem_produto', `${q(prod)}, ${q(img)}, ${q(k())}`).imagem_url, `/api/arquivos/${img}`);
  assert.deepEqual(ok(P.O, 'imagens_de_produtos', q(E.a)), { [prod]: `/api/arquivos/${img}` });
  falha(rpc(P.OUT, 'imagens_de_produtos', q(E.a)), 'TENANT_FORBIDDEN|acesso');
  const publicas = () => JSON.parse(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.imagens_publicas_de_produtos(${q(E.a)})::text`).saida);
  assert.deepEqual(publicas(), {}, 'fora da vitrine, nada público');
  assert.equal(leitura(null, img), 'nada');
  ok(P.O, 'definir_vitrine_produto', `${q(prod)}, true, ${versao('produtos', prod)}, ${q(k())}`);
  assert.deepEqual(publicas(), { [prod]: `/api/arquivos/${img}` });
  assert.match(leitura(null, img), /"publico": true/);
  assert.equal(leitura(null, outraImg), 'nada', 'imagem não ligada ao produto continua privada');
  ok(P.O, 'definir_vitrine_produto', `${q(prod)}, false, ${versao('produtos', prod)}, ${q(k())}`);
  assert.equal(leitura(null, img), 'nada');
});

test('favoritos: só de empresas em que a pessoa é membro; alternar liga e desliga', opcoes, () => {
  assert.equal(ok(P.O, 'alternar_favorito', `'empresa', ${q(E.a)}`).favorito, true);
  assert.deepEqual(ok(P.O, 'meus_favoritos').map((f) => f.chave), [E.a]);
  falha(rpc(P.O, 'alternar_favorito', `'empresa', ${q(E.b)}`), 'TENANT_FORBIDDEN|acesso');
  falha(rpc(P.O, 'alternar_favorito', `'modulo', 'Painel Inválido', ${q(E.a)}`), 'inválido');
  assert.equal(ok(P.O, 'alternar_favorito', `'modulo', 'financeiro', ${q(E.a)}, 'Financeiro'`).favorito, true);
  assert.equal(ok(P.O, 'meus_favoritos', q(E.a)).length, 2);
  assert.equal(ok(P.O, 'meus_favoritos').length, 1, 'sem empresa, só os favoritos de empresa');
  assert.equal(ok(P.OUT, 'meus_favoritos').length, 0);
  assert.equal(ok(P.O, 'alternar_favorito', `'empresa', ${q(E.a)}`).favorito, false);
  falha(comoPapel(banco.url, { papel: 'authenticated', sub: P.O.id }, 'SELECT count(*) FROM public.favoritos'), 'permission denied');
});

test('privilégios: anônimo só nas leituras da vitrine; manutencao e tabelas fechadas para os papéis da API', opcoes, () => {
  for (const chamada of [`public.definir_logo_empresa(${q(E.a)}, NULL, 'x')`, 'public.meus_favoritos()', 'public.logos_das_minhas_empresas()',
    `public.arquivos_do_registro('produto', ${q(E.a)})`]) {
    falha(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT ${chamada}`), 'permission denied');
  }
  for (const papel of ['anonymous', 'authenticated']) {
    falha(comoPapel(banco.url, { papel, sub: P.O.id }, `SELECT manutencao.arquivo_para_leitura(${q(E.a)})`), 'permission denied');
    falha(comoPapel(banco.url, { papel, sub: P.O.id }, 'SELECT count(*) FROM public.arquivos'), 'permission denied');
  }
  assert.equal(adm(`SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND has_function_privilege('anonymous', p.oid, 'execute')`),
  'buscar_vitrine,filtros_vitrine,flags_ativas,imagens_publicas_de_produtos,logos_publicos,vitrine_publica' /* flags_ativas (202612010002): só liga/desliga de recursos da plataforma */);
  assert.equal(adm(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('app_private', 'manutencao') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')`), '0');
});
