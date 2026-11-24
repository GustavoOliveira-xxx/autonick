package br.com.ckgroup.autonick.demo;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.ConnectException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executors;

/**
 * Servidor da DEMONSTRAÇÃO LOCAL do J03 (só 127.0.0.1).
 *
 *   /demo/            escolha da pessoa fictícia (Cliente ou Gestor) e links dos casos de teste
 *   /demo-auth/...    sessão simulada (get-session com token Ed25519 de teste; JWKS para a API Java validar)
 *   /demo-dados/...   substituto local da Data API, só leitura, para contexto, permissões e conversa (sem OS)
 *   /api-java/...     encaminhado à API Java do J02 (mesma origem, sem CORS); o detalhe da OS vem SÓ daqui
 *   /...              cópia local da PWA (public/), com a configuração da demonstração
 *
 * Banco: por padrão, um PostgreSQL 18 TEMPORÁRIO e exclusivo da demonstração ({@link BancoTemporario}), sem instalação,
 * sem serviço e sem senha para digitar. Alternativa: um PostgreSQL já instalado, por AUTONICK_DEMO_ADMIN_URL,
 * AUTONICK_DEMO_ADMIN_USUARIO (padrão postgres) e AUTONICK_DEMO_ADMIN_SENHA.
 * API Java: por padrão sobe como processo filho ({@link ApiJavaLocal}); AUTONICK_DEMO_API=externa não a inicia.
 * Outras: AUTONICK_DEMO_PORTA (8080), AUTONICK_DEMO_API_URL (http://127.0.0.1:8081), AUTONICK_DEMO_ABRIR_NAVEGADOR=0.
 */
public final class DemoPwaLocal {

    static final String COOKIE = "autonick_demo_pessoa";
    private static final Map<String, String> TIPOS = Map.ofEntries(
            Map.entry("html", "text/html; charset=utf-8"), Map.entry("js", "text/javascript; charset=utf-8"),
            Map.entry("mjs", "text/javascript; charset=utf-8"), Map.entry("css", "text/css; charset=utf-8"),
            Map.entry("json", "application/json"), Map.entry("webmanifest", "application/manifest+json"),
            Map.entry("svg", "image/svg+xml"), Map.entry("png", "image/png"), Map.entry("webp", "image/webp"),
            Map.entry("ico", "image/x-icon"), Map.entry("woff2", "font/woff2"), Map.entry("txt", "text/plain; charset=utf-8"),
            Map.entry("glb", "model/gltf-binary"), Map.entry("md", "text/plain; charset=utf-8"));

    private final Path pwa;
    private final Path raiz;
    private final Path saida;
    private final ChavesDemo chaves;
    private final BancoDemo banco;
    private final DadosSimulados dados;
    private final URI api;
    private final ApiJavaLocal apiLocal;
    private final String origem;
    private final java.util.Set<String> hostsAceitos;
    private final HttpClient http = HttpClient.newBuilder().proxy(HttpClient.Builder.NO_PROXY)
            .connectTimeout(Duration.ofSeconds(3)).build();

    private DemoPwaLocal(Path raiz, Path saida, ChavesDemo chaves, BancoDemo banco, URI api, ApiJavaLocal apiLocal, int porta) {
        this.raiz = raiz;
        this.saida = saida;
        this.pwa = raiz.resolve("public");
        this.chaves = chaves;
        this.banco = banco;
        this.dados = new DadosSimulados(banco, chaves);
        this.api = api;
        this.apiLocal = apiLocal;
        this.origem = "http://127.0.0.1:" + porta;
        this.hostsAceitos = java.util.Set.of("127.0.0.1:" + porta, "localhost:" + porta);
    }

    public static void main(String[] args) throws Exception {
        Path raiz = Path.of(System.getProperty("autonick.raiz", "../..")).toAbsolutePath().normalize();
        Path saida = Path.of(System.getProperty("autonick.demo.saida", "target")).toAbsolutePath().normalize();
        int porta = Integer.parseInt(env("AUTONICK_DEMO_PORTA", "8080"));
        URI api = URI.create(env("AUTONICK_DEMO_API_URL", "http://127.0.0.1:8081"));
        if (!BancoDemo.hostLocal(api)) throw new IllegalArgumentException("A API Java da demonstração precisa estar em 127.0.0.1 ou localhost.");
        String origem = "http://127.0.0.1:" + porta;
        boolean apiFilha = !"externa".equalsIgnoreCase(env("AUTONICK_DEMO_API", "filho"));
        ApiJavaLocal apiLocal = apiFilha ? new ApiJavaLocal(raiz.resolve("java/os-api"), saida.resolve("demo-api.properties"),
                saida.resolve("api-java.log"), api.getPort()) : null;
        if (apiLocal != null) apiLocal.encerrarSobras();
        if (System.getenv("AUTONICK_DEMO_ADMIN_URL") == null) BancoTemporario.encerrarSobras();
        Thread.sleep(500);
        if (ApiJavaLocal.portaAberta(porta)) sair("A porta " + porta + " já está em uso. Feche a demonstração anterior e tente de novo.");
        if (apiFilha && ApiJavaLocal.portaAberta(api.getPort())) sair("A porta " + api.getPort() + " já está em uso. Feche a demonstração anterior e tente de novo.");

        BancoTemporario temporario = null;
        BancoDemo banco;
        if (System.getenv("AUTONICK_DEMO_ADMIN_URL") == null) {
            System.out.println("[demo] iniciando o PostgreSQL temporário da demonstração (só 127.0.0.1; a primeira vez extrai os binários)...");
            try {
                temporario = BancoTemporario.iniciar();
            } catch (Exception erro) {
                sair("Não foi possível iniciar o PostgreSQL temporário: " + erro.getMessage() + dicaWindows());
            }
            System.out.println("[demo] PostgreSQL temporário na porta " + temporario.porta + " (pasta " + BancoTemporario.BASE + ").");
            banco = new BancoDemo(temporario.urlAdmin(), "postgres", temporario.senha);
        } else {
            banco = new BancoDemo(System.getenv("AUTONICK_DEMO_ADMIN_URL"), env("AUTONICK_DEMO_ADMIN_USUARIO", "postgres"),
                    env("AUTONICK_DEMO_ADMIN_SENHA", ""));
        }
        BancoTemporario paraFechar = temporario;
        System.out.println("[demo] preparando o banco " + BancoDemo.BANCO + " com dados fictícios...");
        banco.preparar(raiz);
        ChavesDemo chaves = new ChavesDemo(origem + "/demo-auth");

        Files.createDirectories(saida);
        Files.writeString(saida.resolve("demo-api.properties"), String.join("\n",
                "# Gerado pela demonstração local. Só local; senha aleatória do papel de demonstração, recriada a cada início.",
                "server.address=127.0.0.1",
                "server.port=" + api.getPort(),
                "spring.datasource.url=" + banco.urlParaApi(),
                "spring.datasource.username=" + BancoDemo.PAPEL_API,
                "spring.datasource.password=" + banco.senhaApi,
                "autonick.auth.jwks-uri=" + origem + "/demo-auth/.well-known/jwks.json",
                "autonick.auth.emissor=" + chaves.emissor(), ""));
        escreverIds(saida, banco);

        DemoPwaLocal demo = new DemoPwaLocal(raiz, saida, chaves, banco, api, apiLocal, porta);
        HttpServer servidor = HttpServer.create(new InetSocketAddress("127.0.0.1", porta), 0);
        servidor.createContext("/", demo::atender);
        servidor.setExecutor(Executors.newFixedThreadPool(16));
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("[demo] encerrando a API Java, o servidor e o PostgreSQL temporário...");
            if (apiLocal != null) apiLocal.desligar();
            servidor.stop(0);
            if (paraFechar != null) {
                try {
                    paraFechar.close();
                } catch (Exception erro) {
                    System.err.println("[demo] falha ao parar o PostgreSQL temporário: " + erro.getMessage());
                }
            }
        }, "encerrar-demo"));
        servidor.start();

        if (apiLocal != null) {
            System.out.println("[demo] iniciando a API Java (a primeira vez o Maven baixa as dependências; saída em "
                    + apiLocal.log() + ")...");
            apiLocal.ligar();
            if (!apiLocal.esperarPronta(900)) sair("A API Java não subiu. Veja " + apiLocal.log());
        }
        System.out.println("[demo] pronto: " + origem + "/demo/   (Ctrl+C ou fechar esta janela encerra tudo)");
        if (!"0".equals(env("AUTONICK_DEMO_ABRIR_NAVEGADOR", "1"))) abrirNavegador(origem + "/demo/");
    }

    /** Ids fictícios do cenário, para a verificação automática (target/demo-ids.json). */
    private static void escreverIds(Path saida, BancoDemo banco) throws IOException {
        Map<String, String> ids = new java.util.LinkedHashMap<>();
        ids.put("empresaA", banco.empresaA);
        ids.put("empresaB", banco.empresaB);
        ids.put("osCliente", banco.osCliente);
        ids.put("osClienteOutraEmpresa", banco.osClienteOutraEmpresa);
        ids.put("osOutroCliente", banco.osOutroCliente);
        ids.put("osOutraEmpresa", banco.osOutraEmpresa);
        ids.put("osIniciar", banco.osIniciar);
        ids.put("osVersao", banco.osVersao);
        ids.put("osSemJava", banco.osSemJava);
        ids.put("osConfirmar", banco.osConfirmar);
        ids.put("osRevisao", banco.osRevisao);
        ids.put("osVersaoCliente", banco.osVersaoCliente);
        ids.put("osInterna", banco.osInterna);
        ids.put("osInternaSemJava", banco.osInternaSemJava);
        ids.put("osCiclo", banco.osCiclo);
        ids.put("osMateriais", banco.osMateriais);
        ids.put("osMateriais2", banco.osMateriais2);
        ids.put("variacaoChuveiro", banco.variacaoChuveiro);
        ids.put("variacaoResistencia", banco.variacaoResistencia);
        ids.put("variacaoDisjuntor", banco.variacaoDisjuntor);
        ids.put("usoPendente", banco.usoPendente);
        ids.put("gestor", Pessoas.GESTOR.id());
        ids.put("notaInterna", BancoDemo.NOTA_INTERNA);
        ids.put("atualizacaoPublica", BancoDemo.ATUALIZACAO_PUBLICA);
        Files.writeString(saida.resolve("demo-ids.json"), BancoDemo.json(ids));
    }

    /** J05: "Iniciar" muda a OS de vez; este botão recria o banco fictício para a demonstração começar de novo. */
    private void recriar(HttpExchange troca) throws Exception {
        if (!"POST".equals(troca.getRequestMethod())) {
            Http.json(troca, 405, "{}");
            return;
        }
        synchronized (this) {
            System.out.println("[demo] recriando os dados fictícios...");
            banco.preparar(raiz);
            escreverIds(saida, banco);
            System.out.println("[demo] dados fictícios recriados.");
        }
        troca.getResponseHeaders().set("Location", "/demo/");
        Http.texto(troca, 303, "text/plain; charset=utf-8", "");
    }

    private static void sair(String mensagem) {
        System.err.println("[demo] " + mensagem);
        System.exit(1);
    }

    private static String dicaWindows() {
        return System.getProperty("os.name", "").startsWith("Windows")
                ? " (no Windows, o PostgreSQL precisa do Microsoft Visual C++ 2015-2022 Redistributable x64; o demo-j03.cmd já acrescenta a pasta bin do JDK ao PATH, que costuma trazer essas DLLs)"
                : "";
    }

    private static void abrirNavegador(String endereco) {
        try {
            if (System.getProperty("os.name", "").startsWith("Windows")) {
                new ProcessBuilder("rundll32", "url.dll,FileProtocolHandler", endereco).start();
            } else if (java.awt.Desktop.isDesktopSupported() && java.awt.Desktop.getDesktop().isSupported(java.awt.Desktop.Action.BROWSE)) {
                java.awt.Desktop.getDesktop().browse(URI.create(endereco));
            }
        } catch (Exception | Error ignorada) {
            // Sem navegador disponível: o endereço já foi mostrado no terminal.
        }
    }

    private static String env(String nome, String padrao) {
        String v = System.getenv(nome);
        return v == null || v.isBlank() ? padrao : v;
    }

    private void atender(HttpExchange troca) throws IOException {
        try {
            String caminho = troca.getRequestURI().getRawPath();
            // Só nomes locais (evita outro site apontar um domínio para 127.0.0.1) e, em POST, só a própria origem.
            if (!hostsAceitos.contains(String.valueOf(troca.getRequestHeaders().getFirst("Host")))) {
                Http.texto(troca, 421, "text/plain; charset=utf-8", "Use " + origem);
                return;
            }
            if (!"GET".equals(troca.getRequestMethod()) && !mesmaOrigem(troca)) {
                Http.json(troca, 403, "{\"message\":\"Origem não permitida.\"}");
                return;
            }
            if (caminho.equals("/demo") || caminho.equals("/demo/")) paginaDemo(troca);
            else if (caminho.equals("/demo/entrar")) entrar(troca);
            else if (caminho.equals("/demo/api-java")) controlarApi(troca);
            else if (caminho.equals("/demo/recriar")) recriar(troca);
            else if (caminho.startsWith("/demo-auth/")) auth(troca, caminho.substring("/demo-auth".length()));
            else if (caminho.startsWith("/demo-dados/")) dados.atender(troca, caminho.substring("/demo-dados".length()));
            else if (caminho.startsWith("/api-java/")) encaminhar(troca, caminho.substring("/api-java".length()));
            else if (caminho.equals("/js/config/public-config.js")) configuracao(troca);
            else estatico(troca, caminho);
        } catch (Exception erro) {
            System.err.println("[demo] falha: " + erro);
            try {
                Http.json(troca, 500, "{\"message\":\"Falha no servidor da demonstração.\"}");
            } catch (IOException ignorada) {
                troca.close();
            }
        }
    }

    /** Pedido que altera algo só vale da própria página: Sec-Fetch-Site do navegador e, se houver, Origin igual. */
    private boolean mesmaOrigem(HttpExchange troca) {
        String site = troca.getRequestHeaders().getFirst("Sec-Fetch-Site");
        if (site != null && !site.equals("same-origin") && !site.equals("none")) return false;
        String o = troca.getRequestHeaders().getFirst("Origin");
        // "null" é o que o navegador envia em formulário com Referrer-Policy: no-referrer (aceito só com same-origin acima).
        return o == null || (o.equals("null") && site != null) || o.equals(origem) || o.equals(origem.replace("127.0.0.1", "localhost"));
    }

    // ------------------------------------------------------------------------------------------------ página /demo/

    private void paginaDemo(HttpExchange troca) throws IOException {
        StringBuilder h = new StringBuilder("<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Demonstração local J03</title>"
                + "<link rel=\"stylesheet\" href=\"/css/tokens.css\"><link rel=\"stylesheet\" href=\"/css/reset.css\">"
                + "<link rel=\"stylesheet\" href=\"/css/base.css\"><link rel=\"stylesheet\" href=\"/css/componentes.css\"><link rel=\"stylesheet\" href=\"/css/forja.css\"></head>"
                + "<body><main class=\"conteudo pilha\" style-free><h1>Demonstração local J03</h1>"
                + "<p class=\"faixa-demo\"><strong>DEMONSTRAÇÃO LOCAL</strong>: dados fictícios, banco PostgreSQL local descartável. "
                + "As listas e o detalhe das ordens de serviço vêm da API Java (J01 e J02); sessão, permissões e conversa são simuladas só aqui.</p>");
        h.append("<section class=\"cartao pilha\"><h2>Entrar como pessoa fictícia</h2>");
        botao(h, "cliente", "/cliente/ordens.html", "Entrar como Cliente Demo e ver Meus serviços");
        botao(h, "gestor", "/business/ordens.html?id=" + banco.empresaA, "Entrar como Gestor Demo e ver as Ordens de serviço da Elétrica Demo");
        botao(h, "tecnico", "/business/ordens.html?id=" + banco.empresaA, "Entrar como Técnico Demo (vê as OS, não pode iniciar)");
        botao(h, "cliente-quatro", "/cliente/ordens.html", "Entrar como Cliente Quatro (OS já concluídas, para confirmar ou pedir revisão)");
        h.append("<p>Na OS de um cliente fictício, o Gestor pode usar <strong>Iniciar</strong> (J05), <strong>Pausar</strong> e "
                + "<strong>Retomar</strong> (J06) e <strong>Informar conclusão</strong> (J07): só essas ações da empresa gravam, pela API Java. "
                + "O motivo da pausa fica só para a equipe. A conclusão cria a conta a receber do saldo, sem recebimento. "
                + "No J08, o Cliente responde à conclusão: <strong>Confirmar que recebi o serviço</strong> encerra a OS sem "
                + "registrar pagamento, e <strong>Pedir revisão</strong> mantém a OS concluída e impede a empresa de encerrar. "
                + "A Cliente Quatro já tem três OS concluídas; a OS do Cliente Demo fica pronta depois que o Gestor a concluir. "
                + "No J09, a empresa responde: <strong>Reabrir para revisão</strong> (o motivo fica visível para o cliente) e "
                + "<strong>Encerrar</strong>, só quando a regra permite: OS concluída, sem revisão pendente e, se veio da "
                + "plataforma, 7 dias depois da conclusão. As duas OS internas do \"Seu Lauro do balcão\" já estão concluídas e "
                + "podem ser encerradas agora; o encerramento pela empresa não registra pagamento. "
                + "No J10, o acompanhamento: na linha do tempo, <strong>Registrar</strong> uma atualização (marcando \"O cliente "
                + "pode ver\") ou uma <strong>nota interna</strong> (sem marcar: só a equipe vê); <strong>Salvar dados</strong> "
                + "(responsável e previsão; o cliente vê a previsão) e <strong>Registrar garantia</strong> na OS concluída, antes do "
                + "encerramento (as OS internas nº 6 e 7 já estão concluídas; prazo e condições ficam visíveis ao cliente). "
                + "No J11, os materiais: <strong>Registrar</strong> material previsto ou usado, <strong>Reservar</strong> ou desfazer a "
                + "reserva, <strong>Confirmar e baixar</strong> ou recusar um uso pendente e <strong>Devolver</strong> ao estoque. As OS "
                + "internas nº 9 e 10 estão em execução; a nº 9 tem 3 chuveiros previstos e 1 uso pendente registrado pelo auxiliar; a "
                + "resistência tem uma única unidade e o disjuntor está esgotado. Reservar não baixa o estoque físico; usar baixa; devolver volta. "
                + "As demais ações continuam bloqueadas na demonstração (cancelar, próxima execução, sinal, agenda etc.).</p>");
        h.append("</section><section class=\"cartao pilha\"><h2>Casos de isolamento (abra depois de entrar)</h2><ul class=\"pilha\">");
        link(h, "/cliente/ordens.html?os=" + banco.osOutroCliente, "Cliente: OS de outro cliente (deve dizer que não foi encontrada)");
        link(h, "/cliente/ordens.html?os=00000000-0000-4000-8000-000000000000", "Cliente: OS inexistente (mesma mensagem)");
        link(h, "/business/ordem.html?id=" + banco.empresaA + "&os=" + banco.osOutraEmpresa, "Gestor: OS de outra empresa (deve dizer que não foi encontrada)");
        link(h, "/business/ordem.html?id=" + banco.empresaA + "&os=00000000-0000-4000-8000-000000000000", "Gestor: OS inexistente (mesma mensagem)");
        h.append("</ul></section>");
        if (apiLocal != null) {
            boolean ligada = apiLocal.ligada();
            h.append("<section class=\"cartao pilha\"><h2>API Java do J02</h2><p id=\"estado-api\">")
                    .append(ligada ? "Ligada (127.0.0.1:" + api.getPort() + ")." : "Desligada: o detalhe da OS vai mostrar que a consulta falhou.")
                    .append("</p><form method=\"post\" action=\"/demo/api-java\"><input type=\"hidden\" name=\"acao\" value=\"")
                    .append(ligada ? "desligar" : "ligar").append("\"><button class=\"botao botao--secundario\" type=\"submit\">")
                    .append(ligada ? "Desligar a API Java (para ver a falha)" : "Ligar a API Java de novo").append("</button></form></section>");
        }
        h.append("<form method=\"post\" action=\"/demo/entrar\"><input type=\"hidden\" name=\"pessoa\" value=\"\">"
                + "<button class=\"botao botao--secundario\" type=\"submit\">Sair da pessoa fictícia</button></form>"
                + "<form method=\"post\" action=\"/demo/recriar\"><button class=\"botao botao--secundario\" type=\"submit\">"
                + "Recriar os dados fictícios (volta as OS para o início)</button></form></main></body></html>");
        Http.texto(troca, 200, "text/html; charset=utf-8", h.toString().replace(" style-free", ""));
    }

    private static void botao(StringBuilder h, String pessoa, String destino, String rotulo) {
        h.append("<form method=\"post\" action=\"/demo/entrar\"><input type=\"hidden\" name=\"pessoa\" value=\"").append(pessoa)
                .append("\"><input type=\"hidden\" name=\"destino\" value=\"").append(Http.escapar(destino))
                .append("\"><button class=\"botao\" type=\"submit\">").append(Http.escapar(rotulo)).append("</button></form>");
    }

    private static void link(StringBuilder h, String href, String rotulo) {
        h.append("<li><a href=\"").append(Http.escapar(href)).append("\">").append(Http.escapar(rotulo)).append("</a></li>");
    }

    private void entrar(HttpExchange troca) throws IOException {
        if (!"POST".equals(troca.getRequestMethod())) {
            Http.json(troca, 405, "{}");
            return;
        }
        Map<String, String> f = Http.consulta(DadosSimulados.lerCorpo(troca));
        String pessoa = f.getOrDefault("pessoa", "");
        String destino = f.getOrDefault("destino", "/demo/");
        if (!destino.startsWith("/") || destino.startsWith("//")) destino = "/demo/";
        if (Pessoas.PODEM_ENTRAR.containsKey(pessoa)) {
            troca.getResponseHeaders().add("Set-Cookie", COOKIE + "=" + pessoa + "; Path=/; HttpOnly; SameSite=Strict");
        } else {
            troca.getResponseHeaders().add("Set-Cookie", COOKIE + "=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");
            destino = "/demo/";
        }
        troca.getResponseHeaders().set("Location", destino);
        Http.texto(troca, 303, "text/plain; charset=utf-8", "");
    }

    private void controlarApi(HttpExchange troca) throws Exception {
        if (!"POST".equals(troca.getRequestMethod()) || apiLocal == null) {
            Http.json(troca, 405, "{}");
            return;
        }
        String acao = Http.consulta(DadosSimulados.lerCorpo(troca)).getOrDefault("acao", "");
        if (acao.equals("desligar")) {
            apiLocal.desligar();
            System.out.println("[demo] API Java desligada pela página /demo/.");
        } else if (acao.equals("ligar")) {
            apiLocal.ligar();
            boolean ok = apiLocal.esperarPronta(300);
            System.out.println(ok ? "[demo] API Java ligada de novo." : "[demo] A API Java não subiu; veja " + apiLocal.log());
        }
        troca.getResponseHeaders().set("Location", "/demo/");
        Http.texto(troca, 303, "text/plain; charset=utf-8", "");
    }

    // ------------------------------------------------------------------------------------------------ sessão simulada

    private void auth(HttpExchange troca, String caminho) throws Exception {
        if (caminho.equals("/.well-known/jwks.json")) {
            Http.json(troca, 200, chaves.jwks());
            return;
        }
        if (caminho.equals("/get-session")) {
            Pessoas.Pessoa p = Pessoas.PODEM_ENTRAR.get(String.valueOf(Http.cookie(troca, COOKIE)));
            if (p == null) {
                Http.json(troca, 200, "null");
                return;
            }
            troca.getResponseHeaders().set("set-auth-jwt", chaves.emitir(p));
            troca.getResponseHeaders().set("Access-Control-Expose-Headers", "set-auth-jwt");
            Http.json(troca, 200, BancoDemo.json(Map.of("user", Map.of("id", p.id(), "name", p.nome(), "email", p.email(), "emailVerified", true),
                    "session", Map.of("id", "demo-" + p.tipo(), "userId", p.id()))));
            return;
        }
        if (caminho.equals("/sign-out")) {
            troca.getResponseHeaders().add("Set-Cookie", COOKIE + "=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");
            Http.json(troca, 200, "{\"success\":true}");
            return;
        }
        Http.json(troca, 403, "{\"message\":\"Na demonstração local, entre pela página /demo/.\"}");
    }

    private void configuracao(HttpExchange troca) throws IOException {
        Http.texto(troca, 200, "text/javascript; charset=utf-8", "/** Configuração da DEMONSTRAÇÃO LOCAL J03 (servida só por java/demo-pwa-local). */\n"
                + "export const CONFIG_PUBLICA = Object.freeze({ ambiente: 'demo-java-local', neonAuthUrl: '/demo-auth', "
                + "neonDataApiUrl: '/demo-dados', demoApiJava: '/api-java' });\n");
    }

    // ------------------------------------------------------------------------------------------------ API Java

    /**
     * ADR-J02: as únicas escritas encaminhadas são, da empresa, iniciar (J05), pausar e retomar (J06), informar a
     * conclusão (J07), reabrir para revisão e encerrar (J09), publicar atualização, atualizar dados e registrar garantia (J10),
     * as cinco operações de material (J11) e, do Cliente, confirmar o recebimento e pedir revisão (J08).
     */
    static final java.util.regex.Pattern INICIAR = java.util.regex.Pattern.compile(
            "^/(business/ordens-servico/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/(iniciar|pausar|retomar|concluir|reabrir|encerrar|publicar-atualizacao|atualizar-dados|registrar-garantia"
            + "|materiais|usos-material|(materiais/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/(reserva|devolucao))"
            + "|(usos-material/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/decisao))"
            + "|cliente/ordens-servico/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/(confirmar-recebimento|pedir-revisao))$");

    /** O pedido de revisão tem até 1.000 caracteres, que no JSON podem ocupar até 6 bytes cada. */
    private static final int CORPO_MAXIMO = 8192;

    private void encaminhar(HttpExchange troca, String resto) throws IOException {
        String metodo = troca.getRequestMethod();
        boolean iniciar = "POST".equals(metodo) && INICIAR.matcher(resto).matches();
        if (!"GET".equals(metodo) && !iniciar) {
            Http.json(troca, 405, "{\"codigo\":\"METODO\",\"mensagem\":\"Na demonstração, só iniciar, pausar, retomar, informar a conclusão, reabrir, encerrar, publicar atualização, atualizar dados, registrar garantia e as operações de material da OS e, do Cliente, confirmar o recebimento e pedir revisão gravam pela API Java.\"}");
            return;
        }
        String consulta = troca.getRequestURI().getRawQuery();
        URI destino = api.resolve("/api" + resto + (consulta == null || iniciar ? "" : "?" + consulta));
        HttpRequest.Builder pedido = HttpRequest.newBuilder(destino).timeout(Duration.ofSeconds(10));
        if (iniciar) {
            String tipo = String.valueOf(troca.getRequestHeaders().getFirst("Content-Type"));
            byte[] corpo = troca.getRequestBody().readNBytes(CORPO_MAXIMO + 1);
            if (!tipo.toLowerCase(Locale.ROOT).startsWith("application/json") || corpo.length > CORPO_MAXIMO) {
                Http.json(troca, 400, "{\"codigo\":\"VALIDATION_ERROR\",\"mensagem\":\"Envie um objeto JSON com os campos da ação.\"}");
                return;
            }
            pedido.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofByteArray(corpo));
        } else {
            pedido.GET();
        }
        String autorizacao = troca.getRequestHeaders().getFirst("Authorization");
        if (autorizacao != null) pedido.header("Authorization", autorizacao);
        pedido.header("Accept", "application/json");
        try {
            HttpResponse<byte[]> r = http.send(pedido.build(), HttpResponse.BodyHandlers.ofByteArray());
            Http.enviar(troca, r.statusCode(), r.headers().firstValue("Content-Type").orElse("application/json"), r.body());
        } catch (ConnectException | HttpTimeoutException erro) {
            Http.json(troca, 502, "{\"codigo\":\"API_JAVA_INDISPONIVEL\",\"mensagem\":\"A API Java local não respondeu.\"}");
        } catch (InterruptedException erro) {
            Thread.currentThread().interrupt();
            Http.json(troca, 502, "{\"codigo\":\"API_JAVA_INDISPONIVEL\",\"mensagem\":\"A API Java local não respondeu.\"}");
        }
    }

    // ------------------------------------------------------------------------------------------------ arquivos da PWA

    private void estatico(HttpExchange troca, String caminho) throws IOException {
        String limpo = java.net.URLDecoder.decode(caminho, StandardCharsets.UTF_8);
        if (limpo.endsWith("/")) limpo += "index.html";
        Path arquivo = pwa.resolve(limpo.substring(1)).normalize();
        if (!arquivo.startsWith(pwa) || !Files.isRegularFile(arquivo)) {
            Http.texto(troca, 404, "text/plain; charset=utf-8", "Não encontrado");
            return;
        }
        String nome = arquivo.getFileName().toString();
        String ext = nome.contains(".") ? nome.substring(nome.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
        troca.getResponseHeaders().set("Cache-Control", "no-cache");
        Http.enviar(troca, 200, TIPOS.getOrDefault(ext, "application/octet-stream"), Files.readAllBytes(arquivo));
    }
}
