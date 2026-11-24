package br.com.ckgroup.autonick.osapi.arquivos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import br.com.ckgroup.autonick.osapi.plataforma.ErroDados;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Validação do conteúdo real dos arquivos e do armazenamento local (sem banco). */
class ConteudoArquivoTest {

    static byte[] png(int largura, int altura) throws Exception {
        BufferedImage img = new BufferedImage(largura, altura, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setColor(new Color(0xB8, 0x86, 0x0B));
        g.fillOval(0, 0, largura, altura);
        g.dispose();
        ByteArrayOutputStream saida = new ByteArrayOutputStream();
        ImageIO.write(img, "png", saida);
        return saida.toByteArray();
    }

    static byte[] jpegComComentario(int largura, int altura) throws Exception {
        BufferedImage img = new BufferedImage(largura, altura, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream saida = new ByteArrayOutputStream();
        ImageIO.write(img, "jpeg", saida);
        byte[] b = saida.toByteArray();
        // Insere um segmento COM (comentário) logo depois do SOI, como fazem câmeras e editores com metadados.
        byte[] texto = "GPS -23.5,-46.6 segredo-da-camera".getBytes(StandardCharsets.US_ASCII);
        ByteArrayOutputStream com = new ByteArrayOutputStream();
        com.write(b, 0, 2);
        com.write(0xFF);
        com.write(0xFE);
        com.write((texto.length + 2) >> 8);
        com.write((texto.length + 2) & 0xFF);
        com.write(texto);
        com.write(b, 2, b.length - 2);
        return com.toByteArray();
    }

    @Test
    void reconhecePeloConteudoENaoPelaExtensao() throws Exception {
        assertThat(ConteudoArquivo.detectar(png(40, 40))).isEqualTo("image/png");
        assertThat(ConteudoArquivo.detectar("<html><script>alert(1)</script>".getBytes(StandardCharsets.UTF_8))).isNull();
        assertThat(ConteudoArquivo.detectar("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>".getBytes(StandardCharsets.UTF_8))).isNull();
        assertThat(ConteudoArquivo.detectar(new byte[] {'M', 'Z', 0, 0})).isNull();
        assertThatThrownBy(() -> ConteudoArquivo.preparar("<html>".getBytes(StandardCharsets.UTF_8), false)).isInstanceOf(ErroDados.class)
                .hasMessageContaining("Formato não aceito");
    }

    @Test
    void imagemERegravadaSemMetadadosEReduzida() throws Exception {
        byte[] original = jpegComComentario(3000, 1500);
        assertThat(new String(original, StandardCharsets.ISO_8859_1)).contains("segredo-da-camera");
        ConteudoArquivo.Resultado r = ConteudoArquivo.preparar(original, false);
        assertThat(r.tipoMime()).isEqualTo("image/jpeg");
        assertThat(r.largura()).isEqualTo(2048);
        assertThat(r.altura()).isEqualTo(1024);
        assertThat(new String(r.bytes(), StandardCharsets.ISO_8859_1)).doesNotContain("segredo-da-camera");
        ConteudoArquivo.Resultado p = ConteudoArquivo.preparar(png(300, 300), false);
        assertThat(p.largura()).isEqualTo(300);
        assertThat(ImageIO.read(new java.io.ByteArrayInputStream(p.bytes()))).isNotNull();
    }

    @Test
    void recusaImagemGiganteCorrompidaEPdfAtivo() throws Exception {
        byte[] gigante = png(9000, 10);
        assertThatThrownBy(() -> ConteudoArquivo.preparar(gigante, false)).hasMessageContaining("Dimensões");
        byte[] corrompida = png(100, 100);
        byte[] metade = java.util.Arrays.copyOf(corrompida, corrompida.length / 2);
        assertThatThrownBy(() -> ConteudoArquivo.preparar(metade, false)).isInstanceOf(ErroDados.class);
        byte[] pdf = "%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF".getBytes(StandardCharsets.ISO_8859_1);
        assertThatThrownBy(() -> ConteudoArquivo.preparar(pdf, true)).hasMessageContaining("conteúdo ativo");
        byte[] pdfSimples = "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF".getBytes(StandardCharsets.ISO_8859_1);
        assertThatThrownBy(() -> ConteudoArquivo.preparar(pdfSimples, false)).hasMessageContaining("PNG, JPG ou WebP");
        assertThat(ConteudoArquivo.preparar(pdfSimples, true).tipoMime()).isEqualTo("application/pdf");
        byte[] webpFalso = "RIFF\u0010\0\0\0WEBPVP8 xxxxxxxxxxxxxxxxxxxxxx".getBytes(StandardCharsets.ISO_8859_1);
        assertThatThrownBy(() -> ConteudoArquivo.preparar(webpFalso, false)).hasMessageContaining("WebP");
    }

    @Test
    void armazenamentoSoUsaOIdNoCaminhoEGravaEmDuasFases(@TempDir Path pasta) throws Exception {
        ArmazenamentoArquivos a = new ArmazenamentoArquivos(pasta.toString());
        UUID id = UUID.randomUUID();
        Path tmp = a.temporario(png(64, 64));
        assertThat(tmp.getParent().getFileName().toString()).isEqualTo("tmp");
        Path destino = a.efetivar(tmp, id);
        assertThat(destino).isEqualTo(pasta.resolve(id.toString().substring(0, 2)).resolve(id.toString()));
        assertThat(Files.exists(tmp)).isFalse();
        assertThat(ArmazenamentoArquivos.idValido("../../etc/passwd")).isFalse();
        assertThat(ArmazenamentoArquivos.idValido(id.toString())).isTrue();
        assertThat(ArmazenamentoArquivos.idValido(id.toString().toUpperCase())).isFalse();

        // Reinício: outra instância na mesma pasta encontra o arquivo; a limpeza apaga órfãos e temporários antigos.
        ArmazenamentoArquivos depois = new ArmazenamentoArquivos(pasta.toString());
        assertThat(Files.readAllBytes(depois.caminho(id))).isEqualTo(Files.readAllBytes(destino));
        UUID orfao = UUID.randomUUID();
        Files.createDirectories(depois.caminho(orfao).getParent());
        Files.write(depois.caminho(orfao), new byte[] {1, 2, 3});
        Path velho = depois.temporario(new byte[] {9});
        Files.setLastModifiedTime(velho, FileTime.from(Instant.now().minusSeconds(7200)));
        Path recente = depois.temporario(new byte[] {8});
        int[] r = depois.limpar(ids -> ids.stream().filter(id::equals).toList());
        assertThat(r).containsExactly(1, 1);
        assertThat(Files.exists(depois.caminho(id))).isTrue();
        assertThat(Files.exists(depois.caminho(orfao))).isFalse();
        assertThat(Files.exists(velho)).isFalse();
        assertThat(Files.exists(recente)).isTrue();
        assertThat(depois.limpar(ids -> List.of())).containsExactly(0, 1);
    }
}
