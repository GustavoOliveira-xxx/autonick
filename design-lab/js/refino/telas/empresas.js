// Central de empresas: trocar é uma coisa, cadastrar é outra.
// Troca rápida pelo seletor do menu (de qualquer tela) e página "Minhas empresas" com cartões e um botão claro
// "Cadastrar nova empresa", que abre um modal completo dividido em blocos, com logo e pré-visualização.
import { ic, esc, secao, casca, EMPRESAS, estadoApp, logoEmp, abrirModal, operar, aviso } from '../pecas.js';

const CATEGORIAS = ['Assistência técnica', 'Alimentação e doces', 'Beleza e estética', 'Construção e reformas', 'Comércio de bairro', 'Serviços gerais'];
const VITRINE = { publicada: ['Vitrine publicada', 'ok'], analise: ['Vitrine em análise da CK', 'alerta'], rascunho: ['Vitrine em rascunho', 'neutro'] };

function cartao(e) {
  const ativa = e.id === estadoApp.empresa; const [vt, vc] = VITRINE[e.vitrine];
  return `<article class="rf-empresa ${ativa ? 'rf-empresa--ativa' : ''}" data-empresa="${e.id}">
    <div class="rf-empresa__topo">${logoEmp(e, 'rf-logo-emp--g')}<div><b>${esc(e.nome)}</b><small>${esc(e.cidade)} (${e.uf}) · seu acesso: ${esc(e.papel)}</small></div></div>
    <div class="rf-empresa__selos"><span class="rf-chip rf-chip--ok">ERP ativo</span><span class="rf-chip rf-chip--${vc}">${vt}</span></div>
    <div class="rf-empresa__pe">${ativa ? `<span class="rf-ativa">${ic('check')}Em uso agora</span><button type="button" class="rf-bt rf-bt--f" data-sem-nav>Abrir painel ${ic('seta')}</button>`
      : `<button type="button" class="rf-bt rf-bt--s" data-usar="${e.id}">${ic('trocar')}Usar esta empresa</button><button type="button" class="rf-bt rf-bt--f rf-bt--icone" aria-label="Mais ações de ${esc(e.nome)}" data-sem-nav>${ic('pontos')}</button>`}</div>
  </article>`;
}

function pagina(palco) {
  const app = casca({ atual: 'empresa', trilha: ['Business', 'Minhas empresas'], titulo: 'Minhas empresas', subtitulo: 'Escolha com qual empresa trabalhar agora ou cadastre uma nova.',
    acoes: `<button type="button" class="rf-bt rf-bt--p" data-nova-empresa>${ic('mais')}Cadastrar nova empresa</button>` });
  const corpo = app.querySelector('[data-corpo]');
  const desenhar = () => {
    corpo.innerHTML = `<div class="rf-secao-t"><div><h3>Suas empresas (${EMPRESAS.length})</h3><p>A empresa em uso aparece no topo do menu. Trocar não apaga nada: cada empresa guarda os próprios dados.</p></div></div>
      <div class="rf-empresas rf-entra">${EMPRESAS.map(cartao).join('')}<button type="button" class="rf-nova-empresa" data-nova-empresa>${ic('mais')}Cadastrar nova empresa<small class="rf-fraco" style="font-weight:400">Leva uns 2 minutos</small></button></div>
      <div class="rf-cartao rf-cartao--p" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span class="rf-chip rf-chip--info rf-chip--sem">${ic('convidar', 'width="16" height="16"')}</span><div style="flex:1;min-width:220px"><b>Recebeu um convite?</b><br><span class="rf-fraco">Convites para trabalhar em outra empresa aparecem aqui para você aceitar ou recusar.</span></div><span class="rf-chip rf-chip--neutro">Nenhum convite pendente</span></div>`;
  };
  desenhar();
  palco.replaceChildren(app);
  app.addEventListener('click', async (ev) => {
    const usar = ev.target.closest('[data-usar]');
    if (usar) {
      const ok = await operar(usar, 'Trocando…'); if (!ok) return;
      estadoApp.empresa = usar.dataset.usar; pagina(palco); const e = EMPRESAS.find((x) => x.id === estadoApp.empresa);
      aviso('ok', `Agora você está em ${e.nome}`, 'O menu e os números passam a ser desta empresa.');
    }
    if (ev.target.closest('[data-nova-empresa]')) modalCadastro(() => pagina(palco));
  });
}

/** Seletor rápido: abre de qualquer tela pelo bloco "Empresa ativa" do menu. */
export function seletor(aoTrocar) {
  const d = abrirModal(`<div class="rf-modal__painel">
    <div class="rf-modal__cab"><div><h3>Trocar de empresa</h3><p>Você continua na mesma tela, agora com os dados da empresa escolhida.</p></div><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-fechar aria-label="Fechar">${ic('x')}</button></div>
    <div class="rf-modal__corpo" style="gap:10px">
      <div class="rf-campo rf-busca" style="max-width:none">${ic('busca')}<input type="search" placeholder="Buscar empresa pelo nome" aria-label="Buscar empresa" data-filtro></div>
      <div role="listbox" aria-label="Empresas" style="display:grid;gap:6px" data-lista>${EMPRESAS.map((e) => `<button type="button" role="option" aria-selected="${e.id === estadoApp.empresa}" class="rf-troca" style="background:var(--rf-sup2);color:var(--rf-texto);border-color:${e.id === estadoApp.empresa ? 'var(--rf-ouro)' : 'var(--rf-linha)'}" data-escolher="${e.id}" data-nome="${esc(e.nome.toLowerCase())}">${logoEmp(e)}<span><strong>${esc(e.nome)}</strong><small style="color:var(--rf-fraco);letter-spacing:0;text-transform:none;font-weight:400">${esc(e.cidade)} · ${esc(e.papel)}</small></span>${e.id === estadoApp.empresa ? ic('check', 'style="color:var(--rf-ouro-txt)"') : ''}</button>`).join('')}</div>
    </div>
    <div class="rf-modal__pe"><a href="#" class="rf-bt rf-bt--f" data-sem-nav style="margin-right:auto">Ver todas em Minhas empresas</a><button type="button" class="rf-bt rf-bt--s" data-nova>${ic('mais')}Cadastrar nova empresa</button></div></div>`,
  { classe: 'rf-modal rf-modal--estreito', aoAbrir: (dl) => dl.querySelector('[data-filtro]').focus() });
  d.querySelector('[data-filtro]').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); for (const b of d.querySelectorAll('[data-escolher]')) b.hidden = !b.dataset.nome.includes(q); });
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-escolher]');
    if (b && b.dataset.escolher !== estadoApp.empresa) { estadoApp.empresa = b.dataset.escolher; d.close(); aoTrocar?.(); aviso('ok', `Agora você está em ${EMPRESAS.find((x) => x.id === estadoApp.empresa).nome}`); }
    if (e.target.closest('[data-nova]')) { d.close(); modalCadastro(aoTrocar); }
  });
}

const BLOCOS = [['identidade', 'Identidade'], ['local', 'Local e atendimento'], ['contato', 'Contato'], ['vitrine', 'Vitrine'], ['privado', 'Dados privados']];
const campo = (nome, rotulo, { tipo = 'text', obr = false, ajuda = '', lista = null, linhas = 0, valor = '', classe = '', ph = '' } = {}) => {
  const id = `nv-${nome}`; const desc = `${id}-a ${id}-e`;
  const entrada = lista ? `<select id="${id}" name="${nome}" aria-describedby="${desc}" ${obr ? 'aria-required="true"' : ''}><option value="">Escolha</option>${lista.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`
    : linhas ? `<textarea id="${id}" name="${nome}" rows="${linhas}" aria-describedby="${desc}" placeholder="${esc(ph)}"></textarea>`
      : `<input id="${id}" name="${nome}" type="${tipo}" value="${esc(valor)}" aria-describedby="${desc}" placeholder="${esc(ph)}" ${obr ? 'aria-required="true"' : ''}>`;
  return `<div class="rf-campo ${classe}"><label for="${id}">${rotulo}${obr ? '' : ' <span class="rf-obr">(opcional)</span>'}</label>${entrada}<span class="rf-ajuda" id="${id}-a">${ajuda}</span><span class="rf-erro-campo" id="${id}-e"></span></div>`;
};

export function modalCadastro(aoConcluir) {
  let logo = null;
  const d = abrirModal(`<form class="rf-modal__painel" novalidate>
    <div class="rf-modal__cab"><div><h3>Cadastrar nova empresa</h3><p>Só os campos marcados sem "(opcional)" são necessários agora. O resto pode ser completado depois.</p></div><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-fechar aria-label="Fechar">${ic('x')}</button></div>
    <div class="rf-modal__lados">
      <nav class="rf-indice" aria-label="Partes do cadastro">${BLOCOS.map(([id, n], i) => `<a href="#bl-${id}" data-ir="${id}" ${i === 0 ? 'aria-current="true"' : ''}><i>${i + 1}</i>${n}</a>`).join('')}
        <p class="rf-fraco" style="margin:12px 6px 0">A vitrine pública só aparece depois da análise da CK. O ERP funciona desde já.</p></nav>
      <div class="rf-modal__corpo" data-rolagem>
        <section class="rf-bloco" id="bl-identidade" data-bloco="identidade"><h4>1 · Identidade</h4>
          <div class="rf-logo-entrada">
            <label class="rf-logo-alvo" data-alvo>${ic('upload')}<span>Logo da empresa<br><b>arraste ou clique</b></span><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Enviar logo da empresa" data-logo></label>
            <div style="display:grid;gap:8px"><b style="font-size:.9rem">Logo <span class="rf-obr" style="font-weight:400">(opcional)</span></b><span class="rf-fraco">PNG, JPG ou WebP, até 2 MB, de preferência quadrado (mínimo 256 × 256). Sem logo, usamos as iniciais com a cor escolhida.</span>
              <div class="rf-logo-usos" data-usos></div>
              <div style="display:flex;gap:8px;flex-wrap:wrap" data-logo-acoes hidden><label class="rf-fraco" style="display:inline-flex;gap:6px;align-items:center">Aproximar <input type="range" min="1" max="2" step="0.05" value="1" data-zoom style="accent-color:var(--rf-ouro)"></label><button type="button" class="rf-bt rf-bt--f" data-tirar-logo>${ic('lixo')}Remover logo</button></div>
              <span class="rf-erro-campo" data-logo-erro></span></div>
          </div>
          <div class="rf-grade-campos">${campo('nome', 'Nome do negócio', { obr: true, ajuda: 'Como os clientes conhecem você.', classe: 'rf-col-2' })}
            ${campo('modalidade', 'O que a empresa faz', { obr: true, lista: ['Comércio', 'Serviços', 'Comércio e serviços'] })}${campo('categoria', 'Categoria principal', { obr: true, lista: CATEGORIAS })}</div></section>
        <section class="rf-bloco" id="bl-local" data-bloco="local"><h4>2 · Local e atendimento</h4>
          <div class="rf-grade-campos">${campo('cidade', 'Cidade', { obr: true, ajuda: 'Nesta fase o AutoniCK atende só o estado de São Paulo.' })}${campo('uf', 'UF', { valor: 'SP' })}${campo('bairro', 'Bairro')}
            ${campo('area', 'Área de atendimento', { ajuda: 'Ex.: "Centro e bairros vizinhos" ou "atendo em casa até 10 km".', classe: 'rf-col-2' })}</div></section>
        <section class="rf-bloco" id="bl-contato" data-bloco="contato"><h4>3 · Contato</h4>
          <div class="rf-grade-campos">${campo('email', 'E-mail da empresa (privado)', { tipo: 'email', obr: true, ajuda: 'Usado pela CK para falar com você. Não aparece na vitrine.', classe: 'rf-col-2' })}
            ${campo('telefone', 'Telefone público', { tipo: 'tel' })}${campo('whatsapp', 'WhatsApp público', { tipo: 'tel' })}${campo('email_publico', 'E-mail público', { tipo: 'email' })}</div></section>
        <section class="rf-bloco" id="bl-vitrine" data-bloco="vitrine"><h4>4 · Vitrine <small>passa pela análise da CK antes de aparecer</small></h4>
          <div class="rf-grade-campos">${campo('descricao', 'Descrição pública', { linhas: 3, classe: 'rf-col-2', ph: 'O que você faz, há quanto tempo, diferenciais.' })}${campo('horario', 'Horário de funcionamento', { classe: 'rf-col-2', ph: 'Seg. a sex. das 8h às 18h; sáb. das 8h às 12h' })}</div></section>
        <section class="rf-bloco" id="bl-privado" data-bloco="privado"><h4>5 · Dados privados <small>só a sua equipe e a CK veem</small></h4>
          <div class="rf-grade-campos">${campo('documento', 'CPF ou CNPJ')}${campo('endereco', 'Endereço')}${campo('obs', 'Observações internas', { linhas: 2, classe: 'rf-col-2' })}</div></section>
      </div>
    </div>
    <div class="rf-modal__pe"><span class="rf-fraco" data-progresso>0 de 5 campos necessários</span><button type="button" class="rf-bt rf-bt--f" data-fechar>Cancelar</button><button type="submit" class="rf-bt rf-bt--p">${ic('check')}Cadastrar empresa</button></div>
  </form>`, { aoAbrir: (dl) => dl.querySelector('#nv-nome').focus() });

  const form = d.querySelector('form'); const rol = d.querySelector('[data-rolagem]');
  const OBR = ['nome', 'modalidade', 'categoria', 'cidade', 'email'];
  const usos = d.querySelector('[data-usos]');
  const desenharUsos = () => {
    const nome = form.nome.value.trim() || 'Nova empresa';
    const e = { nome, cor: ['#7c1b30', '#3a0e1d'], logo };
    const z = d.querySelector('[data-zoom]').value;
    usos.innerHTML = `<figure>${logoEmp(e)}<figcaption>Menu</figcaption></figure><figure>${logoEmp(e, 'rf-logo-emp--g')}<figcaption>Vitrine</figcaption></figure><figure>${logoEmp(e, 'rf-u-redondo')}<figcaption>Conversa</figcaption></figure>
      <figure><span style="display:flex;gap:6px;align-items:center;padding:6px 10px;border-radius:8px;background:#fff;color:#191418;border:1px solid #ddd;font-size:.7rem">${logoEmp(e)}<b>${esc(nome)}</b></span><figcaption>Cabeçalho do PDF</figcaption></figure>`;
    for (const img of d.querySelectorAll('.rf-logo-emp img, [data-alvo] img')) img.style.transform = `scale(${z})`;
  };
  const progresso = () => {
    const feitos = OBR.filter((n) => form[n].value.trim()).length;
    d.querySelector('[data-progresso]').textContent = feitos === OBR.length ? 'Tudo pronto para cadastrar' : `${feitos} de ${OBR.length} campos necessários`;
    const blocoDe = { nome: 'identidade', modalidade: 'identidade', categoria: 'identidade', cidade: 'local', email: 'contato' };
    for (const [id] of BLOCOS) { const obr = OBR.filter((n) => blocoDe[n] === id); d.querySelector(`[data-ir="${id}"]`).classList.toggle('rf-feito', obr.length > 0 && obr.every((n) => form[n].value.trim())); }
  };
  form.addEventListener('input', (e) => { if (e.target.name === 'nome') desenharUsos(); if (e.target.getAttribute('aria-invalid')) { e.target.removeAttribute('aria-invalid'); d.querySelector(`#${e.target.id}-e`).textContent = ''; } progresso(); });
  desenharUsos(); progresso();

  // índice acompanha a rolagem
  const io = new IntersectionObserver((ents) => { for (const en of ents) if (en.isIntersecting) for (const a of d.querySelectorAll('[data-ir]')) a.setAttribute('aria-current', String(a.dataset.ir === en.target.dataset.bloco)); }, { root: rol, rootMargin: '-10% 0px -70% 0px' });
  d.querySelectorAll('[data-bloco]').forEach((b) => io.observe(b));
  d.querySelector('.rf-indice').addEventListener('click', (e) => { const a = e.target.closest('[data-ir]'); if (!a) return; e.preventDefault(); d.querySelector(`#bl-${a.dataset.ir}`).scrollIntoView({ block: 'start' }); });

  // logo: validação, pré-visualização e ajuste
  const alvo = d.querySelector('[data-alvo]'); const entrada = d.querySelector('[data-logo]'); const erroLogo = d.querySelector('[data-logo-erro]');
  const lerArquivo = (arq) => {
    erroLogo.textContent = '';
    if (!arq) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(arq.type)) { erroLogo.textContent = 'Use uma imagem PNG, JPG ou WebP.'; return; }
    if (arq.size > 2 * 1024 * 1024) { erroLogo.textContent = 'A imagem passa de 2 MB. Reduza e tente de novo.'; return; }
    const r = new FileReader(); r.onload = () => {
      const img = new Image(); img.onload = () => {
        if (Math.min(img.width, img.height) < 128) { erroLogo.textContent = 'A imagem é pequena demais (mínimo 128 px). Ela ficaria borrada.'; return; }
        logo = r.result; alvo.querySelector('img')?.remove(); alvo.append(Object.assign(new Image(), { src: logo, alt: '' }));
        d.querySelector('[data-logo-acoes]').hidden = false; desenharUsos();
      }; img.src = r.result;
    }; r.readAsDataURL(arq);
  };
  entrada.addEventListener('change', () => lerArquivo(entrada.files[0]));
  alvo.addEventListener('dragover', (e) => { e.preventDefault(); alvo.classList.add('rf-arrastando'); });
  alvo.addEventListener('dragleave', () => alvo.classList.remove('rf-arrastando'));
  alvo.addEventListener('drop', (e) => { e.preventDefault(); alvo.classList.remove('rf-arrastando'); lerArquivo(e.dataTransfer.files[0]); });
  d.querySelector('[data-zoom]').addEventListener('input', desenharUsos);
  d.querySelector('[data-tirar-logo]').addEventListener('click', () => { logo = null; alvo.querySelector('img')?.remove(); entrada.value = ''; d.querySelector('[data-logo-acoes]').hidden = true; desenharUsos(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let primeiro = null;
    for (const n of OBR) {
      const c = form[n]; const v = c.value.trim(); let msg = '';
      if (!v) msg = 'Preencha este campo.'; else if (n === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) msg = 'Confira o e-mail (exemplo: contato@seunegocio.com.br).';
      if (msg) c.setAttribute('aria-invalid', 'true'); else c.removeAttribute('aria-invalid'); d.querySelector(`#${c.id}-e`).textContent = msg; if (msg && !primeiro) primeiro = c;
    }
    if (primeiro) { primeiro.focus(); primeiro.scrollIntoView({ block: 'center' }); return; }
    const ok = await operar(e.submitter, 'Cadastrando…'); if (!ok) return;
    const nova = { id: `e${Date.now()}`, nome: form.nome.value.trim(), cidade: form.cidade.value.trim(), uf: 'SP', papel: 'Proprietária', erp: 'ativo', vitrine: 'rascunho', cor: ['#7c1b30', '#3a0e1d'], logo };
    EMPRESAS.push(nova);
    form.innerHTML = `<div class="rf-modal__cab"><div><h3>Empresa cadastrada</h3><p>O ERP já pode ser usado. A vitrine fica em rascunho até você enviá-la para análise.</p></div><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-fechar aria-label="Fechar">${ic('x')}</button></div>
      <div class="rf-modal__corpo" style="justify-items:center;text-align:center;padding:34px 20px">${logoEmp(nova, 'rf-logo-emp--g')}<h3 style="margin:6px 0 0;font:800 italic 1.6rem/1 var(--rf-titulo);text-transform:uppercase">${esc(nova.nome)}</h3>
        <div class="rf-empresa__selos" style="justify-content:center"><span class="rf-chip rf-chip--ok">ERP ativo</span><span class="rf-chip rf-chip--neutro">Vitrine em rascunho</span></div></div>
      <div class="rf-modal__pe"><button type="button" class="rf-bt rf-bt--s" data-fechar>Ficar onde estou</button><button type="button" class="rf-bt rf-bt--p" data-usar-nova>${ic('trocar')}Usar ${esc(nova.nome)} agora</button></div>`;
    form.querySelector('[data-usar-nova]').focus();
    form.querySelector('[data-usar-nova]').addEventListener('click', () => { estadoApp.empresa = nova.id; d.close(); aviso('ok', `Agora você está em ${nova.nome}`); });
    d.addEventListener('close', () => aoConcluir?.(), { once: true });
  });
}

export function montar(palco) {
  const s = secao({ titulo: 'Central de', destaque: 'empresas', texto: 'Trocar de empresa e cadastrar uma nova passam a ser caminhos separados. A troca fica sempre à mão no topo do menu; o cadastro abre um modal completo, em blocos, com logo.',
    antes: 'img/antes/empresas.webp',
    objetivos: [['Trocar de empresa', '1 clique no bloco "Empresa ativa" do menu, de qualquer tela, com busca.'], ['Cadastrar empresa', 'Botão dourado no topo da página e um cartão "+" na lista. Tudo num modal só.'], ['Saber onde estou', 'Empresa em uso destacada com borda dourada e "Em uso agora".']],
    selos: [['Troca e cadastro: banco atual', 'ok'], ['Logo: precisa de armazenamento novo', 'banco']],
    notas: ['A lista e o formulário de cadastro deixam de dividir a mesma página.', 'O cadastro reúne em um só lugar os campos que hoje ficam espalhados entre "Cadastrar empresa" e "Empresa e vitrine".', 'Índice lateral mostra o progresso; erros aparecem ao lado do campo e o foco vai para o primeiro.', 'Logo com validação de tipo, tamanho e resolução, ajuste de aproximação e prévia em todos os lugares onde aparece.', 'Depois de cadastrar, a pessoa decide: usar a nova empresa agora ou ficar onde está.', 'O menu deixa de mostrar "Entrar" para quem já está logado.'] });
  const p = s.querySelector('[data-palco]'); pagina(p); return s;
}
