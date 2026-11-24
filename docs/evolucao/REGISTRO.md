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
