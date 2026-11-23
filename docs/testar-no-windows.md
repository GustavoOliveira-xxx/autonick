# Testar o AutoniCK no Windows 10 ou 11

Guia para executar a demonstração local, com dados fictícios, num computador com Windows. Não é preciso instalar PostgreSQL, Maven, Node.js nem Docker.

## 1. Requisitos

- Windows 10 ou 11, 64 bits.
- **JDK 21** (recomendado: Eclipse Temurin 21) com a variável `JAVA_HOME` apontando para a pasta do JDK.
- **Internet na primeira execução:** o inicializador baixa o Maven (pelo Maven Wrapper), as dependências Java e os binários do PostgreSQL 18 (cerca de 25 MB só do PostgreSQL). Nas execuções seguintes, tudo vem do cache local.
- Porta **8080** livre (pode ser trocada; veja o item 10).
- Cerca de 1 GB livre em disco para o cache do Maven, os binários e os dados da demonstração.

## 2. Conferir o JDK 21 e o `JAVA_HOME`

Abra o **Prompt de Comando** (tecla Windows, digite `cmd`, Enter) e rode:

```bat
echo %JAVA_HOME%
"%JAVA_HOME%\bin\java" -version
```

O primeiro comando deve mostrar a pasta do JDK, por exemplo `C:\Program Files\Eclipse Adoptium\jdk-21.0.x-hotspot`. O segundo deve mostrar `openjdk version "21...`.

Se `JAVA_HOME` estiver vazio:
- no instalador do Temurin, marque a opção **Set JAVA_HOME variable**; ou
- em **Configurações > Sistema > Sobre > Configurações avançadas do sistema > Variáveis de Ambiente**, crie a variável de usuário `JAVA_HOME` com a pasta do JDK.

Feche e abra o Prompt de Comando de novo depois de mudar a variável.

## 3. Extrair o ZIP

1. Opcional, para evitar avisos do Windows: clique com o botão direito no ZIP, abra **Propriedades** e, se aparecer, marque **Desbloquear** e clique em OK.
2. Clique com o botão direito no ZIP e escolha **Extrair tudo...**.
3. Prefira uma pasta simples, por exemplo `C:\Projetos\autonick`. Evite pastas sincronizadas pelo OneDrive enquanto a demonstração estiver aberta.

## 4. Iniciar

Na pasta extraída, dê dois cliques em **`AutoniCK-local.cmd`**, ou rode no Prompt de Comando:

```bat
cd C:\Projetos\autonick
AutoniCK-local.cmd
```

Se o Windows SmartScreen avisar sobre o arquivo, clique em **Mais informações** e em **Executar assim mesmo**.

A janela mostra o andamento: PostgreSQL portátil, criação do banco e aplicação das migrations (só na primeira vez), e início da API Java. Na primeira execução isso pode levar alguns minutos. Quando aparecer:

```
[autonick] PRONTO: http://127.0.0.1:8080/
```

o navegador abre sozinho. **Deixe a janela aberta** enquanto usar o aplicativo.

## 5. Acessar no navegador

Endereço: **http://127.0.0.1:8080/**. Use Chrome ou Edge. O aplicativo só responde neste computador, porque escuta apenas em `127.0.0.1`.

## 6. Entrar com as pessoas fictícias

1. Na página inicial, escolha **Cliente** ou **Business** e clique em **Entrar**.
2. Na seção **Entrar na demonstração**, clique numa pessoa, por exemplo **Entrar como Rafael Souza**, o gestor da assistência técnica.
3. Também é possível entrar pelo formulário com o e-mail da pessoa e a senha `demo1234`. Os e-mails são `cliente@autonick-teste.example`, `gestor@autonick-teste.example`, `funcionario@autonick-teste.example`, `ck@autonick-teste.example` e assim por diante.
4. Na área Business, abra **Minhas empresas** e escolha a empresa para ver painel, vendas, estoque, financeiro, OS e demais módulos.

O README lista todas as pessoas fictícias e sugere alguns roteiros.

## 7. Conferir se a API Java está funcionando

Abra **http://127.0.0.1:8080/api/saude** no navegador. A resposta esperada é:

```json
{"api":"ok","banco":"ok"}
```

A faixa amarela **DEMONSTRAÇÃO** no topo das páginas indica que a PWA está usando a API Java local com dados fictícios.

## 8. Restaurar os dados da demonstração

O que você fizer no aplicativo (vendas, pedidos, OS) **fica guardado** entre execuções. Para voltar ao cenário inicial:

1. Encerre o AutoniCK (item 9).
2. Dê dois cliques em **`AutoniCK-restaurar.cmd`**.
3. Digite `RESTAURAR` e tecle Enter. O banco da demonstração é apagado e recriado, e o aplicativo abre de novo.

## 9. Encerrar

Na janela do AutoniCK, tecle **Ctrl+C**. Se o Windows perguntar "Deseja finalizar o arquivo em lotes (S/N)?", responda **S**. Fechar a janela também encerra. A API Java e o PostgreSQL são parados, e os dados continuam guardados.

## 10. Se a inicialização falhar

| Sintoma | O que conferir |
| --- | --- |
| "Defina JAVA_HOME para a pasta do JDK 21..." ou "JAVA_HOME nao aponta para um JDK" | Refaça o item 2 e abra uma nova janela |
| "A porta 8080 já está em uso" | Feche a demonstração anterior ou outro programa na porta 8080. Para usar outra porta: `set AUTONICK_LOCAL_PORTA=8090` e depois `AutoniCK-local.cmd`, na mesma janela; o endereço passa a ser http://127.0.0.1:8090/ |
| Erro de `VCRUNTIME140.dll` ou `MSVCP140.dll` | Instale o Microsoft Visual C++ Redistributable 2015-2022 (x64), gratuito, no site da Microsoft |
| "A API Java não subiu" | Veja o log em `%LOCALAPPDATA%\AutoniCK\demonstracao-local\api-java.log` |
| A primeira execução demora ou falha ao baixar | Confira a internet e o proxy; o Maven precisa acessar `repo.maven.apache.org` na primeira vez |
| Antivírus bloqueia `postgres.exe` ou `java.exe` | Libere os programas da pasta `%LOCALAPPDATA%\AutoniCK\demonstracao-local` e do JDK; eles só escutam em `127.0.0.1` |
| A página não abre sozinha | Abra manualmente http://127.0.0.1:8080/ |
| Dados estranhos ou inconsistentes | Restaure a demonstração (item 8) |

Os dados, os binários do PostgreSQL e os logs ficam em `%LOCALAPPDATA%\AutoniCK\demonstracao-local`. Para remover tudo depois do teste, encerre o AutoniCK e apague essa pasta e a pasta extraída do ZIP.

> Situação: o fluxo foi verificado no Linux com o inicializador equivalente (`autonick-local.sh`) e executado manualmente num computador com Windows usando o JDK 27: página inicial, identidade visual e os quatro perfis fictícios funcionaram, sem problemas relatados. Foi uma exploração manual, não uma regressão completa. A versão-alvo do projeto é o JDK 21.
