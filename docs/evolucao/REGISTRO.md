# Registro de execução · Evolução integrada do AutoniCK

Branch: `feature/evolucao-integrada-autonick` (criada a partir de `feature/ux-dinamismo-refino-geral`, que já contém a Forja Noturna).
Main não é alterada. Sem deploy, sem Neon/Vercel, orçamento R$ 0.

## Como rodar os testes nesta branch (PostgreSQL 18 real)

- Banco (node): `PG_BIN=<pasta bin do PostgreSQL 18> npm run test:db` (cada arquivo cria um cluster temporário).
- Java: `AUTONICK_JAVA_DB_URL=jdbc:postgresql://127.0.0.1:<porta>/postgres AUTONICK_JAVA_DB_USUARIO=postgres mvn -q test` em `java/os-api`.
- Os binários do PostgreSQL 18 podem ser os do próprio AutoniCK local (`binarios/` dentro de `AUTONICK_LOCAL_PASTA`).
- App completo: `AUTONICK_LOCAL_PASTA=<pasta isolada> AutoniCK-local.cmd` (ou `./autonick-local.sh`).

## Linha de base (antes de qualquer mudança desta etapa)

| Suíte | Resultado |
|---|---|
| Unitários (node) | 141/141 |
| Banco (node, PostgreSQL 18.6) | 242/242, 0 pulados |
| Java (os-api, PostgreSQL 18.6) | 127/127, 0 pulados (antes eram pulados sem Docker) |
| Playwright | 344/344 (última execução da branch da Forja) |
| CI pública | últimas execuções com sucesso |

## Andamento

O andamento por requisito fica em `MATRIZ.md`. Abaixo, o diário por marco.

### E01 · Auditoria e base
- Infraestrutura de testes com PostgreSQL 18.6 real (banco node e Java sem testes pulados). Linha de base registrada acima.

### E02 · UX global
- Tema claro revisado (aplicado antes da pintura por `js/tema-inicial.js`), leitura ampliada, clique Forja (pressão, lampejo e onda),
  fio de navegação e entrada de página com View Transitions quando o navegador suporta, abas locais segmentadas,
  símbolo oficial capacete-sino em todas as páginas (favicon e marca do menu).

### E03 · Empresas, arquivos e logos
- Armazenamento de arquivos: bytes no disco da API Java (`autonick.arquivos.pasta`; no AutoniCK local, `<AUTONICK_LOCAL_PASTA>/arquivos`),
  metadados no PostgreSQL (`public.arquivos`). Conteúdo conferido pelos primeiros bytes; PNG/JPEG regravados (sem metadados, reduzidos a 2048 px);
  SVG/HTML recusados; PDF ativo recusado. Download com `nosniff`, CSP `sandbox` e mesma resposta para inexistente e proibido.
- Central de empresas (cartões, busca, favoritas), cadastro em modal com 5 blocos e logo, troca rápida pelo menu (favoritas, recentes, todas).
  O endereço antigo `/business/onboarding.html` redireciona para o modal.
- Logo: vale na hora no ERP; na vitrine só depois da aprovação da CK. A CK vê a logo enviada na fila; a logo em análise e a publicada não podem ser removidas.
- Imagem de produto: no detalhe (enviar, trocar, remover) e miniatura na lista; na vitrine só para produto exibido de empresa publicada.
- Migration `202611250003`: corrige privilégios das funções de 0001/0002 (o `ALTER DEFAULT PRIVILEGES` por schema não retira o EXECUTE de PUBLIC),
  torna a troca de logo uma alteração relevante (antes o envio para análise era recusado) e acrescenta as leituras públicas de imagens.
  O anônimo passa a ter 5 funções, todas leituras da vitrine (3 do M10 e 2 do E03); testes antigos que fixavam 3 foram atualizados.
- Validação manual automatizada no app real (porta 8080, base isolada): logo enviada, alteração enviada para análise, aprovada pela CK
  e exibida no perfil da vitrine de demonstração; imagem de produto na lista; favorita no seletor.
- Testes novos: `tests/db/arquivos-logos*.test.mjs` (8 + rollback), `ConteudoArquivoTest` e `ArquivosApiTest` (Java).

### E04 · Equipe e agenda
- Equipe em abas (Pessoas, Perfis de acesso, Histórico; a aba fica no endereço). "Adicionar colaborador" abre um modal com e-mail,
  perfil e resumo do que a pessoa poderá fazer; protege contra perda do que foi digitado.
- Perfis por níveis em cada área, sobre o catálogo real: Sem acesso, Consultar (permissões de ver), Operar (todas as não sensíveis),
  Personalizar (uma a uma). Sensíveis só marcando uma a uma. Delegação continua conferida pelo banco.
- Agenda em abas: Calendário (Dia e Semana com grade de horas e horário de atendimento ao fundo, Mês com 6 semanas, Lista),
  Horários de atendimento (grade semanal com 2 turnos e cópia de segunda para os dias úteis) e Feriados e exceções.
- Migration `202611260001_agenda_excecoes`: exceções por data (fechado ou horário especial), consideradas nos avisos de conflito
  ao marcar horário (dia fechado avisa com o motivo; horário especial substitui a grade naquele dia). Testes em `tests/db/agenda-excecoes.test.mjs`.
- Migration `202611260002_compromissos_agenda`: compromissos internos (visita, reunião) e bloqueios de horário, com responsável opcional.
  Conflito (sobreposição, bloqueio, fora do horário, dia fechado) volta como aviso e nada é gravado; "Salvar mesmo assim" grava com
  outra chave de operação e guarda os avisos aceitos. Os avisos ao marcar horário de solicitação ou OS passam a considerar os compromissos.
- Não implementado (registrado na matriz): agenda individual por funcionário com bloqueio automático.
