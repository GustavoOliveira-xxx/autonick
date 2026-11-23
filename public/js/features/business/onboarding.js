/**
 * UI-021: cadastro da empresa em etapas (RF-187, UC-003), ligado ao cadastro real (M13b).
 * Grava com `criar_empresa` (o mesmo do M03), com as 17 categorias oficiais. Campos mínimos conforme ADR-003 (A);
 * CNPJ não é exigido. Até o envio, os dados ficam só na memória desta página.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso } from '../../ui/estados.js';
import { ocupado } from '../../ui/formulario.js';
import { categorias, criarEmpresa, novaChave, MODALIDADES } from '../../data/empresas.js';
import { exigirSessao } from '../empresa/comum.js';
import { liberarFormulario } from '../../ui/formulario-protegido.js';

iniciarLayout();

const form = document.getElementById('form-onboarding');
const etapas = [...form.querySelectorAll('[data-etapa]')];
const indicadores = [...document.querySelectorAll('#etapas li')];
const resumoErros = document.getElementById('resumo-erros');
const revisao = document.getElementById('revisao');
const acesso = document.getElementById('acesso-onboarding');
const botaoVoltar = document.getElementById('voltar');
const botaoAvancar = document.getElementById('avancar');
let atual = 0;
let iniciado = false;
let lista = [];
let chave = novaChave();

const REGRAS = {
  nome: (v) => (v.trim().length >= 2 ? null : 'Informe o nome do negócio.'),
  modalidade: (v) => (v ? null : 'Escolha como o negócio atende.'),
  categoria: (v) => (v ? null : 'Escolha uma categoria.'),
  cidade: (v) => (v.trim() ? null : 'Informe a cidade.'),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : 'Informe um e-mail válido, por exemplo nome@exemplo.com.'),
};
const CAMPO_DO_BANCO = { nome_publico: 'nome', categoria_id: 'categoria', email_contato: 'email', cidade: 'cidade', bairro: 'bairro', modalidade: 'modalidade' };

function mostrarErros(erros) {
  resumoErros.replaceChildren();
  if (!erros.length) return;
  resumoErros.append(el('div', { class: 'aviso aviso--erro', role: 'alert' },
    el('span', { class: 'aviso__icone', 'aria-hidden': 'true' }, '✕'),
    el('div', { class: 'aviso__corpo' },
      el('p', {}, el('strong', {}, 'Erro: '), 'Corrija os campos abaixo para continuar.'),
      el('ul', {}, erros.map((e) => el('li', {}, el('a', { href: `#${e.campo.id}` }, e.mensagem)))))));
  erros[0].campo.focus();
}

function validarEtapa(indice) {
  const erros = [];
  for (const campo of etapas[indice].querySelectorAll('[name]')) {
    const regra = REGRAS[campo.name];
    const valor = campo.type === 'radio' ? form.elements[campo.name].value : campo.value;
    const mensagem = regra ? regra(valor) : null;
    const saida = document.getElementById(`erro-${campo.name}`);
    if (campo.type !== 'radio') campo.setAttribute('aria-invalid', mensagem ? 'true' : 'false');
    if (saida) saida.textContent = mensagem ?? '';
    if (mensagem && !erros.some((e) => e.nome === campo.name)) erros.push({ nome: campo.name, mensagem, campo });
  }
  mostrarErros(erros);
  return erros.length === 0;
}

const dadosDoFormulario = () => Object.fromEntries(new FormData(form));

function montarRevisao() {
  const d = dadosDoFormulario();
  revisao.replaceChildren(el('dl', { class: 'dados' },
    el('dt', {}, 'Nome'), el('dd', {}, d.nome),
    el('dt', {}, 'Atendimento'), el('dd', {}, MODALIDADES[d.modalidade] ?? ''),
    el('dt', {}, 'Categoria'), el('dd', {}, lista.find((c) => c.id === d.categoria)?.nome ?? ''),
    el('dt', {}, 'Região'), el('dd', {}, `${d.bairro ? `${d.bairro}, ` : ''}${d.cidade} (SP)`),
    el('dt', {}, 'E-mail de contato (privado)'), el('dd', {}, d.email)));
}

function mostrar(indice) {
  atual = indice;
  etapas.forEach((etapa, i) => { etapa.hidden = i !== indice; });
  indicadores.forEach((item, i) => {
    item.toggleAttribute('aria-current', false);
    if (i === indice) item.setAttribute('aria-current', 'step');
    item.classList.toggle('concluida', i < indice);
  });
  botaoVoltar.hidden = indice === 0;
  botaoAvancar.textContent = indice === etapas.length - 1 ? 'Cadastrar empresa' : 'Continuar';
  if (indice === etapas.length - 1) montarRevisao();
  if (iniciado) etapas[indice].querySelector('h2')?.focus();
  iniciado = true;
}

botaoVoltar.addEventListener('click', () => mostrar(atual - 1));
form.addEventListener('submit', (evento) => {
  evento.preventDefault();
  if (atual < etapas.length - 1) {
    if (validarEtapa(atual)) mostrar(atual + 1);
    return;
  }
  const d = dadosDoFormulario();
  const dados = { nome_publico: d.nome.trim(), modalidade: d.modalidade, categoria_id: d.categoria, cidade: d.cidade.trim(), uf: 'SP',
    email_contato: d.email.trim(), ...(d.bairro?.trim() ? { bairro: d.bairro.trim() } : {}) };
  ocupado(botaoAvancar, async () => {
    try {
      const criada = await criarEmpresa(dados, chave);
      location.assign(`/business/dashboard.html?id=${encodeURIComponent(criada.id)}&criada=1`);
    } catch (erro) {
      if (erro.codigo !== 'NETWORK_UNKNOWN') chave = novaChave();
      const nome = CAMPO_DO_BANCO[erro.campo];
      const campo = nome ? form.elements[nome] : null;
      if (erro.codigo === 'VALIDATION_ERROR' && campo) {
        const alvo = campo instanceof RadioNodeList ? campo[0] : campo;
        const indice = etapas.findIndex((et) => et.contains(alvo));
        if (indice >= 0) mostrar(indice);
        const saida = document.getElementById(`erro-${nome}`);
        if (saida) saida.textContent = erro.message;
        mostrarErros([{ nome, mensagem: erro.message, campo: alvo }]);
        return;
      }
      resumoErros.replaceChildren(el('div', { role: 'alert' }, aviso('erro', erro.message)));
    }
  });
});

async function iniciar() {
  mostrar(0);
  form.hidden = true;
  if (!(await exigirSessao(acesso))) return;
  try {
    lista = await categorias();
    for (const c of lista) form.categoria.append(el('option', { value: c.id }, c.nome));
    // S-01: o tratamento do envio já está instalado (acima); libera só com sessão e categorias prontas.
    liberarFormulario(form);
    form.hidden = false;
  } catch (erro) {
    acesso.replaceChildren(aviso('erro', erro.message));
  }
}
iniciar();
