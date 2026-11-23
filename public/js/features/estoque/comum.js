/**
 * Utilidades das telas do M05 (produtos, estoque, fornecedores e compras).
 * A tela só orienta e esconde o que a pessoa não pode fazer; quem decide é o banco.
 */
import { el, parametro } from '../../ui/dom.js';
import { aviso } from '../../ui/estados.js';
import { empresa as lerEmpresa, novaChave } from '../../data/empresas.js';
import { minhasPermissoes } from '../../data/equipe.js';
import { exigirSessao, semAcesso, chipTeste } from '../empresa/comum.js';
import { definirEmpresaAtiva } from '../../core/contexto-empresa.js';

export { novaChave };

/** Carrega sessão, permissões atuais e dados públicos da empresa da URL (?id=). */
export async function carregarContexto(area) {
  const id = parametro('id');
  if (!id) {
    area.replaceChildren(aviso('info', 'Empresa não informada.', el('p', {}, el('a', { href: '/business/minhas-empresas.html' }, 'Ver suas empresas'))));
    return null;
  }
  if (!(await exigirSessao(area))) return null;
  let acesso;
  try {
    acesso = await minhasPermissoes(id);
  } catch (erro) {
    if (erro.codigo === 'TENANT_FORBIDDEN') {
      semAcesso(area);
      return null;
    }
    throw erro;
  }
  const permissoes = new Set(acesso.permissoes);
  const empresa = await lerEmpresa(id);
  // Empresa ativa da aba: alimenta o menu e o cabeçalho (conveniência de interface; o banco decide cada operação).
  definirEmpresaAtiva({ id, nome: empresa?.nome_publico, papel: acesso.papel, permissoes: acesso.permissoes, dado_de_teste: empresa?.dado_de_teste });
  return { id, acesso, empresa, pode: (c) => permissoes.has(c) };
}

/**
 * M13b: a navegação entre as telas da empresa passou para a barra lateral do Business (menu-empresa.js, com as mesmas
 * permissões). Aqui fica só o selo de dado de teste, quando a empresa é fictícia. `atual` é mantido pela assinatura antiga.
 */
export function navegacaoEmpresa(ctx, atual) {
  return el('div', { class: 'faixa-empresa' }, ctx.empresa?.dado_de_teste ? el('p', { class: 'opcoes' }, chipTeste()) : null);
}

export function criarAnunciador(avisos) {
  return function anunciar(tipo, texto, ...extra) {
    avisos.replaceChildren(el('div', { role: tipo === 'erro' ? 'alert' : 'status' }, aviso(tipo, texto, ...extra)));
    avisos.scrollIntoView({ block: 'nearest' });
  };
}

/**
 * Executa um comando no banco com chave de operação por ação. A chave só é
 * reaproveitada quando a resposta se perdeu na rede (API-OP-037).
 */
export function criarExecutor({ area, anunciar, recarregar, erroNoCampo }) {
  const chaves = new Map();
  return async function executar(acao, form, chamada, sucesso) {
    if (!chaves.has(acao)) chaves.set(acao, novaChave());
    try {
      const r = await chamada(chaves.get(acao));
      chaves.delete(acao);
      await recarregar();
      sucesso?.(r);
      return r;
    } catch (erro) {
      if (erro.codigo === 'NETWORK_UNKNOWN') {
        anunciar('erro', erro.message, erro.naoEnviado ? null : el('p', {}, 'Tente novamente: se a ação já tiver sido registrada, ela não será duplicada.'));
        return null;
      }
      chaves.delete(acao);
      if (erro.codigo === 'TENANT_FORBIDDEN') {
        semAcesso(area);
        return null;
      }
      if (erro.codigo === 'VALIDATION_ERROR' && form && erroNoCampo(form, erro.campo, erro.message)) return null;
      if (['FORBIDDEN_ACTION', 'VERSION_CONFLICT', 'STATE_CONFLICT', 'NOT_FOUND'].includes(erro.codigo)) {
        await recarregar();
        anunciar(erro.codigo === 'FORBIDDEN_ACTION' ? 'erro' : 'alerta', erro.message, el('p', {}, 'Atualizamos a tela com a situação atual.'));
        return null;
      }
      anunciar('erro', erro.message);
      return null;
    }
  };
}

export const quantidadeLegivel = (n) => new Intl.NumberFormat('pt-BR').format(n);
