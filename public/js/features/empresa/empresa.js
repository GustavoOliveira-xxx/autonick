/**
 * Detalhe da empresa (M03): situação do ERP e da vitrine, edição em três grupos
 * (relevantes, menor risco e privados), envio para análise, contestação e histórico.
 * M04: cada parte aparece conforme as permissões atuais da pessoa nesta empresa;
 * o banco confere de novo a cada ação (a tela só orienta).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { definirEmpresaAtiva } from '../../core/contexto-empresa.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import {
  empresa as lerEmpresa, dadosPrivados, categorias, solicitacoes, contestacoes, historico, vitrinePublicada,
  atualizarEmpresa, enviarParaAnalise, abrirContestacao, novaChave,
  MODALIDADES, ROTULOS_CAMPOS, CAMPOS_RELEVANTES, CAMPOS_MENOR_RISCO, CAMPOS_PRIVADOS,
} from '../../data/empresas.js';
import { minhasPermissoes, sairDaEmpresa } from '../../data/equipe.js';
import { exigirSessao, chipSituacao, chipErp, chipPapel, chipTeste, semAcesso, listaHistorico, formatarDataHora } from './comum.js';

iniciarLayout();
const id = parametro('id');
const area = document.getElementById('empresa');
const avisos = document.getElementById('avisos');
const titulo = document.getElementById('titulo-empresa');
const chaves = { salvar: novaChave(), enviar: novaChave(), contestar: novaChave(), sair: novaChave() };

function anunciar(tipo, texto, ...extra) {
  avisos.replaceChildren(el('div', { role: tipo === 'erro' ? 'alert' : 'status' }, aviso(tipo, texto, ...extra)));
  avisos.scrollIntoView({ block: 'nearest' });
}

const rotulosDe = (campos) => (campos ?? []).map((c) => ROTULOS_CAMPOS[c] ?? c).join(', ');

/** Mensagem principal por situação (MINI-ESPEC_M03 §6). */
function mensagemSituacao(e, ultimaDecidida, ultimoEventoCk, contestacaoAtiva) {
  const motivo = (m) => (m ? el('p', {}, `Motivo: ${m}`) : null);
  if (contestacaoAtiva) {
    return aviso('info', 'Recebemos sua contestação. A CK vai revisar a decisão.',
      el('p', {}, `Situação da contestação: ${contestacaoAtiva.estado === 'em_revisao' ? 'em revisão pela CK' : 'enviada'}.`));
  }
  switch (e.situacao_vitrine) {
    case 'rascunho':
      return aviso('info', 'Sua empresa já pode usar o ERP. A vitrine ainda não foi enviada para análise.');
    case 'em_analise':
      return aviso('info', 'Sua vitrine foi enviada para análise da CK. Enquanto isso, o ERP funciona normalmente.');
    case 'correcao_solicitada':
      return aviso('alerta', `A CK pediu ajustes na vitrine: ${rotulosDe(ultimaDecidida?.campos_corrigir)}.`, motivo(ultimaDecidida?.motivo));
    case 'rejeitada':
      return aviso('alerta', 'A vitrine não foi aprovada. Seu ERP continua funcionando.', motivo(ultimaDecidida?.motivo),
        el('p', {}, 'Você pode corrigir os dados e reenviar, ou contestar a decisão.'));
    case 'publicada':
      return e.solicitacao_aberta
        ? aviso('info', 'Sua alteração está em análise. Até a decisão, o público vê a versão anterior.')
        : aviso('sucesso', 'Sua vitrine está publicada com o selo Aprovado para publicação.');
    case 'suspensa':
      return aviso('erro', 'A divulgação da vitrine foi suspensa pela CK. Seus dados do ERP continuam disponíveis.',
        motivo(ultimoEventoCk?.motivo),
        e.suspensao_gravidade === 'grave'
          ? el('p', {}, 'Medidas adicionais podem ser aplicadas a pedidos; cada uma será informada com o fundamento.') : null);
    default:
      return null;
  }
}

/** Dados só para leitura, para quem vê mas não pode alterar. */
function dadosSomenteLeitura(e, cats, campos) {
  const valor = (c) => (c === 'categoria_id' ? cats.find((x) => x.id === e[c])?.nome : c === 'modalidade' ? MODALIDADES[e[c]] : e[c]);
  const linhas = campos.filter((c) => valor(c)).flatMap((c) => [el('dt', {}, ROTULOS_CAMPOS[c]), el('dd', {}, valor(c))]);
  return linhas.length ? el('dl', { class: 'dados' }, ...linhas) : el('p', {}, 'Nenhum dado preenchido.');
}

function formularioEdicao(e, cats, pode) {
  const editaPublicos = pode('vitrine.alterar');
  const vePrivados = pode('empresa.visualizar');
  const editaPrivados = vePrivados && pode('empresa.alterar');
  const publicos = [...CAMPOS_RELEVANTES, ...CAMPOS_MENOR_RISCO];
  if (!editaPublicos && !editaPrivados) {
    return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-editar' },
      el('h2', { id: 'titulo-editar' }, 'Dados da empresa'),
      el('p', { class: 'campo__ajuda' }, 'Seu perfil de acesso permite consultar, mas não alterar estes dados.'),
      dadosSomenteLeitura(e, cats, vePrivados ? [...publicos, ...CAMPOS_PRIVADOS] : publicos));
  }
  const enviar = el('button', { type: 'submit', class: 'botao' }, 'Salvar alterações');
  const publicada = e.situacao_vitrine === 'publicada';
  const t = (nome, extra = {}) => campoTexto({ nome, rotulo: ROTULOS_CAMPOS[nome], valor: e[nome] ?? '', id: `editar-${nome}`, ...extra });
  const form = el('form', { id: 'form-editar', class: 'pilha-grande', novalidate: true },
    !editaPublicos ? el('div', { class: 'pilha' },
      el('h3', {}, 'Dados públicos'),
      el('p', { class: 'campo__ajuda' }, 'Seu perfil de acesso não permite alterar a vitrine.'),
      dadosSomenteLeitura(e, cats, publicos)) : null,
    !editaPublicos ? null : el('fieldset', { class: 'pilha' },
      el('legend', {}, el('h3', {}, 'Dados públicos que passam por análise da CK')),
      el('p', { class: 'campo__ajuda' }, publicada
        ? 'Mudanças aqui só aparecem ao público depois da aprovação da CK. Até lá, o público vê a versão aprovada.'
        : 'Estes dados serão analisados pela CK antes da publicação.'),
      t('nome_publico', { obrigatorio: true, max: 120 }),
      campoSelecao({ nome: 'categoria_id', rotulo: ROTULOS_CAMPOS.categoria_id, obrigatorio: true, valor: e.categoria_id, id: 'editar-categoria_id', opcoes: cats.map((c) => [c.id, c.nome]) }),
      campoSelecao({ nome: 'modalidade', rotulo: ROTULOS_CAMPOS.modalidade, obrigatorio: true, valor: e.modalidade, id: 'editar-modalidade', opcoes: Object.entries(MODALIDADES) }),
      t('cidade', { obrigatorio: true, max: 80, autocomplete: 'address-level2' }),
      el('p', { class: 'campo__ajuda' }, 'Estado: São Paulo (SP).'),
      t('bairro', { max: 80 }),
      t('area_atendimento', { max: 200, ajuda: 'Exemplo: Campinas e região, atendimento a domicílio.' }),
      t('telefone_publico', { tipo: 'tel', max: 20, ajuda: 'Opcional. Só será público se você preencher. Use DDD e número.' }),
      t('whatsapp_publico', { tipo: 'tel', max: 20, ajuda: 'Opcional. Use DDD e número.' }),
      t('email_publico', { tipo: 'email', max: 254, ajuda: 'Opcional. Diferente do e-mail de contato privado.' })),
    !editaPublicos ? null : el('fieldset', { class: 'pilha' },
      el('legend', {}, el('h3', {}, 'Dados públicos de menor risco')),
      el('p', { class: 'campo__ajuda' }, publicada
        ? 'Com a vitrine publicada, estas mudanças aparecem ao público na hora e podem ser revisadas pela CK.'
        : 'Também são analisados no primeiro envio.'),
      t('descricao_publica', { linhas: 4, max: 1000, ajuda: 'Sem telefone, e-mail ou link: use os campos de contato público.' }),
      t('horario_funcionamento', { max: 300, ajuda: 'Exemplo: segunda a sábado, das 9h às 18h.' })),
    !editaPrivados ? null : el('fieldset', { class: 'pilha' },
      el('legend', {}, el('h3', {}, 'Dados privados (nunca aparecem ao público)')),
      t('email_contato', { tipo: 'email', obrigatorio: true, max: 254 }),
      t('documento', { max: 18, ajuda: 'Opcional. CPF (11 dígitos) ou CNPJ (14 dígitos). Não é verificado pela CK.' }),
      t('endereco_privado', { max: 300 }),
      t('observacoes_internas', { linhas: 3, max: 1000 })),
    vePrivados && !editaPrivados ? el('div', { class: 'pilha' },
      el('h3', {}, 'Dados privados'),
      el('p', { class: 'campo__ajuda' }, 'Seu perfil de acesso permite consultar, mas não alterar estes dados.'),
      dadosSomenteLeitura(e, cats, CAMPOS_PRIVADOS)) : null,
    el('div', { class: 'grupo-botoes' }, enviar),
  );
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limparErros(form);
    const dados = valores(form);
    const alterados = {};
    for (const campo of [...CAMPOS_RELEVANTES, ...CAMPOS_MENOR_RISCO, ...CAMPOS_PRIVADOS]) {
      if (campo in dados && (dados[campo] ?? '') !== (e[campo] ?? '')) alterados[campo] = dados[campo];
    }
    if (!Object.keys(alterados).length) {
      anunciar('info', 'Nenhuma alteração para salvar.');
      return;
    }
    ocupado(enviar, async () => {
      try {
        const r = await atualizarEmpresa(e.id, alterados, e.versao, chaves.salvar);
        chaves.salvar = novaChave();
        await carregar();
        if (r.publicado_direto?.length) {
          anunciar('sucesso', 'Alteração publicada. A CK pode revisá-la depois.', el('p', {}, `Campos: ${rotulosDe(r.publicado_direto)}.`));
        } else if (r.situacao_vitrine === 'publicada' && r.relevantes_pendentes?.length) {
          anunciar('sucesso', 'Alterações salvas.', el('p', {}, `Os campos ${rotulosDe(r.relevantes_pendentes)} passam por análise. Envie a alteração para a CK; até a decisão, o público vê a versão anterior.`));
        } else {
          anunciar('sucesso', 'Alterações salvas.');
        }
      } catch (erro) {
        await tratarFalha(erro, form, 'salvar');
      }
    });
  });
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-editar' },
    el('h2', { id: 'titulo-editar' }, 'Dados da empresa e da vitrine'), form);
}

async function tratarFalha(erro, form, acao) {
  if (erro.codigo === 'VALIDATION_ERROR' && form && erroNoCampo(form, erro.campo, erro.message)) return;
  if (erro.codigo === 'TENANT_FORBIDDEN') {
    semAcesso(area);
    return;
  }
  if (erro.codigo === 'NETWORK_UNKNOWN') {
    // A resposta pode ter se perdido: a mesma chave é reaproveitada na próxima tentativa.
    anunciar('erro', erro.message, el('p', {}, 'Tente novamente: se a ação já tiver sido registrada, ela não será duplicada.'));
    return;
  }
  chaves[acao] = novaChave();
  if (erro.codigo === 'FORBIDDEN_ACTION') {
    // As permissões podem ter mudado desde que a tela abriu: atualiza e explica.
    await carregar();
    anunciar('erro', erro.message, el('p', {}, 'Atualizamos a tela com o seu acesso atual.'));
    return;
  }
  if (['STATE_CONFLICT', 'VERSION_CONFLICT'].includes(erro.codigo)) {
    await carregar();
    anunciar('alerta', 'A situação da sua vitrine mudou. Atualizamos a tela; confira antes de continuar.', el('p', {}, erro.message));
    return;
  }
  anunciar('erro', erro.message);
}

function blocoEnvio(e, contestacaoAtiva) {
  const podeInicial = ['rascunho', 'correcao_solicitada', 'rejeitada'].includes(e.situacao_vitrine) && !contestacaoAtiva;
  const podeAlteracao = e.situacao_vitrine === 'publicada' && !e.solicitacao_aberta && e.relevantes_pendentes?.length;
  if (!podeInicial && !podeAlteracao) return null;
  const botao = el('button', { type: 'button', class: 'botao botao--destaque' }, podeAlteracao ? 'Enviar alteração para análise' : 'Enviar vitrine para análise');
  botao.addEventListener('click', () => ocupado(botao, async () => {
    try {
      await enviarParaAnalise(e.id, e.versao, chaves.enviar);
      chaves.enviar = novaChave();
      await carregar();
      anunciar('sucesso', podeAlteracao ? 'Alteração enviada para análise da CK.' : 'Vitrine enviada para análise da CK.');
    } catch (erro) {
      await tratarFalha(erro, null, 'enviar');
    }
  }));
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-envio' },
    el('h2', { id: 'titulo-envio' }, podeAlteracao ? 'Alteração pendente de análise' : 'Enviar para análise'),
    podeAlteracao ? el('p', {}, `Campos alterados: ${rotulosDe(e.relevantes_pendentes)}.`) : el('p', {}, 'Confira os dados abaixo antes de enviar. A CK analisa só os dados públicos.'),
    el('div', { class: 'grupo-botoes' }, botao));
}

function blocoContestacao(e, contestacaoAtiva) {
  if (!['rejeitada', 'suspensa'].includes(e.situacao_vitrine) || contestacaoAtiva) return null;
  const enviar = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Enviar contestação');
  const form = el('form', { id: 'form-contestar', class: 'pilha', novalidate: true },
    campoTexto({ nome: 'motivo', rotulo: 'Por que a decisão deve ser revista?', linhas: 4, max: 2000, obrigatorio: true, id: 'contestar-motivo',
      ajuda: 'Explique os fatos (10 a 2000 caracteres).' }),
    el('div', { class: 'grupo-botoes' }, enviar));
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limparErros(form);
    const { motivo } = valores(form);
    if (!motivo || motivo.length < 10) {
      erroNoCampo(form, 'motivo', 'Explique o motivo com pelo menos 10 caracteres.');
      return;
    }
    ocupado(enviar, async () => {
      try {
        await abrirContestacao(e.id, motivo, chaves.contestar);
        chaves.contestar = novaChave();
        await carregar();
        anunciar('sucesso', 'Recebemos sua contestação. A CK vai revisar a decisão.');
      } catch (erro) {
        await tratarFalha(erro, form, 'contestar');
      }
    });
  });
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-contestar' },
    el('h2', { id: 'titulo-contestar' }, 'Contestar a decisão'), form);
}

function blocoVitrine(card, cats) {
  if (!card) return null;
  const linha = (rotulo, valor) => (valor ? [el('dt', {}, rotulo), el('dd', {}, valor)] : []);
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-vitrine' },
    el('h2', { id: 'titulo-vitrine' }, 'Como o público verá a vitrine'),
    el('p', {}, el('span', { class: 'chip chip--sucesso' }, el('span', { 'aria-hidden': 'true' }, '✓'), card.selo)),
    el('dl', { class: 'dados' },
      ...linha('Nome', card.nome_publico),
      ...linha('Categoria', cats.find((c) => c.id === card.categoria_id)?.nome),
      ...linha('Modalidade', MODALIDADES[card.modalidade]),
      ...linha('Local', [card.bairro, `${card.cidade} (${card.uf})`].filter(Boolean).join(', ')),
      ...linha('Área de atendimento', card.area_atendimento),
      ...linha('Telefone', card.telefone_publico),
      ...linha('WhatsApp', card.whatsapp_publico),
      ...linha('E-mail', card.email_publico),
      ...linha('Descrição', card.descricao_publica),
      ...linha('Horário', card.horario_funcionamento)),
    el('p', { class: 'campo__ajuda' }, 'Nesta fase, a vitrine ainda não aparece na busca pública.'));
}

/** Papel, perfil, atalho para a equipe e saída voluntária (D4-4). */
function blocoAcesso(acesso, e, pode) {
  const partes = [el('p', { class: 'opcoes' }, chipPapel(acesso.papel, acesso.perfil_nome), e.dado_de_teste ? chipTeste() : null)];
  if (pode('equipe.visualizar')) {
    partes.push(el('p', {}, el('a', { href: `/business/equipe.html?id=${encodeURIComponent(id)}` }, 'Equipe, convites e perfis de acesso')));
  }
  const links = [
    [pode('produtos.visualizar') || pode('estoque.visualizar'), 'produtos-empresa', 'Produtos'],
    [pode('estoque.visualizar'), 'estoque-empresa', 'Estoque'],
    [pode('fornecedores.visualizar') || pode('estoque.visualizar'), 'fornecedores', 'Fornecedores e compras'],
    [pode('clientes.visualizar'), 'clientes', 'Clientes'],
    [pode('vendas.visualizar') || pode('vendas.criar'), 'vendas', 'Vendas'],
    [pode('pedidos.visualizar'), 'pedidos-empresa', 'Pedidos'],
    [pode('catalogo_servicos.visualizar'), 'servicos', 'Serviços'],
    [pode('orcamentos.visualizar'), 'solicitacoes', 'Orçamentos'],
    [pode('agenda.visualizar'), 'agenda', 'Agenda'],
    [pode('financeiro.visualizar'), 'financeiro', 'Financeiro'],
  ].filter(([ok]) => ok);
  if (links.length) {
    partes.push(el('ul', { class: 'opcoes', 'aria-label': 'Áreas do ERP' }, ...links.map(([, pagina, rotulo]) =>
      el('li', {}, el('a', { href: `/business/${pagina}.html?id=${encodeURIComponent(id)}` }, rotulo)))));
  }
  if (acesso.papel === 'funcionario') {
    const sair = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Sair da empresa');
    sair.addEventListener('click', () => ocupado(sair, async () => {
      const ok = await abrirDialogo({ titulo: `Sair de ${e.nome_publico}?`,
        mensagens: ['Seu acesso a esta empresa acaba na hora. O que você fez continua registrado no histórico.', 'Para voltar, será preciso um novo convite.'],
        rotuloConfirmar: 'Sair da empresa', rotuloCancelar: 'Continuar na empresa' });
      if (!ok) return;
      try {
        await sairDaEmpresa(id, chaves.sair);
        location.assign('/business/minhas-empresas.html?saiu=1');
      } catch (erro) {
        await tratarFalha(erro, null, 'sair');
      }
    }));
    partes.push(el('div', { class: 'grupo-botoes' }, sair));
  }
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-acesso' },
    el('h2', { id: 'titulo-acesso' }, 'Seu acesso'), ...partes);
}

async function carregar() {
  if (!id) {
    area.replaceChildren(aviso('info', 'Empresa não informada.', el('p', {}, el('a', { href: '/business/minhas-empresas.html' }, 'Ver suas empresas'))));
    return;
  }
  mostrarCarregando(area, 'Carregando a empresa');
  try {
    if (!(await exigirSessao(area))) return;
    let acesso;
    try {
      acesso = await minhasPermissoes(id);
    } catch (erro) {
      if (erro.codigo === 'TENANT_FORBIDDEN') {
        semAcesso(area);
        return;
      }
      throw erro;
    }
    const permissoes = new Set(acesso.permissoes);
    const pode = (codigo) => permissoes.has(codigo);
    const e = await lerEmpresa(id);
    if (!e) {
      concluirCarregamento(area);
      area.append(el('div', { role: 'alert' }, aviso('alerta', 'Empresa não encontrada ou sem acesso para esta conta.',
        el('p', {}, el('a', { href: '/business/minhas-empresas.html' }, 'Ver suas empresas')))));
      return;
    }
    definirEmpresaAtiva({ id, nome: e.nome_publico, papel: acesso.papel, permissoes: acesso.permissoes, dado_de_teste: e.dado_de_teste });
    if (pode('empresa.visualizar')) Object.assign(e, await dadosPrivados(id));
    const verVitrine = pode('vitrine.visualizar');
    const nada = async () => [];
    const [cats, sols, conts, eventos, card] = await Promise.all([categorias(),
      verVitrine ? solicitacoes(id) : nada(), verVitrine ? contestacoes(id) : nada(), verVitrine ? historico(id) : nada(),
      verVitrine ? vitrinePublicada(id) : null]);
    e.solicitacao_aberta = sols.find((s) => s.estado === 'aberta') ?? null;
    e.relevantes_pendentes = card
      ? CAMPOS_RELEVANTES.filter((c) => (e[c] ?? null) !== ((e.dados_publicados ?? {})[c] ?? null))
      : [];
    const ultimaDecidida = sols.find((s) => s.estado !== 'aberta' && s.decidida_em) ?? null;
    const ultimoEventoCk = eventos.find((ev) => ev.papel_ator === 'ck' && ev.situacao_nova === e.situacao_vitrine) ?? null;
    const contestacaoAtiva = conts.find((c) => ['aberta', 'em_revisao'].includes(c.estado)) ?? null;
    titulo.textContent = e.nome_publico;
    document.title = `${e.nome_publico} | AutoniCK Business`;
    concluirCarregamento(area);
    const alteraVitrine = pode('vitrine.alterar');
    area.append(...[
      blocoAcesso(acesso, e, pode),
      el('section', { class: 'pilha', 'aria-labelledby': 'titulo-situacao' },
        el('h2', { id: 'titulo-situacao' }, 'Situação'),
        el('p', { class: 'opcoes' }, chipErp(), verVitrine ? chipSituacao(e.situacao_vitrine) : null),
        verVitrine ? mensagemSituacao(e, ultimaDecidida, ultimoEventoCk, contestacaoAtiva) : null),
      alteraVitrine ? blocoEnvio(e, contestacaoAtiva) : null,
      alteraVitrine ? blocoContestacao(e, contestacaoAtiva) : null,
      verVitrine ? blocoVitrine(card, cats) : null,
      formularioEdicao(e, cats, pode),
      verVitrine ? el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-historico' },
        el('h2', { id: 'titulo-historico' }, 'Histórico da vitrine'),
        el('p', { class: 'campo__ajuda' }, `Empresa cadastrada em ${formatarDataHora(e.criado_em)}.`),
        listaHistorico(eventos)) : null,
    ].filter(Boolean));
    if (parametro('criada') === '1') {
      history.replaceState(null, '', `${location.pathname}?id=${encodeURIComponent(id)}`);
      anunciar('sucesso', 'Empresa cadastrada. O ERP já pode ser usado; complete a vitrine e envie para análise quando quiser.');
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
