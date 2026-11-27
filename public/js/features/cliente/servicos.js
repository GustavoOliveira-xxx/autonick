/**
 * Cliente: pedir orçamento (M08; M11: D11-01 a D11-03, D11-09).
 * Começa SEMPRE pela vitrine (empresa e serviço vêm do link); não há seletor avulso de empresas. O banco confere de novo,
 * na lista, na estimativa e no envio, se o serviço continua publicado e a empresa elegível. A estimativa nunca é o valor
 * final; nenhum horário é reservado; não pedimos endereço completo nem documento. Se a sessão terminar, o rascunho fica só
 * na memória desta página e a pessoa entra de novo sem sair dela (nada é reenviado sozinho).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { lerRespostas } from '../../domain/servicos.js';
import { servicosParaCliente, estimar, criarSolicitacao, POLITICA, TURNO } from '../../data/servicos.js';
import { novaChave } from '../../data/empresas.js';
import { exigirSessao } from '../empresa/comum.js';
import { neon } from '../../data/sessao.js';
import { linkVitrine, uuidOuNulo, pedirEntrada, reentrar, avisoSessaoEncerrada } from './jornada.js';
import { camposDoFormulario, blocoEstimativa, gradeTexto, dinheiro, dataDeHoje } from '../servicos/comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const avisos = document.getElementById('avisos');
const chaves = new Map();
const chave = (a) => { if (!chaves.has(a)) chaves.set(a, novaChave()); return chaves.get(a); };
let empresaId = null;
let catalogo = null;
let servico = null;

function anunciar(tipo, texto, ...extra) {
  avisos.replaceChildren(el('div', { role: tipo === 'erro' ? 'alert' : 'status' }, aviso(tipo, texto, ...extra)));
  avisos.scrollIntoView({ block: 'nearest' });
}

const precoTexto = (s) => (s.politica_preco === 'fixo' ? dinheiro(s.preco_centavos) : s.politica_preco === 'a_partir_de' ? `A partir de ${dinheiro(s.preco_centavos)}`
  : POLITICA[s.politica_preco]);

function formSolicitacao() {
  const resultado = el('div', { id: 'estimativa-cliente' });
  const estimarBotao = el('button', { type: 'button', class: 'botao botao--secundario', id: 'ver-estimativa' }, 'Ver estimativa');
  const enviar = el('button', { type: 'submit', class: 'botao' }, 'Enviar solicitação');
  const form = el('form', { class: 'pilha', id: 'form-solicitacao', novalidate: true },
    ...camposDoFormulario(servico.perguntas, 'cli'),
    campoTexto({ nome: 'relato', rotulo: 'Conte o que você precisa', obrigatorio: true, linhas: 4, max: 2000, id: 'cli-relato',
      ajuda: 'De 10 a 2.000 caracteres. Não escreva documentos, senhas nem dados de cartão.' }),
    campoTexto({ nome: 'cidade', rotulo: 'Cidade (opcional)', max: 80, id: 'cli-cidade' }),
    campoTexto({ nome: 'bairro', rotulo: 'Bairro (opcional)', max: 80, id: 'cli-bairro', ajuda: 'Não pedimos o endereço completo nesta etapa.' }),
    el('fieldset', { class: 'campo' }, el('legend', {}, 'Preferência de horário (opcional, não é reserva)'),
      ...[1, 2, 3].map((i) => campoTexto({ nome: `data${i}`, rotulo: `Data desejada ${i}`, tipo: 'date', id: `cli-data${i}` })),
      campoSelecao({ nome: 'turno', rotulo: 'Turno', opcoes: Object.entries(TURNO), valor: 'qualquer', vazio: null, id: 'cli-turno' }),
      campoTexto({ nome: 'observacao', rotulo: 'Observação sobre o horário', max: 200, id: 'cli-observacao' })),
    resultado, el('div', { class: 'grupo-botoes' }, estimarBotao, enviar));
  const ler = () => {
    limparErros(form);
    const d = valores(form);
    const { respostas, erros } = lerRespostas(servico.perguntas, d);
    return { d, respostas, erros };
  };
  estimarBotao.addEventListener('click', () => ocupado(estimarBotao, async () => {
    const { respostas } = ler();
    try {
      resultado.replaceChildren(blocoEstimativa(await estimar(servico.id, respostas), 'estimativa', { cliente: true }));
    } catch (erro) {
      if (erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, `p-${erro.campo}`, erro.message)) return;
      if (erro.codigo === 'AUTH_REQUIRED') { await sessaoTerminou(); return; }
      if (erro.codigo === 'NOT_FOUND') { itemIndisponivel(erro.message); return; }
      anunciar('erro', erro.message);
    }
  }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { d, respostas, erros } = ler();
    if (erros.length) return erroNoCampo(form, erros[0].nome, erros[0].mensagem);
    if ((d.relato ?? '').length < 10) return erroNoCampo(form, 'relato', 'Conte com pelo menos 10 caracteres.');
    const datas = [d.data1, d.data2, d.data3].filter(Boolean);
    const hoje = dataDeHoje();
    if (datas.some((x) => x < hoje)) return erroNoCampo(form, 'data1', 'As datas desejadas são de hoje em diante.');
    const dados = { respostas, relato: d.relato, cidade: d.cidade || null, bairro: d.bairro || null,
      preferencia: datas.length || d.observacao || d.turno !== 'qualquer' ? { datas, turno: d.turno, observacao: d.observacao || null } : null };
    return ocupado(enviar, async () => {
      try {
        const s = await criarSolicitacao(servico.id, dados, chave(`enviar-${servico.id}`));
        chaves.delete(`enviar-${servico.id}`);
        area.replaceChildren(aviso('sucesso', s.estado === 'orcamento_enviado' ? `Solicitação nº ${s.numero} enviada e orçamento já disponível.` : `Solicitação nº ${s.numero} enviada.`,
          el('p', {}, s.estado === 'orcamento_enviado' ? 'O orçamento foi gerado pelas regras da empresa. Confira antes de aceitar.' : 'A empresa vai analisar e responder. Nenhum horário foi reservado.'),
          el('p', {}, el('a', { class: 'botao botao--secundario', href: `/cliente/solicitacoes.html?s=${encodeURIComponent(s.id)}` }, 'Acompanhar a solicitação'))));
      } catch (erro) {
        if (erro.codigo === 'NETWORK_UNKNOWN') return anunciar('erro', erro.message, el('p', {}, 'Tente de novo: a solicitação não será duplicada.'));
        // Sessão encerrada: nada foi gravado; a mesma chave serve para o envio depois de entrar de novo.
        if (erro.codigo === 'AUTH_REQUIRED') return sessaoTerminou();
        chaves.delete(`enviar-${servico.id}`);
        if (erro.codigo === 'VALIDATION_ERROR' && (erroNoCampo(form, erro.campo, erro.message) || erroNoCampo(form, `p-${erro.campo}`, erro.message))) return null;
        if (erro.codigo === 'NOT_FOUND') return itemIndisponivel(erro.message);
        return anunciar('erro', erro.message);
      }
    });
  });
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-form' }, el('h2', { id: 'titulo-form' }, servico.nome),
    servico.descricao ? el('p', {}, servico.descricao) : null, el('p', {}, el('strong', {}, 'Preço: '), precoTexto(servico)), form);
}

async function sessaoTerminou() {
  if (await reentrar()) {
    anunciar('sucesso', 'Você entrou de novo. Confira os dados e envie quando quiser: nada foi enviado ainda.');
  } else {
    avisos.replaceChildren(el('div', { role: 'alert' }, avisoSessaoEncerrada()));
  }
}

/** O serviço (ou a empresa) deixou de estar disponível para novas solicitações: nada foi criado. */
function itemIndisponivel(mensagem) {
  servico = null;
  area.replaceChildren(aviso('alerta', mensagem || 'Este serviço não está disponível para novas solicitações.',
    el('p', {}, 'Nada foi enviado. Suas solicitações anteriores continuam em Minhas solicitações.'),
    el('p', {}, el('a', { class: 'botao botao--secundario', href: linkVitrine(empresaId) }, 'Voltar para a vitrine da empresa'), ' ', el('a', { class: 'botao botao--secundario', href: '/cliente/solicitacoes.html' }, 'Minhas solicitações'))));
}

function desenhar() {
  const partes = [el('p', {}, el('a', { class: 'botao botao--secundario', href: linkVitrine(empresaId), id: 'voltar-vitrine' }, 'Voltar para a vitrine da empresa'))];
  partes.push(el('h2', {}, `Serviços de ${catalogo.empresa.nome}`), el('p', { class: 'campo__ajuda' }, catalogo.aviso));
  partes.push(catalogo.servicos.length ? el('ul', { class: 'pilha', id: 'servicos-cliente' }, ...catalogo.servicos.map((s) => {
    const b = el('button', { type: 'button', class: 'botao botao--secundario', 'data-escolher': s.id }, 'Pedir orçamento');
    b.addEventListener('click', () => { servico = s; desenhar(); document.getElementById('titulo-form')?.focus(); });
    return el('li', { class: 'cartao pilha' }, el('h3', {}, s.nome), el('p', {}, precoTexto(s)), s.descricao ? el('p', {}, s.descricao) : null, b);
  })) : el('p', { id: 'servicos-cliente' }, 'Esta empresa não tem serviços disponíveis para novas solicitações agora.'));
  partes.push(el('details', {}, el('summary', {}, 'Horário de atendimento'), gradeTexto(catalogo.horarios)));
  if (servico) partes.push(formSolicitacao());
  area.replaceChildren(...partes);
}

async function carregar() {
  mostrarCarregando(area, 'Carregando os serviços');
  try {
    empresaId = uuidOuNulo(parametro('empresa'));
    // D11-03: a porta de entrada é a vitrine; sem empresa vinda dela, orientar para a busca.
    if (!empresaId) {
      concluirCarregamento(area);
      area.replaceChildren(aviso('info', 'Para pedir um orçamento, escolha a empresa e o serviço na busca.',
        el('p', {}, el('a', { class: 'botao botao--secundario', href: linkVitrine(null), class: 'botao' }, 'Ir para a busca')),
        el('p', {}, el('a', { class: 'botao botao--secundario', href: '/cliente/solicitacoes.html' }, 'Ver minhas solicitações'))));
      return;
    }
    if (neon.configurado && !(await neon.temSessao())) { concluirCarregamento(area); pedirEntrada(area); return; }
    if (!(await exigirSessao(area, { perfil: 'cliente', entrada: '/cliente/entrar.html' }))) return;
    try {
      catalogo = await servicosParaCliente(empresaId);
    } catch (erro) {
      if (erro.codigo !== 'NOT_FOUND') throw erro;
      concluirCarregamento(area);
      itemIndisponivel(erro.message);
      return;
    }
    concluirCarregamento(area);
    const pedido = uuidOuNulo(parametro('servico'));
    servico = catalogo.servicos.find((s) => s.id === pedido) ?? null;
    desenhar();
    // Voltando do login com um serviço que saiu da vitrine no intervalo: o banco já não o lista.
    if (pedido && !servico) anunciar('alerta', 'Este serviço não está mais disponível para novas solicitações. Os demais serviços desta empresa estão abaixo.');
    if (servico) document.getElementById('titulo-form')?.focus();
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

carregar();
