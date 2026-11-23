package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_ESCRITA;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.DONO_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.DONO_B;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.GESTOR_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.MEMBRO_SEM_VISAO;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.SEM_PERFIL;
import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.CenarioOs;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/**
 * J05: POST /api/business/ordens-servico/{osId}/iniciar chama mudar_estado_os com a ação fixa "iniciar". Cada teste usa
 * uma OS NOVA (aguardando início, versão 1) para não alterar o cenário compartilhado pelos testes do J01 e do J02.
 */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class IniciarOrdemServicoTest extends ApiComBancoBase {

    private HttpResponse<String> iniciar(String os, String sub, String corpo) {
        return post("/api/business/ordens-servico/" + os + "/iniciar", sub == null ? null : CHAVES.token(sub), corpo);
    }

    private static String corpo(int versao, String chave) {
        return "{\"versao\":" + versao + ",\"chave\":\"" + chave + "\"}";
    }

    private static String chave() {
        return "j05-" + UUID.randomUUID();
    }

    /** estado|versao|eventos "iniciar"|auditorias "servicos.os_iniciar" da OS, lidos direto no banco. */
    private static String situacao(CenarioOs c, String os) throws Exception {
        return c.adm("SELECT o.estado || '|' || o.versao || '|' "
                + "|| (SELECT count(*) FROM public.os_eventos e WHERE e.os_id = o.id AND e.tipo = 'iniciar') || '|' "
                + "|| (SELECT count(*) FROM app_private.eventos_auditoria a WHERE a.recurso_id = o.id AND a.tipo_acao = 'servicos.os_iniciar') "
                + "FROM public.ordens_servico o WHERE o.id = ?::uuid", os);
    }

    @Test
    void gestorIniciaComVersaoEChaveERepeticaoNaoDuplica() throws Exception {
        CenarioOs c = cenario();
        String os = c.novaOsParaEscrita();
        assertThat(situacao(c, os)).isEqualTo("aguardando_inicio|1|0|0");
        String k = chave();

        var r = iniciar(os, GESTOR_A, corpo(1, k));
        assertThat(r.statusCode()).isEqualTo(200);
        var json = CenarioOs.ler(r.body());
        assertThat(json.get("id").asText()).isEqualTo(os);
        assertThat(json.get("estado").asText()).isEqualTo("em_execucao");
        assertThat(json.get("versao").asInt()).isEqualTo(2);
        assertThat(situacao(c, os)).isEqualTo("em_execucao|2|1|1");
        // o detalhe pela rota de leitura mostra o novo estado
        assertThat(CenarioOs.ler(get("/api/business/ordens-servico/" + os, CHAVES.token(GESTOR_A)).body()).get("estado").asText())
                .isEqualTo("em_execucao");

        // repetição com a mesma chave e os mesmos dados: mesma resposta, sem novo evento nem nova versão
        var repetida = iniciar(os, GESTOR_A, corpo(1, k));
        assertThat(repetida.statusCode()).isEqualTo(200);
        assertThat(CenarioOs.ler(repetida.body())).isEqualTo(json);
        assertThat(situacao(c, os)).isEqualTo("em_execucao|2|1|1");

        // mesma chave com outros dados: conflito de idempotência, nada muda
        var outra = iniciar(os, GESTOR_A, corpo(2, k));
        assertThat(outra.statusCode()).isEqualTo(409);
        assertThat(codigo(outra)).isEqualTo("IDEMPOTENCY_CONFLICT");

        // chave nova, versão atual, mas a OS já está em execução: estado incompatível
        var deNovo = iniciar(os, GESTOR_A, corpo(2, chave()));
        assertThat(deNovo.statusCode()).isEqualTo(409);
        assertThat(codigo(deNovo)).isEqualTo("STATE_CONFLICT");
        assertThat(situacao(c, os)).isEqualTo("em_execucao|2|1|1");
    }

    @Test
    void versaoDesatualizadaNaoMudaNada() throws Exception {
        CenarioOs c = cenario();
        String os = c.novaOsParaEscrita();
        var r = iniciar(os, GESTOR_A, corpo(2, chave()));
        assertThat(r.statusCode()).isEqualTo(409);
        assertThat(codigo(r)).isEqualTo("VERSION_CONFLICT");
        assertThat(CenarioOs.ler(r.body()).get("mensagem").asText()).contains("mudou desde que você abriu a tela");
        assertThat(situacao(c, os)).isEqualTo("aguardando_inicio|1|0|0");
    }

    @Test
    void semPermissaoOuDeOutraEmpresaNaoInicia() throws Exception {
        CenarioOs c = cenario();
        String os = c.novaOsParaEscrita();
        var inexistente = iniciar(UUID.randomUUID().toString(), GESTOR_A, corpo(1, chave()));
        assertThat(inexistente.statusCode()).isEqualTo(404);
        assertThat(codigo(inexistente)).isEqualTo("NOT_FOUND");
        // cliente titular, gestor de outra empresa e pessoa sem perfil: o mesmo 404 da OS inexistente
        for (String sub : List.of(CLIENTE_ESCRITA, DONO_B, SEM_PERFIL)) {
            var r = iniciar(os, sub, corpo(1, chave()));
            assertThat(r.statusCode()).as(sub).isEqualTo(404);
            assertThat(r.body()).as(sub).isEqualTo(inexistente.body());
        }
        // membro da empresa sem servicos.alterar: 403 com a mensagem da função
        var membro = iniciar(os, MEMBRO_SEM_VISAO, corpo(1, chave()));
        assertThat(membro.statusCode()).isEqualTo(403);
        assertThat(codigo(membro)).isEqualTo("FORBIDDEN_ACTION");
        // sem token
        assertThat(iniciar(os, null, corpo(1, chave())).statusCode()).isEqualTo(401);
        assertThat(situacao(c, os)).isEqualTo("aguardando_inicio|1|0|0");
        // o dono da empresa pode
        assertThat(iniciar(os, DONO_A, corpo(1, chave())).statusCode()).isEqualTo(200);
        assertThat(situacao(c, os)).isEqualTo("em_execucao|2|1|1");
    }

    @Test
    void corpoSoAceitaVersaoEChave() throws Exception {
        CenarioOs c = cenario();
        String os = c.novaOsParaEscrita();
        List<String> invalidos = List.of(
                "{\"versao\":1,\"chave\":\"" + chave() + "\",\"acao\":\"concluir\"}",
                "{\"acao\":\"encerrar\",\"versao\":1,\"chave\":\"" + chave() + "\"}",
                "{\"versao\":1}",
                "{\"chave\":\"" + chave() + "\"}",
                "{\"versao\":0,\"chave\":\"" + chave() + "\"}",
                "{\"versao\":\"1\",\"chave\":\"" + chave() + "\"}",
                "{\"versao\":1.5,\"chave\":\"" + chave() + "\"}",
                "{\"versao\":1,\"chave\":\"curta\"}",
                "{\"versao\":1,\"chave\":\"tem espaco e ;\"}",
                "[1]",
                "não é json");
        for (String corpo : invalidos) {
            var r = iniciar(os, GESTOR_A, corpo);
            assertThat(r.statusCode()).as(corpo).isEqualTo(400);
            assertThat(codigo(r)).as(corpo).isEqualTo("VALIDATION_ERROR");
        }
        assertThat(iniciar("nao-e-uuid", GESTOR_A, corpo(1, chave())).statusCode()).isEqualTo(400);
        assertThat(situacao(c, os)).isEqualTo("aguardando_inicio|1|0|0");
    }

    @Test
    void outrasAcoesEMetodosContinuamFechados() throws Exception {
        CenarioOs c = cenario();
        String os = c.novaOsParaEscrita();
        // J09 abriu "encerrar" e "reabrir"; J10, "publicar-atualizacao", "atualizar-dados" e "registrar-garantia"
        // (AcompanhamentoOrdemServicoTest). As demais continuam fechadas.
        for (String acao : List.of("cancelar", "confirmar-recebimento", "gerar-proxima", "adicionar-material", "propor-horario")) {
            var r = post("/api/business/ordens-servico/" + os + "/" + acao, CHAVES.token(GESTOR_A), corpo(1, chave()));
            assertThat(r.statusCode()).as(acao).isEqualTo(403);
        }
        assertThat(post("/api/cliente/ordens-servico/" + os + "/iniciar", CHAVES.token(CLIENTE_ESCRITA), corpo(1, chave())).statusCode()).isEqualTo(403);
        assertThat(situacao(c, os)).isEqualTo("aguardando_inicio|1|0|0");
    }

    @Test
    void duasTentativasSimultaneasComAMesmaVersaoSoUmaPassa() throws Exception {
        CenarioOs c = cenario();
        String os = c.novaOsParaEscrita();
        CountDownLatch largada = new CountDownLatch(1);
        List<CompletableFuture<HttpResponse<String>>> pedidos = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            pedidos.add(CompletableFuture.supplyAsync(() -> {
                try {
                    largada.await();
                } catch (InterruptedException erro) {
                    Thread.currentThread().interrupt();
                }
                return iniciar(os, GESTOR_A, corpo(1, chave()));
            }));
        }
        largada.countDown();
        List<Integer> status = pedidos.stream().map(CompletableFuture::join).map(HttpResponse::statusCode).sorted().toList();
        assertThat(status).containsExactly(200, 409);
        assertThat(situacao(c, os)).isEqualTo("em_execucao|2|1|1");
    }
}
