/**
 * S-01 (20/11/2026): formulários com credenciais ou dados privados nascem BLOQUEADOS no HTML.
 *
 * Marcação: <form method="post"> com todos os campos e o botão dentro de <fieldset data-protegido disabled>, mais um
 * aviso [data-aguardando] visível. Campos desativados não aceitam digitação, o botão desativado não envia por clique e o
 * formulário sem botão ativo não envia por Enter; mesmo se algo forçar o envio, campos desativados nunca entram nele.
 * Assim, com o script atrasado, com erro ou com o JavaScript desligado, nada vai para a URL nem para a página estática.
 *
 * O módulo da página chama `liberarFormulario` só DEPOIS de instalar o tratamento do envio (que sempre chama
 * preventDefault) e de confirmar que a página está pronta (por exemplo, acesso configurado).
 */
export function liberarFormulario(form) {
  const grupo = form.querySelector(':scope > fieldset[data-protegido]');
  if (!grupo) throw new Error(`O formulário ${form.id} não tem o grupo protegido.`);
  grupo.disabled = false;
  form.querySelector(':scope > [data-aguardando]')?.remove();
  form.dataset.pronto = 'sim';
}

/** Mantém o formulário bloqueado e troca o aviso por um motivo claro. */
export function manterIndisponivel(form, motivo) {
  const aviso = form.querySelector(':scope > [data-aguardando]');
  if (aviso) aviso.textContent = motivo;
  form.dataset.pronto = 'nao';
}
