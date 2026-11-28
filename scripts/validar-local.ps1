# AutoniCK: validação rápida do AutoniCK local em execução (Windows PowerShell 5+ ou PowerShell 7).
# Uso: com o AutoniCK aberto, rode AutoniCK-validar.cmd (ou: powershell -ExecutionPolicy Bypass -File scripts\validar-local.ps1).
# Só lê: não cria nem altera dados. Porta: variável AUTONICK_LOCAL_PORTA (padrão 8080).
$ErrorActionPreference = 'Stop'
$porta = if ($env:AUTONICK_LOCAL_PORTA) { $env:AUTONICK_LOCAL_PORTA } else { '8080' }
$base = "http://127.0.0.1:$porta"
$falhas = 0
function Conferir($nome, $bloco) {
  try { $r = & $bloco; if ($r) { Write-Host "[ok]      $nome" } else { Write-Host "[FALHOU]  $nome"; $script:falhas++ } }
  catch { Write-Host "[FALHOU]  $nome  ($($_.Exception.Message))"; $script:falhas++ }
}
function Status($caminho) {
  try { return (Invoke-WebRequest -Uri "$base$caminho" -UseBasicParsing -TimeoutSec 15).StatusCode }
  catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } else { throw } }
}
Write-Host "Validando o AutoniCK em $base"
Conferir 'API e banco respondem (/api/saude)' { $s = Invoke-RestMethod -Uri "$base/api/saude" -TimeoutSec 15; $s.api -eq 'ok' -and $s.banco -eq 'ok' }
foreach ($p in '/', '/business/', '/business/entrar.html', '/business/minhas-empresas.html', '/business/atividades.html', '/business/agenda.html', '/business/compras.html', '/business/fornecedores.html', '/ck-admin/', '/cliente/') {
  Conferir "página $p abre" { (Status $p) -eq 200 }
}
foreach ($a in '/js/ui/paleta.js', '/js/ui/abas.js', '/js/ui/forja3d/mao.js', '/assets/brand/autonick-capacete-sino.svg') {
  Conferir "arquivo $a disponível" { (Status $a) -eq 200 }
}
Conferir 'arquivo inexistente responde 404 (sem expor erro interno)' { (Status '/api/arquivos/00000000-0000-4000-8000-000000000000') -eq 404 }
Conferir 'dados exigem sessão (/api/dados/rpc/minhas_empresas sem login)' { (Status '/api/dados/rpc/minhas_empresas') -in 401, 403, 405 }
Conferir 'busca de CEP exige sessão (/api/enderecos/cep sem login)' { (Status '/api/enderecos/cep/01001000') -in 401, 403 }
Conferir 'política de segurança (CSP) presente' { $h = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 15; [bool]$h.Headers['Content-Security-Policy'] }
Write-Host ''
if ($falhas -eq 0) { Write-Host 'Tudo certo.' } else { Write-Host "$falhas verificação(ões) falharam."; exit 1 }
