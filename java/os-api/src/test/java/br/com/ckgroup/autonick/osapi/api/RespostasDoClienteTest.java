package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_1;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_ESCRITA;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.DONO_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.GESTOR_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.SEM_PERFIL;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/**
 * J08 (ADR-J02 §4.2, J8-1 = A): respostas do Cliente titular à conclusão. Funções existentes
 * confirmar_recebimento_servico e pedir_revisao_os; o controle de versão é da API (ver RespostasDoCliente). Cada teste
 * usa OS NOVAS da cliente de escrita, concluídas pela empresa pela própria API.
 */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class RespostasDoClienteTest extends ApiComBancoBase {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String CLIENTE = "/api/cliente/ordens-servico/";
    private static final String EMPRESA = "/api/business/ordens-servico/";
    private static final String TEXTO = "A tomada da sala ficou sem o espelho (teste J08).";

    private static String chave() {
        return "j08-" + UUID.randomUUID();
    }

    private static Map<String, Object> corpo(Object... pares) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < pares.length; i += 2) m.put((String) pares[i], pares[i + 1]);
        return m;
    }

    private HttpResponse<String> enviar(String base, String os, String acao, String sub, Object corpo) {
        try {
            String texto = corpo instanceof String s ? s : JSON.writeValueAsString(corpo);
            return post(base + os + "/" + acao, sub == null ? null : CHAVES.token(sub), texto);
        } catch (Exception erro) {
            throw new IllegalStateException(erro);
        }
    }

    private HttpResponse<String> confirmar(String os, String sub, Object corpo) {
        return enviar(CLIENTE, os, "confirmar-recebimento", sub, corpo);
    }

    private HttpResponse<String> revisao(String os, String sub, Object corpo) {
        return enviar(CLIENTE, os, "pedir-revisao", sub, corpo);
    }

    /** OS nova da cliente de escrita, iniciada e concluída pela empresa (concluída, versão 3, conta de R$ 180,00). */
    private String osConcluida(CenarioOs c) throws Exception {
        String os = c.novaOsParaEscrita();
        assertThat(enviar(EMPRESA, os, "iniciar", GESTOR_A, corpo("versao", 1, "chave", chave())).statusCode()).isEqualTo(200);
        assertThat(enviar(EMPRESA, os, "concluir", GESTOR_A, corpo("versao", 2, "chave", chave())).statusCode()).isEqualTo(200);
        return os;
    }

    /**
     * estado|versao|revisão pendente|eventos recebimento_confirmado,revisao_pedida|auditoria do encerramento pelo cliente
     * |contas da OS (quantidade:total:recebido:estado)|pagamentos e lançamentos financeiros da empresa.
     */
    static String situacao(CenarioOs c, String os) throws Exception {
        return c.adm("SELECT o.estado || '|' || o.versao || '|' || o.revisao_pendente || '|' "
                + "|| (SELECT count(*) FROM public.os_eventos e WHERE e.os_id = o.id AND e.tipo = 'recebimento_confirmado') || ',' "
                + "|| (SELECT count(*) FROM public.os_eventos e WHERE e.os_id = o.id AND e.tipo = 'revisao_pedida') || '|' "
                + "|| (SELECT count(*) FROM app_private.eventos_auditoria a WHERE a.recurso_id = o.id AND a.tipo_acao = 'servicos.os_encerrada_pelo_cliente') || '|' "
                + "|| (SELECT count(*) || ':' || coalesce(sum(t.total), 0)::numeric(12,2) || ':' || coalesce(sum(t.recebido), 0)::numeric(12,2) || ':' "
                + "    || coalesce(string_agg(DISTINCT t.estado, ','), '-') FROM public.titulos_financeiros t WHERE t.origem_id = o.id) || '|' "
                + "|| (SELECT count(*) FROM public.pagamentos p WHERE p.empresa_id = o.empresa_id) || ',' "
                + "|| (SELECT count(*) FROM public.lancamentos_financeiros l WHERE l.empresa_id = o.empresa_id) "
                + "FROM public.ordens_servico o WHERE o.id = ?::uuid", os);
    }

    private static String chaveGravada(CenarioOs c, String funcao, String chave) throws Exception {
        return c.adm("SELECT count(*)::text FROM app_private.operacoes_idempotentes WHERE funcao = ? AND chave = ?", funcao, chave);
    }

    /** Parte financeira da situação (contas da OS, pagamentos e lançamentos da empresa). */
    private static String financeiro(String situacao) {
        String[] partes = situacao.split("\\|");
        return partes[5] + "|" + partes[6];
    }

    @Test
    void confirmarEncerraPeloClienteSemPagamentoESemGarantiaDepois() throws Exception {
        CenarioOs c = cenario();
        String os = osConcluida(c);
        String antes = situacao(c, os);
        assertThat(antes).startsWith("concluida|3|false|0,0|0|1:180.00:0.00:");

        var r = confirmar(os, CLIENTE_ESCRITA, corpo("versao", 3, "chave", chave()));
        assertThat(r.statusCode()).isEqualTo(200);
        JsonNode cliente = CenarioOs.ler(r.body());
        assertThat(cliente.get("estado").asText()).isEqualTo("encerrada");
        assertThat(cliente.get("versao").asInt()).isEqualTo(4);
        assertThat(cliente.get("encerrada_por").asText()).isEqualTo("cliente");
        for (String interno : List.of("pode", "equipe", "materiais", "responsavel_auth_id")) {
            assertThat(cliente.has(interno)).as(interno).isFalse();
        }
        assertThat(cliente.at("/valores").has("titulos")).isFalse();
        String depois = situacao(c, os);
        assertThat(depois).startsWith("encerrada|4|false|1,0|1|");
        // confirmar o recebimento do SERVIÇO não é pagamento: contas, recebido, pagamentos e lançamentos iguais
        assertThat(financeiro(depois)).isEqualTo(financeiro(antes));

        // a empresa vê o encerramento pelo cliente; não registra mais garantia (regra vigente, para revisão futura)
        JsonNode empresa = CenarioOs.ler(get(EMPRESA + os, CHAVES.token(GESTOR_A)).body());
        assertThat(empresa.get("estado").asText()).isEqualTo("encerrada");
        assertThat(empresa.findValues("tipo").stream().map(JsonNode::asText).toList()).contains("recebimento_confirmado");
        assertThatThrownBy(() -> c.comoUsuario(GESTOR_A, "SELECT public.registrar_garantia_os(?::uuid, 90, NULL, ?)::text", os, chave()))
                .hasMessageContaining("antes do encerramento");

        // depois de encerrada, nenhuma das duas respostas vale
        var deNovo = confirmar(os, CLIENTE_ESCRITA, corpo("versao", 4, "chave", chave()));
        assertThat(deNovo.statusCode()).isEqualTo(409);
        assertThat(codigo(deNovo)).isEqualTo("STATE_CONFLICT");
        var revisaoDepois = revisao(os, CLIENTE_ESCRITA, corpo("versao", 4, "chave", chave(), "texto", TEXTO));
        assertThat(revisaoDepois.statusCode()).isEqualTo(409);
        assertThat(codigo(revisaoDepois)).isEqualTo("STATE_CONFLICT");
        assertThat(situacao(c, os)).isEqualTo(depois);
    }

    @Test
    void pedirRevisaoMantemConcluidaEImpedeOEncerramentoDaEmpresa() throws Exception {
        CenarioOs c = cenario();
        String os = osConcluida(c);
        String antes = situacao(c, os);
        var r = revisao(os, CLIENTE_ESCRITA, corpo("versao", 3, "chave", chave(), "texto", TEXTO));
        assertThat(r.statusCode()).isEqualTo(200);
        JsonNode cliente = CenarioOs.ler(r.body());
        assertThat(cliente.get("estado").asText()).isEqualTo("concluida");
        assertThat(cliente.get("revisao_pendente").asBoolean()).isTrue();
        String depois = situacao(c, os);
        assertThat(depois).startsWith("concluida|4|true|0,1|0|");
        assertThat(financeiro(depois)).isEqualTo(financeiro(antes));
        // histórico público com o texto; sem auditoria (regra vigente da função)
        assertThat(c.adm("SELECT publico || '|' || texto || '|' || autor_tipo FROM public.os_eventos WHERE os_id = ?::uuid AND tipo = 'revisao_pedida'", os))
                .isEqualTo("true|" + TEXTO + "|cliente");
        assertThat(c.adm("SELECT count(*)::text FROM app_private.eventos_auditoria WHERE recurso_id = ?::uuid AND tipo_acao LIKE '%revis%'", os)).isEqualTo("0");
        // a empresa vê o pedido e não pode encerrar enquanto ele estiver pendente
        JsonNode empresa = CenarioOs.ler(get(EMPRESA + os, CHAVES.token(GESTOR_A)).body());
        assertThat(empresa.at("/encerramento/empresa_pode_encerrar").asBoolean()).isFalse();
        assertThat(empresa.at("/encerramento/motivo").asText()).contains("pediu revisão");
        assertThat(empresa.toString()).contains(TEXTO);
        assertThatThrownBy(() -> c.comoUsuario(GESTOR_A, "SELECT public.mudar_estado_os(?::uuid, 'encerrar', NULL, 4, ?)::text", os, chave()))
                .hasMessageContaining("pediu revisão");
        // um segundo pedido não vale; confirmar com a revisão pendente vale e a limpa (regra vigente)
        var outro = revisao(os, CLIENTE_ESCRITA, corpo("versao", 4, "chave", chave(), "texto", TEXTO + " Outro."));
        assertThat(outro.statusCode()).isEqualTo(409);
        assertThat(codigo(outro)).isEqualTo("STATE_CONFLICT");
        assertThat(confirmar(os, CLIENTE_ESCRITA, corpo("versao", 4, "chave", chave())).statusCode()).isEqualTo(200);
        assertThat(situacao(c, os)).startsWith("encerrada|5|false|1,1|1|");
    }

    @Test
    void soOTitularResponde() throws Exception {
        CenarioOs c = cenario();
        String os = osConcluida(c);
        String antes = situacao(c, os);
        var inexistente = confirmar(UUID.randomUUID().toString(), CLIENTE_ESCRITA, corpo("versao", 3, "chave", chave()));
        assertThat(inexistente.statusCode()).isEqualTo(404);
        assertThat(codigo(inexistente)).isEqualTo("NOT_FOUND");
        for (String sub : List.of(CLIENTE_1, GESTOR_A, DONO_A, SEM_PERFIL)) {
            var r1 = confirmar(os, sub, corpo("versao", 3, "chave", chave()));
            var r2 = revisao(os, sub, corpo("versao", 3, "chave", chave(), "texto", TEXTO));
            assertThat(r1.statusCode()).as(sub).isEqualTo(404);
            assertThat(r2.statusCode()).as(sub).isEqualTo(404);
            assertThat(r1.body()).as(sub).isEqualTo(inexistente.body());
            assertThat(r2.body()).as(sub).isEqualTo(inexistente.body());
            assertThat(get(CLIENTE + os, CHAVES.token(sub)).statusCode()).as("leitura de " + sub).isEqualTo(404);
        }
        assertThat(confirmar(os, null, corpo("versao", 3, "chave", chave())).statusCode()).isEqualTo(401);
        assertThat(situacao(c, os)).isEqualTo(antes);
    }

    @Test
    void soComAOsConcluida() throws Exception {
        CenarioOs c = cenario();
        String aguardando = c.novaOsParaEscrita();
        String emExecucao = c.novaOsParaEscrita();
        assertThat(enviar(EMPRESA, emExecucao, "iniciar", GESTOR_A, corpo("versao", 1, "chave", chave())).statusCode()).isEqualTo(200);
        String pausada = c.novaOsParaEscrita();
        assertThat(enviar(EMPRESA, pausada, "iniciar", GESTOR_A, corpo("versao", 1, "chave", chave())).statusCode()).isEqualTo(200);
        assertThat(enviar(EMPRESA, pausada, "pausar", GESTOR_A, corpo("versao", 2, "chave", chave(), "motivo", "Pausa fictícia J08.")).statusCode()).isEqualTo(200);
        for (String[] caso : new String[][] {{aguardando, "1"}, {emExecucao, "2"}, {pausada, "3"}}) {
            int v = Integer.parseInt(caso[1]);
            var r1 = confirmar(caso[0], CLIENTE_ESCRITA, corpo("versao", v, "chave", chave()));
            var r2 = revisao(caso[0], CLIENTE_ESCRITA, corpo("versao", v, "chave", chave(), "texto", TEXTO));
            assertThat(r1.statusCode()).isEqualTo(409);
            assertThat(codigo(r1)).isEqualTo("STATE_CONFLICT");
            assertThat(r2.statusCode()).isEqualTo(409);
            assertThat(codigo(r2)).isEqualTo("STATE_CONFLICT");
        }
    }

    /** Requisição NOVA com versão desatualizada (ou adiantada): 409 e nada gravado, nem a chave. */
    @Test
    void versaoDesatualizadaNaoGravaNada() throws Exception {
        CenarioOs c = cenario();
        String os = osConcluida(c);
        String antes = situacao(c, os);
        for (int v : List.of(1, 2, 4, 99)) {
            String k1 = chave(), k2 = chave();
            var r1 = confirmar(os, CLIENTE_ESCRITA, corpo("versao", v, "chave", k1));
            var r2 = revisao(os, CLIENTE_ESCRITA, corpo("versao", v, "chave", k2, "texto", TEXTO));
            assertThat(r1.statusCode()).as("confirmar v" + v).isEqualTo(409);
            assertThat(codigo(r1)).isEqualTo("VERSION_CONFLICT");
            assertThat(CenarioOs.ler(r1.body()).get("mensagem").asText()).contains("mudou desde que você abriu a tela");
            assertThat(r2.statusCode()).as("revisão v" + v).isEqualTo(409);
            assertThat(codigo(r2)).isEqualTo("VERSION_CONFLICT");
            assertThat(chaveGravada(c, "confirmar_recebimento_servico", k1)).isEqualTo("0");
            assertThat(chaveGravada(c, "pedir_revisao_os", k2)).isEqualTo("0");
        }
        assertThat(situacao(c, os)).isEqualTo(antes);
        // com a versão certa, passa
        assertThat(revisao(os, CLIENTE_ESCRITA, corpo("versao", 3, "chave", chave(), "texto", TEXTO)).statusCode()).isEqualTo(200);
    }

    @Test
    void corpoEstritoETextoDaRevisao() throws Exception {
        CenarioOs c = cenario();
        String os = osConcluida(c);
        String antes = situacao(c, os);
        List<Object> confirmarInvalidos = List.of(corpo("versao", 3), corpo("chave", chave()), corpo("versao", 3, "chave", chave(), "texto", TEXTO),
                corpo("versao", 3, "chave", chave(), "acao", "encerrar"), corpo("versao", "3", "chave", chave()), "não é json");
        for (Object corpo : confirmarInvalidos) {
            var r = confirmar(os, CLIENTE_ESCRITA, corpo);
            assertThat(r.statusCode()).as(String.valueOf(corpo)).isEqualTo(400);
            assertThat(codigo(r)).isEqualTo("VALIDATION_ERROR");
        }
        List<Object> revisaoInvalidos = List.of(
                corpo("versao", 3, "chave", chave()),
                corpo("versao", 3, "chave", chave(), "texto", null),
                corpo("versao", 3, "chave", chave(), "texto", "123456789"),
                corpo("versao", 3, "chave", chave(), "texto", "   123456789   "),
                corpo("versao", 3, "chave", chave(), "texto", "x".repeat(1001)),
                corpo("versao", 3, "chave", chave(), "texto", TEXTO, "publico", false),
                corpo("versao", 3, "chave", chave(), "texto", "Me liga no 11 98765-4321 para combinar."),
                corpo("versao", 3, "chave", chave(), "texto", "Escreva para cliente@exemplo.com por favor."),
                corpo("versao", 3, "chave", chave(), "texto", "Veja as fotos em www.exemplo.com/fotos."));
        for (Object corpo : revisaoInvalidos) {
            var r = revisao(os, CLIENTE_ESCRITA, corpo);
            assertThat(r.statusCode()).as(String.valueOf(corpo)).isEqualTo(400);
            assertThat(codigo(r)).isEqualTo("VALIDATION_ERROR");
        }
        assertThat(situacao(c, os)).isEqualTo(antes);
        // limites: 10 e 1.000 caracteres passam (em OS diferentes)
        assertThat(revisao(os, CLIENTE_ESCRITA, corpo("versao", 3, "chave", chave(), "texto", "abcdefghij")).statusCode()).isEqualTo(200);
        String outra = osConcluida(c);
        assertThat(revisao(outra, CLIENTE_ESCRITA, corpo("versao", 3, "chave", chave(), "texto", "y".repeat(1000))).statusCode()).isEqualTo(200);
    }

    private List<Integer> juntos(Supplier<HttpResponse<String>> a, Supplier<HttpResponse<String>> b) {
        CountDownLatch largada = new CountDownLatch(1);
        List<CompletableFuture<HttpResponse<String>>> pedidos = new ArrayList<>();
        for (Supplier<HttpResponse<String>> s : List.of(a, b)) {
            pedidos.add(CompletableFuture.supplyAsync(() -> {
                try {
                    largada.await();
                } catch (InterruptedException erro) {
                    Thread.currentThread().interrupt();
                }
                return s.get();
            }));
        }
        largada.countDown();
        return pedidos.stream().map(CompletableFuture::join).map(HttpResponse::statusCode).sorted().toList();
    }

    @Test
    void concorrenciaNaoContornaAVersao() throws Exception {
        CenarioOs c = cenario();
        // confirmar × confirmar
        String os = osConcluida(c);
        assertThat(juntos(() -> confirmar(os, CLIENTE_ESCRITA, corpo("versao", 3, "chave", chave())),
                () -> confirmar(os, CLIENTE_ESCRITA, corpo("versao", 3, "chave", chave())))).containsExactly(200, 409);
        assertThat(situacao(c, os)).startsWith("encerrada|4|false|1,0|1|");
        // confirmar × pedir revisão, com a mesma versão: só um vale; repetido para exercitar as duas ordens
        int confirmouPrimeiro = 0, revisouPrimeiro = 0;
        for (int i = 0; i < 6; i++) {
            String o = osConcluida(c);
            assertThat(juntos(() -> confirmar(o, CLIENTE_ESCRITA, corpo("versao", 3, "chave", chave())),
                    () -> revisao(o, CLIENTE_ESCRITA, corpo("versao", 3, "chave", chave(), "texto", TEXTO)))).containsExactly(200, 409);
            String s = situacao(c, o);
            if (s.startsWith("encerrada|4|false|1,0|1|")) confirmouPrimeiro++;
            else if (s.startsWith("concluida|4|true|0,1|0|")) revisouPrimeiro++;
            else throw new AssertionError("estado inesperado depois da concorrência: " + s);
        }
        assertThat(confirmouPrimeiro + revisouPrimeiro).isEqualTo(6);
    }

    @Test
    void respostaPerdidaReenvioIdenticoNaoDuplicaEChaveComOutrosDadosERecusada() throws Exception {
        CenarioOs c = cenario();
        String os = osConcluida(c);
        String k = chave();
        String pedido = JSON.writeValueAsString(corpo("versao", 3, "chave", k));
        assertThat(postDescartandoResposta(CLIENTE + os + "/confirmar-recebimento", CHAVES.token(CLIENTE_ESCRITA), pedido)).isEqualTo(200);
        String gravado = situacao(c, os);
        assertThat(gravado).startsWith("encerrada|4|false|1,0|1|");
        assertThat(chaveGravada(c, "confirmar_recebimento_servico", k)).isEqualTo("1");

        var reenvio = post(CLIENTE + os + "/confirmar-recebimento", CHAVES.token(CLIENTE_ESCRITA), pedido);
        assertThat(reenvio.statusCode()).isEqualTo(200);
        assertThat(CenarioOs.ler(reenvio.body()).get("estado").asText()).isEqualTo("encerrada");
        assertThat(situacao(c, os)).isEqualTo(gravado);
        assertThat(chaveGravada(c, "confirmar_recebimento_servico", k)).isEqualTo("1");

        var outraVersao = confirmar(os, CLIENTE_ESCRITA, corpo("versao", 2, "chave", k));
        assertThat(outraVersao.statusCode()).isEqualTo(409);
        assertThat(codigo(outraVersao)).isEqualTo("IDEMPOTENCY_CONFLICT");
        // reenvio da mesma chave por outra pessoa: primeiro a titularidade, nada é devolvido
        var porOutro = post(CLIENTE + os + "/confirmar-recebimento", CHAVES.token(CLIENTE_1), pedido);
        assertThat(porOutro.statusCode()).isEqualTo(404);
        assertThat(porOutro.body()).doesNotContain(os);

        // revisão: mesma chave com outro texto → recusado pela função
        String os2 = osConcluida(c);
        String k2 = chave();
        assertThat(revisao(os2, CLIENTE_ESCRITA, corpo("versao", 3, "chave", k2, "texto", TEXTO)).statusCode()).isEqualTo(200);
        var outroTexto = revisao(os2, CLIENTE_ESCRITA, corpo("versao", 3, "chave", k2, "texto", TEXTO + " Editado."));
        assertThat(outroTexto.statusCode()).isEqualTo(409);
        assertThat(codigo(outroTexto)).isEqualTo("IDEMPOTENCY_CONFLICT");
        assertThat(situacao(c, os2)).startsWith("concluida|4|true|0,1|0|");
    }

    /** Reenvio de uma requisição já gravada cuja versão original não é mais a atual: reconhecido, sem duplicar. */
    @Test
    void reenvioDepoisDeMudancasPosterioresNaOs() throws Exception {
        CenarioOs c = cenario();
        String os = osConcluida(c);
        String k = chave();
        String pedido = JSON.writeValueAsString(corpo("versao", 3, "chave", k, "texto", TEXTO));
        assertThat(postDescartandoResposta(CLIENTE + os + "/pedir-revisao", CHAVES.token(CLIENTE_ESCRITA), pedido)).isEqualTo(200);
        // a empresa responde: reabre (versão 5, em execução) e conclui de novo (versão 6)
        c.comoUsuario(GESTOR_A, "SELECT public.mudar_estado_os(?::uuid, 'reabrir', 'Vamos revisar o espelho da tomada.', 4, ?)::text", os, chave());
        assertThat(enviar(EMPRESA, os, "concluir", GESTOR_A, corpo("versao", 5, "chave", chave())).statusCode()).isEqualTo(200);
        String agora = situacao(c, os);
        assertThat(agora).startsWith("concluida|6|false|0,1|0|");

        var reenvio = post(CLIENTE + os + "/pedir-revisao", CHAVES.token(CLIENTE_ESCRITA), pedido);
        assertThat(reenvio.statusCode()).isEqualTo(200);
        assertThat(CenarioOs.ler(reenvio.body()).get("versao").asInt()).as("resposta com a visão atual").isEqualTo(6);
        assertThat(situacao(c, os)).isEqualTo(agora);
        // um pedido NOVO com a versão antiga é recusado, sem gravar (a OS está concluída e aceitaria revisão)
        String k2 = chave();
        var novoAntigo = revisao(os, CLIENTE_ESCRITA, corpo("versao", 3, "chave", k2, "texto", TEXTO + " De novo."));
        assertThat(novoAntigo.statusCode()).isEqualTo(409);
        assertThat(codigo(novoAntigo)).isEqualTo("VERSION_CONFLICT");
        assertThat(chaveGravada(c, "pedir_revisao_os", k2)).isEqualTo("0");
        assertThat(situacao(c, os)).isEqualTo(agora);
    }

    /** T-ATOM: falha forçada depois do UPDATE da OS desfaz estado, versão, histórico, auditoria e chave. */
    @Test
    void falhaDepoisDaAtualizacaoDesfazTudo() throws Exception {
        CenarioOs c = cenario();
        c.adm("CREATE SCHEMA IF NOT EXISTS teste_j08");
        // Não volta no rollback: se avançar, a OS já estava alterada (encerrada ou com revisão) na transação da falha.
        c.adm("CREATE SEQUENCE IF NOT EXISTS teste_j08.viu_update");
        c.adm("CREATE OR REPLACE FUNCTION teste_j08.falhar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                + "IF (SELECT estado = 'encerrada' OR revisao_pendente FROM public.ordens_servico WHERE id = TG_ARGV[0]::uuid) THEN "
                + "PERFORM nextval('teste_j08.viu_update'); END IF; "
                + "RAISE EXCEPTION 'falha forçada pelo teste T-ATOM'; END $$");
        String[][] pontos = {
                {"confirmar", "historico", "public.os_eventos", "NEW.os_id = '%s'::uuid AND NEW.tipo = 'recebimento_confirmado'"},
                {"confirmar", "auditoria", "app_private.eventos_auditoria", "NEW.recurso_id = '%s'::uuid AND NEW.tipo_acao = 'servicos.os_encerrada_pelo_cliente'"},
                {"confirmar", "chave", "app_private.operacoes_idempotentes", "NEW.funcao = 'confirmar_recebimento_servico' AND NEW.chave = '%2$s'"},
                {"revisao", "historico", "public.os_eventos", "NEW.os_id = '%s'::uuid AND NEW.tipo = 'revisao_pedida'"},
                {"revisao", "chave", "app_private.operacoes_idempotentes", "NEW.funcao = 'pedir_revisao_os' AND NEW.chave = '%2$s'"}};
        for (String[] p : pontos) {
            String os = osConcluida(c);
            String k = chave();
            String antes = situacao(c, os);
            String gatilho = "t_atom_j08_" + p[0] + "_" + p[1];
            c.adm("CREATE TRIGGER " + gatilho + " BEFORE INSERT ON " + p[2] + " FOR EACH ROW WHEN ("
                    + String.format(p[3], os, k) + ") EXECUTE FUNCTION teste_j08.falhar('" + os + "')");
            Map<String, Object> pedido = p[0].equals("confirmar") ? corpo("versao", 3, "chave", k) : corpo("versao", 3, "chave", k, "texto", TEXTO);
            String funcao = p[0].equals("confirmar") ? "confirmar_recebimento_servico" : "pedir_revisao_os";
            try {
                long antesSeq = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j08.viu_update"));
                var r = p[0].equals("confirmar") ? confirmar(os, CLIENTE_ESCRITA, pedido) : revisao(os, CLIENTE_ESCRITA, pedido);
                assertThat(r.statusCode()).as(p[0] + "/" + p[1]).isEqualTo(500);
                assertThat(r.body()).doesNotContain("T-ATOM").doesNotContain("trigger");
                long depoisSeq = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j08.viu_update"));
                assertThat(depoisSeq).as(p[0] + "/" + p[1] + ": a falha veio depois do UPDATE da OS").isEqualTo(antesSeq + 1);
                assertThat(situacao(c, os)).as(p[0] + "/" + p[1] + ": nada gravado").isEqualTo(antes);
                assertThat(chaveGravada(c, funcao, k)).isEqualTo("0");
            } finally {
                c.adm("DROP TRIGGER " + gatilho + " ON " + p[2]);
            }
            var depois = p[0].equals("confirmar") ? confirmar(os, CLIENTE_ESCRITA, pedido) : revisao(os, CLIENTE_ESCRITA, pedido);
            assertThat(depois.statusCode()).as(p[0] + "/" + p[1]).isEqualTo(200);
            assertThat(chaveGravada(c, funcao, k)).isEqualTo("1");
        }
        c.adm("DROP SCHEMA teste_j08 CASCADE");
    }
}
