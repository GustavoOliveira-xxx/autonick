# AutoniCK Design Lab

Laboratório interativo de direção artística, UI/UX e interações 3D do AutoniCK, uma iniciativa da CK Group.
Serve para experimentar alternativas visuais **antes** de qualquer mudança na interface principal.

- Não altera o aplicativo: fica em `design-lab/` e só **lê** arquivos de `public/` (Three.js, modelo do sino, fontes, logos e o módulo da animação atual).
- Não usa banco, API, serviço pago nem internet. As escolhas ficam no navegador (localStorage) e podem ser exportadas.

## Como abrir no Windows

1. Atualize a branch: `git fetch origin` e `git checkout feature/ux-dinamismo-refino-geral` (depois, `git pull` para receber atualizações).
2. Dê dois cliques em `design-lab\Abrir-Design-Lab.cmd`.
3. O navegador abre em `http://127.0.0.1:8091/`. Para encerrar, feche a janela do terminal.

Sem o atalho, na pasta `C:\Projetos\autonick`:

```
java design-lab\Servidor.java 8091
```

O servidor é um único arquivo Java (JDK 21, o mesmo do AutoniCK), escuta só em 127.0.0.1 e só aceita leitura.
Abrir o `index.html` direto pelo Explorer não funciona: os módulos JavaScript precisam de um endereço `http://`.

## O que tem dentro

| Seção | Conteúdo |
|---|---|
| A · Composição do fundo | 10 propostas + a atual, com o foco medido a partir do sino real |
| B · Animações do sino | 14 propostas + a atual (importada do próprio app) |
| C · Ritmo | 6 propostas + a atual, linha do tempo com fases e tempo parado medido |
| D · Objetos 3D | 15 objetos procedurais com material, luz, contorno, escala, entrada, interação e saída |
| E · Fundo animado | 10 movimentos em 3 intensidades |
| F · Feedback de clique | 14 propostas + a atual, com simulador de resposta e registro de tempos |
| G · Loaders | 13 indicadores e uma sugestão por contexto |
| H · Microinterações | 3 linguagens aplicadas a componentes reais |
| I · Áreas | 20 momentos em Business, Cliente e CK Admin |
| J · Direções | 6 direções na home e no painel Business |
| Combinador, Combinações (6) e Minhas escolhas | montagem livre, presets e exportação em texto e JSON |

## Prévia do site inteiro: CK Forja Noturna

`http://127.0.0.1:8091/forja.html` mostra o AutoniCK inteiro na direção aprovada (Noite da Forja + Empresarial Premium + HQ Cinematográfica):
home com palco em perspectiva (A05), cúpula de raios girando à parte (E01), Chamado da Forja refinado (B12F) no ritmo C04,
feedback F14 + H02, loaders por contexto e os 20 conceitos da categoria I nas telas de Business, Cliente e CK Admin.
Cada animação da categoria I só acontece depois de um evento (use os botões "Simular eventos desta tela").

## Lab de refino de UX (proposta para aprovação)

`http://127.0.0.1:8091/refino.html` reúne a rodada de refino de UX, dinamismo e marca. Nada foi aplicado ao app.

| Seção | O que mostrar |
|---|---|
| Visão geral | diretriz "tarefa primeiro", objetivos reais antes e depois e a paleta "Ir para…" (Ctrl K) |
| Clique e carregamento | 3 estilos de clique (Forja, Prensa, Faísca) e 9 indicadores por contexto |
| Navegação e legibilidade | menu lateral, abas e 11 problemas encontrados com a correção |
| Central de empresas | troca rápida pelo menu e modal completo de cadastro com logo |
| Equipe | lista simples, convite, troca de perfil, encerrar acesso e perfis por nível |
| Agenda | grade semanal com régua de 24 h, modelos, folgas e exceções e visão da semana |
| Financeiro | ações grandes, modais curtos e livro-caixa com filtros compactos |
| CK Admin | fila com aprovação em um clique |
| Tema claro | escuro, claro revisado e claro de hoje lado a lado |
| Marca | logo completa, símbolo simplificado em SVG (provisório) e onde usar cada um |

No topo: tema, computador/celular, estilo do clique, tempo de resposta e resultado simulados e movimento reduzido.
As imagens "Hoje no app" (`img/antes/`) são capturas das telas atuais com dados de teste.

## Lab de animações

`http://127.0.0.1:8091/animacoes.html` tem o palco com comparação lado a lado (linha do tempo, fases e laço),
o estúdio da mãozinha 3D (gestos, poses, acabamentos e giro) e a galeria com as 22 animações: a do app (B12F),
6 novas com a mãozinha (N01 a N06, sendo a N02 o refinamento da B04) e as 15 do lab anterior.
A mão é procedural (`js/motor/mao.js`): nenhum modelo, textura ou biblioteca externa.

## Estrutura

```
design-lab/
  index.html            página (formato de artefato: o servidor acrescenta o doctype)
  Servidor.java         servidor local somente leitura
  css/                  bancada, réplicas do app (container queries) e interações
  js/motor/             motor 3D compartilhado (um contexto WebGL), rig do sino, objetos e animações
  js/paginas/           uma página por categoria
  js/replica.js         réplica funcional da home e do painel
  forja.html, css/forja.css, js/forja/   prévia do site inteiro na direção CK Forja Noturna
  refino.html, css/refino.css, js/refino/, img/antes/   lab de refino de UX
  animacoes.html, css/animacoes.css, js/animacoes/, js/motor/mao.js   lab de animações e mãozinha 3D
```

Medidas de desempenho nas fichas são estimativas técnicas. A única medição real é a do topo da bancada
(tempo médio de desenho de um quadro 3D no navegador de quem está usando).
