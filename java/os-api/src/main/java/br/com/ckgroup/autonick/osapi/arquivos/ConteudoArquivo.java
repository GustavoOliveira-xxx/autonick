package br.com.ckgroup.autonick.osapi.arquivos;

import br.com.ckgroup.autonick.osapi.plataforma.ErroDados;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;

/**
 * Validação do CONTEÚDO REAL de um arquivo enviado (nunca da extensão nem do tipo informado pelo navegador).
 *
 * <ul>
 *   <li>Aceita só PNG, JPEG, WebP (imagens) e PDF (documentos), reconhecidos pelos primeiros bytes.</li>
 *   <li>SVG, HTML, executáveis e qualquer outro formato são recusados.</li>
 *   <li>PNG e JPEG: dimensões lidas do cabeçalho ANTES de decodificar (evita imagens gigantes), depois decodificados e
 *       regravados (remove metadados e qualquer conteúdo escondido) e reduzidos se passarem do lado máximo.</li>
 *   <li>WebP: dimensões conferidas no cabeçalho (o Java não regrava WebP); o arquivo é mantido como veio.</li>
 *   <li>PDF: cabeçalho conferido e recusa de PDFs com JavaScript, ações automáticas ou arquivos embutidos.
 *       Sempre servido como download, nunca exibido no navegador.</li>
 * </ul>
 * Não há antivírus: a proteção é por tipo fechado, regravação das imagens e cabeçalhos de entrega restritivos.
 */
public final class ConteudoArquivo {

    public static final int DIMENSAO_ABSOLUTA = 8192;
    private static final int LADO_OTIMIZADO = 2048;

    public record Resultado(String tipoMime, byte[] bytes, Integer largura, Integer altura) {
    }

    private ConteudoArquivo() {
    }

    public static String detectar(byte[] b) {
        if (b.length >= 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G' && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) return "image/png";
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) return "image/jpeg";
        if (b.length >= 16 && ascii(b, 0, 4).equals("RIFF") && ascii(b, 8, 4).equals("WEBP")) return "image/webp";
        if (b.length >= 5 && ascii(b, 0, 5).equals("%PDF-")) return "application/pdf";
        return null;
    }

    /** Valida e prepara o arquivo para gravação. {@code permitePdf} depende da finalidade. */
    public static Resultado preparar(byte[] original, boolean permitePdf) {
        String tipo = detectar(original);
        if (tipo == null) throw ErroDados.validacao("Formato não aceito. Envie uma imagem PNG, JPG ou WebP" + (permitePdf ? " ou um PDF." : "."));
        return switch (tipo) {
            case "image/png", "image/jpeg" -> regravar(original, tipo);
            case "image/webp" -> webp(original);
            default -> {
                if (!permitePdf) throw ErroDados.validacao("Para esta finalidade, envie uma imagem PNG, JPG ou WebP.");
                yield pdf(original);
            }
        };
    }

    private static Resultado regravar(byte[] original, String tipo) {
        try (ImageInputStream entrada = ImageIO.createImageInputStream(new ByteArrayInputStream(original))) {
            Iterator<ImageReader> leitores = ImageIO.getImageReaders(entrada);
            if (!leitores.hasNext()) throw ErroDados.validacao("Não foi possível ler a imagem.");
            ImageReader leitor = leitores.next();
            try {
                leitor.setInput(entrada, true, true);
                int largura = leitor.getWidth(0);
                int altura = leitor.getHeight(0);
                if (largura <= 0 || altura <= 0 || largura > DIMENSAO_ABSOLUTA || altura > DIMENSAO_ABSOLUTA) {
                    throw ErroDados.validacao("Dimensões da imagem fora do permitido.");
                }
                BufferedImage imagem = leitor.read(0);
                BufferedImage pronta = reduzir(imagem, "image/jpeg".equals(tipo));
                byte[] bytes = gravar(pronta, tipo);
                return new Resultado(tipo, bytes, pronta.getWidth(), pronta.getHeight());
            } finally {
                leitor.dispose();
            }
        } catch (IOException | RuntimeException erro) {
            if (erro instanceof ErroDados e) throw e;
            throw ErroDados.validacao("A imagem está corrompida ou não pôde ser lida.");
        }
    }

    private static BufferedImage reduzir(BufferedImage imagem, boolean semTransparencia) {
        int w = imagem.getWidth(), h = imagem.getHeight();
        double k = Math.min(1.0, (double) LADO_OTIMIZADO / Math.max(w, h));
        int nw = Math.max(1, (int) Math.round(w * k)), nh = Math.max(1, (int) Math.round(h * k));
        BufferedImage destino = new BufferedImage(nw, nh, semTransparencia ? BufferedImage.TYPE_INT_RGB : BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = destino.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            if (semTransparencia) {
                g.setColor(java.awt.Color.WHITE);
                g.fillRect(0, 0, nw, nh);
            }
            g.drawImage(imagem, 0, 0, nw, nh, null);
        } finally {
            g.dispose();
        }
        return destino;
    }

    private static byte[] gravar(BufferedImage imagem, String tipo) throws IOException {
        ByteArrayOutputStream saida = new ByteArrayOutputStream();
        if ("image/png".equals(tipo)) {
            ImageIO.write(imagem, "png", saida);
            return saida.toByteArray();
        }
        ImageWriter escritor = ImageIO.getImageWritersByFormatName("jpeg").next();
        try (ImageOutputStream destino = ImageIO.createImageOutputStream(saida)) {
            escritor.setOutput(destino);
            ImageWriteParam p = escritor.getDefaultWriteParam();
            p.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            p.setCompressionQuality(0.88f);
            escritor.write(null, new IIOImage(imagem, null, null), p);
        } finally {
            escritor.dispose();
        }
        return saida.toByteArray();
    }

    /** WebP simples (VP8), sem perdas (VP8L) ou estendido (VP8X): dimensões do cabeçalho e tamanho RIFF coerente. */
    private static Resultado webp(byte[] b) {
        long riff = (b[4] & 0xFFL) | (b[5] & 0xFFL) << 8 | (b[6] & 0xFFL) << 16 | (b[7] & 0xFFL) << 24;
        if (riff + 8 != b.length && riff + 9 != b.length) throw ErroDados.validacao("A imagem WebP está corrompida.");
        String bloco = ascii(b, 12, 4);
        int largura, altura;
        if (bloco.equals("VP8 ") && b.length >= 30) {
            largura = ((b[26] & 0xFF) | (b[27] & 0xFF) << 8) & 0x3FFF;
            altura = ((b[28] & 0xFF) | (b[29] & 0xFF) << 8) & 0x3FFF;
        } else if (bloco.equals("VP8L") && b.length >= 25) {
            int v = (b[21] & 0xFF) | (b[22] & 0xFF) << 8 | (b[23] & 0xFF) << 16 | (b[24] & 0xFF) << 24;
            largura = (v & 0x3FFF) + 1;
            altura = ((v >> 14) & 0x3FFF) + 1;
        } else if (bloco.equals("VP8X") && b.length >= 30) {
            largura = 1 + ((b[24] & 0xFF) | (b[25] & 0xFF) << 8 | (b[26] & 0xFF) << 16);
            altura = 1 + ((b[27] & 0xFF) | (b[28] & 0xFF) << 8 | (b[29] & 0xFF) << 16);
        } else {
            throw ErroDados.validacao("A imagem WebP não é reconhecida.");
        }
        if (largura <= 0 || altura <= 0 || largura > DIMENSAO_ABSOLUTA || altura > DIMENSAO_ABSOLUTA) {
            throw ErroDados.validacao("Dimensões da imagem fora do permitido.");
        }
        return new Resultado("image/webp", b, largura, altura);
    }

    private static Resultado pdf(byte[] b) {
        String texto = new String(b, StandardCharsets.ISO_8859_1).toLowerCase(Locale.ROOT);
        for (String proibido : new String[] {"/javascript", "/js ", "/js(", "/js<", "/launch", "/embeddedfile", "/openaction", "/aa ", "/aa<", "/richmedia", "/xfa"}) {
            if (texto.contains(proibido)) throw ErroDados.validacao("Este PDF tem conteúdo ativo (script ou ação automática) e não é aceito.");
        }
        if (!texto.contains("%%eof")) throw ErroDados.validacao("O PDF está incompleto ou corrompido.");
        return new Resultado("application/pdf", b, null, null);
    }

    private static String ascii(byte[] b, int inicio, int tamanho) {
        return new String(b, inicio, Math.min(tamanho, Math.max(0, b.length - inicio)), StandardCharsets.US_ASCII);
    }
}
