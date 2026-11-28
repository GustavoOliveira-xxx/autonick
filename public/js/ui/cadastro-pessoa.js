/**
 * Bloco de cadastro de pessoa (cliente da empresa ou fornecedor): física ou jurídica, nome ou razão social, nome fantasia,
 * CPF/CNPJ opcional (CNPJ alfanumérico aceito), contato e endereço com "Buscar CEP".
 *
 * Regras da busca de CEP (pacote 27/11, item 5):
 * - busca quando o CEP fica completo (uma vez por CEP) ou pelo botão; nada a cada tecla;
 * - resposta antiga é descartada (AbortController + número da consulta);
 * - preenche logradouro, bairro, cidade e UF só onde a pessoa não digitou nada (ou onde o valor veio de uma busca anterior);
 * - número e complemento são sempre manuais; tudo continua editável; falha nunca apaga o que foi digitado.
 * O banco confere tudo de novo (tipo de pessoa, DV, CEP, UF, tamanhos).
 */
import { el } from './dom.js';
import { campoTexto, campoSelecao, erroNoCampo } from './formulario.js';
import { conferirDocumento, mascararDocumento, mascararCep, normalizarCep, cepValido, documentoParaLista } from '../domain/documentos.js';
import { buscarCep, cepDisponivel } from '../data/enderecos.js';
import { flagLigada } from '../data/flags.js';

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const CAMPOS_CEP = ['logradouro', 'bairro', 'cidade', 'uf'];

/**
 * @param {object} o
 * @param {string} o.prefixo  prefixo dos ids (evita colisão com outro formulário na mesma página)
 * @param {object} [o.atual]  registro existente (edição)
 * @param {string} [o.tipoPadrao] 'pf' ou 'pj' para novo cadastro
 * @param {boolean} [o.comContato] campo "Pessoa de contato" (fornecedores)
 * @param {(doc: string) => Promise<Array<{id,nome,ativo}>>} [o.verificarDocumento] aviso de documento já cadastrado
 * @param {(item) => void} [o.usarExistente] oferece "Usar este cadastro" no aviso
 */
export function blocoPessoa({ prefixo, atual = {}, tipoPadrao = 'pf', comContato = false, verificarDocumento = null, usarExistente = null }) {
  const id = (n) => `${prefixo}-${n}`;
  let tipo = atual.tipo_pessoa ?? tipoPadrao;

  const radio = (valor, rotulo) => el('label', { class: 'opcao', for: id(`tipo-${valor}`) },
    el('input', { type: 'radio', name: 'tipo_pessoa', id: id(`tipo-${valor}`), value: valor, checked: tipo === valor }), rotulo);
  const tipoGrupo = el('fieldset', { class: 'campo' }, el('legend', {}, 'Tipo de cadastro'),
    el('div', { class: 'opcoes' }, radio('pf', 'Pessoa física'), radio('pj', 'Pessoa jurídica (empresa)')));

  const nome = campoTexto({ nome: 'nome', rotulo: 'Nome', valor: atual.nome, obrigatorio: true, max: 120, id: id('nome'), autocomplete: 'off' });
  const fantasia = campoTexto({ nome: 'nome_fantasia', rotulo: 'Nome fantasia (opcional)', valor: atual.nome_fantasia, max: 120, id: id('fantasia') });
  const documento = campoTexto({ nome: 'documento', rotulo: 'CPF (opcional)', valor: atual.documento ? mascararDocumento(atual.documento, tipo) : '', id: id('documento'),
    ajuda: '' });
  const entradaDoc = documento.querySelector('input');
  const ajudaDoc = documento.querySelector('.campo__ajuda') ?? el('span', { class: 'campo__ajuda', id: id('documento-ajuda') });
  if (!documento.querySelector('.campo__ajuda')) { documento.insertBefore(ajudaDoc, entradaDoc); entradaDoc.setAttribute('aria-describedby', `${id('documento-ajuda')} ${id('documento')}-erro`); }
  const avisoDoc = el('div', { class: 'aviso-duplicado', id: id('documento-aviso'), 'aria-live': 'polite' });
  documento.append(avisoDoc);

  const telefone = campoTexto({ nome: 'telefone', rotulo: 'Telefone (opcional)', valor: atual.telefone, tipo: 'tel', id: id('telefone'), autocomplete: 'off', ajuda: 'Com DDD.' });
  const email = campoTexto({ nome: 'email', rotulo: 'E-mail (opcional)', valor: atual.email, tipo: 'email', id: id('email'), max: 254 });
  const contato = comContato ? campoTexto({ nome: 'contato_nome', rotulo: 'Pessoa de contato (opcional)', valor: atual.contato_nome, max: 80, id: id('contato') }) : null;

  // Endereço
  const cep = campoTexto({ nome: 'cep', rotulo: 'CEP', valor: atual.cep ? mascararCep(atual.cep) : '', id: id('cep'), ajuda: '8 dígitos. Preenche rua, bairro, cidade e UF; número e complemento você completa.' });
  const entradaCep = cep.querySelector('input');
  entradaCep.setAttribute('inputmode', 'numeric');
  entradaCep.setAttribute('maxlength', '9');
  const botaoCep = el('button', { type: 'button', class: 'botao botao--secundario', id: id('buscar-cep'), hidden: !cepDisponivel }, 'Buscar CEP');
  const estadoCep = el('p', { class: 'campo__ajuda estado-cep', id: id('cep-estado'), role: 'status', 'aria-live': 'polite' });
  const logradouro = campoTexto({ nome: 'logradouro', rotulo: 'Rua, avenida...', valor: atual.logradouro, max: 120, id: id('logradouro') });
  const numero = campoTexto({ nome: 'numero', rotulo: 'Número', valor: atual.numero, max: 20, id: id('numero') });
  const complemento = campoTexto({ nome: 'complemento', rotulo: 'Complemento', valor: atual.complemento, max: 60, id: id('complemento') });
  const bairro = campoTexto({ nome: 'bairro', rotulo: 'Bairro', valor: atual.bairro, max: 80, id: id('bairro') });
  const cidade = campoTexto({ nome: 'cidade', rotulo: 'Cidade', valor: atual.cidade, max: 80, id: id('cidade') });
  const uf = campoSelecao({ nome: 'uf', rotulo: 'UF', opcoes: UFS.map((u) => [u, u]), valor: atual.uf ?? '', vazio: '—', id: id('uf') });
  const temEndereco = ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf'].some((k) => atual[k]);
  const endereco = el('details', { class: 'cadastro-endereco', open: temEndereco },
    el('summary', {}, 'Endereço (opcional)'),
    el('div', { class: 'pilha' },
      el('div', { class: 'linha-cep' }, cep, botaoCep), estadoCep,
      el('div', { class: 'grade-endereco' }, logradouro, numero, complemento, bairro, cidade, uf)));
  const observacoes = campoTexto({ nome: 'observacoes', rotulo: 'Observações (opcional)', valor: atual.observacoes, linhas: 2, max: 500, id: id('observacoes') });

  const ajustarTipo = () => {
    nome.querySelector('label').firstChild.textContent = tipo === 'pj' ? 'Razão social' : 'Nome';
    fantasia.hidden = tipo !== 'pj';
    documento.querySelector('label').firstChild.textContent = tipo === 'pj' ? 'CNPJ (opcional)' : 'CPF (opcional)';
    ajudaDoc.textContent = tipo === 'pj'
      ? 'Aceita o CNPJ numérico e o novo alfanumérico (letras e números). Pontos, barra e hífen são opcionais.'
      : 'Só os números; a máscara aparece sozinha.';
    entradaDoc.setAttribute('inputmode', tipo === 'pj' ? 'text' : 'numeric');
    entradaDoc.setAttribute('autocapitalize', tipo === 'pj' ? 'characters' : 'off');
    entradaDoc.setAttribute('maxlength', tipo === 'pj' ? '18' : '14');
    if (entradaDoc.value) entradaDoc.value = mascararDocumento(entradaDoc.value, tipo);
  };
  for (const r of tipoGrupo.querySelectorAll('input')) r.addEventListener('change', () => { tipo = r.value; ajustarTipo(); avisoDoc.replaceChildren(); });
  entradaDoc.addEventListener('input', () => {
    const fim = entradaDoc.selectionStart === entradaDoc.value.length;
    entradaDoc.value = mascararDocumento(entradaDoc.value, tipo);
    if (fim) entradaDoc.setSelectionRange(entradaDoc.value.length, entradaDoc.value.length);
  });
  let ultimoDocVerificado = null;
  entradaDoc.addEventListener('blur', async () => {
    const r = conferirDocumento(entradaDoc.value, tipo);
    if (!r.ok || !r.valor || !verificarDocumento || r.valor === ultimoDocVerificado || r.valor === atual.documento) return;
    ultimoDocVerificado = r.valor;
    try {
      const achados = (await verificarDocumento(r.valor)) ?? [];
      if (!Array.isArray(achados) || !achados.length) { avisoDoc.replaceChildren(); return; }
      avisoDoc.replaceChildren(el('p', { class: 'aviso aviso--alerta aviso--compacto' },
        `Já existe cadastro com este ${tipo === 'pj' ? 'CNPJ' : 'CPF'} nesta empresa: `,
        ...achados.slice(0, 3).flatMap((a, i) => [i ? ', ' : '', el('strong', {}, a.nome), a.ativo ? '' : ' (desativado)']),
        '. Você pode continuar mesmo assim.'),
        usarExistente ? el('div', { class: 'grupo-botoes' }, ...achados.slice(0, 3).map((a) => {
          const b = el('button', { type: 'button', class: 'botao botao--secundario' }, `Usar ${a.nome}`);
          b.addEventListener('click', () => usarExistente(a));
          return b;
        })) : null);
    } catch { avisoDoc.replaceChildren(); }
  });

  // Busca de CEP
  const entrada = (campo) => campo.querySelector('input, select');
  const campos = { logradouro, bairro, cidade, uf };
  for (const k of CAMPOS_CEP) entrada(campos[k]).addEventListener('input', () => entrada(campos[k]).removeAttribute('data-do-cep'));
  let controle = null;
  let numeroConsulta = 0;
  let ultimoCep = normalizarCep(atual.cep);
  const consultar = async (forcar) => {
    const valor = normalizarCep(entradaCep.value);
    if (!cepValido(valor)) {
      if (forcar) estadoCep.textContent = 'Digite os 8 dígitos do CEP para buscar.';
      return;
    }
    if (!forcar && valor === ultimoCep) return;
    ultimoCep = valor;
    controle?.abort();
    controle = new AbortController();
    const minha = ++numeroConsulta;
    botaoCep.setAttribute('aria-busy', 'true');
    estadoCep.textContent = 'Buscando o CEP…';
    const r = await buscarCep(valor, controle.signal);
    if (minha !== numeroConsulta || normalizarCep(entradaCep.value) !== valor) return; // resposta antiga: descarta
    botaoCep.removeAttribute('aria-busy');
    if (!r.ok) {
      if (r.codigo !== 'CANCELADA') estadoCep.textContent = r.mensagem;
      return;
    }
    const mantidos = [];
    let preenchidos = 0;
    for (const k of CAMPOS_CEP) {
      const v = r.endereco[k];
      if (!v) continue;
      const alvo = entrada(campos[k]);
      if (alvo.value && !alvo.hasAttribute('data-do-cep') && alvo.value !== v) { mantidos.push(k); continue; }
      alvo.value = v;
      alvo.setAttribute('data-do-cep', '');
      preenchidos += 1;
    }
    estadoCep.textContent = preenchidos
      ? `Endereço do CEP ${mascararCep(valor)} preenchido. Complete o número${mantidos.length ? `. Mantivemos o que você já tinha digitado em: ${mantidos.join(', ')}` : ''}.`
      : (mantidos.length ? 'Mantivemos o endereço que você digitou.' : 'O CEP é válido, mas não traz rua nem bairro (CEP geral da cidade). Preencha à mão.');
    if (preenchidos) entrada(numero).focus();
  };
  // Flag "busca_cep" (E09): desligada pela CK (ex.: serviço fora do ar), o endereço é só manual.
  let buscaLigada = cepDisponivel;
  if (cepDisponivel) flagLigada('busca_cep').then((ok) => { buscaLigada = ok; botaoCep.hidden = !ok; }).catch(() => {});
  entradaCep.addEventListener('input', () => {
    entradaCep.value = mascararCep(entradaCep.value);
    if (buscaLigada && cepValido(normalizarCep(entradaCep.value))) consultar(false);
  });
  botaoCep.addEventListener('click', () => consultar(true));

  const elemento = el('div', { class: 'pilha cadastro-pessoa' }, tipoGrupo,
    el('div', { class: 'grade-filtros' }, nome, fantasia), documento,
    el('div', { class: 'grade-filtros' }, telefone, email, contato), endereco, observacoes);
  ajustarTipo();

  /** Lê e confere o bloco. Devolve os dados (strings vazias limpam o campo no banco) ou null com o erro no campo. */
  function ler(form) {
    const v = (n) => form.querySelector(`[name="${n}"]`)?.value?.trim() ?? '';
    const nomeV = v('nome');
    if (nomeV.length < 2) return erroNoCampo(form, 'nome', tipo === 'pj' ? 'Informe a razão social (pelo menos 2 letras).' : 'Informe o nome (pelo menos 2 letras).') && null;
    const doc = conferirDocumento(v('documento'), tipo);
    if (!doc.ok) return erroNoCampo(form, 'documento', doc.erro) && null;
    const cepV = normalizarCep(v('cep'));
    if (cepV && !cepValido(cepV)) {
      endereco.open = true;
      return erroNoCampo(form, 'cep', 'CEP inválido: use 8 dígitos (00000-000).') && null;
    }
    const tel = v('telefone').replace(/\D/g, '');
    if (tel && (tel.length < 10 || tel.length > 13)) return erroNoCampo(form, 'telefone', 'Informe o telefone com DDD.') && null;
    const mail = v('email');
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return erroNoCampo(form, 'email', 'Informe um e-mail válido.') && null;
    const dados = { tipo_pessoa: tipo, nome: nomeV, documento: doc.valor ?? '', telefone: tel, email: mail, cep: cepV ?? '',
      logradouro: v('logradouro'), numero: v('numero'), complemento: v('complemento'), bairro: v('bairro'), cidade: v('cidade'), uf: v('uf'),
      observacoes: v('observacoes') };
    if (tipo === 'pj') dados.nome_fantasia = v('nome_fantasia');
    if (comContato) dados.contato_nome = v('contato_nome');
    return dados;
  }

  return { elemento, ler };
}

/** Resumo de uma linha do endereço (só o que existe). */
export function enderecoEmLinha(r) {
  const rua = [r.logradouro, r.numero].filter(Boolean).join(', ');
  const local = [r.bairro, [r.cidade, r.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ');
  return [rua, r.complemento, local, r.cep ? `CEP ${mascararCep(r.cep)}` : null].filter(Boolean).join(' · ');
}

export { documentoParaLista };
