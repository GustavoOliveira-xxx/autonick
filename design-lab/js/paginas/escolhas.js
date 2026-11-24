import { h, esc, cabecalho, toast } from '../ui.js';
import { CATEGORIAS, TODOS, G, porId, D_CHAVES } from '../catalogo.js';
import { CENAS } from './areas.js';
import { CONTEXTOS, LOADERS } from '../loaders.js';
import { loja } from '../estado.js';

const listaDe = (cat) => (cat === 'G' ? G.map((g) => ({ ...g, nome: LOADERS[g.id].nome })) : cat === 'I' ? CENAS : TODOS[cat] ?? []);
const local = ['127.0.0.1', 'localhost'].includes(location.hostname);

export function exportarTexto(d) {
  const L = [];
  L.push('AUTONICK · ESCOLHAS DE DIREÇÃO VISUAL', `Exportado em ${new Date().toLocaleString('pt-BR')} pelo AutoniCK Design Lab.`, 'Usar como especificação para implementar na interface principal, depois da aprovação.', '');
  for (const c of CATEGORIAS) {
    const id = d.escolhas[c.id]; const p = id ? (porId(id) ?? CENAS.find((x) => x.id === id)) : null;
    L.push(`${c.id} · ${c.nome}: ${p ? `${id} ${p.nome}` : '(sem escolha)'}`);
    if (p?.resumo) L.push(`   ${p.resumo}`);
    if (c.id === 'E' && id) L.push(`   Intensidade: ${{ 1: 'sutil', 2: 'equilibrada', 3: 'expressiva' }[d.intensidadeE] ?? 'equilibrada'}`);
    const favs = d.favoritos.filter((f) => f.startsWith(c.id) && f !== id);
    if (favs.length) L.push(`   Também favoritas: ${favs.map((f) => `${f} ${(porId(f) ?? CENAS.find((x) => x.id === f))?.nome ?? ''}`).join('; ')}`);
    if (d.notas[c.id]) L.push(`   Observações: ${d.notas[c.id]}`);
  }
  L.push('', 'LOADER POR CONTEXTO');
  for (const c of CONTEXTOS) { const id = d.loadersPorContexto[c.id] ?? c.sugestao; L.push(`- ${c.nome}: ${id} ${LOADERS[id].nome}${d.loadersPorContexto[c.id] ? '' : ' (sugestão aceita)'}`); }
  if (d.combinador) { L.push('', 'MONTAGEM DO COMBINADOR'); for (const [k, v] of Object.entries(d.combinador)) if (v != null) L.push(`- ${k}: ${v}`); }
  const kf = d.favoritos.filter((f) => f.startsWith('K')); if (kf.length) L.push('', `Combinações favoritas: ${kf.map((f) => `${f} ${porId(f)?.nome}`).join('; ')}`);
  if (d.notas.geral) L.push('', 'OBSERVAÇÕES GERAIS', d.notas.geral);
  L.push('', 'Restrições: orçamento R$ 0; sem serviços pagos; sem deploy; não alterar o banco remoto; manter acessibilidade (movimento reduzido, teclado, contraste AA) e a identidade CK predominante.');
  return L.join('\n');
}
export const exportarJSON = (d) => JSON.stringify({ origem: 'AutoniCK Design Lab', exportadoEm: new Date().toISOString(), ...d }, null, 2);

export function montar(main) {
  main.append(cabecalho('♥', 'Minhas escolhas', `Uma opção por categoria, favoritas e observações. ${loja.persistente ? 'Fica guardado neste navegador.' : 'O armazenamento deste navegador está bloqueado: exporte antes de fechar.'} Exporte em texto (para mandar à IA como especificação) ou em JSON (para importar em outro navegador).`));
  const tabela = h('<div class="tabela-lab-wrap"><table class="tabela-lab"><thead><tr><th>Categoria</th><th>Sua escolha</th><th>Favoritas</th><th>Observações</th></tr></thead><tbody></tbody></table></div>');
  const tbody = tabela.querySelector('tbody');
  function render() {
    tbody.innerHTML = '';
    for (const c of CATEGORIAS) {
      const lista = listaDe(c.id); const sel = loja.escolhida(c.id) ?? '';
      const favs = loja.d.favoritos.filter((f) => f.startsWith(c.id));
      const tr = h(`<tr><td><a href="#${c.rota}"><b>${c.id}</b> ${esc(c.nome)}</a></td>
        <td><select aria-label="Escolha para ${esc(c.nome)}"><option value="">(sem escolha)</option>${lista.map((p) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${p.id} · ${esc(p.nome)}</option>`).join('')}</select></td>
        <td>${favs.length ? favs.map((f) => `<span class="id" title="${esc((porId(f) ?? CENAS.find((x) => x.id === f))?.nome ?? '')}">${f}</span>`).join(' ') : '<span style="color:var(--texto-3)">nenhuma</span>'}</td>
        <td><textarea aria-label="Observações sobre ${esc(c.nome)}" rows="2" style="width:100%;min-width:12rem;background:var(--mesa);border:1px solid var(--linha-forte);border-radius:6px;padding:.3rem .5rem">${esc(loja.d.notas[c.id] ?? '')}</textarea></td></tr>`);
      tr.querySelector('select').addEventListener('change', (e) => { if (e.target.value) loja.d.escolhas[c.id] = e.target.value; else delete loja.d.escolhas[c.id]; loja.salvar(); });
      tr.querySelector('textarea').addEventListener('change', (e) => loja.anotar(c.id, e.target.value));
      tbody.append(tr);
    }
  }
  render();
  const geral = h(`<section class="painel"><h2>Observações gerais</h2><label class="campo-lab" for="es-geral">O que você quer garantir na implementação<textarea id="es-geral">${esc(loja.d.notas.geral ?? '')}</textarea></label></section>`);
  geral.querySelector('textarea').addEventListener('change', (e) => loja.anotar('geral', e.target.value));
  const exp = h(`<section class="painel"><h2>Exportar e importar</h2>
    <div class="acoes-proposta"><button type="button" class="bt bt--ouro" data-txt>Copiar texto legível</button><button type="button" class="bt" data-json>Copiar JSON</button>${local ? '<button type="button" class="bt" data-baixar-txt>Baixar .txt</button><button type="button" class="bt" data-baixar-json>Baixar .json</button>' : ''}</div>
    <label class="campo-lab" for="es-saida">Prévia (selecionável)<textarea id="es-saida" rows="14" readonly style="font-family:var(--f-mono);font-size:.78rem"></textarea></label>
    <h3>Importar JSON</h3><label class="campo-lab" for="es-imp">Cole aqui um JSON exportado<textarea id="es-imp" rows="4"></textarea></label>
    <div class="acoes-proposta"><button type="button" class="bt" data-imp>Importar</button><button type="button" class="bt bt--perigo" data-zerar>Apagar tudo</button></div><div data-conf></div></section>`);
  const saida = exp.querySelector('#es-saida');
  const atualizarSaida = (tipo = 'txt') => { saida.value = tipo === 'json' ? exportarJSON(loja.d) : exportarTexto(loja.d); };
  const copiar = async (tipo) => { atualizarSaida(tipo); try { await navigator.clipboard.writeText(saida.value); toast('Copiado.'); } catch { saida.focus(); saida.select(); toast('Não deu para copiar automaticamente: o texto está selecionado, use Ctrl+C.'); } };
  exp.querySelector('[data-txt]').addEventListener('click', () => copiar('txt'));
  exp.querySelector('[data-json]').addEventListener('click', () => copiar('json'));
  const baixar = (tipo) => { atualizarSaida(tipo); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([saida.value], { type: tipo === 'json' ? 'application/json' : 'text/plain' })); a.download = `autonick-escolhas.${tipo}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  exp.querySelector('[data-baixar-txt]')?.addEventListener('click', () => baixar('txt'));
  exp.querySelector('[data-baixar-json]')?.addEventListener('click', () => baixar('json'));
  exp.querySelector('[data-imp]').addEventListener('click', () => {
    try { loja.importar(JSON.parse(exp.querySelector('#es-imp').value)); render(); atualizarSaida(); toast('Escolhas importadas.'); }
    catch (e) { toast(`Não foi possível importar: ${e.message}`); }
  });
  const conf = exp.querySelector('[data-conf]');
  exp.querySelector('[data-zerar]').addEventListener('click', () => {
    conf.replaceChildren(h('<div class="confirmacao"><span>Apagar escolhas, favoritas e observações deste navegador?</span><button type="button" class="bt bt--perigo bt--pequeno" data-sim>Apagar</button><button type="button" class="bt bt--pequeno" data-nao>Manter</button></div>'));
    conf.querySelector('[data-sim]').addEventListener('click', () => { loja.zerar(); render(); atualizarSaida(); conf.innerHTML = ''; toast('Tudo apagado.'); });
    conf.querySelector('[data-nao]').addEventListener('click', () => { conf.innerHTML = ''; });
  });
  const parar = loja.ouvir(() => atualizarSaida());
  atualizarSaida();
  main.append(tabela, geral, exp);
  return () => parar();
}
