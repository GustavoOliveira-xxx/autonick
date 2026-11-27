/**
 * Modal de cadastro/edição de cliente da empresa, usado na tela de Clientes e dentro da Nova venda (sem perder a venda).
 * Só o nome é obrigatório; tipo de pessoa, CPF/CNPJ, contato e endereço (com Buscar CEP) são opcionais.
 * A chave de operação fica guardada até a resposta: clicar duas vezes ou repetir após falha de rede não duplica.
 */
import { el } from '../../ui/dom.js';
import { abrirModal } from '../../ui/modal.js';
import { limparErros, erroNoCampo, ocupado } from '../../ui/formulario.js';
import { blocoPessoa } from '../../ui/cadastro-pessoa.js';
import { criarCliente, alterarCliente, documentoEmUso } from '../../data/vendas.js';
import { novaChave } from './comum.js';

/**
 * @param {{ ctx, atual?: object, aoSalvar: (r: object) => void, usarExistente?: (item) => void, origem?: HTMLElement }} o
 */
export function abrirCadastroCliente({ ctx, atual = null, aoSalvar, usarExistente = null, origem = null }) {
  const edicao = Boolean(atual);
  const bloco = blocoPessoa({ prefixo: edicao ? `cli-${atual.id.slice(0, 8)}` : 'cli-novo', atual: atual ?? {}, tipoPadrao: 'pf',
    verificarDocumento: ctx.pode('clientes.visualizar') ? (doc) => documentoEmUso(ctx.id, 'cliente', doc, atual?.id ?? null) : null,
    usarExistente: usarExistente ? (item) => { modal.fechar(); usarExistente(item); } : null });
  const form = el('form', { class: 'pilha', novalidate: true, id: edicao ? 'form-editar-cliente' : 'form-cliente' }, bloco.elemento);
  const erroGeral = el('p', { class: 'campo__erro', role: 'alert' });
  const salvar = el('button', { type: 'submit', class: 'botao', form: form.id }, edicao ? 'Salvar alterações' : 'Cadastrar cliente');
  const cancelar = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Cancelar');
  let sujo = false;
  form.addEventListener('input', () => { sujo = true; });
  const modal = abrirModal({ titulo: edicao ? `Editar ${atual.nome}` : 'Novo cliente', tamanho: 'grande',
    descricao: edicao ? null : 'Só o nome é obrigatório. O resto ajuda a encontrar e atender o cliente depois.',
    corpo: el('div', { class: 'pilha' }, form, erroGeral), rodape: [cancelar, salvar], protegerAlteracoes: () => sujo,
    aoFechar: () => origem?.focus() });
  cancelar.addEventListener('click', () => modal.dialogo.querySelector('.modal__fechar').click());
  let chave = null;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    erroGeral.textContent = '';
    const dados = bloco.ler(form);
    if (!dados) return;
    if (!edicao) for (const k of Object.keys(dados)) if (dados[k] === '' && k !== 'nome') delete dados[k];
    chave ??= novaChave();
    ocupado(salvar, async () => {
      try {
        const r = edicao ? await alterarCliente(atual.id, dados, atual.versao, chave) : await criarCliente(ctx.id, dados, chave);
        chave = null;
        sujo = false;
        modal.fechar();
        aoSalvar({ ...dados, ...r });
      } catch (erro) {
        if (erro.codigo !== 'NETWORK_UNKNOWN') chave = null;
        if (erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, erro.campo, erro.message)) return;
        erroGeral.textContent = erro.codigo === 'NETWORK_UNKNOWN'
          ? `${erro.message} Tente de novo: se o cadastro já tiver sido feito, ele não será duplicado.` : erro.message;
      }
    });
  });
  setTimeout(() => form.querySelector('[name="nome"]')?.focus(), 30);
  return modal;
}
