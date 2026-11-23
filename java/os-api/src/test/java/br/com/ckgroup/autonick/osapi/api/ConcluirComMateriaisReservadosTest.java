package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_ESCRITA;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.DONO_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.GESTOR_A;
import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.CenarioOs;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/**
 * Fechamento do J07: conclusão de uma OS com materiais EFETIVAMENTE reservados no estoque (motor do M05). A função
 * mudar_estado_os libera as reservas (reservado volta ao disponível, físico não muda, reserva "liberada" com o motivo
 * "OS concluída" e evento de estoque), cria a conta a receber do saldo e grava histórico e auditoria, tudo na mesma
 * transação. Cenário montado só pelas funções do app, em banco local temporário e com dados fictícios.
 */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class ConcluirComMateriaisReservadosTest extends ApiComBancoBase {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String BASE = "/api/business/ordens-servico/";

    /** OS em execução com dois materiais reservados: 3 de um produto com 10 em estoque e 2 de um produto com 2. */
    private record Cenario(String os, String cabo, String disjuntor, String origemCabo, String origemDisjuntor) {
        List<String> variacoes() {
            return List.of(cabo, disjuntor);
        }

        List<String> origens() {
            return List.of(origemCabo, origemDisjuntor);
        }

        /** A origem processada por ÚLTIMO na liberação (liberar_reservas_os percorre os materiais por variacao_id). */
        String origemUltima() {
            return cabo.compareTo(disjuntor) > 0 ? origemCabo : origemDisjuntor;
        }

        String origemPrimeira() {
            return origemUltima().equals(origemCabo) ? origemDisjuntor : origemCabo;
        }
    }

    private static String k() {
        return "j07m-" + UUID.randomUUID();
    }

    private String produto(CenarioOs c, String nome, int quantidade) throws Exception {
        String dados = JSON.writeValueAsString(Map.of("nome", nome + " " + UUID.randomUUID().toString().substring(0, 8),
                "finalidade", "uso_interno", "preco_centavos", 100, "custo_centavos", 500, "quantidade_inicial", quantidade));
        String criado = c.comoUsuario(DONO_A, "SELECT public.criar_produto(?::uuid, ?::jsonb, NULL, ?)::text", c.empresaEscrita, dados, k());
        return CenarioOs.ler(criado).get("variacoes").get(0).get("id").asText();
    }

    private String reservar(CenarioOs c, String os, String variacao, int quantidade) throws Exception {
        c.comoUsuario(GESTOR_A, "SELECT public.adicionar_material_os(?::uuid, ?::uuid, ?, ?)::text", os, variacao, quantidade, k());
        String material = c.adm("SELECT id::text FROM public.os_materiais WHERE os_id = ?::uuid AND variacao_id = ?::uuid", os, variacao);
        c.comoUsuario(GESTOR_A, "SELECT public.reservar_material_os(?::uuid, true, ?)::text", material, k());
        return c.adm("SELECT reserva_origem_id::text FROM public.os_materiais WHERE id = ?::uuid", material);
    }

    private Cenario montar(CenarioOs c) throws Exception {
        String cabo = produto(c, "Cabo fictício J07", 10);
        String disjuntor = produto(c, "Disjuntor fictício J07", 2);
        String os = c.novaOsParaEscrita();
        assertThat(post(BASE + os + "/iniciar", CHAVES.token(GESTOR_A), "{\"versao\":1,\"chave\":\"" + k() + "\"}").statusCode()).isEqualTo(200);
        Cenario s = new Cenario(os, cabo, disjuntor, reservar(c, os, cabo, 3), reservar(c, os, disjuntor, 2));
        assertThat(estoque(c, s)).isEqualTo("10/3/7,2/2/0");
        assertThat(reservas(c, s)).isEqualTo("ativa,ativa");
        return s;
    }

    /** físico/reservado/disponível de cada variação (cabo, disjuntor). */
    private static String estoque(CenarioOs c, Cenario s) throws Exception {
        return c.adm("SELECT string_agg(fisico || '/' || reservado || '/' || disponivel, ',' ORDER BY v.ordem) FROM public.saldos_estoque e "
                + "JOIN (VALUES (?::uuid, 1), (?::uuid, 2)) v(id, ordem) ON v.id = e.variacao_id", s.cabo(), s.disjuntor());
    }

    private static String reservas(CenarioOs c, Cenario s) throws Exception {
        return c.adm("SELECT string_agg(r.estado, ',' ORDER BY v.ordem) FROM public.reservas_estoque r "
                + "JOIN (VALUES (?::uuid, 1), (?::uuid, 2)) v(id, ordem) ON v.id = r.origem_id", s.origemCabo(), s.origemDisjuntor());
    }

    /** materiais ainda ligados a reserva | eventos de estoque "reserva_liberada" | movimentações das duas variações. */
    private static String rastros(CenarioOs c, Cenario s) throws Exception {
        return c.adm("SELECT (SELECT count(*) FROM public.os_materiais WHERE os_id = ?::uuid AND reserva_origem_id IS NOT NULL) || '|' "
                + "|| (SELECT count(*) FROM public.eventos_estoque WHERE tipo = 'reserva_liberada' AND alvo_id IN (?::uuid, ?::uuid)) || '|' "
                + "|| (SELECT count(*) FROM public.movimentacoes_estoque WHERE variacao_id IN (?::uuid, ?::uuid))",
                s.os(), s.origemCabo(), s.origemDisjuntor(), s.cabo(), s.disjuntor());
    }

    /** Para cada variação, o reservado do saldo é igual à soma das reservas ativas (integridade do motor do M05). */
    private static String integridade(CenarioOs c, Cenario s) throws Exception {
        return c.adm("SELECT bool_and(e.reservado = coalesce((SELECT sum(r.quantidade) FROM public.reservas_estoque r "
                + "WHERE r.variacao_id = e.variacao_id AND r.estado = 'ativa'), 0))::text FROM public.saldos_estoque e "
                + "WHERE e.variacao_id IN (?::uuid, ?::uuid)", s.cabo(), s.disjuntor());
    }

    @Test
    void conclusaoLiberaAsReservasSemMexerNoFisicoECriaUmaConta() throws Exception {
        CenarioOs c = cenario();
        Cenario s = montar(c);
        String movimentosAntes = rastros(c, s).split("\\|")[2];
        String k = k();
        String pedido = "{\"versao\":" + versaoDaOs(c, s.os()) + ",\"chave\":\"" + k + "\"}";

        var r = post(BASE + s.os() + "/concluir", CHAVES.token(GESTOR_A), pedido);
        assertThat(r.statusCode()).isEqualTo(200);
        assertThat(CenarioOs.ler(r.body()).get("estado").asText()).isEqualTo("concluida");
        // estoque: reservado volta ao disponível; físico igual; nenhuma movimentação nova (liberar não é baixar)
        assertThat(estoque(c, s)).isEqualTo("10/0/10,2/0/2");
        assertThat(reservas(c, s)).isEqualTo("liberada,liberada");
        assertThat(c.adm("SELECT string_agg(DISTINCT motivo_encerramento, ',') FROM public.reservas_estoque WHERE origem_id IN (?::uuid, ?::uuid)",
                s.origemCabo(), s.origemDisjuntor())).isEqualTo("OS concluída");
        assertThat(rastros(c, s)).isEqualTo("0|2|" + movimentosAntes);
        assertThat(integridade(c, s)).isEqualTo("true");
        // conta a receber do saldo, uma única, sem recebimento; histórico e auditoria
        assertThat(ConcluirOrdemServicoTest.situacao(c, s.os())).endsWith("|1|1|1:180.00|1");
        // a resposta da empresa mostra os materiais sem reserva; o Cliente não vê materiais
        assertThat(CenarioOs.ler(r.body()).get("materiais").size()).isEqualTo(2);
        var cliente = get("/api/cliente/ordens-servico/" + s.os(), CHAVES.token(CLIENTE_ESCRITA));
        assertThat(cliente.statusCode()).isEqualTo(200);
        assertThat(CenarioOs.ler(cliente.body()).has("materiais")).isFalse();
        assertThat(cliente.body()).doesNotContain("Cabo fictício").doesNotContain("Disjuntor fictício").doesNotContain("material_reservado");

        // reenvio igual: nada é liberado de novo, nenhuma conta, evento ou movimentação a mais
        var reenvio = post(BASE + s.os() + "/concluir", CHAVES.token(GESTOR_A), pedido);
        assertThat(reenvio.statusCode()).isEqualTo(200);
        assertThat(estoque(c, s)).isEqualTo("10/0/10,2/0/2");
        assertThat(rastros(c, s)).isEqualTo("0|2|" + movimentosAntes);
        assertThat(ConcluirOrdemServicoTest.situacao(c, s.os())).endsWith("|1|1|1:180.00|1");
    }

    private static int versaoDaOs(CenarioOs c, String os) throws Exception {
        return Integer.parseInt(c.adm("SELECT versao::text FROM public.ordens_servico WHERE id = ?::uuid", os));
    }

    /**
     * T-ATOM com estoque: falha forçada (1) no MEIO da liberação, depois de a primeira reserva já ter sido liberada na
     * transação; (2) no evento de estoque; (3) na conta a receber, depois de as duas reservas liberadas. Em todos, estoque,
     * reservas, materiais, OS, conta e chave voltam ao estado anterior; depois, a mesma chave conclui uma vez.
     */
    @Test
    void falhaDuranteOuDepoisDaLiberacaoDesfazTudo() throws Exception {
        CenarioOs c = cenario();
        c.adm("CREATE SCHEMA IF NOT EXISTS teste_j07m");
        // Não volta no rollback: se avançar, as reservas indicadas já estavam liberadas na transação quando ela falhou.
        c.adm("CREATE SEQUENCE IF NOT EXISTS teste_j07m.viu_liberacao");
        c.adm("CREATE OR REPLACE FUNCTION teste_j07m.falhar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                + "IF (SELECT bool_and(r.estado = 'liberada') FROM public.reservas_estoque r WHERE r.origem_id::text = ANY (TG_ARGV)) THEN "
                + "PERFORM nextval('teste_j07m.viu_liberacao'); END IF; "
                + "RAISE EXCEPTION 'falha forçada pelo teste T-ATOM'; END $$");
        String[] pontos = {"meio_da_liberacao", "evento_de_estoque", "conta"};
        for (String ponto : pontos) {
            Cenario s = montar(c);
            String antesEstoque = estoque(c, s);
            String antesRastros = rastros(c, s);
            String antesSituacao = ConcluirOrdemServicoTest.situacao(c, s.os());
            int versao = versaoDaOs(c, s.os());
            String gatilho, alvo, condicao, provar;
            switch (ponto) {
                case "meio_da_liberacao" -> {
                    gatilho = "BEFORE UPDATE";
                    alvo = "public.reservas_estoque";
                    condicao = "OLD.origem_id = '" + s.origemUltima() + "'::uuid";
                    provar = "'" + s.origemPrimeira() + "'";
                }
                case "evento_de_estoque" -> {
                    gatilho = "BEFORE INSERT";
                    alvo = "public.eventos_estoque";
                    condicao = "NEW.tipo = 'reserva_liberada' AND NEW.alvo_id = '" + s.origemUltima() + "'::uuid";
                    provar = "'" + s.origemCabo() + "', '" + s.origemDisjuntor() + "'";
                }
                default -> {
                    gatilho = "BEFORE INSERT";
                    alvo = "public.titulos_financeiros";
                    condicao = "NEW.origem_id = '" + s.os() + "'::uuid";
                    provar = "'" + s.origemCabo() + "', '" + s.origemDisjuntor() + "'";
                }
            }
            String nome = "t_atom_j07m_" + ponto;
            c.adm("CREATE TRIGGER " + nome + " " + gatilho + " ON " + alvo + " FOR EACH ROW WHEN (" + condicao + ") "
                    + "EXECUTE FUNCTION teste_j07m.falhar(" + provar + ")");
            String k = k();
            try {
                long antes = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j07m.viu_liberacao"));
                var r = post(BASE + s.os() + "/concluir", CHAVES.token(GESTOR_A), "{\"versao\":" + versao + ",\"chave\":\"" + k + "\"}");
                assertThat(r.statusCode()).as(ponto).isEqualTo(500);
                long depois = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j07m.viu_liberacao"));
                assertThat(depois).as(ponto + ": a falha veio depois de reserva(s) já liberada(s) na transação").isEqualTo(antes + 1);
                assertThat(estoque(c, s)).as(ponto).isEqualTo(antesEstoque);
                assertThat(reservas(c, s)).as(ponto).isEqualTo("ativa,ativa");
                assertThat(rastros(c, s)).as(ponto).isEqualTo(antesRastros);
                assertThat(integridade(c, s)).as(ponto).isEqualTo("true");
                assertThat(ConcluirOrdemServicoTest.situacao(c, s.os())).as(ponto).isEqualTo(antesSituacao);
                assertThat(c.adm("SELECT count(*)::text FROM app_private.operacoes_idempotentes WHERE chave = ?", k)).as(ponto).isEqualTo("0");
            } finally {
                c.adm("DROP TRIGGER " + nome + " ON " + alvo);
            }
            var r2 = post(BASE + s.os() + "/concluir", CHAVES.token(GESTOR_A), "{\"versao\":" + versao + ",\"chave\":\"" + k + "\"}");
            assertThat(r2.statusCode()).as(ponto).isEqualTo(200);
            assertThat(estoque(c, s)).as(ponto).isEqualTo("10/0/10,2/0/2");
            assertThat(reservas(c, s)).as(ponto).isEqualTo("liberada,liberada");
            assertThat(integridade(c, s)).as(ponto).isEqualTo("true");
            assertThat(ConcluirOrdemServicoTest.situacao(c, s.os())).as(ponto).endsWith("|1|1|1:180.00|1");
        }
        c.adm("DROP SCHEMA teste_j07m CASCADE");
    }
}
