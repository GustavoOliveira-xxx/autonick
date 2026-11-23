/**
 * Lista das empresas da pessoa (como proprietária ou funcionária), convites
 * recebidos e cadastro de nova empresa (M03, T1; M04, aceite de convite).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { categorias, minhasEmpresas, criarEmpresa, novaChave, MODALIDADES } from '../../data/empresas.js';
import { meusConvites, aceitarConvite, recusarConvite } from '../../data/equipe.js';
import { exigirSessao, chipSituacao, chipErp, chipPapel, chipTeste, formatarDataHora } from './comum.js';

iniciarLayout();
const area = document.getElementById('empresas');
const avisos = document.getElementById('avisos');

function anunciar(tipo, texto, ...extra) {
  avisos.replaceChildren(el('div', { role: tipo === 'erro' ? 'alert' : 'status' }, aviso(tipo, texto, ...extra)));
  avisos.scrollIntoView({ block: 'nearest' });
}

function cartaoEmpresa(e) {
  return el('li', { class: 'cartao pilha' },
    el('h3', { class: 'cartao__titulo' }, el('a', { href: `/business/empresa.html?id=${encodeURIComponent(e.empresa_id)}` }, e.nome_publico)),
    el('p', { class: 'cartao__meta' }, `${e.cidade} (${e.uf})`),
    el('p', { class: 'opcoes' }, chipPapel(e.papel, e.perfil_nome), chipErp(), chipSituacao(e.situacao_vitrine), e.dado_de_teste ? chipTeste() : null),
  );
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

function formularioNovaEmpresa(listaCategorias) {
  let chave = novaChave();
  const enviar = el('button', { type: 'submit', class: 'botao' }, 'Cadastrar empresa');
  const form = el('form', { id: 'form-nova-empresa', class: 'pilha', novalidate: true },
    campoTexto({ nome: 'nome_publico', rotulo: 'Nome do negócio', obrigatorio: true, max: 120, id: 'nova-nome' }),
    campoSelecao({ nome: 'modalidade', rotulo: 'Modalidade', obrigatorio: true, opcoes: Object.entries(MODALIDADES), id: 'nova-modalidade' }),
    campoSelecao({ nome: 'categoria_id', rotulo: 'Categoria principal', obrigatorio: true, opcoes: listaCategorias.map((c) => [c.id, c.nome]), id: 'nova-categoria' }),
    campoTexto({ nome: 'cidade', rotulo: 'Cidade', obrigatorio: true, max: 80, id: 'nova-cidade', autocomplete: 'address-level2' }),
    el('p', { class: 'campo__ajuda' }, 'Estado: São Paulo (SP). Nesta fase, o AutoniCK atende apenas SP.'),
    campoTexto({ nome: 'email_contato', rotulo: 'E-mail de contato da empresa', tipo: 'email', obrigatorio: true, max: 254, id: 'nova-email',
      ajuda: 'Privado: usado pela CK para falar com você. Não aparece na vitrine.' }),
    el('div', { class: 'grupo-botoes' }, enviar),
  );
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limparErros(form);
    const dados = { ...valores(form), uf: 'SP' };
    const faltando = ['nome_publico', 'modalidade', 'categoria_id', 'cidade', 'email_contato'].find((c) => !dados[c]);
    if (faltando) {
      erroNoCampo(form, faltando, 'Preencha este campo.');
      return;
    }
    ocupado(enviar, async () => {
      try {
        const criada = await criarEmpresa(dados, chave);
        location.assign(`/business/empresa.html?id=${encodeURIComponent(criada.id)}&criada=1`);
      } catch (erro) {
        if (erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, erro.campo, erro.message)) return;
        if (erro.codigo !== 'NETWORK_UNKNOWN') chave = novaChave();
        avisos.replaceChildren(el('div', { role: 'alert' }, aviso('erro', erro.message)));
      }
    });
  });
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-nova-empresa' },
    el('h2', { id: 'titulo-nova-empresa' }, 'Cadastrar empresa'),
    el('p', {}, 'Comece com os dados mínimos. Depois você completa a vitrine e envia para análise.'),
    form);
}

async function carregar() {
  mostrarCarregando(area, 'Carregando suas empresas');
  try {
    if (!(await exigirSessao(area))) return;
    const [lista, cats, convites] = await Promise.all([minhasEmpresas(), categorias(), meusConvites()]);
    concluirCarregamento(area);
    area.append(...[
      secaoConvites(convites),
      el('section', { class: 'pilha', 'aria-labelledby': 'titulo-lista' },
        el('h2', { id: 'titulo-lista' }, 'Suas empresas'),
        lista.length
          ? el('ul', { class: 'lista-simples' }, ...lista.map(cartaoEmpresa))
          : el('p', {}, 'Você ainda não participa de nenhuma empresa. Cadastre a sua ou aceite um convite.')),
      formularioNovaEmpresa(cats),
    ].filter(Boolean));
    if (new URLSearchParams(location.search).get('saiu') === '1') {
      history.replaceState(null, '', location.pathname);
      anunciar('sucesso', 'Você saiu da empresa. Seu acesso a ela foi encerrado.');
    }
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
