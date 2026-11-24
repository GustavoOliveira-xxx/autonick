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
| E04 | Compromisso avulso (sem solicitação/OS) e agenda por funcionário | Não iniciado | fora do escopo atual do banco; precisa de modelo novo |
| E05 | Busca global, Ctrl+K, favoritos de módulos, atividades, vendas, funil | Não iniciado | |
| E06 | Financeiro em abas, painel orientado a ação, metas | Não iniciado | |
| E07 | OS simplificada, checklists, "Sem responsável definido", documentos | Não iniciado | |
| E08 | Portal do cliente, notificações, onboarding | Não iniciado | |
| E09 | Fila CK Admin, parâmetros, feature flags, saúde, auditoria | Não iniciado | |
| E10 | Bong e luva na home, Animation Lab | Não iniciado | |
| E11 | Revisão de segurança (IDOR, XSS, CSRF, uploads, X-Forwarded-For) | Parcial | uploads revisados no E03 |
| E12 | Regressão completa, documentação, instruções Windows | Não iniciado | |
