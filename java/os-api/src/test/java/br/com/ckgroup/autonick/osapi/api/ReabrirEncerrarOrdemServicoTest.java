package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_1;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_ESCRITA;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.DONO_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.DONO_B;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.GESTOR_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.MEMBRO_SEM_VISAO;
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
 * J09 (ADR-J02): POST .../reabrir e POST .../encerrar pela empresa. Regras da função SQL mudar_estado_os, preservadas:
 * <ul>
 *   <li>reabrir: só da OS concluída para em execução, com servicos.alterar e a versão atual; motivo de 10 a 300
 *       caracteres, PÚBLICO no histórico; limpa a revisão pendente e a data de conclusão; não mexe na conta a receber;</li>
 *   <li>encerrar: só da OS concluída, sem revisão pendente e, se veio da plataforma, quando agora &gt;= conclusão + 7
 *       dias (OS interna, já); "encerrada_por = empresa"; libera reservas ativas; sem pagamento nem mudança na conta.</li>
 * </ul>
 * O prazo de 7 dias é exercitado com a data de conclusão recuada por SQL SÓ neste banco de teste descartável (fixture
 * isolada, OS criadas para cada teste). Nenhum outro estado é forçado: as OS chegam a cada situação pelas próprias rotas.
 */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class ReabrirEncerrarOrdemServicoTest extends ApiComBancoBase {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String EMPRESA = "/api/business/ordens-servico/";
    private static final String CLIENTE = "/api/cliente/ordens-servico/";
    private static final String MOTIVO = "Vamos colocar o espelho da tomada da sala (J09).";
    private static final String PAUSA_INTERNA = "Aguardando peça do fornecedor, nota interna J09.";
    private static final String REVISAO = "A tomada da sala ficou sem o espelho (teste J09).";

    private static String chave() {
        return "j09-" + UUID.randomUUID();
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

    private HttpResponse<String> empresa(String os, String acao, String sub, Object corpo) {
        return enviar(EMPRESA, os, acao, sub, corpo);
    }

    private HttpResponse<String> reabrir(String os, int versao) {
        return empresa(os, "reabrir", GESTOR_A, corpo("versao", versao, "chave", chave(), "motivo", MOTIVO));
    }

    private HttpResponse<String> encerrar(String os, int versao) {
        return empresa(os, "encerrar", GESTOR_A, corpo("versao", versao, "chave", chave()));
    }

    private void ok(HttpResponse<String> r) {
        assertThat(r.statusCode()).as(r.body()).isEqualTo(200);
    }

    /** OS da plataforma (cliente de escrita), iniciada e concluída pela API: concluída, versão 3. */
    private String concluidaDaPlataforma(CenarioOs c) throws Exception {
        String os = c.novaOsParaEscrita();
        ok(empresa(os, "iniciar", GESTOR_A, corpo("versao", 1, "chave", chave())));
        ok(empresa(os, "concluir", GESTOR_A, corpo("versao", 2, "chave", chave())));
        return os;
    }

    /** OS interna (cliente interno da empresa), iniciada e concluída pela API: concluída, versão 3. */
    private String concluidaInterna(CenarioOs c) throws Exception {
        String os = c.novaOsInternaParaEscrita();
        ok(empresa(os, "iniciar", GESTOR_A, corpo("versao", 1, "chave", chave())));
        ok(empresa(os, "concluir", GESTOR_A, corpo("versao", 2, "chave", chave())));
        return os;
    }

    /** Fixture isolada do banco de teste: recua a conclusão desta OS (só para exercitar o prazo de 7 dias). */
    private static void concluidaHa(CenarioOs c, String os, String intervalo) throws Exception {
        c.adm("UPDATE public.ordens_servico SET concluida_em = now() - ?::interval WHERE id = ?::uuid AND estado = 'concluida'", intervalo, os);
    }

    /**
     * estado|versao|revisão pendente|encerrada_por|conclusão vazia|eventos reabrir,encerrar|auditorias reabrir,encerrar
     * |contas da OS (quantidade:total:recebido)|pagamentos,lançamentos da empresa.
     */
    static String situacao(CenarioOs c, String os) throws Exception {
        return c.adm("SELECT o.estado || '|' || o.versao || '|' || o.revisao_pendente || '|' || coalesce(o.encerrada_por, '-') || '|' "
                + "|| (o.concluida_em IS NULL) || '|' "
                + "|| (SELECT count(*) FROM public.os_eventos e WHERE e.os_id = o.id AND e.tipo = 'reabrir') || ',' "
                + "|| (SELECT count(*) FROM public.os_eventos e WHERE e.os_id = o.id AND e.tipo = 'encerrar') || '|' "
                + "|| (SELECT count(*) FROM app_private.eventos_auditoria a WHERE a.recurso_id = o.id AND a.tipo_acao = 'servicos.os_reabrir') || ',' "
                + "|| (SELECT count(*) FROM app_private.eventos_auditoria a WHERE a.recurso_id = o.id AND a.tipo_acao = 'servicos.os_encerrar') || '|' "
                + "|| (SELECT count(*) || ':' || coalesce(sum(t.total), 0)::numeric(12,2) || ':' || coalesce(sum(t.recebido), 0)::numeric(12,2) "
                + "    FROM public.titulos_financeiros t WHERE t.origem_id = o.id AND t.estado <> 'cancelado') || '|' "
                + "|| (SELECT count(*) FROM public.pagamentos p WHERE p.empresa_id = o.empresa_id) || ',' "
                + "|| (SELECT count(*) FROM public.lancamentos_financeiros l WHERE l.empresa_id = o.empresa_id) "
                + "FROM public.ordens_servico o WHERE o.id = ?::uuid", os);
    }

    private static String chaveGravada(CenarioOs c, String chave) throws Exception {
        return c.adm("SELECT count(*)::text FROM app_private.operacoes_idempotentes WHERE funcao = 'mudar_estado_os' AND chave = ?", chave);
    }

    private static List<String> tipos(JsonNode os) {
        List<String> t = new ArrayList<>();
        os.path("eventos").forEach(e -> t.add(e.path("tipo").asText()));
        return t;
    }

    // ------------------------------------------------------------------------------------------------ Reabrir

    @Test
    void reabrirRespondeAoPedidoDeRevisaoComMotivoPublico() throws Exception {
        CenarioOs c = cenario();
        String os = concluidaDaPlataforma(c);
        ok(enviar(CLIENTE, os, "pedir-revisao", CLIENTE_ESCRITA, corpo("versao", 3, "chave", chave(), "texto", REVISAO)));
        assertThat(situacao(c, os)).isEqualTo("concluida|4|true|-|false|0,0|0,0|1:180.00:0.00|0,0");

        var r = reabrir(os, 4);
        ok(r);
        JsonNode resposta = CenarioOs.ler(r.body());
        assertThat(resposta.get("estado").asText()).isEqualTo("em_execucao");
        assertThat(resposta.has("pode")).as("leitura da empresa").isTrue();
        // em execução de novo, versão +1, revisão resolvida, conclusão zerada; conta a receber intacta
        assertThat(situacao(c, os)).isEqualTo("em_execucao|5|false|-|true|1,0|1,0|1:180.00:0.00|0,0");
        assertThat(c.adm("SELECT publico || '|' || texto || '|' || autor_tipo || '|' || de_estado || '>' || para_estado "
                + "FROM public.os_eventos WHERE os_id = ?::uuid AND tipo = 'reabrir'", os)).isEqualTo("true|" + MOTIVO + "|equipe|concluida>em_execucao");

        // o Cliente vê a OS em execução e o motivo da reabertura (público), sem dados internos
        JsonNode cliente = CenarioOs.ler(get(CLIENTE + os, CHAVES.token(CLIENTE_ESCRITA)).body());
        assertThat(cliente.get("estado").asText()).isEqualTo("em_execucao");
        assertThat(cliente.toString()).contains(MOTIVO);
        for (String interno : List.of("pode", "equipe", "materiais", "responsavel_auth_id")) assertThat(cliente.has(interno)).as(interno).isFalse();

        // a nova conclusão não cria outra conta; o Cliente pode pedir revisão de novo ou confirmar
        ok(empresa(os, "concluir", GESTOR_A, corpo("versao", 5, "chave", chave())));
        assertThat(situacao(c, os)).isEqualTo("concluida|6|false|-|false|1,0|1,0|1:180.00:0.00|0,0");
        ok(enviar(CLIENTE, os, "confirmar-recebimento", CLIENTE_ESCRITA, corpo("versao", 6, "chave", chave())));
        assertThat(situacao(c, os)).startsWith("encerrada|7|false|cliente|false|1,0|1,0|1:180.00:0.00|");
    }

    /** Regra vigente: a reabertura vale para qualquer OS concluída, com ou sem pedido de revisão. */
    @Test
    void reabrirSemPedidoDeRevisaoTambemValeEOMotivoDaPausaContinuaInterno() throws Exception {
        CenarioOs c = cenario();
        String os = c.novaOsParaEscrita();
        ok(empresa(os, "iniciar", GESTOR_A, corpo("versao", 1, "chave", chave())));
        ok(empresa(os, "pausar", GESTOR_A, corpo("versao", 2, "chave", chave(), "motivo", PAUSA_INTERNA)));
        ok(empresa(os, "retomar", GESTOR_A, corpo("versao", 3, "chave", chave())));
        ok(empresa(os, "concluir", GESTOR_A, corpo("versao", 4, "chave", chave())));
        ok(reabrir(os, 5));
        assertThat(situacao(c, os)).startsWith("em_execucao|6|false|-|true|1,0|1,0|1:180.00:0.00|");
        String cliente = get(CLIENTE + os, CHAVES.token(CLIENTE_ESCRITA)).body();
        assertThat(cliente).contains(MOTIVO).doesNotContain(PAUSA_INTERNA);
        assertThat(get(EMPRESA + os, CHAVES.token(GESTOR_A)).body()).contains(MOTIVO).contains(PAUSA_INTERNA);
    }

    @Test
    void reabrirSoComAOsConcluidaEMotivoDe10a300() throws Exception {
        CenarioOs c = cenario();
        String aguardando = c.novaOsParaEscrita();
        String emExecucao = c.novaOsParaEscrita();
        ok(empresa(emExecucao, "iniciar", GESTOR_A, corpo("versao", 1, "chave", chave())));
        String pausada = c.novaOsParaEscrita();
        ok(empresa(pausada, "iniciar", GESTOR_A, corpo("versao", 1, "chave", chave())));
        ok(empresa(pausada, "pausar", GESTOR_A, corpo("versao", 2, "chave", chave(), "motivo", PAUSA_INTERNA)));
        String encerrada = concluidaInterna(c);
        ok(encerrar(encerrada, 3));
        for (String[] caso : new String[][] {{aguardando, "1"}, {emExecucao, "2"}, {pausada, "3"}, {encerrada, "4"}}) {
            var r = reabrir(caso[0], Integer.parseInt(caso[1]));
            assertThat(r.statusCode()).as(caso[1]).isEqualTo(409);
            assertThat(codigo(r)).isEqualTo("STATE_CONFLICT");
        }

        String os = concluidaDaPlataforma(c);
        String antes = situacao(c, os);
        for (Object invalido : List.of(
                corpo("versao", 3, "chave", chave()),
                corpo("versao", 3, "chave", chave(), "motivo", null),
                corpo("versao", 3, "chave", chave(), "motivo", "123456789"),
                corpo("versao", 3, "chave", chave(), "motivo", "    123456789    "),
                corpo("versao", 3, "chave", chave(), "motivo", "x".repeat(301)),
                corpo("versao", 3, "chave", chave(), "motivo", MOTIVO, "publico", false),
                corpo("versao", 3, "chave", chave(), "motivo", MOTIVO, "acao", "encerrar"),
                corpo("versao", 3, "motivo", MOTIVO),
                "não é json")) {
            var r = empresa(os, "reabrir", GESTOR_A, invalido);
            assertThat(r.statusCode()).as(String.valueOf(invalido)).isEqualTo(400);
            assertThat(codigo(r)).isEqualTo("VALIDATION_ERROR");
        }
        var velha = empresa(os, "reabrir", GESTOR_A, corpo("versao", 2, "chave", chave(), "motivo", MOTIVO));
        assertThat(velha.statusCode()).isEqualTo(409);
        assertThat(codigo(velha)).isEqualTo("VERSION_CONFLICT");
        assertThat(situacao(c, os)).isEqualTo(antes);
        // limites: 10 e 300 caracteres passam (em OS diferentes)
        ok(empresa(os, "reabrir", GESTOR_A, corpo("versao", 3, "chave", chave(), "motivo", "abcdefghij")));
        String outra = concluidaDaPlataforma(c);
        ok(empresa(outra, "reabrir", GESTOR_A, corpo("versao", 3, "chave", chave(), "motivo", "y".repeat(300))));
    }

    // ------------------------------------------------------------------------------------------------ Encerrar

    @Test
    void encerrarOsInternaJaPelaEmpresaSemPagamento() throws Exception {
        CenarioOs c = cenario();
        String os = concluidaInterna(c);
        String antes = situacao(c, os);
        assertThat(antes).isEqualTo("concluida|3|false|-|false|0,0|0,0|1:180.00:0.00|0,0");
        JsonNode detalhe = CenarioOs.ler(get(EMPRESA + os, CHAVES.token(GESTOR_A)).body());
        assertThat(detalhe.at("/encerramento/empresa_pode_encerrar").asBoolean()).isTrue();
        assertThat(detalhe.at("/encerramento/a_partir_de").isNull()).as("sem prazo para OS interna").isTrue();

        var r = encerrar(os, 3);
        ok(r);
        JsonNode resposta = CenarioOs.ler(r.body());
        assertThat(resposta.get("estado").asText()).isEqualTo("encerrada");
        assertThat(resposta.get("encerrada_por").asText()).isEqualTo("empresa");
        assertThat(resposta.at("/encerramento/aviso").asText()).contains("não elimina direitos legais");
        // encerrada pela empresa; a conta a receber continua aberta, sem recebimento, e nada entra no financeiro
        assertThat(situacao(c, os)).isEqualTo("encerrada|4|false|empresa|false|0,1|0,1|1:180.00:0.00|0,0");
        assertThat(c.adm("SELECT string_agg(DISTINCT estado, ',') FROM public.titulos_financeiros WHERE origem_id = ?::uuid", os)).isEqualTo("aberto");
        assertThat(c.adm("SELECT publico || '|' || coalesce(texto, '-') || '|' || autor_tipo FROM public.os_eventos WHERE os_id = ?::uuid AND tipo = 'encerrar'", os))
                .isEqualTo("true|-|equipe");
        // depois de encerrada: nada de garantia, reabertura, novo encerramento; OS interna não tem rotas do Cliente
        assertThatThrownBy(() -> c.comoUsuario(GESTOR_A, "SELECT public.registrar_garantia_os(?::uuid, 90, NULL, ?)::text", os, chave()))
                .hasMessageContaining("antes do encerramento");
        assertThat(codigo(reabrir(os, 4))).isEqualTo("STATE_CONFLICT");
        assertThat(codigo(encerrar(os, 4))).isEqualTo("STATE_CONFLICT");
        assertThat(enviar(CLIENTE, os, "confirmar-recebimento", CLIENTE_ESCRITA, corpo("versao", 4, "chave", chave())).statusCode()).isEqualTo(404);
        // encerrar com texto não é aceito pela rota (na função ele seria público)
        String outra = concluidaInterna(c);
        var comTexto = empresa(outra, "encerrar", GESTOR_A, corpo("versao", 3, "chave", chave(), "motivo", "Encerrada pelo balcão."));
        assertThat(comTexto.statusCode()).isEqualTo(400);
    }

    /** Prazo da OS da plataforma: encerrar só quando agora >= conclusão + 7 dias (regra vigente, D9-06). */
    @Test
    void encerrarOsDaPlataformaSoDepoisDeSeteDias() throws Exception {
        CenarioOs c = cenario();
        String os = concluidaDaPlataforma(c);
        String antes = situacao(c, os);
        String k = chave();
        var cedo = empresa(os, "encerrar", GESTOR_A, corpo("versao", 3, "chave", k));
        assertThat(cedo.statusCode()).isEqualTo(409);
        assertThat(codigo(cedo)).isEqualTo("STATE_CONFLICT");
        assertThat(CenarioOs.ler(cedo.body()).get("mensagem").asText()).contains("prazo de 7 dias");
        assertThat(chaveGravada(c, k)).isEqualTo("0");

        // falta 1 minuto para completar 7 dias: recusado
        concluidaHa(c, os, "7 days - 1 minute");
        JsonNode detalhe = CenarioOs.ler(get(EMPRESA + os, CHAVES.token(GESTOR_A)).body());
        assertThat(detalhe.at("/encerramento/empresa_pode_encerrar").asBoolean()).isFalse();
        assertThat(codigo(encerrar(os, 3))).isEqualTo("STATE_CONFLICT");
        assertThat(situacao(c, os)).isEqualTo(antes);

        // exatamente 7 dias na hora da preparação (a regra usa >=): permitido; a_partir_de = conclusão + 7 dias
        concluidaHa(c, os, "7 days");
        detalhe = CenarioOs.ler(get(EMPRESA + os, CHAVES.token(GESTOR_A)).body());
        assertThat(detalhe.at("/encerramento/empresa_pode_encerrar").asBoolean()).isTrue();
        assertThat(c.adm("SELECT ((?::jsonb ->> 'a_partir_de')::timestamptz = concluida_em + interval '7 days')::text FROM public.ordens_servico WHERE id = ?::uuid",
                detalhe.get("encerramento").toString(), os)).isEqualTo("true");
        ok(encerrar(os, 3));
        assertThat(situacao(c, os)).isEqualTo("encerrada|4|false|empresa|false|0,1|0,1|1:180.00:0.00|0,0");
        // o Cliente vê a OS encerrada pela empresa e já não confirma nem pede revisão
        JsonNode cliente = CenarioOs.ler(get(CLIENTE + os, CHAVES.token(CLIENTE_ESCRITA)).body());
        assertThat(cliente.get("estado").asText()).isEqualTo("encerrada");
        assertThat(cliente.get("encerrada_por").asText()).isEqualTo("empresa");
        assertThat(cliente.has("pode")).isFalse();
        assertThat(codigo(enviar(CLIENTE, os, "confirmar-recebimento", CLIENTE_ESCRITA, corpo("versao", 4, "chave", chave())))).isEqualTo("STATE_CONFLICT");
        assertThat(codigo(enviar(CLIENTE, os, "pedir-revisao", CLIENTE_ESCRITA, corpo("versao", 4, "chave", chave(), "texto", REVISAO)))).isEqualTo("STATE_CONFLICT");
    }

    /** Revisão pendente impede o encerramento; resolvida pela reabertura e nova conclusão, o prazo recomeça. */
    @Test
    void revisaoPendenteImpedeEReabrirReiniciaOPrazo() throws Exception {
        CenarioOs c = cenario();
        String os = concluidaDaPlataforma(c);
        concluidaHa(c, os, "8 days");
        ok(enviar(CLIENTE, os, "pedir-revisao", CLIENTE_ESCRITA, corpo("versao", 3, "chave", chave(), "texto", REVISAO)));
        var pendente = encerrar(os, 4);
        assertThat(pendente.statusCode()).isEqualTo(409);
        assertThat(CenarioOs.ler(pendente.body()).get("mensagem").asText()).contains("pediu revisão");
        assertThat(situacao(c, os)).startsWith("concluida|4|true|-|false|0,0|0,0|");

        ok(reabrir(os, 4));
        ok(empresa(os, "concluir", GESTOR_A, corpo("versao", 5, "chave", chave())));
        // a nova conclusão tem data nova: o prazo de 7 dias conta de novo
        var recomeca = encerrar(os, 6);
        assertThat(codigo(recomeca)).isEqualTo("STATE_CONFLICT");
        assertThat(CenarioOs.ler(recomeca.body()).get("mensagem").asText()).contains("prazo de 7 dias");
        concluidaHa(c, os, "8 days");
        ok(encerrar(os, 6));
        assertThat(situacao(c, os)).isEqualTo("encerrada|7|false|empresa|false|1,1|1,1|1:180.00:0.00|0,0");
    }

    // ------------------------------------------------------------------------------------------------ comuns

    @Test
    void quemNaoPodeAlterarNaoReabreNemEncerraEOutraEmpresaRecebe404() throws Exception {
        CenarioOs c = cenario();
        String soVer = "eb0a0100-0000-4000-8000-000000000090";
        c.novoMembroDaEmpresaEscrita(soVer, "so-ver-j09", "servicos.visualizar");
        String interna = concluidaInterna(c);
        String plataforma = concluidaDaPlataforma(c);
        String antesI = situacao(c, interna), antesP = situacao(c, plataforma);
        var inexistente = encerrar(UUID.randomUUID().toString(), 3);
        assertThat(inexistente.statusCode()).isEqualTo(404);
        for (String sub : List.of(CLIENTE_ESCRITA, CLIENTE_1, DONO_B, SEM_PERFIL)) {
            var e = empresa(interna, "encerrar", sub, corpo("versao", 3, "chave", chave()));
            var r = empresa(plataforma, "reabrir", sub, corpo("versao", 3, "chave", chave(), "motivo", MOTIVO));
            assertThat(e.statusCode()).as("encerrar " + sub).isEqualTo(404);
            assertThat(r.statusCode()).as("reabrir " + sub).isEqualTo(404);
            assertThat(e.body()).isEqualTo(inexistente.body());
            assertThat(r.body()).isEqualTo(inexistente.body());
        }
        for (String sub : List.of(MEMBRO_SEM_VISAO, soVer)) {
            var e = empresa(interna, "encerrar", sub, corpo("versao", 3, "chave", chave()));
            var r = empresa(plataforma, "reabrir", sub, corpo("versao", 3, "chave", chave(), "motivo", MOTIVO));
            assertThat(e.statusCode()).as(sub).isEqualTo(403);
            assertThat(r.statusCode()).as(sub).isEqualTo(403);
            assertThat(codigo(e)).isEqualTo("FORBIDDEN_ACTION");
        }
        assertThat(empresa(interna, "encerrar", null, corpo("versao", 3, "chave", chave())).statusCode()).isEqualTo(401);
        assertThat(situacao(c, interna)).isEqualTo(antesI);
        assertThat(situacao(c, plataforma)).isEqualTo(antesP);
        // o dono pode
        ok(empresa(interna, "encerrar", DONO_A, corpo("versao", 3, "chave", chave())));
        ok(empresa(plataforma, "reabrir", DONO_A, corpo("versao", 3, "chave", chave(), "motivo", MOTIVO)));
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
    void tentativasSimultaneasSoUmaPassa() throws Exception {
        CenarioOs c = cenario();
        // encerrar × encerrar
        String os = concluidaInterna(c);
        assertThat(juntos(() -> encerrar(os, 3), () -> encerrar(os, 3))).containsExactly(200, 409);
        assertThat(situacao(c, os)).isEqualTo("encerrada|4|false|empresa|false|0,1|0,1|1:180.00:0.00|0,0");
        // reabrir × encerrar na mesma OS interna concluída: um só vale
        for (int i = 0; i < 3; i++) {
            String o = concluidaInterna(c);
            assertThat(juntos(() -> reabrir(o, 3), () -> encerrar(o, 3))).containsExactly(200, 409);
            String s = situacao(c, o);
            assertThat(s.startsWith("em_execucao|4|false|-|true|1,0|1,0|") || s.startsWith("encerrada|4|false|empresa|false|0,1|0,1|")).as(s).isTrue();
        }
        // reabrir (empresa) × confirmar recebimento (Cliente) na mesma OS da plataforma, com a mesma versão
        for (int i = 0; i < 3; i++) {
            String o = concluidaDaPlataforma(c);
            assertThat(juntos(() -> reabrir(o, 3),
                    () -> enviar(CLIENTE, o, "confirmar-recebimento", CLIENTE_ESCRITA, corpo("versao", 3, "chave", chave())))).containsExactly(200, 409);
            String s = situacao(c, o);
            assertThat(s.startsWith("em_execucao|4|false|-|true|1,0|1,0|") || s.startsWith("encerrada|4|false|cliente|false|0,0|0,0|")).as(s).isTrue();
        }
    }

    @Test
    void respostaPerdidaReenvioIdenticoNaoDuplicaEChaveComOutrosDadosERecusada() throws Exception {
        CenarioOs c = cenario();
        String os = concluidaInterna(c);
        String k = chave();
        String pedido = JSON.writeValueAsString(corpo("versao", 3, "chave", k));
        assertThat(postDescartandoResposta(EMPRESA + os + "/encerrar", CHAVES.token(GESTOR_A), pedido)).isEqualTo(200);
        String gravado = situacao(c, os);
        assertThat(gravado).isEqualTo("encerrada|4|false|empresa|false|0,1|0,1|1:180.00:0.00|0,0");
        var reenvio = post(EMPRESA + os + "/encerrar", CHAVES.token(GESTOR_A), pedido);
        ok(reenvio);
        assertThat(CenarioOs.ler(reenvio.body()).get("estado").asText()).isEqualTo("encerrada");
        assertThat(situacao(c, os)).isEqualTo(gravado);
        assertThat(chaveGravada(c, k)).isEqualTo("1");
        assertThat(codigo(empresa(os, "encerrar", GESTOR_A, corpo("versao", 2, "chave", k)))).isEqualTo("IDEMPOTENCY_CONFLICT");

        String os2 = concluidaDaPlataforma(c);
        String k2 = chave();
        String pedido2 = JSON.writeValueAsString(corpo("versao", 3, "chave", k2, "motivo", MOTIVO));
        assertThat(postDescartandoResposta(EMPRESA + os2 + "/reabrir", CHAVES.token(GESTOR_A), pedido2)).isEqualTo(200);
        String gravado2 = situacao(c, os2);
        ok(post(EMPRESA + os2 + "/reabrir", CHAVES.token(GESTOR_A), pedido2));
        assertThat(situacao(c, os2)).isEqualTo(gravado2);
        var outroMotivo = empresa(os2, "reabrir", GESTOR_A, corpo("versao", 3, "chave", k2, "motivo", MOTIVO + " Editado."));
        assertThat(codigo(outroMotivo)).isEqualTo("IDEMPOTENCY_CONFLICT");
        assertThat(situacao(c, os2)).isEqualTo(gravado2);
    }

    @Test
    void reenvioDeQuemPerdeuPermissaoNaoDevolveAOs() throws Exception {
        CenarioOs c = cenario();
        String membro = "eb0a0100-0000-4000-8000-000000000091";
        String perfil = c.novoMembroDaEmpresaEscrita(membro, "perde-alterar-j09", "servicos.alterar,servicos.visualizar");
        String os = concluidaInterna(c);
        Map<String, Object> pedido = corpo("versao", 3, "chave", chave());
        ok(empresa(os, "encerrar", membro, pedido));
        c.adm("DELETE FROM public.perfil_permissoes WHERE perfil_id = ?::uuid AND codigo = 'servicos.alterar'", perfil);
        var r = empresa(os, "encerrar", membro, pedido);
        assertThat(r.statusCode()).isEqualTo(403);
        assertThat(r.body()).doesNotContain(os);
        assertThat(CenarioOs.ler(r.body()).size()).isEqualTo(2);
    }

    /** T-ATOM: falha forçada depois do UPDATE da OS desfaz estado, versão, histórico, auditoria e chave. */
    @Test
    void falhaDepoisDaAtualizacaoDesfazTudo() throws Exception {
        CenarioOs c = cenario();
        c.adm("CREATE SCHEMA IF NOT EXISTS teste_j09");
        c.adm("CREATE SEQUENCE IF NOT EXISTS teste_j09.viu_update");
        c.adm("CREATE OR REPLACE FUNCTION teste_j09.falhar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                + "IF (SELECT estado IN ('em_execucao', 'encerrada') FROM public.ordens_servico WHERE id = TG_ARGV[0]::uuid) THEN "
                + "PERFORM nextval('teste_j09.viu_update'); END IF; "
                + "RAISE EXCEPTION 'falha forçada pelo teste T-ATOM'; END $$");
        String[][] pontos = {
                {"reabrir", "historico", "public.os_eventos", "NEW.os_id = '%s'::uuid AND NEW.tipo = 'reabrir'"},
                {"reabrir", "auditoria", "app_private.eventos_auditoria", "NEW.recurso_id = '%s'::uuid AND NEW.tipo_acao = 'servicos.os_reabrir'"},
                {"reabrir", "chave", "app_private.operacoes_idempotentes", "NEW.funcao = 'mudar_estado_os' AND NEW.chave = '%2$s'"},
                {"encerrar", "historico", "public.os_eventos", "NEW.os_id = '%s'::uuid AND NEW.tipo = 'encerrar'"},
                {"encerrar", "auditoria", "app_private.eventos_auditoria", "NEW.recurso_id = '%s'::uuid AND NEW.tipo_acao = 'servicos.os_encerrar'"},
                {"encerrar", "chave", "app_private.operacoes_idempotentes", "NEW.funcao = 'mudar_estado_os' AND NEW.chave = '%2$s'"}};
        for (String[] p : pontos) {
            String os = p[0].equals("reabrir") ? concluidaDaPlataforma(c) : concluidaInterna(c);
            String k = chave();
            String antes = situacao(c, os);
            String gatilho = "t_atom_j09_" + p[0] + "_" + p[1];
            c.adm("CREATE TRIGGER " + gatilho + " BEFORE INSERT ON " + p[2] + " FOR EACH ROW WHEN ("
                    + String.format(p[3], os, k) + ") EXECUTE FUNCTION teste_j09.falhar('" + os + "')");
            Map<String, Object> pedido = p[0].equals("reabrir") ? corpo("versao", 3, "chave", k, "motivo", MOTIVO) : corpo("versao", 3, "chave", k);
            try {
                long antesSeq = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j09.viu_update"));
                var r = empresa(os, p[0], GESTOR_A, pedido);
                assertThat(r.statusCode()).as(p[0] + "/" + p[1]).isEqualTo(500);
                assertThat(r.body()).doesNotContain("T-ATOM").doesNotContain("trigger");
                long depoisSeq = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j09.viu_update"));
                assertThat(depoisSeq).as(p[0] + "/" + p[1] + ": a falha veio depois do UPDATE da OS").isEqualTo(antesSeq + 1);
                assertThat(situacao(c, os)).as(p[0] + "/" + p[1] + ": nada gravado").isEqualTo(antes);
                assertThat(chaveGravada(c, k)).isEqualTo("0");
            } finally {
                c.adm("DROP TRIGGER " + gatilho + " ON " + p[2]);
            }
            ok(empresa(os, p[0], GESTOR_A, pedido));
            assertThat(chaveGravada(c, k)).isEqualTo("1");
        }
        c.adm("DROP SCHEMA teste_j09 CASCADE");
    }

    // ------------------------------------------------------------------------------------------------ ciclo integrado

    /**
     * Ciclo completo pela API, sem forçar estado: OS da plataforma criada pela contratação → Iniciar → Pausar → Retomar
     * → Informar conclusão → (Cliente) Pedir revisão → Reabrir para revisão → Informar conclusão → (Cliente) Confirmar
     * recebimento. Versões em sequência, cada evento uma vez, uma conta a receber, nenhum pagamento.
     */
    @Test
    void cicloCompletoDaPlataformaTerminaNaConfirmacaoDoCliente() throws Exception {
        CenarioOs c = cenario();
        String os = c.novaOsParaEscrita();
        int v = 1;
        ok(empresa(os, "iniciar", GESTOR_A, corpo("versao", v++, "chave", chave())));
        ok(empresa(os, "pausar", GESTOR_A, corpo("versao", v++, "chave", chave(), "motivo", PAUSA_INTERNA)));
        ok(empresa(os, "retomar", GESTOR_A, corpo("versao", v++, "chave", chave())));
        ok(empresa(os, "concluir", GESTOR_A, corpo("versao", v++, "chave", chave())));
        // um reenvio repetido no meio do ciclo não muda nada
        String kRevisao = chave();
        Map<String, Object> revisao = corpo("versao", v, "chave", kRevisao, "texto", REVISAO);
        ok(enviar(CLIENTE, os, "pedir-revisao", CLIENTE_ESCRITA, revisao));
        v++;
        ok(enviar(CLIENTE, os, "pedir-revisao", CLIENTE_ESCRITA, revisao));
        ok(reabrir(os, v++));
        ok(empresa(os, "concluir", GESTOR_A, corpo("versao", v++, "chave", chave())));
        // o reenvio do pedido de revisão antigo, depois da reabertura, é reconhecido sem gravar de novo
        ok(enviar(CLIENTE, os, "pedir-revisao", CLIENTE_ESCRITA, revisao));
        ok(enviar(CLIENTE, os, "confirmar-recebimento", CLIENTE_ESCRITA, corpo("versao", v++, "chave", chave())));
        assertThat(v).isEqualTo(9);
        assertThat(situacao(c, os)).isEqualTo("encerrada|9|false|cliente|false|1,0|1,0|1:180.00:0.00|0,0");
        JsonNode empresa = CenarioOs.ler(get(EMPRESA + os, CHAVES.token(GESTOR_A)).body());
        assertThat(tipos(empresa)).containsSubsequence("iniciar", "pausar", "retomar", "concluir", "revisao_pedida", "reabrir", "concluir", "recebimento_confirmado");
        assertThat(tipos(empresa).stream().filter("concluir"::equals).count()).isEqualTo(2);
        assertThat(tipos(empresa).stream().filter("revisao_pedida"::equals).count()).isEqualTo(1);
        assertThat(c.adm("SELECT string_agg(tipo_acao, ',' ORDER BY criado_em) FROM app_private.eventos_auditoria WHERE recurso_id = ?::uuid AND tipo_acao LIKE 'servicos.os_%'", os))
                .isEqualTo("servicos.os_criada,servicos.os_iniciar,servicos.os_pausar,servicos.os_retomar,servicos.os_concluir,servicos.os_reabrir,servicos.os_concluir,servicos.os_encerrada_pelo_cliente");
        JsonNode cliente = CenarioOs.ler(get(CLIENTE + os, CHAVES.token(CLIENTE_ESCRITA)).body());
        assertThat(cliente.toString()).contains(MOTIVO).contains(REVISAO).doesNotContain(PAUSA_INTERNA);
        assertThat(cliente.get("encerrada_por").asText()).isEqualTo("cliente");
    }

    /**
     * Ciclo completo da OS interna, que termina no encerramento pela empresa (sem prazo): Iniciar → Pausar → Retomar →
     * Informar conclusão → Reabrir → Informar conclusão → Encerrar.
     */
    @Test
    void cicloCompletoInternoTerminaNoEncerramentoPelaEmpresa() throws Exception {
        CenarioOs c = cenario();
        String os = c.novaOsInternaParaEscrita();
        int v = 1;
        ok(empresa(os, "iniciar", GESTOR_A, corpo("versao", v++, "chave", chave())));
        ok(empresa(os, "pausar", GESTOR_A, corpo("versao", v++, "chave", chave(), "motivo", PAUSA_INTERNA)));
        ok(empresa(os, "retomar", GESTOR_A, corpo("versao", v++, "chave", chave())));
        ok(empresa(os, "concluir", GESTOR_A, corpo("versao", v++, "chave", chave())));
        ok(reabrir(os, v++));
        ok(empresa(os, "concluir", GESTOR_A, corpo("versao", v++, "chave", chave())));
        ok(encerrar(os, v++));
        assertThat(situacao(c, os)).isEqualTo("encerrada|8|false|empresa|false|1,1|1,1|1:180.00:0.00|0,0");
        assertThat(c.adm("SELECT string_agg(tipo_acao, ',' ORDER BY criado_em) FROM app_private.eventos_auditoria WHERE recurso_id = ?::uuid AND tipo_acao LIKE 'servicos.os_%'", os))
                .isEqualTo("servicos.os_criada,servicos.os_iniciar,servicos.os_pausar,servicos.os_retomar,servicos.os_concluir,servicos.os_reabrir,servicos.os_concluir,servicos.os_encerrar");
    }
}
