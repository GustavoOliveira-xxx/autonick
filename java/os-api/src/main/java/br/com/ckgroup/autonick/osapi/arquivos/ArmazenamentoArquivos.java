package br.com.ckgroup.autonick.osapi.arquivos;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Armazenamento LOCAL e persistente dos arquivos enviados (fora do Git e do banco).
 *
 * <ul>
 *   <li>Pasta: {@code autonick.arquivos.pasta}; o AutoniCK local usa {@code <AUTONICK_LOCAL_PASTA>/arquivos}, junto do banco,
 *       para backup e restauração andarem juntos.</li>
 *   <li>O caminho de cada arquivo é derivado SÓ do id gerado pelo banco ({@code <2 primeiros>/<uuid>}): nenhum nome vindo
 *       do pedido entra no caminho (sem path traversal) e a pasta nunca é listada para o usuário.</li>
 *   <li>Gravação em duas fases: arquivo temporário completo e sincronizado, registro dos metadados na transação e só
 *       então a troca atômica para o nome definitivo. Falhas no meio apagam o temporário.</li>
 *   <li>Limpeza na inicialização: temporários esquecidos e arquivos sem metadados (órfãos) ou removidos há mais de
 *       30 dias (prazo de retenção).</li>
 * </ul>
 */
@Component
public class ArmazenamentoArquivos {

    private static final Logger LOG = LoggerFactory.getLogger(ArmazenamentoArquivos.class);
    private static final Pattern UUID_TEXTO = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
    private final Path base;
    private final SecureRandom aleatorio = new SecureRandom();

    public ArmazenamentoArquivos(@Value("${autonick.arquivos.pasta:}") String pasta) {
        this.base = (pasta == null || pasta.isBlank()
                ? Path.of(System.getProperty("user.home"), ".autonick", "arquivos")
                : Path.of(pasta)).toAbsolutePath().normalize();
    }

    public Path base() {
        return base;
    }

    public static boolean idValido(String id) {
        return id != null && UUID_TEXTO.matcher(id).matches();
    }

    public Path caminho(UUID id) {
        String texto = id.toString();
        Path destino = base.resolve(texto.substring(0, 2)).resolve(texto).normalize();
        if (!destino.startsWith(base)) throw new IllegalStateException("Caminho fora do armazenamento");
        return destino;
    }

    /** Grava os bytes num temporário completo e sincronizado. */
    public Path temporario(byte[] bytes) throws IOException {
        Path pasta = base.resolve("tmp");
        Files.createDirectories(pasta);
        byte[] nome = new byte[12];
        aleatorio.nextBytes(nome);
        Path tmp = pasta.resolve(HexFormat.of().formatHex(nome) + ".part");
        try (OutputStream saida = Files.newOutputStream(tmp, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE, StandardOpenOption.SYNC)) {
            saida.write(bytes);
        }
        return tmp;
    }

    /** Move o temporário para o lugar definitivo do id (troca atômica quando o sistema permite). */
    public Path efetivar(Path tmp, UUID id) throws IOException {
        Path destino = caminho(id);
        Files.createDirectories(destino.getParent());
        try {
            Files.move(tmp, destino, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException semAtomico) {
            Files.move(tmp, destino, StandardCopyOption.REPLACE_EXISTING);
        }
        return destino;
    }

    public void apagarSilencioso(Path p) {
        if (p == null) return;
        try {
            Files.deleteIfExists(p);
        } catch (IOException erro) {
            LOG.warn("Não foi possível apagar {}: {}", p.getFileName(), erro.getMessage());
        }
    }

    /**
     * Limpeza: apaga temporários com mais de 1 hora e arquivos cujo id não tem metadados válidos.
     * {@code comMetadados} recebe um lote de ids e devolve os que existem (ativos ou dentro da retenção).
     */
    public int[] limpar(Function<List<UUID>, List<UUID>> comMetadados) {
        int temporarios = 0, orfaos = 0;
        try {
            Path tmp = base.resolve("tmp");
            if (Files.isDirectory(tmp)) {
                Instant limite = Instant.now().minus(Duration.ofHours(1));
                try (DirectoryStream<Path> lista = Files.newDirectoryStream(tmp, "*.part")) {
                    for (Path p : lista) {
                        if (Files.getLastModifiedTime(p).toInstant().isBefore(limite)) {
                            apagarSilencioso(p);
                            temporarios++;
                        }
                    }
                }
            }
            if (!Files.isDirectory(base)) return new int[] {temporarios, orfaos};
            List<Path> pastas = new ArrayList<>();
            try (DirectoryStream<Path> lista = Files.newDirectoryStream(base, p -> Files.isDirectory(p) && p.getFileName().toString().matches("[0-9a-f]{2}"))) {
                lista.forEach(pastas::add);
            }
            for (Path pasta : pastas) {
                List<Path> arquivos = new ArrayList<>();
                try (DirectoryStream<Path> lista = Files.newDirectoryStream(pasta)) {
                    lista.forEach(arquivos::add);
                }
                for (int i = 0; i < arquivos.size(); i += 500) {
                    List<Path> lote = arquivos.subList(i, Math.min(arquivos.size(), i + 500));
                    List<UUID> ids = new ArrayList<>();
                    for (Path p : lote) {
                        String nome = p.getFileName().toString();
                        if (idValido(nome)) ids.add(UUID.fromString(nome));
                    }
                    List<UUID> validos = comMetadados.apply(ids);
                    for (UUID id : ids) {
                        if (!validos.contains(id)) {
                            apagarSilencioso(caminho(id));
                            orfaos++;
                        }
                    }
                }
            }
        } catch (IOException erro) {
            LOG.warn("Limpeza do armazenamento interrompida: {}", erro.getMessage());
        }
        return new int[] {temporarios, orfaos};
    }
}
