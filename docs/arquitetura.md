# Arquitetura do AutoniCK

Este documento complementa o README com o funcionamento interno: como um pedido atravessa as camadas, onde ficam as regras, como o banco está organizado e como os testes cobrem cada parte.

## Visão geral

```
PWA (navegador)  ──►  API Java (Spring Boot)  ──►  PostgreSQL 18
 telas e formulários    autenticação, catálogo,     regras de negócio (PL/pgSQL),
 sem regra de negócio   transação e identidade      RLS, auditoria e integridade
```

As três camadas têm responsabilidades separadas:

| Camada | Responsável por | Não é responsável por |
| --- | --- | --- |
| PWA | Exibir dados, validar formulários para orientar a pessoa, enviar operações com chave de idempotência, mostrar erros | Preços, permissões, saldos ou qualquer decisão final |
| API Java | Validar tokens, decidir o que pode ser chamado, abrir a transação, aplicar a identidade, limitar uso, traduzir erros | Regras de negócio de cada módulo |
| PostgreSQL | Regras de negócio, permissões por empresa, RLS, versão, idempotência, estoque, financeiro e auditoria | Autenticação da pessoa (recebe a identidade já validada) |

## Caminho de um pedido

Exemplo: o gestor registra uma venda de balcão.

1. A tela chama `registrar_venda_direta` pela camada de dados da PWA (`public/js/data/vendas.js`), com uma chave de operação gerada no navegador.
2. O cliente HTTP (`public/js/data/neon-cliente.js`) envia `POST /api/dados/rpc/registrar_venda_direta` com o token de acesso no cabeçalho `Authorization`.
3. O Spring Security valida o token (`TokensDemonstracao` no modo demonstração, `ValidadorTokenNeonAuth` com o provedor real) e marca a requisição como de pessoa ou de visitante anônimo.
4. `DadosController` aplica o limite de uso e entrega o pedido ao `ExecutorDados`, que:
   - confere se a função está no catálogo (`Dominio`) e se o papel pode chamá-la;
   - lê a assinatura da função no catálogo do PostgreSQL (`CatalogoFuncoes`) e recusa parâmetros desconhecidos ou obrigatórios ausentes;
   - abre a transação, aplica `SET LOCAL ROLE authenticated` e a identidade do token, e chama a função com os valores vinculados por parâmetro.
5. A função SQL confere as permissões de vendas da pessoa naquela empresa, valida itens e estoque, cria a venda, baixa o estoque, registra o recebimento e grava a trilha de auditoria. Se a mesma chave de operação chegar de novo, devolve o resultado já gravado.
6. Se a função recusar (por exemplo, estoque insuficiente), o código vai no `HINT` do erro do PostgreSQL. A API transforma em HTTP 409 com `{"hint": "INSUFFICIENT_STOCK", "message": "..."}`, e a tela mostra a mensagem.

As ordens de serviço têm, além disso, rotas REST próprias (`/api/business/ordens-servico/...` e `/api/cliente/ordens-servico/...`). Antes de cada escrita, a API confere na mesma transação se a pessoa ainda pode alterar aquela OS, para que a repetição de um pedido antigo não devolva dados a quem perdeu o acesso.

## Módulos Java

### `java/os-api` (API)

| Pacote | Conteúdo |
| --- | --- |
| `plataforma` | `Dominio` (catálogo por domínio), `CatalogoFuncoes`, `ExecutorDados`, `ConsultaTabelas`, `DadosController`, `LimiteUso`, `PoliticaDados`, `IsolamentoVisitante`, `Identidade`, `ErroDados` |
| `dados` | Consultas e escritas das ordens de serviço, com as checagens feitas na mesma transação |
| `web` | Controllers REST das ordens de serviço, configuração pública da PWA, entrega dos arquivos estáticos, verificação de saúde e tratamento de erros |
| `seguranca` | `SegurancaConfig` (regras de acesso por rota e cabeçalhos de segurança), validação de tokens do provedor real e leitura das chaves públicas (JWKS) |
| `demonstracao` | Tokens e contas fictícias, entrada por pessoa, montagem do cenário fictício e cenários por visitante |
| `config` | Propriedades tipadas e a trava que, por padrão, só aceita PostgreSQL local |

### `java/demo-pwa-local` (inicializador)

| Classe | Papel |
| --- | --- |
| `AutonickLocal` | Ponto de entrada da demonstração local: PostgreSQL, banco, configuração e API |
| `BancoPersistente` | PostgreSQL 18 portátil e persistente; aplica as migrations uma única vez, com registro |
| `ApiJavaLocal` | Sobe e encerra a API como processo filho |
| `InstalarBancoPublico` | Prepara o banco da demonstração pública (uso administrativo, com confirmação do responsável) |
| `DemoPwaLocal` e relacionadas | Demonstração anterior, restrita às ordens de serviço |

## Banco de dados

O schema é criado pelas 22 migrations de `db/migrations_propostas`, em ordem, cada uma com o arquivo `.down.sql` correspondente.

| Schema | Conteúdo |
| --- | --- |
| `public` | 69 tabelas do app, todas com RLS ativo, e as funções chamadas pela API |
| `app_private` | Funções internas (validação, idempotência, estoque, auditoria) e tabelas administrativas, sem acesso direto pelos papéis do app |
| `authz` | Funções de autorização (membro da empresa, permissões, administração CK) |
| `auth`, `neon_auth` | Identidade da pessoa (`auth.uid()`) e tabela de usuários; localmente vêm de `db/tests/emulacao-neon.sql` |
| `demo_auth` | Só na demonstração: contas fictícias, cenários de visitantes e operações da montagem |

Grupos de tabelas em `public`:

- **Identidade e empresas:** perfis, empresas, membros, convites, perfis de permissão, catálogo de permissões, horários.
- **Produtos e estoque:** produtos, variações, saldos, movimentações, reservas, propostas de movimentação, histórico de preços e custos, fornecedores e compras.
- **Vendas e pedidos:** clientes da empresa, vendas, pedidos e seus itens, eventos comerciais.
- **Financeiro:** contas, categorias, títulos e parcelas, pagamentos, recebimentos, lançamentos, transferências, recorrências e fechamentos.
- **Serviços:** serviços, perguntas e regras de preço, pacotes, solicitações, versões e componentes de orçamento, agendamentos.
- **Ordens de serviço:** ordens, eventos, materiais e usos, cancelamentos, reagendamentos e propostas de custo.
- **Vitrine, comunicação e moderação:** cartões públicos, solicitações de publicação, mensagens e leituras, avaliações, denúncias, contestações e moderação.

Padrões aplicados nas funções que gravam:

- **Idempotência:** cada escrita recebe uma chave de operação; repetir com os mesmos dados devolve o resultado gravado, e com dados diferentes é recusado (`IDEMPOTENCY_CONFLICT`).
- **Controle de versão:** alterações recebem a versão esperada; se o registro mudou, a operação é recusada (`VERSION_CONFLICT`).
- **Estoque:** saldo físico, reservado e disponível, com bloqueio de linha para impedir que duas operações usem a mesma última unidade.
- **Financeiro:** valores em centavos, parcelas e pagamentos parciais; nada é apagado (correções são estornos); meses fechados recusam lançamentos retroativos.

## Autenticação e autorização

```
[demonstração]  POST /api/auth/demo/entrar ──► cookie HttpOnly de sessão (8 h, só /api/auth)
                GET  /api/auth/get-session ──► token de acesso de 15 min (cabeçalho set-auth-jwt)
[dados]         Authorization: Bearer <token> ──► Spring Security ──► papel PESSOA ou ANONIMO
                                                  └──► identidade aplicada na transação ──► RLS e funções SQL
```

- Quem pode chamar o quê: as regras de `SegurancaConfig` (por rota) e o catálogo `Dominio` (por função).
- Quem pode ver e alterar cada dado: o PostgreSQL, por RLS, permissões por coluna e checagens nas funções, com base na identidade da transação.
- O painel CK é conferido na API e de novo na função SQL.
- Na demonstração pública, `IsolamentoVisitante` restringe cada visitante às empresas do próprio cenário e recusa contas sem cenário.

## Estratégia de testes

| Suíte | Onde | O que garante |
| --- | --- | --- |
| API Java (JUnit 5, Spring Boot Test) | `java/os-api/src/test` | A API de verdade, em porta aleatória, contra um PostgreSQL descartável: tokens, rotas de OS, rollback e atomicidade, conexões devolvidas limpas ao pool, camada de dados (estoque, idempotência, permissões, isolamento entre empresas, painel CK) e isolamento entre visitantes |
| Banco (`node:test`) | `tests/db` | Cada migration e as funções SQL num cluster PostgreSQL temporário por arquivo, inclusive rollback das migrations |
| Unitários (`node:test`) | `tests/unit` | Regras puras do frontend (moeda, tempo, estoque), cliente HTTP, seleção do backend, política de segurança estática e integridade da marca |
| Interface (Playwright e axe-core) | `tests/e2e` | Telas das três áreas com respostas simuladas, acessibilidade WCAG, responsividade, PWA (instalação, offline, atualização) e PDFs |

A integração contínua (`.github/workflows/ci.yml`) tem dois jobs: um para a API Java e outro para unitários, banco e interface.
