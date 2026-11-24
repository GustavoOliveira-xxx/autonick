import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * Servidor local do AutoniCK Design Lab. Só escuta em 127.0.0.1 e só lê arquivos.
 *
 * Uso (na raiz do repositório):  java design-lab/Servidor.java  [porta]
 * Padrão: http://127.0.0.1:8091/
 *
 * /public/...  → pasta public/ do app (Three.js, modelo do sino, fontes, logos e o módulo da animação atual)
 * /...         → pasta design-lab/
 * Não usa banco, não chama a API, não altera arquivos. Arquivo de código-fonte único: roda direto no JDK 21.
 */
public class Servidor {
    private static final Map<String, String> TIPOS = Map.ofEntries(
            Map.entry("html", "text/html; charset=utf-8"), Map.entry("js", "text/javascript; charset=utf-8"),
            Map.entry("mjs", "text/javascript; charset=utf-8"), Map.entry("css", "text/css; charset=utf-8"),
            Map.entry("json", "application/json; charset=utf-8"), Map.entry("glb", "model/gltf-binary"),
            Map.entry("webp", "image/webp"), Map.entry("png", "image/png"), Map.entry("svg", "image/svg+xml"),
            Map.entry("woff2", "font/woff2"), Map.entry("txt", "text/plain; charset=utf-8"), Map.entry("md", "text/plain; charset=utf-8"));

    public static void main(String[] args) throws IOException {
        Path pastaLab = localizarLab();
        Path raizRepo = pastaLab.getParent();
        Path pastaPublic = raizRepo.resolve("public");
        int porta = args.length > 0 ? Integer.parseInt(args[0]) : 8091;
        HttpServer servidor = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), porta), 0);
        servidor.createContext("/", troca -> atender(troca, pastaLab, pastaPublic));
        servidor.start();
        System.out.println("AutoniCK Design Lab em http://127.0.0.1:" + porta + "/  (Ctrl+C para encerrar)");
    }

    private static Path localizarLab() {
        for (Path p : new Path[] { Path.of("design-lab"), Path.of(".") }) {
            Path abs = p.toAbsolutePath().normalize();
            if (Files.exists(abs.resolve("index.html")) && Files.exists(abs.resolve("Servidor.java"))) return abs;
        }
        throw new IllegalStateException("Rode a partir da raiz do repositório: java design-lab/Servidor.java");
    }

    private static void atender(HttpExchange troca, Path pastaLab, Path pastaPublic) throws IOException {
        try (troca) {
            if (!"GET".equals(troca.getRequestMethod()) && !"HEAD".equals(troca.getRequestMethod())) { responder(troca, 405, "text/plain", "Somente leitura".getBytes()); return; }
            String caminho = URLDecoder.decode(troca.getRequestURI().getPath(), StandardCharsets.UTF_8);
            Path base = pastaLab; String resto = caminho;
            if (caminho.startsWith("/public/")) { base = pastaPublic; resto = caminho.substring("/public".length()); }
            if (resto.endsWith("/")) resto += "index.html";
            Path alvo = base.resolve(resto.substring(1)).normalize();
            if (!alvo.startsWith(base) || !Files.isRegularFile(alvo)) { responder(troca, 404, "text/plain; charset=utf-8", "Não encontrado".getBytes(StandardCharsets.UTF_8)); return; }
            String nome = alvo.getFileName().toString(); String ext = nome.contains(".") ? nome.substring(nome.lastIndexOf('.') + 1).toLowerCase() : "";
            byte[] corpo = Files.readAllBytes(alvo);
            // a página é escrita no formato de artefato (sem doctype); aqui ganha o esqueleto mínimo
            if (base == pastaLab && nome.endsWith(".html") && !new String(corpo, 0, Math.min(corpo.length, 15), StandardCharsets.UTF_8).toLowerCase().startsWith("<!doctype")) {
                String pagina = "<!doctype html>\n<html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
                        + new String(corpo, StandardCharsets.UTF_8) + "\n</html>";
                corpo = pagina.getBytes(StandardCharsets.UTF_8);
            }
            troca.getResponseHeaders().add("Cache-Control", "no-cache");
            responder(troca, 200, TIPOS.getOrDefault(ext, "application/octet-stream"), corpo);
        }
    }

    private static void responder(HttpExchange troca, int status, String tipo, byte[] corpo) throws IOException {
        troca.getResponseHeaders().set("Content-Type", tipo);
        troca.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        boolean head = "HEAD".equals(troca.getRequestMethod());
        troca.sendResponseHeaders(status, head ? -1 : corpo.length);
        if (!head) try (OutputStream s = troca.getResponseBody()) { s.write(corpo); }
    }
}
