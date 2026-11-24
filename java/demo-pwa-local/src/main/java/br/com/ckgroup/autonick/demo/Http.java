package br.com.ckgroup.autonick.demo;

import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** Utilidades HTTP da demonstração. */
final class Http {

    /** Mesma política do servidor local da PWA, com conexões só para a própria origem. */
    static final String CSP = String.join("; ", "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:",
            "font-src 'self'", "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'", "object-src 'none'",
            "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'");

    private Http() {
    }

    static void enviar(HttpExchange troca, int status, String tipo, byte[] corpo) throws IOException {
        troca.getResponseHeaders().set("Content-Type", tipo);
        troca.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        troca.getResponseHeaders().set("Referrer-Policy", "no-referrer");
        troca.getResponseHeaders().set("Content-Security-Policy", CSP);
        if (!troca.getResponseHeaders().containsKey("Cache-Control")) troca.getResponseHeaders().set("Cache-Control", "no-store");
        boolean semCorpo = "HEAD".equals(troca.getRequestMethod()) || status == 204 || status == 304;
        troca.sendResponseHeaders(status, semCorpo ? -1 : corpo.length);
        if (!semCorpo) {
            try (OutputStream saida = troca.getResponseBody()) {
                saida.write(corpo);
            }
        }
        troca.close();
    }

    static void json(HttpExchange troca, int status, String json) throws IOException {
        enviar(troca, status, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8));
    }

    static void texto(HttpExchange troca, int status, String tipo, String corpo) throws IOException {
        enviar(troca, status, tipo, corpo.getBytes(StandardCharsets.UTF_8));
    }

    static Map<String, String> consulta(String bruta) {
        Map<String, String> mapa = new LinkedHashMap<>();
        if (bruta == null || bruta.isBlank()) return mapa;
        for (String par : bruta.split("&")) {
            int i = par.indexOf('=');
            String chave = URLDecoder.decode(i < 0 ? par : par.substring(0, i), StandardCharsets.UTF_8);
            String valor = i < 0 ? "" : URLDecoder.decode(par.substring(i + 1), StandardCharsets.UTF_8);
            mapa.put(chave, valor);
        }
        return mapa;
    }

    static String cookie(HttpExchange troca, String nome) {
        for (String linha : troca.getRequestHeaders().getOrDefault("Cookie", java.util.List.of())) {
            for (String parte : linha.split(";")) {
                String[] kv = parte.trim().split("=", 2);
                if (kv.length == 2 && kv[0].equals(nome)) return kv[1];
            }
        }
        return null;
    }

    static String escapar(String texto) {
        return texto.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
