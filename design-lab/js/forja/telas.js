// Telas da prévia CK Forja Noturna. Dados fictícios da demonstração do AutoniCK ([TESTE] Conserta Celular).
// Cada tela: { id, nome, html(), ativar(raiz, ctx) → destruir }. ctx.controles([...]) cria botões de simulação
// na bancada (fora do app), para disparar os eventos reais que cada animação espera.

import { montarCena, fotoCena, sinoMini, operacao, botaoForja, contar, montarHeroi, URL_POSTER } from './pecas.js';
import { RUNTIME } from '../estado.js';

const LOGO = 'public/assets/brand/autonick-geral-320.webp';
const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const icone = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONES = {
  painel: icone('<rect x="3" y="3" width="7" height="8" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/>'),
  vendas: icone('<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>'),
  estoque: icone('<path d="M3 8l9-5 9 5-9 5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),
  financeiro: icone('<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.6-3.1-1.7M12 6v2M12 16v2"/>'),
  produtos: icone('<path d="M20 12l-8 8-8-8V4h8z"/><circle cx="8.5" cy="8.5" r="1.5"/>'),
  ordens: icone('<path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L3 18l3 3 6.1-6.1a4 4 0 0 0 5.6-5.6l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  agenda: icone('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  relatorios: icone('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  buscar: icone('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  pedidos: icone('<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>'),
  orcamentos: icone('<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>'),
  servicos: icone('<path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L3 18l3 3 6.1-6.1a4 4 0 0 0 5.6-5.6l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  conta: icone('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
};
const modulo = (letra, rotulo, titulo, texto, acoes = '') => `<header class="fn-modulo"><div><p class="fn-rotulo"><i>${letra}</i>${rotulo}</p><h1 class="fn-titulo">${titulo}</h1>${texto ? `<p>${texto}</p>` : ''}</div>${acoes ? `<div class="fn-acoes">${acoes}</div>` : ''}</header>`;
const bt = (rot, cls = '', attrs = '') => `<button type="button" class="fn-bt ${cls}" ${attrs}><span class="fb-rot">${rot}</span></button>`;
const nada = () => () => {};

/* =============================== PÚBLICO =============================== */
const HOME = {
  id: 'home', nome: 'Página inicial',
  html: () => `
  <section class="fn-heroi" aria-labelledby="h-home">
    <div class="fn-heroi-fundo" aria-hidden="true"><div class="fn-ceu"></div><div class="fn-raios-corte"><div class="fn-raios"></div></div><div class="fn-contraluz"></div><div class="fn-piso"></div><div class="fn-holofote"></div><div class="fn-contato"></div><div class="fn-horizonte"></div><div class="fn-reticula"></div><div class="fn-vinheta"></div></div>
    <div class="fn-heroi-in">
      <div class="fn-heroi-texto fn-entra">
        <h1 id="h-home">Bem-vindo ao <em>AutoniCK</em></h1>
        <p class="fn-resumo">Encontre negócios e serviços perto de você ou organize as vendas, o estoque e o atendimento do seu negócio.</p>
        <div class="fn-perfis">
          <div class="fn-perfil"><div><b>Sou cliente</b><p>encontrar negócios e serviços</p></div><div class="fn-acoes">${bt('Criar conta', '', 'data-ir="publico/entrar"')}${bt('Entrar', 'fn-bt--sec', 'data-ir="publico/entrar"')}</div></div>
          <div class="fn-perfil"><div><b>Tenho um negócio</b><p>organizar vendas, estoque e atendimento</p></div><div class="fn-acoes">${bt('Criar conta', '', 'data-ir="business/painel"')}${bt('Entrar', 'fn-bt--sec', 'data-ir="business/painel"')}</div></div>
        </div>
      </div>
      <div class="fn-heroi-sino" role="img" aria-label="Sino do AutoniCK com a animação Chamado da Forja"><img class="fn-poster" src="${URL_POSTER}" alt=""></div>
    </div>
  </section>
  <section class="fn-abaixo fn-secao"><h2>O que você quer fazer?</h2><div class="fn-escolhas fn-entra">
    <article class="fn-cartao fn-cartao--hq fn-cartao--vivo fn-escolha"><h3>Encontrar produtos e serviços</h3><p>Pesquise por nome, serviço, cidade ou bairro. Não precisa criar conta para olhar.</p>${bt('Começar a busca', '', 'data-ir="cliente/descobrir"')}</article>
    <article class="fn-cartao fn-cartao--hq fn-cartao--vivo fn-escolha"><h3>Gerenciar meu negócio</h3><p>Produtos, estoque, vendas e serviços da sua empresa em um só lugar.</p>${bt('Ir para o AutoniCK Business', '', 'data-ir="business/painel"')}</article>
  </div></section>`,
  ativar(raiz, ctx) {
    const h = montarHeroi(raiz.querySelector('.fn-heroi')); globalThis.__fnHeroi = h;
    ctx.controles([['Recomeçar o Chamado da Forja', () => h.vista?.irPara(0)]]);
    return () => h.destruir();
  },
};
const ENTRAR = {
  id: 'entrar', nome: 'Entrar',
  html: () => `<div class="fn-auth fn-entra">${modulo('C', 'Área do cliente', 'Entrar', 'Use o e-mail da sua conta de teste.')}
    <form class="fn-cartao fn-cartao--filete" style="display:grid;gap:.9rem" onsubmit="return false" novalidate>
      <div class="fn-campo"><label for="e-mail">E-mail</label><input id="e-mail" type="email" value="cida@exemplo.com" autocomplete="email"></div>
      <div class="fn-campo"><label for="e-senha">Senha</label><input id="e-senha" type="password" value="••••••••" autocomplete="current-password"></div>
      <div class="fn-acoes" style="align-items:center">${bt('Entrar', '', 'type="submit" data-entrar')}<span class="fn-status" data-status></span></div>
    </form></div>`,
  ativar(raiz, ctx) {
    const st = raiz.querySelector('[data-status]');
    const b = botaoForja(raiz.querySelector('[data-entrar]'), {
      rotulos: { sucesso: 'Pronto' },
      executar: () => { st.replaceChildren(sinoMini(), document.createTextNode('Conferindo seus dados…')); return operacao(); },
      aoFim: (r) => { st.textContent = r === 'sucesso' ? 'Bem-vinda, Cida.' : ''; if (r === 'sucesso') setTimeout(() => { ctx.entrar(); ctx.irPara('cliente', 'descobrir'); }, 700); },
    });
    return () => b.destruir();
  },
};

/* =============================== BUSINESS =============================== */
const PAINEL = {
  id: 'painel', nome: 'Painel (dashboard)',
  html: () => `${modulo('B', 'Operação', 'Painel', 'segunda-feira, 23 de novembro · [TESTE] Conserta Celular', `${bt('Nova venda', '', 'data-ir="business/vendas"')}${bt('Orçamentos', 'fn-bt--sec')}${bt('Lançar no financeiro', 'fn-bt--sec', 'data-ir="business/financeiro"')}`)}
  <section class="fn-secao"><h2>Precisa da sua ação</h2><div class="fn-fichas fn-entra">
    <a class="fn-cartao fn-cartao--hq fn-ficha" href="#p"><b>1</b><span>Pedidos aguardando aceite</span><small>Cida Ramos · R$ 69,00</small><span class="fn-ir">Ver pedidos →</span></a>
    <a class="fn-cartao fn-cartao--hq fn-ficha" href="#p"><b>0</b><span>Orçamentos para responder</span><small>Nenhum esperando resposta</small><span class="fn-ir">Responder →</span></a>
    <a class="fn-cartao fn-cartao--hq fn-ficha" href="#p"><b>2</b><span>Ordens de serviço em andamento</span><small>Nenhuma atrasada</small><span class="fn-ir">Ver OS →</span></a>
    <a class="fn-cartao fn-cartao--hq fn-ficha" href="#p"><b>1</b><span>Mensagens novas</span><small>Em 1 atendimento</small><span class="fn-ir">Ver conversas →</span></a></div></section>
  <section class="fn-secao"><h2>Números da empresa</h2><div class="fn-indicadores">
    <div class="fn-escudo fn-kpi fn-kpi-carga" style="position:relative"><div class="fn-escudo-cab">Vendas de novembro</div><div class="fn-escudo-corpo"><div class="fn-valor-meta"><div style="display:grid;gap:.3rem"><span class="fn-valor" data-vendas>R$ 0,00</span><span class="fn-legenda" data-meta-leg>3 vendas confirmadas</span></div><div class="fn-meta-moeda" data-moeda></div></div><div class="fn-barras" data-barras></div><div class="fn-rotulos"><span>Sem. 1</span><span>Sem. 2</span><span>Sem. 3</span><span>Sem. 4</span></div></div></div>
    <div class="fn-col"><div class="fn-escudo fn-kpi fn-kpi-carga"><div class="fn-escudo-cab">A receber · 7 dias</div><div class="fn-escudo-corpo"><span class="fn-valor" data-v="300">R$ 0,00</span><span class="fn-legenda">2 parcelas</span></div></div>
      <div class="fn-escudo fn-kpi fn-kpi-carga"><div class="fn-escudo-cab">Saldo das contas</div><div class="fn-escudo-corpo"><span class="fn-valor" data-v="184">R$ 0,00</span><span class="fn-legenda">Registrado no AutoniCK; não é extrato bancário.</span></div></div></div>
    <div class="fn-col"><div class="fn-escudo fn-kpi fn-kpi-carga"><div class="fn-escudo-cab">A pagar · 7 dias</div><div class="fn-escudo-corpo"><span class="fn-valor" data-v="1500">R$ 0,00</span><span class="fn-legenda">1 conta</span></div></div>
      <div class="fn-escudo fn-kpi fn-kpi-carga"><div class="fn-escudo-cab">Estoque baixo</div><div class="fn-escudo-corpo"><span class="fn-legenda" style="display:flex;justify-content:space-between;color:var(--fn-texto);font-weight:600">Capa de silicone <span>1 de 5</span></span><span class="fn-nivel"><i style="width:20%"></i></span></div></div></div>
  </div><p class="fn-legenda" data-dep></p></section>`,
  ativar(raiz, ctx) {
    let moeda = null; const timers = [];
    const carregar = () => {
      raiz.querySelectorAll('.fn-kpi').forEach((k) => k.classList.add('fn-kpi-carga')); raiz.querySelector('[data-barras]').innerHTML = '';
      moeda?.destruir(); moeda = null;
      timers.push(setTimeout(() => { // G07: cada indicador chega quando a consulta (simulada) responde
        raiz.querySelectorAll('.fn-kpi').forEach((k) => k.classList.remove('fn-kpi-carga'));
        raiz.querySelector('[data-barras]').innerHTML = '<i style="height:5%"></i><i style="height:5%"></i><i style="height:5%"></i><i style="height:94%"></i>';
        contar(raiz.querySelector('[data-vendas]'), 304, { dur: 1.7 });
        raiz.querySelectorAll('[data-v]').forEach((e) => contar(e, Number(e.dataset.v)));
        const meta = ctx.estado.metaConfigurada ? 300 : null;
        raiz.querySelector('[data-dep]').textContent = meta ? '' : 'IB01 pronto, mas desligado: o AutoniCK ainda não tem cadastro de metas. A moeda só celebra quando uma meta existente for atingida.';
        raiz.querySelector('[data-meta-leg]').textContent = meta ? `3 vendas confirmadas · meta ${brl(meta)} atingida` : '3 vendas confirmadas';
        if (meta && 304 >= meta) { moeda = montarCena(raiz.querySelector('[data-moeda]'), 'IB01', { rotulo: 'Meta atingida' }); moeda.disparar(); }
      }, Math.min(1400, SIM().latencia)));
    };
    carregar();
    ctx.controles([['Recarregar o painel (G07 + IB01)', carregar], [`Meta configurada: ${ctx.estado.metaConfigurada ? 'sim' : 'não'} (dependência futura)`, () => { ctx.estado.metaConfigurada = !ctx.estado.metaConfigurada; ctx.recarregar(); }]]);
    return () => { timers.forEach(clearTimeout); moeda?.destruir(); };
  },
};
const VENDAS = {
  id: 'vendas', nome: 'Vendas',
  html: () => `${modulo('B', 'Operação', 'Vendas', 'Vendas confirmadas e nova venda.')}
  <div class="fn-duas">
    <section class="fn-secao"><h2>Nova venda</h2><form class="fn-cartao fn-cartao--filete" style="display:grid;gap:.9rem" onsubmit="return false">
      <div class="fn-campo"><label for="v-cli">Cliente</label><input id="v-cli" value="Cida Ramos"></div>
      <div class="fn-campo"><label for="v-pag">Pagamento</label><select id="v-pag"><option>Pix</option><option>Dinheiro</option><option>Cartão</option></select></div>
      <div class="fn-campo"><span class="fn-rot">Itens</span><small>Capa de silicone (R$ 29,90) · Película 3D (R$ 39,99)</small></div>
      <div class="fn-acoes" style="align-items:center">${bt('Salvar venda', '', 'data-salvar')}<span class="fn-status" data-status aria-live="polite"></span></div></form></section>
    <section class="fn-secao"><h2>Confirmação</h2><div class="fn-cartao" data-conf><p class="fn-legenda">Depois de salvar, a confirmação aparece aqui.</p></div></section>
  </div>
  <section class="fn-secao"><h2>Vendas de novembro</h2><div class="fn-tabela-wrap"><table class="fn-tabela"><thead><tr><th>Nº</th><th>Cliente</th><th>Pagamento</th><th class="num">Total</th><th>Situação</th></tr></thead><tbody data-linhas></tbody></table></div></section>`,
  ativar(raiz, ctx) {
    const corpo = raiz.querySelector('[data-linhas]'); let cena = null; const timers = [];
    const linhas = [['17', 'Jonas Prado', 'Cartão', 120], ['16', 'Ana Lu', 'Pix', 115], ['15', 'Cida Ramos', 'Pix', 69]];
    const consultar = () => { corpo.innerHTML = '<tr class="fn-esq"><td><span style="width:2rem"></span></td><td><span></span></td><td><span style="width:60%"></span></td><td><span></span></td><td><span style="width:70%"></span></td></tr>'.repeat(3);
      timers.push(setTimeout(() => { corpo.innerHTML = linhas.map(([n, c, p, v]) => `<tr><td>${n}</td><td>${c}</td><td>${p}</td><td class="num">${brl(v)}</td><td><span class="fn-chip fn-chip--ok">✓ Confirmada</span></td></tr>`).join(''); }, Math.min(1600, SIM().latencia))); };
    consultar();
    const st = raiz.querySelector('[data-status]'); const conf = raiz.querySelector('[data-conf]');
    const b = botaoForja(raiz.querySelector('[data-salvar]'), {
      rotulos: { processando: 'Salvando…', sucesso: 'Venda salva' },
      executar: () => { st.replaceChildren(sinoMini(), document.createTextNode('Salvando a venda…')); return operacao(); },
      aoFim: (r) => {
        st.textContent = r === 'sucesso' ? '' : 'Não foi salva. Confira e tente de novo.';
        if (r !== 'sucesso') return;
        linhas.unshift(['18', 'Cida Ramos', 'Pix', 69.89]); consultar();
        conf.innerHTML = `<div class="fn-confirmacao"><div data-cena style="width:9rem;height:11rem"></div><div style="display:grid;gap:.4rem"><span class="fn-chip fn-chip--ok">✓ Venda registrada</span><b style="font:800 1.6rem/1 var(--fn-titulo)">Venda nº 18 · R$ 69,89</b><span class="fn-legenda">Cida Ramos · Pix · 2 itens</span><div class="fn-acoes">${bt('Gerar comprovante em PDF', 'fn-bt--sec fn-bt--p', 'data-pdf')}</div><span class="fn-status" data-pdf-st></span></div></div>`;
        cena?.destruir(); cena = montarCena(conf.querySelector('[data-cena]'), 'IB03', { rotulo: 'Venda registrada' }); cena.disparar();
        // documento é outra operação: G08 contextual, e só diz "pronto" quando a geração termina
        const pst = conf.querySelector('[data-pdf-st]');
        botaoForja(conf.querySelector('[data-pdf]'), { rotulos: { processando: 'Gerando…', sucesso: 'PDF pronto' }, executar: () => { pst.replaceChildren(sinoMini(), document.createTextNode('Gerando o PDF da venda…')); return operacao({ fator: 1.6 }); }, aoFim: (rr) => { pst.textContent = rr === 'sucesso' ? 'PDF pronto para baixar (demonstração).' : 'Não foi possível gerar o PDF.'; } });
      },
    });
    return () => { b.destruir(); cena?.destruir(); timers.forEach(clearTimeout); };
  },
};
const ESTOQUE = {
  id: 'estoque', nome: 'Estoque',
  html: () => `${modulo('B', 'Catálogo', 'Estoque', 'Disponível, físico e reservado por produto.')}
  <div data-vazio></div>
  <section class="fn-secao" data-lista style="position:relative"><h2>Produtos em estoque</h2><div class="fn-tabela-wrap" style="position:relative"><div data-fio></div><table class="fn-tabela"><thead><tr><th>Produto</th><th class="num">Disponível</th><th class="num">Reservado</th><th></th></tr></thead><tbody>
    <tr><td>Película 3D</td><td class="num">12</td><td class="num">0</td><td style="text-align:right">${bt('Dar baixa de 1', 'fn-bt--sec fn-bt--p', 'data-baixa')}</td></tr>
    <tr><td>Capa de silicone</td><td class="num">1</td><td class="num">0</td><td style="text-align:right"><span class="fn-chip fn-chip--alerta">! Estoque baixo</span></td></tr>
    <tr><td>Cabo USB-C</td><td class="num">7</td><td class="num">2</td><td></td></tr></tbody></table></div></section>`,
  ativar(raiz, ctx) {
    let cena = null; const vazio = raiz.querySelector('[data-vazio]'); const lista = raiz.querySelector('[data-lista]');
    const mostrarVazio = (sim) => {
      cena?.destruir(); cena = null; lista.hidden = sim; vazio.innerHTML = '';
      if (!sim) return;
      vazio.innerHTML = `<div class="fn-vazio"><div data-cena style="width:10rem;height:10rem"></div><div><h3>Nenhum produto no estoque</h3><p class="fn-legenda">Cadastre o primeiro produto para controlar disponível, físico e reservado.</p><div class="fn-acoes" style="margin-top:.7rem">${bt('Cadastrar produto', '', 'data-ir="business/produtos"')}</div></div></div>`;
      cena = montarCena(vazio.querySelector('[data-cena]'), 'IB02', { rotulo: 'Estoque vazio' }); cena.disparar();
    };
    const linha = raiz.querySelector('[data-baixa]').closest('tr'); const fio = raiz.querySelector('[data-fio]');
    const b = botaoForja(raiz.querySelector('[data-baixa]'), { rotulos: { processando: 'Atualizando…', sucesso: 'Atualizado' },
      executar: () => { fio.innerHTML = '<div class="fn-fio" role="progressbar" aria-label="Atualizando estoque"><i></i></div>'; return operacao(); },
      aoFim: (r) => { fio.innerHTML = ''; if (r === 'sucesso') { const c = linha.cells[1]; c.textContent = Number(c.textContent) - 1; linha.classList.remove('fn-atualizada'); void linha.offsetWidth; linha.classList.add('fn-atualizada'); } } });
    ctx.controles([['Mostrar estado vazio (IB02)', () => mostrarVazio(lista.hidden === false)]]);
    return () => { b.destruir(); cena?.destruir(); };
  },
};
const FINANCEIRO = {
  id: 'financeiro', nome: 'Financeiro',
  html: () => `${modulo('B', 'Gestão', 'Financeiro', 'Caixa do dia, contas e fechamento.')}
  <div class="fn-duas"><section class="fn-secao"><h2>Fechar caixa do dia</h2><div class="fn-cartao fn-cartao--filete" style="display:grid;gap:1rem">
    <div class="fn-palco-objeto"><div><p class="fn-legenda">Lançamentos de hoje: 4 · Saldo registrado: R$ 184,00</p><div data-etapas style="margin-top:.8rem"></div></div><div data-cena style="width:9rem;height:10rem"></div></div>
    <div class="fn-acoes" style="align-items:center">${bt('Fechar caixa', '', 'data-fechar')}<span class="fn-status" data-st></span></div></div></section>
  <section class="fn-secao"><h2>Resumo</h2><div class="fn-escudo"><div class="fn-escudo-cab">Saldo das contas</div><div class="fn-escudo-corpo"><span class="fn-valor" data-saldo>R$ 184,00</span><span class="fn-legenda">Registrado no AutoniCK; não é extrato bancário.</span></div></div></section></div>`,
  ativar(raiz, ctx) {
    const cena = montarCena(raiz.querySelector('[data-cena]'), 'IB04', { rotulo: 'Calculadora' });
    const etapasEl = raiz.querySelector('[data-etapas]'); const st = raiz.querySelector('[data-st]');
    const ETAPAS = ['Validando lançamentos', 'Calculando saldo do dia', 'Registrando fechamento'];
    const b = botaoForja(raiz.querySelector('[data-fechar]'), { rotulos: { processando: 'Fechando…', sucesso: 'Caixa fechado' },
      executar: () => {
        const informa = ctx.estado.apiInformaEtapas;
        etapasEl.innerHTML = informa ? `<ol class="fn-etapas" aria-live="polite">${ETAPAS.map((e) => `<li>${e}</li>`).join('')}</ol>` : '<div class="fn-indeterminado" role="progressbar" aria-label="Processando fechamento"><i></i></div><p class="fn-legenda" style="margin-top:.4rem">Processando o fechamento… (a API não informa etapas)</p>';
        st.textContent = ''; cena.definir({ fase: 'processando' }, { manter: true });
        return operacao({ etapas: ETAPAS, informaEtapas: informa, fator: 2, aoEtapa: (i, e) => { const li = etapasEl.querySelectorAll('li')[i]; if (li) li.dataset.e = e; } });
      },
      aoFim: (r) => { if (r === 'sucesso') { cena.definir({ fase: 'concluido', valor: 'R$ 184,00', inicio: 'agora' }); st.textContent = 'Caixa fechado: R$ 184,00.'; if (!ctx.estado.apiInformaEtapas) etapasEl.innerHTML = '<p class="fn-chip fn-chip--ok">✓ Fechamento registrado</p>'; } else { cena.definir({ fase: 'falhou' }); st.textContent = 'O fechamento não foi registrado. Nada mudou.'; etapasEl.querySelectorAll('li[data-e="agora"]').forEach((li) => { li.dataset.e = ''; }); } } });
    ctx.controles([[`API informa etapas: ${ctx.estado.apiInformaEtapas ? 'sim (G09)' : 'não (indeterminado)'}`, () => { ctx.estado.apiInformaEtapas = !ctx.estado.apiInformaEtapas; ctx.recarregar(); }]]);
    return () => { b.destruir(); cena.destruir(); };
  },
};
const PRODUTOS = {
  id: 'produtos', nome: 'Produtos',
  html: () => `${modulo('B', 'Catálogo', 'Produtos', 'Sem foto, o produto mostra a etiqueta com o preço real. Na lista, a etiqueta é uma imagem pré-renderizada; animada só no detalhe.')}
  <div class="fn-duas"><section class="fn-secao"><h2>Catálogo</h2><div class="fn-grade-prod" data-grade></div></section>
  <section class="fn-secao"><h2>Detalhe: Capa de silicone</h2><div class="fn-cartao fn-cartao--filete fn-palco-objeto"><div><p><b>Capa de silicone</b></p><p class="fn-legenda">Sem foto cadastrada · 1 em estoque</p><p class="fn-valor" style="margin-top:.4rem">R$ 29,90</p></div><div data-cena style="width:10rem;height:13rem"></div></div></section></div>`,
  ativar(raiz, ctx) {
    const itens = [['Capa de silicone', 'R$ 29,90'], ['Película 3D', 'R$ 39,99'], ['Cabo USB-C', 'R$ 24,50'], ['Carregador 20W', 'R$ 89,00'], ['Fone com fio', 'R$ 35,00'], ['Suporte veicular', 'R$ 45,90']];
    const g = raiz.querySelector('[data-grade]');
    g.innerHTML = itens.map(([n, p]) => `<div class="fn-cartao fn-cartao--vivo fn-prod"><div class="fn-foto"><img alt="Etiqueta de preço: ${p}" data-preco="${p}"></div><b>${n}</b><small>${p} · sem foto</small></div>`).join('');
    g.querySelectorAll('img').forEach(async (img) => { const url = await fotoCena('IB05', { preco: img.dataset.preco }, { t: 0, largura: 220, altura: 260 }); if (url) img.src = url; });
    const cena = montarCena(raiz.querySelector('[data-cena]'), 'IB05', { continua: true, rotulo: 'R$ 29,90', inicial: { preco: 'R$ 29,90' } }); cena.disparar();
    raiz.querySelector('[data-cena]').addEventListener('pointerenter', () => cena.disparar());
    return () => cena.destruir();
  },
};
const ORDENS = {
  id: 'ordens', nome: 'Ordens de serviço',
  html: () => `${modulo('B', 'Operação', 'OS nº 3 · Troca de tela', 'Cliente: Cida Ramos · em execução')}
  <div class="fn-duas"><section class="fn-secao"><h2>Etapas</h2><ol class="fn-stepper" data-passos>${['Diagnóstico', 'Troca de tela', 'Teste final'].map((p, i) => `<li data-e="${i === 0 ? 'agora' : ''}"><i>${i + 1}</i><span>${p}</span>${bt('Concluir etapa', 'fn-bt--sec fn-bt--p', `data-passo="${i}"${i ? ' disabled' : ''}`)}</li>`).join('')}</ol>
    <div class="fn-acoes" style="align-items:center">${bt('Informar conclusão ao cliente', '', 'data-concluir disabled')}<span class="fn-status" data-st></span></div></section>
  <section class="fn-secao"><h2>Andamento</h2><div class="fn-cartao" data-cena style="height:14rem"></div></section></div>`,
  ativar(raiz) {
    const cena = montarCena(raiz.querySelector('[data-cena]'), 'IB06', { rotulo: 'Andamento da OS', inicial: { passos: [] } }); const ligados = [];
    raiz.querySelectorAll('[data-passo]').forEach((btn) => ligados.push(botaoForja(btn, { rotulos: { processando: 'Salvando…', sucesso: 'Concluída' }, executar: () => operacao(),
      aoFim: (r) => { if (r !== 'sucesso') return; const i = Number(btn.dataset.passo); const li = btn.closest('li'); li.dataset.e = 'feito'; btn.disabled = true;
        const prox = raiz.querySelector(`[data-passo="${i + 1}"]`); if (prox) { prox.disabled = false; prox.closest('li').dataset.e = 'agora'; } else raiz.querySelector('[data-concluir]').disabled = false;
        cena.pronto.then((v) => { if (v) cena.definir({ passos: [...(cena.mem.passos ?? []), v.t] }); }); } })));
    const st = raiz.querySelector('[data-st]');
    ligados.push(botaoForja(raiz.querySelector('[data-concluir]'), { rotulos: { processando: 'Enviando…', sucesso: 'Cliente avisado' }, executar: () => operacao(),
      aoFim: (r) => { if (r === 'sucesso') { cena.definir({ concluida: 'agora' }); st.textContent = 'A cliente foi avisada da conclusão.'; } } }));
    return () => { ligados.forEach((l) => l.destruir()); cena.destruir(); };
  },
};
const AGENDA = {
  id: 'agenda', nome: 'Agenda',
  html: () => `${modulo('B', 'Operação', 'Agenda', 'Compromissos de hoje.')}
  <div class="fn-duas"><section class="fn-secao"><h2>Hoje</h2><ul class="fn-cartao fn-agenda" style="padding:0"><li data-lembrete><time>14:30</time><div><b>Retirada · Cida Ramos</b><br><small class="fn-legenda">OS nº 3 · troca de tela</small></div><span class="fn-chip fn-chip--info">em 15 min</span></li><li><time>16:00</time><div><b>Orçamento · Jonas Prado</b><br><small class="fn-legenda">troca de bateria</small></div><span></span></li></ul></section>
  <section class="fn-secao"><h2>Lembrete</h2><div class="fn-cartao fn-palco-objeto"><p class="fn-legenda" data-msg>Sem lembretes agora.</p><div data-cena style="width:7rem;height:7rem"></div></div></section></div>`,
  ativar(raiz, ctx) {
    const cena = montarCena(raiz.querySelector('[data-cena]'), 'IB07', { rotulo: 'Lembrete' });
    ctx.controles([['Disparar lembrete das 14:30 (IB07)', () => { raiz.querySelector('[data-msg]').innerHTML = '<b>14:30 · Retirada de Cida Ramos</b><br>Começa em 15 minutos.'; cena.disparar(); }]]);
    return () => cena.destruir();
  },
};
const RELATORIOS = {
  id: 'relatorios', nome: 'Relatórios',
  html: () => `${modulo('B', 'Gestão', 'Relatórios', 'Vendas por semana. Sem 3D: o dado é o protagonista.')}
  <section class="fn-cartao fn-cartao--filete fn-secao"><h2>Novembro</h2><div class="fn-relat" data-relat></div></section>`,
  ativar(raiz, ctx) {
    const desenhar = () => { const v = [[42, 'Sem. 1'], [80, 'Sem. 2'], [61, 'Sem. 3'], [182, 'Sem. 4']]; raiz.querySelector('[data-relat]').innerHTML = v.map(([n, s], i) => `<div><b class="fn-num" style="color:var(--fn-texto)">${brl(n)}</b><i style="height:${(n / 182) * 75}%;animation-delay:${i * 80}ms"></i><span>${s}</span></div>`).join(''); };
    desenhar(); ctx.controles([['Recarregar relatório (IB08)', desenhar]]); return nada();
  },
};

/* =============================== CLIENTE =============================== */
const DESCOBRIR = {
  id: 'descobrir', nome: 'Descoberta',
  html: () => `<section class="fn-busca"><h1>Serviços perto de você</h1><p class="fn-legenda" style="color:var(--fn-texto-2)">Busque por nome, serviço, cidade ou bairro.</p>
    <form onsubmit="return false"><div class="fn-campo"><label for="b-o">O que você procura</label><input id="b-o" value="conserto de celular"></div><div class="fn-campo"><label for="b-c">Cidade</label><input id="b-c" value="Campinas"></div>${bt('Buscar', '', 'data-ir="cliente/busca"')}</form></section>
  <section class="fn-secao"><h2>Resultados</h2><div class="fn-resultados fn-entra" data-res></div></section>`,
  ativar(raiz) {
    const empresas = [['[TESTE] Conserta Celular', 'Cambuí · Campinas', true], ['[TESTE] Elétrica Luz Forte', 'Taquaral · Campinas', true], ['[TESTE] Ateliê Ponto Firme', 'Centro · Campinas', false]];
    const res = raiz.querySelector('[data-res]');
    res.innerHTML = empresas.map(([n, l, ok], i) => `<article class="fn-cartao fn-cartao--hq fn-cartao--vivo fn-empresa-card"><div><h3>${n}</h3><p class="fn-legenda">${l}</p>${ok ? '<span class="fn-chip fn-chip--ouro">Verificada pela CK</span>' : '<span class="fn-chip fn-chip--info">Em análise</span>'}</div>${ok ? `<div class="fn-selo-ck" ${i === 0 ? 'data-cena' : 'data-foto'}></div>` : ''}</article>`).join('');
    const cena = montarCena(res.querySelector('[data-cena]'), 'IC01', { rotulo: 'Verificada' }); cena.disparar();
    res.querySelectorAll('[data-foto]').forEach(async (el) => { const url = await fotoCena('IC01', { inicio: -10 }, { t: 0, largura: 160, altura: 160 }); if (url) el.innerHTML = `<img alt="Escudo CK: empresa verificada" src="${url}">`; });
    return () => cena.destruir();
  },
};
const BUSCA = {
  id: 'busca', nome: 'Busca sem resultado',
  html: () => `<section class="fn-busca"><h1>Resultados para "chaveiro"</h1><form onsubmit="return false"><div class="fn-campo"><label for="b2">O que você procura</label><input id="b2" value="chaveiro"></div><div class="fn-campo"><label for="b3">Bairro</label><input id="b3" value="Cambuí"></div>${bt('Buscar')}</form></section>
  <div class="fn-vazio"><div data-cena style="width:9rem;height:8rem"></div><div><h3>Nada encontrado no Cambuí</h3><p class="fn-legenda">Nenhuma empresa aprovada oferece "chaveiro" nesse bairro. Tente:</p><div class="fn-sugestoes"><button type="button" class="fn-bt fn-bt--sec fn-bt--p">Toda Campinas</button><button type="button" class="fn-bt fn-bt--sec fn-bt--p">Categoria "Serviços gerais"</button><button type="button" class="fn-bt fn-bt--sec fn-bt--p">Limpar filtros</button></div></div></div>`,
  ativar(raiz) { const c = montarCena(raiz.querySelector('[data-cena]'), 'IC02', { continua: true, rotulo: '?' }); c.disparar(); return () => c.destruir(); },
};
const PEDIDOS = {
  id: 'pedidos', nome: 'Pedidos',
  html: () => `<header class="fn-modulo"><div><p class="fn-rotulo"><i>C</i>[TESTE] Conserta Celular</p><h1 class="fn-titulo">Fazer pedido</h1></div></header>
  <div class="fn-duas"><section class="fn-secao"><h2>Produtos</h2><div style="display:grid;gap:.6rem">${[['Capa de silicone', 29.9], ['Película 3D', 39.99], ['Cabo USB-C', 24.5]].map(([n, p]) => `<div class="fn-cartao" style="display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem 1rem"><div><b>${n}</b><br><small class="fn-legenda">${brl(p)}</small></div>${bt('Adicionar', 'fn-bt--sec fn-bt--p', `data-add="${p}"`)}</div>`).join('')}</div></section>
  <section class="fn-secao"><h2>Seu pedido</h2><div class="fn-cartao fn-cartao--filete fn-palco-objeto"><div><p class="fn-valor" data-total>R$ 0,00</p><p class="fn-legenda" data-qtd>Nenhum item ainda</p></div><div data-cena style="width:9rem;height:8rem"></div></div></section></div>`,
  ativar(raiz) {
    const cena = montarCena(raiz.querySelector('[data-cena]'), 'IC03', { rotulo: 'Cesta', inicial: { itens: [] } }); let total = 0, n = 0; const lig = [];
    raiz.querySelectorAll('[data-add]').forEach((b) => lig.push(botaoForja(b, { rotulos: { processando: 'Adicionando…', sucesso: 'Adicionado' }, executar: () => operacao({ fator: 0.5 }),
      aoFim: (r) => { if (r !== 'sucesso') return; total += Number(b.dataset.add); n++; contar(raiz.querySelector('[data-total]'), total, { dur: 0.5 }); raiz.querySelector('[data-qtd]').textContent = `${n} ${n > 1 ? 'itens' : 'item'}`;
        cena.pronto.then((v) => { if (!v) return; cena.mem.itens = [...cena.mem.itens, v.t]; cena.definir({}); }); } })));
    return () => { lig.forEach((l) => l.destruir()); cena.destruir(); };
  },
};
const ORCAMENTOS = {
  id: 'orcamentos', nome: 'Orçamentos',
  html: () => `<header class="fn-modulo"><div><p class="fn-rotulo"><i>C</i>Seus orçamentos</p><h1 class="fn-titulo">Troca de bateria</h1><p>[TESTE] Conserta Celular · pedido em 23/11</p></div></header>
  <div class="fn-cartao fn-cartao--filete fn-palco-objeto"><div data-txt><span class="fn-chip fn-chip--info">• Aguardando resposta da empresa</span><p class="fn-legenda" style="margin-top:.5rem">Você recebe um aviso quando a empresa responder.</p></div><div data-cena style="width:9rem;height:8rem"></div></div>`,
  ativar(raiz, ctx) {
    const cena = montarCena(raiz.querySelector('[data-cena]'), 'IC04', { rotulo: 'Aguardando', inicial: { fase: 'aguardando' } });
    ctx.controles([['Simular chegada da resposta (evento real)', () => { raiz.querySelector('[data-txt]').innerHTML = `<span class="fn-chip fn-chip--ok">✓ Resposta recebida</span><p style="margin-top:.5rem"><b class="fn-valor">R$ 180,00</b></p><p class="fn-legenda">Início em 1 dia útil · garantia de 90 dias</p><div class="fn-acoes" style="margin-top:.6rem">${bt('Ver e aceitar', '', 'data-ir="cliente/aceite"')}</div>`; cena.pronto.then((v) => { if (v) cena.definir({ fase: 'chegou', inicio: 'agora' }); }); }]]);
    return () => cena.destruir();
  },
};
const SERVICO = {
  id: 'servico', nome: 'Acompanhamento do serviço',
  html: () => `<header class="fn-modulo"><div><p class="fn-rotulo"><i>C</i>Seu serviço</p><h1 class="fn-titulo">OS nº 3 · Troca de tela</h1><p>[TESTE] Conserta Celular</p></div></header>
  <div class="fn-duas"><ol class="fn-stepper" data-etapas>${['Aguardando início', 'Em execução', 'Pronta para retirada'].map((p, i) => `<li data-e="${i === 0 ? 'feito' : i === 1 ? 'agora' : ''}"><i>${i + 1}</i><span>${p}</span><span></span></li>`).join('')}</ol><div class="fn-cartao" data-cena style="height:13rem"></div></div>`,
  ativar(raiz, ctx) {
    const cena = montarCena(raiz.querySelector('[data-cena]'), 'IC05', { rotulo: 'Andamento' }); let etapa = 1;
    ctx.controles([['Simular etapa confirmada pela empresa', () => { const lis = raiz.querySelectorAll('[data-etapas] li'); if (etapa >= lis.length) return; lis[etapa].dataset.e = 'feito'; etapa++; if (lis[etapa]) lis[etapa].dataset.e = 'agora'; cena.disparar(); }]]);
    return () => cena.destruir();
  },
};
const ACEITE = {
  id: 'aceite', nome: 'Confirmação de aceite',
  html: () => `<header class="fn-modulo"><div><p class="fn-rotulo"><i>C</i>Orçamento recebido</p><h1 class="fn-titulo">Troca de bateria · R$ 180,00</h1><p>Início em 1 dia útil · garantia de 90 dias</p></div></header>
  <div class="fn-cartao fn-cartao--filete fn-palco-objeto"><div style="display:grid;gap:.7rem"><p class="fn-legenda">Ao aceitar, a empresa recebe sua confirmação e agenda o serviço.</p><div class="fn-acoes" style="align-items:center">${bt('Aceitar orçamento', '', 'data-aceitar')}<span class="fn-status" data-st></span></div></div><div data-cena style="width:10rem;height:9rem"></div></div>`,
  ativar(raiz) {
    const cena = montarCena(raiz.querySelector('[data-cena]'), 'IC06', { rotulo: 'Aceite' });
    const b = botaoForja(raiz.querySelector('[data-aceitar]'), { rotulos: { processando: 'Enviando…', sucesso: 'Aceito' }, executar: () => operacao(), aoFim: (r) => { raiz.querySelector('[data-st]').textContent = r === 'sucesso' ? 'Orçamento aceito. A empresa foi avisada.' : 'Não foi possível aceitar agora.'; if (r === 'sucesso') cena.disparar(); } });
    return () => { b.destruir(); cena.destruir(); };
  },
};

/* =============================== CK ADMIN =============================== */
const EMPRESAS = {
  id: 'empresas', nome: 'Aprovação de empresas',
  html: () => `${modulo('CK', 'CK Admin', 'Aprovação de empresas', 'Fila de vitrines aguardando análise.')}
  <div class="fn-duas"><section class="fn-secao"><h2>Na fila</h2><div class="fn-cartao fn-cartao--filete" style="display:grid;gap:.6rem"><b>[TESTE] Ateliê Ponto Firme</b><span class="fn-legenda">Campinas (SP) · enviada em 22/11</span><span class="fn-chip fn-chip--info" data-sit>• Em análise</span><div class="fn-acoes" style="align-items:center">${bt('Aprovar vitrine', '', 'data-aprovar')}${bt('Pedir ajustes', 'fn-bt--sec')}</div></div></section>
  <section class="fn-secao"><h2>Decisão</h2><div class="fn-cartao" data-cena style="height:12rem"></div></section></div>`,
  ativar(raiz) {
    const cena = montarCena(raiz.querySelector('[data-cena]'), 'IA01', { rotulo: 'Aprovação' });
    const b = botaoForja(raiz.querySelector('[data-aprovar]'), { rotulos: { processando: 'Aprovando…', sucesso: 'Aprovada' }, executar: () => operacao(), aoFim: (r) => { if (r === 'sucesso') { raiz.querySelector('[data-sit]').outerHTML = '<span class="fn-chip fn-chip--ok">✓ Aprovada para publicação</span>'; cena.disparar(); } } });
    return () => { b.destruir(); cena.destruir(); };
  },
};
const MODERACAO = {
  id: 'moderacao', nome: 'Moderação',
  html: () => `${modulo('CK', 'CK Admin', 'Moderação', 'Suspender vitrine com fundamento registrado.')}
  <div class="fn-duas"><form class="fn-cartao fn-cartao--filete" style="display:grid;gap:.9rem" onsubmit="return false"><b>[TESTE] Elétrica Luz Forte</b>
    <div class="fn-campo"><label for="m-g">Gravidade</label><select id="m-g"><option>Comum</option><option>Grave (fraude, risco ao consumidor ou exigência legal)</option></select></div>
    <div class="fn-campo"><label for="m-m">Motivo da suspensão</label><textarea id="m-m" rows="3">Fotos de outra empresa na vitrine.</textarea><small>O gestor verá este texto.</small></div>
    <div class="fn-acoes" style="align-items:center">${bt('Suspender vitrine', '', 'data-susp')}<span class="fn-status" data-st></span></div></form>
  <div class="fn-cartao" data-cena style="height:13rem"></div></div>`,
  ativar(raiz) {
    const cena = montarCena(raiz.querySelector('[data-cena]'), 'IA02', { rotulo: 'Proteção' });
    const b = botaoForja(raiz.querySelector('[data-susp]'), { rotulos: { processando: 'Suspendendo…', sucesso: 'Suspensa' }, executar: () => operacao(), aoFim: (r) => { raiz.querySelector('[data-st]').textContent = r === 'sucesso' ? 'Vitrine suspensa. O gestor foi avisado.' : 'Nada foi alterado.'; if (r === 'sucesso') cena.disparar(); } });
    return () => { b.destruir(); cena.destruir(); };
  },
};
const INDICADORES = {
  id: 'indicadores', nome: 'Indicadores',
  html: () => `${modulo('CK', 'CK Admin', 'Indicadores', 'Visão da plataforma.')}
  <div class="fn-indicadores"><div class="fn-cartao fn-cartao--filete"><span class="fn-legenda">Empresas</span><p class="fn-contador" data-c="4">0</p></div><div class="fn-cartao fn-cartao--filete"><span class="fn-legenda">Em análise</span><p class="fn-contador" data-c="1">0</p></div><div class="fn-cartao fn-cartao--filete"><span class="fn-legenda">Denúncias abertas</span><p class="fn-contador" data-c="0">0</p></div></div>
  <div class="fn-cartao fn-palco-objeto"><div style="display:grid;gap:.6rem"><p class="fn-legenda" data-st>Atualizado às 09:12.</p><div class="fn-acoes">${bt('Recalcular indicadores', '', 'data-recalc')}</div></div><div data-cena style="width:9rem;height:9rem"></div></div>`,
  ativar(raiz) {
    const cena = montarCena(raiz.querySelector('[data-cena]'), 'IA03', { rotulo: 'Engrenagem' }); const n = (x) => String(Math.round(x));
    const mostrar = () => raiz.querySelectorAll('[data-c]').forEach((e) => contar(e, Number(e.dataset.c), { dur: 0.9, formato: n })); mostrar();
    const b = botaoForja(raiz.querySelector('[data-recalc]'), { rotulos: { processando: 'Recalculando…', sucesso: 'Atualizado' },
      executar: () => { cena.definir({ fase: 'calculando' }, { manter: true }); raiz.querySelector('[data-st]').textContent = 'Recalculando…'; return operacao({ fator: 1.5 }); },
      aoFim: (r) => { cena.definir({ fase: 'pronto' }); raiz.querySelector('[data-st]').textContent = r === 'sucesso' ? 'Atualizado agora.' : 'Não foi possível recalcular.'; if (r === 'sucesso') mostrar(); } });
    return () => { b.destruir(); cena.destruir(); };
  },
};
const DENUNCIAS = {
  id: 'denuncias', nome: 'Denúncias',
  html: () => `${modulo('CK', 'CK Admin', 'Denúncias', 'Ocorrências enviadas por clientes.')}
  <div class="fn-duas"><div class="fn-tabela-wrap"><table class="fn-tabela"><thead><tr><th>Empresa</th><th>Motivo</th><th>Situação</th></tr></thead><tbody data-lin><tr><td colspan="3" class="fn-legenda">Nenhuma denúncia aberta.</td></tr></tbody></table></div><div class="fn-cartao" data-cena style="height:10rem"></div></div>`,
  ativar(raiz, ctx) {
    const cena = montarCena(raiz.querySelector('[data-cena]'), 'IA04', { rotulo: 'Nova denúncia' });
    ctx.controles([['Simular nova denúncia recebida', () => { raiz.querySelector('[data-lin]').innerHTML = '<tr class="fn-atualizada"><td>[TESTE] Elétrica Luz Forte</td><td>Preço diferente do combinado</td><td><span class="fn-chip fn-chip--alerta">! Nova</span></td></tr>'; cena.disparar(); }]]);
    return () => cena.destruir();
  },
};
const CONTESTACOES = {
  id: 'contestacoes', nome: 'Contestações',
  html: () => `${modulo('CK', 'CK Admin', 'Contestação nº 2', 'Avaliação removida pela moderação.')}
  <div class="fn-cartao fn-cartao--filete fn-palco-objeto"><blockquote style="margin:0;font-size:1.05rem;line-height:1.6">"O atendimento foi bom, mas <span class="fn-trecho">a avaliação foi removida sem motivo</span>. Gostaria de entender."</blockquote><div data-cena style="width:9rem;height:7rem"></div></div>
  <div class="fn-acoes">${bt('Manter remoção', 'fn-bt--sec')}${bt('Restaurar avaliação')}</div>`,
  ativar(raiz) { const c = montarCena(raiz.querySelector('[data-cena]'), 'IA05', { continua: true, rotulo: 'Trecho contestado' }); c.disparar(); return () => c.destruir(); },
};
const CONFIG = {
  id: 'configuracoes', nome: 'Configurações',
  html: () => `${modulo('CK', 'CK Admin', 'Limites da plataforma', 'Parâmetros já existentes no CK Admin.')}
  <div class="fn-duas"><form class="fn-cartao fn-cartao--filete" style="display:grid;gap:.9rem" onsubmit="return false"><div class="fn-campo"><label for="c-e">Empresas por conta</label><input id="c-e" type="number" value="3" min="1"></div><div class="fn-acoes" style="align-items:center">${bt('Salvar limites', '', 'data-salvar')}<span class="fn-status" data-st></span></div></form>
  <div class="fn-cartao" data-cena style="height:11rem"></div></div>`,
  ativar(raiz) {
    const cena = montarCena(raiz.querySelector('[data-cena]'), 'IA06', { rotulo: 'Configuração' });
    const b = botaoForja(raiz.querySelector('[data-salvar]'), { executar: () => operacao(), aoFim: (r) => { raiz.querySelector('[data-st]').textContent = r === 'sucesso' ? 'Limites salvos.' : 'Nada foi alterado.'; if (r === 'sucesso') cena.disparar(); } });
    return () => { b.destruir(); cena.destruir(); };
  },
};

const SIM = () => ({ latencia: Math.max(250, (globalThis.__SIMULACAO ?? { latencia: 900 }).latencia) });
export const TELAS = {
  publico: [HOME, ENTRAR],
  business: [PAINEL, VENDAS, ESTOQUE, FINANCEIRO, PRODUTOS, ORDENS, AGENDA, RELATORIOS],
  cliente: [DESCOBRIR, BUSCA, PEDIDOS, ORCAMENTOS, SERVICO, ACEITE],
  ck: [EMPRESAS, MODERACAO, INDICADORES, DENUNCIAS, CONTESTACOES, CONFIG],
};
export { LOGO };
