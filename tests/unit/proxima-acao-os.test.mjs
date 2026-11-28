/** Próxima ação por OS (E07; pacote 27/11): segue o estado real e as permissões; nunca inventa etapa. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proximaAcaoOs } from '../../public/js/domain/servicos.js';

const gestor = (c) => ['servicos.alterar', 'servicos.visualizar', 'estoque.aprovar'].includes(c);
const leitor = (c) => c === 'servicos.visualizar';

test('por estado, para quem pode alterar', () => {
  assert.equal(proximaAcaoOs({ estado: 'aguardando_inicio', horario: null }, gestor).texto, 'Combinar o horário');
  assert.equal(proximaAcaoOs({ estado: 'aguardando_inicio', horario: { inicio: 'x' } }, gestor).texto, 'Iniciar o serviço');
  assert.deepEqual(proximaAcaoOs({ estado: 'em_execucao' }, gestor), { texto: 'Concluir (confira o checklist)', aba: 'checklist', agir: true });
  assert.equal(proximaAcaoOs({ estado: 'pausada' }, gestor).texto, 'Retomar o serviço');
  assert.equal(proximaAcaoOs({ estado: 'concluida' }, gestor).agir, false);
  assert.equal(proximaAcaoOs({ estado: 'encerrada' }, gestor), null);
  assert.equal(proximaAcaoOs({ estado: 'cancelada' }, gestor), null);
});

test('pendências têm prioridade; sem permissão vira acompanhar', () => {
  assert.equal(proximaAcaoOs({ estado: 'em_execucao', revisao_pendente: true }, gestor).texto, 'Responder à revisão pedida pelo cliente');
  assert.equal(proximaAcaoOs({ estado: 'em_execucao', usos_pendentes: 2 }, gestor).aba, 'materiais');
  assert.equal(proximaAcaoOs({ estado: 'em_execucao' }, leitor).agir, false);
  assert.equal(proximaAcaoOs({ estado: 'aguardando_inicio', reagendamento_pendente: true }, leitor).agir, false);
  assert.equal(proximaAcaoOs(null, gestor), null);
});
