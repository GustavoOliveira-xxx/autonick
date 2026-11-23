package br.com.ckgroup.autonick.osapi.plataforma;

import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Demonstração pública: cenário próprio por visitante, troca de pessoa no mesmo cenário e isolamento entre visitantes. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class DemonstracaoPublicaTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @LocalServerPort
    int porta;

    @org.springframework.beans.factory.annotation.Autowired
    br.com.ckgroup.autonick.osapi.demonstracao.ContasDemonstracao contas;

    @org.springframework.beans.factory.annotation.Autowired
    br.com.ckgroup.autonick.osapi.demonstracao.TokensDemonstracao tokens;

    @org.springframework.beans.factory.annotation.Autowired
    org.springframework.jdbc.core.JdbcTemplate jdbc;

    @DynamicPropertySource
    static void propriedades(DynamicPropertyRegistry registro) {
        BancoDeTeste banco = BancoDeTeste.instancia();
        registro.add("spring.datasource.url", () -> banco.urlBanco);
        registro.add("spring.datasource.username", () -> banco.apiUsuario);
        registro.add("spring.datasource.password", () -> banco.apiSenha);
        registro.add("autonick.auth.modo", () -> "demo");
        registro.add("autonick.auth.segredo-demo", () -> "segredo-de-teste-da-demonstracao-publica-0123");
        registro.add("autonick.dados.demonstracao-publica", () -> "true");
        registro.add("autonick.dados.escritas-por-minuto", () -> "200");
        registro.add("autonick.demo.cenarios-por-origem-dia", () -> "2");
    }

    /** Visitante com cookies próprios e endereço de origem próprio. */
    final class Visitante {
        final HttpClient http = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
        final String origem;

        Visitante(String origem) {
            this.origem = origem;
        }

        HttpResponse<String> entrar(String pessoa) throws Exception {
            return http.send(HttpRequest.newBuilder(uri("/api/auth/demo/entrar")).header("Content-Type", "application/json")
                    .header("X-Forwarded-For", origem).POST(HttpRequest.BodyPublishers.ofString("{\"pessoa\":\"" + pessoa + "\"}")).build(),
                    HttpResponse.BodyHandlers.ofString());
        }

        String token() throws Exception {
            return http.send(HttpRequest.newBuilder(uri("/api/auth/get-session")).GET().build(), HttpResponse.BodyHandlers.ofString())
                    .headers().firstValue("set-auth-jwt").orElseThrow();
        }

        HttpResponse<String> rpc(String funcao, String corpo) throws Exception {
            return http.send(HttpRequest.newBuilder(uri("/api/dados/rpc/" + funcao)).header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + token()).POST(HttpRequest.BodyPublishers.ofString(corpo)).build(),
                    HttpResponse.BodyHandlers.ofString());
        }
    }

    @Test
    void cadaVisitanteTemCenarioProprioIsoladoDosOutros() throws Exception {
        Visitante a = new Visitante("203.0.113.10");
        Visitante b = new Visitante("203.0.113.20");
        assertThat(a.entrar("gestor").statusCode()).isEqualTo(200);
        String empresaA = JSON.readTree(a.rpc("minhas_empresas", "{}").body()).get(0).path("empresa_id").asText();
        assertThat(b.entrar("cliente").statusCode()).isEqualTo(200);

        // A troca de pessoa continua no mesmo cenário: o cliente de A vê as empresas de A na vitrine.
        assertThat(a.entrar("cliente").statusCode()).isEqualTo(200);
        Set<String> vitrineA = empresas(a.rpc("buscar_demonstracao", "{}"));
        assertThat(vitrineA).contains(empresaA).hasSize(4);

        // B não vê nem alcança as empresas de A.
        Set<String> vitrineB = empresas(b.rpc("buscar_demonstracao", "{}"));
        assertThat(vitrineB).hasSize(4).doesNotContain(empresaA);
        assertThat(dica(b.rpc("vitrine_demonstracao", "{\"p_empresa_id\":\"" + empresaA + "\"}"))).isEqualTo("TENANT_FORBIDDEN");
        assertThat(dica(b.rpc("itens_para_pedido", "{\"p_empresa_id\":\"" + empresaA + "\"}"))).isEqualTo("TENANT_FORBIDDEN");
        assertThat(dica(b.rpc("criar_pedido", "{\"p_empresa_id\":\"" + empresaA + "\",\"p_itens\":[],\"p_observacao\":null,\"p_operation_key\":\"x-1\"}")))
                .isEqualTo("TENANT_FORBIDDEN");
        for (JsonNode e : JSON.readTree(b.rpc("empresas_para_pedido", "{}").body())) assertThat(e.path("id").asText()).isNotEqualTo(empresaA);

        // Sem painel CK e sem as funções da fila da CK na demonstração pública.
        assertThat(dica(b.rpc("ck_listar_empresas", "{}"))).isEqualTo("FORBIDDEN_ACTION");
        assertThat(b.entrar("ck").statusCode()).isEqualTo(404);
    }

    @Test
    void limiteDeCenariosNovosPorOrigem() throws Exception {
        String origem = "198.51.100.7";
        assertThat(new Visitante(origem).entrar("cliente").statusCode()).isEqualTo(200);
        assertThat(new Visitante(origem).entrar("cliente").statusCode()).isEqualTo(200);
        assertThat(new Visitante(origem).entrar("cliente").statusCode()).isEqualTo(429);
    }

    /**
     * Regressão: uma conta fictícia SEM cenário de visitante (cadastro, pessoa de cenário fixo ou CK interna no mesmo
     * banco) não pode entrar por e-mail e senha na demonstração pública e, mesmo com um token válido, não alcança a
     * vitrine nem as empresas de cenários de visitantes (antes, a falta de cenário liberava tudo).
     */
    @Test
    void contaSemCenarioNaoAtravessaOIsolamento() throws Exception {
        Visitante dono = new Visitante("203.0.113.30");
        assertThat(dono.entrar("gestor").statusCode()).isEqualTo(200);
        String empresaDoVisitante = JSON.readTree(dono.rpc("minhas_empresas", "{}").body()).get(0).path("empresa_id").asText();

        java.util.UUID id = java.util.UUID.randomUUID();
        String email = "sem-cenario-" + id.toString().substring(0, 8) + "@autonick-teste.example";
        contas.criar(id, email, "Conta sem cenário", "senha-de-teste-123", null, "cliente", null, 900, null, null);
        jdbc.queryForObject("SELECT demo_auth.autorizar_cliente(?)::text", String.class, id);

        HttpResponse<String> entrada = HttpClient.newHttpClient().send(HttpRequest.newBuilder(uri("/api/auth/sign-in/email"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"" + email + "\",\"password\":\"senha-de-teste-123\"}")).build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(entrada.statusCode()).isEqualTo(403);

        String token = tokens.acesso(id.toString(), email, "Conta sem cenário");
        assertThat(dica(rpcComToken(token, "buscar_demonstracao", "{}"))).isEqualTo("TENANT_FORBIDDEN");
        assertThat(dica(rpcComToken(token, "vitrine_demonstracao", "{\"p_empresa_id\":\"" + empresaDoVisitante + "\"}"))).isEqualTo("TENANT_FORBIDDEN");
        assertThat(dica(rpcComToken(token, "empresas_para_pedido", "{}"))).isEqualTo("TENANT_FORBIDDEN");
        HttpResponse<String> cartao = HttpClient.newHttpClient().send(HttpRequest.newBuilder(
                uri("/api/dados/public_empresa_cards?empresa_id=eq." + empresaDoVisitante + "&select=*")).header("Authorization", "Bearer " + token)
                .GET().build(), HttpResponse.BodyHandlers.ofString());
        assertThat(cartao.statusCode()).isEqualTo(403);
    }

    private HttpResponse<String> rpcComToken(String token, String funcao, String corpo) throws Exception {
        return HttpClient.newHttpClient().send(HttpRequest.newBuilder(uri("/api/dados/rpc/" + funcao)).header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + token).POST(HttpRequest.BodyPublishers.ofString(corpo)).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private static Set<String> empresas(HttpResponse<String> r) throws Exception {
        Set<String> ids = new HashSet<>();
        JSON.readTree(r.body()).path("itens").forEach(i -> ids.add(i.path("empresa_id").asText()));
        return ids;
    }

    private static String dica(HttpResponse<String> r) throws Exception {
        return JSON.readTree(r.body()).path("hint").asText();
    }

    private URI uri(String caminho) {
        return URI.create("http://localhost:" + porta + caminho);
    }
}
