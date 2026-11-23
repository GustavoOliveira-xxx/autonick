package br.com.ckgroup.autonick.osapi.api;

import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.ChavesDeTeste;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Roda SEM banco (porta fechada): prova que tokens inválidos são recusados com 401 antes de qualquer acesso ao banco, e
 * que um token válido passa pelo validador real da aplicação (a falha só aparece depois, ao tentar o banco: 500).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class TokenSemBancoTest {

    private static final ChavesDeTeste CHAVES = ChavesDeTeste.instancia();
    private static final HttpClient HTTP = HttpClient.newHttpClient();

    @LocalServerPort
    int porta;

    @DynamicPropertySource
    static void propriedades(DynamicPropertyRegistry registro) {
        registro.add("spring.datasource.url", () -> "jdbc:postgresql://127.0.0.1:9/banco_inexistente");
        registro.add("spring.datasource.username", () -> "ninguem");
        registro.add("spring.datasource.password", () -> "");
        registro.add("spring.datasource.hikari.connection-timeout", () -> "1000");
        registro.add("spring.datasource.hikari.initialization-fail-timeout", () -> "-1");
        registro.add("autonick.auth.jwks-uri", CHAVES::jwksUri);
        registro.add("autonick.auth.emissor", () -> ChavesDeTeste.EMISSOR);
    }

    private int status(String token) throws Exception {
        return status("/api/cliente/ordens-servico", token);
    }

    private int status(String caminho, String token) throws Exception {
        HttpRequest.Builder p = HttpRequest.newBuilder(URI.create("http://localhost:" + porta + caminho)).GET();
        if (token != null) p.header("Authorization", "Bearer " + token);
        return HTTP.send(p.build(), HttpResponse.BodyHandlers.ofString()).statusCode();
    }

    @Test
    @DisplayName("T1 a T4 sem banco: tokens inválidos dão 401 sem chegar ao banco")
    void invalidosSemBanco() throws Exception {
        long agora = Instant.now().getEpochSecond();
        assertThat(status(null)).isEqualTo(401);
        assertThat(status(CHAVES.tokenSemAssinatura("x"))).isEqualTo(401);
        assertThat(status(CHAVES.token("x", Map.of("iss", "https://outro.example")))).isEqualTo(401);
        assertThat(status(CHAVES.token("x", Map.of("exp", agora - 120)))).isEqualTo(401);
        assertThat(status(CHAVES.token("", Map.of()))).isEqualTo(401);
    }

    @Test
    @DisplayName("J1 sem banco: token Ed25519 válido passa pelo validador real (não é 401) e só falha ao tentar o banco")
    void validoPassaPeloValidador() throws Exception {
        assertThat(status(CHAVES.token("eb0a0100-0000-4000-8000-000000000005"))).isEqualTo(500);
    }

    @Test
    void detalhesExigemTokenValidoEUuidSemConsultarBanco() throws Exception {
        String id = "eb0a0100-0000-4000-8000-000000000001";
        String token = CHAVES.token("eb0a0100-0000-4000-8000-000000000005");
        for (String prefixo : java.util.List.of("/api/cliente/ordens-servico/", "/api/business/ordens-servico/")) {
            assertThat(status(prefixo + id, null)).isEqualTo(401);
            assertThat(status(prefixo + id, CHAVES.tokenSemAssinatura("x"))).isEqualTo(401);
            assertThat(status(prefixo + "nao-e-uuid", token)).isEqualTo(400);
        }
    }
}
