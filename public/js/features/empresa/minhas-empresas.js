/**
 * Central de empresas (E03): consultar, trocar e cadastrar ficam separados.
 * - Lista das empresas da pessoa (proprietária ou funcionária) com logo, situação, empresa em uso, favorita e ações.
 * - Convites recebidos (aceitar ou recusar decide só no banco).
 * - "Cadastrar nova empresa" abre um modal completo em blocos: identificação, categoria e atividade, contato e
 *   localização, identidade visual (logo) e revisão. Só os campos exigidos para criar a empresa são obrigatórios;
 *   o resto é opcional e pode ser completado depois. A vitrine continua passando pela análise da CK.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { abrirModal } from '../../ui/modal.js';
import { logoDaEmpresa, irParaEmpresa, lembrarRecente } from '../../ui/seletor-empresa.js';
import { obterEmpresaAtiva } from '../../core/contexto-empresa.js';
import { categorias, minhasEmpresas, criarEmpresa, atualizarEmpresa, novaChave, MODALIDADES } from '../../data/empresas.js';
import { meusConvites, aceitarConvite, recusarConvite } from '../../data/equipe.js';
import { arquivosDisponiveis, logosDasMinhasEmpresas, enviarArquivo, definirLogoEmpresa, conferirImagem } from '../../data/arquivos.js';
import { meusFavoritos, alternarFavorito } from '../../data/favoritos.js';
import { exigirSessao, chipSituacao, chipErp, chipPapel, chipTeste, formatarDataHora } from './comum.js';

iniciarLayout();
const area = document.getElementById('empresas');
const avisos = document.getElementById('avisos');
const acoesTopo = document.getElementById('acoes-empresas');
let listaCategorias = [];

function anunciar(tipo, texto, ...extra) {
  avisos.replaceChildren(el('div', { role: tipo === 'erro' ? 'alert' : 'status' }, aviso(tipo, texto, ...extra)));
  avisos.scrollIntoView({ block: 'nearest' });
}
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function cartaoEmpresa(e, { logo, favorita, ativa, aoFavoritar }) {
  const id = e.empresa_id;
  const nomeCategoria = listaCategorias.find((c) => c.id === e.categoria_id)?.nome;
  const estrela = el('button', { type: 'button', class: 'seletor__favorito', 'aria-pressed': String(favorita), 'aria-label': `${favorita ? 'Remover' : 'Marcar'} ${e.nome_publico} como favorita` }, '★');
  estrela.addEventListener('click', () => ocupado(estrela, () => aoFavoritar(id)));
  const acessar = el('button', { type: 'button', class: 'botao', 'data-usar': id }, ativa ? 'Continuar nesta empresa' : 'Acessar empresa',
    el('span', { class: 'visualmente-oculto' }, ` ${e.nome_publico}`));
  acessar.addEventListener('click', () => ocupado(acessar, async () => {
    try { await irParaEmpresa({ id, nome: e.nome_publico, dado_de_teste: e.dado_de_teste }); } catch (erro) { anunciar('erro', erro.message); }
  }));
  // Gerenciar (dados, logo e vitrine) é da página da empresa; a regra de quem altera continua no banco.
  const gerenciar = el('a', { class: 'botao botao--secundario', href: `/business/empresa.html?id=${encodeURIComponent(id)}` },
    e.papel === 'proprietario' ? 'Gerenciar' : 'Ver detalhes', el('span', { class: 'visualmente-oculto' }, ` ${e.nome_publico}`));
  return el('li', { class: `cartao cartao-empresa${ativa ? ' cartao-empresa--ativa' : ''}`, 'data-empresa': id },
    el('div', { class: 'cartao-empresa__topo' }, logoDaEmpresa(e.nome_publico, logo?.logo_url, 'logo-empresa logo-empresa--g'),
      el('div', { class: 'cartao-empresa__nome' },
        el('h3', { class: 'cartao__titulo', title: e.nome_publico }, e.nome_publico),
        el('p', { class: 'cartao__meta' }, [nomeCategoria, `${e.cidade} (${e.uf})`].filter(Boolean).join(' · '))), estrela),
    el('p', { class: 'opcoes' }, chipPapel(e.papel, e.perfil_nome), chipErp(), chipSituacao(e.situacao_vitrine), e.dado_de_teste ? chipTeste() : null,
      logo?.pendente && logo?.logo_id ? el('span', { class: 'chip' }, logo.em_analise ? 'Logo em análise da CK' : 'Logo nova fora da vitrine') : null),
    el('div', { class: 'cartao-empresa__acoes' }, ativa ? el('span', { class: 'cartao-empresa__ativa' }, '✓ Em uso agora') : null, acessar, gerenciar));
}

/** Convites para o e-mail confirmado desta conta (D4-1). Aceitar ou recusar decide só no banco. */
function secaoConvites(convites) {
  if (!convites.length) return null;
  const chaves = new Map(convites.map((c) => [c.convite_id, { aceitar: novaChave(), recusar: novaChave() }]));
  const item = (c) => {
    const aceitar = el('button', { type: 'button', class: 'botao' }, 'Aceitar convite');
    const recusar = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Recusar');
    const agir = (botao, acao) => ocupado(botao, async () => {
      const chave = chaves.get(c.convite_id);
      try {
        if (acao === 'recusar') {
          const ok = await abrirDialogo({ titulo: 'Recusar convite?', mensagens: [`Você não entrará na equipe de ${c.empresa_nome}. Para entrar depois, será preciso um novo convite.`],
            rotuloConfirmar: 'Recusar convite', rotuloCancelar: 'Voltar' });
          if (!ok) return;
          await recusarConvite(c.convite_id, chave.recusar);
          await carregar();
          anunciar('sucesso', 'Convite recusado.');
        } else {
          await aceitarConvite(c.convite_id, chave.aceitar);
          await carregar();
          anunciar('sucesso', `Você agora faz parte da equipe de ${c.empresa_nome}.`, el('p', {}, `Seu acesso: ${c.perfil_nome}.`));
        }
      } catch (erro) {
        if (erro.codigo !== 'NETWORK_UNKNOWN') chave[acao] = novaChave();
        anunciar('erro', erro.message);
        if (['STATE_CONFLICT', 'NOT_FOUND'].includes(erro.codigo)) await carregar();
      }
    });
    aceitar.addEventListener('click', () => agir(aceitar, 'aceitar'));
    recusar.addEventListener('click', () => agir(recusar, 'recusar'));
    return el('li', { class: 'cartao pilha' },
      el('h3', { class: 'cartao__titulo' }, c.empresa_nome),
      el('p', {}, `Perfil de acesso: ${c.perfil_nome}. Vale até ${formatarDataHora(c.expira_em)}.`),
      el('div', { class: 'grupo-botoes' }, aceitar, recusar));
  };
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-convites' },
    el('h2', { id: 'titulo-convites' }, 'Convites para você'),
    el('p', {}, 'Ao aceitar, você entra na equipe com o perfil indicado. Quem administra a empresa nunca vê sua senha.'),
    el('ul', { class: 'lista-simples' }, ...convites.map(item)));
}

// ---------------------------------------------------------------------------------------------------------------
// Cadastro em modal
// ---------------------------------------------------------------------------------------------------------------
const BLOCOS = [['identificacao', 'Identificação'], ['atividade', 'Categoria e atividade'], ['contato', 'Contato e localização'], ['identidade', 'Identidade visual'], ['revisao', 'Revisão']];
const OBRIGATORIOS = ['nome_publico', 'modalidade', 'categoria_id', 'cidade', 'email_contato'];
const OPCIONAIS = ['bairro', 'area_atendimento', 'telefone_publico', 'whatsapp_publico', 'email_publico', 'descricao_publica'];

function blocoEtapa(id, titulo, ...conteudo) {
  return el('section', { class: 'bloco-cadastro', id: `bloco-${id}`, 'aria-labelledby': `titulo-bloco-${id}` },
    el('h3', { id: `titulo-bloco-${id}`, class: 'bloco-cadastro__titulo' }, titulo), ...conteudo);
}

function abrirCadastro() {
  let chaves = { criar: novaChave(), completar: novaChave(), logo: novaChave(), definir: novaChave() };
  let logo = null;
  const previa = el('div', { class: 'logo-previa' }, el('span', { class: 'logo-empresa logo-empresa--g', 'aria-hidden': 'true' }, 'CK'));
  const entradaLogo = el('input', { type: 'file', id: 'nova-logo', name: 'logo', accept: 'image/png,image/jpeg,image/webp', 'aria-describedby': 'nova-logo-ajuda nova-logo-erro' });
  const removerLogo = el('button', { type: 'button', class: 'botao botao--texto', hidden: true }, 'Remover logo');
  const form = el('form', { id: 'form-nova-empresa', class: 'cadastro-empresa', novalidate: true },
    el('nav', { class: 'cadastro-empresa__indice', 'aria-label': 'Partes do cadastro' },
      el('ol', {}, ...BLOCOS.map(([id, nome], i) => el('li', {}, el('a', { href: `#bloco-${id}`, 'data-ir': id }, el('span', { 'aria-hidden': 'true' }, String(i + 1)), nome))))),
    el('div', { class: 'cadastro-empresa__blocos' },
      blocoEtapa('identificacao', '1 · Identificação',
        campoTexto({ nome: 'nome_publico', rotulo: 'Nome do negócio', obrigatorio: true, max: 120, id: 'nova-nome', ajuda: 'Como os clientes conhecem você.' }),
        campoSelecao({ nome: 'modalidade', rotulo: 'O que a empresa faz', obrigatorio: true, opcoes: Object.entries(MODALIDADES), id: 'nova-modalidade' })),
      blocoEtapa('atividade', '2 · Categoria e atividade',
        campoSelecao({ nome: 'categoria_id', rotulo: 'Categoria principal', obrigatorio: true, opcoes: listaCategorias.map((c) => [c.id, c.nome]), id: 'nova-categoria' }),
        campoTexto({ nome: 'descricao_publica', rotulo: 'Descrição para a vitrine', linhas: 3, max: 1000, id: 'nova-descricao',
          ajuda: 'Opcional. Aparece na vitrine depois da análise da CK.' })),
      blocoEtapa('contato', '3 · Contato e localização',
        campoTexto({ nome: 'cidade', rotulo: 'Cidade', obrigatorio: true, max: 80, id: 'nova-cidade', autocomplete: 'address-level2', ajuda: 'Estado: São Paulo (SP). Nesta fase, o AutoniCK atende apenas SP.' }),
        campoTexto({ nome: 'bairro', rotulo: 'Bairro', max: 80, id: 'nova-bairro' }),
        campoTexto({ nome: 'area_atendimento', rotulo: 'Área de atendimento', max: 200, id: 'nova-area', ajuda: 'Opcional. Ex.: "Centro e bairros vizinhos".' }),
        campoTexto({ nome: 'email_contato', rotulo: 'E-mail de contato da empresa', tipo: 'email', obrigatorio: true, max: 254, id: 'nova-email',
          ajuda: 'Privado: usado pela CK para falar com você. Não aparece na vitrine.' }),
        campoTexto({ nome: 'telefone_publico', rotulo: 'Telefone público', tipo: 'tel', max: 20, id: 'nova-telefone', ajuda: 'Opcional. Só números com DDD.' }),
        campoTexto({ nome: 'whatsapp_publico', rotulo: 'WhatsApp público', tipo: 'tel', max: 20, id: 'nova-whatsapp', ajuda: 'Opcional. Só números com DDD.' }),
        campoTexto({ nome: 'email_publico', rotulo: 'E-mail público', tipo: 'email', max: 254, id: 'nova-email-publico', ajuda: 'Opcional. Aparece na vitrine depois da análise.' })),
      blocoEtapa('identidade', '4 · Identidade visual',
        arquivosDisponiveis
          ? el('div', { class: 'campo campo-logo' }, previa,
            el('div', { class: 'pilha' }, el('label', { for: 'nova-logo' }, 'Logo da empresa (opcional)'),
              el('span', { class: 'campo__ajuda', id: 'nova-logo-ajuda' }, 'PNG, JPG ou WebP, até 2 MB, de preferência quadrada (mínimo 256 × 256). Sem logo, usamos as iniciais.'),
              entradaLogo, removerLogo, el('span', { class: 'campo__erro', id: 'nova-logo-erro' })))
          : el('p', { class: 'campo__ajuda' }, 'O envio de logo está disponível no AutoniCK com a API Java. Você pode cadastrar a empresa agora e enviar a logo depois.')),
      blocoEtapa('revisao', '5 · Revisão', el('dl', { class: 'dados', id: 'nova-revisao' }),
        el('p', { class: 'campo__ajuda' }, 'O ERP funciona logo depois do cadastro. A vitrine pública só aparece depois que você enviar para a análise da CK.'))));
  const progresso = el('span', { class: 'cadastro-empresa__progresso', 'aria-live': 'polite' });
  const enviar = el('button', { type: 'submit', class: 'botao', form: 'form-nova-empresa' }, 'Cadastrar empresa');
  const cancelar = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Cancelar');
  let alterado = false;
  const modal = abrirModal({ titulo: 'Cadastrar nova empresa', descricao: 'Só os campos marcados como obrigatórios são necessários agora. O resto pode ser completado depois.',
    corpo: form, rodape: [progresso, cancelar, enviar], tamanho: 'grande', protegerAlteracoes: () => alterado });
  cancelar.addEventListener('click', () => modal.dialogo.dispatchEvent(new Event('cancel', { cancelable: true })));
  const revisar = () => {
    const d = valores(form);
    const feitos = OBRIGATORIOS.filter((c) => d[c]).length;
    progresso.textContent = feitos === OBRIGATORIOS.length ? 'Tudo pronto para cadastrar' : `${feitos} de ${OBRIGATORIOS.length} campos obrigatórios`;
    const linha = (rot, v) => [el('dt', {}, rot), el('dd', {}, v || '—')];
    form.querySelector('#nova-revisao').replaceChildren(
      ...linha('Nome', d.nome_publico), ...linha('Modalidade', MODALIDADES[d.modalidade]), ...linha('Categoria', listaCategorias.find((c) => c.id === d.categoria_id)?.nome),
      ...linha('Cidade', d.cidade && `${d.cidade} (SP)${d.bairro ? ` · ${d.bairro}` : ''}`), ...linha('E-mail de contato', d.email_contato),
      ...linha('Logo', logo ? logo.name : 'Sem logo (iniciais)'));
    for (const a of form.querySelectorAll('[data-ir]')) {
      const bloco = form.querySelector(`#bloco-${a.dataset.ir}`);
      const obrig = [...bloco.querySelectorAll('[aria-required="true"]')];
      a.classList.toggle('feito', obrig.length > 0 && obrig.every((c) => c.value.trim()));
    }
  };
  form.addEventListener('input', () => { alterado = true; revisar(); });
  form.addEventListener('change', () => { alterado = true; revisar(); });
  revisar();
  // Índice acompanha a rolagem do corpo do modal
  const io = new IntersectionObserver((ents) => {
    for (const en of ents) if (en.isIntersecting) for (const a of form.querySelectorAll('[data-ir]')) a.toggleAttribute('aria-current', `bloco-${a.dataset.ir}` === en.target.id);
  }, { root: modal.corpo, rootMargin: '-10% 0px -70% 0px' });
  form.querySelectorAll('.bloco-cadastro').forEach((b) => io.observe(b));
  form.querySelector('.cadastro-empresa__indice').addEventListener('click', (e) => {
    const a = e.target.closest('[data-ir]'); if (!a) return;
    e.preventDefault();
    form.querySelector(`#bloco-${a.dataset.ir}`).scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    form.querySelector(`#bloco-${a.dataset.ir}`).querySelector('input, select, textarea')?.focus({ preventScroll: true });
  });
  entradaLogo?.addEventListener('change', () => {
    const erroLogo = form.querySelector('#nova-logo-erro');
    const arq = entradaLogo.files[0];
    const problema = conferirImagem(arq);
    erroLogo.textContent = arq && problema ? problema : '';
    logo = arq && !problema ? arq : null;
    if (!logo) { entradaLogo.value = ''; previa.replaceChildren(el('span', { class: 'logo-empresa logo-empresa--g', 'aria-hidden': 'true' }, 'CK')); removerLogo.hidden = true; revisar(); return; }
    const url = URL.createObjectURL(logo);
    const img = el('img', { src: url, alt: 'Prévia da logo' });
    img.addEventListener('load', () => {
      if (Math.min(img.naturalWidth, img.naturalHeight) < 128) { erroLogo.textContent = 'A imagem é pequena demais (mínimo 128 px). Ela ficaria borrada.'; logo = null; entradaLogo.value = ''; }
      revisar();
    });
    previa.replaceChildren(el('span', { class: 'logo-empresa logo-empresa--g' }, img), el('span', { class: 'campo__ajuda' }, 'Assim ela aparece no menu, na central e na vitrine.'));
    removerLogo.hidden = false;
  });
  removerLogo.addEventListener('click', () => { entradaLogo.value = ''; entradaLogo.dispatchEvent(new Event('change')); });

  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limparErros(form);
    const d = { ...valores(form), uf: 'SP' };
    const faltando = OBRIGATORIOS.find((c) => !d[c]);
    if (faltando) { erroNoCampo(form, faltando, 'Preencha este campo.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email_contato)) { erroNoCampo(form, 'email_contato', 'Confira o e-mail (exemplo: contato@seunegocio.com.br).'); return; }
    for (const c of ['telefone_publico', 'whatsapp_publico']) {
      if (d[c]) { d[c] = d[c].replace(/\D/g, ''); if (!/^\d{10,13}$/.test(d[c])) { erroNoCampo(form, c, 'Use só números com DDD (10 a 13 dígitos).'); return; } }
    }
    ocupado(enviar, async () => {
      let criada = null;
      try {
        criada = await criarEmpresa({ nome_publico: d.nome_publico, modalidade: d.modalidade, categoria_id: d.categoria_id, cidade: d.cidade, uf: 'SP', email_contato: d.email_contato }, chaves.criar);
      } catch (erro) {
        if (erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, erro.campo, erro.message)) return;
        if (erro.codigo !== 'NETWORK_UNKNOWN') chaves.criar = novaChave();
        avisos.replaceChildren(el('div', { role: 'alert' }, aviso('erro', erro.message)));
        return;
      }
      // A empresa já existe: os complementos são aplicados em seguida; se algum falhar, ela continua criada e o aviso diz o que faltou.
      const pendencias = [];
      const extras = Object.fromEntries(OPCIONAIS.filter((c) => d[c]).map((c) => [c, d[c]]));
      if (Object.keys(extras).length) {
        try { await atualizarEmpresa(criada.id, extras, criada.versao ?? 1, chaves.completar); } catch (erro) { pendencias.push(`dados opcionais (${erro.message})`); }
      }
      if (logo) {
        try {
          const arq = await enviarArquivo(logo, { finalidade: 'logo_empresa', empresaId: criada.id, chave: chaves.logo });
          await definirLogoEmpresa(criada.id, arq.id, chaves.definir);
        } catch (erro) { pendencias.push(`logo (${erro.message})`); }
      }
      alterado = false;
      lembrarRecente(criada.id);
      sucessoCadastro(modal, criada, d.nome_publico, pendencias);
      carregar();
    });
  });
  if (new URLSearchParams(location.search).get('cadastrar') === '1') history.replaceState(null, '', location.pathname);
}

function sucessoCadastro(modal, criada, nome, pendencias) {
  const usar = el('a', { class: 'botao', href: `/business/dashboard.html?id=${encodeURIComponent(criada.id)}` }, `Usar ${nome} agora`);
  const vitrine = el('a', { class: 'botao botao--secundario', href: `/business/empresa.html?id=${encodeURIComponent(criada.id)}&criada=1` }, 'Completar a vitrine');
  modal.corpo.replaceChildren(el('div', { class: 'cadastro-concluido', role: 'status' },
    el('span', { class: 'sino-sprite sino-sprite--estatico', 'aria-hidden': 'true' }),
    el('h3', {}, 'Empresa cadastrada'),
    el('p', {}, `${nome} já pode usar o ERP. A vitrine fica em rascunho até você enviá-la para análise.`),
    pendencias.length ? aviso('alerta', 'Alguns complementos não foram salvos', el('p', {}, `Ficou para depois: ${pendencias.join('; ')}. Você pode completar em "Empresa e vitrine".`)) : null));
  modal.pe.replaceChildren(vitrine, usar);
  usar.focus();
}

// ---------------------------------------------------------------------------------------------------------------
async function carregar() {
  mostrarCarregando(area, 'Carregando suas empresas');
  try {
    if (!(await exigirSessao(area))) return;
    const [lista, cats, convites, logos, favs] = await Promise.all([minhasEmpresas(), categorias(), meusConvites(),
      logosDasMinhasEmpresas().catch(() => ({})), meusFavoritos().catch(() => [])]);
    listaCategorias = cats;
    const favoritas = new Set(favs.filter((f) => f.tipo === 'empresa').map((f) => f.chave));
    const ativa = obterEmpresaAtiva()?.id;
    concluirCarregamento(area);
    const botaoNovo = el('button', { type: 'button', class: 'botao', id: 'abrir-cadastro-empresa' }, 'Cadastrar nova empresa');
    botaoNovo.addEventListener('click', abrirCadastro);
    acoesTopo?.replaceChildren(botaoNovo);
    const busca = el('input', { type: 'search', id: 'busca-empresas', class: 'busca-lista', placeholder: 'Pesquisar por nome ou cidade', 'aria-label': 'Pesquisar empresas', autocomplete: 'off' });
    const ul = el('ul', { class: 'grade-empresas', id: 'lista-empresas', role: 'list' });
    const contagem = el('p', { class: 'campo__ajuda', 'aria-live': 'polite' });
    const aoFavoritar = async (id) => {
      try { const r = await alternarFavorito('empresa', id); if (r.favorito) favoritas.add(id); else favoritas.delete(id); desenhar(); } catch (erro) { anunciar('erro', erro.message); }
    };
    const ordenada = [...lista].sort((a, b) => (b.empresa_id === ativa) - (a.empresa_id === ativa) || favoritas.has(b.empresa_id) - favoritas.has(a.empresa_id) || a.nome_publico.localeCompare(b.nome_publico));
    function desenhar() {
      const q = semAcento(busca.value.trim());
      const vis = ordenada.filter((e) => !q || semAcento(`${e.nome_publico} ${e.cidade}`).includes(q));
      contagem.textContent = q ? `${vis.length} de ${lista.length} empresa(s)` : '';
      ul.replaceChildren(...vis.map((e) => cartaoEmpresa(e, { logo: logos[e.empresa_id], favorita: favoritas.has(e.empresa_id), ativa: e.empresa_id === ativa, aoFavoritar })));
      if (q && !vis.length) ul.replaceChildren(el('li', { class: 'estado-vazio' }, el('p', {}, 'Nenhuma empresa com esse nome ou cidade.')));
    }
    busca.addEventListener('input', desenhar);
    desenhar();
    area.append(...[
      secaoConvites(convites),
      el('section', { class: 'pilha', 'aria-labelledby': 'titulo-lista' },
        el('div', { class: 'cabecalho-secao' }, el('h2', { id: 'titulo-lista' }, `Suas empresas (${lista.length})`), lista.length > 3 ? busca : null),
        contagem,
        lista.length ? ul : el('div', { class: 'estado-vazio' },
          el('p', {}, 'Você ainda não participa de nenhuma empresa.'),
          el('p', {}, 'Cadastre a sua agora ou aceite um convite que chegou no seu e-mail.'),
          (() => { const b = el('button', { type: 'button', class: 'botao' }, 'Cadastrar minha primeira empresa'); b.addEventListener('click', abrirCadastro); return b; })())),
    ].filter(Boolean));
    if (new URLSearchParams(location.search).get('saiu') === '1') {
      history.replaceState(null, '', location.pathname);
      anunciar('sucesso', 'Você saiu da empresa. Seu acesso a ela foi encerrado.');
    }
    if (new URLSearchParams(location.search).get('cadastrar') === '1') abrirCadastro();
    // Logo depois de entrar: empresa ativa válida (vínculo conferido de novo) ou única empresa abre direto.
    if (new URLSearchParams(location.search).get('entrada') === '1') {
      history.replaceState(null, '', location.pathname);
      const alvo = lista.find((e) => e.empresa_id === ativa) ?? (lista.length === 1 ? lista[0] : null);
      if (alvo && !convites?.length) {
        area.prepend(el('p', { class: 'campo__ajuda', role: 'status', id: 'abrindo-empresa' }, `Abrindo ${alvo.nome_publico}…`));
        await irParaEmpresa({ id: alvo.empresa_id, nome: alvo.nome_publico, dado_de_teste: alvo.dado_de_teste }).catch((erro) => anunciar('erro', erro.message));
      }
    }
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { class: 'botao botao--secundario', href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
