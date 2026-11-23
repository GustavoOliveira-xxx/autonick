/**
 * Peças comuns da jornada do Cliente (M11; ADR-G11).
 * - Retorno ao fluxo quando a sessão termina (D11-09): o rascunho fica SÓ na memória da página; a pessoa entra de novo
 *   num diálogo, sem sair da página e sem reenvio automático; nada é gravado no navegador.
 * - Avisos de suspensão (D11-06, D11-07): mostram só "comum" ou "grave", nunca a justificativa interna da CK.
 * - Origem da vitrine: só navegação (voltar para a vitrine certa); quem decide o que pode ser pedido é o banco.
 */
import { el, parametro } from '../../ui/dom.js';
import { aviso } from '../../ui/estados.js';
import { campoTexto, erroNoCampo, valores } from '../../ui/formulario.js';
import { neon } from '../../data/sessao.js';
import { dialogoFormulario } from '../vendas/comum.js';
import { entrarEVoltar } from '../../domain/retorno.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidOuNulo = (v) => (v && UUID.test(v) ? v : null);

/** Endereço da vitrine de onde a pessoa veio (pública ou demonstração), para o link de volta. */
export function linkVitrine(empresaId) {
  const demo = parametro('origem') === 'demonstracao';
  if (!empresaId) return demo ? '/cliente/demonstracao.html' : '/cliente/';
  return `${demo ? '/cliente/demonstracao-empresa.html' : '/cliente/empresa.html'}?e=${encodeURIComponent(empresaId)}`;
}

/** Sem sessão ao abrir a tela: entrar e voltar para o mesmo lugar (mesma empresa e mesmo item). */
export function pedirEntrada(area) {
  area.replaceChildren(aviso('info', 'Entre na sua conta de Cliente para continuar.',
    el('p', {}, el('a', { href: entrarEVoltar(location.pathname + location.search), id: 'entrar-e-voltar' }, 'Entrar e voltar para esta tela'))));
}

/**
 * A sessão terminou durante o preenchimento (D11-09). Abre um diálogo de entrada na própria página; o que foi digitado
 * continua no formulário (memória da página). Devolve true se a pessoa entrou de novo. Nunca reenvia sozinho.
 */
export async function reentrar() {
  let erro = null;
  for (;;) {
    const descricao = [
      'Sua sessão terminou. Entre de novo aqui mesmo: o que você digitou continua nesta página.',
      'Se você recarregar ou sair desta página, o que digitou será perdido, porque não guardamos rascunhos no aparelho.',
    ];
    if (erro) descricao.push(el('p', { class: 'campo__erro', role: 'alert' }, erro));
    const r = await dialogoFormulario({
      id: 'reentrar', titulo: 'Entrar de novo', descricao, rotuloConfirmar: 'Entrar', rotuloCancelar: 'Agora não',
      campos: [campoTexto({ nome: 'email', rotulo: 'E-mail', tipo: 'email', autocomplete: 'username', id: 'reentrar-email' }),
        campoTexto({ nome: 'senha', rotulo: 'Senha', tipo: 'password', autocomplete: 'current-password', id: 'reentrar-senha' })],
      validar: (form) => {
        const v = valores(form);
        if (!v.email?.trim()) return erroNoCampo(form, 'email', 'Informe o e-mail.') && null;
        if (!v.senha) return erroNoCampo(form, 'senha', 'Informe a senha.') && null;
        return v;
      },
    });
    if (!r) return false;
    try {
      await neon.entrar({ email: r.email.trim(), senha: r.senha });
      return true;
    } catch (e) {
      erro = e.message;
    }
  }
}

/** Texto curto para quando a sessão termina e a pessoa prefere não entrar agora. */
export const avisoSessaoEncerrada = () => aviso('alerta', 'Sua sessão terminou e nada foi enviado.',
  el('p', {}, 'O que você digitou continua nesta página. Entre de novo para enviar; se recarregar ou sair, será preciso digitar outra vez.'));

/**
 * Aviso de suspensão da vitrine. `pendente`: o que ainda não foi aceito fica congelado e a pessoa pode desistir sem custo;
 * `aceito`: o que já foi aceito continua. Na grave, o aviso adicional; nunca o motivo interno.
 */
export function avisoSuspensao(suspensao, situacao) {
  if (!suspensao) return null;
  const linhas = [];
  if (suspensao === 'grave') linhas.push('A plataforma suspendeu esta empresa por um motivo grave. Fique atento antes de combinar pagamentos ou entregas.');
  linhas.push(situacao === 'pendente'
    ? 'Enquanto durar a suspensão, não é possível fechar este acordo. Você pode desistir sem custo.'
    : 'O que já foi aceito continua registrado, com as opções de cancelamento e contestação deste atendimento.');
  return el('div', { 'data-suspensao': suspensao }, aviso('alerta', 'A vitrine desta empresa está suspensa.', ...linhas.map((t) => el('p', {}, t))));
}
