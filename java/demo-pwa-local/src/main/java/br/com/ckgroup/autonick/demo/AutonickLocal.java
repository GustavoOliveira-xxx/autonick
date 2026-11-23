package br.com.ckgroup.autonick.demo;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;

/**
 * DEMONSTRAÇÃO LOCAL COMPLETA do AutoniCK: PWA + API Java (Spring Boot) + PostgreSQL 18 portátil, só em 127.0.0.1.
 *
 * <pre>
 *   AutoniCK-local.cmd             abre (os dados ficam entre execuções)
 *   AutoniCK-local.cmd --restaurar apaga os dados da demonstração e volta ao cenário fictício inicial
 * </pre>
 *
 * Passos: sobe o PostgreSQL (pasta da demonstração), garante o banco e as migrations, gera a configuração da API (senha
 * nova do papel da API a cada início), sobe a API Java como processo filho em 127.0.0.1:8080 (ela entrega a PWA, monta o
 * cenário fictício na primeira vez e atende tudo em /api) e abre o navegador. Ctrl+C ou fechar a janela encerra a API e
 * o PostgreSQL; os dados continuam na pasta.
 * Variáveis: AUTONICK_LOCAL_PORTA (8080), AUTONICK_LOCAL_PASTA, AUTONICK_DEMO_ABRIR_NAVEGADOR=0.
 */
public final class AutonickLocal {

    private AutonickLocal() {
    }

    public static void main(String[] args) throws Exception {
        List<String> opcoes = Arrays.asList(args);
        boolean restaurar = opcoes.contains("--restaurar");
        Path raiz = Path.of(System.getProperty("autonick.raiz", "../..")).toAbsolutePath().normalize();
        int porta = Integer.parseInt(env("AUTONICK_LOCAL_PORTA", "8080"));
        Path base = BancoPersistente.pastaBase();
        Files.createDirectories(base);
        Path log = base.resolve("api-java.log");
        ApiJavaLocal api = new ApiJavaLocal(raiz.resolve("java/os-api"), base.resolve("api.properties"), log, porta);
        api.encerrarSobras();
        if (ApiJavaLocal.portaAberta(porta)) sair("A porta " + porta + " já está em uso. Feche o outro programa (ou uma demonstração aberta) e tente de novo.");

        System.out.println("[autonick] pasta da demonstração: " + base);
        System.out.println("[autonick] iniciando o PostgreSQL portátil (na primeira vez os binários são extraídos)...");
        BancoPersistente banco;
        try {
            banco = BancoPersistente.iniciar(base);
        } catch (Exception erro) {
            sair("Não foi possível iniciar o PostgreSQL portátil: " + erro.getMessage()
                    + (System.getProperty("os.name", "").startsWith("Windows")
                    ? " Se faltar VCRUNTIME140.dll, instale o Visual C++ Redistributable (x64) da Microsoft." : ""));
            return;
        }
        if (restaurar) System.out.println("[autonick] restaurando o cenário fictício inicial (os dados da demonstração serão apagados)...");
        boolean novo = banco.preparar(raiz, restaurar);
        System.out.println(novo ? "[autonick] banco da demonstração criado." : "[autonick] banco da demonstração existente preservado.");

        Files.writeString(base.resolve("api.properties"), String.join("\n",
                "# Gerado a cada início da demonstração local. Só 127.0.0.1; senha aleatória do papel da API.",
                "server.address=127.0.0.1",
                "server.port=" + porta,
                "spring.datasource.url=" + banco.urlBanco(),
                "spring.datasource.username=" + BancoPersistente.PAPEL_API,
                "spring.datasource.password=" + banco.senhaApi,
                "autonick.auth.modo=demo",
                "autonick.auth.cadastro-aberto=true",
                "autonick.demo.montar-cenario=true",
                "autonick.pwa.pasta=" + valorDePropriedade(raiz.resolve("public").toString().replace('\\', '/')),
                "autonick.pwa.backend=java-local", ""));
        try {
            Files.setPosixFilePermissions(base.resolve("api.properties"), java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException semPosix) {
            // Windows: arquivo no perfil do próprio usuário.
        }

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("[autonick] encerrando a API Java e o PostgreSQL (os dados ficam guardados)...");
            api.desligar();
            try {
                banco.close();
            } catch (Exception erro) {
                System.err.println("[autonick] falha ao parar o PostgreSQL: " + erro.getMessage());
            }
        }, "encerrar-autonick"));

        System.out.println("[autonick] iniciando a API Java (a primeira vez o Maven baixa as dependências; saída em " + log + ")...");
        api.ligar();
        if (!api.esperarPronta(900)) sair("A API Java não subiu. Veja " + log);
        String endereco = "http://127.0.0.1:" + porta + "/";
        System.out.println();
        System.out.println("[autonick] PRONTO: " + endereco);
        System.out.println("[autonick] Entre em Cliente ou Business e escolha uma pessoa fictícia (senha das contas: "
                + "demo1234). Ctrl+C ou fechar esta janela encerra.");
        if (!"0".equals(env("AUTONICK_DEMO_ABRIR_NAVEGADOR", "1"))) abrir(endereco);
        Thread.currentThread().join();
    }

    /**
     * O Spring Boot lê arquivos .properties como ISO-8859-1: caracteres fora do ASCII (por exemplo, uma pasta "Área de
     * Trabalho") vão como escapes Unicode, no formato padrão de .properties, para o caminho chegar intacto à API.
     */
    static String valorDePropriedade(String valor) {
        StringBuilder s = new StringBuilder(valor.length());
        for (char c : valor.toCharArray()) {
            if (c == '\\') s.append("\\\\");
            else if (c < 0x20 || c > 0x7e) s.append(String.format("\\u%04x", (int) c));
            else s.append(c);
        }
        return s.toString();
    }

    private static void abrir(String endereco) {
        try {
            String so = System.getProperty("os.name", "").toLowerCase();
            ProcessBuilder pb = so.startsWith("windows") ? new ProcessBuilder("rundll32", "url.dll,FileProtocolHandler", endereco)
                    : so.contains("mac") ? new ProcessBuilder("open", endereco) : new ProcessBuilder("xdg-open", endereco);
            pb.redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
        } catch (Exception erro) {
            System.out.println("[autonick] abra no navegador: " + endereco);
        }
    }

    private static String env(String nome, String padrao) {
        String v = System.getenv(nome);
        return v == null || v.isBlank() ? padrao : v;
    }

    private static void sair(String mensagem) {
        System.err.println("[autonick] " + mensagem);
        System.exit(1);
    }
}
