package br.com.ckgroup.autonick.osapi.web;

import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.boot.env.PropertiesPropertySourceLoader;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * PWA entregue pela própria API (execução local): a raiz abre a página inicial e a pasta da PWA pode ter acentos no
 * caminho, como "Área de Trabalho" no Windows em português.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class PwaEntregueTest {

    private static final HttpClient HTTP = HttpClient.newHttpClient();

    @LocalServerPort
    int porta;

    @DynamicPropertySource
    static void propriedades(DynamicPropertyRegistry registro) throws Exception {
        BancoDeTeste banco = BancoDeTeste.instancia();
        registro.add("spring.datasource.url", () -> banco.urlBanco);
        registro.add("spring.datasource.username", () -> banco.apiUsuario);
        registro.add("spring.datasource.password", () -> banco.apiSenha);
        registro.add("autonick.auth.modo", () -> "demo");
        registro.add("autonick.auth.segredo-demo", () -> "segredo-de-teste-da-pwa-entregue-0123456789");
        Path raiz = Path.of(System.getProperty("autonick.raiz", "../..")).toAbsolutePath().normalize();
        // Com acento quando o sistema de arquivos consegue representar o nome (Windows e Linux com UTF-8).
        String nome = Charset.forName(System.getProperty("sun.jnu.encoding", "UTF-8")).newEncoder().canEncode("Á")
                ? "Área de Trabalho" : "Area de Trabalho";
        // Cópia das páginas verificadas (sem link simbólico, que no Windows exige privilégio especial).
        Path pwa = Files.createTempDirectory("autonick-pwa-").resolve(nome).resolve("public");
        for (String pagina : new String[] {"index.html", "business/entrar.html"}) {
            Path destino = pwa.resolve(pagina);
            Files.createDirectories(destino.getParent());
            Files.copy(raiz.resolve("public").resolve(pagina), destino);
        }
        registro.add("autonick.pwa.pasta", pwa::toString);
    }

    @Test
    void raizAbreAPaginaInicialEArquivoInexistenteContinuaNaoEncontrado() throws Exception {
        HttpResponse<String> raiz = get("/");
        assertThat(raiz.statusCode()).isEqualTo(200);
        assertThat(raiz.body()).contains("<title>AutoniCK");
        assertThat(get("/business/entrar.html").statusCode()).isEqualTo(200);
        assertThat(get("/js/config/public-config.js").body()).contains("\"backend\":\"java-local\"");
        assertThat(get("/nao-existe.html").statusCode()).isEqualTo(404);
    }

    /**
     * O Spring Boot lê .properties como ISO-8859-1: o inicializador local grava caracteres fora do ASCII como escapes
     * Unicode. Com o escape, o caminho chega intacto; gravado direto em UTF-8, chega corrompido (o defeito corrigido).
     */
    @Test
    void propriedadeComEscapeUnicodePreservaOCaminhoComAcento() throws Exception {
        Path pasta = Files.createTempDirectory("autonick-propriedades-");
        Path comEscape = pasta.resolve("com-escape.properties");
        Files.writeString(comEscape, "autonick.pwa.pasta=C:/Users/demo/\\u00c1rea de Trabalho/public\n", StandardCharsets.US_ASCII);
        Path utf8 = pasta.resolve("utf8.properties");
        Files.writeString(utf8, "autonick.pwa.pasta=C:/Users/demo/Área de Trabalho/public\n", StandardCharsets.UTF_8);

        assertThat(ler(comEscape)).isEqualTo("C:/Users/demo/Área de Trabalho/public");
        assertThat(ler(utf8)).isNotEqualTo("C:/Users/demo/Área de Trabalho/public");
    }

    private static Object ler(Path arquivo) throws Exception {
        PropertySource<?> fonte = new PropertiesPropertySourceLoader().load("teste", new FileSystemResource(arquivo)).get(0);
        return fonte.getProperty("autonick.pwa.pasta").toString();
    }

    private HttpResponse<String> get(String caminho) throws Exception {
        return HTTP.send(HttpRequest.newBuilder(URI.create("http://localhost:" + porta + caminho)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }
}
