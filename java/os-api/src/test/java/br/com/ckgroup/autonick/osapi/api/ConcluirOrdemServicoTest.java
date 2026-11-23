package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_ESCRITA;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.DONO_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.DONO_B;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.GESTOR_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.MEMBRO_SEM_VISAO;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.SEM_PERFIL;
import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.CenarioOs;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/**
 * J07 (ADR-J02): POST .../concluir ("Informar conclusão"). Regras da função SQL mudar_estado_os: só de em_execucao para
 * concluida, com servicos.alterar; libera reservas de material e cria UMA conta a receber do saldo (contratado menos o
 * sinal), sem recebimento; o Cliente vê a conclusão e pode confirmar o recebimento ou pedir revisão (fora deste recorte).
 * Cada teste usa OS NOVAS na empresa de escrita, sem alterar o cenário das leituras.
 */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class ConcluirOrdemServicoTest extends ApiComBancoBase {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String BASE = "/api/business/ordens-servico/";
    private static final String MOTIVO_PAUSA = "Pausa interna fictícia antes da conclusão (J07).";

    private HttpResponse<String> acao(String acao, String os, String sub, Object corpo) {
        try {
            String texto = corpo instanceof String s ? s : JSON.writeValueAsString(corpo);
            return post(BASE + os + "/" + acao, sub == null ? null : CHAVES.token(sub), texto);
        } catch (Exception erro) {
            throw new IllegalStateException(erro);
        }
    }

    private static Map<String, Object> corpo(Object... pares) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < pares.length; i += 2) m.put((String) pares[i], pares[i + 1]);
        return m;
    }

    private static String chave() {
        return "j07-" + UUID.randomUUID();
    }

    private static Map<String, Object> pedido(int versao) {
        return corpo("versao", versao, "chave", chave());
    }

    /** OS nova da cliente de escrita, iniciada pela API (em execução, versão 2). */
    private String osEmExecucao(CenarioOs c) throws Exception {
        String os = c.novaOsParaEscrita();
        assertThat(acao("iniciar", os, GESTOR_A, pedido(1)).statusCode()).isEqualTo(200);
        return os;
    }

    /** estado|versao|eventos concluir|auditoria servicos.os_concluir|contas do saldo (quantidade:total)|auditoria da conta. */
    static String situacao(CenarioOs c, String os) throws Exception {
        return c.adm("SELECT o.estado || '|' || o.versao || '|' "
                + "|| (SELECT count(*) FROM public.os_eventos e WHERE e.os_id = o.id AND e.tipo = 'concluir') || '|' "
                + "|| (SELECT count(*) FROM app_private.eventos_auditoria a WHERE a.recurso_id = o.id AND a.tipo_acao = 'servicos.os_concluir') || '|' "
                + "|| (SELECT count(*) || ':' || coalesce(sum(t.total), 0)::numeric(12,2) FROM public.titulos_financeiros t "
                + "    WHERE t.origem_tipo = 'servico' AND t.origem_id = o.id AND t.parte_servico = 'saldo' AND t.estado <> 'cancelado') || '|' "
                + "|| (SELECT count(*) FROM app_private.eventos_auditoria a WHERE a.tipo_acao = 'financeiro.titulo_de_servico' AND a.recurso_id IN "
                + "    (SELECT t.id FROM public.titulos_financeiros t WHERE t.origem_id = o.id)) "
                + "FROM public.ordens_servico o WHERE o.id = ?::uuid", os);
    }

    private static String chaveGravada(CenarioOs c, String chave) throws Exception {
        return c.adm("SELECT count(*)::text FROM app_private.operacoes_idempotentes WHERE funcao = 'mudar_estado_os' AND chave = ?", chave);
    }

    @Test
    void fluxoCompletoIniciarPausarRetomarConcluir() throws Exception {
        CenarioOs c = cenario();
        String os = osEmExecucao(c);
        assertThat(acao("pausar", os, GESTOR_A, corpo("versao", 2, "chave", chave(), "motivo", MOTIVO_PAUSA)).statusCode()).isEqualTo(200);
        assertThat(acao("retomar", os, GESTOR_A, pedido(3)).statusCode()).isEqualTo(200);
        assertThat(situacao(c, os)).isEqualTo("em_execucao|4|0|0|0:0.00|0");

        var r = acao("concluir", os, GESTOR_A, pedido(4));
        assertThat(r.statusCode()).isEqualTo(200);
        JsonNode empresa = CenarioOs.ler(r.body());
        assertThat(empresa.get("estado").asText()).isEqualTo("concluida");
        assertThat(empresa.get("versao").asInt()).isEqualTo(5);
        assertThat(empresa.has("pode")).as("resposta é a leitura nova autorizada da empresa").isTrue();
        assertThat(empresa.at("/encerramento/empresa_pode_encerrar").asBoolean()).as("encerrar só depois de 7 dias ou da confirmação").isFalse();
        // uma conta a receber do saldo (R$ 180,00 contratados, sem sinal), sem recebimento
        assertThat(situacao(c, os)).isEqualTo("concluida|5|1|1|1:180.00|1");
        assertThat(c.adm("SELECT coalesce(sum(recebido), 0)::numeric(12,2)::text FROM public.titulos_financeiros WHERE origem_id = ?::uuid", os)).isEqualTo("0.00");
        assertThat(empresa.at("/valores/titulos").size()).isEqualTo(1);

        // o Cliente vê a conclusão e o valor pendente, sem dados internos da empresa
        var detalheCliente = get("/api/cliente/ordens-servico/" + os, CHAVES.token(CLIENTE_ESCRITA));
        assertThat(detalheCliente.statusCode()).isEqualTo(200);
        JsonNode cliente = CenarioOs.ler(detalheCliente.body());
        assertThat(cliente.get("estado").asText()).isEqualTo("concluida");
        assertThat(cliente.get("revisao_pendente").asBoolean()).isFalse();
        assertThat(cliente.at("/valores/saldo_pendente_centavos").asInt()).isEqualTo(18000);
        assertThat(cliente.at("/valores").has("titulos")).isFalse();
        assertThat(cliente.at("/valores").has("titulado_centavos")).isFalse();
        for (String interno : List.of("pode", "equipe", "materiais", "responsavel_auth_id", "ver_custo")) {
            assertThat(cliente.has(interno)).as(interno).isFalse();
        }
        assertThat(detalheCliente.body()).doesNotContain(MOTIVO_PAUSA);
        assertThat(cliente.findValues("tipo").stream().map(JsonNode::asText).toList()).contains("concluir").doesNotContain("pausar");
        var lista = get("/api/cliente/ordens-servico", CHAVES.token(CLIENTE_ESCRITA));
        assertThat(lista.body()).doesNotContain(MOTIVO_PAUSA);
        boolean listada = false;
        for (JsonNode item : CenarioOs.ler(lista.body())) {
            if (item.get("id").asText().equals(os)) {
                listada = true;
                assertThat(item.get("estado").asText()).isEqualTo("concluida");
            }
        }
        assertThat(listada).isTrue();
    }

    @Test
    void soConcluiOsEmExecucaoComAVersaoAtual() throws Exception {
        CenarioOs c = cenario();
        String aguardando = c.novaOsParaEscrita();
        var r1 = acao("concluir", aguardando, GESTOR_A, pedido(1));
        assertThat(r1.statusCode()).isEqualTo(409);
        assertThat(codigo(r1)).isEqualTo("STATE_CONFLICT");
        assertThat(situacao(c, aguardando)).isEqualTo("aguardando_inicio|1|0|0|0:0.00|0");

        String pausada = osEmExecucao(c);
        assertThat(acao("pausar", pausada, GESTOR_A, corpo("versao", 2, "chave", chave(), "motivo", MOTIVO_PAUSA)).statusCode()).isEqualTo(200);
        var r2 = acao("concluir", pausada, GESTOR_A, pedido(3));
        assertThat(r2.statusCode()).isEqualTo(409);
        assertThat(codigo(r2)).isEqualTo("STATE_CONFLICT");
        assertThat(situacao(c, pausada)).isEqualTo("pausada|3|0|0|0:0.00|0");

        String os = osEmExecucao(c);
        var velha = acao("concluir", os, GESTOR_A, pedido(1));
        assertThat(velha.statusCode()).isEqualTo(409);
        assertThat(codigo(velha)).isEqualTo("VERSION_CONFLICT");
        assertThat(situacao(c, os)).isEqualTo("em_execucao|2|0|0|0:0.00|0");
        assertThat(acao("concluir", os, GESTOR_A, pedido(2)).statusCode()).isEqualTo(200);
        var deNovo = acao("concluir", os, GESTOR_A, pedido(3));
        assertThat(deNovo.statusCode()).isEqualTo(409);
        assertThat(codigo(deNovo)).isEqualTo("STATE_CONFLICT");
        assertThat(situacao(c, os)).isEqualTo("concluida|3|1|1|1:180.00|1");
    }

    @Test
    void quemNaoPodeAlterarNaoConcluiECorpoEstrito() throws Exception {
        CenarioOs c = cenario();
        String os = osEmExecucao(c);
        String soVer = "eb0a0100-0000-4000-8000-000000000070";
        c.novoMembroDaEmpresaEscrita(soVer, "so-ver-j07", "servicos.visualizar");
        var inexistente = acao("concluir", UUID.randomUUID().toString(), GESTOR_A, pedido(2));
        assertThat(inexistente.statusCode()).isEqualTo(404);
        for (String sub : List.of(CLIENTE_ESCRITA, DONO_B, SEM_PERFIL)) {
            var r = acao("concluir", os, sub, pedido(2));
            assertThat(r.statusCode()).as(sub).isEqualTo(404);
            assertThat(r.body()).as(sub).isEqualTo(inexistente.body());
        }
        for (String sub : List.of(MEMBRO_SEM_VISAO, soVer)) {
            var r = acao("concluir", os, sub, pedido(2));
            assertThat(r.statusCode()).as(sub).isEqualTo(403);
            assertThat(codigo(r)).isEqualTo("FORBIDDEN_ACTION");
        }
        assertThat(acao("concluir", os, null, pedido(2)).statusCode()).isEqualTo(401);
        for (Object invalido : List.of(
                corpo("versao", 2, "chave", chave(), "motivo", "Serviço concluído, texto livre."),
                corpo("versao", 2, "chave", chave(), "acao", "encerrar"),
                corpo("versao", 2, "chave", chave(), "texto", "x"),
                corpo("versao", 2),
                corpo("chave", chave()),
                "não é json")) {
            var r = acao("concluir", os, GESTOR_A, invalido);
            assertThat(r.statusCode()).as(String.valueOf(invalido)).isEqualTo(400);
            assertThat(codigo(r)).isEqualTo("VALIDATION_ERROR");
        }
        assertThat(situacao(c, os)).isEqualTo("em_execucao|2|0|0|0:0.00|0");
        assertThat(acao("concluir", os, DONO_A, pedido(2)).statusCode()).isEqualTo(200);
        assertThat(situacao(c, os)).isEqualTo("concluida|3|1|1|1:180.00|1");
    }

    @Test
    void duasTentativasSimultaneasCriamUmaUnicaConta() throws Exception {
        CenarioOs c = cenario();
        String os = osEmExecucao(c);
        CountDownLatch largada = new CountDownLatch(1);
        List<CompletableFuture<HttpResponse<String>>> pedidos = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            pedidos.add(CompletableFuture.supplyAsync(() -> {
                try {
                    largada.await();
                } catch (InterruptedException erro) {
                    Thread.currentThread().interrupt();
                }
                return acao("concluir", os, GESTOR_A, pedido(2));
            }));
        }
        largada.countDown();
        List<Integer> status = pedidos.stream().map(CompletableFuture::join).map(HttpResponse::statusCode).sorted().toList();
        assertThat(status).containsExactly(200, 409);
        assertThat(situacao(c, os)).isEqualTo("concluida|3|1|1|1:180.00|1");
    }

    @Test
    void respostaPerdidaReenvioComAMesmaChaveNaoDuplicaContaNemEvento() throws Exception {
        CenarioOs c = cenario();
        String os = osEmExecucao(c);
        String k = chave();
        String pedido = JSON.writeValueAsString(corpo("versao", 2, "chave", k));

        assertThat(postDescartandoResposta(BASE + os + "/concluir", CHAVES.token(GESTOR_A), pedido)).isEqualTo(200);
        assertThat(situacao(c, os)).isEqualTo("concluida|3|1|1|1:180.00|1");
        assertThat(chaveGravada(c, k)).isEqualTo("1");

        var reenvio = post(BASE + os + "/concluir", CHAVES.token(GESTOR_A), pedido);
        assertThat(reenvio.statusCode()).isEqualTo(200);
        assertThat(CenarioOs.ler(reenvio.body()).get("estado").asText()).isEqualTo("concluida");
        assertThat(CenarioOs.ler(reenvio.body()).get("versao").asInt()).isEqualTo(3);
        assertThat(situacao(c, os)).isEqualTo("concluida|3|1|1|1:180.00|1");
        assertThat(chaveGravada(c, k)).isEqualTo("1");

        var outraVersao = acao("concluir", os, GESTOR_A, corpo("versao", 3, "chave", k));
        assertThat(outraVersao.statusCode()).isEqualTo(409);
        assertThat(codigo(outraVersao)).isEqualTo("IDEMPOTENCY_CONFLICT");
        assertThat(situacao(c, os)).isEqualTo("concluida|3|1|1|1:180.00|1");
    }

    @Test
    void reenvioDeQuemPerdeuPermissaoNaoDevolveAOs() throws Exception {
        CenarioOs c = cenario();
        String membro = "eb0a0100-0000-4000-8000-000000000071";
        String perfil = c.novoMembroDaEmpresaEscrita(membro, "perde-alterar-j07", "servicos.alterar,servicos.visualizar");
        String os = osEmExecucao(c);
        Map<String, Object> pedido = pedido(2);
        assertThat(acao("concluir", os, membro, pedido).statusCode()).isEqualTo(200);
        c.adm("DELETE FROM public.perfil_permissoes WHERE perfil_id = ?::uuid AND codigo = 'servicos.alterar'", perfil);
        var r = acao("concluir", os, membro, pedido);
        assertThat(r.statusCode()).isEqualTo(403);
        assertThat(CenarioOs.ler(r.body()).size()).as("só codigo e mensagem").isEqualTo(2);
        assertThat(r.body()).doesNotContain(os);
        assertThat(situacao(c, os)).isEqualTo("concluida|3|1|1|1:180.00|1");
    }

    /** A conta do saldo nasce no mês corrente: com o mês fechado, a conclusão inteira é desfeita (regra do M07). */
    @Test
    void mesFinanceiroFechadoDesfazAConclusao() throws Exception {
        CenarioOs c = cenario();
        String os = osEmExecucao(c);
        String k = chave();
        c.adm("INSERT INTO app_private.controle_financeiro (empresa_id, fechado_ate) VALUES (?::uuid, "
                + "(date_trunc('month', app_private.hoje_sp()) + interval '1 month - 1 day')::date) "
                + "ON CONFLICT (empresa_id) DO UPDATE SET fechado_ate = EXCLUDED.fechado_ate", c.empresaEscrita);
        try {
            var r = acao("concluir", os, GESTOR_A, corpo("versao", 2, "chave", k));
            assertThat(r.statusCode()).isEqualTo(409);
            assertThat(codigo(r)).isEqualTo("PERIOD_LOCKED");
            assertThat(situacao(c, os)).isEqualTo("em_execucao|2|0|0|0:0.00|0");
            assertThat(chaveGravada(c, k)).isEqualTo("0");
        } finally {
            c.adm("UPDATE app_private.controle_financeiro SET fechado_ate = NULL WHERE empresa_id = ?::uuid", c.empresaEscrita);
        }
        assertThat(acao("concluir", os, GESTOR_A, corpo("versao", 2, "chave", k)).statusCode()).isEqualTo(200);
        assertThat(situacao(c, os)).isEqualTo("concluida|3|1|1|1:180.00|1");
    }

    /** T-ATOM: falha forçada DEPOIS do UPDATE da OS desfaz estado, versão, conta, parcelas, histórico, auditorias e chave. */
    @Test
    void falhaDepoisDaAtualizacaoDesfazTudo() throws Exception {
        CenarioOs c = cenario();
        c.adm("CREATE SCHEMA IF NOT EXISTS teste_j07");
        // Não volta no rollback: se avançar, a falha aconteceu com a OS já "concluida" na mesma transação.
        c.adm("CREATE SEQUENCE IF NOT EXISTS teste_j07.viu_update");
        c.adm("CREATE OR REPLACE FUNCTION teste_j07.falhar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                + "IF TG_TABLE_NAME = 'parcelas_financeiras' THEN IF NOT EXISTS (SELECT 1 FROM public.titulos_financeiros t "
                + "WHERE t.id = NEW.titulo_id AND t.origem_id = TG_ARGV[0]::uuid) THEN RETURN NEW; END IF; END IF; "
                + "IF (SELECT estado FROM public.ordens_servico WHERE id = TG_ARGV[0]::uuid) = 'concluida' THEN "
                + "PERFORM nextval('teste_j07.viu_update'); END IF; "
                + "RAISE EXCEPTION 'falha forçada pelo teste T-ATOM'; END $$");
        String[][] pontos = {
                {"conta", "public.titulos_financeiros", "NEW.origem_id = '%s'::uuid"},
                {"parcela", "public.parcelas_financeiras", "true"},
                {"auditoria_conta", "app_private.eventos_auditoria", "NEW.tipo_acao = 'financeiro.titulo_de_servico'"},
                {"historico", "public.os_eventos", "NEW.os_id = '%s'::uuid AND NEW.tipo = 'concluir'"},
                {"auditoria_os", "app_private.eventos_auditoria", "NEW.recurso_id = '%s'::uuid AND NEW.tipo_acao = 'servicos.os_concluir'"},
                {"chave", "app_private.operacoes_idempotentes", "NEW.funcao = 'mudar_estado_os' AND NEW.chave = '%2$s'"}};
        for (String[] ponto : pontos) {
            String os = osEmExecucao(c);
            String k = chave();
            String gatilho = "t_atom_j07_" + ponto[0];
            c.adm("CREATE TRIGGER " + gatilho + " BEFORE INSERT ON " + ponto[1] + " FOR EACH ROW WHEN ("
                    + String.format(ponto[2], os, k) + ") EXECUTE FUNCTION teste_j07.falhar('" + os + "')");
            try {
                long antes = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j07.viu_update"));
                var r = acao("concluir", os, GESTOR_A, corpo("versao", 2, "chave", k));
                assertThat(r.statusCode()).as(ponto[0]).isEqualTo(500);
                assertThat(r.body()).as(ponto[0]).doesNotContain("T-ATOM").doesNotContain("trigger");
                long depois = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j07.viu_update"));
                assertThat(depois).as("falha em " + ponto[0] + " aconteceu depois do UPDATE da OS").isEqualTo(antes + 1);
                assertThat(situacao(c, os)).as("falha em " + ponto[0] + ": nada gravado").isEqualTo("em_execucao|2|0|0|0:0.00|0");
                assertThat(c.adm("SELECT count(*)::text FROM public.parcelas_financeiras p JOIN public.titulos_financeiros t ON t.id = p.titulo_id "
                        + "WHERE t.origem_id = ?::uuid", os)).as(ponto[0]).isEqualTo("0");
                assertThat(chaveGravada(c, k)).as("falha em " + ponto[0] + ": chave não gravada").isEqualTo("0");
            } finally {
                c.adm("DROP TRIGGER " + gatilho + " ON " + ponto[1]);
            }
            var depois = acao("concluir", os, GESTOR_A, corpo("versao", 2, "chave", k));
            assertThat(depois.statusCode()).as(ponto[0]).isEqualTo(200);
            assertThat(situacao(c, os)).as(ponto[0]).isEqualTo("concluida|3|1|1|1:180.00|1");
            assertThat(chaveGravada(c, k)).isEqualTo("1");
        }
        c.adm("DROP SCHEMA teste_j07 CASCADE");
    }
}
