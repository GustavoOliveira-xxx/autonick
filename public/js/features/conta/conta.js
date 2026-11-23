/**
 * Página da conta (RF-005, RF-006, RF-007 parcial, RF-008 informativo).
 * Exige sessão e o perfil desta entrada; sem eles, orienta a entrar.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { mostrarCarregando, concluirCarregamento, aviso, tratarErro } from '../../ui/estados.js';
import { neon } from '../../data/sessao.js';
import { formatarData } from '../../domain/tempo.js';
import { minhasDenuncias, CATEGORIAS_DENUNCIA } from '../../data/comunicacao.js';
import { secaoInstalacao } from '../../ui/instalacao.js';

iniciarLayout();

const tipo = document.body.dataset.tipoConta;
const entrada = tipo === 'business' ? '/business/entrar.html' : '/cliente/entrar.html';
const area = document.getElementById('conta');

async function carregar() {
  if (!neon.configurado) {
    area.replaceChildren(aviso('info', 'O acesso com e-mail e senha ainda não está disponível nesta versão.',
      el('p', {}, el('a', { href: entrada }, 'Ir para a entrada'))));
    return;
  }
  mostrarCarregando(area, 'Carregando sua conta');
  try {
    const sessao = await neon.sessao();
    if (!sessao) {
      location.replace(entrada);
      return;
    }
    const perfil = (await neon.meusPerfis()).find((p) => p.tipo_conta === tipo);
    concluirCarregamento(area);
    if (!perfil) {
      area.append(aviso('alerta', 'Esta conta ainda não tem o perfil desta área.', el('p', {}, el('a', { href: entrada }, 'Voltar para a entrada'))));
      return;
    }
    const sair = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Sair');
    sair.addEventListener('click', async () => {
      sair.disabled = true;
      try {
        await neon.sair();
      } finally {
        location.assign(entrada);
      }
    });
    const blocos = [
      el('dl', { class: 'dados' },
        el('dt', {}, 'Nome no perfil'), el('dd', {}, perfil.nome),
        el('dt', {}, 'E-mail'), el('dd', {}, sessao.usuario.email),
        el('dt', {}, 'Tipo de perfil'), el('dd', {}, tipo === 'business' ? 'Business' : 'Cliente'),
        el('dt', {}, 'Criado em'), el('dd', {}, formatarData(perfil.criado_em)),
      ),
      sessao.usuario.emailVerificado ? null : aviso('alerta', 'Seu e-mail ainda não foi confirmado.'),
      el('div', { class: 'grupo-botoes' }, sair),
      aviso('info', 'Ao sair, você sai de todas as áreas do AutoniCK neste navegador.',
        el('p', {}, 'Para pedir a exclusão da conta, use a Ajuda. Alguns registros, como vendas e ordens de serviço, precisam ser guardados mesmo depois da exclusão; explicamos tudo antes de concluir.')),
    ];
    area.append(...blocos.filter(Boolean), secaoTrocarSenha(), secaoDenuncias(), secaoInstalacao({ id: 'instalacao-conta' }));
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      location.replace(entrada);
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

const ALVO = { empresa: 'Empresa', avaliacao: 'Avaliação', resposta: 'Resposta da empresa', mensagem: 'Mensagem', mensagem_m08: 'Mensagem', atualizacao_os: 'Atualização de OS' };
const ESTADO_DENUNCIA = { aberta: 'Recebida', em_analise: 'Em análise', resolvida: 'Analisada' };

/** M12 (D12-22): denúncias feitas por esta conta, com estado e resultado genérico. Quem foi denunciado não sabe quem denunciou. */
function secaoDenuncias() {
  const corpo = el('div', { class: 'pilha' }, el('p', { class: 'campo__ajuda' }, 'Carregando…'));
  minhasDenuncias().then((lista) => corpo.replaceChildren(lista.length
    ? el('ul', { class: 'pilha', id: 'minhas-denuncias' }, ...lista.map((d) => el('li', { class: 'cartao pilha', 'data-protocolo': d.protocolo },
      el('p', {}, el('strong', {}, `Protocolo nº ${d.protocolo}`), ` · ${ALVO[d.alvo_tipo] ?? d.alvo_tipo} · ${CATEGORIAS_DENUNCIA[d.categoria] ?? d.categoria}`),
      el('p', {}, `${ESTADO_DENUNCIA[d.estado] ?? d.estado} · enviada em ${formatarData(d.criado_em)}`),
      d.resultado ? el('p', { class: 'campo__ajuda' }, d.resultado) : null)))
    : el('p', { id: 'minhas-denuncias' }, 'Você não fez denúncias.')))
    .catch((erro) => corpo.replaceChildren(el('p', { class: 'campo__ajuda' }, `Não foi possível carregar as denúncias (${erro.message}).`)));
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-denuncias' }, el('h2', { id: 'titulo-denuncias' }, 'Minhas denúncias'),
    el('p', { class: 'campo__ajuda' }, 'A equipe da CK analisa cada denúncia e decide com justificativa.'), corpo);
}

/** Troca de senha com a sessão aberta (Managed Better Auth /change-password). */
function secaoTrocarSenha() {
  const campo = (id, rotulo, autocomplete) => el('div', { class: 'campo' },
    el('label', { for: id }, rotulo),
    el('input', { id, name: id, type: 'password', autocomplete, 'aria-describedby': `${id}-erro` }),
    el('span', { id: `${id}-erro`, class: 'campo__erro' }));
  const enviar = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Trocar senha');
  const status = el('div', { id: 'trocar-senha-status' });
  const form = el('form', { id: 'form-trocar-senha', class: 'pilha', novalidate: true },
    campo('senha-atual', 'Senha atual', 'current-password'),
    campo('senha-nova', 'Nova senha (mínimo de 8 caracteres)', 'new-password'),
    campo('senha-nova-confirmacao', 'Repita a nova senha', 'new-password'),
    el('div', { class: 'opcao' },
      el('input', { id: 'encerrar-outras', name: 'encerrar-outras', type: 'checkbox', checked: true }),
      el('label', { for: 'encerrar-outras' }, 'Encerrar a conta em outros navegadores e aparelhos (recomendado)')),
    el('div', { class: 'grupo-botoes' }, enviar), status);
  const erroEm = (id, texto) => {
    document.getElementById(`${id}-erro`).textContent = texto;
    document.getElementById(id).setAttribute('aria-invalid', 'true');
    document.getElementById(id).focus();
  };
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    status.replaceChildren();
    for (const id of ['senha-atual', 'senha-nova', 'senha-nova-confirmacao']) {
      document.getElementById(`${id}-erro`).textContent = '';
      document.getElementById(id).setAttribute('aria-invalid', 'false');
    }
    const atual = form['senha-atual'].value;
    const nova = form['senha-nova'].value;
    if (!atual) return erroEm('senha-atual', 'Informe a senha atual.');
    if (nova.length < 8 || nova.length > 128) return erroEm('senha-nova', 'A nova senha precisa ter de 8 a 128 caracteres.');
    if (nova === atual) return erroEm('senha-nova', 'A nova senha precisa ser diferente da atual.');
    if (nova !== form['senha-nova-confirmacao'].value) return erroEm('senha-nova-confirmacao', 'As duas senhas não são iguais.');
    enviar.disabled = true;
    try {
      await neon.trocarSenha({ atual, nova, encerrarOutras: form['encerrar-outras'].checked });
      form.reset();
      form['encerrar-outras'].checked = true;
      status.replaceChildren(el('div', { role: 'status' }, aviso('sucesso', 'Senha alterada.',
        el('p', {}, 'Use a nova senha na próxima entrada. Se você não reconhece esta troca, use "Esqueci minha senha" na entrada.'))));
    } catch (erro) {
      if (erro.codigo === 'SENHA_ATUAL_INCORRETA') erroEm('senha-atual', erro.message);
      else if (erro.codigo === 'SENHA_FRACA') erroEm('senha-nova', erro.message);
      else status.replaceChildren(el('div', { role: 'alert' }, aviso('erro', erro.message)));
    } finally {
      enviar.disabled = false;
    }
  });
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-trocar-senha' },
    el('h2', { id: 'titulo-trocar-senha' }, 'Trocar senha'),
    el('p', { class: 'campo__ajuda' }, 'Nunca informe sua senha ou códigos de verificação a outra pessoa, nem à equipe da CK.'),
    form);
}

carregar();
