/**
 * Fechamento do mês (M07, UI-045; RF-135, RF-136; D7-11 a D7-13, D7-17): próximo mês a fechar, pendências só
 * informativas, resumo, conferência opcional do caixa físico (diferença só pelo proprietário, com motivo), fechamento
 * com confirmação e histórico de fechamentos com reabertura do último mês, só pelo proprietário e com justificativa.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { campoTexto, erroNoCampo, limparErros, ocupado, valores } from '../../ui/formulario.js';
import { situacaoFechamento, fecharPeriodo, reabrirPeriodo } from '../../data/financeiro.js';
import { mesPorExtenso } from '../../domain/financeiro.js';
import { formatarDataHora } from '../empresa/comum.js';
import { montarMomento } from '../../ui/forja3d/momentos.js';
import {
  carregarFinanceiro, criarAnunciador, criarExecutorFinanceiro, dinheiro, dialogoFormulario, ehProprietario, centavosDoCampo,
  avisoRegistro, erroDeCarga, dados,
} from './comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;

const executar = criarExecutorFinanceiro({ area, anunciar, recarregar: () => carregar(), erroNoCampo });

function secaoPendencias(p) {
  if (!p) return null;
  const itens = [
    p.parcelas_vencidas_receber ? `${p.parcelas_vencidas_receber} parcela(s) a receber vencida(s) até o fim do mês` : null,
    p.parcelas_vencidas_pagar ? `${p.parcelas_vencidas_pagar} parcela(s) a pagar vencida(s) até o fim do mês` : null,
    p.devolucoes_a_fazer_centavos ? `${dinheiro(p.devolucoes_a_fazer_centavos)} a devolver a clientes` : null,
    p.recorrencias_nao_geradas ? `${p.recorrencias_nao_geradas} despesa(s) recorrente(s) do mês ainda não gerada(s)` : null,
  ].filter(Boolean);
  return el('div', { class: 'pilha', id: 'pendencias' }, el('h3', {}, 'Pendências (só para conferir)'),
    itens.length ? el('ul', {}, ...itens.map((t) => el('li', {}, t))) : el('p', {}, 'Nenhuma pendência.'),
    el('p', { class: 'campo__ajuda' }, 'Pendências não impedem o fechamento: elas continuam abertas no mês seguinte.'));
}

function formFechar(s) {
  const dono = ehProprietario(ctx);
  const campos = dono ? s.caixas.map((c, i) => el('fieldset', { class: 'campo' }, el('legend', {}, `Conferência de ${c.conta} (opcional)`),
    el('p', { class: 'campo__ajuda' }, `Saldo registrado no fim do mês: ${dinheiro(c.esperado_centavos)}.`),
    campoTexto({ nome: `contado-${i}`, rotulo: 'Valor contado em dinheiro (R$)', id: `contado-${i}`, ajuda: 'Deixe em branco para não conferir.' }),
    campoTexto({ nome: `motivo-${i}`, rotulo: 'Motivo da diferença, se houver', max: 300, id: `motivo-${i}` }))) : [];
  const form = el('form', { id: 'form-fechar', class: 'pilha', novalidate: true }, ...campos,
    dono ? null : el('p', { class: 'campo__ajuda' }, 'A conferência do caixa com diferença é registrada pelo proprietário.'),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao', id: 'fechar-mes' }, `Fechar ${mesPorExtenso(s.proximo_mes)}`)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErros(form);
    const conferencias = [];
    for (const [i, c] of s.caixas.entries()) {
      if (!dono) break;
      const texto = form.elements[`contado-${i}`].value.trim();
      if (!texto) continue;
      const contado = centavosDoCampo(form, `contado-${i}`, erroNoCampo, { minimo: 0 });
      if (contado === null) return null;
      const motivo = form.elements[`motivo-${i}`].value.trim();
      if (contado !== c.esperado_centavos && motivo.length < 10) return erroNoCampo(form, `motivo-${i}`, 'Explique a diferença (10 a 300 caracteres).');
      conferencias.push({ conta_id: c.conta_id, contado_centavos: contado, ...(contado !== c.esperado_centavos ? { motivo } : {}) });
    }
    const diferencas = conferencias.filter((c, i) => c.contado_centavos !== s.caixas[i]?.esperado_centavos);
    const ok = await abrirDialogo({ titulo: `Fechar ${mesPorExtenso(s.proximo_mes)}?`, rotuloConfirmar: 'Fechar o mês', rotuloCancelar: 'Voltar',
      mensagens: ['Depois de fechado, nada com data neste mês pode ser lançado, recebido, pago ou transferido.',
        'Correções entram no mês aberto, com a data de hoje. Só o proprietário pode reabrir o último mês fechado.',
        diferencas.length ? `${diferencas.length} diferença(s) de caixa vão virar ajuste com o motivo informado.` : null].filter(Boolean) });
    if (!ok) return null;
    const botao = form.querySelector('#fechar-mes');
    return ocupado(botao, async () => {
      // IB04: a calculadora só acompanha a operação real (uma chamada, sem etapas inventadas) e só mostra
      // o total depois que o banco confirma o fechamento, com os saldos que ele devolveu.
      let calculadora = null;
      const sinal = setTimeout(() => {
        calculadora = montarMomento(botao.parentElement, 'IB04', { tamanho: 'p' });
        calculadora.definir({ fase: 'processando' }, { manter: true });
      }, 120);
      try {
        return await executar('fechar', form, (k) => fecharPeriodo(ctx.id, s.proximo_mes, conferencias, k), (r) => {
          const lugar = el('div', { class: 'aviso__momento' });
          anunciar('sucesso', `${mesPorExtenso(s.proximo_mes)} foi fechado.`, lugar);
          const total = Array.isArray(r?.saldos) ? r.saldos.reduce((a, x) => a + (Number(x.saldo_centavos) || 0), 0) : null;
          montarMomento(lugar, 'IB04', { tamanho: 'p' }).definir({ fase: 'concluido', valor: total === null ? undefined : dinheiro(total), inicio: 'agora' });
        });
      } finally {
        clearTimeout(sinal);
        calculadora?.destruir();
      }
    });
  });
  return form;
}

function secaoProximo(s) {
  if (!s.proximo_mes) return el('section', { class: 'pilha' }, el('h2', {}, 'Próximo fechamento'), el('p', {}, s.motivo));
  const r = s.resumo;
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-proximo', id: 'secao-proximo' },
    el('h2', { id: 'titulo-proximo' }, `Próximo mês a fechar: ${mesPorExtenso(s.proximo_mes)}`),
    el('p', {}, 'Os meses são fechados em ordem, um de cada vez.'),
    r ? dados([['Receitas recebidas', dinheiro(r.fluxo.receitas_recebidas_centavos)], ['Despesas pagas', dinheiro(r.fluxo.despesas_pagas_centavos)],
      ['Saldo no fim do mês', dinheiro(r.fluxo.saldo_final_centavos)],
      r.resultado.disponivel ? ['Resultado estimado', dinheiro(r.resultado.resultado_estimado_centavos)] : null]) : null,
    secaoPendencias(s.pendencias),
    !s.pode_fechar ? el('div', { role: 'status' }, aviso('info', s.motivo))
      : (s.pode_fechar_permissao ? formFechar(s) : el('p', {}, 'Seu perfil não inclui fechar períodos.')));
}

function secaoHistorico(s) {
  const ultimo = s.fechamentos.find((f) => f.estado === 'fechado');
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-historico' },
    el('h2', { id: 'titulo-historico' }, 'Meses fechados'),
    s.fechamentos.length ? el('ul', { class: 'lista-simples', id: 'lista-fechamentos' }, ...s.fechamentos.map((f) => {
      let reabrir = null;
      if (f === ultimo && ehProprietario(ctx)) {
        reabrir = el('button', { type: 'button', class: 'botao botao--secundario', id: 'reabrir-mes' }, 'Reabrir este mês');
        reabrir.addEventListener('click', () => ocupado(reabrir, async () => {
          const res = await dialogoFormulario({ id: 'reabrir', titulo: `Reabrir ${mesPorExtenso(f.mes)}?`, rotuloConfirmar: 'Reabrir',
            descricao: ['O fechamento atual fica guardado no histórico. Feche de novo depois de corrigir.'],
            campos: [campoTexto({ nome: 'motivo', rotulo: 'Justificativa', obrigatorio: true, linhas: 3, max: 300, id: 'reabrir-motivo', ajuda: 'De 10 a 300 caracteres.' })],
            validar: (form) => { const m = valores(form).motivo ?? ''; return m.length >= 10 ? { motivo: m } : (erroNoCampo(form, 'motivo', 'Explique com pelo menos 10 caracteres.') && null); } });
          if (!res) return;
          await executar('reabrir', null, (k) => reabrirPeriodo(ctx.id, res.motivo, k), () => anunciar('sucesso', `${mesPorExtenso(f.mes)} foi reaberto.`));
        }));
      }
      return el('li', { class: 'cartao pilha', 'data-fechamento': f.id },
        el('p', {}, el('strong', {}, mesPorExtenso(f.mes)), ` · ${f.estado === 'fechado' ? 'fechado' : 'reaberto'} em ${formatarDataHora(f.fechado_em)} por ${f.fechado_por}`),
        f.estado === 'reaberto' ? el('p', {}, `Reaberto em ${formatarDataHora(f.reaberto_em)} por ${f.reaberto_por}: ${f.motivo_reabertura}`) : null,
        el('details', {}, el('summary', {}, 'Saldos e conferências'),
          dados(f.saldos.map((x) => [x.conta, dinheiro(x.saldo_centavos)])),
          f.conferencias.length ? el('ul', {}, ...f.conferencias.map((c) => el('li', {},
            `${c.conta}: contado ${dinheiro(c.contado_centavos)}, registrado ${dinheiro(c.esperado_centavos)}${c.diferenca_centavos ? `, diferença ${dinheiro(c.diferenca_centavos)} (${c.motivo}), lançada como ajuste` : ', sem diferença'}${c.conferido_por ? `; conferido por ${c.conferido_por} em ${formatarDataHora(c.conferido_em)}` : ''}`))) : null),
        reabrir);
    })) : el('p', { id: 'lista-fechamentos' }, 'Nenhum mês fechado ainda.'));
}

async function carregar() {
  mostrarCarregando(area, 'Carregando o fechamento');
  try {
    ctx = await carregarFinanceiro(area, nav, 'fechamento');
    if (!ctx) return;
    const s = await situacaoFechamento(ctx.id);
    concluirCarregamento(area);
    area.append(...[avisoRegistro(),
      s.fechado_ate ? el('p', { id: 'fechado-ate' }, `Fechado até ${mesPorExtenso(s.fechado_ate)}.`) : null,
      secaoProximo(s), secaoHistorico(s)].filter(Boolean));
  } catch (erro) {
    erroDeCarga(area, erro, tratarErro, carregar);
  }
}

carregar();
