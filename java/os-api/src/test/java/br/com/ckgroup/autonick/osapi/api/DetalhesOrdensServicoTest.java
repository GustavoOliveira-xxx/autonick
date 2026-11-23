package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_1;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_2;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.GESTOR_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.MEMBRO_SEM_VISAO;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.SEM_PERFIL;
import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.CenarioOs;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class DetalhesOrdensServicoTest extends ApiComBancoBase {

    private static final String CLIENTE = "/api/cliente/ordens-servico/";
    private static final String BUSINESS = "/api/business/ordens-servico/";

    private HttpResponse<String> detalhe(String rota, String id, String sub) {
        return get(rota + id, CHAVES.token(sub));
    }

    @Test
    void detalheDoClienteMantemParidadeEmEmpresasDiferentes() throws Exception {
        CenarioOs c = cenario();
        for (String id : List.of(c.os1, c.os3)) {
            var r = detalhe(CLIENTE, id, CLIENTE_1);
            assertThat(r.statusCode()).isEqualTo(200);
            assertThat(r.headers().firstValue("Content-Type")).hasValueSatisfying(t -> assertThat(t).startsWith("application/json"));
            var corpo = CenarioOs.ler(r.body());
            assertThat(corpo.get("id").asText()).isEqualTo(id);
            assertThat(corpo).isEqualTo(CenarioOs.ler(c.comoUsuario(CLIENTE_1, "SELECT public.minha_os(?::uuid)::text", id)));
            for (String campo : List.of("pode", "equipe", "materiais", "ver_custo", "responsavel_auth_id")) {
                assertThat(corpo.has(campo)).as(campo).isFalse();
            }
        }
    }

    @Test
    void detalheDaEmpresaMantemParidadeParaGestorConvidado() throws Exception {
        CenarioOs c = cenario();
        var r = detalhe(BUSINESS, c.os1, GESTOR_A);
        assertThat(r.statusCode()).isEqualTo(200);
        var corpo = CenarioOs.ler(r.body());
        assertThat(corpo).isEqualTo(CenarioOs.ler(c.comoUsuario(GESTOR_A, "SELECT public.os_detalhe(?::uuid)::text", c.os1)));
        assertThat(corpo.get("empresa_id").asText()).isEqualTo(c.empresaA);
        assertThat(corpo.has("equipe")).isTrue();
    }

    @Test
    void notaInternaNaoSaiNoDetalheDoCliente() throws Exception {
        CenarioOs c = cenario();
        String nota = "Nota interna fictícia do teste J02.";
        String atualizacao = "Atualização pública fictícia do teste J02.";
        String publicar = "SELECT public.publicar_atualizacao_os(?::uuid, ?, ?, ?)::text";
        c.comoUsuario(GESTOR_A, publicar, c.os2, nota, false, "j02-nota-interna");
        c.comoUsuario(GESTOR_A, publicar, c.os2, atualizacao, true, "j02-atualizacao-publica");
        var empresa = detalhe(BUSINESS, c.os2, GESTOR_A);
        var cliente = detalhe(CLIENTE, c.os2, CLIENTE_2);
        assertThat(empresa.statusCode()).isEqualTo(200);
        assertThat(cliente.statusCode()).isEqualTo(200);
        assertThat(empresa.body()).contains(nota, atualizacao);
        assertThat(cliente.body()).contains(atualizacao).doesNotContain(nota);
    }

    @Test
    void osDeTerceiroEInexistenteTemMesmaResposta() {
        CenarioOs c = cenario();
        String ausente = UUID.randomUUID().toString();
        var cliente = detalhe(CLIENTE, ausente, CLIENTE_2);
        var empresa = detalhe(BUSINESS, ausente, GESTOR_A);
        assertThat(cliente.statusCode()).isEqualTo(404);
        assertThat(empresa.statusCode()).isEqualTo(404);
        assertThat(codigo(cliente)).isEqualTo("NOT_FOUND");
        assertThat(empresa.body()).isEqualTo(cliente.body());
        for (var r : List.of(detalhe(CLIENTE, c.os1, CLIENTE_2), detalhe(CLIENTE, c.os1, SEM_PERFIL),
                detalhe(BUSINESS, c.os3, GESTOR_A), detalhe(BUSINESS, c.os1, MEMBRO_SEM_VISAO),
                detalhe(BUSINESS, c.os1, CLIENTE_1))) {
            assertThat(r.statusCode()).isEqualTo(404);
            assertThat(r.body()).isEqualTo(cliente.body());
        }
    }
}
