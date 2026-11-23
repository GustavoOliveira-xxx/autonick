package br.com.ckgroup.autonick.demo;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.File;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.HexFormat;
import java.util.UUID;

/**
 * PostgreSQL 18 TEMPORÁRIO e exclusivo da demonstração (binários portáteis do Maven Central; sem instalação, sem serviço).
 *
 * <ul>
 *   <li>Tudo fica em {@code <temp>/autonick-demo-j03/}: os binários em {@code binarios/} e os dados em {@code dados/<id>/}.
 *       Nenhum outro diretório é lido ou alterado, nem bancos já instalados.</li>
 *   <li>Escuta só em 127.0.0.1, numa porta livre escolhida na hora; sem socket local.</li>
 *   <li>Senha aleatória do superusuário definida no {@code initdb} e {@code pg_hba.conf} trocado para scram-sha-256
 *       ANTES de o servidor subir: não há janela em modo "trust". Nada é digitado nem gravado fora da pasta temporária.</li>
 *   <li>Ao fechar a demonstração, o servidor é parado e a pasta de dados é apagada. Se a janela for morta à força, a
 *       próxima execução para e apaga as pastas de dados abandonadas (só as desta demonstração, depois de 10 minutos).</li>
 * </ul>
 */
final class BancoTemporario implements AutoCloseable {

    static final Path BASE = Path.of(System.getProperty("java.io.tmpdir"), "autonick-demo-j03");

    private final EmbeddedPostgres pg;
    final String senha;
    final int porta;

    private BancoTemporario(EmbeddedPostgres pg, String senha) {
        this.pg = pg;
        this.senha = senha;
        this.porta = pg.getPort();
    }

    /**
     * Para e apaga pastas de dados desta demonstração deixadas por uma execução encerrada à força (janela morta pelo
     * Gerenciador de Tarefas, por exemplo). Só olha {@code BASE/dados}; uma pasta em uso tem a trava ativa e é ignorada.
     */
    static void encerrarSobras() {
        Path dados = BASE.resolve("dados");
        File[] pastas = dados.toFile().listFiles(File::isDirectory);
        if (pastas == null) return;
        for (File pasta : pastas) {
            File trava = new File(pasta, "epg-lock");
            try (java.io.FileOutputStream f = new java.io.FileOutputStream(trava, true);
                 java.nio.channels.FileLock lock = f.getChannel().tryLock()) {
                if (lock == null) continue;
                if (new File(pasta, "postmaster.pid").exists()) {
                    Path pgCtl = pgCtl();
                    if (pgCtl != null) {
                        new ProcessBuilder(pgCtl.toString(), "-D", pasta.getPath(), "stop", "-m", "immediate", "-w", "-t", "20")
                                .redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start().waitFor();
                    }
                }
            } catch (Exception erro) {
                continue;
            }
            try {
                org.apache.commons.io.FileUtils.deleteDirectory(pasta);
                System.out.println("[demo] removida a pasta de uma execução anterior encerrada à força: " + pasta);
            } catch (IOException erro) {
                System.err.println("[demo] não foi possível remover " + pasta + ": " + erro.getMessage());
            }
        }
    }

    private static Path pgCtl() throws IOException {
        Path binarios = BASE.resolve("binarios");
        if (!Files.isDirectory(binarios)) return null;
        String nome = System.getProperty("os.name", "").startsWith("Windows") ? "pg_ctl.exe" : "pg_ctl";
        try (var lista = Files.list(binarios)) {
            return lista.map(d -> d.resolve("bin").resolve(nome)).filter(Files::isRegularFile).findFirst().orElse(null);
        }
    }

    static BancoTemporario iniciar() throws IOException {
        Path dados = BASE.resolve("dados");
        Path binarios = BASE.resolve("binarios");
        Files.createDirectories(dados);
        Files.createDirectories(binarios);
        // A limpeza de pastas abandonadas da biblioteca só olha este diretório (o padrão seria o temp compartilhado).
        System.setProperty("ot.epg.working-dir", dados.toString());

        byte[] b = new byte[24];
        new SecureRandom().nextBytes(b);
        String senha = HexFormat.of().formatHex(b);
        Path arquivoSenha = Files.createTempFile(BASE, "pw-", ".txt");
        try {
            Files.writeString(arquivoSenha, senha);
            EmbeddedPostgres pg = EmbeddedPostgres.builder()
                    .setOverrideWorkingDirectory(binarios.toFile())
                    .setDataDirectory(dados.resolve(UUID.randomUUID().toString()))
                    .setCleanDataDirectory(true)
                    .setLocaleConfig("pwfile", arquivoSenha.toString())
                    .setLocaleConfig("locale", "C")
                    .setLocaleConfig("locale-provider", "builtin")
                    .setLocaleConfig("builtin-locale", "C.UTF-8")
                    .setServerConfig("listen_addresses", "127.0.0.1")
                    .setServerConfig("unix_socket_directories", "")
                    .setConnectConfig("password", senha)
                    .setDataDirectoryCustomizer(BancoTemporario::somenteScramLocal)
                    .setPGStartupWait(Duration.ofSeconds(60))
                    .start();
            return new BancoTemporario(pg, senha);
        } finally {
            Files.deleteIfExists(arquivoSenha);
        }
    }

    /** Substitui o pg_hba.conf do initdb (trust) por acesso só de 127.0.0.1 e ::1, com senha (scram-sha-256). */
    private static void somenteScramLocal(File dir) {
        try {
            Files.writeString(dir.toPath().resolve("pg_hba.conf"), String.join("\n",
                    "# Demonstração local: só esta máquina, com senha aleatória gerada a cada início.",
                    "host all all 127.0.0.1/32 scram-sha-256",
                    "host all all ::1/128 scram-sha-256", ""));
        } catch (IOException erro) {
            throw new UncheckedIOException(erro);
        }
    }

    String urlAdmin() {
        return "jdbc:postgresql://127.0.0.1:" + porta + "/postgres";
    }

    @Override
    public void close() throws IOException {
        pg.close();
    }
}
