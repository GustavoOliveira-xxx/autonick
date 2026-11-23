package br.com.ckgroup.autonick.demo;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * INSTALAÇÃO do banco da DEMONSTRAÇÃO PÚBLICA (ação remota: só com autorização do responsável). Banco exclusivo
 * {@value #BANCO} num projeto PostgreSQL próprio da demonstração (por exemplo um projeto Neon Free novo), nunca o
 * branch de desenvolvimento, a prévia protegida nem production.
 *
 * <pre>
 *   AUTONICK_PUBLICO_ADMIN_URL=jdbc:postgresql://HOST/neondb?sslmode=require
 *   AUTONICK_PUBLICO_ADMIN_USUARIO=...   AUTONICK_PUBLICO_ADMIN_SENHA=...
 *   mvnw -q compile exec:java -Dautonick.main=br.com.ckgroup.autonick.demo.InstalarBancoPublico [-Dexec.args=--restaurar]
 * </pre>
 *
 * Cria (ou atualiza) o banco, aplica a emulação do Neon, as migrations e o schema demo_auth com a configuração pública
 * (sem CK), e cria o papel {@value #PAPEL} com senha nova. A senha NÃO é impressa: vai para um arquivo só do usuário,
 * com as variáveis a cadastrar na hospedagem da API. {@code --restaurar} apaga e recria o banco (restauração
 * controlada dos cenários).
 */
public final class InstalarBancoPublico {

    static final String BANCO = "autonick_demo_publica";
    static final String PAPEL = "autonick_api_publica";
    private static final Pattern URL = Pattern.compile("^jdbc:postgresql://([^/:?]+)(:\\d+)?/([^?]+)(\\?.*)?$");

    private InstalarBancoPublico() {
    }

    public static void main(String[] args) throws Exception {
        boolean restaurar = List.of(args).contains("--restaurar");
        Path raiz = Path.of(System.getProperty("autonick.raiz", "../..")).toAbsolutePath().normalize();
        String url = exigir("AUTONICK_PUBLICO_ADMIN_URL");
        String usuario = exigir("AUTONICK_PUBLICO_ADMIN_USUARIO");
        String senha = exigir("AUTONICK_PUBLICO_ADMIN_SENHA");
        Matcher m = URL.matcher(url);
        if (!m.matches()) throw new IllegalArgumentException("URL JDBC inesperada.");
        String host = m.group(1).toLowerCase(Locale.ROOT);
        Path arquivoAmbientes = raiz.resolve("config/ambientes.json");
        String ambientes = Files.isRegularFile(arquivoAmbientes) ? Files.readString(arquivoAmbientes) : "";
        String endpoint = host.split("\\.")[0].replace("-pooler", "");
        if (!ambientes.isEmpty() && ambientes.contains(endpoint)) {
            throw new IllegalStateException("Este endereço é de um ambiente já existente (desenvolvimento ou prévia). Use um projeto próprio da demonstração pública.");
        }
        String parametros = m.group(4) == null ? "" : m.group(4);
        if (!parametros.contains("sslmode=require") && !host.equals("localhost") && !host.equals("127.0.0.1")) {
            throw new IllegalArgumentException("Use sslmode=require na URL do banco remoto.");
        }
        String base = "jdbc:postgresql://" + m.group(1) + (m.group(2) == null ? "" : m.group(2)) + "/";
        boolean novo;
        try (Connection c = DriverManager.getConnection(url, usuario, senha); Statement s = c.createStatement()) {
            try (ResultSet r = s.executeQuery("SELECT 1 FROM pg_database WHERE datname = '" + BANCO + "'")) {
                novo = !r.next();
            }
            if (!novo && restaurar) {
                System.out.println("[autonick] restaurando: apagando o banco " + BANCO + "...");
                s.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '" + BANCO + "' AND pid <> pg_backend_pid()");
                s.execute("DROP DATABASE " + BANCO);
                novo = true;
            }
            if (novo) s.execute("CREATE DATABASE " + BANCO);
        }
        byte[] b = new byte[24];
        new SecureRandom().nextBytes(b);
        String senhaPapel = HexFormat.of().formatHex(b);
        try (Connection c = DriverManager.getConnection(base + BANCO + parametros, usuario, senha)) {
            BancoPersistente.instalar(c, raiz, novo, PAPEL, senhaPapel, BANCO, false, true);
        }
        Path saida = Path.of(System.getProperty("user.home"), ".autonick", "demonstracao-publica-api.env");
        Files.createDirectories(saida.getParent());
        Files.writeString(saida, String.join("\n",
                "# Variáveis da API Java da demonstração pública (SEGREDO: cadastrar só na hospedagem da API e apagar este arquivo).",
                "AUTONICK_API_DB_URL=" + base + BANCO + parametros,
                "AUTONICK_API_DB_USUARIO=" + PAPEL,
                "AUTONICK_API_DB_SENHA=" + senhaPapel,
                "AUTONICK_BANCO_PERMITIR_REMOTO=true",
                "AUTONICK_DEMO_SEGREDO=" + HexFormat.of().formatHex(aleatorio(32)), ""));
        try {
            Files.setPosixFilePermissions(saida, java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException semPosix) {
            // Windows: o arquivo fica no perfil do próprio usuário.
        }
        System.out.println("[autonick] banco da demonstração pública " + (novo ? "criado" : "atualizado") + ". Variáveis da API em " + saida);
    }

    private static byte[] aleatorio(int n) {
        byte[] b = new byte[n];
        new SecureRandom().nextBytes(b);
        return b;
    }

    private static String exigir(String nome) {
        String v = System.getenv(nome);
        if (v == null || v.isBlank()) throw new IllegalArgumentException("Defina " + nome + ".");
        return v;
    }
}
