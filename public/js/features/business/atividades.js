/**
 * Central de atividades (E05): o registro de auditoria da empresa em linguagem simples, agrupado por dia.
 * O banco filtra cada tipo de evento pela permissão da área (atividades_da_empresa); aqui só se traduz e se liga ao registro.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { ocupado } from '../../ui/formulario.js';
import { carregarContexto, navegacaoEmpresa } from '../estoque/comum.js';
import { atividadesDaEmpresa, textoAtividade, linkAtividade } from '../../data/atividades.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
let ctx = null;
const diaSp = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(iso));
const horaSp = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

function item(a) {
  const href = linkAtividade(ctx.id, a);
  const texto = textoAtividade(a);
  return el('li', { class: 'atividade', 'data-tipo': a.tipo },
    el('span', { class: 'atividade__hora' }, horaSp(a.criado_em)),
    el('span', { class: 'atividade__texto' }, el('strong', {}, a.voce ? 'Você' : a.ator), ` ${texto}`, href ? [' · ', el('a', { href }, 'abrir')] : null));
}

function blocos(itens, lista) {
  let diaAtual = lista.lastElementChild?.dataset.dia ?? null;
  for (const a of itens) {
    const dia = diaSp(a.criado_em);
    if (dia !== diaAtual) {
      lista.append(el('li', { class: 'atividade-dia', 'data-dia': dia }, el('h2', {}, dia), el('ul', { class: 'lista-simples' })));
      diaAtual = dia;
    }
    lista.lastElementChild.querySelector('ul').append(item(a));
  }
}

async function carregar() {
  mostrarCarregando(area, 'Carregando as atividades');
  try {
    ctx = await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'atividades'));
    const r = await atividadesDaEmpresa(ctx.id, null, 40);
    concluirCarregamento(area);
    if (!r.itens.length) {
      area.replaceChildren(el('div', { class: 'estado-vazio' }, el('p', {}, 'Nenhuma atividade nas áreas que o seu perfil permite ver.'),
        el('p', { class: 'campo__ajuda' }, 'Vendas, orçamentos, ordens de serviço, estoque, financeiro e agenda aparecem aqui conforme a equipe trabalha.')));
      return;
    }
    const lista = el('ol', { class: 'lista-simples atividades', id: 'lista-atividades' });
    blocos(r.itens, lista);
    let ultima = r.itens.at(-1).criado_em;
    const mais = el('button', { type: 'button', class: 'botao botao--secundario', hidden: !r.mais }, 'Ver atividades mais antigas');
    mais.addEventListener('click', () => ocupado(mais, async () => {
      try {
        const prox = await atividadesDaEmpresa(ctx.id, ultima, 40);
        blocos(prox.itens, lista);
        if (prox.itens.length) ultima = prox.itens.at(-1).criado_em;
        mais.hidden = !prox.mais;
      } catch (erro) {
        mais.after(aviso('erro', erro.message));
      }
    }));
    area.replaceChildren(lista, mais);
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

carregar();
