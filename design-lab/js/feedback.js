// Categoria F · feedback imediato de clique, com estados honestos.
// Regras (as mesmas que valeriam no app):
//  1. o clique é reconhecido no mesmo quadro (pointerdown → "pressionado"; click → "recebido");
//  2. o indicador de processamento só aparece se a operação passar do limiar anti-piscar (padrão 120 ms);
//  3. sucesso só aparece quando a resposta chega; erro, sem conexão e indisponível têm estados próprios;
//  4. nenhum tempo mínimo de exibição: nada espera só para mostrar animação;
//  5. enquanto a operação está em andamento o botão não aceita um segundo envio.
// No laboratório a "resposta do servidor" é simulada com a latência escolhida no painel.

export const SIMULACAO = { latencia: 900, resultado: 'sucesso', limiar: 120 };

/** Estilos: o que cada proposta mostra além do visual definido em interacoes.css. */
export const ESTILOS_F = {
  F01: { texto: false }, F02: { texto: false }, F03: { texto: false }, F04: { texto: false }, F05: { texto: false },
  F06: { texto: false }, F07: { texto: true }, F08: { texto: false }, F09: { texto: true }, F10: { texto: false },
  F11: { texto: false }, F12: { texto: false }, F13: { texto: true }, F14: { texto: false },
};

let regiaoAnuncio = null;
export function anunciar(msg) {
  if (!regiaoAnuncio) { regiaoAnuncio = document.createElement('p'); regiaoAnuncio.className = 'so-leitor'; regiaoAnuncio.setAttribute('aria-live', 'polite'); document.body.append(regiaoAnuncio); }
  regiaoAnuncio.textContent = ''; requestAnimationFrame(() => { regiaoAnuncio.textContent = msg; });
}

/** Simula a chamada ao servidor. A latência representa o tempo de rede e de processamento real, não um atraso de interface. */
export function simularRequisicao({ latencia, resultado }) {
  return new Promise((ok, falha) => {
    setTimeout(() => (resultado === 'erro' ? falha(new Error('O servidor recusou: confira os dados e tente de novo.')) : ok()), latencia);
  });
}

const ICONES = {
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  erro: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>',
  seta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  engrenagem: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.6 2.4 2.8-.8.6 2.8 2.8.6-.8 2.8 2.4 1.6-2.4 1.6.8 2.8-2.8.6-.6 2.8-2.8-.8L12 21.5l-1.6-2.4-2.8.8-.6-2.8-2.8-.6.8-2.8L2.5 12l2.4-1.6-.8-2.8 2.8-.6.6-2.8 2.8.8z" fill="currentColor"/><circle cx="12" cy="12" r="3.2" fill="#fff3c9"/></svg>',
  sino: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5v2M7 18.5c-1.6 0-2.5-.6-2.5-1.5 0-1 1.3-1.6 1.6-3.4l.6-3.6A5.4 5.4 0 0 1 12 5.4a5.4 5.4 0 0 1 5.3 4.6l.6 3.6c.3 1.8 1.6 2.4 1.6 3.4 0 .9-.9 1.5-2.5 1.5z" fill="#f5b70a" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="20.5" r="1.6" fill="currentColor"/></svg>',
  nuvem: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 18z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="2.2"/></svg>',
  cadeado: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
};
export { ICONES };

/**
 * Liga o comportamento a um botão. O botão precisa de <span class="fb-rot">.
 * op: { estilo, rotulos:{ processando, sucesso, erro }, simulacao, aoEvento(nome, ms, classe), aoFim(estado) }
 */
export function ligarBotao(btn, op = {}) {
  let estilo = op.estilo ?? 'F13';
  const rot = btn.querySelector('.fb-rot') ?? btn;
  const original = rot.textContent;
  const rotulos = { processando: 'Salvando…', sucesso: 'Salvo', erro: 'Tentar de novo', indisponivel: 'Indisponível', conexao: 'Sem conexão', ...op.rotulos };
  btn.classList.add('fb');
  if (!btn.querySelector('.fb-ico')) btn.insertAdjacentHTML('beforeend', '<span class="fb-ico" aria-hidden="true"></span><span class="fb-barra" aria-hidden="true"></span><span class="fb-onda" aria-hidden="true"></span><span class="fb-carimbo" aria-hidden="true">OK</span><span class="fb-msg" aria-hidden="true"></span>');
  const ico = btn.querySelector('.fb-ico'); const msg = btn.querySelector('.fb-msg');
  aplicarEstilo(estilo);
  let ocupado = false, t0 = 0, timers = [];
  const limpar = () => { timers.forEach(clearTimeout); timers = []; };
  const ev = (nome, classe) => op.aoEvento?.(nome, Math.round(performance.now() - t0), classe);
  function estado(e) {
    btn.dataset.fb = e;
    const usaTexto = ESTILOS_F[estilo]?.texto;
    const icone = { processando: estilo === 'F08' ? ICONES.engrenagem : estilo === 'F12' ? ICONES.sino : '', sucesso: ICONES.ok, erro: ICONES.erro, conexao: ICONES.nuvem, indisponivel: ICONES.cadeado, '': estilo === 'F08' ? ICONES.seta : estilo === 'F12' ? ICONES.sino : '' }[e] ?? '';
    ico.innerHTML = icone;
    if (usaTexto) rot.textContent = { processando: rotulos.processando, sucesso: rotulos.sucesso, erro: rotulos.erro, conexao: rotulos.conexao, indisponivel: rotulos.indisponivel }[e] ?? original;
    else rot.textContent = original;
  }
  function aplicarEstilo(novo) { for (const c of [...btn.classList]) if (/^fb-F\d+$/.test(c)) btn.classList.remove(c); btn.classList.add(`fb-${novo}`); estilo = novo; if (!ocupado) estado(''); }

  const aoPressionar = (e) => {
    if (ocupado) return;
    const r = btn.getBoundingClientRect(); btn.style.setProperty('--cx', `${((e.clientX - r.left) / r.width) * 100}%`); btn.style.setProperty('--cy', `${((e.clientY - r.top) / r.height) * 100}%`);
    btn.dataset.fb = 'pressionado';
  };
  const aoSoltar = () => { if (btn.dataset.fb === 'pressionado') btn.dataset.fb = ''; };
  const aoClicar = async (e) => {
    e.preventDefault();
    if (ocupado) { op.aoEvento?.('clique ignorado: operação em andamento (sem envio duplicado)', Math.round(performance.now() - t0), 'falha'); return; }
    limpar(); t0 = performance.now(); ocupado = true;
    const sim = op.simulacao ?? SIMULACAO;
    if (!btn.style.getPropertyValue('--cx')) { btn.style.setProperty('--cx', '50%'); btn.style.setProperty('--cy', '50%'); }
    ev('clique recebido: resposta visual no mesmo quadro');
    if (sim.resultado === 'indisponivel') {
      estado('indisponivel'); msg.textContent = 'Você não tem permissão para esta ação'; anunciar('Ação indisponível: você não tem permissão para esta ação.');
      ev('ação indisponível: nada foi enviado', 'falha');
      timers.push(setTimeout(() => { ocupado = false; estado(''); msg.textContent = ''; }, 2200)); return;
    }
    if (sim.resultado === 'conexao') {
      estado('conexao'); msg.textContent = 'Sem internet. Nada foi enviado.'; anunciar('Sem conexão. Nada foi enviado; tente de novo quando a internet voltar.');
      ev('sem conexão detectada antes do envio: nada foi enviado', 'falha');
      timers.push(setTimeout(() => { ocupado = false; estado(''); msg.textContent = ''; }, 2600)); return;
    }
    estado('recebido'); btn.setAttribute('aria-busy', 'true');
    timers.push(setTimeout(() => { if (ocupado) { estado('processando'); ev(`indicador de processamento (passou do limiar de ${sim.limiar} ms)`); } }, sim.limiar));
    timers.push(setTimeout(() => { if (ocupado) { msg.textContent = 'Ainda trabalhando…'; ev('aviso de demora: a operação continua'); } }, 4000));
    try {
      await simularRequisicao(sim);
      limpar(); estado('sucesso'); msg.textContent = ''; btn.removeAttribute('aria-busy'); anunciar(rotulos.sucesso + '.');
      ev('resposta do servidor: sucesso confirmado → sucesso exibido', 'ok'); op.aoFim?.('sucesso');
      timers.push(setTimeout(() => { ocupado = false; estado(''); }, 1700));
    } catch (erro) {
      limpar(); estado('erro'); msg.textContent = erro.message; btn.removeAttribute('aria-busy'); anunciar('Não deu certo. ' + erro.message);
      ev('resposta do servidor: erro → erro exibido com o motivo', 'falha'); op.aoFim?.('erro');
      timers.push(setTimeout(() => { ocupado = false; estado(''); msg.textContent = ''; }, 3200));
    }
  };
  btn.addEventListener('pointerdown', aoPressionar); btn.addEventListener('pointerup', aoSoltar); btn.addEventListener('pointerleave', aoSoltar); btn.addEventListener('click', aoClicar);
  return {
    definirEstilo: aplicarEstilo,
    destruir() { limpar(); btn.removeEventListener('pointerdown', aoPressionar); btn.removeEventListener('pointerup', aoSoltar); btn.removeEventListener('pointerleave', aoSoltar); btn.removeEventListener('click', aoClicar); },
  };
}
