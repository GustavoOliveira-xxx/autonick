/**
 * Testes de banco do pacote 27/11 (migration 202612010001): documentos, endereços, busca, fornecedores, compras e parcelas.
 * - CPF e CNPJ numérico/alfanumérico com DV oficial (exemplo do simulador da Receita: 12.ABC.345/01DE-35), texto canônico.
 * - Cliente PF/PJ com cadastro mínimo (só nome), endereço opcional, aviso de documento repetido só na mesma empresa.
 * - Busca sem acento por nome, fantasia, documento, telefone; busca da venda só ativos e paginada; isolamento por empresa.
 * - Fornecedor PF/PJ com endereço e lista com situação; compra com observação; parcela com forma e prazo (DDL).
 * - Empresa aceita CNPJ alfanumérico; documentos antigos continuam válidos; rollback sem resíduo e reaplicação.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const TODAS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();
const ID = (n) => `ca270000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-p27@teste.example', nome: 'Dona Odete', tipo: 'business' },
  OUT: { id: ID(2), email: 'outra-p27@teste.example', nome: 'Dona de Outra', tipo: 'business' },
  EST: { id: ID(3), email: 'estoque-p27@teste.example', nome: 'Edu Estoque', tipo: 'business' },
};
let chave = 0;
const k = () => `p27-teste-${String(++chave).padStart(4, '0')}`;
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
const E = {};
const cliente = (p, dados, emp = E.a) => rpc(p, 'criar_cliente', `${q(emp)}, ${j(dados)}, ${q(k())}`);

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
    assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil(${q(p.tipo)}, ${q(p.nome)})`).ok);
  }
  const nova = (dono, nome) => ok(dono, 'criar_empresa', `${j({ nome_publico: nome, modalidade: 'ambos', categoria_id: adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'costura-moda'"),
    cidade: 'Campinas', uf: 'SP', email_contato: 'privado-p27@teste.example' })}, ${q(k())}`).id;
  E.a = nova(P.O, 'Costura da Odete');
  E.b = nova(P.OUT, 'Outra Costura');
  E.prod = ok(P.O, 'criar_produto', `${q(E.a)}, ${j({ nome: 'Linha', finalidade: 'comercializavel', preco_centavos: 6000, quantidade_inicial: 20 })}, NULL, ${q(k())}`).id;
  E.var = adm(`SELECT id FROM public.produto_variacoes WHERE produto_id = ${q(E.prod)} ORDER BY padrao DESC LIMIT 1`);
  const perfil = ok(P.O, 'criar_perfil_permissao', `${q(E.a)}, 'Só estoque', NULL, ARRAY['estoque.visualizar']::text[], ${q(k())}`).id;
  const c = ok(P.O, 'convidar_funcionario', `${q(E.a)}, ${q(P.EST.email)}, ${q(perfil)}, ${q(k())}`);
  assert.ok(comoPapel(banco.url, { sub: P.EST.id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`).ok);
});
after(() => banco?.encerrar());

test('CPF e CNPJ: DV oficial, alfanumérico, normalização e rejeições', opcoes, () => {
  const v = (f, x) => adm(`SELECT app_private.${f}(${q(x)})`);
  assert.equal(v('cnpj_valido', '12ABC34501DE35'), 't', 'exemplo oficial da Receita');
  assert.equal(v('cnpj_valido', '11222333000181'), 't', 'CNPJ numérico legado');
  assert.equal(v('cnpj_valido', '12ABC34501DE36'), 'f', 'DV errado');
  assert.equal(v('cnpj_valido', '12abc34501de35'), 'f', 'só aceita a forma normalizada');
  assert.equal(v('cnpj_valido', 'AAAAAAAAAAAAAA'), 'f');
  assert.equal(v('cnpj_valido', '00000000000000'), 'f');
  assert.equal(v('cpf_valido', '12345678909'), 't');
  assert.equal(v('cpf_valido', '12345678900'), 'f');
  assert.equal(v('cpf_valido', '11111111111'), 'f');
  assert.equal(v('normalizar_documento', ' 12.abc.345/01de-35 '), '12ABC34501DE35');
  assert.equal(v('normalizar_documento', '012.345.678-90'), '01234567890', 'zero à esquerda preservado');
  assert.equal(v('tipo_documento', '12ABC34501DE35'), 'cnpj');
  assert.equal(v('tipo_documento', '12345678909'), 'cpf');
});

test('cliente: só nome continua suficiente; PF com CPF; PJ com CNPJ alfanumérico, fantasia e endereço', opcoes, () => {
  const minimo = JSON.parse(cliente(P.O, { nome: 'Cliente Só Nome' }).saida);
  assert.equal(minimo.tipo_pessoa, 'pf');
  assert.equal(minimo.documento, null);
  falha(cliente(P.O, { nome: 'Fulano', documento: '123.456.789-00' }), 'CPF inválido');
  falha(cliente(P.O, { nome: 'Fulano', tipo_pessoa: 'pf', documento: '12ABC34501DE35' }), 'CPF inválido');
  const pj = JSON.parse(cliente(P.O, { nome: 'Ateliê Ação Ltda', tipo_pessoa: 'pj', nome_fantasia: 'Ateliê Ação', documento: '12.abc.345/01de-35',
    cep: '13010-000', logradouro: 'Rua Fictícia', numero: '10', bairro: 'Centro', cidade: 'Campinas', uf: 'sp' }).saida);
  assert.equal(pj.documento, '12ABC34501DE35');
  assert.deepEqual([pj.cep, pj.uf, pj.nome_fantasia], ['13010000', 'SP', 'Ateliê Ação']);
  E.pj = pj.id;
  falha(cliente(P.O, { nome: 'X Ltda', tipo_pessoa: 'pj', documento: '12ABC34501DE36' }), 'CNPJ inválido');
  falha(cliente(P.O, { nome: 'Cep Ruim', cep: '1301' }), 'CEP inválido');
  falha(cliente(P.O, { nome: 'Uf Ruim', uf: 'XX' }), 'UF inválida');
  falha(cliente(P.O, { nome: 'Campo Extra', senha: 'x' }), 'não permitido');
  const pf = JSON.parse(cliente(P.O, { nome: 'Conceição Araújo', documento: '123.456.789-09', telefone: '(19) 99999-0000' }).saida);
  assert.equal(pf.documento, '12345678909');
  E.pf = pf.id;
  // Alterar só o telefone não reconfere o documento; trocar para PJ exige CNPJ.
  const versao = JSON.parse(adm(`SELECT json_build_object('v', versao) FROM public.clientes_empresa WHERE id = ${q(E.pf)}`)).v;
  falha(rpc(P.O, 'alterar_cliente', `${q(E.pf)}, ${j({ tipo_pessoa: 'pj' })}, ${versao}, ${q(k())}`), 'CNPJ inválido');
  assert.ok(rpc(P.O, 'alterar_cliente', `${q(E.pf)}, ${j({ telefone: '19988887777', complemento: 'Casa 2' })}, ${versao}, ${q(k())}`).ok);
});

test('aviso de documento repetido só na mesma empresa e sem bloquear', opcoes, () => {
  assert.deepEqual(ok(P.O, 'documento_em_uso', `${q(E.a)}, 'cliente', '12.ABC.345/01DE-35'`).map((x) => x.id), [E.pj]);
  assert.deepEqual(ok(P.O, 'documento_em_uso', `${q(E.a)}, 'cliente', '12ABC34501DE35', ${q(E.pj)}`), []);
  assert.ok(cliente(P.O, { nome: 'Mesmo CNPJ Filial', tipo_pessoa: 'pj', documento: '12ABC34501DE35' }).ok, 'não impõe unicidade');
  assert.ok(cliente(P.OUT, { nome: 'Em outra empresa', tipo_pessoa: 'pj', documento: '12ABC34501DE35' }, E.b).ok, 'outra empresa pode ter o mesmo');
  assert.equal(ok(P.OUT, 'documento_em_uso', `${q(E.b)}, 'cliente', '12ABC34501DE35'`).length, 1, 'não vê os da empresa A');
  falha(rpc(P.OUT, 'documento_em_uso', `${q(E.a)}, 'cliente', '12ABC34501DE35'`), 'TENANT_FORBIDDEN|acesso');
  falha(rpc(P.EST, 'documento_em_uso', `${q(E.a)}, 'cliente', '12ABC34501DE35'`), 'FORBIDDEN|permiss');
});

test('busca de clientes sem acento por nome, fantasia, documento e telefone; venda só ativos e paginada', opcoes, () => {
  const nomes = (busca) => ok(P.O, 'clientes_da_empresa', `${q(E.a)}, ${q(busca)}`).map((c) => c.nome);
  assert.ok(nomes('conceicao').includes('Conceição Araújo'));
  assert.ok(nomes('ATELIE ACAO').includes('Ateliê Ação Ltda'));
  assert.ok(nomes('12.abc').includes('Ateliê Ação Ltda'), 'documento com máscara parcial');
  assert.ok(nomes('8888').includes('Conceição Araújo'), 'telefone');
  assert.deepEqual(nomes('%'), [], 'curinga do LIKE é texto comum');
  for (let i = 0; i < 10; i += 1) assert.ok(cliente(P.O, { nome: `Cliente Lote ${String(i).padStart(2, '0')}` }).ok);
  const p1 = ok(P.O, 'buscar_clientes', `${q(E.a)}, 'lote', 8, 0`);
  assert.equal(p1.itens.length, 8);
  assert.equal(p1.mais, true);
  const p2 = ok(P.O, 'buscar_clientes', `${q(E.a)}, 'lote', 8, 8`);
  assert.deepEqual([p2.itens.length, p2.mais], [2, false]);
  const lote = adm(`SELECT id || ':' || versao FROM public.clientes_empresa WHERE nome = 'Cliente Lote 00'`).split(':');
  assert.ok(rpc(P.O, 'definir_cliente_ativo', `${q(lote[0])}, false, ${lote[1]}, ${q(k())}`).ok);
  assert.ok(!ok(P.O, 'buscar_clientes', `${q(E.a)}, 'lote 00'`).itens.length, 'desativado não aparece na venda');
  assert.equal(ok(P.OUT, 'buscar_clientes', `${q(E.b)}, 'conceicao'`).itens.length, 0, 'isolamento por empresa');
  falha(rpc(P.OUT, 'buscar_clientes', `${q(E.a)}, 'conceicao'`), 'TENANT_FORBIDDEN|acesso');
  falha(rpc(P.EST, 'buscar_clientes', `${q(E.a)}, 'conceicao'`), 'FORBIDDEN|permiss');
  const ficha = ok(P.O, 'ficha_cliente', q(E.pj));
  assert.deepEqual([ficha.cliente.documento, ficha.cliente.cidade, ficha.cliente.tipo_pessoa], ['12ABC34501DE35', 'Campinas', 'pj']);
  falha(comoPapel(banco.url, { papel: 'authenticated', sub: P.O.id }, 'SELECT documento FROM public.clientes_empresa'), 'permission denied');
});

test('fornecedor PF/PJ com endereço, lista com situação e compra com observação', opcoes, () => {
  const f = ok(P.O, 'criar_fornecedor', `${q(E.a)}, ${j({ nome: 'Tecidos Fictícios SA', tipo_pessoa: 'pj', documento: '12ABC34501DE35', nome_fantasia: 'Tecidos F',
    contato_nome: 'Joana', cep: '13010000', cidade: 'Campinas', uf: 'SP' })}, ${q(k())}`);
  falha(rpc(P.O, 'criar_fornecedor', `${q(E.a)}, ${j({ nome: 'Autônomo', tipo_pessoa: 'pf', documento: '11222333000181' })}, ${q(k())}`), 'CPF inválido');
  assert.ok(rpc(P.O, 'criar_fornecedor', `${q(E.a)}, ${j({ nome: 'Autônomo Sem Documento', tipo_pessoa: 'pf' })}, ${q(k())}`).ok, 'CNPJ não é obrigatório');
  const lista = ok(P.O, 'fornecedores_da_empresa', `${q(E.a)}, 'tecidos f', 'ativos'`);
  assert.equal(lista.length, 1);
  assert.deepEqual([lista[0].cidade, lista[0].contato_nome, lista[0].compras], ['Campinas', 'Joana', 0]);
  const compra = ok(P.O, 'criar_compra', `${q(E.a)}, ${j({ fornecedor_id: f.id, numero_documento: 'NF 10', observacao: 'Entrega na loja' })}, ${j([{ variacao_id: E.var, quantidade: 3, custo_centavos: 1500 }])}, ${q(k())}`);
  falha(rpc(P.O, 'criar_compra', `${q(E.a)}, ${j({ observacao: 'x'.repeat(501) })}, ${j([{ variacao_id: E.var, quantidade: 1 }])}, ${q(k())}`), 'até 500');
  const c = ok(P.O, 'compras_da_empresa', q(E.a)).find((x) => x.id === compra.id);
  assert.deepEqual([c.observacao, c.fornecedor_id, c.quantidade_total, c.tem_conta_pagar], ['Entrega na loja', f.id, 3, false]);
  assert.equal(ok(P.O, 'fornecedores_da_empresa', `${q(E.a)}, 'tecidos'`)[0].compras, 1);
  falha(rpc(P.EST, 'fornecedores_da_empresa', `${q(E.a)}, NULL`), 'FORBIDDEN|permiss');
  falha(rpc(P.OUT, 'fornecedores_da_empresa', `${q(E.a)}, NULL`), 'TENANT_FORBIDDEN|acesso');
});

test('parcelas da venda guardam forma prevista e prazo em dias (DDL); soma continua conferida', opcoes, () => {
  const hoje = adm("SELECT app_private.hoje_sp()::text");
  const mais = (d) => adm(`SELECT (app_private.hoje_sp() + ${d})::text`);
  const pg = { condicao: 'parcelado', parcelas: [{ valor_centavos: 6000, vencimento: mais(30), forma: 'pix' }, { valor_centavos: 6000, vencimento: mais(60), forma: 'boleto' }] };
  const v = ok(P.O, 'registrar_venda_direta', `${q(E.a)}, '{}'::jsonb, ${j([{ variacao_id: E.var, quantidade: 2 }])}, ${j(pg)}, 12000, ${q(k())}`);
  const d = ok(P.O, 'venda_detalhe', q(v.id));
  assert.deepEqual(d.parcelas.map((p) => [p.prazo_dias, p.forma_prevista, p.valor_centavos]), [[30, 'pix', 6000], [60, 'boleto', 6000]]);
  const ruim = { condicao: 'parcelado', parcelas: [{ valor_centavos: 6000, vencimento: hoje, forma: 'cheque' }, { valor_centavos: 6000, vencimento: mais(30) }] };
  falha(rpc(P.O, 'registrar_venda_direta', `${q(E.a)}, '{}'::jsonb, ${j([{ variacao_id: E.var, quantidade: 2 }])}, ${j(ruim)}, 12000, ${q(k())}`), 'Forma de pagamento da parcela');
  const soma = { condicao: 'parcelado', parcelas: [{ valor_centavos: 3333, vencimento: hoje }, { valor_centavos: 3333, vencimento: mais(30) }, { valor_centavos: 3333, vencimento: mais(60) }] };
  falha(rpc(P.O, 'registrar_venda_direta', `${q(E.a)}, '{}'::jsonb, ${j([{ variacao_id: E.var, quantidade: 2 }])}, ${j(soma)}, 12000, ${q(k())}`), 'soma das parcelas');
  const vista = ok(P.O, 'registrar_venda_direta', `${q(E.a)}, '{}'::jsonb, ${j([{ variacao_id: E.var, quantidade: 1 }])}, ${j({ condicao: 'a_vista', forma: 'dinheiro' })}, 6000, ${q(k())}`);
  assert.deepEqual(ok(P.O, 'venda_detalhe', q(vista.id)).parcelas.map((p) => [p.prazo_dias, p.forma_prevista]), [[0, 'dinheiro']]);
});

test('empresa aceita CNPJ alfanumérico; documento antigo permanece', opcoes, () => {
  const emp = (dados) => {
    const versao = adm(`SELECT versao FROM public.empresas WHERE id = ${q(E.a)}`);
    return rpc(P.O, 'atualizar_empresa', `${q(E.a)}, ${j(dados)}, ${versao}, ${q(k())}`);
  };
  assert.ok(emp({ documento: '12.ABC.345/01DE-35' }).ok);
  assert.equal(adm(`SELECT documento FROM public.empresas WHERE id = ${q(E.a)}`), '12ABC34501DE35');
  falha(emp({ documento: '12ABC34501DE36' }), 'Documento inválido');
  // Documento antigo sem DV válido (base anterior) continua aceito em alterações que não mexem nele.
  adm(`UPDATE public.empresas SET documento = '11111111111111' WHERE id = ${q(E.a)}`);
  assert.ok(emp({ bairro: 'Centro' }).ok);
});

test('rollback da 202612010001 sem resíduo e reaplicação', opcoes, () => {
  const impressao = readFileSync(new URL('../../db/tests/impressao-esquema.sql', import.meta.url), 'utf8').trim().replace(/;$/, '');
  const foto = () => adm(`SELECT md5(string_agg(tipo || '|' || objeto || '|' || impressao, E'\\n' ORDER BY tipo, objeto)) FROM (${impressao}) x`);
  const depois = foto();
  aplicarArquivo(banco.url, 'db/migrations_propostas/202612010001_cadastros_documentos.down.sql');
  assert.equal(adm("SELECT count(*) FROM information_schema.columns WHERE table_name = 'clientes_empresa' AND column_name = 'documento'"), '0');
  assert.equal(adm("SELECT to_regprocedure('app_private.cnpj_valido(text)') IS NULL"), 't');
  assert.equal(adm(`SELECT count(*) FROM public.empresas WHERE documento !~ '^(\\d{11}|\\d{14})$'`), '0');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202612010001_cadastros_documentos.sql');
  assert.equal(foto(), depois);
});
