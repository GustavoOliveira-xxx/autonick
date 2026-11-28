# Evolução integrada · como testar no Windows

Branch: **`feature/evolucao-integrada-autonick`** (repositório `GustavoOliveira-xxx/autonick`). A `main` não foi alterada.
O guia geral do AutoniCK local continua em `docs/testar-no-windows.md` (JDK 21, `JAVA_HOME`, problemas comuns).

## 1. Pegar a versão nova

Você já tem o repositório em `C:\Projetos\autonick`; não precisa clonar de novo. No Prompt de Comando:

```bat
cd C:\Projetos\autonick
git fetch origin feature/evolucao-integrada-autonick
git switch feature/evolucao-integrada-autonick
git pull --ff-only
```

Confira o commit (o mesmo informado no relatório final):

```bat
git log -1 --oneline
```

### Java (JAVA_HOME)

O projeto é compilado para Java 21 (`release 21`) e roda com qualquer JDK 21 ou mais novo. O JDK que você já tem serve:

```bat
set "JAVA_HOME=C:\Program Files\Java\jdk-27.0.1.0.3"
"%JAVA_HOME%\bin\java" -version
```

Para deixar fixo (abre num Prompt novo): `setx JAVA_HOME "C:\Program Files\Java\jdk-27.0.1.0.3"`. Se preferir o Temurin 21 (gratuito), aponte `JAVA_HOME` para a pasta dele.

## 2. Testar numa base separada (recomendado)

Esta versão traz 14 migrations novas em relação à `main` (de `202611250001` a `202612010002`; as duas últimas são do pacote de 27/11:
documentos e CEP, parcelas, flags, notificações, onboarding e modelos de orçamento). Elas só acrescentam tabelas e funções, mas o jeito seguro de
testar é numa pasta separada, sem tocar nos dados que você já tem. Na mesma janela do Prompt de Comando:

```bat
set AUTONICK_LOCAL_PASTA=%LOCALAPPDATA%\AutoniCK\evolucao
AutoniCK-local.cmd
```

O AutoniCK cria um banco novo nessa pasta, aplica todas as migrations e monta o cenário fictício. Os dados antigos, em
`%LOCALAPPDATA%\AutoniCK\demonstracao-local`, ficam intactos. Para voltar a usar a base antiga, abra uma janela nova (sem a variável) e rode
`AutoniCK-local.cmd` como sempre.

## 3. Usar a versão nova com os seus dados antigos (opcional)

Faça um backup antes. Com o AutoniCK **fechado**:

```bat
AutoniCK-local.cmd --backup
```

A cópia (banco e arquivos enviados) fica em `%LOCALAPPDATA%\AutoniCK\demonstracao-local\backups\AAAAMMDD-HHMMSS`. Depois rode
`AutoniCK-local.cmd` normalmente: as migrations novas são aplicadas na base antiga na primeira abertura.

**Recuperar o backup:** feche o AutoniCK, apague as pastas `dados` e `arquivos` de `%LOCALAPPDATA%\AutoniCK\demonstracao-local` e copie para lá as
pastas `dados` e `arquivos` do backup escolhido. Atenção: o backup volta ao estado anterior às migrations; ao abrir com esta versão, elas
serão aplicadas de novo.

### Busca de CEP (BrasilAPI)

Não precisa de conta, chave nem cartão. O computador precisa de internet. Teste rápido (opcional):

```bat
curl.exe --max-time 10 "https://brasilapi.com.br/api/cep/v2/01001000"
```

No app, a busca passa pela API Java local (`/api/enderecos/cep/...`); só o CEP sai do computador. Sem internet ou com o serviço fora do ar,
aparece "Não foi possível buscar o CEP. Preencha o endereço manualmente." e o cadastro continua. Para desligar a busca:
`set AUTONICK_CEP_ATIVA=false` antes de abrir o AutoniCK.

## 4. Endereços

- Aplicativo: **http://127.0.0.1:8080/** (outra porta: `set AUTONICK_LOCAL_PORTA=8090` antes de abrir).
- Saúde da API: http://127.0.0.1:8080/api/saude
- Labs de design (só leitura, sem banco): dois cliques em `design-lab\Abrir-Design-Lab.cmd` e abra
  http://127.0.0.1:8091/refino.html (UX), http://127.0.0.1:8091/animacoes.html (animações e a luva) e http://127.0.0.1:8091/forja.html.

## 5. Conferir rapidamente

Com o AutoniCK aberto, dê dois cliques em **`AutoniCK-validar.cmd`**. Ele só lê: confere API e banco, as páginas novas, os arquivos da
paleta e da luva, que um arquivo inexistente responde 404, que os dados exigem sessão e que a política de segurança está ativa.

## 6. Roteiro de validação manual sugerido

Entre como **Rafael Souza** (gestor, senha `demo1234`):

1. **Minhas empresas**: cadastre uma empresa pelo modal com logo; troque de empresa pelo bloco do menu; marque uma favorita.
2. **Ctrl+K** em qualquer tela: busque "cida", "2" (OS ou venda nº 2) ou "financeiro"; fixe uma área com a estrela e veja "Fixados" no menu.
3. **Empresa e vitrine**: troque a logo, envie a alteração para análise; entre como **Administração CK**, veja a logo na fila e aprove.
4. **Produtos**: abra um produto e envie uma imagem; veja a miniatura na lista.
5. **Equipe**: abas Pessoas, Perfis e Histórico; "Adicionar colaborador"; monte um perfil por níveis (Sem acesso, Consultar, Operar, Personalizar).
6. **Agenda**: visões Dia, Semana, Mês e Lista; "Novo compromisso" sobre outro horário (aviso antes de gravar); feriado em "Feriados e exceções".
7. **Clientes**: "Abrir ficha". **Orçamentos**: visão "Funil". **Atividades** no menu.
8. **Painel**: "Definir metas do mês"; registre uma venda e veja o progresso (a comemoração só aparece quando a meta é atingida de verdade).
9. **Financeiro**: ações rápidas "Entrada ou saída" e "Transferir" abrem em modal.
10. **Ordens de serviço**: abra uma OS, aba **Checklist**: crie um item obrigatório e tente concluir a OS (o banco recusa); marque o item e conclua.
    Entre como **Cida Ramos** (cliente) e veja as "Etapas do serviço" visíveis.
11. **Administração CK**: abas Filas, Empresas, Parâmetros (restaurar o padrão), Saúde e Auditoria.
12. **Página inicial**: o Bong alterna o "Chamado da Forja" com a cena da luva ("BONG!").

### Pacote de 27/11 (roteiro extra)

Com **Rafael Souza**:

1. **Entrar**: com uma empresa ativa (ou uma só), o painel abre direto. Menu sem "Cadastrar empresa"; cadastro só em Minhas empresas.
2. **Orçamentos**: a aba "Abertas" fica legível (texto escuro no dourado) nos dois temas.
3. **Vendas**: busque pelo cliente ou número; "Nova venda": escolha o cliente pela busca (ou "+ Novo cliente"), Parcelado, 2 parcelas,
   "A cada tantos dias (DDL)", primeira em 30 dias, intervalo 30, "Gerar parcelas": R$ 120 vira 27/12 e 26/01 (com data-base 27/11/2026);
   troque para "Todo mês no mesmo dia": 27/12 e 27/01. Edite um valor e veja a diferença; confirme e abra a venda (DDL e forma por parcela).
4. **Clientes**: "Adicionar cliente", Pessoa jurídica, CNPJ `12.ABC.345/01DE-35`, CEP `01001-000` (preenche rua, bairro, cidade e UF).
5. **Estoque**: tabela simples; "Ajustar estoque" só para exceções; "Histórico" mostra a origem (venda, compra, ajuste).
6. **Fornecedores** e **Compras** separados no menu; "Nova compra" com "+ Novo fornecedor" sem perder o rascunho.
7. **Empresa e vitrine**: atalhos em cartões; "Sair da empresa" separado (só para colaborador).
8. **Equipe > Perfis**: "Novo perfil" em 4 etapas (nome, modelo, áreas, revisão com contagem e pessoas afetadas).
9. **Notificações** no menu; **Ordens de serviço** com "Próxima ação"; **Orçamento**: "Usar modelo" e "Salvar como modelo".
10. **Administração CK > Recursos opcionais**: desligue "Animações decorativas" (com motivo) e veja o Bong ficar estático.
11. **Lab** (`design-lab\Abrir-Design-Lab.cmd`, http://127.0.0.1:8091/animacoes.html): intervalo, intensidade, enquadramento e exportação.

## 7. Encerrar

Ctrl+C na janela do AutoniCK (responda **S** se o Windows perguntar). Os dados continuam guardados na pasta usada.
