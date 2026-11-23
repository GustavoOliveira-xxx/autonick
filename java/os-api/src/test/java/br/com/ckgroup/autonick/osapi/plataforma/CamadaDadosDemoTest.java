package br.com.ckgroup.autonick.osapi.plataforma;

import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Camada de dados pela API Java no modo demonstração, de ponta a ponta (HTTP → Spring Security → catálogo → PostgreSQL
 * com RLS e funções do app), sobre o cenário fictício montado pela própria API.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class CamadaDadosDemoTest {

    private static final HttpClient HTTP = HttpClient.newHttpClient();
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Map<String, String> TOKENS = new HashMap<>();

    @LocalServerPort
    int porta;

    @Autowired
    DataSource dataSource;

    @DynamicPropertySource
    static void propriedades(DynamicPropertyRegistry registro) {
        BancoDeTeste banco = BancoDeTeste.instancia();
        registro.add("spring.datasource.url", () -> banco.urlBanco);
        registro.add("spring.datasource.username", () -> banco.apiUsuario);
        registro.add("spring.datasource.password", () -> banco.apiSenha);
        registro.add("autonick.auth.modo", () -> "demo");
        registro.add("autonick.auth.segredo-demo", () -> "segredo-de-teste-da-demonstracao-0123456789");
        registro.add("autonick.demo.montar-cenario", () -> "true");
    }

    @BeforeEach
    void limpar() {
        if (TOKENS.size() > 20) TOKENS.clear();
    }

    @Test
    void entradaFicticiaComSenhaErradaRecusadaECertaAbreSessao() throws Exception {
        assertThat(entrar("gestor", "errada").statusCode()).isEqualTo(401);
        assertThat(entrar("nao-existe", "demo1234").statusCode()).isEqualTo(401);
        assertThat(token("gestor")).isNotBlank();
    }

    @Test
    void vendaBaixaEstoqueUmaVezERepeticaoNaoDuplica() throws Exception {
        String g = token("gestor");
        String empresa = empresaDe(g);
        JsonNode variacao = variacao(g, empresa, "Película de vidro");
        int antes = variacao.path("fisico").asInt();
        String chave = "teste-" + UUID.randomUUID();
        String corpo = "{\"p_empresa_id\":\"" + empresa + "\",\"p_dados\":{},\"p_itens\":[{\"variacao_id\":\"" + variacao.path("id").asText()
                + "\",\"quantidade\":2}],\"p_pagamento\":{\"recebimento_inicial\":{\"valor_centavos\":7000,\"forma\":\"pix\"}},"
                + "\"p_total_esperado_centavos\":null,\"p_operation_key\":\"" + chave + "\"}";
        HttpResponse<String> primeira = rpc(g, "registrar_venda_direta", corpo);
        HttpResponse<String> repetida = rpc(g, "registrar_venda_direta", corpo);
        assertThat(primeira.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(repetida.body()).path("id").asText()).isEqualTo(JSON.readTree(primeira.body()).path("id").asText());
        assertThat(variacao(g, empresa, "Película de vidro").path("fisico").asInt()).isEqualTo(antes - 2);

        HttpResponse<String> outrosDados = rpc(g, "registrar_venda_direta", corpo.replace("\"quantidade\":2", "\"quantidade\":1"));
        assertThat(outrosDados.statusCode()).isEqualTo(409);
        assertThat(dica(outrosDados)).isEqualTo("IDEMPOTENCY_CONFLICT");
        HttpResponse<String> semEstoque = rpc(g, "registrar_venda_direta",
                corpo.replace("\"quantidade\":2", "\"quantidade\":9999").replace(chave, chave + "-b"));
        assertThat(dica(semEstoque)).isEqualTo("INSUFFICIENT_STOCK");
        assertThat(variacao(g, empresa, "Película de vidro").path("fisico").asInt()).isEqualTo(antes - 2);
    }

    @Test
    void funcionariaComPerfilLimitadoNaoVeFinanceiroMasVeVendas() throws Exception {
        String empresa = empresaDe(token("gestor"));
        String f = token("funcionario");
        assertThat(dica(rpc(f, "painel_financeiro", "{\"p_empresa_id\":\"" + empresa + "\"}"))).isEqualTo("FORBIDDEN_ACTION");
        assertThat(rpc(f, "vendas_da_empresa", "{\"p_empresa_id\":\"" + empresa + "\"}").statusCode()).isEqualTo(200);
    }

    @Test
    void gestorDeOutraEmpresaNaoAcessaDadosDaAssistencia() throws Exception {
        String empresa = empresaDe(token("gestor"));
        String outra = token("gestora-loja");
        assertThat(dica(rpc(outra, "produtos_da_empresa", "{\"p_empresa_id\":\"" + empresa + "\"}"))).isEqualTo("TENANT_FORBIDDEN");
        HttpResponse<String> tabela = get(outra, "/api/dados/fornecedores?empresa_id=eq." + empresa + "&select=id,nome");
        assertThat(tabela.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(tabela.body()).size()).isZero();
    }

    @Test
    void painelCkConferidoNoJavaENoBanco() throws Exception {
        assertThat(dica(rpc(token("gestor"), "ck_listar_empresas", "{}"))).isEqualTo("FORBIDDEN_ACTION");
        assertThat(get(token("gestor"), "/api/dados/solicitacoes_publicacao?estado=eq.aberta&select=id").statusCode()).isEqualTo(403);
        assertThat(rpc(token("ck"), "ck_listar_empresas", "{}").statusCode()).isEqualTo(200);
    }

    @Test
    void catalogoFechadoParametrosEConsultasValidados() throws Exception {
        String g = token("gestor");
        assertThat(rpc(g, "diagnostico_sessao", "{}").statusCode()).isEqualTo(404);
        assertThat(rpc(g, "pg_sleep", "{}").statusCode()).isEqualTo(404);
        assertThat(dica(rpc(g, "minhas_permissoes", "{\"p_empresa_id\":\"x\",\"p_extra\":1}"))).isEqualTo("VALIDATION_ERROR");
        assertThat(rpc(g, "minhas_permissoes", "{\"p_empresa_id\":\"nao-e-uuid\"}").statusCode()).isEqualTo(400);
        assertThat(get(g, "/api/dados/pg_authid?select=*").statusCode()).isEqualTo(404);
        assertThat(get(g, "/api/dados/empresas?select=id;drop%20table%20empresas").statusCode()).isEqualTo(400);
        assertThat(get(g, "/api/dados/empresas?id=eq.x%27%20or%201=1--&select=id").statusCode()).isEqualTo(400);
        assertThat(get(g, "/api/dados/empresas?senha=eq.1&select=id").statusCode()).isEqualTo(400);
    }

    @Test
    void visitanteAnonimoSoChamaAVitrinePublica() throws Exception {
        String anonimo = JSON.readTree(HTTP.send(HttpRequest.newBuilder(uri("/api/auth/token/anonymous")).GET().build(),
                HttpResponse.BodyHandlers.ofString()).body()).path("token").asText();
        assertThat(rpc(anonimo, "filtros_vitrine", "{}").statusCode()).isEqualTo(200);
        assertThat(rpc(anonimo, "minhas_empresas", "{}").statusCode()).isEqualTo(401);
        assertThat(get(anonimo, "/api/dados/empresas?select=id").statusCode()).isEqualTo(403);
        assertThat(get(anonimo, "/api/cliente/ordens-servico").statusCode()).isEqualTo(403);
        assertThat(rpc(null, "filtros_vitrine", "{}").statusCode()).isEqualTo(401);
    }

    @Test
    void cookieDeSessaoNaoValeComoTokenDeAcesso() throws Exception {
        HttpResponse<String> r = entrar("gestor", "demo1234");
        String cookie = r.headers().firstValue("set-cookie").orElseThrow().split(";")[0].split("=", 2)[1];
        assertThat(rpc(cookie, "minhas_empresas", "{}").statusCode()).isEqualTo(401);
        assertThat(rpc(token("gestor") + "x", "minhas_empresas", "{}").statusCode()).isEqualTo(401);
    }

    @Test
    void entradaRecusaOutraOrigem() throws Exception {
        HttpRequest pedido = HttpRequest.newBuilder(uri("/api/auth/sign-in/email")).header("Content-Type", "application/json")
                .header("Origin", "https://site-malicioso.example")
                .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"gestor@autonick-teste.example\",\"password\":\"demo1234\"}")).build();
        assertThat(HTTP.send(pedido, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
    }

    @Test
    void conexaoVoltaAoPoolSemPapelNemIdentidadeDepoisDeSucessoEDeErro() throws Exception {
        String g = token("gestor");
        rpc(g, "minhas_empresas", "{}");
        rpc(g, "ck_listar_empresas", "{}");
        rpc(g, "minhas_permissoes", "{\"p_empresa_id\":\"nao-e-uuid\"}");
        for (int i = 0; i < 12; i++) {
            try (Connection c = dataSource.getConnection(); Statement s = c.createStatement();
                    ResultSet r = s.executeQuery("SELECT current_user, coalesce(current_setting('request.jwt.claims', true), '')")) {
                r.next();
                assertThat(r.getString(1)).isEqualTo(BancoDeTeste.instancia().apiUsuario);
                assertThat(r.getString(2)).isEmpty();
            }
        }
    }

    @Test
    void politicaDaDemonstracaoPublicaBloqueiaPainelCk() {
        PoliticaDados publica = new PoliticaDados(true, 60, 600, null, Set.of("atualizar_empresa"));
        assertThat(publica.bloqueada(Dominio.ADMIN_CK, "ck_listar_empresas")).isTrue();
        assertThat(publica.bloqueada(Dominio.ADMIN_CK, "sou_ck_admin")).isFalse();
        assertThat(publica.bloqueada(Dominio.EMPRESAS_EQUIPE, "atualizar_empresa")).isTrue();
        assertThat(publica.bloqueada(Dominio.VENDAS_PEDIDOS, "registrar_venda_direta")).isFalse();
        assertThat(new PoliticaDados(false, 0, 0, null, null).bloqueada(Dominio.ADMIN_CK, "ck_listar_empresas")).isFalse();
    }

    // ------------------------------------------------------------------------------------------------- apoio

    private String token(String pessoa) throws Exception {
        String atual = TOKENS.get(pessoa);
        if (atual != null) return atual;
        HttpResponse<String> entrada = entrar(pessoa, "demo1234");
        assertThat(entrada.statusCode()).as("entrada de %s", pessoa).isEqualTo(200);
        String cookie = entrada.headers().firstValue("set-cookie").orElseThrow().split(";")[0];
        HttpResponse<String> sessao = HTTP.send(HttpRequest.newBuilder(uri("/api/auth/get-session")).header("Cookie", cookie).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        String token = sessao.headers().firstValue("set-auth-jwt").orElseThrow();
        TOKENS.put(pessoa, token);
        return token;
    }

    private HttpResponse<String> entrar(String pessoa, String senha) throws Exception {
        return HTTP.send(HttpRequest.newBuilder(uri("/api/auth/sign-in/email")).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"" + pessoa + "@autonick-teste.example\",\"password\":\"" + senha + "\"}"))
                .build(), HttpResponse.BodyHandlers.ofString());
    }

    private String empresaDe(String token) throws Exception {
        return JSON.readTree(rpc(token, "minhas_empresas", "{}").body()).get(0).path("empresa_id").asText();
    }

    private JsonNode variacao(String token, String empresa, String produto) throws Exception {
        for (JsonNode p : JSON.readTree(rpc(token, "produtos_da_empresa", "{\"p_empresa_id\":\"" + empresa + "\"}").body())) {
            if (p.path("nome").asText().equals(produto)) return p.path("variacoes").get(0);
        }
        throw new AssertionError("produto não encontrado: " + produto);
    }

    private HttpResponse<String> rpc(String token, String funcao, String corpo) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(uri("/api/dados/rpc/" + funcao)).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(corpo));
        if (token != null) b.header("Authorization", "Bearer " + token);
        return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> get(String token, String caminho) throws Exception {
        return HTTP.send(HttpRequest.newBuilder(URI.create("http://localhost:" + porta + caminho)).header("Authorization", "Bearer " + token)
                .GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private static String dica(HttpResponse<String> r) throws Exception {
        return JSON.readTree(r.body()).path("hint").asText();
    }

    private URI uri(String caminho) {
        return URI.create("http://localhost:" + porta + caminho);
    }
}
