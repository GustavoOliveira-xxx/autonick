/** Endereços antigos do M01 (M13b): levam à tela real equivalente, mantendo a empresa da URL quando houver. */
const { destino, comEmpresa } = document.body.dataset;
const id = new URLSearchParams(location.search).get('id');
if (comEmpresa !== 'sim') location.replace(destino);
else location.replace(id ? `${destino}?id=${encodeURIComponent(id)}` : '/business/minhas-empresas.html');
