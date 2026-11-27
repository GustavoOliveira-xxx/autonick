/**
 * Entradas separadas de Cliente e Business (ADR-001 = B; RF-001 a RF-005, RF-009).
 * O tipo de conta vem de <body data-tipo-conta>. Não há alternância automática:
 * se a identidade ainda não tem o perfil desta entrada, a pessoa decide criá-lo.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso } from '../../ui/estados.js';
import { neon } from '../../data/sessao.js';
import { destinoSeguro } from '../../domain/retorno.js';
import { liberarFormulario, manterIndisponivel } from '../../ui/formulario-protegido.js';
import { demonstracaoAtiva, montarEntradaDemonstracao } from '../../ui/demonstracao.js';

iniciarLayout();

const tipo = document.body.dataset.tipoConta;
const ROTULO = { cliente: 'Cliente', business: 'Business' };
const destinoConta = destinoSeguro(new URLSearchParams(location.search).get('volta'), tipo)
  // M11 (D11-04): o Cliente sem destino de retorno vai para a busca, com "Precisa da sua ação".
  // Pacote 27/11 (item 7): Business vai direto ao trabalho; Minhas empresas abre a empresa ativa ou a única, sem escolher duas vezes.
  ?? (tipo === 'business' ? '/business/minhas-empresas.html?entrada=1' : '/cliente/');
const avisos = document.getElementById('avisos');

// Demonstração (API Java, dados fictícios): entrada rápida como uma pessoa fictícia, acima dos formulários.
if (demonstracaoAtiva()) {
  const blocoDemo = el('div', { id: 'entrada-demonstracao' });
  avisos.after(blocoDemo);
  montarEntradaDemonstracao(blocoDemo, { tipo, destino: destinoConta });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGRAS = {
  nome: (v) => (v.trim().length >= 2 ? null : 'Informe seu nome.'),
  email: (v) => (EMAIL.test(v.trim()) ? null : 'Informe um e-mail válido, por exemplo nome@exemplo.com.'),
  senha: (v) => (v.length >= 8 ? null : 'A senha precisa ter pelo menos 8 caracteres.'),
  'senha-atual': (v) => (v ? null : 'Informe sua senha.'),
};

function mostrarAviso(tipoAviso, texto, ...extra) {
  avisos.replaceChildren(el('div', { role: tipoAviso === 'erro' ? 'alert' : 'status' }, aviso(tipoAviso, texto, ...extra)));
  avisos.querySelector('[role]')?.scrollIntoView({ block: 'nearest' });
}

function validar(form) {
  let primeiro = null;
  for (const campo of form.querySelectorAll('input[data-regra]')) {
    const mensagem = REGRAS[campo.dataset.regra]?.(campo.value) ?? null;
    campo.setAttribute('aria-invalid', mensagem ? 'true' : 'false');
    document.getElementById(`${campo.id}-erro`).textContent = mensagem ?? '';
    if (mensagem && !primeiro) primeiro = campo;
  }
  primeiro?.focus();
  return !primeiro;
}

async function executar(botao, acao) {
  botao.disabled = true;
  botao.setAttribute('aria-busy', 'true');
  try {
    await acao();
  } catch (erro) {
    mostrarAviso('erro', erro.message ?? 'Algo deu errado. Tente novamente.');
  } finally {
    botao.disabled = false;
    botao.removeAttribute('aria-busy');
  }
}

/** Após entrar: abre a conta se o perfil existe; senão oferece criá-lo. */
async function seguirComPerfil(nomeSugerido) {
  const perfis = await neon.meusPerfis();
  if (perfis.some((p) => p.tipo_conta === tipo)) {
    location.assign(destinoConta);
    return;
  }
  const criar = el('button', { type: 'button', class: 'botao' }, `Criar perfil ${ROTULO[tipo]}`);
  criar.addEventListener('click', () => executar(criar, async () => {
    await neon.garantirPerfil(tipo, nomeSugerido);
    location.assign(destinoConta);
  }));
  mostrarAviso('info', `Esta conta ainda não tem perfil ${ROTULO[tipo]}.`,
    el('p', {}, 'Os perfis Cliente e Business são separados. Você pode criar este perfil agora; nada muda no outro perfil.'),
    criar);
}

if (!neon.configurado) {
  mostrarAviso('info', 'O acesso não está configurado nesta cópia do app.',
    el('p', {}, 'Nada do que for digitado aqui será enviado.'),
    el('p', {}, el('a', { class: 'botao botao--secundario', href: '/' }, 'Voltar para a página inicial')));
}

for (const campo of document.querySelectorAll('input[data-mostrar-senha]')) {
  campo.addEventListener('change', () => {
    document.getElementById(campo.dataset.mostrarSenha).type = campo.checked ? 'text' : 'password';
  });
}

/**
 * Confirmação de e-mail por código (verificação exigida; decisão A de 01/11/2026).
 * O código é numérico, enviado pelo Neon Auth e válido por poucos minutos.
 */
function pedirCodigo(email, { nome = null, criarPerfil = false, enviado = true } = {}) {
  const campo = el('input', { id: 'codigo-verificacao', name: 'codigo', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', 'aria-describedby': 'codigo-verificacao-erro' });
  const erro = el('span', { id: 'codigo-verificacao-erro', class: 'campo__erro' });
  const confirmar = el('button', { type: 'submit', class: 'botao' }, 'Confirmar e-mail');
  const reenviar = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Enviar novo código');
  // Erros deste passo ficam ao lado do campo, sem apagar o formulário.
  const noFormulario = async (botao, acao) => {
    botao.disabled = true;
    try {
      await acao();
    } catch (falha) {
      erro.textContent = falha.message ?? 'Algo deu errado. Tente novamente.';
      campo.setAttribute('aria-invalid', 'true');
      campo.focus();
    } finally {
      botao.disabled = false;
    }
  };
  const form = el('form', { id: 'form-codigo', class: 'pilha', novalidate: true },
    el('div', { class: 'campo' }, el('label', { for: 'codigo-verificacao' }, 'Código de verificação'), campo, erro),
    el('div', { class: 'grupo-botoes' }, confirmar, reenviar));
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const codigo = campo.value.replace(/\s/g, '');
    if (!/^\d{4,8}$/.test(codigo)) {
      erro.textContent = 'Digite o código numérico recebido por e-mail.';
      campo.setAttribute('aria-invalid', 'true');
      campo.focus();
      return;
    }
    erro.textContent = '';
    campo.setAttribute('aria-invalid', 'false');
    noFormulario(confirmar, async () => {
      await neon.verificarEmail({ email, codigo });
      const sessao = await neon.sessao();
      if (!sessao) {
        mostrarAviso('sucesso', 'E-mail confirmado. Agora entre com seu e-mail e senha.');
        return;
      }
      if (criarPerfil) {
        // Cadastro feito nesta entrada: o perfil desta área é o pedido explícito da pessoa.
        await neon.garantirPerfil(tipo, nome ?? sessao.usuario.nome);
        location.assign(destinoConta);
        return;
      }
      await seguirComPerfil(sessao.usuario.nome ?? 'Sem nome');
    });
  });
  reenviar.addEventListener('click', () => noFormulario(reenviar, async () => {
    await neon.enviarCodigoDeVerificacao(email);
    erro.textContent = '';
    form.querySelector('[role="status"]')?.remove();
    form.append(el('p', { role: 'status' }, 'Se o e-mail estiver cadastrado, um novo código foi enviado.'));
  }));
  const instrucao = enviado
    ? `Enviamos um código para ${email}. Ele vale por poucos minutos.`
    : 'Não conseguimos enviar o código agora. Aguarde um pouco e use "Enviar novo código".';
  mostrarAviso('alerta', 'Confirme seu e-mail para continuar.', el('p', {}, instrucao), form);
  campo.focus();
}

/**
 * No login, o Neon Auth recusa conta não confirmada (403) mas NÃO envia código
 * (observado em 01/11/2026, defeito D-06). O código é pedido aqui, antes de avisar.
 */
async function enviarEPedirCodigo(email) {
  let enviado = true;
  try {
    await neon.enviarCodigoDeVerificacao(email);
  } catch {
    enviado = false;
  }
  pedirCodigo(email, { enviado });
}

/**
 * D-08 (01/11/2026, Neon real): entrar de novo, por exemplo pela outra área,
 * abre uma sessão nova e deixa a anterior válida no servidor por 7 dias, sem
 * cookie no navegador. Antes de entrar ou cadastrar, encerramos a sessão atual.
 */
async function encerrarSessaoAnterior() {
  try {
    await neon.sair();
  } catch {
    // Sem sessão ou sem rede: nada a encerrar; a entrada segue normalmente.
  }
}

const formEntrar = document.getElementById('form-entrar');
formEntrar.addEventListener('submit', (evento) => {
  evento.preventDefault();
  if (!validar(formEntrar)) return;
  const botao = formEntrar.querySelector('button[type="submit"]');
  const email = formEntrar.email.value.trim();
  executar(botao, async () => {
    await encerrarSessaoAnterior();
    try {
      await neon.entrar({ email, senha: formEntrar.senha.value });
    } catch (erro) {
      if (erro.codigo !== 'EMAIL_NAO_VERIFICADO') throw erro;
      await enviarEPedirCodigo(email);
      return;
    }
    const sessao = await neon.sessao();
    if (!sessao) {
      await enviarEPedirCodigo(email);
      return;
    }
    await seguirComPerfil(sessao.usuario.nome ?? 'Sem nome');
  });
});

const formCriar = document.getElementById('form-criar');
formCriar.addEventListener('submit', (evento) => {
  evento.preventDefault();
  if (!validar(formCriar)) return;
  const botao = formCriar.querySelector('button[type="submit"]');
  const nome = formCriar.nome.value.trim();
  const email = formCriar.email.value.trim();
  executar(botao, async () => {
    await encerrarSessaoAnterior();
    await neon.cadastrar({ nome, email, senha: formCriar.senha.value });
    const sessao = await neon.sessao();
    if (!sessao) {
      // Verificação exigida: sem sessão até confirmar. O próprio cadastro dispara
      // o envio do código (observado no Neon real em 01/11/2026); não reenviamos.
      pedirCodigo(email, { nome, criarPerfil: true });
      return;
    }
    await neon.garantirPerfil(tipo, nome);
    location.assign(destinoConta);
  });
});

/** Segunda etapa da recuperação: código recebido + nova senha (Managed Better Auth). */
function formularioNovaSenha(email) {
  const area = document.getElementById('redefinir-senha');
  const campo = (id, rotulo, tipo, extra = {}) => el('div', { class: 'campo' },
    el('label', { for: id }, rotulo),
    el('input', { id, name: id, type: tipo, 'aria-describedby': `${id}-erro`, ...extra }),
    el('span', { id: `${id}-erro`, class: 'campo__erro' }));
  const confirmar = el('button', { type: 'submit', class: 'botao' }, 'Criar nova senha');
  const form = el('form', { id: 'form-nova-senha', class: 'pilha', novalidate: true },
    el('p', {}, `Se ${email} estiver cadastrado, enviamos um código válido por poucos minutos.`),
    campo('nova-senha-codigo', 'Código recebido por e-mail', 'text', { inputmode: 'numeric', autocomplete: 'one-time-code' }),
    campo('nova-senha', 'Nova senha (mínimo de 8 caracteres)', 'password', { autocomplete: 'new-password' }),
    campo('nova-senha-confirmacao', 'Repita a nova senha', 'password', { autocomplete: 'new-password' }),
    el('div', { class: 'grupo-botoes' }, confirmar));
  const erroEm = (id, texto) => {
    const alvo = document.getElementById(id);
    document.getElementById(`${id}-erro`).textContent = texto;
    alvo.setAttribute('aria-invalid', 'true');
    alvo.focus();
  };
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    for (const id of ['nova-senha-codigo', 'nova-senha', 'nova-senha-confirmacao']) {
      document.getElementById(`${id}-erro`).textContent = '';
      document.getElementById(id).setAttribute('aria-invalid', 'false');
    }
    const codigo = form['nova-senha-codigo'].value.replace(/\s/g, '');
    const senha = form['nova-senha'].value;
    if (!/^\d{4,8}$/.test(codigo)) return erroEm('nova-senha-codigo', 'Digite o código numérico recebido por e-mail.');
    if (senha.length < 8 || senha.length > 128) return erroEm('nova-senha', 'A nova senha precisa ter de 8 a 128 caracteres.');
    if (senha !== form['nova-senha-confirmacao'].value) return erroEm('nova-senha-confirmacao', 'As duas senhas não são iguais.');
    confirmar.disabled = true;
    neon.redefinirSenhaComCodigo({ email, codigo, novaSenha: senha })
      .then(({ sessoesEncerradas }) => {
        area.replaceChildren();
        formSenha.reset();
        mostrarAviso('sucesso', 'Senha alterada. Entre com a nova senha.', el('p', {}, sessoesEncerradas
          ? 'Por segurança, encerramos a sua conta em outros navegadores e aparelhos.'
          : 'Não conseguimos encerrar agora a sua conta em outros aparelhos. Depois de entrar, use "Trocar senha" com a opção de encerrar as outras sessões.'));
        document.getElementById('entrar-email').value = email;
        document.getElementById('entrar-senha').focus();
      })
      .catch((erro) => erroEm(erro.codigo === 'SENHA_FRACA' ? 'nova-senha' : 'nova-senha-codigo', erro.message))
      .finally(() => { confirmar.disabled = false; });
  });
  area.replaceChildren(form);
  document.getElementById('nova-senha-codigo').focus();
}

const formSenha = document.getElementById('form-senha');
formSenha.addEventListener('submit', (evento) => {
  evento.preventDefault();
  if (!validar(formSenha)) return;
  const botao = formSenha.querySelector('button[type="submit"]');
  const email = formSenha.email.value.trim();
  executar(botao, async () => {
    await neon.pedirRedefinicaoDeSenha({ email });
    formularioNovaSenha(email);
  });
});

// S-01: os três formulários nascem bloqueados no HTML. Só são liberados aqui, depois de todos os tratamentos de envio
// estarem instalados (cada um chama preventDefault) e com o acesso configurado para autenticar.
for (const form of [formEntrar, formSenha, formCriar]) {
  if (neon.configurado) liberarFormulario(form);
  else manterIndisponivel(form, 'Formulário indisponível: o acesso não está configurado nesta cópia do app. Nada é enviado.');
}
