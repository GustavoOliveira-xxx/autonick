# AutoniCK Design Lab

Laboratório interativo de direção artística, UI/UX e interações 3D do AutoniCK, uma iniciativa da CK Group.
Serve para experimentar alternativas visuais **antes** de qualquer mudança na interface principal.

- Não altera o aplicativo: fica em `design-lab/` e só **lê** arquivos de `public/` (Three.js, modelo do sino, fontes, logos e o módulo da animação atual).
- Não usa banco, API, serviço pago nem internet. As escolhas ficam no navegador (localStorage) e podem ser exportadas.

## Como abrir no Windows

1. Atualize a branch: `git fetch origin` e `git checkout claude/clever-albattani-hxpp8k` (depois, `git pull` para receber atualizações).
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

## Estrutura

```
design-lab/
  index.html            página (formato de artefato: o servidor acrescenta o doctype)
  Servidor.java         servidor local somente leitura
  css/                  bancada, réplicas do app (container queries) e interações
  js/motor/             motor 3D compartilhado (um contexto WebGL), rig do sino, objetos e animações
  js/paginas/           uma página por categoria
  js/replica.js         réplica funcional da home e do painel
```

Medidas de desempenho nas fichas são estimativas técnicas. A única medição real é a do topo da bancada
(tempo médio de desenho de um quadro 3D no navegador de quem está usando).
