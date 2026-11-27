/**
 * Condições de pagamento da venda (pacote 27/11, item 1.1): à vista ou parcelado, forma de pagamento, data-base,
 * quantidade, primeira parcela (0 DDL, prazo em dias ou data), intervalo (7/15/30/45/60 ou personalizado), mensal no
 * mesmo dia ou prazos individuais (30/60/90). "Gerar parcelas" monta uma prévia editável (nº, DDL, vencimento, valor,
 * situação, forma) com total, soma, diferença e saldo a receber em tempo real. Parcelas editadas não são sobrescritas
 * sem confirmação. O banco confere tudo de novo (soma igual ao total, datas de hoje em diante e em ordem, 2 a 24 parcelas).
 */
import { el } from '../../ui/dom.js';
import { campoTexto, campoSelecao, erroNoCampo } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { lerValorEmReais } from '../../domain/moeda.js';
import { gerarParcelas, conferirParcelas, lerPrazos, diferencaDias, diaCivil, MAXIMO_PARCELAS, INTERVALOS } from '../../domain/parcelas.js';

const reais = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const paraCampo = (c) => (c / 100).toFixed(2).replace('.', ',');
const dataBr = (d) => (d && diaCivil(d) !== null ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');

/**
 * @param {object} o
 * @param {() => number} o.total total da venda em centavos (prévia)
 * @param {() => number} o.recebido valor "recebido agora" em centavos (0 se nada)
 * @param {Array<[string,string]>} o.formas formas de pagamento
 * @param {string} o.hoje data de hoje (America/Sao_Paulo)
 */
export function blocoPagamento({ total, recebido, formas, hoje }) {
  let parcelas = [];          // [{ numero, vencimento, valor_centavos, forma }]
  let editadas = false;
  let totalGerado = null;

  const radio = (valor, rotulo, marcado) => el('label', { class: 'opcao', for: `venda-condicao-${valor}` },
    el('input', { type: 'radio', name: 'condicao', id: `venda-condicao-${valor}`, value: valor, checked: marcado }), rotulo);
  const condicao = el('fieldset', { class: 'campo' }, el('legend', {}, 'Pagamento'),
    el('div', { class: 'opcoes' }, radio('a_vista', 'À vista', true), radio('parcelado', 'Parcelado')));
  const forma = campoSelecao({ nome: 'forma_pagamento', rotulo: 'Forma de pagamento', opcoes: formas, valor: 'pix', id: 'venda-forma-pagamento', vazio: 'Ainda não sei' });

  // Parcelamento
  const dataBase = campoTexto({ nome: 'data_base', rotulo: 'Data-base', tipo: 'date', valor: hoje, id: 'venda-data-base',
    ajuda: 'Os prazos (DDL) contam a partir desta data. Normalmente é a data da venda.' });
  dataBase.querySelector('input').setAttribute('min', hoje);
  const quantidade = campoSelecao({ nome: 'quantidade_parcelas', rotulo: 'Número de parcelas', id: 'venda-parcelas', vazio: null, valor: '2',
    opcoes: Array.from({ length: MAXIMO_PARCELAS - 1 }, (_, i) => [String(i + 2), `${i + 2} parcelas`]) });
  const modo = campoSelecao({ nome: 'modo_vencimento', rotulo: 'Vencimentos', id: 'venda-modo', vazio: null, valor: 'intervalo',
    opcoes: [['intervalo', 'A cada tantos dias (DDL)'], ['mensal', 'Todo mês no mesmo dia'], ['prazos', 'Prazos diferentes (ex.: 30/60/90)']] });
  const primeira = campoSelecao({ nome: 'primeira', rotulo: 'Primeira parcela', id: 'venda-primeira', vazio: null, valor: '30',
    opcoes: [['0', 'Na data-base (0 DDL)'], ['30', 'Em 30 dias (30 DDL)'], ['dias', 'Em outro número de dias'], ['data', 'Escolher a data']] });
  const primeiraMensal = campoSelecao({ nome: 'primeira_mensal', rotulo: 'Primeira parcela', id: 'venda-primeira-mensal', vazio: null, valor: '1',
    opcoes: [['1', 'No mês seguinte, mesmo dia'], ['0', 'Na data-base'], ['data', 'Escolher a data']] });
  const primeiraDias = campoTexto({ nome: 'primeira_dias', rotulo: 'Dias até a primeira (DDL)', valor: '30', id: 'venda-primeira-dias' });
  const primeiraData = campoTexto({ nome: 'primeira_data', rotulo: 'Data da primeira parcela', tipo: 'date', id: 'venda-primeira-data' });
  primeiraData.querySelector('input').setAttribute('min', hoje);
  const intervalo = campoSelecao({ nome: 'intervalo', rotulo: 'Intervalo entre parcelas', id: 'venda-intervalo', vazio: null, valor: '30',
    opcoes: [...INTERVALOS.map((d) => [String(d), `${d} dias`]), ['outro', 'Outro intervalo']] });
  const intervaloDias = campoTexto({ nome: 'intervalo_dias', rotulo: 'Intervalo em dias', valor: '', id: 'venda-intervalo-dias' });
  const prazos = campoTexto({ nome: 'prazos', rotulo: 'Prazos em dias (DDL)', valor: '30/60/90', id: 'venda-prazos', ajuda: 'Separe por barra, vírgula ou espaço. Crescentes, a partir de 0.' });
  for (const c of [primeiraDias, intervaloDias]) c.querySelector('input').setAttribute('inputmode', 'numeric');
  const gerar = el('button', { type: 'button', class: 'botao botao--secundario', id: 'gerar-parcelas' }, 'Gerar parcelas');
  const erroGerar = el('p', { class: 'campo__erro', id: 'gerar-parcelas-erro', role: 'alert' });
  const tabela = el('div', { id: 'lista-parcelas', class: 'pilha' });
  const resumo = el('div', { class: 'resumo-pagamento', id: 'resumo-pagamento', 'aria-live': 'polite' });
  const ddlAjuda = el('p', { class: 'campo__ajuda ddl-ajuda' }, el('strong', {}, 'DDL'), ' são dias corridos contados a partir da data-base: 30 DDL de 27/11 é 27/12. ',
    '"Todo mês no mesmo dia" é diferente de "a cada 30 dias": 27/12 e depois 27/01.');
  const blocoParcelado = el('div', { class: 'pilha', id: 'bloco-parcelas', hidden: true },
    el('div', { class: 'grade-filtros' }, dataBase, quantidade, modo),
    el('div', { class: 'grade-filtros', id: 'opcoes-intervalo' }, primeira, primeiraDias, primeiraData, intervalo, intervaloDias),
    el('div', { class: 'grade-filtros', id: 'opcoes-mensal', hidden: true }, primeiraMensal),
    el('div', { class: 'grade-filtros', id: 'opcoes-prazos', hidden: true }, prazos),
    ddlAjuda, el('div', { class: 'grupo-botoes' }, gerar), erroGerar, tabela);

  const v = (c) => c.querySelector('input, select').value;
  const ajustarVisiveis = () => {
    const parcelado = condicao.querySelector('input:checked').value === 'parcelado';
    blocoParcelado.hidden = !parcelado;
    const m = v(modo);
    blocoParcelado.querySelector('#opcoes-intervalo').hidden = m !== 'intervalo';
    blocoParcelado.querySelector('#opcoes-mensal').hidden = m !== 'mensal';
    blocoParcelado.querySelector('#opcoes-prazos').hidden = m !== 'prazos';
    quantidade.hidden = m === 'prazos';
    primeiraDias.hidden = v(primeira) !== 'dias';
    primeiraData.hidden = !((m === 'intervalo' && v(primeira) === 'data') || (m === 'mensal' && v(primeiraMensal) === 'data'));
    if (m === 'mensal' && v(primeiraMensal) === 'data') blocoParcelado.querySelector('#opcoes-mensal').append(primeiraData);
    else if (primeiraData.parentElement?.id !== 'opcoes-intervalo') blocoParcelado.querySelector('#opcoes-intervalo').insertBefore(primeiraData, intervalo);
    intervaloDias.hidden = v(intervalo) !== 'outro';
    atualizar();
  };
  for (const c of [modo, primeira, primeiraMensal, intervalo]) c.querySelector('select').addEventListener('change', ajustarVisiveis);
  for (const r of condicao.querySelectorAll('input')) r.addEventListener('change', ajustarVisiveis);

  const lerInteiro = (texto) => (/^\d+$/.test(String(texto).trim()) ? Number(String(texto).trim()) : Number.NaN);

  /** Monta os parâmetros do gerador a partir das escolhas; devolve { ok, opcoes } ou o erro no campo. */
  const opcoesDoGerador = () => {
    const base = v(dataBase);
    const m = v(modo);
    const o = { total: total(), dataBase: base, modo: m, hoje };
    if (m === 'prazos') {
      const p = lerPrazos(v(prazos));
      if (!p.ok) return { ok: false, campo: 'prazos', erro: p.erro };
      o.prazos = p.dias;
      return { ok: true, opcoes: o };
    }
    o.quantidade = Number(v(quantidade));
    if (m === 'mensal') {
      if (v(primeiraMensal) === 'data') o.primeiraData = v(primeiraData) || null; else o.primeiraMeses = Number(v(primeiraMensal));
      if (v(primeiraMensal) === 'data' && !o.primeiraData) return { ok: false, campo: 'primeira_data', erro: 'Escolha a data da primeira parcela.' };
      return { ok: true, opcoes: o };
    }
    const p = v(primeira);
    if (p === 'data') {
      o.primeiraData = v(primeiraData) || null;
      if (!o.primeiraData) return { ok: false, campo: 'primeira_data', erro: 'Escolha a data da primeira parcela.' };
    } else {
      o.primeiraDias = p === 'dias' ? lerInteiro(v(primeiraDias)) : Number(p);
      if (!Number.isInteger(o.primeiraDias)) return { ok: false, campo: 'primeira_dias', erro: 'Use um número inteiro de dias (0 ou mais).' };
    }
    o.intervaloDias = v(intervalo) === 'outro' ? lerInteiro(v(intervaloDias)) : Number(v(intervalo));
    if (!Number.isInteger(o.intervaloDias) || o.intervaloDias < 1) return { ok: false, campo: 'intervalo_dias', erro: 'O intervalo precisa ser um número inteiro de dias, maior que zero.' };
    return { ok: true, opcoes: o };
  };

  const desenharTabela = () => {
    if (!parcelas.length) { tabela.replaceChildren(); return; }
    const base = v(dataBase);
    const rec = recebido();
    tabela.replaceChildren(el('div', { class: 'tabela-container' }, el('table', { class: 'tabela tabela-parcelas', id: 'tabela-parcelas' },
      el('caption', { class: 'visualmente-oculto' }, 'Prévia das parcelas: número, prazo, vencimento, valor, situação e forma'),
      el('thead', {}, el('tr', {}, ...['Nº', 'DDL', 'Vencimento', 'Valor (R$)', 'Situação', 'Forma'].map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', {}, ...parcelas.map((p, i) => {
        const venc = el('input', { type: 'date', id: `parcela-venc-${i}`, name: `parcela-venc-${i}`, value: p.vencimento, min: hoje, 'aria-label': `Vencimento da parcela ${i + 1}`, 'aria-describedby': `parcela-venc-${i}-erro` });
        const valor = el('input', { type: 'text', inputmode: 'decimal', id: `parcela-valor-${i}`, name: `parcela-valor-${i}`, value: paraCampo(p.valor_centavos), 'aria-label': `Valor da parcela ${i + 1} em reais`, 'aria-describedby': `parcela-valor-${i}-erro` });
        const formaSel = el('select', { id: `parcela-forma-${i}`, name: `parcela-forma-${i}`, 'aria-label': `Forma de pagamento da parcela ${i + 1}` },
          el('option', { value: '' }, '—'), ...formas.map(([f, r]) => el('option', { value: f, selected: f === p.forma }, r)));
        const ddl = el('span', { id: `parcela-ddl-${i}` }, String(diferencaDias(base, p.vencimento)));
        venc.addEventListener('input', () => { p.vencimento = venc.value; editadas = true; ddl.textContent = diaCivil(venc.value) !== null ? String(diferencaDias(v(dataBase), venc.value)) : '—'; atualizarResumo(); });
        valor.addEventListener('input', () => { const r = lerValorEmReais(valor.value); p.valor_centavos = r.ok ? r.centavos : Number.NaN; editadas = true; atualizarResumo(); });
        formaSel.addEventListener('change', () => { p.forma = formaSel.value; editadas = true; });
        const situacao = i === 0 && rec > 0 ? `Recebe ${reais(Math.min(rec, Number.isSafeInteger(p.valor_centavos) ? p.valor_centavos : rec))} agora` : 'A receber';
        return el('tr', { 'data-parcela': i },
          el('th', { scope: 'row', 'data-rotulo': 'Nº' }, String(i + 1)),
          el('td', { 'data-rotulo': 'DDL' }, ddl),
          el('td', { 'data-rotulo': 'Vencimento' }, venc, el('span', { class: 'campo__erro', id: `parcela-venc-${i}-erro` })),
          el('td', { 'data-rotulo': 'Valor (R$)' }, valor, el('span', { class: 'campo__erro', id: `parcela-valor-${i}-erro` })),
          el('td', { 'data-rotulo': 'Situação', class: 'situacao-parcela' }, situacao),
          el('td', { 'data-rotulo': 'Forma' }, formaSel));
      })))));
  };

  const atualizarResumo = () => {
    const t = total();
    const rec = recebido();
    const parcelado = condicao.querySelector('input:checked').value === 'parcelado';
    const itens = [['Total da venda', reais(Math.max(t, 0))]];
    if (parcelado && parcelas.length) {
      const soma = parcelas.reduce((s, p) => s + (Number.isSafeInteger(p.valor_centavos) ? p.valor_centavos : 0), 0);
      const dif = t - soma;
      itens.push(['Soma das parcelas', reais(soma)], ['Diferença', dif === 0 ? 'nenhuma' : `${dif > 0 ? 'faltam' : 'sobram'} ${reais(Math.abs(dif))}`, dif === 0 ? 'ok' : 'alerta']);
    }
    if (rec > 0) itens.push(['Recebido agora', reais(rec)]);
    itens.push(['Saldo a receber', reais(Math.max(t - rec, 0))]);
    resumo.replaceChildren(...[el('dl', { class: 'resumo-ficha' }, ...itens.map(([k, val, est]) => el('div', { class: est ? `resumo--${est}` : null }, el('dt', {}, el('small', {}, k)), el('dd', {}, el('strong', {}, val))))),
      parcelado && parcelas.length && totalGerado !== null && totalGerado !== t
        ? el('p', { class: 'aviso aviso--alerta aviso--compacto', id: 'aviso-total-mudou' }, 'O total mudou depois de gerar as parcelas. Gere de novo ou ajuste os valores.') : null].filter(Boolean));
    const situacoes = tabela.querySelectorAll('.situacao-parcela');
    situacoes.forEach((s, i) => { s.textContent = i === 0 && rec > 0 ? `Recebe ${reais(Math.min(rec, parcelas[0]?.valor_centavos || rec))} agora` : 'A receber'; });
  };

  const executarGerar = async () => {
    erroGerar.textContent = '';
    const g = opcoesDoGerador();
    if (!g.ok) { erroGerar.textContent = g.erro; blocoParcelado.querySelector(`[name="${g.campo}"]`)?.focus(); return; }
    const r = gerarParcelas(g.opcoes);
    if (!r.ok) { erroGerar.textContent = r.erro; return; }
    if (editadas && parcelas.length) {
      const ok = await abrirDialogo({ titulo: 'Substituir as parcelas?', mensagens: ['Você alterou valores ou datas das parcelas. Gerar de novo apaga essas alterações.'],
        rotuloConfirmar: 'Gerar de novo', rotuloCancelar: 'Manter as minhas' });
      if (!ok) return;
    }
    const f = v(forma);
    parcelas = r.parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor_centavos: p.valor_centavos, forma: f }));
    editadas = false;
    totalGerado = g.opcoes.total;
    desenharTabela();
    atualizarResumo();
    tabela.querySelector('#parcela-valor-0')?.focus();
  };
  gerar.addEventListener('click', executarGerar);
  dataBase.querySelector('input').addEventListener('change', () => { if (parcelas.length) desenharTabela(); });

  function atualizar() {
    atualizarResumo();
  }

  /** Lê a condição para enviar ao banco; devolve o objeto `pagamento` (sem o recebimento) ou null com o erro mostrado. */
  function ler(form) {
    const cond = condicao.querySelector('input:checked').value;
    const f = v(forma) || null;
    if (cond === 'a_vista') return f ? { condicao: 'a_vista', forma: f } : { condicao: 'a_vista' };
    if (!parcelas.length) { erroGerar.textContent = 'Clique em "Gerar parcelas" e confira a prévia antes de confirmar.'; gerar.focus(); return null; }
    for (let i = 0; i < parcelas.length; i += 1) {
      const val = lerValorEmReais(form.querySelector(`#parcela-valor-${i}`).value);
      if (!val.ok) return erroNoCampo(form, `parcela-valor-${i}`, val.erro) && null;
      parcelas[i].valor_centavos = val.centavos;
    }
    const c = conferirParcelas(parcelas, total(), hoje);
    if (!c.ok) {
      if (c.indice !== undefined) return erroNoCampo(form, `parcela-${c.campo === 'valor' ? 'valor' : 'venc'}-${c.indice}`, c.erro) && null;
      erroGerar.textContent = `${c.erro} Diferença: ${reais(Math.abs(c.diferenca ?? 0))}.`;
      return null;
    }
    return { condicao: 'parcelado', parcelas: parcelas.map((p) => ({ valor_centavos: p.valor_centavos, vencimento: p.vencimento, ...(p.forma ? { forma: p.forma } : {}) })) };
  }

  const elemento = el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-pagamento' },
    el('h3', { id: 'titulo-pagamento' }, 'Condições de pagamento'),
    el('div', { class: 'grade-filtros' }, condicao, forma), blocoParcelado, resumo);
  ajustarVisiveis();
  return { elemento, ler, atualizar, parcelado: () => condicao.querySelector('input:checked').value === 'parcelado', primeiraParcela: () => parcelas[0]?.valor_centavos ?? null,
    dataBr };
}
