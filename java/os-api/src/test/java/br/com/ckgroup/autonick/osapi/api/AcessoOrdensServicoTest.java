package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_1;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_2;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.DONO_B;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.GESTOR_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.MEMBRO_SEM_VISAO;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.SEM_PERFIL;
import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.CenarioOs;
import java.net.URLEncoder;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/** Plano J01 §2 e §4: quem vê quais OS, paridade com a função SQL, robustez e concorrência. */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class AcessoOrdensServicoTest extends ApiComBancoBase {

    private String minhas(String sub) {
        HttpResponse<String> r = get("/api/cliente/ordens-servico", CHAVES.token(sub));
        assertThat(r.statusCode()).as("status para %s", sub).isEqualTo(200);
        return r.body();
    }

    private HttpResponse<String> daEmpresa(String sub, String empresa, String consulta) {
        return get("/api/empresas/" + empresa + "/ordens-servico" + consulta, CHAVES.token(sub));
    }

    @Test
    @DisplayName("A1: Cliente 1 vê só as próprias 2 OS (uma em cada empresa)")
    void a1() {
        CenarioOs c = cenario();
        assertThat(ids(minhas(CLIENTE_1))).isEqualTo(Set.of(c.os1, c.os3));
    }

    @Test
    @DisplayName("A2: Cliente 2 vê só a própria OS; nenhuma do Cliente 1")
    void a2() {
        CenarioOs c = cenario();
        assertThat(ids(minhas(CLIENTE_2))).isEqualTo(Set.of(c.os2));
    }

    @Test
    @DisplayName("A3: token válido de quem não tem vínculo recebe lista vazia")
    void a3() {
        cenario();
        assertThat(ids(minhas(SEM_PERFIL))).isEmpty();
    }

    @Test
    @DisplayName("A4: Gestor A (por convite) vê as OS da Elétrica A e nenhuma da Empresa B")
    void a4() {
        CenarioOs c = cenario();
        HttpResponse<String> r = daEmpresa(GESTOR_A, c.empresaA, "");
        assertThat(r.statusCode()).isEqualTo(200);
        assertThat(ids(r.body())).isEqualTo(Set.of(c.os1, c.os2)).doesNotContain(c.os3);
    }

    @Test
    @DisplayName("A5 a A8: outra empresa, dono de outra empresa, membro sem servicos.visualizar e cliente recebem 403")
    void a5a8() {
        CenarioOs c = cenario();
        for (Object[] caso : new Object[][] {
                {GESTOR_A, c.empresaB, "A5 Gestor A na Empresa B"},
                {DONO_B, c.empresaA, "A6 Dono B na Elétrica A"},
                {MEMBRO_SEM_VISAO, c.empresaA, "A7 membro sem servicos.visualizar"},
                {CLIENTE_1, c.empresaA, "A8 Cliente 1 no endpoint da empresa"}}) {
            HttpResponse<String> r = daEmpresa((String) caso[0], (String) caso[1], "");
            assertThat(r.statusCode()).as((String) caso[2]).isEqualTo(403);
            assertThat(codigo(r)).as((String) caso[2]).isIn("TENANT_FORBIDDEN", "FORBIDDEN_ACTION");
            assertThat(r.body()).as((String) caso[2]).doesNotContain(c.os1, c.os2, c.os3);
        }
    }

    @Test
    @DisplayName("A9: empresa adulterada: UUID inexistente dá 403; texto que não é UUID dá 400")
    void a9() {
        cenario();
        assertThat(daEmpresa(GESTOR_A, UUID.randomUUID().toString(), "").statusCode()).isEqualTo(403);
        HttpResponse<String> r = daEmpresa(GESTOR_A, "nao-e-uuid", "");
        assertThat(r.statusCode()).isEqualTo(400);
        assertThat(codigo(r)).isEqualTo("VALIDATION_ERROR");
    }

    @Test
    @DisplayName("A10: a resposta da API é igual à da função SQL chamada direto com a mesma identidade")
    void a10() throws Exception {
        CenarioOs c = cenario();
        for (String sub : List.of(CLIENTE_1, CLIENTE_2, SEM_PERFIL, GESTOR_A)) {
            assertThat(CenarioOs.ler(minhas(sub))).as("minhas_os de %s", sub)
                    .isEqualTo(CenarioOs.ler(c.comoUsuario(sub, "SELECT public.minhas_os()::text")));
        }
        HttpResponse<String> api = daEmpresa(GESTOR_A, c.empresaA, "");
        String direto = c.comoUsuario(GESTOR_A, "SELECT public.ordens_da_empresa(?::uuid, '{}'::jsonb, 50, 0)::text", c.empresaA);
        assertThat(CenarioOs.ler(api.body())).isEqualTo(CenarioOs.ler(direto));
    }

    @Test
    @DisplayName("R1: paginação inválida (limite 0 ou 101, deslocamento -1, limite não numérico) dá 400")
    void r1() {
        CenarioOs c = cenario();
        for (String consulta : List.of("?limite=0", "?limite=101", "?deslocamento=-1", "?limite=abc")) {
            HttpResponse<String> r = daEmpresa(GESTOR_A, c.empresaA, consulta);
            assertThat(r.statusCode()).as(consulta).isEqualTo(400);
            assertThat(codigo(r)).as(consulta).isEqualTo("VALIDATION_ERROR");
        }
    }

    @Test
    @DisplayName("R2: filtros com aspas, ponto e vírgula e comentário SQL não quebram nem vazam nada")
    void r2() throws Exception {
        CenarioOs c = cenario();
        String antes = c.adm("SELECT count(*)::text FROM public.ordens_servico");
        for (String valor : List.of("'; DROP TABLE public.ordens_servico; --", "\" OR 1=1 --", "x'/*", "{\"estado\":")) {
            String q = URLEncoder.encode(valor, StandardCharsets.UTF_8);
            HttpResponse<String> r = daEmpresa(GESTOR_A, c.empresaA, "?busca=" + q + "&estado=" + q);
            assertThat(r.statusCode()).as(valor).isEqualTo(200);
            assertThat(ids(r.body())).as(valor).isSubsetOf(Set.of(c.os1, c.os2));
        }
        assertThat(c.adm("SELECT count(*)::text FROM public.ordens_servico")).isEqualTo(antes);
    }

    @Test
    @DisplayName("R5: sem CORS: nenhuma resposta traz Access-Control-Allow-Origin")
    void r5() throws Exception {
        cenario();
        HttpResponse<String> r = get("/api/cliente/ordens-servico", CHAVES.token(CLIENTE_1), "Origin", "https://outro-site.example");
        assertThat(r.headers().firstValue("Access-Control-Allow-Origin")).isEmpty();
        var preflight = java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://localhost:" + porta + "/api/cliente/ordens-servico"))
                .method("OPTIONS", java.net.http.HttpRequest.BodyPublishers.noBody())
                .header("Origin", "https://outro-site.example").header("Access-Control-Request-Method", "GET").build();
        HttpResponse<String> p = HTTP.send(preflight, HttpResponse.BodyHandlers.ofString());
        assertThat(p.headers().firstValue("Access-Control-Allow-Origin")).isEmpty();
        assertThat(p.statusCode()).isGreaterThanOrEqualTo(400);
    }

    @Test
    @DisplayName("T6: 200 pedidos em paralelo, alternando Cliente 1, Cliente 2 e Gestor A: nenhuma OS de outra pessoa")
    void t6() throws Exception {
        CenarioOs c = cenario();
        ExecutorService executor = Executors.newFixedThreadPool(16);
        try {
            List<Future<String>> futuros = new ArrayList<>();
            for (int i = 0; i < 200; i++) {
                int caso = i % 3;
                futuros.add(executor.submit(() -> {
                    Set<String> esperado;
                    HttpResponse<String> r;
                    if (caso == 0) { r = get("/api/cliente/ordens-servico", CHAVES.token(CLIENTE_1)); esperado = Set.of(c.os1, c.os3); }
                    else if (caso == 1) { r = get("/api/cliente/ordens-servico", CHAVES.token(CLIENTE_2)); esperado = Set.of(c.os2); }
                    else { r = daEmpresa(GESTOR_A, c.empresaA, ""); esperado = Set.of(c.os1, c.os2); }
                    if (r.statusCode() != 200) return "status " + r.statusCode();
                    return ids(r.body()).equals(esperado) ? "ok" : "vazou: " + ids(r.body());
                }));
            }
            for (Future<String> f : futuros) assertThat(f.get()).isEqualTo("ok");
        } finally {
            executor.shutdownNow();
        }
    }
}
