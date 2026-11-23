package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_ACOMPANHAMENTO;
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
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/**
 * J11 (ADR-J02 §4.5): materiais e estoque da OS pela API Java. Regras das funções do M09 e do motor de estoque do M05,
 * sem mudança. Produtos, estoques e OS fictícios criados pelas funções do app, no banco de teste descartável; ao fim de
 * cada cenário, a integridade entre saldos, reservas, movimentações e materiais da OS é conferida no PostgreSQL.
 */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class MateriaisOrdemServicoTest extends ApiComBancoBase {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String EMPRESA = "/api/business/ordens-servico/";
    private static final String CLIENTE = "/api/cliente/ordens-servico/";
    /** Membro que altera OS e propõe estoque, mas não aprova estoque nem vê custo: o uso dele fica pendente. */
    private static final String TECNICO = "eb0a0100-0000-4000-8000-0000000000b0";
    private static boolean tecnicoCriado;

    private static String chave() {
        return "j11-" + UUID.randomUUID();
    }

    private static Map<String, Object> corpo(Object... pares) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < pares.length; i += 2) m.put((String) pares[i], pares[i + 1]);
        return m;
    }

    private HttpResponse<String> enviar(String caminho, String sub, Object corpo) {
        try {
            String texto = corpo instanceof String s ? s : JSON.writeValueAsString(corpo);
            return post(EMPRESA + caminho, sub == null ? null : CHAVES.token(sub), texto);
        } catch (Exception erro) {
            throw new IllegalStateException(erro);
        }
    }

    private HttpResponse<String> adicionar(String os, String sub, String variacao, int qtd) {
        return enviar(os + "/materiais", sub, corpo("chave", chave(), "variacao_id", variacao, "quantidade", qtd));
    }

    private HttpResponse<String> reservar(String os, String material, String sub, boolean reservar) {
        return enviar(os + "/materiais/" + material + "/reserva", sub, corpo("chave", chave(), "reservar", reservar));
    }

    private HttpResponse<String> usar(String os, String sub, String variacao, int qtd) {
        return enviar(os + "/usos-material", sub, corpo("chave", chave(), "variacao_id", variacao, "quantidade", qtd));
    }

    private HttpResponse<String> decidir(String os, String uso, String sub, boolean aprovar, String motivo, int versao) {
        return enviar(os + "/usos-material/" + uso + "/decisao", sub, corpo("versao", versao, "chave", chave(), "aprovar", aprovar, "motivo", motivo));
    }

    private HttpResponse<String> devolver(String os, String material, String sub, int qtd) {
        return enviar(os + "/materiais/" + material + "/devolucao", sub, corpo("chave", chave(), "quantidade", qtd, "motivo", "Sobrou na obra (teste J11)."));
    }

    private static void ok(HttpResponse<String> r) {
        assertThat(r.statusCode()).as(r.body()).isEqualTo(200);
    }

    private static void conflito(HttpResponse<String> r, String codigo) {
        assertThat(r.statusCode()).as(r.body()).isEqualTo(409);
        assertThat(codigo(r)).isEqualTo(codigo);
    }

    /** Produto fictício da empresa de escrita, com saldo inicial, criado pela função do M05; devolve a variação padrão. */
    private static String produto(CenarioOs c, String nome, int quantidade, boolean comercializavel) throws Exception {
        String dados = JSON.writeValueAsString(Map.of("nome", nome + " " + UUID.randomUUID().toString().substring(0, 8),
                "finalidade", comercializavel ? "comercializavel" : "uso_interno", "preco_centavos", 2500, "custo_centavos", 1200,
                "quantidade_inicial", quantidade));
        String criado = c.comoUsuario(DONO_A, "SELECT public.criar_produto(?::uuid, ?::jsonb, NULL, ?)::text", c.empresaEscrita, dados, chave());
        return CenarioOs.ler(criado).get("variacoes").get(0).get("id").asText();
    }

    private void tecnico(CenarioOs c) throws Exception {
        synchronized (MateriaisOrdemServicoTest.class) {
            if (!tecnicoCriado) {
                c.novoMembroDaEmpresaEscrita(TECNICO, "tecnico-materiais-j11", "servicos.alterar,servicos.visualizar,estoque.propor");
                tecnicoCriado = true;
            }
        }
    }

    /** OS interna nova, iniciada (em execução, versão 2). */
    private String emExecucao(CenarioOs c) throws Exception {
        String os = c.novaOsInternaParaEscrita();
        ok(enviar(os + "/iniciar", GESTOR_A, corpo("versao", 1, "chave", chave())));
        return os;
    }

    private static int versaoOs(CenarioOs c, String os) throws Exception {
        return Integer.parseInt(c.adm("SELECT versao::text FROM public.ordens_servico WHERE id = ?::uuid", os));
    }

    private static String material(CenarioOs c, String os, String variacao) throws Exception {
        return c.adm("SELECT id::text FROM public.os_materiais WHERE os_id = ?::uuid AND variacao_id = ?::uuid", os, variacao);
    }

    /** físico/reservado/disponível da variação. */
    private static String estoque(CenarioOs c, String variacao) throws Exception {
        return c.adm("SELECT fisico || '/' || reservado || '/' || disponivel FROM public.saldos_estoque WHERE variacao_id = ?::uuid", variacao);
    }

    /** prevista/usada/devolvida/reservada(ativa) do material. */
    private static String quantidades(CenarioOs c, String material) throws Exception {
        return c.adm("SELECT m.qtd_prevista || '/' || m.qtd_usada || '/' || m.qtd_devolvida || '/' || coalesce((SELECT sum(r.quantidade) "
                + "FROM public.reservas_estoque r WHERE r.origem_tipo = 'os_material' AND r.origem_id = m.reserva_origem_id AND r.estado = 'ativa'), 0) "
                + "FROM public.os_materiais m WHERE m.id = ?::uuid", material);
    }

    private static String movimentos(CenarioOs c, String variacao) throws Exception {
        return c.adm("SELECT count(*) || ':' || coalesce(sum(quantidade), 0) FROM public.movimentacoes_estoque WHERE variacao_id = ?::uuid", variacao);
    }

    /**
     * Integridade de TODO o estoque da empresa de escrita: reservado = soma das reservas ativas; físico = soma das
     * movimentações; físico >= reservado >= 0; usado e devolvido de cada material = soma dos usos e devoluções confirmados;
     * a baixa líquida de cada material = as movimentações da OS; toda reserva ativa de material ligada a um material.
     */
    static String integridade(CenarioOs c) throws Exception {
        String e = c.empresaEscrita;
        return c.adm("SELECT coalesce(string_agg(p, '; '), 'ok') FROM ("
                + " SELECT 'reservado ' || s.variacao_id FROM public.saldos_estoque s WHERE s.empresa_id = ?::uuid AND s.reservado <> "
                + "   coalesce((SELECT sum(r.quantidade) FROM public.reservas_estoque r WHERE r.variacao_id = s.variacao_id AND r.estado = 'ativa'), 0)"
                + " UNION ALL SELECT 'fisico ' || s.variacao_id FROM public.saldos_estoque s WHERE s.empresa_id = ?::uuid AND s.fisico <> "
                + "   coalesce((SELECT sum(x.quantidade) FROM public.movimentacoes_estoque x WHERE x.variacao_id = s.variacao_id), 0)"
                + " UNION ALL SELECT 'limites ' || s.variacao_id FROM public.saldos_estoque s WHERE s.empresa_id = ?::uuid AND (s.fisico < s.reservado OR s.reservado < 0)"
                + " UNION ALL SELECT 'usada ' || m.id FROM public.os_materiais m WHERE m.empresa_id = ?::uuid AND m.qtd_usada <> "
                + "   coalesce((SELECT sum(u.quantidade) FROM public.os_material_usos u WHERE u.os_material_id = m.id AND u.tipo = 'uso' AND u.estado = 'confirmado'), 0)"
                + " UNION ALL SELECT 'devolvida ' || m.id FROM public.os_materiais m WHERE m.empresa_id = ?::uuid AND m.qtd_devolvida <> "
                + "   coalesce((SELECT sum(u.quantidade) FROM public.os_material_usos u WHERE u.os_material_id = m.id AND u.tipo = 'devolucao' AND u.estado = 'confirmado'), 0)"
                + " UNION ALL SELECT 'movimento ' || m.id FROM public.os_materiais m WHERE m.empresa_id = ?::uuid AND (m.qtd_usada - m.qtd_devolvida) <> "
                + "   -coalesce((SELECT sum(x.quantidade) FROM public.movimentacoes_estoque x WHERE x.origem_tipo = 'os' AND x.origem_id = m.os_id AND x.variacao_id = m.variacao_id), 0)"
                + " UNION ALL SELECT 'orfa ' || r.id FROM public.reservas_estoque r WHERE r.empresa_id = ?::uuid AND r.origem_tipo = 'os_material' AND r.estado = 'ativa'"
                + "   AND NOT EXISTS (SELECT 1 FROM public.os_materiais m WHERE m.reserva_origem_id = r.origem_id)"
                + ") problemas(p)", e, e, e, e, e, e, e);
    }

    private static List<Boolean> juntos(List<Supplier<Boolean>> chamadas) {
        CountDownLatch largada = new CountDownLatch(1);
        List<CompletableFuture<Boolean>> f = new ArrayList<>();
        for (Supplier<Boolean> s : chamadas) {
            f.add(CompletableFuture.supplyAsync(() -> {
                try {
                    largada.await();
                } catch (InterruptedException erro) {
                    Thread.currentThread().interrupt();
                }
                return s.get();
            }));
        }
        largada.countDown();
        return f.stream().map(CompletableFuture::join).toList();
    }

    private static long sucessos(List<Boolean> r) {
        return r.stream().filter(Boolean::booleanValue).count();
    }

    // ================================================================================================ ciclo e estoque

    /** Quando o físico muda e quando não: previsto e reserva não baixam; uso baixa; devolução volta; conclusão libera. */
    @Test
    void cicloCompletoComEstoqueFisicoReservadoEDisponivel() throws Exception {
        CenarioOs c = cenario();
        String v = produto(c, "Chuveiro fictício J11", 10, false);
        String os = emExecucao(c);
        ok(adicionar(os, GESTOR_A, v, 3));
        ok(adicionar(os, GESTOR_A, v, 2));
        String m = material(c, os, v);
        assertThat(quantidades(c, m)).as("previsto soma, nada reservado").isEqualTo("5/0/0/0");
        assertThat(estoque(c, v)).as("previsto não mexe no estoque").isEqualTo("10/0/10");
        String movimentosIniciais = movimentos(c, v);

        var r = reservar(os, m, GESTOR_A, true);
        ok(r);
        assertThat(CenarioOs.ler(r.body()).isArray()).as("resposta no formato da função: lista de materiais").isTrue();
        assertThat(r.body()).as("o Gestor tem produtos.ver_custo: a leitura nova traz os custos").contains("custo_previsto_centavos");
        assertThat(estoque(c, v)).as("reserva não é baixa física").isEqualTo("10/5/5");
        assertThat(movimentos(c, v)).isEqualTo(movimentosIniciais);

        var uso = usar(os, GESTOR_A, v, 2);
        ok(uso);
        JsonNode u = CenarioOs.ler(uso.body());
        assertThat(u.get("estado").asText()).as("quem aprova estoque baixa na hora").isEqualTo("confirmado");
        assertThat(u.get("uso_id").asText()).isNotBlank();
        assertThat(u.get("materiais").isArray()).isTrue();
        assertThat(estoque(c, v)).as("uso baixa 2 do físico; a reserva do restante (3) é refeita").isEqualTo("8/3/5");
        assertThat(quantidades(c, m)).isEqualTo("5/2/0/3");

        ok(devolver(os, m, GESTOR_A, 1));
        assertThat(estoque(c, v)).as("devolução volta 1 ao físico, uma vez").isEqualTo("9/3/6");
        assertThat(quantidades(c, m)).isEqualTo("5/2/1/3");
        assertThat(integridade(c)).isEqualTo("ok");

        ok(enviar(os + "/concluir", GESTOR_A, corpo("versao", versaoOs(c, os), "chave", chave())));
        assertThat(estoque(c, v)).as("conclusão libera a reserva restante; físico igual").isEqualTo("9/0/9");
        assertThat(quantidades(c, m)).isEqualTo("5/2/1/0");
        ok(enviar(os + "/encerrar", GESTOR_A, corpo("versao", versaoOs(c, os), "chave", chave())));
        assertThat(estoque(c, v)).as("encerrar não mexe no estoque (nada reservado na OS concluída)").isEqualTo("9/0/9");
        // histórico interno e auditoria da baixa e da devolução
        assertThat(c.adm("SELECT string_agg(tipo || ':' || publico, ',' ORDER BY criado_em) FROM public.os_eventos WHERE os_id = ?::uuid "
                + "AND tipo IN ('material_previsto', 'material_reservado', 'material_usado', 'material_devolvido')", os))
                .isEqualTo("material_previsto:false,material_previsto:false,material_reservado:false,material_usado:false,material_devolvido:false");
        assertThat(c.adm("SELECT string_agg(tipo_acao, ',' ORDER BY criado_em) FROM app_private.eventos_auditoria WHERE tipo_acao LIKE 'servicos.material_%' "
                + "AND recurso_id IN (SELECT u.id FROM public.os_material_usos u WHERE u.os_material_id = ?::uuid)", m))
                .isEqualTo("servicos.material_baixado,servicos.material_devolvido");
        assertThat(integridade(c)).isEqualTo("ok");
    }

    @Test
    void usoPendenteConfirmadoOuRecusadoComVersaoDoRegistro() throws Exception {
        CenarioOs c = cenario();
        tecnico(c);
        String v = produto(c, "Cabo fictício J11", 6, false);
        String os = emExecucao(c);
        var r = usar(os, TECNICO, v, 2);
        ok(r);
        JsonNode u = CenarioOs.ler(r.body());
        assertThat(u.get("estado").asText()).isEqualTo("pendente");
        assertThat(r.body()).as("sem produtos.ver_custo, sem custos na resposta").doesNotContain("custo");
        assertThat(estoque(c, v)).as("uso pendente não mexe no estoque").isEqualTo("6/0/6");
        String uso = u.get("uso_id").asText();
        // versão desatualizada do registro de uso, motivo indevido ou ausente → recusados sem mudar nada
        conflito(decidir(os, uso, GESTOR_A, true, null, 2), "VERSION_CONFLICT");
        assertThat(decidir(os, uso, GESTOR_A, true, "Não devia ter motivo.", 1).statusCode()).isEqualTo(400);
        assertThat(decidir(os, uso, GESTOR_A, false, "x", 1).statusCode()).isEqualTo(400);
        assertThat(decidir(os, uso, TECNICO, true, null, 1).statusCode()).as("sem estoque.aprovar").isEqualTo(403);
        assertThat(estoque(c, v)).isEqualTo("6/0/6");
        ok(decidir(os, uso, GESTOR_A, true, null, 1));
        assertThat(estoque(c, v)).isEqualTo("4/0/4");
        conflito(decidir(os, uso, GESTOR_A, true, null, 2), "STATE_CONFLICT");
        // recusa: estoque igual
        String uso2 = CenarioOs.ler(usar(os, TECNICO, v, 1).body()).get("uso_id").asText();
        ok(decidir(os, uso2, GESTOR_A, false, "Não foi usado de verdade.", 1));
        assertThat(estoque(c, v)).isEqualTo("4/0/4");
        assertThat(c.adm("SELECT string_agg(estado, ',' ORDER BY criado_em) FROM public.os_material_usos WHERE os_material_id = ?::uuid", material(c, os, v)))
                .isEqualTo("confirmado,recusado");
        // um registro de uso de outra OS não é decidido por esta rota
        String outra = emExecucao(c);
        assertThat(decidir(outra, uso2, GESTOR_A, true, null, 2).statusCode()).isEqualTo(404);
        assertThat(integridade(c)).isEqualTo("ok");
    }

    /** Última unidade: duas OS reservando ao mesmo tempo; e duas baixas simultâneas sem reserva. */
    @Test
    void ultimaUnidadeProtegidaContraConcorrencia() throws Exception {
        CenarioOs c = cenario();
        for (int rodada = 0; rodada < 3; rodada++) {
            String v = produto(c, "Resistência fictícia J11", 1, false);
            String a = emExecucao(c), b = emExecucao(c);
            ok(adicionar(a, GESTOR_A, v, 1));
            ok(adicionar(b, GESTOR_A, v, 1));
            String ma = material(c, a, v), mb = material(c, b, v);
            List<Boolean> r = juntos(List.of(() -> reservar(a, ma, GESTOR_A, true).statusCode() == 200,
                    () -> reservar(b, mb, DONO_A, true).statusCode() == 200));
            assertThat(sucessos(r)).isEqualTo(1);
            assertThat(estoque(c, v)).isEqualTo("1/1/0");
            String perdeu = r.get(0) ? b : a;
            String ganhou = r.get(0) ? a : b;
            // quem não reservou também não consegue baixar a unidade reservada pela outra OS
            conflito(usar(perdeu, GESTOR_A, v, 1), "INSUFFICIENT_STOCK");
            assertThat(estoque(c, v)).isEqualTo("1/1/0");
            ok(usar(ganhou, GESTOR_A, v, 1));
            assertThat(estoque(c, v)).isEqualTo("0/0/0");
            assertThat(integridade(c)).isEqualTo("ok");
        }
        // sem reserva: duas baixas simultâneas da última unidade → só uma; físico nunca negativo
        String v = produto(c, "Fusível fictício J11", 1, false);
        String a = emExecucao(c), b = emExecucao(c);
        List<Boolean> r = juntos(List.of(() -> usar(a, GESTOR_A, v, 1).statusCode() == 200, () -> usar(b, DONO_A, v, 1).statusCode() == 200));
        assertThat(sucessos(r)).isEqualTo(1);
        assertThat(estoque(c, v)).isEqualTo("0/0/0");
        assertThat(c.adm("SELECT count(*)::text FROM public.os_material_usos u JOIN public.os_materiais m ON m.id = u.os_material_id WHERE m.variacao_id = ?::uuid", v))
                .as("o uso recusado por falta de estoque não ficou registrado").isEqualTo("1");
        assertThat(integridade(c)).isEqualTo("ok");
    }

    /** Sem disponibilidade, parcialmente e totalmente reservado, com vendas e pedidos no mesmo estoque (M06). */
    @Test
    void reservasParciaisETotaisComVendaNoMesmoEstoque() throws Exception {
        CenarioOs c = cenario();
        String zero = produto(c, "Disjuntor esgotado J11", 0, false);
        String os0 = emExecucao(c);
        ok(adicionar(os0, GESTOR_A, zero, 1));
        conflito(reservar(os0, material(c, os0, zero), GESTOR_A, true), "INSUFFICIENT_STOCK");
        conflito(usar(os0, GESTOR_A, zero, 1), "INSUFFICIENT_STOCK");
        assertThat(estoque(c, zero)).isEqualTo("0/0/0");

        String v = produto(c, "Lâmpada fictícia J11", 5, true);
        String a = emExecucao(c), b = emExecucao(c);
        ok(adicionar(a, GESTOR_A, v, 3));
        ok(reservar(a, material(c, a, v), GESTOR_A, true));
        assertThat(estoque(c, v)).as("parcialmente reservado").isEqualTo("5/3/2");
        ok(adicionar(b, GESTOR_A, v, 3));
        conflito(reservar(b, material(c, b, v), GESTOR_A, true), "INSUFFICIENT_STOCK");
        assertThat(estoque(c, v)).isEqualTo("5/3/2");
        // a outra OS reserva os 2 que restam (a previsão dela muda para 2 pela própria API)
        String b2 = emExecucao(c);
        ok(adicionar(b2, GESTOR_A, v, 2));
        ok(reservar(b2, material(c, b2, v), GESTOR_A, true));
        assertThat(estoque(c, v)).as("totalmente reservado").isEqualTo("5/5/0");
        // a venda no balcão (M06) não consome o que está reservado para as OS
        String venda = "SELECT public.registrar_venda_direta(?::uuid, '{}'::jsonb, ?::jsonb, '{}'::jsonb, NULL, ?)::text";
        String itens = "[{\"variacao_id\":\"" + v + "\",\"quantidade\":1}]";
        String recusa = "";
        try {
            c.comoUsuario(DONO_A, venda, c.empresaEscrita, itens, chave());
        } catch (Exception erro) {
            recusa = String.valueOf(erro.getMessage());
        }
        assertThat(recusa).contains("Estoque insuficiente");
        assertThat(estoque(c, v)).isEqualTo("5/5/0");
        // desfazer a reserva de uma OS devolve ao disponível, e a venda passa
        ok(reservar(a, material(c, a, v), GESTOR_A, false));
        assertThat(estoque(c, v)).isEqualTo("5/2/3");
        c.comoUsuario(DONO_A, venda, c.empresaEscrita, itens, chave());
        assertThat(estoque(c, v)).isEqualTo("4/2/2");
        assertThat(integridade(c)).isEqualTo("ok");
    }

    /** Uma OS e uma venda disputando a última unidade ao mesmo tempo: só uma leva. */
    @Test
    void osEVendaConcorrendoPelaUltimaUnidade() throws Exception {
        CenarioOs c = cenario();
        int osVenceu = 0, vendaVenceu = 0;
        for (int i = 0; i < 4; i++) {
            String v = produto(c, "Tomada fictícia J11", 1, true);
            String os = emExecucao(c);
            ok(adicionar(os, GESTOR_A, v, 1));
            String m = material(c, os, v);
            String itens = "[{\"variacao_id\":\"" + v + "\",\"quantidade\":1}]";
            List<Boolean> r = juntos(List.of(() -> reservar(os, m, GESTOR_A, true).statusCode() == 200, () -> {
                try {
                    c.comoUsuario(DONO_A, "SELECT public.registrar_venda_direta(?::uuid, '{}'::jsonb, ?::jsonb, '{}'::jsonb, NULL, ?)::text",
                            c.empresaEscrita, itens, chave());
                    return true;
                } catch (Exception erro) {
                    return false;
                }
            }));
            assertThat(sucessos(r)).isEqualTo(1);
            String e = estoque(c, v);
            if (r.get(0)) {
                osVenceu++;
                assertThat(e).isEqualTo("1/1/0");
            } else {
                vendaVenceu++;
                assertThat(e).isEqualTo("0/0/0");
            }
            assertThat(integridade(c)).isEqualTo("ok");
        }
        assertThat(osVenceu + vendaVenceu).isEqualTo(4);
    }

    // ================================================================================================ idempotência

    @Test
    void respostaPerdidaEReenvioNaoDuplicamMovimentacoes() throws Exception {
        CenarioOs c = cenario();
        String v = produto(c, "Conector fictício J11", 10, false);
        String os = emExecucao(c);
        // adicionar
        String ka = chave();
        String pa = JSON.writeValueAsString(corpo("chave", ka, "variacao_id", v, "quantidade", 4));
        assertThat(postDescartandoResposta(EMPRESA + os + "/materiais", CHAVES.token(GESTOR_A), pa)).isEqualTo(200);
        ok(post(EMPRESA + os + "/materiais", CHAVES.token(GESTOR_A), pa));
        String m = material(c, os, v);
        assertThat(quantidades(c, m)).as("previsto não dobra").isEqualTo("4/0/0/0");
        conflito(enviar(os + "/materiais", GESTOR_A, corpo("chave", ka, "variacao_id", v, "quantidade", 5)), "IDEMPOTENCY_CONFLICT");
        // reservar
        String kr = chave();
        String pr = JSON.writeValueAsString(corpo("chave", kr, "reservar", true));
        assertThat(postDescartandoResposta(EMPRESA + os + "/materiais/" + m + "/reserva", CHAVES.token(GESTOR_A), pr)).isEqualTo(200);
        ok(post(EMPRESA + os + "/materiais/" + m + "/reserva", CHAVES.token(GESTOR_A), pr));
        assertThat(estoque(c, v)).as("reserva não dobra").isEqualTo("10/4/6");
        assertThat(c.adm("SELECT count(*)::text FROM public.reservas_estoque WHERE variacao_id = ?::uuid", v)).isEqualTo("1");
        conflito(enviar(os + "/materiais/" + m + "/reserva", GESTOR_A, corpo("chave", kr, "reservar", false)), "IDEMPOTENCY_CONFLICT");
        // uso
        String ku = chave();
        String pu = JSON.writeValueAsString(corpo("chave", ku, "variacao_id", v, "quantidade", 3));
        assertThat(postDescartandoResposta(EMPRESA + os + "/usos-material", CHAVES.token(GESTOR_A), pu)).isEqualTo(200);
        String antes = movimentos(c, v);
        var reenvio = post(EMPRESA + os + "/usos-material", CHAVES.token(GESTOR_A), pu);
        ok(reenvio);
        assertThat(CenarioOs.ler(reenvio.body()).get("estado").asText()).isEqualTo("confirmado");
        assertThat(movimentos(c, v)).as("baixa não dobra").isEqualTo(antes);
        assertThat(estoque(c, v)).isEqualTo("7/1/6");
        // devolução
        String kd = chave();
        String pd = JSON.writeValueAsString(corpo("chave", kd, "quantidade", 2, "motivo", "Sobrou (teste J11)."));
        assertThat(postDescartandoResposta(EMPRESA + os + "/materiais/" + m + "/devolucao", CHAVES.token(GESTOR_A), pd)).isEqualTo(200);
        ok(post(EMPRESA + os + "/materiais/" + m + "/devolucao", CHAVES.token(GESTOR_A), pd));
        assertThat(estoque(c, v)).as("devolução não volta duas vezes").isEqualTo("9/1/8");
        assertThat(quantidades(c, m)).isEqualTo("4/3/2/1");
        // devolução NOVA acima do que falta voltar → recusada pela função
        assertThat(devolver(os, m, GESTOR_A, 2).statusCode()).isEqualTo(400);
        ok(devolver(os, m, GESTOR_A, 1));
        assertThat(devolver(os, m, GESTOR_A, 1).statusCode()).as("nada mais a devolver").isEqualTo(400);
        assertThat(estoque(c, v)).isEqualTo("10/1/9");
        // usos repetidos com chaves NOVAS são novos usos (regra: cada registro é uma baixa); como havia reserva, cada uso
        // refaz a reserva do que ainda falta usar (previsto 4 menos o líquido usado), regra do confirmar_uso
        ok(usar(os, GESTOR_A, v, 1));
        ok(usar(os, GESTOR_A, v, 1));
        assertThat(quantidades(c, m)).isEqualTo("4/5/3/2");
        assertThat(estoque(c, v)).isEqualTo("8/2/6");
        assertThat(integridade(c)).isEqualTo("ok");
    }

    @Test
    void reenvioDeQuemPerdeuPermissaoNaoDevolveOResultadoGuardado() throws Exception {
        CenarioOs c = cenario();
        String membro = "eb0a0100-0000-4000-8000-0000000000b1";
        String perfil = c.novoMembroDaEmpresaEscrita(membro, "perde-estoque-j11", "servicos.alterar,servicos.visualizar,estoque.propor");
        String v = produto(c, "Parafuso fictício J11", 10, false);
        String os = emExecucao(c);
        ok(adicionar(os, GESTOR_A, v, 2));
        String m = material(c, os, v);
        Map<String, Object> pedido = corpo("chave", chave(), "reservar", true);
        ok(enviar(os + "/materiais/" + m + "/reserva", membro, pedido));
        c.adm("DELETE FROM public.perfil_permissoes WHERE perfil_id = ?::uuid AND codigo = 'estoque.propor'", perfil);
        var r = enviar(os + "/materiais/" + m + "/reserva", membro, pedido);
        assertThat(r.statusCode()).isEqualTo(403);
        assertThat(r.body()).doesNotContain(m).doesNotContain("reservada");
        assertThat(estoque(c, v)).isEqualTo("10/2/8");
    }

    // ================================================================================================ acesso e estados

    @Test
    void isolamentoEntreEmpresasEPermissoes() throws Exception {
        CenarioOs c = cenario();
        tecnico(c);
        String soVer = "eb0a0100-0000-4000-8000-0000000000b2";
        c.novoMembroDaEmpresaEscrita(soVer, "so-ver-j11", "servicos.visualizar");
        String v = produto(c, "Fita fictícia J11", 10, false);
        String os = emExecucao(c);
        ok(adicionar(os, GESTOR_A, v, 2));
        ok(usar(os, GESTOR_A, v, 1));
        String m = material(c, os, v);
        String usoPendente = CenarioOs.ler(usar(os, TECNICO, v, 1).body()).get("uso_id").asText();
        String antes = estoque(c, v) + "|" + quantidades(c, m);
        var inexistente = adicionar(UUID.randomUUID().toString(), GESTOR_A, v, 1);
        assertThat(inexistente.statusCode()).isEqualTo(404);
        for (String sub : List.of(CLIENTE_ACOMPANHAMENTO, DONO_B, SEM_PERFIL)) {
            for (HttpResponse<String> r : List.of(adicionar(os, sub, v, 1), reservar(os, m, sub, true), usar(os, sub, v, 1),
                    decidir(os, usoPendente, sub, true, null, 1), devolver(os, m, sub, 1))) {
                assertThat(r.statusCode()).as(sub).isEqualTo(404);
                assertThat(r.body()).isEqualTo(inexistente.body());
            }
        }
        for (String sub : List.of(MEMBRO_SEM_VISAO, soVer)) {
            for (HttpResponse<String> r : List.of(adicionar(os, sub, v, 1), reservar(os, m, sub, true), usar(os, sub, v, 1),
                    decidir(os, usoPendente, sub, true, null, 1), devolver(os, m, sub, 1))) {
                assertThat(r.statusCode()).as(sub).isEqualTo(403);
            }
        }
        // o técnico (sem estoque.aprovar) não decide nem devolve
        assertThat(decidir(os, usoPendente, TECNICO, true, null, 1).statusCode()).isEqualTo(403);
        assertThat(devolver(os, m, TECNICO, 1).statusCode()).isEqualTo(403);
        assertThat(adicionar(os, null, v, 1).statusCode()).isEqualTo(401);
        // produto de OUTRA empresa e material de outra OS
        String daOutraEmpresa = CenarioOs.ler(c.comoUsuario(DONO_B, "SELECT public.criar_produto(?::uuid, ?::jsonb, NULL, ?)::text", c.empresaB,
                JSON.writeValueAsString(Map.of("nome", "Produto da outra empresa J11 " + UUID.randomUUID().toString().substring(0, 6), "finalidade", "uso_interno",
                        "preco_centavos", 100, "custo_centavos", 50, "quantidade_inicial", 5)), chave())).get("variacoes").get(0).get("id").asText();
        assertThat(adicionar(os, GESTOR_A, daOutraEmpresa, 1).statusCode()).isEqualTo(404);
        assertThat(usar(os, GESTOR_A, daOutraEmpresa, 1).statusCode()).isEqualTo(404);
        assertThat(estoque(c, daOutraEmpresa)).as("o estoque da outra empresa não mudou").isEqualTo("5/0/5");
        String outra = emExecucao(c);
        assertThat(reservar(outra, m, GESTOR_A, true).statusCode()).as("material de outra OS").isEqualTo(404);
        assertThat(devolver(outra, m, GESTOR_A, 1).statusCode()).isEqualTo(404);
        assertThat(estoque(c, v) + "|" + quantidades(c, m)).isEqualTo(antes);
        // o Cliente não vê materiais nem custos na OS dele
        String daCliente = c.novaOsDeAcompanhamento();
        ok(enviar(daCliente + "/iniciar", GESTOR_A, corpo("versao", 1, "chave", chave())));
        ok(adicionar(daCliente, GESTOR_A, v, 1));
        ok(usar(daCliente, GESTOR_A, v, 1));
        String visao = get(CLIENTE + daCliente, CHAVES.token(CLIENTE_ACOMPANHAMENTO)).body();
        assertThat(visao).doesNotContain("\"materiais\"").doesNotContain("custo_unitario").doesNotContain("custo_previsto")
                .doesNotContain("custo_confirmado").doesNotContain("Fita fictícia").doesNotContain("material_usado").doesNotContain("disponivel");
        assertThat(integridade(c)).isEqualTo("ok");
    }

    @Test
    void corpoEstritoNasCincoRotas() throws Exception {
        CenarioOs c = cenario();
        String v = produto(c, "Prego fictício J11", 10, false);
        String os = emExecucao(c);
        ok(adicionar(os, GESTOR_A, v, 1));
        String m = material(c, os, v);
        String antes = estoque(c, v) + "|" + quantidades(c, m);
        Object[][] casos = {
                {os + "/materiais", corpo("chave", chave(), "variacao_id", v, "quantidade", 0)},
                {os + "/materiais", corpo("chave", chave(), "variacao_id", v, "quantidade", 1.5)},
                {os + "/materiais", corpo("chave", chave(), "variacao_id", v, "quantidade", "2")},
                {os + "/materiais", corpo("chave", chave(), "variacao_id", "nao-e-uuid", "quantidade", 1)},
                {os + "/materiais", corpo("chave", chave(), "variacao_id", v, "quantidade", 1, "custo_centavos", 1)},
                {os + "/materiais", corpo("variacao_id", v, "quantidade", 1)},
                {os + "/materiais/" + m + "/reserva", corpo("chave", chave(), "reservar", "sim")},
                {os + "/materiais/" + m + "/reserva", corpo("chave", chave(), "reservar", true, "quantidade", 99)},
                {os + "/usos-material", corpo("chave", chave(), "variacao_id", v, "quantidade", 1, "motivo", "x".repeat(301))},
                {os + "/usos-material", corpo("chave", chave(), "variacao_id", v, "quantidade", -1)},
                {os + "/materiais/" + m + "/devolucao", corpo("chave", chave(), "quantidade", 1)},
                {os + "/materiais/" + m + "/devolucao", corpo("chave", chave(), "quantidade", 1, "motivo", "ok")},
                {os + "/materiais", "não é json"}};
        for (Object[] caso : casos) {
            var r = enviar((String) caso[0], GESTOR_A, caso[1]);
            assertThat(r.statusCode()).as(caso[0] + " " + caso[1]).isEqualTo(400);
        }
        assertThat(estoque(c, v) + "|" + quantidades(c, m)).isEqualTo(antes);
    }

    @Test
    void estadosPermitidosPelasRegrasVigentes() throws Exception {
        CenarioOs c = cenario();
        String v = produto(c, "Bucha fictícia J11", 20, false);
        String aguardando = c.novaOsInternaParaEscrita();
        ok(adicionar(aguardando, GESTOR_A, v, 2));
        String ma = material(c, aguardando, v);
        ok(reservar(aguardando, ma, GESTOR_A, true));
        conflito(reservar(aguardando, ma, GESTOR_A, true), "STATE_CONFLICT");
        conflito(usar(aguardando, GESTOR_A, v, 1), "STATE_CONFLICT");
        ok(reservar(aguardando, ma, GESTOR_A, false));
        conflito(reservar(aguardando, ma, GESTOR_A, false), "STATE_CONFLICT");
        // pausada: uso permitido; concluída: uso permitido, mas não previsto nem reserva
        String os = emExecucao(c);
        ok(enviar(os + "/pausar", GESTOR_A, corpo("versao", 2, "chave", chave(), "motivo", "Pausa fictícia J11.")));
        ok(usar(os, GESTOR_A, v, 1));
        ok(enviar(os + "/retomar", GESTOR_A, corpo("versao", 3, "chave", chave())));
        // o uso na pausa criou o material (previsto 0, usado 1); prevendo mais 2, falta usar 1, que pode ser reservado
        ok(adicionar(os, GESTOR_A, v, 2));
        String m = material(c, os, v);
        ok(reservar(os, m, GESTOR_A, true));
        assertThat(quantidades(c, m)).isEqualTo("2/1/0/1");
        ok(enviar(os + "/concluir", GESTOR_A, corpo("versao", 4, "chave", chave())));
        conflito(adicionar(os, GESTOR_A, v, 1), "STATE_CONFLICT");
        conflito(reservar(os, m, GESTOR_A, true), "STATE_CONFLICT");
        ok(usar(os, GESTOR_A, v, 1));
        // nada falta usar: previsto 1, usado 2 → reservar recusado em qualquer estado ativo
        String cheio = emExecucao(c);
        ok(adicionar(cheio, GESTOR_A, v, 1));
        ok(usar(cheio, GESTOR_A, v, 1));
        conflito(reservar(cheio, material(c, cheio, v), GESTOR_A, true), "STATE_CONFLICT");
        // devolução: a função não restringe o estado (regra vigente), só a quantidade
        ok(enviar(os + "/encerrar", GESTOR_A, corpo("versao", 5, "chave", chave())));
        ok(devolver(os, m, GESTOR_A, 1));
        assertThat(integridade(c)).isEqualTo("ok");
    }

    // ================================================================================================ ciclo com o Cliente

    /**
     * Plataforma: Adicionar → Reservar → Usar → Informar conclusão (libera a reserva) → Pedir revisão → Reabrir → Reservar
     * de novo → Usar → Informar conclusão (libera) → Confirmar recebimento. Estoque e materiais coerentes em cada passo.
     */
    @Test
    void cicloComRevisaoReaberturaEConfirmacao() throws Exception {
        CenarioOs c = cenario();
        String v = produto(c, "Torneira fictícia J11", 10, false);
        String os = c.novaOsDeAcompanhamento();
        ok(enviar(os + "/iniciar", GESTOR_A, corpo("versao", 1, "chave", chave())));
        ok(adicionar(os, GESTOR_A, v, 4));
        String m = material(c, os, v);
        ok(reservar(os, m, GESTOR_A, true));
        ok(usar(os, GESTOR_A, v, 1));
        assertThat(estoque(c, v)).isEqualTo("9/3/6");
        ok(enviar(os + "/concluir", GESTOR_A, corpo("versao", 2, "chave", chave())));
        assertThat(estoque(c, v)).as("conclusão libera a reserva criada pela API").isEqualTo("9/0/9");
        assertThat(c.adm("SELECT motivo_encerramento FROM public.reservas_estoque WHERE variacao_id = ?::uuid AND estado = 'liberada' ORDER BY encerrada_em DESC LIMIT 1", v))
                .isEqualTo("OS concluída");
        ok(post(CLIENTE + os + "/pedir-revisao", CHAVES.token(CLIENTE_ACOMPANHAMENTO),
                "{\"versao\":3,\"chave\":\"" + chave() + "\",\"texto\":\"Faltou trocar a outra torneira (J11).\"}"));
        ok(enviar(os + "/reabrir", GESTOR_A, corpo("versao", 4, "chave", chave(), "motivo", "Trocar a segunda torneira (J11).")));
        ok(reservar(os, m, GESTOR_A, true));
        assertThat(estoque(c, v)).as("reaberta, a OS volta a reservar o que falta usar").isEqualTo("9/3/6");
        ok(usar(os, GESTOR_A, v, 1));
        ok(enviar(os + "/concluir", GESTOR_A, corpo("versao", 5, "chave", chave())));
        assertThat(estoque(c, v)).isEqualTo("8/0/8");
        ok(post(CLIENTE + os + "/confirmar-recebimento", CHAVES.token(CLIENTE_ACOMPANHAMENTO), "{\"versao\":6,\"chave\":\"" + chave() + "\"}"));
        assertThat(estoque(c, v)).as("confirmar não mexe no estoque").isEqualTo("8/0/8");
        assertThat(quantidades(c, m)).isEqualTo("4/2/0/0");
        assertThat(c.adm("SELECT count(*)::text FROM public.titulos_financeiros WHERE origem_id = ?::uuid AND estado <> 'cancelado'", os))
                .as("uma conta a receber, sem efeito dos materiais").isEqualTo("1");
        assertThat(integridade(c)).isEqualTo("ok");
    }

    // ================================================================================================ T-ATOM

    /** Falha forçada DEPOIS das mudanças de estoque e material desfaz tudo: saldo, reservas, movimentos, usos e chave. */
    @Test
    void falhaDepoisDasAlteracoesParciaisDesfazTudo() throws Exception {
        CenarioOs c = cenario();
        tecnico(c);
        c.adm("CREATE SCHEMA IF NOT EXISTS teste_j11");
        c.adm("CREATE SEQUENCE IF NOT EXISTS teste_j11.viu_alteracao");
        // TG_ARGV[0]: a variação; TG_ARGV[1]: físico/reservado antes; TG_ARGV[2]: o material; TG_ARGV[3]: prevista/usada/devolvida antes.
        c.adm("CREATE OR REPLACE FUNCTION teste_j11.falhar() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE agora_e text; agora_m text; BEGIN "
                + "SELECT fisico || '/' || reservado INTO agora_e FROM public.saldos_estoque WHERE variacao_id = TG_ARGV[0]::uuid; "
                + "SELECT qtd_prevista || '/' || qtd_usada || '/' || qtd_devolvida INTO agora_m FROM public.os_materiais WHERE id = TG_ARGV[2]::uuid; "
                + "IF agora_e <> TG_ARGV[1] OR agora_m IS DISTINCT FROM TG_ARGV[3] THEN PERFORM nextval('teste_j11.viu_alteracao'); END IF; "
                + "RAISE EXCEPTION 'falha forçada pelo teste T-ATOM'; END $$");
        record Ponto(String acao, String parte, String tabela, String quando) {
        }
        List<Ponto> pontos = List.of(
                new Ponto("adicionar", "chave", "app_private.operacoes_idempotentes", "NEW.funcao = 'adicionar_material_os' AND NEW.chave = '%s'"),
                new Ponto("reservar", "historico", "public.os_eventos", "NEW.tipo = 'material_reservado' AND NEW.os_id = '%2$s'::uuid"),
                new Ponto("reservar", "chave", "app_private.operacoes_idempotentes", "NEW.funcao = 'reservar_material_os' AND NEW.chave = '%s'"),
                new Ponto("usar", "auditoria", "app_private.eventos_auditoria", "NEW.tipo_acao = 'servicos.material_baixado'"),
                new Ponto("usar", "chave", "app_private.operacoes_idempotentes", "NEW.funcao = 'registrar_uso_material' AND NEW.chave = '%s'"),
                new Ponto("decidir", "historico", "public.os_eventos", "NEW.tipo = 'uso_confirmado' AND NEW.os_id = '%2$s'::uuid"),
                new Ponto("devolver", "auditoria", "app_private.eventos_auditoria", "NEW.tipo_acao = 'servicos.material_devolvido'"));
        for (Ponto p : pontos) {
            String v = produto(c, "Produto T-ATOM J11", 10, false);
            String os = emExecucao(c);
            String k = chave();
            String m = null;
            Object corpo;
            String rota;
            String uso = null;
            switch (p.acao()) {
                case "adicionar" -> {
                    ok(adicionar(os, GESTOR_A, v, 1));
                    m = material(c, os, v);
                    rota = os + "/materiais";
                    corpo = corpo("chave", k, "variacao_id", v, "quantidade", 2);
                }
                case "reservar" -> {
                    ok(adicionar(os, GESTOR_A, v, 3));
                    m = material(c, os, v);
                    rota = os + "/materiais/" + m + "/reserva";
                    corpo = corpo("chave", k, "reservar", true);
                }
                case "usar" -> {
                    ok(adicionar(os, GESTOR_A, v, 3));
                    m = material(c, os, v);
                    ok(reservar(os, m, GESTOR_A, true));
                    rota = os + "/usos-material";
                    corpo = corpo("chave", k, "variacao_id", v, "quantidade", 2);
                }
                case "decidir" -> {
                    uso = CenarioOs.ler(usar(os, TECNICO, v, 2).body()).get("uso_id").asText();
                    m = material(c, os, v);
                    rota = os + "/usos-material/" + uso + "/decisao";
                    corpo = corpo("versao", 1, "chave", k, "aprovar", true);
                }
                default -> {
                    ok(adicionar(os, GESTOR_A, v, 3));
                    ok(usar(os, GESTOR_A, v, 3));
                    m = material(c, os, v);
                    rota = os + "/materiais/" + m + "/devolucao";
                    corpo = corpo("chave", k, "quantidade", 2, "motivo", "Sobrou (T-ATOM J11).");
                }
            }
            String antesEstoque = c.adm("SELECT fisico || '/' || reservado FROM public.saldos_estoque WHERE variacao_id = ?::uuid", v);
            String antesMaterial = c.adm("SELECT qtd_prevista || '/' || qtd_usada || '/' || qtd_devolvida FROM public.os_materiais WHERE id = ?::uuid", m);
            String retrato = estoque(c, v) + "|" + quantidades(c, m) + "|" + movimentos(c, v) + "|"
                    + c.adm("SELECT count(*) || ':' || string_agg(estado, ',' ORDER BY id) FROM public.reservas_estoque WHERE variacao_id = ?::uuid", v) + "|"
                    + c.adm("SELECT count(*) || ':' || coalesce(string_agg(estado, ',' ORDER BY id), '') FROM public.os_material_usos WHERE os_material_id = ?::uuid", m) + "|"
                    + c.adm("SELECT count(*)::text FROM public.os_eventos WHERE os_id = ?::uuid", os);
            String gatilho = "t_atom_j11_" + p.acao() + "_" + p.parte();
            c.adm("CREATE TRIGGER " + gatilho + " BEFORE INSERT ON " + p.tabela() + " FOR EACH ROW WHEN (" + String.format(p.quando(), k, os)
                    + ") EXECUTE FUNCTION teste_j11.falhar('" + v + "', '" + antesEstoque + "', '" + m + "', '" + antesMaterial + "')");
            try {
                long antesSeq = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j11.viu_alteracao"));
                var r = enviar(rota, GESTOR_A, corpo);
                assertThat(r.statusCode()).as(p.acao() + "/" + p.parte()).isEqualTo(500);
                assertThat(r.body()).doesNotContain("T-ATOM").doesNotContain("trigger");
                long depoisSeq = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j11.viu_alteracao"));
                assertThat(depoisSeq).as(p.acao() + "/" + p.parte() + ": a falha veio depois de alterar estoque ou material").isEqualTo(antesSeq + 1);
                String depois = estoque(c, v) + "|" + quantidades(c, m) + "|" + movimentos(c, v) + "|"
                        + c.adm("SELECT count(*) || ':' || string_agg(estado, ',' ORDER BY id) FROM public.reservas_estoque WHERE variacao_id = ?::uuid", v) + "|"
                        + c.adm("SELECT count(*) || ':' || coalesce(string_agg(estado, ',' ORDER BY id), '') FROM public.os_material_usos WHERE os_material_id = ?::uuid", m) + "|"
                        + c.adm("SELECT count(*)::text FROM public.os_eventos WHERE os_id = ?::uuid", os);
                assertThat(depois).as(p.acao() + "/" + p.parte() + ": nada gravado").isEqualTo(retrato);
                assertThat(c.adm("SELECT count(*)::text FROM app_private.operacoes_idempotentes WHERE chave = ?", k)).isEqualTo("0");
            } finally {
                c.adm("DROP TRIGGER " + gatilho + " ON " + p.tabela());
            }
            ok(enviar(rota, GESTOR_A, corpo));
            assertThat(integridade(c)).as(p.acao()).isEqualTo("ok");
        }
        c.adm("DROP SCHEMA teste_j11 CASCADE");
    }
}
