# Matriz de requisitos · Evolução integrada

Situações: **Concluído e validado** · **Implementado aguardando validação manual** · **Parcial** · **Bloqueado** · **Não iniciado**.
"Validado" aqui significa testes automatizados verdes e conferência no app real (base isolada); a validação manual final é sua.

| Marco | Requisito | Situação | Evidência |
|---|---|---|---|
| E01 | Auditoria, testes em PostgreSQL 18 real, registro | Concluído e validado | REGISTRO.md, linha de base |
| E02 | Tema claro revisado e aplicado antes da pintura | Implementado aguardando validação manual | e2e, capturas |
| E02 | Clique Forja, fio de navegação, entrada de página | Implementado aguardando validação manual | navegacao-viva.js, e2e |
| E02 | Símbolo capacete-sino oficial em todas as páginas | Concluído e validado | 48 páginas, e2e |
| E03 | Armazenamento de arquivos (Java + metadados PG, segurança) | Concluído e validado | ArquivosApiTest, ConteudoArquivoTest, arquivos-logos.test |
| E03 | Central de empresas, cadastro em modal, troca rápida, favoritas | Implementado aguardando validação manual | empresas/teclado/painel-m13b e2e |
| E03 | Logo: ERP imediato, vitrine após aprovação, visível para a CK | Concluído e validado | arquivos-logos.test, fluxo real com CK |
| E03 | Imagem de produto (detalhe, lista, vitrine) | Implementado aguardando validação manual | arquivos-logos.test, captura da lista |
| E04 | Equipe em abas, "Adicionar colaborador" em modal, níveis por área | Implementado aguardando validação manual | equipe.spec (6), capturas |
| E04 | Agenda: calendário dia/semana/mês/lista, grade semanal, exceções por data | Implementado aguardando validação manual | agenda-excecoes.test, servicos/ordens e2e |
| E04 | Avisos de conflito considerando feriados e horários especiais | Concluído e validado | agenda-excecoes.test |
| E04 | Compromissos internos e bloqueios com proteção contra conflito | Concluído e validado | agenda-excecoes.test (compromissos), servicos e2e, fluxo real |
| E04 | Agenda individual por funcionário com bloqueio automático | Bloqueado (decisão conservadora) | conflito continua gerando aviso com confirmação (comportamento aprovado antes); bloquear automaticamente mudaria regra de negócio sem definição de exceções. Documentado em REGISTRO.md |
| E05 | Busca global no banco com permissão por área | Concluído e validado | busca-global.test, paleta no app real |
| E05 | Paleta Ctrl+K com áreas, ações rápidas, fixados e registros | Implementado aguardando validação manual | painel-m13b e2e (2) |
| E05 | Favoritos de áreas e ações ("Fixados" no menu) | Implementado aguardando validação manual | painel-m13b e2e |
| E05 | Ficha do cliente | Implementado aguardando validação manual | busca-global.test (ficha), vendas e2e (2) |
| E05 | Funil de orçamentos em colunas | Implementado aguardando validação manual | servicos e2e |
| E05 | Central de atividades | Implementado aguardando validação manual | busca-global.test (atividades), painel-m13b e2e |
| E05 | Vendas "consulta primeiro" | Implementado aguardando validação manual | lista com busca (número/cliente, sem acento, no banco), Nova venda ao lado, filtros compactos; produtividade-portal.test (busca), app real |
| E05 | Modelos reutilizáveis | Implementado aguardando validação manual | modelos de checklist de OS (E07) e de orçamento (usar e salvar como modelo); produtividade-portal.test (modelos) |
| E06 | Financeiro: ações rápidas em modal a partir do painel | Implementado aguardando validação manual | financeiro e2e (21) |
| E06 | Metas mensais com realizado dos dados reais e comemoração só ao atingir | Concluído e validado | metas.test (4), painel-m13b e2e, app real |
| E06 | Painel orientado a ação | Parcial | já existia "Precisa da sua ação"; somadas metas e ações rápidas |
| E07 | "Sem responsável definido" (sem pessoa, desligado e sem nome diferenciados) | Concluído e validado | metas.test (E07), ordens e2e (2), app real |
| E07 | Checklist persistente com obrigatórios bloqueando a conclusão no banco | Concluído e validado | checklists-os.test (5), ordens e2e, app real |
| E07 | Detalhe da OS em abas e central de documentos da OS | Implementado aguardando validação manual | ordens e2e (15) |
| E07 | Lista de OS com próximas ações | Implementado aguardando validação manual | proximaAcaoOs (estado real + permissões, sem inventar etapa), proxima-acao-os.test, app real |
| E08 | Cliente vê as etapas do serviço marcadas como visíveis | Concluído e validado | checklists-os.test, app real |
| E08 | Notificações internas persistentes (dedupe, leitura, links, preferências) | Concluído e validado | produtividade-portal.test (4), central no menu e no cabeçalho do cliente, app real |
| E08 | Onboarding contextual dispensável | Implementado aguardando validação manual | dicas em Vendas, Clientes, Estoque, Compras e Fornecedores; produtividade-portal.test (onboarding) |
| E08 | Solicitação guiada com anexos opcionais e acompanhamento | Implementado aguardando validação manual | anexos (foto/PDF) na solicitação para cliente e empresa pela API de arquivos; link "Acompanhar e anexar" após pedir |
| E08 | Portal do cliente renovado (descoberta, documentos e compromissos num só lugar) | Parcial | portal M10 a M12 mantido; somados notificações e anexos; uma página única de documentos e compromissos do cliente não foi feita |
| E09 | Painel da CK em abas com filas | Implementado aguardando validação manual | painel-m13b e2e, app real |
| E09 | Central de parâmetros por categoria com restaurar padrão | Concluído e validado | ck-central.test, app real |
| E09 | Saúde da plataforma | Concluído e validado | ck-central.test, app real |
| E09 | Auditoria administrativa | Concluído e validado | ck-central.test, app real |
| E09 | Feature flags | Concluído e validado | animacoes_decorativas (Bong/entradas), busca_cep, onboarding_contextual; CK com motivo e auditoria; produtividade-portal.test (flags) |
| E10 | Bong e a luva na página inicial, complementando o Chamado da Forja | Implementado aguardando validação manual | bong-luva.test, apresentacao e2e, capturas |
| E10 | Nome oficial Bong na interface | Concluído e validado | index.html, heroi-sino.js |
| E10 | Animation Lab evoluído (intervalo, intensidade, exportação, estúdio) | Implementado aguardando validação manual | palco A/B com intervalo, intensidade, enquadramento, PNG do quadro e JSON dos ajustes; conferido no lab real |
| E11 | X-Forwarded-For e X-Forwarded-Host só de proxy confiável | Concluído e validado | EnderecoClienteTest, DemonstracaoPublicaTest |
| E11 | Uploads seguros | Concluído e validado | ConteudoArquivoTest, ArquivosApiTest |
| E11 | IDOR (outra empresa) nas funções novas | Concluído e validado | testes de banco de cada migration (outra empresa e anônimo negados) |
| E11 | Revisão ampla de XSS, CSRF e sessões | Concluído e validado | nenhum innerHTML com dados (só ícone fixo no modal); dados por Bearer no cabeçalho (sem cookie, sem CSRF); cookie da demo só em /api/auth com SameSite e Origin; links de notificação restritos por CHECK no banco |
| E12 | Regressão completa (unitários, banco PostgreSQL 18, Java, Playwright) | Concluído e validado | ver REGISTRO.md, seção E12 |
| E12 | Instruções Windows, base isolada, backup e validação | Implementado aguardando validação manual | docs/evolucao/WINDOWS.md, AutoniCK-validar.cmd (conferido com curl; PowerShell não testado aqui) |
| E12 | Documentação de arquitetura, APIs e permissões atualizada | Concluído e validado | docs/arquitetura.md (pacotes Java, 36 migrations, documentos, CEP, parcelas, flags, notificações), WINDOWS.md |

## Pacote de 27/11

| Item | Requisito | Situação | Evidência |
|---|---|---|---|
| 1 | Vendas: condições à vista/parcelado, DDL, intervalo, mensal, prazos 30/60/90, prévia editável, total/diferença/saldo | Concluído e validado | parcelas.test (9, inclui R$ 120 30/60 e mensal, R$ 100 em 3, fim de mês, bissexto), cadastros-documentos.test (forma/prazo), app real |
| 1 | Entrada sem duplicar título; idempotência, estorno e devolução preservados | Concluído e validado | recebido abate a 1ª parcela (mesma função do banco), vendas.test e regressão |
| 1 | Cliente na venda por busca (servidor, sem acento, paginada, teclado), resumo real, Novo cliente em modal | Concluído e validado | cadastros-documentos.test (buscar_clientes), app real |
| 2 | Aba ativa legível nos dois temas; filtros sem sublinhado; botões de texto sem aparência de hiperlink | Implementado aguardando validação manual | regra única em forja.css; axe na regressão; capturas |
| 2 | Texto colado da logo; marca e controles do menu | Concluído e validado | captura da página da empresa |
| 3 | Estoque em tabela simples; ajuste como ação secundária com permissão e motivo; histórico com origem | Concluído e validado | app real (compra recebida uma vez, origem Compra/Venda) |
| 4 | Fornecedores e Compras separados; modal com PF/PJ, CNPJ e CEP; Nova compra com fornecedor e produto por busca | Concluído e validado | cadastros-documentos.test (fornecedores, observação de compra), app real, link antigo redireciona |
| 5 | CNPJ alfanumérico e CPF em JS, Java (CEP) e SQL; texto canônico; duplicidade só avisa | Concluído e validado | cadastros-documentos.test (8), documentos.test (4) |
| 5 | CEP pela API Java (BrasilAPI), timeouts, cache, coalescência, limite, falhas distintas | Concluído e validado (simulado) | ConsultaCepTest (10). Teste ao vivo bloqueado neste ambiente (rede); fazer no Windows |
| 6 | Página da empresa com cartões de ação; Sair da empresa separado e confirmado; links de navegação como botões | Concluído e validado | captura; 61 links trocados por aparência de botão mantendo `<a href>` |
| 7 | Sem "Cadastrar empresa" no menu; entrar abre empresa ativa ou única; Acessar/Gerenciar; Entrar e Sair coerentes; menu compacto | Concluído e validado | app real (login cai no painel), unit de menu |
| 8 | Perfis em lista; Novo perfil em 4 etapas; contagem real; o que muda e pessoas afetadas; sem escalada | Concluído e validado | app real; escalada já recusada pelo banco (equipe.test) |
| 9 | Consulta primeiro em Clientes, Fornecedores, Compras, Estoque, Vendas, Produtos, Serviços, Orçamentos, Contas e OS | Implementado aguardando validação manual | barra de consulta e cadastro sob demanda em modal |
