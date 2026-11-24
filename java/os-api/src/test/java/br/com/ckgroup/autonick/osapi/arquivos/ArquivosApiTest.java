package br.com.ckgroup.autonick.osapi.arquivos;

import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * API de arquivos de ponta a ponta (HTTP multipart → validação do conteúdo → metadados no PostgreSQL → disco), no modo
 * demonstração, com as contas fictícias do cenário: gestor da assistência, funcionária com perfil limitado e gestora de outra loja.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class ArquivosApiTest {

    private static final HttpClient HTTP = HttpClient.newHttpClient();
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Map<String, String> TOKENS = new HashMap<>();
    private static Path pasta;

    @LocalServerPort
    int porta;

    @Autowired
    ArmazenamentoArquivos armazenamento;

    @DynamicPropertySource
    static void propriedades(DynamicPropertyRegistry registro) throws Exception {
        BancoDeTeste banco = BancoDeTeste.instancia();
        pasta = Files.createTempDirectory("autonick-arquivos-teste");
        registro.add("spring.datasource.url", () -> banco.urlBanco);
        registro.add("spring.datasource.username", () -> banco.apiUsuario);
        registro.add("spring.datasource.password", () -> banco.apiSenha);
        registro.add("autonick.auth.modo", () -> "demo");
        registro.add("autonick.auth.segredo-demo", () -> "segredo-de-teste-da-demonstracao-0123456789");
        registro.add("autonick.demo.montar-cenario", () -> "true");
        registro.add("autonick.arquivos.pasta", () -> pasta.toString());
    }

    @Test
    void gestorEnviaLogoQueFicaNoDiscoEEhServidaComCabecalhosRestritivos() throws Exception {
        String g = token("gestor");
        String empresa = empresaDe(g);
        HttpResponse<String> r = enviar(g, campos("logo_empresa", empresa), "logo.png", ConteudoArquivoTest.png(300, 300));
        assertThat(r.statusCode()).as(r.body()).isEqualTo(201);
        JsonNode a = JSON.readTree(r.body());
        UUID id = UUID.fromString(a.path("id").asText());
        assertThat(a.path("url").asText()).isEqualTo("/api/arquivos/" + id);
        assertThat(Files.exists(armazenamento.caminho(id))).isTrue();
        assertThat(armazenamento.caminho(id).startsWith(pasta)).isTrue();

        HttpResponse<byte[]> lida = ler(g, id.toString());
        assertThat(lida.statusCode()).isEqualTo(200);
        assertThat(lida.headers().firstValue("content-type").orElse("")).startsWith("image/png");
        assertThat(lida.headers().firstValue("x-content-type-options").orElse("")).isEqualTo("nosniff");
        assertThat(lida.headers().firstValue("content-security-policy").orElse("")).contains("sandbox");
        assertThat(lida.headers().firstValue("cache-control").orElse("")).contains("no-store");
        assertThat(lida.body()).isEqualTo(Files.readAllBytes(armazenamento.caminho(id)));

        // Até a vitrine aprovar, ninguém de fora lê: outra empresa e visitante recebem a mesma resposta de inexistente.
        assertThat(ler(token("gestora-loja"), id.toString()).statusCode()).isEqualTo(404);
        assertThat(ler(null, id.toString()).statusCode()).isEqualTo(404);
        // A funcionária da mesma empresa vê a logo, mas não pode trocá-la.
        assertThat(ler(token("funcionario"), id.toString()).statusCode()).isEqualTo(200);
        HttpResponse<String> definir = rpc(token("funcionario"), "definir_logo_empresa",
                "{\"p_empresa_id\":\"" + empresa + "\",\"p_arquivo_id\":\"" + id + "\",\"p_operation_key\":\"" + UUID.randomUUID() + "\"}");
        assertThat(dica(definir)).isEqualTo("FORBIDDEN_ACTION");
        HttpResponse<String> doGestor = rpc(g, "definir_logo_empresa",
                "{\"p_empresa_id\":\"" + empresa + "\",\"p_arquivo_id\":\"" + id + "\",\"p_operation_key\":\"" + UUID.randomUUID() + "\"}");
        assertThat(doGestor.statusCode()).as(doGestor.body()).isEqualTo(200);
        assertThat(JSON.readTree(rpc(g, "logos_das_minhas_empresas", "{}").body()).path(empresa).path("logo_id").asText()).isEqualTo(id.toString());
    }

    @Test
    void conteudoDisfarcadoEFormatosPerigososSaoRecusadosSemDeixarArquivo() throws Exception {
        String g = token("gestor");
        String empresa = empresaDe(g);
        long antes = contarArquivos();
        HttpResponse<String> html = enviar(g, campos("logo_empresa", empresa), "logo.png",
                "<html><script>alert(document.cookie)</script></html>".getBytes(StandardCharsets.UTF_8));
        assertThat(html.statusCode()).isEqualTo(400);
        assertThat(dica(html)).isEqualTo("VALIDATION_ERROR");
        HttpResponse<String> svg = enviar(g, campos("logo_empresa", empresa), "logo.svg",
                "<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"alert(1)\"/>".getBytes(StandardCharsets.UTF_8));
        assertThat(svg.statusCode()).isEqualTo(400);
        assertThat(enviar(g, campos("logo_empresa", empresa), "gigante.png", ConteudoArquivoTest.png(9000, 10)).statusCode()).isEqualTo(400);
        assertThat(enviar(g, campos("finalidade_inventada", empresa), "a.png", ConteudoArquivoTest.png(64, 64)).statusCode()).isEqualTo(400);
        HttpResponse<String> nomeMalicioso = enviar(g, campos("logo_empresa", empresa), "../../../../etc/passwd.png", ConteudoArquivoTest.png(64, 64));
        assertThat(nomeMalicioso.statusCode()).as(nomeMalicioso.body()).isEqualTo(201);
        assertThat(JSON.readTree(nomeMalicioso.body()).path("nome_original").asText()).doesNotContain("/").doesNotContain("..");
        assertThat(contarArquivos()).isEqualTo(antes + 1);
    }

    @Test
    void outraEmpresaVisitanteEIdsInvalidosNaoChegamAoDisco() throws Exception {
        String empresa = empresaDe(token("gestor"));
        HttpResponse<String> outra = enviar(token("gestora-loja"), campos("logo_empresa", empresa), "logo.png", ConteudoArquivoTest.png(64, 64));
        assertThat(outra.statusCode()).isEqualTo(403);
        assertThat(dica(outra)).isEqualTo("TENANT_FORBIDDEN");
        assertThat(enviar(null, campos("logo_empresa", empresa), "logo.png", ConteudoArquivoTest.png(64, 64)).statusCode()).isEqualTo(401);
        assertThat(ler(token("gestor"), "nao-e-uuid").statusCode()).isEqualTo(404);
        assertThat(ler(token("gestor"), "..%2F..%2Fapplication.properties").statusCode()).isIn(400, 404);
        assertThat(ler(token("gestor"), UUID.randomUUID().toString()).statusCode()).isEqualTo(404);
        if (Files.isDirectory(pasta.resolve("tmp"))) {
            try (var tmp = Files.list(pasta.resolve("tmp"))) {
                assertThat(tmp.count()).as("nenhum temporário esquecido").isZero();
            }
        }
    }

    // ------------------------------------------------------------------------------------------------- apoio

    private long contarArquivos() throws Exception {
        try (var s = Files.walk(pasta)) {
            return s.filter(Files::isRegularFile).filter(p -> !p.getParent().getFileName().toString().equals("tmp")).count();
        }
    }

    private static Map<String, String> campos(String finalidade, String empresa) {
        Map<String, String> c = new LinkedHashMap<>();
        c.put("finalidade", finalidade);
        c.put("empresa_id", empresa);
        c.put("chave", UUID.randomUUID().toString());
        return c;
    }

    private HttpResponse<String> enviar(String token, Map<String, String> campos, String nome, byte[] conteudo) throws Exception {
        String limite = "----autonick" + UUID.randomUUID();
        ByteArrayOutputStream corpo = new ByteArrayOutputStream();
        for (Map.Entry<String, String> c : campos.entrySet()) {
            corpo.write(("--" + limite + "\r\nContent-Disposition: form-data; name=\"" + c.getKey() + "\"\r\n\r\n" + c.getValue() + "\r\n")
                    .getBytes(StandardCharsets.UTF_8));
        }
        corpo.write(("--" + limite + "\r\nContent-Disposition: form-data; name=\"arquivo\"; filename=\"" + nome
                + "\"\r\nContent-Type: image/png\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        corpo.write(conteudo);
        corpo.write(("\r\n--" + limite + "--\r\n").getBytes(StandardCharsets.UTF_8));
        HttpRequest.Builder b = HttpRequest.newBuilder(uri("/api/arquivos")).header("Content-Type", "multipart/form-data; boundary=" + limite)
                .POST(HttpRequest.BodyPublishers.ofByteArray(corpo.toByteArray()));
        if (token != null) b.header("Authorization", "Bearer " + token);
        return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<byte[]> ler(String token, String id) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(uri("/api/arquivos/" + id)).GET();
        if (token != null) b.header("Authorization", "Bearer " + token);
        return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private String token(String pessoa) throws Exception {
        String atual = TOKENS.get(pessoa);
        if (atual != null) return atual;
        HttpResponse<String> entrada = HTTP.send(HttpRequest.newBuilder(uri("/api/auth/sign-in/email")).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"" + pessoa + "@autonick-teste.example\",\"password\":\"demo1234\"}"))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(entrada.statusCode()).as("entrada de %s", pessoa).isEqualTo(200);
        String cookie = entrada.headers().firstValue("set-cookie").orElseThrow().split(";")[0];
        HttpResponse<String> sessao = HTTP.send(HttpRequest.newBuilder(uri("/api/auth/get-session")).header("Cookie", cookie).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        String token = sessao.headers().firstValue("set-auth-jwt").orElseThrow();
        TOKENS.put(pessoa, token);
        return token;
    }

    private String empresaDe(String token) throws Exception {
        return JSON.readTree(rpc(token, "minhas_empresas", "{}").body()).get(0).path("empresa_id").asText();
    }

    private HttpResponse<String> rpc(String token, String funcao, String corpo) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(uri("/api/dados/rpc/" + funcao)).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(corpo));
        if (token != null) b.header("Authorization", "Bearer " + token);
        return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static String dica(HttpResponse<String> r) throws Exception {
        return JSON.readTree(r.body()).path("hint").asText();
    }

    private URI uri(String caminho) {
        return URI.create("http://localhost:" + porta + caminho);
    }
}
