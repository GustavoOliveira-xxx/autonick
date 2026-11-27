/**
 * Cliente da venda (pacote 27/11, item 1.2): busca no servidor (só clientes ativos da empresa ativa, sem acento, por nome,
 * razão social, fantasia, CPF/CNPJ, telefone ou e-mail), com teclado, paginação e resumo compacto de dados reais
 * (documento com CPF parcialmente oculto, contato, endereço, atalho para a ficha em nova aba). "Novo cliente" abre um
 * modal por cima da venda e, ao salvar, o cliente já fica escolhido. Sem cliente = consumidor não identificado.
 */
import { el } from '../../ui/dom.js';
import { autocompletar } from '../../ui/autocompletar.js';
import { enderecoEmLinha } from '../../ui/cadastro-pessoa.js';
import { documentoParaLista } from '../../domain/documentos.js';
import { buscarClientes } from '../../data/vendas.js';
import { abrirCadastroCliente } from './cliente-modal.js';

const telefone = (t) => (t && t.length >= 10 ? `(${t.slice(0, 2)}) ${t.slice(2, -4)}-${t.slice(-4)}` : t ?? '');

export function seletorCliente({ ctx, inicial = null, aoMudar = () => {} }) {
  let escolhido = inicial;
  const oculto = el('input', { type: 'hidden', name: 'cliente_empresa_id', id: 'venda-cliente-id', value: inicial?.id ?? '' });
  const resumo = el('div', { id: 'venda-cliente-resumo', 'aria-live': 'polite' });
  const ac = autocompletar({ id: 'venda-cliente', rotulo: 'Cliente', dica: 'Nome, CPF/CNPJ, telefone ou e-mail', minimo: 0,
    ajuda: 'Deixe em branco para vender como consumidor não identificado.',
    buscar: (texto, deslocamento) => buscarClientes(ctx.id, texto, 8, deslocamento),
    rotuloItem: (c) => c.nome,
    detalheItem: (c) => [c.nome_fantasia, c.documento ? documentoParaLista(c.documento) : null, telefone(c.telefone), c.cidade].filter(Boolean).join(' · '),
    aoEscolher: (c) => definir(c),
    vazioTexto: 'Nenhum cliente encontrado.',
    acaoExtra: ctx.pode('clientes.criar') ? () => {
      const b = el('button', { type: 'button', class: 'botao botao--secundario', id: 'venda-novo-cliente' }, '+ Novo cliente');
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => abrirCadastroCliente({ ctx, origem: ac.entrada, aoSalvar: (r) => definir(r), usarExistente: (item) => definir(item) }));
      return b;
    } : null });

  function definir(c) {
    escolhido = c ?? null;
    oculto.value = escolhido?.id ?? '';
    desenhar();
    aoMudar(escolhido);
  }

  function desenhar() {
    if (!escolhido) {
      ac.elemento.hidden = false;
      resumo.replaceChildren(el('p', { class: 'campo__ajuda', id: 'venda-consumidor' }, 'Venda para consumidor não identificado.'));
      return;
    }
    ac.elemento.hidden = true;
    const trocar = el('button', { type: 'button', class: 'botao botao--secundario', id: 'venda-trocar-cliente' }, 'Trocar cliente');
    trocar.addEventListener('click', () => { definir(null); ac.limpar(); ac.entrada.focus(); });
    const semCliente = el('button', { type: 'button', class: 'botao botao--texto', id: 'venda-sem-cliente' }, 'Vender sem identificar');
    semCliente.addEventListener('click', () => { definir(null); ac.limpar(); });
    const c = escolhido;
    resumo.replaceChildren(el('div', { class: 'resumo-pessoa', id: 'venda-cliente-escolhido' },
      el('small', {}, 'Cliente da venda'), el('strong', {}, c.nome),
      c.nome_fantasia ? el('span', {}, c.nome_fantasia) : null,
      c.documento ? el('span', {}, `${c.tipo_pessoa === 'pj' ? 'CNPJ' : 'CPF'} ${documentoParaLista(c.documento)}`) : null,
      [telefone(c.telefone), c.email].filter(Boolean).length ? el('span', {}, [telefone(c.telefone), c.email].filter(Boolean).join(' · ')) : null,
      enderecoEmLinha(c) ? el('span', {}, enderecoEmLinha(c)) : null,
      el('div', { class: 'grupo-botoes' }, trocar, semCliente,
        ctx.pode('clientes.visualizar') && c.id ? el('a', { class: 'botao botao--texto', target: '_blank', rel: 'noopener',
          href: `/business/clientes.html?id=${encodeURIComponent(ctx.id)}&ficha=${encodeURIComponent(c.id)}` }, 'Ver ficha (nova aba)') : null)));
  }

  desenhar();
  return { elemento: el('div', { class: 'pilha seletor-cliente' }, ac.elemento, resumo, oculto), valor: () => escolhido?.id ?? null, definir };
}
