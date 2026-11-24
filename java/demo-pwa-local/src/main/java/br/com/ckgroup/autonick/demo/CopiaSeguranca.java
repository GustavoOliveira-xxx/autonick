package br.com.ckgroup.autonick.demo;

import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * Backup local da demonstração: banco (pasta {@code dados}) e arquivos enviados (pasta {@code arquivos}) juntos, com o
 * AutoniCK FECHADO (o PostgreSQL não está rodando, então a cópia da pasta de dados é consistente). Nada é apagado.
 * A recuperação é manual e explícita (copiar de volta com o AutoniCK fechado), para nunca sobrescrever dados sem pedido.
 */
final class CopiaSeguranca {

    private CopiaSeguranca() {
    }

    static Path copiar(Path base) throws IOException {
        Path destino = base.resolve("backups").resolve(LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")));
        Files.createDirectories(destino);
        for (String pasta : new String[] {"dados", "arquivos"}) {
            Path origem = base.resolve(pasta);
            if (Files.isDirectory(origem)) copiarArvore(origem, destino.resolve(pasta));
        }
        return destino;
    }

    /** Esvazia a pasta de arquivos (usado só pela restauração explícita do cenário fictício). */
    static void esvaziar(Path pasta) throws IOException {
        if (!Files.isDirectory(pasta)) return;
        Files.walkFileTree(pasta, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path arquivo, BasicFileAttributes a) throws IOException {
                Files.delete(arquivo);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException erro) throws IOException {
                if (!dir.equals(pasta)) Files.delete(dir);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private static void copiarArvore(Path origem, Path destino) throws IOException {
        Files.walkFileTree(origem, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes a) throws IOException {
                Files.createDirectories(destino.resolve(origem.relativize(dir).toString()));
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path arquivo, BasicFileAttributes a) throws IOException {
                if (!arquivo.getFileName().toString().equals("postmaster.pid")) {
                    Files.copy(arquivo, destino.resolve(origem.relativize(arquivo).toString()), StandardCopyOption.COPY_ATTRIBUTES);
                }
                return FileVisitResult.CONTINUE;
            }
        });
    }
}
