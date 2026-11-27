/**
 * Modal de cadastro/edição de fornecedor (pacote 27/11, item 4.1), usado em Fornecedores e na Nova compra (sem perder o
 * rascunho da compra). PF/PJ, CPF/CNPJ opcional (CNPJ alfanumérico aceito), contato e endereço com Buscar CEP.
 */
import { el } from '../../ui/dom.js';
import { limparErros, erroNoCampo, ocupado } from '../../ui/formulario.js';
import { abrirModal } from '../../ui/modal.js';
import { blocoPessoa } from '../../ui/cadastro-pessoa.js';
import { criarFornecedor, alterarFornecedor } from '../../data/estoque.js';
import { documentoEmUso } from '../../data/vendas.js';
import { novaChave } from './comum.js';

/** Modal de cadastro/edição. Devolve o fornecedor salvo para quem chamou (ex.: Nova compra). */
export function abrirCadastroFornecedor({ ctx: c, atual = null, aoSalvar, origem = null }) {
  const edicao = Boolean(atual);
  const bloco = blocoPessoa({ prefixo: edicao ? `forn-${atual.id.slice(0, 8)}` : 'forn-novo', atual: atual ?? {}, tipoPadrao: 'pj', comContato: true,
    verificarDocumento: (doc) => documentoEmUso(c.id, 'fornecedor', doc, atual?.id ?? null) });
  const form = el('form', { class: 'pilha', novalidate: true, id: edicao ? 'form-editar-fornecedor' : 'form-novo-fornecedor' }, bloco.elemento);
  const erroGeral = el('p', { class: 'campo__erro', role: 'alert' });
  const salvar = el('button', { type: 'submit', class: 'botao', form: form.id }, edicao ? 'Salvar alterações' : 'Adicionar fornecedor');
  const cancelar = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Cancelar');
  let sujo = false;
  form.addEventListener('input', () => { sujo = true; });
  const modal = abrirModal({ titulo: edicao ? `Editar ${atual.nome}` : 'Adicionar fornecedor', tamanho: 'grande',
    descricao: edicao ? null : 'Só o nome é obrigatório. CNPJ não é exigido de autônomos.',
    corpo: el('div', { class: 'pilha' }, form, erroGeral), rodape: [cancelar, salvar], protegerAlteracoes: () => sujo, aoFechar: () => origem?.focus() });
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
        const r = edicao ? await alterarFornecedor(atual.id, dados, atual.versao, chave) : await criarFornecedor(c.id, dados, chave);
        chave = null;
        sujo = false;
        modal.fechar();
        aoSalvar({ ...dados, ...r });
      } catch (erro) {
        if (erro.codigo !== 'NETWORK_UNKNOWN') chave = null;
        if (erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, erro.campo, erro.message)) return;
        erroGeral.textContent = erro.codigo === 'NETWORK_UNKNOWN' ? `${erro.message} Tente de novo: o cadastro não será duplicado.` : erro.message;
      }
    });
  });
  setTimeout(() => form.querySelector('[name="nome"]')?.focus(), 30);
  return modal;
}

