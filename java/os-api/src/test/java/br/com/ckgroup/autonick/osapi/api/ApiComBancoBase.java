package br.com.ckgroup.autonick.osapi.api;

import br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste;
import br.com.ckgroup.autonick.osapi.apoio.CenarioOs;
import br.com.ckgroup.autonick.osapi.apoio.ChavesDeTeste;
import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Base dos testes que sobem a API de verdade (HTTP em porta aleatória, validador real de token) ligada ao banco
 * PostgreSQL local descartável. Sem banco disponível, a classe é pulada.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
abstract class ApiComBancoBase {

    protected static final HttpClient HTTP = HttpClient.newHttpClient();
    protected static final ChavesDeTeste CHAVES = ChavesDeTeste.instancia();

    @LocalServerPort
    protected int porta;

    @DynamicPropertySource
    static void propriedades(DynamicPropertyRegistry registro) {
        BancoDeTeste banco = BancoDeTeste.instancia();
        registro.add("spring.datasource.url", () -> banco.urlBanco);
        registro.add("spring.datasource.username", () -> banco.apiUsuario);
        registro.add("spring.datasource.password", () -> banco.apiSenha);
        registro.add("autonick.auth.jwks-uri", CHAVES::jwksUri);
        registro.add("autonick.auth.emissor", () -> ChavesDeTeste.EMISSOR);
    }

    protected static CenarioOs cenario() {
        return BancoDeTeste.instancia().cenario();
    }

    protected HttpResponse<String> get(String caminho, String token, String... cabecalhos) {
        try {
            HttpRequest.Builder pedido = HttpRequest.newBuilder(URI.create("http://localhost:" + porta + caminho)).GET();
            if (token != null) pedido.header("Authorization", "Bearer " + token);
            if (cabecalhos.length > 0) pedido.headers(cabecalhos);
            return HTTP.send(pedido.build(), HttpResponse.BodyHandlers.ofString());
        } catch (Exception erro) {
            throw new IllegalStateException(erro);
        }
    }

    protected HttpResponse<String> post(String caminho, String token, String corpoJson) {
        try {
            HttpRequest.Builder pedido = HttpRequest.newBuilder(URI.create("http://localhost:" + porta + caminho))
                    .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(corpoJson));
            if (token != null) pedido.header("Authorization", "Bearer " + token);
            return HTTP.send(pedido.build(), HttpResponse.BodyHandlers.ofString());
        } catch (Exception erro) {
            throw new IllegalStateException(erro);
        }
    }

    /** Envia e DESCARTA a resposta, como se ela tivesse se perdido no caminho (o servidor processa normalmente). */
    protected int postDescartandoResposta(String caminho, String token, String corpoJson) {
        try {
            HttpRequest pedido = HttpRequest.newBuilder(URI.create("http://localhost:" + porta + caminho))
                    .header("Content-Type", "application/json").header("Authorization", "Bearer " + token)
                    .POST(HttpRequest.BodyPublishers.ofString(corpoJson)).build();
            return HTTP.send(pedido, HttpResponse.BodyHandlers.discarding()).statusCode();
        } catch (Exception erro) {
            throw new IllegalStateException(erro);
        }
    }

    protected static Set<String> ids(String corpo) {
        JsonNode raiz = CenarioOs.ler(corpo);
        JsonNode lista = raiz.isArray() ? raiz : raiz.get("itens");
        Set<String> ids = new TreeSet<>();
        lista.forEach(o -> ids.add(o.get("id").asText()));
        return ids;
    }

    protected static String codigo(HttpResponse<String> resposta) {
        return CenarioOs.ler(resposta.body()).get("codigo").asText();
    }
}
