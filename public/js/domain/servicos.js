/**
 * Regras de exibição do M08, puras e testáveis. Nenhum preço é calculado aqui: a estimativa e os totais vêm do banco.
 */
import { formatarCentavos } from './moeda.js';

const dinheiro = (c) => (Number.isSafeInteger(c) ? formatarCentavos(c) : '');

/** Texto da estimativa como o banco a devolveu (valor único, faixa, a partir de ou análise manual). */
export function textoEstimativa(e) {
  if (!e) return '';
  if (e.completa && e.exibicao === 'faixa' && Number.isSafeInteger(e.minimo_centavos)) return `Entre ${dinheiro(e.minimo_centavos)} e ${dinheiro(e.maximo_centavos)}`;
  if (e.completa && Number.isSafeInteger(e.valor_centavos)) return dinheiro(e.valor_centavos);
  if (e.tipo === 'a_partir_de' && Number.isSafeInteger(e.minimo_centavos)) return `A partir de ${dinheiro(e.minimo_centavos)}`;
  return 'A empresa vai analisar e enviar o orçamento';
}

/** P-M11-02: aviso mostrado ao Cliente quando a tela traz só uma estimativa. */
export const AVISO_ESTIMATIVA_CLIENTE = 'Este é um valor estimado. Confira o orçamento antes de aceitar.';

/**
 * Texto de ajuda da estimativa na área do Cliente (P-M11-02). Usa só o contrato atual:
 * - com orçamento já gerado (versão visível na solicitação), nenhum aviso: o que vale é o orçamento mostrado na tela;
 * - só estimativa com valor (único, faixa ou "a partir de"), o aviso fixo de valor estimado;
 * - sem valor (sob consulta, regras incompletas), o rótulo do banco, que explica que a empresa vai analisar.
 * Não calcula nada nem muda o aceite.
 */
export function ajudaEstimativaCliente(e, { orcamentoDisponivel = false } = {}) {
  if (!e || orcamentoDisponivel) return null;
  const temValor = (e.completa && Number.isSafeInteger(e.valor_centavos))
    || (e.completa && e.exibicao === 'faixa' && Number.isSafeInteger(e.minimo_centavos))
    || (e.tipo === 'a_partir_de' && Number.isSafeInteger(e.minimo_centavos));
  return temValor ? AVISO_ESTIMATIVA_CLIENTE : (e.rotulo ?? null);
}

/**
 * Lê as respostas de um formulário renderizado a partir das perguntas do serviço.
 * Devolve { respostas, erros } com erros = [{ nome, mensagem }] só para formato (a regra fica no banco).
 */
export function lerRespostas(perguntas, valores) {
  const respostas = {};
  const erros = [];
  for (const p of perguntas) {
    const nome = `p-${p.id}`;
    const bruto = valores[nome];
    if (p.tipo === 'sim_nao') {
      if (bruto === 'sim') respostas[p.id] = true;
      else if (bruto === 'nao') respostas[p.id] = false;
    } else if (p.tipo === 'escolha_multipla') {
      const lista = [].concat(bruto ?? []).filter(Boolean);
      if (lista.length) respostas[p.id] = lista;
    } else if (p.tipo === 'numero') {
      if (bruto !== undefined && bruto !== '') {
        const n = Number(String(bruto).replace(',', '.'));
        if (!Number.isFinite(n)) erros.push({ nome, mensagem: 'Informe um número.' });
        else respostas[p.id] = n;
      }
    } else if (bruto) {
      respostas[p.id] = bruto;
    }
    if (p.obrigatoria && !(p.id in respostas) && !erros.some((e) => e.nome === nome)) erros.push({ nome, mensagem: 'Responda esta pergunta.' });
  }
  return { respostas, erros };
}

/** Valor exibido de uma resposta do retrato da solicitação. */
export function textoResposta(r) {
  if (r.tipo === 'sim_nao') return r.valor ? 'Sim' : 'Não';
  if (Array.isArray(r.valor)) return r.valor.join(', ');
  if (r.tipo === 'numero') return `${String(r.valor).replace('.', ',')}${r.unidade ? ` ${r.unidade}` : ''}`;
  return String(r.valor ?? '');
}

/** Validade de uma versão: 'vence hoje', 'vencida' ou 'válido até DD/MM/AAAA' (comparando datas de São Paulo). */
export function textoValidade(validoAte, hoje) {
  if (!validoAte) return '';
  if (validoAte < hoje) return 'Vencida';
  if (validoAte === hoje) return 'Vence hoje';
  const [a, m, d] = validoAte.split('-');
  return `Válido até ${d}/${m}/${a}`;
}

/** Monta o instante ISO a partir de data e hora locais de São Paulo (UTC−3, sem horário de verão desde 2019). */
export function instanteSaoPaulo(data, hora) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data ?? '') || !/^\d{2}:\d{2}$/.test(hora ?? '')) return null;
  return `${data}T${hora}:00-03:00`;
}

const formatoHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const soHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
/** "segunda-feira, 16/11, 09:00 às 11:00" no horário de São Paulo. */
export function textoHorario(inicio, fim) {
  if (!inicio) return '';
  return `${formatoHora.format(new Date(inicio))}${fim ? ` às ${soHora.format(new Date(fim))}` : ''}`;
}

/** Converte a grade do formulário (dia → [{abre, fecha}]) no formato do banco, ignorando intervalos vazios. */
export function montarGrade(entradas) {
  const grade = [];
  for (let dia = 0; dia < 7; dia += 1) {
    const intervalos = (entradas[dia] ?? []).filter((i) => i.abre && i.fecha).map((i) => ({ abre: i.abre, fecha: i.fecha }));
    grade.push({ dia_semana: dia, intervalos });
  }
  return grade;
}

/** Converte linhas de opções (uma por linha) em lista sem vazios nem repetidos (o banco confere de novo). */
export function lerOpcoes(texto) {
  const vistas = new Set();
  return String(texto ?? '').split('\n').map((x) => x.trim()).filter((x) => {
    const chave = x.toLowerCase();
    if (!x || vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}

/**
 * Próxima ação de uma OS na lista (E07; pacote 27/11): o passo seguinte permitido pelo estado REAL da OS e pelas permissões
 * de quem vê. Não inventa etapa: sem permissão para agir, a ação vira "Acompanhar"; OS encerrada ou cancelada não tem ação.
 * O banco continua decidindo (checklist obrigatório bloqueia a conclusão, por exemplo). Devolve { texto, aba, agir } ou null.
 */
export function proximaAcaoOs(o, pode = () => false) {
  if (!o || ['encerrada', 'cancelada'].includes(o.estado)) return null;
  const altera = pode('servicos.alterar');
  if (o.revisao_pendente) return altera ? { texto: 'Responder à revisão pedida pelo cliente', aba: 'comunicacao', agir: true } : { texto: 'Acompanhar: revisão pedida', aba: 'comunicacao', agir: false };
  if (o.reagendamento_pendente) return altera ? { texto: 'Responder ao pedido de horário', aba: 'geral', agir: true } : { texto: 'Acompanhar: horário em negociação', aba: 'geral', agir: false };
  if (o.usos_pendentes) return pode('estoque.aprovar') || altera ? { texto: 'Confirmar uso de material', aba: 'materiais', agir: true } : { texto: 'Acompanhar: material a confirmar', aba: 'materiais', agir: false };
  if (!altera) return { texto: 'Acompanhar o serviço', aba: 'geral', agir: false };
  if (o.estado === 'aguardando_inicio') return o.horario ? { texto: 'Iniciar o serviço', aba: 'geral', agir: true } : { texto: 'Combinar o horário', aba: 'geral', agir: true };
  if (o.estado === 'em_execucao') return { texto: 'Concluir (confira o checklist)', aba: 'checklist', agir: true };
  if (o.estado === 'pausada') return { texto: 'Retomar o serviço', aba: 'geral', agir: true };
  if (o.estado === 'concluida') return { texto: 'Aguardando o cliente confirmar o recebimento', aba: 'comunicacao', agir: false };
  return null;
}
