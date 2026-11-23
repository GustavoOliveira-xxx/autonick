package br.com.ckgroup.autonick.demo;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;

/**
 * A API Java do J02 ({@code java/os-api}) como processo FILHO da demonstração: sobe com as propriedades geradas e é
 * encerrada (com os processos que ela criou) quando a demonstração fecha. A página /demo/ pode desligá-la e ligá-la de
 * novo, para mostrar a falha sem fechar janelas. A saída fica em {@code target/api-java.log}.
 */
final class ApiJavaLocal {

    private static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).startsWith("windows");

    private final Path pastaApi;
    private final Path propriedades;
    private final Path log;
    private final int porta;
    private Process processo;

    ApiJavaLocal(Path pastaApi, Path propriedades, Path log, int porta) {
        this.pastaApi = pastaApi;
        this.propriedades = propriedades;
        this.log = log;
        this.porta = porta;
    }

    /** PIDs (com o instante de início) da API e dos processos que ela criou, para limpar sobras de um encerramento à força. */
    private Path arquivoPids() {
        return log.resolveSibling("api-java.pids");
    }

    /** Encerra só processos registrados por uma execução anterior desta demonstração e ainda vivos com o mesmo início. */
    void encerrarSobras() {
        Path arquivo = arquivoPids();
        if (!Files.isRegularFile(arquivo)) return;
        try {
            for (String linha : Files.readAllLines(arquivo)) {
                String[] p = linha.trim().split(" ");
                if (p.length != 2) continue;
                ProcessHandle.of(Long.parseLong(p[0])).filter(h -> h.info().startInstant().map(i -> i.toString().equals(p[1])).orElse(false))
                        .ifPresent(h -> {
                            h.destroyForcibly();
                            System.out.println("[demo] encerrado um processo da API Java de uma execução anterior (PID " + p[0] + ").");
                        });
            }
            Files.deleteIfExists(arquivo);
        } catch (Exception erro) {
            System.err.println("[demo] não foi possível limpar processos anteriores: " + erro.getMessage());
        }
    }

    private synchronized void registrarPids() {
        if (processo == null) return;
        StringBuilder sb = new StringBuilder();
        java.util.stream.Stream.concat(java.util.stream.Stream.of(processo.toHandle()), processo.descendants())
                .forEach(h -> h.info().startInstant().ifPresent(i -> sb.append(h.pid()).append(' ').append(i).append('\n')));
        try {
            Files.writeString(arquivoPids(), sb.toString());
        } catch (IOException ignorada) {
            // Sem o registro, só a limpeza depois de um encerramento à força fica indisponível.
        }
    }

    synchronized void ligar() throws IOException {
        if (processo != null && processo.isAlive()) return;
        if (portaAberta(porta)) throw new IllegalStateException("A porta " + porta + " já está em uso por outro programa.");
        List<String> comando = WINDOWS ? List.of("cmd.exe", "/c", "mvnw.cmd", "-q", "spring-boot:run")
                : List.of(pastaApi.resolve("mvnw").toString(), "-q", "spring-boot:run");
        ProcessBuilder pb = new ProcessBuilder(comando).directory(pastaApi.toFile()).redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.appendTo(log.toFile()));
        // Equivale a --spring.config.additional-location=...; pela variável evita problemas de aspas no cmd.exe.
        pb.environment().put("SPRING_CONFIG_ADDITIONALLOCATION", propriedades.toUri().toString());
        Files.writeString(log, "");
        processo = pb.start();
    }

    /** Espera a porta abrir; falso se o processo terminou ou o tempo acabou. */
    boolean esperarPronta(long segundos) throws InterruptedException {
        long limite = System.nanoTime() + segundos * 1_000_000_000L;
        while (System.nanoTime() < limite) {
            if (portaAberta(porta)) {
                registrarPids();
                return true;
            }
            Process p;
            synchronized (this) {
                p = processo;
            }
            if (p == null || !p.isAlive()) return false;
            Thread.sleep(1000);
        }
        return false;
    }

    synchronized void desligar() {
        if (processo == null) return;
        processo.descendants().forEach(ProcessHandle::destroyForcibly);
        processo.destroyForcibly();
        try {
            processo.waitFor();
        } catch (InterruptedException erro) {
            Thread.currentThread().interrupt();
        }
        processo = null;
        try {
            Files.deleteIfExists(arquivoPids());
        } catch (IOException ignorada) {
            // Arquivo de registro já ausente.
        }
    }

    boolean ligada() {
        return portaAberta(porta);
    }

    Path log() {
        return log;
    }

    static boolean portaAberta(int porta) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("127.0.0.1", porta), 300);
            return true;
        } catch (IOException erro) {
            return false;
        }
    }
}
