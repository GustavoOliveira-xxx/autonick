/**
 * Detalhe da solicitação (M08, RF-086, RF-091, RF-092, RF-094, RF-097 a RF-101, RF-114; D8-10 a D8-17, D8-20, D8-21):
 * respostas e estimativa, editor do orçamento (o total vem do banco), envio ou aprovação interna, versões imutáveis,
 * negociação com notas internas, horário definido pela empresa com avisos, aceite informado (balcão) e cancelamento.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, erroNoCampo, limparErros, ocupado, valores } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { secaoConversa } from '../comunicacao/conversa.js';
import { lerValorEmReais } from '../../domain/moeda.js';
import { instanteSaoPaulo } from '../../domain/servicos.js';
import { produtosDaEmpresa } from '../../data/estoque.js';
import { solicitacao as lerSolicitacao, assumir, salvarRascunho, enviarOrcamento, aprovarOrcamento, registrarMensagem, aceitarOrcamento,
  recusarOrcamento, cancelarSolicitacao, confirmarHorario, TIPO_COMPONENTE, MOTIVO_RECUSA } from '../../data/servicos.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, chipSolicitacao, blocoEstimativa, blocoRespostas, cartaoVersao,
  linhaDoTempo, blocoHorario, dialogoFormulario, dataDeHoje, somarDias } from './comum.js';
import { botaoPdf, nomeDeQuemGera } from '../../pdf/baixar.js';
import { registrarExportacaoPdf } from '../../data/exportacao.js';
import { comprovanteOrcamento } from '../../pdf/documentos.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));

const solicitacaoId = parametro('solicitacao');
let ctx = null;
let s = null;
let materiais = null;
let itens = [];
const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });
const aberta = () => ['nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida'].includes(s.estado);
const reais = (c) => (Number.isSafeInteger(c) ? (c / 100).toFixed(2).replace('.', ',') : '');

function itensIniciais() {
  const base = s.versoes.find((v) => ['rascunho', 'aguardando_aprovacao'].includes(v.estado)) ?? s.versoes.find((v) => v.id === s.versao_vigente_id);
  if (base) return base.componentes.map((c) => ({ ...c }));
  if (s.estimativa?.completa) return s.estimativa.base.map((b) => ({ tipo: 'outro', descricao: b.rotulo, quantidade: 1, valor_unitario_centavos: b.valor_centavos, desconto_centavos: 0 }));
  return [{ tipo: 'mao_de_obra', descricao: '', quantidade: 1, valor_unitario_centavos: 0, desconto_centavos: 0 }];
}

function lerItens(form) {
  const d = valores(form);
  const lidos = [];
  for (let i = 0; i < itens.length; i += 1) {
    const id = `item-${i}`;
    const unit = lerValorEmReais(d[`${id}-unit`] || '0');
    const desc = lerValorEmReais(d[`${id}-desc`] || '0');
    const qtd = Number(String(d[`${id}-qtd`] || '').replace(',', '.'));
    if (!unit.ok) return { erro: [`${id}-unit`, unit.erro] };
    if (!desc.ok) return { erro: [`${id}-desc`, desc.erro] };
    if (!(qtd > 0)) return { erro: [`${id}-qtd`, 'Quantidade maior que zero.'] };
    if (!d[`${id}-descricao`]) return { erro: [`${id}-descricao`, 'Descreva o item.'] };
    lidos.push({ tipo: d[`${id}-tipo`], descricao: d[`${id}-descricao`], quantidade: qtd, valor_unitario_centavos: unit.centavos,
      desconto_centavos: desc.centavos, ...(d[`${id}-material`] ? { variacao_id: d[`${id}-material`] } : {}) });
  }
  return { itens: lidos };
}

function linhaItem(c, i) {
  const id = `item-${i}`;
  const opcoesMaterial = (materiais ?? []).flatMap((p) => p.variacoes.map((v) => [v.id, `${p.nome}${v.padrao ? '' : ` (${v.rotulo})`}${p.finalidade === 'uso_interno' ? ' · uso interno' : ''}`]));
  const fs = el('fieldset', { class: 'cartao pilha', 'data-item': i }, el('legend', {}, `Item ${i + 1}`),
    campoSelecao({ nome: `${id}-tipo`, rotulo: 'Tipo', opcoes: Object.entries(TIPO_COMPONENTE), valor: c.tipo, vazio: null, id: `${id}-tipo` }),
    c.tipo === 'material' && opcoesMaterial.length ? campoSelecao({ nome: `${id}-material`, rotulo: 'Ligar ao catálogo (opcional)', opcoes: opcoesMaterial,
      valor: c.variacao_id ?? '', vazio: 'Sem ligação', id: `${id}-material`, ajuda: 'A ligação é interna: o cliente vê só a descrição abaixo.' }) : null,
    campoTexto({ nome: `${id}-descricao`, rotulo: 'Descrição para o cliente', obrigatorio: true, max: 120, valor: c.descricao, id: `${id}-descricao` }),
    campoTexto({ nome: `${id}-qtd`, rotulo: 'Quantidade', valor: String(c.quantidade ?? 1).replace('.', ','), id: `${id}-qtd` }),
    campoTexto({ nome: `${id}-unit`, rotulo: 'Valor unitário (R$)', valor: reais(c.valor_unitario_centavos), id: `${id}-unit` }),
    campoTexto({ nome: `${id}-desc`, rotulo: 'Desconto no item (R$)', valor: reais(c.desconto_centavos), id: `${id}-desc` }));
  fs.querySelector(`[name="${id}-tipo"]`).addEventListener('change', (e) => { const r = lerItens(fs.form); if (r.itens) itens = r.itens; itens[i].tipo = e.target.value; desenhar(); });
  const remover = el('button', { type: 'button', class: 'botao botao--secundario', 'data-remover-item': i }, `Remover item ${i + 1}`);
  remover.addEventListener('click', () => { const r = lerItens(fs.form); if (r.itens) itens = r.itens; itens.splice(i, 1); desenhar(); });
  remover.disabled = itens.length === 1;
  fs.append(remover);
  return fs;
}

function editor() {
  if (!ctx.pode('orcamentos.criar') || !aberta()) return null;
  const rasc = s.versoes.find((v) => ['rascunho', 'aguardando_aprovacao'].includes(v.estado));
  const salvar = el('button', { type: 'submit', class: 'botao' }, 'Salvar rascunho');
  const adicionar = el('button', { type: 'button', class: 'botao botao--secundario', id: 'adicionar-item' }, 'Adicionar item');
  const form = el('form', { class: 'pilha', id: 'form-orcamento', novalidate: true }, ...itens.map(linhaItem),
    el('div', { class: 'grupo-botoes' }, adicionar),
    campoTexto({ nome: 'desconto_geral', rotulo: 'Desconto geral (R$)', valor: reais(rasc?.desconto_geral_centavos ?? 0), id: 'orc-desconto',
      ajuda: s.limite_desconto_percentual === null ? 'Seu perfil não tem limite de desconto.' : `Seu limite: ${s.limite_desconto_percentual}% do valor. Acima disso, a versão vai para aprovação.` }),
    campoTexto({ nome: 'valido_ate', rotulo: 'Válido até', tipo: 'date', valor: rasc?.valido_ate ?? somarDias(dataDeHoje(), s.servico_atual?.validade_dias ?? 15), id: 'orc-validade',
      ajuda: 'De hoje até 90 dias. Vencido, o cliente só aceita uma nova versão.' }),
    campoTexto({ nome: 'prazo_execucao', rotulo: 'Prazo de execução', max: 120, valor: rasc?.prazo_execucao ?? '', id: 'orc-prazo' }),
    campoTexto({ nome: 'condicoes', rotulo: 'Condições', linhas: 3, max: 1000, valor: rasc?.condicoes ?? '', id: 'orc-condicoes',
      ajuda: 'O que está e o que não está incluído. O cliente confirma estas condições ao aceitar.' }),
    el('p', { class: 'campo__ajuda' }, 'O total é calculado pelo sistema a partir dos itens. Uma versão enviada não muda: salvar de novo cria a próxima versão.'),
    el('div', { class: 'grupo-botoes' }, salvar));
  adicionar.addEventListener('click', () => { const r = lerItens(form); if (r.itens) itens = r.itens; itens.push({ tipo: 'outro', descricao: '', quantidade: 1, valor_unitario_centavos: 0 }); desenhar(); });
  adicionar.disabled = itens.length >= 50;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const r = lerItens(form);
    if (r.erro) return erroNoCampo(form, r.erro[0], r.erro[1]);
    itens = r.itens;
    const d = valores(form);
    const dg = lerValorEmReais(d.desconto_geral || '0');
    if (!dg.ok) return erroNoCampo(form, 'desconto_geral', dg.erro);
    const dados = { componentes: r.itens, desconto_geral_centavos: dg.centavos, valido_ate: d.valido_ate || null, prazo_execucao: d.prazo_execucao || null, condicoes: d.condicoes || null };
    return ocupado(salvar, () => executar('rascunho', form, (k) => salvarRascunho(s.id, dados, s.versao, k),
      (v) => anunciar('sucesso', `Rascunho da versão ${v.numero} salvo: ${reais(v.total_centavos)} reais.`, el('p', {}, 'Confira e envie ao cliente na versão abaixo.'))));
  });
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-editor' }, el('h2', { id: 'titulo-editor' }, rasc ? `Editar rascunho da versão ${rasc.numero}` : 'Preparar orçamento'), form);
}

function acoesVersao(v) {
  const b = [];
  if (v.estado === 'rascunho' && ctx.pode('orcamentos.criar')) {
    const enviar = el('button', { type: 'button', class: 'botao', 'data-enviar': v.numero }, ctx.pode('orcamentos.aprovar') ? 'Enviar ao cliente' : 'Enviar para aprovação');
    enviar.addEventListener('click', () => ocupado(enviar, async () => {
      const ok = await abrirDialogo({ titulo: `Enviar a versão ${v.numero}?`, rotuloConfirmar: 'Enviar', rotuloCancelar: 'Voltar',
        mensagens: ['Depois de enviada, a versão não muda. Se houver versão anterior enviada, ela deixa de valer.',
          'Sem permissão de aprovação, ou com desconto acima do seu limite, ela vai primeiro para aprovação interna.'] });
      if (!ok) return;
      await executar(`enviar-${v.id}`, null, (k) => enviarOrcamento(v.id, v.versao, k),
        (r) => anunciar('sucesso', r.estado === 'enviada' ? `Versão ${r.numero} enviada ao cliente.` : `Versão ${r.numero} aguardando aprovação interna.`));
    }));
    b.push(enviar);
  }
  if (v.estado === 'aguardando_aprovacao' && ctx.pode('orcamentos.aprovar')) {
    const aprovar = el('button', { type: 'button', class: 'botao', 'data-aprovar': v.numero }, 'Aprovar e enviar');
    aprovar.addEventListener('click', () => ocupado(aprovar, () => executar(`aprovar-${v.id}`, null, (k) => aprovarOrcamento(v.id, v.versao, k),
      () => anunciar('sucesso', `Versão ${v.numero} aprovada e enviada ao cliente.`))));
    b.push(aprovar);
  }
  if (v.estado === 'enviada' && s.origem === 'interna' && ctx.pode('orcamentos.aprovar') && aberta()) {
    const aceitar = el('button', { type: 'button', class: 'botao', 'data-aceite-informado': v.numero }, 'Registrar aceite do cliente');
    aceitar.addEventListener('click', () => ocupado(aceitar, async () => {
      const ok = await abrirDialogo({ titulo: 'Registrar o aceite informado pelo cliente?', rotuloConfirmar: 'Registrar aceite', rotuloCancelar: 'Voltar',
        mensagens: [`O cliente ${s.cliente_nome} aceitou a versão ${v.numero} e as condições mostradas. O registro fica com o seu nome.`,
          'O aceite cria a ordem de serviço. Nenhuma cobrança é criada automaticamente.'] });
      if (!ok) return;
      await executar(`aceite-${v.id}`, null, (k) => aceitarOrcamento(s.id, v.id, k), () => anunciar('sucesso', 'Aceite registrado e ordem de serviço criada.'));
    }));
    const recusar = el('button', { type: 'button', class: 'botao botao--secundario', 'data-recusa-informada': v.numero }, 'Registrar recusa do cliente');
    recusar.addEventListener('click', () => ocupado(recusar, async () => {
      const r = await dialogoFormulario({ id: 'recusa-informada', titulo: 'Recusa informada pelo cliente', rotuloConfirmar: 'Registrar recusa',
        campos: [campoSelecao({ nome: 'opcao', rotulo: 'Motivo', opcoes: Object.entries(MOTIVO_RECUSA), vazio: null, id: 'recusa-opcao' }),
          campoTexto({ nome: 'texto', rotulo: 'Detalhe (opcional)', max: 300, id: 'recusa-texto' })],
        validar: (form) => valores(form) });
      if (!r) return;
      await executar(`recusa-${v.id}`, null, (k) => recusarOrcamento(s.id, v.id, { opcao: r.opcao, texto: r.texto || null }, k), () => anunciar('sucesso', 'Recusa registrada. Nenhuma cobrança foi gerada.'));
    }));
    b.push(aceitar, recusar);
  }
  return b;
}

function secaoHorario() {
  const partes = [blocoHorario(s.horario)];
  if (s.horario?.avisos?.length) partes.push(el('p', { class: 'campo__ajuda' }, `Confirmado com aviso: ${s.horario.avisos.map((a) => a.mensagem).join(' ')}${s.horario.justificativa ? ` Justificativa: ${s.horario.justificativa}` : ''}`));
  // Depois do aceite, o horário é da ordem de serviço (D9-18): proposta e reagendamento por acordo.
  const pode = ctx.pode('agenda.alterar') && aberta();
  if (s.estado === 'aceita' && s.os) partes.push(el('p', {}, 'Depois do aceite, o horário é combinado na ',
    el('a', { href: `/business/ordem.html?id=${encodeURIComponent(ctx.id)}&os=${encodeURIComponent(s.os.id)}` }, 'ordem de serviço'), '.'));
  if (pode) {
    const confirmar = el('button', { type: 'submit', class: 'botao botao--secundario' }, s.horario ? 'Trocar horário' : 'Definir horário');
    const form = el('form', { class: 'pilha', id: 'form-horario', novalidate: true },
      campoTexto({ nome: 'data', rotulo: 'Data', tipo: 'date', id: 'horario-data', obrigatorio: true }),
      campoTexto({ nome: 'hora', rotulo: 'Hora de início', tipo: 'time', id: 'horario-hora', obrigatorio: true }),
      campoTexto({ nome: 'duracao', rotulo: 'Duração (minutos)', valor: s.servico_atual?.duracao_min ?? 60, id: 'horario-duracao', ajuda: 'De 15 a 720.' }),
      el('div', { class: 'grupo-botoes' }, confirmar));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const d = valores(form);
      const inicio = instanteSaoPaulo(d.data, d.hora);
      if (!inicio) return erroNoCampo(form, d.data ? 'hora' : 'data', 'Informe a data e a hora.');
      const duracao = Number(d.duracao);
      return ocupado(confirmar, async () => {
        const r = await executar('horario', form, (k) => confirmarHorario(s.id, inicio, duracao, false, null, k), () => {});
        if (!r || r.confirmado) {
          if (r?.confirmado) anunciar('sucesso', 'Horário definido. O cliente vê que foi a empresa que definiu e pode pedir outro pela mensagem.');
          return;
        }
        const j = await dialogoFormulario({ id: 'aviso-horario', titulo: 'Confirmar mesmo assim?', rotuloConfirmar: 'Confirmar o horário',
          descricao: r.avisos.map((a) => a.mensagem), campos: [campoTexto({ nome: 'justificativa', rotulo: 'Justificativa (opcional)', max: 300, id: 'aviso-justificativa' })],
          validar: (f) => valores(f) });
        if (!j) return;
        await executar('horario-aviso', form, (k) => confirmarHorario(s.id, inicio, duracao, true, j.justificativa, k),
          () => anunciar('sucesso', 'Horário definido com o aviso registrado.'));
      });
    });
    partes.push(form);
  }
  if (s.historico_horarios?.length > 1) {
    partes.push(el('details', {}, el('summary', {}, 'Horários anteriores'), el('ul', {}, ...s.historico_horarios.filter((h) => h.estado !== 'confirmado')
      .map((h) => el('li', {}, `${new Date(h.inicio).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (${h.estado})`)))));
  }
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-horario' }, el('h2', { id: 'titulo-horario' }, 'Horário do atendimento'), ...partes);
}

// M12: a conversa com o cliente fica em secaoConversa (a mesma da OS); aqui só as notas internas, que nunca entram
// na conversa, e a linha do tempo sem repetir as mensagens.
function secaoMensagens() {
  const partes = [linhaDoTempo(s.eventos.filter((e) => e.tipo !== 'mensagem'))];
  if (ctx.pode('orcamentos.criar') && !['recusada', 'cancelada'].includes(s.estado)) {
    const enviar = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Registrar nota interna');
    const form = el('form', { class: 'pilha', id: 'form-mensagem', novalidate: true },
      campoTexto({ nome: 'texto', rotulo: 'Nota interna (o cliente não vê)', linhas: 2, max: 1000, id: 'mensagem-texto', ajuda: 'Até 1.000 caracteres. Sem anexos.' }),
      el('div', { class: 'grupo-botoes' }, enviar));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const d = valores(form);
      if (!d.texto) return erroNoCampo(form, 'texto', 'Escreva a nota.');
      return ocupado(enviar, () => executar('mensagem', form, (k) => registrarMensagem(s.id, d.texto, true, k),
        () => anunciar('sucesso', 'Nota interna registrada.')));
    });
    partes.push(form);
  }
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-mensagens' }, el('h2', { id: 'titulo-mensagens' }, 'Linha do tempo e notas internas'), ...partes);
}

/** Comprovante do orçamento aceito (M13, D13-08): só a versão aceita; quem vê orçamentos pode gerar (D13-09). */
function botaoComprovanteOrcamento() {
  const aceita = s.versoes.find((v) => v.estado === 'aceita');
  if (!aceita) return null;
  return el('p', {}, botaoPdf({ rotulo: 'Baixar comprovante do orçamento aceito (PDF)', id: 'baixar-pdf-orcamento', anunciar,
    montar: async () => comprovanteOrcamento(s, aceita, { empresa: ctx.empresa?.nome_publico ?? 'Empresa', usuario: await nomeDeQuemGera(), agora: new Date() }),
    registrar: (chave) => registrarExportacaoPdf(ctx.id, 'orcamento', aceita.id, null, null, chave) }));
}

function desenhar() {
  const hoje = dataDeHoje();
  const topo = el('div', { class: 'pilha' }, el('p', {}, el('a', { class: 'botao botao--secundario', href: `/business/solicitacoes.html?id=${encodeURIComponent(ctx.id)}` }, 'Voltar às solicitações')),
    el('h2', { id: 'resumo-solicitacao' }, `Nº ${s.numero} · ${s.servico} `, chipSolicitacao(s.estado_exibicao)),
    el('p', {}, `Cliente: ${s.cliente_nome}${s.origem === 'interna' ? ' (balcão ou telefone)' : ''}`),
    s.estado === 'aceita' && s.os ? aviso('sucesso', 'Orçamento aceito: a ordem de serviço foi criada. Nenhuma cobrança automática.',
      el('p', {}, el('a', { class: 'botao botao--secundario', href: `/business/ordem.html?id=${encodeURIComponent(ctx.id)}&os=${encodeURIComponent(s.os.id)}`, id: 'link-os' }, `Abrir a OS nº ${s.os.numero}`))) : null,
    botaoComprovanteOrcamento(),
    s.politica_cancelamento ? el('p', { class: 'campo__ajuda' }, `Política de cancelamento mostrada ao cliente (versão ${s.politica_cancelamento.versao}): ${s.politica_cancelamento.texto}`) : null,
    s.motivo_encerramento ? el('p', {}, `Motivo do encerramento: ${s.motivo_encerramento}`) : null);
  const acoes = [];
  if (s.estado === 'nova' && ctx.pode('orcamentos.criar')) {
    const b = el('button', { type: 'button', class: 'botao botao--secundario', id: 'assumir' }, 'Começar a análise');
    b.addEventListener('click', () => ocupado(b, () => executar('assumir', null, (k) => assumir(s.id, s.versao, k), () => anunciar('sucesso', 'O cliente vê que a análise começou.'))));
    acoes.push(b);
  }
  if (aberta() && ctx.pode('orcamentos.cancelar')) {
    const c = el('button', { type: 'button', class: 'botao botao--secundario', id: 'cancelar' }, 'Recusar ou cancelar a solicitação');
    c.addEventListener('click', () => ocupado(c, async () => {
      const r = await dialogoFormulario({ id: 'cancelar-solic', titulo: 'Encerrar a solicitação?', rotuloConfirmar: 'Encerrar',
        descricao: ['O cliente verá o motivo. Nenhuma cobrança é gerada.'],
        campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, linhas: 2, max: 300, id: 'cancelar-motivo', ajuda: 'De 10 a 300 caracteres.' })],
        validar: (form) => { const m = valores(form).motivo ?? ''; return m.length >= 10 ? { motivo: m } : (erroNoCampo(form, 'motivo', 'Explique com pelo menos 10 caracteres.') && null); } });
      if (!r) return;
      await executar('cancelar', null, (k) => cancelarSolicitacao(s.id, r.motivo, k), () => anunciar('sucesso', 'Solicitação encerrada.'));
    }));
    acoes.push(c);
  }
  area.replaceChildren(topo, acoes.length ? el('div', { class: 'grupo-botoes' }, ...acoes) : el('span'),
    el('section', { class: 'pilha', 'aria-labelledby': 'titulo-pedido' }, el('h2', { id: 'titulo-pedido' }, 'O que o cliente pediu'), blocoRespostas(s), blocoEstimativa(s.estimativa)),
    secaoHorario(), editor() ?? el('span'),
    el('section', { class: 'pilha', 'aria-labelledby': 'titulo-versoes' }, el('h2', { id: 'titulo-versoes' }, 'Versões do orçamento'),
      s.versoes.length ? el('div', { class: 'pilha', id: 'versoes' }, ...s.versoes.map((v) => cartaoVersao(v, hoje, acoesVersao(v)))) : el('p', { id: 'versoes' }, 'Nenhuma versão ainda.')),
    ...(s.origem === 'plataforma' ? [secaoConversa({ tipo: 'solicitacao', id: s.id, titulo: 'Conversa com o cliente', anunciar }).secao] : []),
    secaoMensagens());
}

async function carregar() {
  mostrarCarregando(area, 'Carregando a solicitação');
  try {
    ctx = ctx ?? await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'solicitacoes'));
    if (!ctx.pode('orcamentos.visualizar')) {
      area.replaceChildren(aviso('erro', 'Seu perfil não inclui ver orçamentos desta empresa.'));
      return;
    }
    s = await lerSolicitacao(solicitacaoId);
    if (materiais === null) materiais = ctx.pode('produtos.visualizar') ? await produtosDaEmpresa(ctx.id).catch(() => []) : [];
    itens = itensIniciais();
    concluirCarregamento(area);
    document.getElementById('titulo-pagina').textContent = `Solicitação nº ${s.numero}`;
    desenhar();
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

carregar();
