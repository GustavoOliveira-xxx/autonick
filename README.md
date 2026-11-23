# AutoniCK

Plataforma integrada de gestão empresarial, serviços e relacionamento entre negócios e clientes. Uma iniciativa da **CK Group**.

O AutoniCK é uma aplicação web progressiva (PWA) de gestão para micro e pequenos negócios, integrada a uma área em que clientes encontram estabelecimentos, pedem produtos e orçamentos e acompanham serviços. A plataforma tem três áreas: **Business** (gestão da empresa), **Cliente** (descoberta e acompanhamento) e **Admin CK** (moderação e administração da plataforma).

O backend é uma **API Java 21 com Spring Boot 3** sobre **PostgreSQL 18**. O frontend é escrito em HTML, CSS e JavaScript com ES Modules, sem framework e sem etapa de build.

> O AutoniCK está em desenvolvimento contínuo e ainda não opera como serviço comercial aberto ao público. Esta versão roda localmente, com dados fictícios, e não processa pagamentos reais.

## O problema

Pequenos negócios costumam controlar vendas, estoque, contas e serviços em planilhas, cadernos e aplicativos de mensagem que não conversam entre si. Do outro lado, clientes têm dificuldade para encontrar prestadores locais, pedir um orçamento e acompanhar o andamento do serviço. O AutoniCK junta as duas pontas: o que a empresa registra no seu painel é o mesmo dado que o cliente acompanha na sua área, com regras de acesso que separam o que é público, o que é da empresa e o que é de cada cliente.

## A proposta

- **Um único registro para os dois lados:** a venda, o orçamento ou a ordem de serviço que a empresa registra é o mesmo dado que o cliente acompanha, sem cópias nem retrabalho.
- **Gestão completa num só lugar:** equipe e permissões, produtos e estoque, vendas, financeiro, serviços, agenda e ordens de serviço.
- **Descoberta local:** clientes encontram estabelecimentos por cidade, bairro e categoria, pedem produtos e orçamentos e conversam com a empresa dentro de cada pedido.
- **Confiança e moderação:** a vitrine pública só mostra empresas aprovadas pela CK, e avaliações, denúncias e contestações passam por moderação.
- **Integridade dos dados:** regras de negócio, permissões, estoque e financeiro são garantidos pelo banco de dados, e não pela tela.

## Funcionalidades implementadas

**Business**
- Cadastro de empresas, mais de uma por gestor, com cartão de vitrine sujeito à aprovação da CK.
- Equipe com convites, perfis de acesso e permissões por módulo (catálogo de 55 permissões), incluindo limite de desconto por perfil.
- Produtos com variações, estoque físico, reservado e disponível, movimentações propostas e aprovadas, alertas de estoque mínimo, fornecedores e compras.
- Clientes internos, vendas de balcão, pedidos recebidos pela vitrine (aceite, recusa, conclusão) e recebimentos.
- Financeiro: contas e caixas, categorias, títulos a pagar e a receber com parcelas, pagamentos parciais, estornos, transferências, recorrências, fechamento de período e relatórios com exportação CSV.
- Serviços com orçamento manual ou por regras, solicitações, versões de orçamento, agenda e ordens de serviço (OS).
- Ordens de serviço com ciclo completo: iniciar, pausar, retomar, informar conclusão, reabrir para revisão, encerrar, atualizações para o cliente, notas internas, garantia, materiais com reserva e baixa de estoque, sinal e parcelamento.
- Painel com o que precisa de ação, mensagens por pedido, solicitação e OS, avaliações e PDFs gerados no navegador.

**Cliente**
- Busca de empresas, produtos e serviços por cidade, bairro e categoria.
- Pedidos de produtos, solicitações de orçamento, aceite ou recusa de orçamentos.
- Acompanhamento de pedidos e OS, confirmação de recebimento, pedido de revisão, avaliação e conversa com a empresa.

**Admin CK**
- Fila de aprovação de cartões de vitrine, moderação de alterações e avaliações, contestações, denúncias, suspensão de vitrine e limites da plataforma.

**PWA**
- Instalável, com service worker que guarda só arquivos estáticos (dados privados nunca vão para o cache), página offline, leitura ampliada e layout responsivo.

## Tecnologias

| Camada | Tecnologias |
| --- | --- |
| Backend | Java 21, Spring Boot 3.5 (Web, Security, OAuth2 Resource Server, JDBC, Validation), Maven Wrapper |
| Banco de dados | PostgreSQL 18: funções PL/pgSQL, Row Level Security, permissões por coluna, 22 migrations versionadas com rollback |
| Frontend | HTML5, CSS3, JavaScript (ES Modules), Service Worker, pdf-lib, three.js |
| Testes | JUnit 5 e Spring Boot Test, `node:test`, Playwright com axe-core |
| Execução local | PostgreSQL 18 portátil (binários do projeto zonky), sem instalação e sem Docker |
| CI | GitHub Actions: job Java (build e testes) e job da PWA (unitários, banco e interface) |

## Arquitetura

```
Navegador (PWA: HTML, CSS, JS)
        │  mesma origem: /api/...
        ▼
API Java (Spring Boot)
  • valida o token e separa pessoa de visitante anônimo
  • catálogo fechado de operações por domínio
  • uma transação por pedido, com a identidade aplicada só nela
  • rotas próprias de ordens de serviço
  • traduz erros do banco, limita uso, entrega a PWA na execução local
        │  JDBC (papel da API sem acesso direto aos dados)
        ▼
PostgreSQL 18
  • funções PL/pgSQL com as regras de negócio
  • RLS e permissões por coluna
  • idempotência, versão, estoque e trilha de auditoria
```

A divisão de responsabilidades é intencional. As regras de negócio, as permissões por empresa e a integridade de estoque e financeiro ficam nas **funções do PostgreSQL**, perto dos dados e dentro da mesma transação. A **API Java** é a porta de entrada: ela autentica, decide o que pode ser chamado, aplica a identidade do usuário em cada transação, garante transações somente leitura nas consultas e devolve erros consistentes. O **frontend** só exibe e envia dados: ele nunca é a fonte de verdade de preços, permissões ou saldos.

## O backend Java

Código em `java/os-api` (módulo Maven `os-api`, pacote `br.com.ckgroup.autonick.osapi`).

- **Camada de dados por domínio** (`plataforma`). `Dominio` lista, em 11 domínios (empresas e equipe, produtos e estoque, vendas e pedidos, financeiro, serviços e orçamentos, ordens de serviço, comunicação, vitrine pública, vitrine de demonstração, identidade e Admin CK), as funções do banco que a API aceita executar. Nada fora dessa lista é executado, mesmo que exista no banco.
- **Executor de operações** (`ExecutorDados`). Lê a assinatura de cada função no catálogo do PostgreSQL, aceita só os parâmetros que ela declara, vincula os valores sempre por parâmetro JDBC com o tipo correto e confere a chave de operação nas escritas. Abre uma transação por pedido, somente leitura para funções `STABLE`, aplica `SET LOCAL ROLE` e a identidade do token com `set_config(..., true)` e define um tempo máximo por comando. No fim da transação, a conexão volta ao pool sem papel nem identidade.
- **Leitura de tabelas** (`ConsultaTabelas`). Subconjunto fechado de filtros (`eq`, `in`, `is`), seleção de colunas conferida no catálogo do banco, um relacionamento embutido e limite de linhas. Quem decide as linhas e colunas visíveis continua sendo o banco, por RLS e permissões por coluna.
- **Rotas de ordens de serviço** (`web` e `dados`). Endpoints REST próprios para listas, detalhe e escritas da empresa e do cliente (iniciar, pausar, concluir, reabrir, encerrar, atualizações, garantia, materiais, confirmação de recebimento e pedido de revisão). Antes de cada escrita, a API confere na mesma transação se a pessoa ainda pode agir sobre aquela OS.
- **Erros** (`DadosController`, `TratadorErros`). O código de regra que a função SQL coloca no `HINT` vira status HTTP e mensagem em português. Erros inesperados viram uma resposta genérica, sem SQL nem pilha.
- **Demonstração** (`demonstracao`). Contas fictícias, entrada por pessoa, montagem do cenário fictício pelas próprias funções do app e cenários isolados por visitante.

## Integração com o PostgreSQL

- O schema vem das migrations em `db/migrations_propostas`, cada uma com o arquivo `.down.sql` de rollback.
- `db/tests/emulacao-neon.sql` reproduz localmente os papéis e as funções de identidade (`auth.uid()`) usados pelo provedor de autenticação, para o mesmo schema rodar num PostgreSQL comum.
- A API se conecta com um papel `LOGIN NOINHERIT` que não enxerga os dados por conta própria: ele só lê ou grava assumindo, dentro da transação, o papel `authenticated` ou `anonymous`, com a identidade do token.
- Operações de escrita recebem uma chave de operação: repetir o mesmo pedido devolve o resultado já gravado, em vez de duplicar vendas, recebimentos ou baixas de estoque. Pedidos com versão esperada recusam alterações feitas sobre dados desatualizados.
- `db/demo` contém o schema `demo_auth`, usado só pela demonstração: contas fictícias de entrada e as poucas operações administrativas da montagem do cenário, todas em funções `SECURITY DEFINER` executáveis apenas pelo papel da API.

## Autenticação e segurança

- **Dois modos de token**, escolhidos por configuração. No modo `neon`, a API valida tokens EdDSA do provedor de autenticação pela JWKS, com emissor exato e validade. No modo `demo`, a própria API emite e valida tokens HMAC para contas fictícias. Em nenhum dos modos um token do outro é aceito.
- **Sessão da demonstração** em cookie `HttpOnly`, `SameSite=Lax`, restrito a `/api/auth`. O token de acesso dura 15 minutos e fica só na memória da aba. O cookie de sessão nunca é aceito como token de acesso.
- **Visitante anônimo** só chama as funções da vitrine pública. Rotas de pessoa exigem token de pessoa.
- **Isolamento entre empresas** pelas regras do banco (RLS e checagens nas funções), conferido pelos testes com gestores de empresas diferentes.
- **Painel CK** conferido duas vezes: na API, antes de chamar a função, e de novo na própria função.
- **Demonstração pública:** entrada só pelas pessoas fictícias (e-mail e senha são recusados), um cenário próprio por visitante e isolamento fechado por padrão (uma conta sem cenário é recusada). Há também limite de criação de cenários por origem e no total, e limite de operações por minuto.
- **Por padrão a API só aceita PostgreSQL local.** Um banco remoto exige configuração explícita e o modo de demonstração.
- **Cabeçalhos de segurança:** Content Security Policy restritiva (sem scripts ou estilos inline), `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy` e `Permissions-Policy`.

## Organização do frontend

```
public/
  index.html, ajuda.html, offline.html, manifest.webmanifest, service-worker.js
  cliente/  business/  ck-admin/        páginas de cada área
  css/                                  tokens, base e componentes
  js/
    config/   configuração pública (qual backend usar)
    data/     acesso a dados (cliente HTTP, uma função por operação)
    domain/   regras de exibição puras (moeda, tempo, estoque)
    features/ telas, por área e módulo
    ui/       layout, formulários, diálogos e estados
    pdf/      documentos gerados no navegador
  vendor/   pdf-lib e three.js, com as licenças
  assets/   marca, ícones, fontes e capturas do manifesto
```

A configuração pública escolhe o backend de forma explícita: `neon`, `java-local` ou `java-online`. No modo Java, as telas usam o mesmo cliente de dados, agora apontado para `/api/auth` e `/api/dados` na mesma origem, e as ordens de serviço usam as rotas próprias da API. Um backend desconhecido deixa o acesso desligado: nunca há volta silenciosa para outro backend nem confirmação de sucesso sem resposta do servidor.

## Executar localmente

**Requisito:** JDK 21 (por exemplo, Eclipse Temurin) com `JAVA_HOME` definido. O JDK 21 é a versão-alvo do projeto, usada no desenvolvimento e na CI. É preciso também internet na primeira execução, para baixar as dependências. Não é preciso instalar PostgreSQL, Maven, Node.js nem Docker para usar a demonstração.

Passo a passo para Windows 10 e 11, com solução de problemas: [docs/testar-no-windows.md](docs/testar-no-windows.md).

**Windows**
```bat
AutoniCK-local.cmd
```
Também é possível dar dois cliques no arquivo.

**Linux ou macOS** (com um usuário comum, porque o PostgreSQL não roda como root)
```bash
./autonick-local.sh
```

O inicializador:
1. sobe um PostgreSQL 18 portátil, só em `127.0.0.1`, numa pasta da demonstração (`%LOCALAPPDATA%\AutoniCK\demonstracao-local` no Windows, `~/.autonick/demonstracao-local` nos outros sistemas);
2. cria o banco e aplica as migrations;
3. sobe a API Java, que monta o cenário fictício na primeira execução e entrega a PWA;
4. abre o navegador em `http://127.0.0.1:8080`.

Na primeira execução, o Maven baixa as dependências e os binários do PostgreSQL, então a abertura demora mais. Os dados ficam guardados entre execuções. Para voltar ao cenário inicial:

```bat
AutoniCK-restaurar.cmd
```
No Linux ou macOS: `./autonick-local.sh --restaurar`.

Variáveis opcionais: `AUTONICK_LOCAL_PORTA` (padrão 8080), `AUTONICK_LOCAL_PASTA` e `AUTONICK_DEMO_ABRIR_NAVEGADOR=0`.

## Usar a demonstração

O cenário fictício é montado pela própria API, chamando as mesmas funções que as telas usam. São quatro empresas de setores diferentes (assistência técnica, doceria, serviços elétricos e ateliê de costura), com produtos, estoque, vendas, contas a pagar, pedidos, orçamentos, ordens de serviço em vários estados, avaliação e mensagens. Cada perfil mostra um lado do sistema:

- **Cliente:** busca empresas na vitrine de demonstração, faz pedidos, pede e aceita orçamentos e acompanha as OS.
- **Gestor:** proprietário da empresa, com acesso a todos os módulos do ERP.
- **Funcionária:** membro da equipe com um perfil de acesso limitado; mostra as permissões sendo aplicadas pelo banco.
- **Administração CK:** aprova cartões de vitrine, modera avaliações e trata contestações.

Na página inicial, entre em **Cliente** ou **Business** e escolha uma pessoa fictícia. A senha das contas é `demo1234`, para quem preferir o formulário de entrada.

| Pessoa | Área | O que mostra |
| --- | --- | --- |
| Cida Ramos | Cliente | Pedidos, orçamentos, OS em vários estados, avaliação e mensagens |
| Marcos Lima | Cliente | Pedido aguardando aceite e OS em execução |
| Rafael Souza | Business | Gestor da assistência técnica: vendas, estoque, financeiro e OS |
| Bianca Alves | Business | Funcionária com perfil limitado: vê vendas, não vê financeiro nem equipe |
| Rosa Martins | Business | Gestora de uma doceria: pedidos, estoque e vendas |
| Paulo Nunes | Business | Gestor de uma prestadora de serviços elétricos: orçamentos e agenda |
| Lia Costa | Business | Gestora de um ateliê de costura |
| Administração CK | Business | Painel CK: aprovação, moderação e contestações |

Para os módulos da empresa, escolha a empresa em "Minhas empresas". Sugestões de roteiro:
- Como Rafael, abra uma OS "Aguardando início" e inicie; registre uma venda e veja o estoque baixar.
- Como Cida, peça um orçamento à elétrica; depois, como Paulo, responda a solicitação.
- Como Bianca, confira o que o perfil limitado permite e o que é recusado.

Também há uma demonstração pública preparada, ainda não publicada, em que cada visitante recebe um cenário próprio: veja `scripts/montar-demo-publica.mjs`, `java/os-api/Dockerfile` e a classe `InstalarBancoPublico`.

## Testes

Requisitos: Node.js 20 ou superior e `npm ci`. Os testes de banco precisam dos binários do PostgreSQL 18 (`PG_BIN`), e os testes Java de um PostgreSQL local (`AUTONICK_JAVA_DB_URL`) ou de Docker. Nenhum teste acessa os serviços em nuvem do projeto: os testes de interface simulam as respostas da API, e os de banco e Java usam bancos locais descartáveis.

```bash
npm ci
npx playwright install chromium

npm run test:unit                          # unitários do frontend
PG_BIN=/caminho/postgresql/18/bin npm run test:db   # banco: um cluster temporário por arquivo
npm run test:e2e                           # interface (Playwright)

cd java/os-api
AUTONICK_JAVA_DB_URL=jdbc:postgresql://localhost:5432/postgres \
AUTONICK_JAVA_DB_USUARIO=postgres ./mvnw verify   # API Java
```

Os testes Java sobem a API de verdade, em porta aleatória, contra um banco descartável. Eles cobrem consultas e escritas de OS, rollback e atomicidade, conexões devolvidas limpas ao pool, validação de tokens, isolamento entre empresas, a camada de dados (estoque, idempotência, permissões, painel CK) e o isolamento entre visitantes da demonstração pública.

A integração contínua (`.github/workflows/ci.yml`) roda as quatro suítes a cada envio.

## Documentação técnica

- [docs/arquitetura.md](docs/arquitetura.md): caminho de um pedido pelas três camadas, módulos Java, organização do banco, autenticação e estratégia de testes.
- [docs/testar-no-windows.md](docs/testar-no-windows.md): execução e solução de problemas no Windows.

## Estado atual e limitações

- Versão em desenvolvimento contínuo, executada localmente com dados fictícios. Ainda não há serviço em produção, contas reais nem pagamentos reais.
- A demonstração pública está preparada, mas não publicada. A hospedagem pretendida é gratuita e suspende a API quando ociosa, o que atrasa a primeira resposta.
- **Execução manual no Windows:** o inicializador `AutoniCK-local.cmd` foi executado num computador com Windows usando o **JDK 27**. A página inicial abriu em `http://127.0.0.1:8080`, com a identidade visual, e os quatro perfis fictícios (Cliente, Gestor, Funcionária e CK Admin) foram acessados e explorados, inclusive a associação da funcionária à empresa fictícia, sem problemas relatados. Foi uma exploração manual, não uma regressão funcional completa. A suíte automatizada e a CI usam o JDK 21; não há garantia de compatibilidade com outras versões do Java além das que foram efetivamente usadas.
- WebKit/Safari, instalação da PWA em aparelhos reais e leitores de tela não tiveram validação manual completa.
- Uploads de imagens e arquivos não estão implementados.
- Na demonstração pública, o limite de cenários por origem confia no cabeçalho `X-Forwarded-For` da hospedagem, e os limites de uso ficam em memória, por instância.
- Sair da demonstração apaga o cookie, mas a sessão emitida continua válida até expirar, em até 8 horas.
- Próxima evolução prevista: tornar configuráveis pelo painel CK Admin algumas regras e alguns limites que hoje são fixos. Os parâmetros ainda serão definidos.

## Créditos e condições de uso

AutoniCK é uma iniciativa da **CK Group**. O nome, a marca, os logotipos e a identidade visual do AutoniCK e da CK Group pertencem aos seus titulares e não estão licenciados para reutilização. Este repositório ainda não tem uma licença de código definida: até que uma seja publicada, todos os direitos sobre o código e o conteúdo próprios ficam reservados.

Componentes de terceiros, com as licenças incluídas no repositório:
- **pdf-lib** (MIT), em `public/vendor/pdf-lib`;
- **three.js** (MIT), em `public/vendor/three`;
- fontes **Atkinson Hyperlegible**, **Barlow Condensed** e **IBM Plex** (SIL Open Font License 1.1), em `public/assets/fonts`;
- dependências Java (Spring Boot, PostgreSQL JDBC, Nimbus JOSE + JWT, zonky embedded-postgres, entre outras) e de teste em JavaScript (Playwright, axe-core, pdf.js), obtidas pelos gerenciadores de pacote sob as licenças de cada projeto.
