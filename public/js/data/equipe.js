/**
 * Equipe, convites e perfis de acesso (M04) sobre a Neon Data API.
 *
 * Quem decide é o banco (migration 202611010006): permissão atual a cada
 * requisição, delegação limitada (D4-2), versão, idempotência e histórico.
 * Este módulo só monta as chamadas e guarda textos e modelos da interface.
 */
import { neon } from './sessao.js';

const enc = encodeURIComponent;

/** Catálogo completo (51 permissões no M06), agrupado por módulo na tela. */
export const catalogo = () =>
  neon.consultar('/permissoes_catalogo?select=codigo,modulo,modulo_nome,acao,acao_nome,descricao,sensivel,ordem&order=ordem.asc');

export const minhasPermissoes = (empresaId) => neon.rpc('minhas_permissoes', { p_empresa_id: empresaId });
export const membros = (empresaId) => neon.rpc('equipe_membros', { p_empresa_id: empresaId });
export const historicoEquipe = (empresaId) => neon.rpc('equipe_historico', { p_empresa_id: empresaId });
export const meusConvites = () => neon.rpc('meus_convites');

export const perfis = (empresaId) =>
  neon.consultar(`/perfis_permissao?empresa_id=eq.${enc(empresaId)}&ativo=is.true&select=id,nome,descricao,versao,desconto_maximo_percentual,perfil_permissoes(codigo)&order=nome.asc`);

export const convitesPendentes = (empresaId) =>
  neon.consultar(`/convites_empresa?empresa_id=eq.${enc(empresaId)}&estado=eq.pendente&select=id,email,perfil_permissao_id,criado_em,expira_em&order=criado_em.desc`);

export const criarPerfil = (empresaId, nome, descricao, permissoes, chave) =>
  neon.rpc('criar_perfil_permissao', { p_empresa_id: empresaId, p_nome: nome, p_descricao: descricao || null, p_permissoes: permissoes, p_operation_key: chave });

export const alterarPerfil = (perfilId, nome, descricao, permissoes, versao, chave) =>
  neon.rpc('alterar_perfil_permissao', { p_perfil_id: perfilId, p_nome: nome, p_descricao: descricao || null, p_permissoes: permissoes, p_expected_version: versao, p_operation_key: chave });

export const desativarPerfil = (perfilId, versao, chave) =>
  neon.rpc('desativar_perfil_permissao', { p_perfil_id: perfilId, p_expected_version: versao, p_operation_key: chave });

export const convidar = (empresaId, email, perfilId, chave) =>
  neon.rpc('convidar_funcionario', { p_empresa_id: empresaId, p_email: email, p_perfil_id: perfilId, p_operation_key: chave });

export const cancelarConvite = (conviteId, chave) => neon.rpc('cancelar_convite', { p_convite_id: conviteId, p_operation_key: chave });
export const aceitarConvite = (conviteId, chave) => neon.rpc('aceitar_convite', { p_convite_id: conviteId, p_operation_key: chave });
export const recusarConvite = (conviteId, chave) => neon.rpc('recusar_convite', { p_convite_id: conviteId, p_operation_key: chave });

export const trocarPerfilDoMembro = (membroId, perfilId, versao, chave) =>
  neon.rpc('alterar_perfil_do_membro', { p_membro_id: membroId, p_perfil_id: perfilId, p_expected_version: versao, p_operation_key: chave });

export const desligar = (membroId, motivo, chave) =>
  neon.rpc('desligar_membro', { p_membro_id: membroId, p_motivo: motivo || null, p_operation_key: chave });

export const sairDaEmpresa = (empresaId, chave) => neon.rpc('sair_da_empresa', { p_empresa_id: empresaId, p_operation_key: chave });

// --- Textos e modelos (MINI-ESPEC_M04 §3 e §6) -------------------------------

const visualizar = (...modulos) => modulos.map((m) => `${m}.visualizar`);

/** Modelos editáveis (D4-3). Só preenchem o formulário; o banco confere a delegação. */
export const MODELOS = [
  { id: 'gerente', nome: 'Gerente', descricao: 'Administra o dia a dia e a equipe. Não fecha períodos financeiros.',
    permissoes: (todas) => todas.filter((c) => c !== 'financeiro.fechar') },
  { id: 'vendas', nome: 'Vendas e atendimento', descricao: 'Atende clientes, aceita pedidos, registra vendas e prepara orçamentos de serviços.',
    permissoes: () => ['clientes.visualizar', 'clientes.criar', 'clientes.alterar', 'produtos.visualizar', 'estoque.visualizar',
      'pedidos.visualizar', 'pedidos.aprovar', 'vendas.visualizar', 'vendas.criar', 'vendas.aprovar', 'vendas.registrar_recebimento',
      'orcamentos.visualizar', 'orcamentos.criar', 'servicos.visualizar', 'catalogo_servicos.visualizar', 'agenda.visualizar'] },
  { id: 'estoque', nome: 'Estoque', descricao: 'Cadastra produtos e fornecedores e cuida das movimentações de estoque.',
    permissoes: () => ['produtos.visualizar', 'produtos.criar', 'produtos.alterar', 'estoque.visualizar', 'estoque.propor',
      'estoque.aprovar', 'pedidos.visualizar', 'fornecedores.visualizar', 'fornecedores.alterar'] },
  { id: 'servicos', nome: 'Serviços e agenda', descricao: 'Cuida dos serviços oferecidos, dos orçamentos e da agenda de atendimentos.',
    permissoes: () => ['clientes.visualizar', 'clientes.criar', 'produtos.visualizar', 'catalogo_servicos.visualizar', 'catalogo_servicos.alterar',
      'orcamentos.visualizar', 'orcamentos.criar', 'orcamentos.aprovar', 'orcamentos.cancelar', 'agenda.visualizar', 'agenda.alterar', 'servicos.visualizar'] },
  { id: 'financeiro', nome: 'Financeiro', descricao: 'Lança e registra pagamentos e recebimentos. Não fecha períodos.',
    permissoes: () => ['financeiro.visualizar', 'financeiro.criar', 'financeiro.aprovar', 'financeiro.cancelar', 'financeiro.exportar',
      'vendas.visualizar', 'vendas.registrar_recebimento', 'clientes.visualizar', 'relatorios.visualizar', 'relatorios.exportar', 'fornecedores.visualizar'] },
  { id: 'consulta', nome: 'Somente consulta', descricao: 'Vê vitrine, produtos, estoque, pedidos, vendas, orçamentos, serviços, agenda e relatórios. Não altera nada.',
    permissoes: () => visualizar('vitrine', 'produtos', 'estoque', 'pedidos', 'vendas', 'orcamentos', 'servicos', 'catalogo_servicos', 'agenda', 'relatorios') },
];

export const ROTULOS_EVENTOS_EQUIPE = {
  perfil_criado: 'Perfil de acesso criado',
  perfil_alterado: 'Perfil de acesso alterado',
  perfil_desativado: 'Perfil de acesso desativado',
  convite_criado: 'Convite criado',
  convite_cancelado: 'Convite cancelado',
  convite_aceito: 'Convite aceito',
  convite_recusado: 'Convite recusado',
  membro_perfil_alterado: 'Perfil de um membro trocado',
  membro_desligado: 'Membro desligado',
  membro_saiu: 'Membro saiu da empresa',
};

/** Limite de desconto do perfil (D6-04): só o proprietário define. */
export { definirDescontoMaximo } from './vendas.js';

export const papelLegivel = (papel, perfilNome) =>
  (papel === 'proprietario' ? 'Proprietário' : `Funcionário${perfilNome ? `: ${perfilNome}` : ''}`);
