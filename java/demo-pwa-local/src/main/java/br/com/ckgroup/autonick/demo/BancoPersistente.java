package br.com.ckgroup.autonick.demo;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.File;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

/**
 * PostgreSQL 18 PORTÁTIL e PERSISTENTE da demonstração local completa (binários do Maven Central; sem instalação,
 * sem serviço do Windows e sem usar bancos já instalados).
 *
 * <ul>
 *   <li>Pasta: {@code %LOCALAPPDATA%\AutoniCK\demonstracao-local} no Windows ou {@code ~/.autonick/demonstracao-local}
 *       nos outros sistemas (ou {@code AUTONICK_LOCAL_PASTA}). Binários em {@code binarios/}, dados em {@code dados/}.</li>
 *   <li>Os dados FICAM entre execuções. Só a opção explícita "restaurar" apaga o banco da demonstração e monta o
 *       cenário fictício inicial de novo.</li>
 *   <li>Só 127.0.0.1, porta livre escolhida a cada início, senha aleatória do superusuário gerada na primeira vez e
 *       guardada só nesta pasta; acesso por scram-sha-256 (sem modo "trust").</li>
 *   <li>Banco {@value #BANCO}: emulação local do Neon, migrations do app (cada uma aplicada uma vez, com registro),
 *       schema demo_auth e o papel da API (LOGIN, NOINHERIT; senha nova a cada início).</li>
 * </ul>
 */
final class BancoPersistente implements AutoCloseable {

    static final String BANCO = "autonick_demo";
    static final String PAPEL_API = "autonick_api_local";

    final Path base;
    private final EmbeddedPostgres pg;
    private final String senha;
    final int porta;
    final String senhaApi;

    private BancoPersistente(Path base, EmbeddedPostgres pg, String senha) {
        this.base = base;
        this.pg = pg;
        this.senha = senha;
        this.porta = pg.getPort();
        byte[] b = new byte[18];
        new SecureRandom().nextBytes(b);
        this.senhaApi = HexFormat.of().formatHex(b);
    }

    static Path pastaBase() {
        String definida = System.getenv("AUTONICK_LOCAL_PASTA");
        if (definida != null && !definida.isBlank()) return Path.of(definida).toAbsolutePath();
        String local = System.getenv("LOCALAPPDATA");
        if (local != null && !local.isBlank()) return Path.of(local, "AutoniCK", "demonstracao-local");
        return Path.of(System.getProperty("user.home"), ".autonick", "demonstracao-local");
    }

    static BancoPersistente iniciar(Path base) throws IOException {
        Path binarios = base.resolve("binarios");
        Path dados = base.resolve("dados");
        Files.createDirectories(binarios);
        Files.createDirectories(base.resolve("execucao"));
        pararSobra(binarios, dados);
        System.setProperty("ot.epg.working-dir", base.resolve("execucao").toString());
        String senha = senhaDoSuperusuario(base);
        boolean novo = !Files.isRegularFile(dados.resolve("PG_VERSION"));
        Path arquivoSenha = Files.createTempFile(base, "pw-", ".txt");
        try {
            Files.writeString(arquivoSenha, senha);
            EmbeddedPostgres.Builder b = EmbeddedPostgres.builder()
                    .setOverrideWorkingDirectory(binarios.toFile())
                    .setDataDirectory(dados)
                    .setCleanDataDirectory(false)
                    .setServerConfig("listen_addresses", "127.0.0.1")
                    .setServerConfig("unix_socket_directories", "")
                    .setConnectConfig("password", senha)
                    .setPGStartupWait(Duration.ofSeconds(90));
            if (novo) {
                b.setLocaleConfig("pwfile", arquivoSenha.toString())
                        .setLocaleConfig("locale", "C")
                        .setLocaleConfig("locale-provider", "builtin")
                        .setLocaleConfig("builtin-locale", "C.UTF-8")
                        .setDataDirectoryCustomizer(BancoPersistente::somenteScramLocal);
            }
            return new BancoPersistente(base, b.start(), senha);
        } finally {
            Files.deleteIfExists(arquivoSenha);
        }
    }

    /** Senha do superusuário: criada na primeira vez, guardada só na pasta da demonstração (sem acesso de outros usuários). */
    private static String senhaDoSuperusuario(Path base) throws IOException {
        Path arquivo = base.resolve("segredo-local.txt");
        if (Files.isRegularFile(arquivo)) return Files.readString(arquivo).trim();
        byte[] b = new byte[24];
        new SecureRandom().nextBytes(b);
        String senha = HexFormat.of().formatHex(b);
        Files.writeString(arquivo, senha);
        try {
            Files.setPosixFilePermissions(arquivo, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException semPosix) {
            // Windows: a pasta fica no perfil do próprio usuário (LOCALAPPDATA).
        }
        return senha;
    }

    /** Uma execução encerrada à força pode ter deixado o servidor ligado: para com pg_ctl antes de subir de novo. */
    private static void pararSobra(Path binarios, Path dados) {
        if (!Files.isRegularFile(dados.resolve("postmaster.pid"))) return;
        String nome = System.getProperty("os.name", "").startsWith("Windows") ? "pg_ctl.exe" : "pg_ctl";
        try (Stream<Path> lista = Files.list(binarios)) {
            Path pgCtl = lista.map(d -> d.resolve("bin").resolve(nome)).filter(Files::isRegularFile).findFirst().orElse(null);
            if (pgCtl == null) return;
            new ProcessBuilder(pgCtl.toString(), "-D", dados.toString(), "stop", "-m", "fast", "-w", "-t", "30")
                    .redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start().waitFor();
            System.out.println("[autonick] servidor de uma execução anterior encerrado.");
        } catch (Exception erro) {
            System.err.println("[autonick] não foi possível parar o servidor anterior: " + erro.getMessage());
        }
    }

    private static void somenteScramLocal(File dir) {
        try {
            Files.writeString(dir.toPath().resolve("pg_hba.conf"), String.join("\n",
                    "# Demonstração local do AutoniCK: só esta máquina, com senha.",
                    "host all all 127.0.0.1/32 scram-sha-256",
                    "host all all ::1/128 scram-sha-256", ""));
        } catch (IOException erro) {
            throw new UncheckedIOException(erro);
        }
    }

    String urlBanco() {
        return "jdbc:postgresql://127.0.0.1:" + porta + "/" + BANCO;
    }

    private Connection conectar(String banco) throws SQLException {
        return DriverManager.getConnection("jdbc:postgresql://127.0.0.1:" + porta + "/" + banco, "postgres", senha);
    }

    /**
     * Garante o banco da demonstração. {@code restaurar}: apaga e recria (o cenário inicial é montado pela API).
     * Devolve se o banco foi criado agora.
     */
    boolean preparar(Path raiz, boolean restaurar) throws Exception {
        boolean existe;
        try (Connection c = conectar("postgres"); Statement s = c.createStatement()) {
            try (ResultSet r = s.executeQuery("SELECT 1 FROM pg_database WHERE datname = '" + BANCO + "'")) {
                existe = r.next();
            }
            if (existe && restaurar) {
                s.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '" + BANCO + "' AND pid <> pg_backend_pid()");
                s.execute("DROP DATABASE " + BANCO);
                existe = false;
            }
            if (!existe) s.execute("CREATE DATABASE " + BANCO);
        }
        try (Connection c = conectar(BANCO)) {
            instalar(c, raiz, !existe, PAPEL_API, senhaApi, BANCO, true, false);
        }
        return !existe;
    }

    /**
     * Instala ou atualiza o banco de demonstração na conexão de administrador: emulação local do Neon (só em banco novo),
     * migrations ainda não aplicadas (cada uma numa transação, com registro), schema demo_auth e o papel da API.
     */
    static void instalar(Connection c, Path raiz, boolean novo, String papel, String senhaPapel, String banco, boolean permiteCk,
            boolean publica) throws Exception {
        try (Statement s = c.createStatement()) {
            if (novo) s.execute(Files.readString(raiz.resolve("db/tests/emulacao-neon.sql")));
            s.execute("CREATE SCHEMA IF NOT EXISTS demo_auth");
            s.execute("CREATE TABLE IF NOT EXISTS demo_auth.migracoes_aplicadas (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())");
            Set<String> aplicadas = new HashSet<>();
            try (ResultSet r = s.executeQuery("SELECT nome FROM demo_auth.migracoes_aplicadas")) {
                while (r.next()) aplicadas.add(r.getString(1));
            }
            for (Path m : migrations(raiz)) {
                String nome = m.getFileName().toString();
                if (aplicadas.contains(nome)) continue;
                System.out.println("[autonick] aplicando a migration " + nome + "...");
                c.setAutoCommit(false);
                try {
                    s.execute(Files.readString(m));
                    try (PreparedStatement p = c.prepareStatement("INSERT INTO demo_auth.migracoes_aplicadas (nome) VALUES (?)")) {
                        p.setString(1, nome);
                        p.execute();
                    }
                    c.commit();
                } catch (SQLException erro) {
                    c.rollback();
                    throw erro;
                } finally {
                    c.setAutoCommit(true);
                }
            }
            s.execute(Files.readString(raiz.resolve("db/demo/demo_auth.sql")));
            s.execute("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '" + papel + "') THEN "
                    + "CREATE ROLE " + papel + " LOGIN NOINHERIT; END IF; END $$");
            s.execute("ALTER ROLE " + papel + " LOGIN NOINHERIT PASSWORD '" + senhaPapel + "'");
            s.execute("GRANT CONNECT ON DATABASE " + banco + " TO " + papel);
            s.execute(Files.readString(raiz.resolve("db/demo/concessoes_api.sql")).replace("__PAPEL_API__", papel)
                    .replace("__PERMITE_CK__", Boolean.toString(permiteCk)).replace("__PUBLICA__", Boolean.toString(publica)));
        }
    }

    static List<Path> migrations(Path raiz) throws IOException {
        try (Stream<Path> arquivos = Files.list(raiz.resolve("db/migrations_propostas"))) {
            return arquivos.filter(p -> p.getFileName().toString().matches("\\d{12}_.+\\.sql"))
                    .filter(p -> !p.getFileName().toString().endsWith(".down.sql")).sorted().toList();
        }
    }

    @Override
    public void close() throws IOException {
        pg.close();
    }
}
