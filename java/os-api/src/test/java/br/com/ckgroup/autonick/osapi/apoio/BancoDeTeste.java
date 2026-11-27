package br.com.ckgroup.autonick.osapi.apoio;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Banco PostgreSQL LOCAL e descartável para os testes (ADR-J01, J-05 e J-06). Nunca o Neon.
 *
 * Origem, nesta ordem:
 *  1. AUTONICK_JAVA_DB_URL (JDBC de um PostgreSQL local, por exemplo jdbc:postgresql://localhost:5432/postgres), com
 *     AUTONICK_JAVA_DB_USUARIO (padrão postgres) e AUTONICK_JAVA_DB_SENHA; o usuário precisa poder criar banco e papel;
 *  2. Testcontainers com postgres:18, se houver Docker.
 * Sem nenhum dos dois, as classes que dependem do banco são puladas (não falham).
 *
 * Cria um banco novo (autonick_j01_...), aplica db/tests/emulacao-neon.sql e as 36 migrations, cria o papel da API
 * (LOGIN, NOINHERIT, membro de authenticated, sem outra permissão) e, no fim, apaga o banco e o papel.
 */
public final class BancoDeTeste {

    private static final Pattern URL_JDBC = Pattern.compile("^(jdbc:postgresql://[^/]+/)([^?]*)(.*)$");
    private static BancoDeTeste instancia;

    public final String origem;
    public final String urlBanco;
    public final String adminUsuario;
    public final String adminSenha;
    public final String apiUsuario;
    public final String apiSenha;
    private final String urlAdminServidor;
    private final String nomeBanco;
    private final PostgreSQLContainer<?> conteiner;
    private CenarioOs cenario;
    private RuntimeException falhaCenario;

    public static boolean disponivel() {
        return System.getenv("AUTONICK_JAVA_DB_URL") != null || dockerDisponivel();
    }

    private static boolean dockerDisponivel() {
        try {
            return DockerClientFactory.instance().isDockerAvailable();
        } catch (Throwable erro) {
            return false;
        }
    }

    public static synchronized BancoDeTeste instancia() {
        if (instancia == null) {
            try {
                instancia = new BancoDeTeste();
                Runtime.getRuntime().addShutdownHook(new Thread(instancia::encerrar));
            } catch (Exception erro) {
                throw new IllegalStateException("Não foi possível preparar o banco de teste: " + erro.getMessage(), erro);
            }
        }
        return instancia;
    }

    private BancoDeTeste() throws Exception {
        String sufixo = Long.toString(System.currentTimeMillis(), 36) + HexFormat.of().formatHex(aleatorio(3));
        nomeBanco = "autonick_j01_" + sufixo;
        apiUsuario = "autonick_api_j01_" + sufixo;
        apiSenha = HexFormat.of().formatHex(aleatorio(18));
        String env = System.getenv("AUTONICK_JAVA_DB_URL");
        if (env != null) {
            conteiner = null;
            urlAdminServidor = env;
            adminUsuario = valorOu(System.getenv("AUTONICK_JAVA_DB_USUARIO"), "postgres");
            adminSenha = valorOu(System.getenv("AUTONICK_JAVA_DB_SENHA"), "");
            origem = "PostgreSQL local (AUTONICK_JAVA_DB_URL)";
        } else {
            conteiner = new PostgreSQLContainer<>("postgres:18");
            conteiner.start();
            urlAdminServidor = conteiner.getJdbcUrl();
            adminUsuario = conteiner.getUsername();
            adminSenha = conteiner.getPassword();
            origem = "Testcontainers (postgres:18)";
        }
        if (urlAdminServidor.toLowerCase(Locale.ROOT).contains("neon.tech")) {
            throw new IllegalStateException("Os testes só usam PostgreSQL local (ADR-J01, J-05).");
        }
        urlBanco = trocarBanco(urlAdminServidor, nomeBanco);
        try (Connection c = DriverManager.getConnection(urlAdminServidor, adminUsuario, adminSenha); Statement s = c.createStatement()) {
            s.execute("CREATE DATABASE " + nomeBanco);
        }
        Path raiz = Path.of(System.getProperty("autonick.raiz", "../..")).toAbsolutePath().normalize();
        try (Connection c = admin(); Statement s = c.createStatement()) {
            s.execute(Files.readString(raiz.resolve("db/tests/emulacao-neon.sql")));
            for (Path migration : migrations(raiz)) s.execute(Files.readString(migration));
            s.execute("CREATE ROLE " + apiUsuario + " LOGIN NOINHERIT PASSWORD '" + apiSenha + "'");
            s.execute("GRANT authenticated TO " + apiUsuario);
            s.execute("GRANT CONNECT ON DATABASE " + nomeBanco + " TO " + apiUsuario);
            // Demonstração (camada de dados e entrada fictícia): mesmo banco, schema demo_auth à parte.
            s.execute(Files.readString(raiz.resolve("db/demo/demo_auth.sql")));
            s.execute(Files.readString(raiz.resolve("db/demo/concessoes_api.sql")).replace("__PAPEL_API__", apiUsuario)
                    .replace("__PERMITE_CK__", "true").replace("__PUBLICA__", "false"));
        }
    }

    /** Monta o cenário uma vez; se falhar, todos os testes seguintes mostram a MESMA falha original. */
    public synchronized CenarioOs cenario() {
        if (falhaCenario != null) throw falhaCenario;
        if (cenario == null) {
            try {
                cenario = CenarioOs.montar(this);
            } catch (SQLException erro) {
                falhaCenario = new IllegalStateException("Falha ao montar o cenário: " + erro.getMessage(), erro);
                throw falhaCenario;
            }
        }
        return cenario;
    }

    public Connection admin() throws SQLException {
        return DriverManager.getConnection(urlBanco, adminUsuario, adminSenha);
    }

    public Connection comoApi() throws SQLException {
        return DriverManager.getConnection(urlBanco, apiUsuario, apiSenha);
    }

    private static List<Path> migrations(Path raiz) throws Exception {
        try (Stream<Path> arquivos = Files.list(raiz.resolve("db/migrations_propostas"))) {
            List<Path> lista = arquivos
                    .filter(p -> p.getFileName().toString().matches("\\d{12}_.+\\.sql"))
                    .filter(p -> !p.getFileName().toString().endsWith(".down.sql"))
                    .sorted().toList();
            if (lista.size() != 36) throw new IllegalStateException("Esperadas 36 migrations, encontradas " + lista.size());
            return lista;
        }
    }

    private static String trocarBanco(String url, String banco) {
        Matcher m = URL_JDBC.matcher(url);
        if (!m.matches()) throw new IllegalArgumentException("URL JDBC inesperada: " + url);
        return m.group(1) + banco + m.group(3);
    }

    private static byte[] aleatorio(int n) {
        byte[] b = new byte[n];
        new SecureRandom().nextBytes(b);
        return b;
    }

    private static String valorOu(String valor, String padrao) {
        return valor == null || valor.isBlank() ? padrao : valor;
    }

    private void encerrar() {
        try (Connection c = DriverManager.getConnection(urlAdminServidor, adminUsuario, adminSenha); Statement s = c.createStatement()) {
            s.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '" + nomeBanco + "' AND pid <> pg_backend_pid()");
            s.execute("DROP DATABASE IF EXISTS " + nomeBanco);
            s.execute("DROP ROLE IF EXISTS " + apiUsuario);
        } catch (Exception erro) {
            System.err.println("Aviso: não foi possível apagar o banco de teste " + nomeBanco + ": " + erro.getMessage());
        } finally {
            if (conteiner != null) conteiner.stop();
        }
    }
}
