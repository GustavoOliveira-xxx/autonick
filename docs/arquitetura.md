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
| `plataforma` | `Dominio` (catálogo por domínio), `CatalogoFuncoes`, `ExecutorDados`, `ConsultaTabelas`, `DadosController`, `LimiteUso`, `PoliticaDados`, `IsolamentoVisitante`, `Identidade`, `ErroDados`, `EnderecoCliente` (X-Forwarded-For só de proxy confiável) |
| `arquivos` | `ArquivosController` (`POST /api/arquivos`, `GET /api/arquivos/{id}`), `ArmazenamentoArquivos` (pasta local fora do Git), `ConteudoArquivo` (confere o conteúdo real e regrava imagens) |
| `enderecos` | `ConsultaCep` e `EnderecosController` (`GET /api/enderecos/cep/{cep}`, BrasilAPI com host fixo, cache e limites) |
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

O schema é criado pelas 36 migrations de `db/migrations_propostas`, em ordem, cada uma com o arquivo `.down.sql` correspondente (as 12 de `202611250001` a `202611300001` são da evolução integrada; `202612010001` e `202612010002` são do pacote de 27/11). Migrations já aplicadas nunca são reescritas: correções entram numa migration nova.

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
- **Vendas e pedidos:** clientes da empresa (pessoa física ou jurídica, CPF/CNPJ e endereço opcionais), vendas, pedidos e seus itens, eventos comerciais.
- **Arquivos:** metadados de logos, imagens de produto, anexos de solicitação, evidências de OS e documentos (o conteúdo fica na pasta da API).
- **Produtividade:** favoritos, metas, compromissos e exceções da agenda, checklists de OS, notificações, preferências, onboarding dispensado, flags por empresa e modelos de orçamento.
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

## Documentos, endereço e CEP (pacote 27/11)

- **CPF e CNPJ** são guardados como texto canônico: sem máscara, em maiúsculas, com zeros à esquerda. O CNPJ aceita o formato numérico e o alfanumérico (12 caracteres A-Z/0-9 + 2 dígitos verificadores; cada caractere vale código ASCII - 48, pesos e módulo 11 oficiais). As mesmas regras existem em SQL (`app_private.normalizar_documento`, `cpf_valido`, `cnpj_valido`) e em JS (`public/js/domain/documentos.js`); o banco decide. Documentos antigos sem DV válido continuam aceitos até serem alterados.
- **Duplicidade** gera aviso (`documento_em_uso`), nunca bloqueio, e só dentro da mesma empresa.
- **CEP:** a tela chama `GET /api/enderecos/cep/{cep}` na API Java, que consulta `https://brasilapi.com.br/api/cep/v2/{cep}` (host fixo, só HTTPS, sem redirecionamento, 3 s de conexão e 7 s no total, resposta até 32 KB, cache de 24 h, coalescência de consultas iguais, 20 consultas por pessoa por minuto). Só o CEP sai do computador. Falhas viram códigos distintos (`CEP_INVALIDO`, `CEP_NAO_ENCONTRADO`, `CEP_LIMITE`, `CEP_INDISPONIVEL`, `CEP_TEMPO_ESGOTADO`) e a tela mantém tudo editável; resposta antiga é descartada. A CSP continua só `'self'`. `AUTONICK_CEP_ATIVA=false` ou a flag `busca_cep` desligam a busca.

## Vendas: parcelas por DDL

`public/js/domain/parcelas.js` gera as parcelas com datas civis (equivalente a `LocalDate`, sem fuso) e centavos inteiros: DDL (dias corridos a partir da data-base), intervalo fixo, mensal no mesmo dia (último dia válido no mês curto, sem deriva) e prazos individuais. A sobra de centavos vai para a última parcela. A prévia é editável; o banco (`app_private.criar_titulo_venda`) confere de novo soma, ordem, datas de hoje em diante e 2 a 24 parcelas, e grava forma prevista e prazo de cada parcela. O recebido agora abate a 1ª parcela, sem duplicar a conta a receber.

## Flags, notificações e onboarding

- **Feature flags** (`app_private.feature_flags`, `public.flags_empresa`): só ligam ou desligam recursos opcionais (`animacoes_decorativas`, `busca_cep`, `onboarding_contextual`). Padrão ligado, mudança da CK exige motivo e entra na auditoria; nenhuma flag decide permissão.
- **Notificações** (`public.notificacoes`): nascem por gatilhos dos fluxos reais (pedido, solicitação, orçamento, OS, proposta de estoque), para o cliente dono do registro ou para quem tem a permissão da área. Deduplicação por chave única por pessoa, leitura, preferências por tipo. Só texto curto e link interno; sem e-mail, SMS ou push. Vínculo encerrado esconde os avisos da equipe daquela empresa.
- **Onboarding**: dicas curtas nas telas principais, dispensáveis e salvas por pessoa.

## Estratégia de testes

| Suíte | Onde | O que garante |
| --- | --- | --- |
| API Java (JUnit 5, Spring Boot Test) | `java/os-api/src/test` | A API de verdade, em porta aleatória, contra um PostgreSQL descartável: tokens, rotas de OS, rollback e atomicidade, conexões devolvidas limpas ao pool, camada de dados (estoque, idempotência, permissões, isolamento entre empresas, painel CK) e isolamento entre visitantes |
| Banco (`node:test`) | `tests/db` | Cada migration e as funções SQL num cluster PostgreSQL 18 temporário por arquivo, inclusive rollback sem resíduo e reaplicação das migrations |
| Unitários (`node:test`) | `tests/unit` | Regras puras do frontend (moeda, tempo, estoque, parcelas, documentos, próxima ação da OS), cliente HTTP, seleção do backend, política de segurança estática e integridade da marca |
| Interface (Playwright e axe-core) | `tests/e2e` | Telas das três áreas com respostas simuladas, acessibilidade WCAG, responsividade, PWA (instalação, offline, atualização) e PDFs |

A integração contínua (`.github/workflows/ci.yml`) tem dois jobs: um para a API Java e outro para unitários, banco e interface.
