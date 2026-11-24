/*
 * Aplica as preferências de tema e leitura ANTES da primeira pintura (script clássico e síncrono no <head>),
 * para a página não piscar no tema errado. As mesmas chaves são lidas e gravadas por js/ui/layout.js.
 */
(function () {
  try {
    var raiz = document.documentElement;
    if (localStorage.getItem('autonick.preferencia.tema') === 'claro') raiz.setAttribute('data-tema', 'claro');
    if (localStorage.getItem('autonick.preferencia.leitura') === 'ampliada') raiz.setAttribute('data-leitura', 'ampliada');
  } catch (e) { /* sem armazenamento: fica o tema escuro padrão */ }
})();
