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
| E04 | Agenda individual por funcionário com bloqueio automático | Não iniciado | conflitos geram aviso com confirmação, não bloqueio |
| E05 | Busca global no banco com permissão por área | Concluído e validado | busca-global.test, paleta no app real |
| E05 | Paleta Ctrl+K com áreas, ações rápidas, fixados e registros | Implementado aguardando validação manual | painel-m13b e2e (2) |
| E05 | Favoritos de áreas e ações ("Fixados" no menu) | Implementado aguardando validação manual | painel-m13b e2e |
| E05 | Ficha do cliente | Implementado aguardando validação manual | busca-global.test (ficha), vendas e2e (2) |
| E05 | Funil de orçamentos em colunas | Implementado aguardando validação manual | servicos e2e |
| E05 | Central de atividades | Implementado aguardando validação manual | busca-global.test (atividades), painel-m13b e2e |
| E05 | Vendas "consulta primeiro" | Não iniciado | |
| E05 | Modelos reutilizáveis | Parcial | modelos de checklist de OS (E07); outros modelos não |
| E06 | Financeiro: ações rápidas em modal a partir do painel | Implementado aguardando validação manual | financeiro e2e (21) |
| E06 | Metas mensais com realizado dos dados reais e comemoração só ao atingir | Concluído e validado | metas.test (4), painel-m13b e2e, app real |
| E06 | Painel orientado a ação | Parcial | já existia "Precisa da sua ação"; somadas metas e ações rápidas |
| E07 | "Sem responsável definido" (sem pessoa, desligado e sem nome diferenciados) | Concluído e validado | metas.test (E07), ordens e2e (2), app real |
| E07 | Checklist persistente com obrigatórios bloqueando a conclusão no banco | Concluído e validado | checklists-os.test (5), ordens e2e, app real |
| E07 | Detalhe da OS em abas e central de documentos da OS | Implementado aguardando validação manual | ordens e2e (15) |
| E07 | Lista de OS com próximas ações | Parcial | lista já mostra estado e responsável; "próxima ação" por OS não foi feita |
| E08 | Cliente vê as etapas do serviço marcadas como visíveis | Concluído e validado | checklists-os.test, app real |
| E08 | Portal do cliente renovado, descoberta, pedido guiado, notificações internas, onboarding | Não iniciado | o portal atual (M10 a M12) continua funcionando sem mudanças |
| E09 | Painel da CK em abas com filas | Implementado aguardando validação manual | painel-m13b e2e, app real |
| E09 | Central de parâmetros por categoria com restaurar padrão | Concluído e validado | ck-central.test, app real |
| E09 | Saúde da plataforma | Concluído e validado | ck-central.test, app real |
| E09 | Auditoria administrativa | Concluído e validado | ck-central.test, app real |
| E09 | Feature flags | Não iniciado | nenhuma funcionalidade as consumiria ainda |
| E10 | Bong e a luva na página inicial, complementando o Chamado da Forja | Implementado aguardando validação manual | bong-luva.test, apresentacao e2e, capturas |
| E10 | Nome oficial Bong na interface | Concluído e validado | index.html, heroi-sino.js |
| E10 | Animation Lab evoluído (intervalo, intensidade, exportação, estúdio) | Não iniciado | |
| E11 | X-Forwarded-For e X-Forwarded-Host só de proxy confiável | Concluído e validado | EnderecoClienteTest, DemonstracaoPublicaTest |
| E11 | Uploads seguros | Concluído e validado | ConteudoArquivoTest, ArquivosApiTest |
| E11 | IDOR (outra empresa) nas funções novas | Concluído e validado | testes de banco de cada migration (outra empresa e anônimo negados) |
| E11 | Revisão ampla de XSS, CSRF e sessões | Parcial | sem HTML vindo de dados (el() usa textContent); revisão completa não feita |
| E12 | Regressão completa (unitários, banco PostgreSQL 18, Java, Playwright) | Concluído e validado | ver REGISTRO.md, seção E12 |
| E12 | Instruções Windows, base isolada, backup e validação | Implementado aguardando validação manual | docs/evolucao/WINDOWS.md, AutoniCK-validar.cmd (conferido com curl; PowerShell não testado aqui) |
| E12 | Documentação de arquitetura, APIs e permissões atualizada | Parcial | registro por marco em REGISTRO.md; docs/arquitetura.md não foi reescrito |
