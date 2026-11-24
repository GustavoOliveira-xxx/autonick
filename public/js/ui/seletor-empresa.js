/**
 * Troca rápida de empresa (E03): abre de qualquer tela pelo bloco "Empresa ativa" do menu.
 * Pesquisa, favoritas (no servidor), recentes (neste aparelho) e todas. O cadastro completo NÃO fica aqui:
 * há só o atalho "Cadastrar nova empresa", que abre o modal da Central de empresas.
 *
 * Ao escolher: o banco confirma a associação e as permissões (minhas_permissoes); a navegação vai para a mesma tela
 * na nova empresa, se o perfil permitir, ou para o Painel. Como cada tela recarrega com o id na URL, nada da empresa
 * anterior fica em memória.
 */
import { el } from './dom.js';
import { abrirModal } from './modal.js';
import { definirEmpresaAtiva, obterEmpresaAtiva } from '../core/contexto-empresa.js';
import { gruposDaEmpresa, chaveDaPagina } from './menu-empresa.js';

const CHAVE_RECENTES = 'autonick.empresasRecentes';
const lerRecentes = () => { try { return JSON.parse(localStorage.getItem(CHAVE_RECENTES) || '[]').slice(0, 5); } catch { return []; } };
export function lembrarRecente(id) {
  try { localStorage.setItem(CHAVE_RECENTES, JSON.stringify([id, ...lerRecentes().filter((x) => x !== id)].slice(0, 5))); } catch { /* sem armazenamento */ }
}
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const iniciais = (nome) => String(nome ?? '').replace(/\[[^\]]*\]/g, '').split(/\s+/).filter((p) => p.length > 2).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'CK';

/** Logo (ou iniciais) de uma empresa; a imagem protegida é lida com o token. */
export function logoDaEmpresa(nome, url, classe = 'logo-empresa') {
  const caixa = el('span', { class: classe, 'aria-hidden': 'true' }, iniciais(nome));
  if (url) {
    import('../data/arquivos.js').then(({ urlDeImagem }) => urlDeImagem(url)).then((src) => {
      if (src) caixa.replaceChildren(el('img', { src, alt: '', decoding: 'async' }));
    }).catch(() => {});
  }
  return caixa;
}

export async function irParaEmpresa(empresa) {
  const { minhasPermissoes } = await import('../data/equipe.js');
  const acesso = await minhasPermissoes(empresa.id);
  definirEmpresaAtiva({ id: empresa.id, nome: empresa.nome, papel: acesso.papel, permissoes: acesso.permissoes, dado_de_teste: empresa.dado_de_teste });
  lembrarRecente(empresa.id);
  const pode = (c) => acesso.permissoes.includes(c);
  const chave = chaveDaPagina();
  const destino = gruposDaEmpresa(empresa.id, pode).flatMap(([, itens]) => itens).find((i) => i.chave === chave);
  location.assign(destino && location.pathname.startsWith('/business/') ? destino.href : `/business/dashboard.html?id=${encodeURIComponent(empresa.id)}`);
}

export async function abrirSeletorEmpresas() {
  const [{ minhasEmpresas }, { logosDasMinhasEmpresas }, { meusFavoritos, alternarFavorito }] = await Promise.all([
    import('../data/empresas.js'), import('../data/arquivos.js'), import('../data/favoritos.js')]);
  const busca = el('input', { type: 'search', class: 'seletor__busca', placeholder: 'Buscar empresa pelo nome ou cidade', 'aria-label': 'Buscar empresa', autocomplete: 'off', autofocus: '' });
  const lista = el('div', { class: 'seletor__lista', role: 'list', 'aria-live': 'polite' }, el('p', { class: 'seletor__estado' }, 'Carregando suas empresas…'));
  const novo = el('a', { class: 'botao botao--secundario', href: '/business/minhas-empresas.html?cadastrar=1' }, 'Cadastrar nova empresa');
  const todas = el('a', { class: 'botao botao--texto', href: '/business/minhas-empresas.html' }, 'Ver todas em Minhas empresas');
  const modal = abrirModal({ titulo: 'Trocar de empresa', descricao: 'Você continua na mesma tela, agora com os dados da empresa escolhida.',
    corpo: el('div', { class: 'seletor' }, busca, lista), rodape: [todas, novo], tamanho: 'estreito' });
  busca.focus();
  let empresas = [], logos = {}, favoritos = new Set();
  try {
    const [r, l, f] = await Promise.all([minhasEmpresas(), logosDasMinhasEmpresas().catch(() => ({})), meusFavoritos().catch(() => [])]);
    empresas = (r.empresas ?? r).map((e) => ({ id: e.empresa_id ?? e.id, nome: e.nome_publico, cidade: e.cidade, uf: e.uf, papel: e.perfil_nome || (e.papel === 'proprietario' ? 'Proprietário' : e.papel),
      situacao: e.situacao_vitrine, dado_de_teste: e.dado_de_teste }));
    logos = l ?? {};
    favoritos = new Set(f.filter((x) => x.tipo === 'empresa').map((x) => x.chave));
  } catch (erro) {
    lista.replaceChildren(el('p', { class: 'seletor__estado', role: 'alert' }, erro.message || 'Não foi possível carregar suas empresas.'));
    return modal;
  }
  const ativa = obterEmpresaAtiva()?.id;
  const recentes = lerRecentes();
  const item = (e) => {
    const estrela = el('button', { type: 'button', class: 'seletor__favorito', 'aria-pressed': String(favoritos.has(e.id)), 'aria-label': `${favoritos.has(e.id) ? 'Remover' : 'Marcar'} ${e.nome} como favorita` }, '★');
    estrela.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      estrela.disabled = true;
      try {
        const r = await alternarFavorito('empresa', e.id);
        if (r.favorito) favoritos.add(e.id); else favoritos.delete(e.id);
        desenhar();
      } catch (erro) {
        estrela.disabled = false;
        estrela.title = erro.message;
      }
    });
    const escolher = el('button', { type: 'button', class: 'seletor__empresa', 'aria-current': e.id === ativa ? 'true' : null },
      logoDaEmpresa(e.nome, logos[e.id]?.logo_url),
      el('span', { class: 'seletor__texto' }, el('strong', {}, e.nome), el('small', {}, [e.cidade && `${e.cidade} (${e.uf})`, e.papel].filter(Boolean).join(' · '))),
      e.id === ativa ? el('span', { class: 'chip chip--sucesso' }, 'Em uso') : null);
    escolher.addEventListener('click', async () => {
      if (e.id === ativa) { modal.fechar(); return; }
      escolher.setAttribute('aria-busy', 'true');
      escolher.classList.add('abrindo');
      try { await irParaEmpresa(e); } catch (erro) {
        escolher.removeAttribute('aria-busy');
        escolher.classList.remove('abrindo');
        lista.prepend(el('p', { class: 'seletor__estado', role: 'alert' }, erro.message || 'Não foi possível trocar de empresa.'));
      }
    });
    return el('div', { class: 'seletor__linha', role: 'listitem' }, escolher, estrela);
  };
  const grupo = (titulo, itens) => (itens.length ? [el('p', { class: 'seletor__grupo' }, titulo), ...itens.map(item)] : []);
  function desenhar() {
    const q = semAcento(busca.value.trim());
    const filtradas = empresas.filter((e) => !q || semAcento(`${e.nome} ${e.cidade}`).includes(q));
    if (!empresas.length) {
      lista.replaceChildren(el('p', { class: 'seletor__estado' }, 'Você ainda não participa de nenhuma empresa. Cadastre a sua ou aceite um convite.'));
      return;
    }
    if (!filtradas.length) { lista.replaceChildren(el('p', { class: 'seletor__estado' }, 'Nenhuma empresa com esse nome.')); return; }
    if (q) { lista.replaceChildren(...grupo('Resultados', filtradas)); return; }
    const fav = filtradas.filter((e) => favoritos.has(e.id));
    const rec = recentes.map((id) => filtradas.find((e) => e.id === id)).filter((e) => e && !favoritos.has(e.id));
    const resto = filtradas.filter((e) => !favoritos.has(e.id) && !rec.includes(e));
    lista.replaceChildren(...grupo('Favoritas', fav), ...grupo('Recentes', rec), ...grupo(fav.length || rec.length ? 'Todas' : 'Suas empresas', resto));
  }
  busca.addEventListener('input', desenhar);
  desenhar();
  return modal;
}
