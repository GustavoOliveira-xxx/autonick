package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_1;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_ESCRITA;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.DONO_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.DONO_B;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.GESTOR_A;
import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste;
import br.com.ckgroup.autonick.osapi.apoio.CenarioOs;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

/**
 * T-POOL (ADR-J02, E-08): como o J2, agora no caminho de ESCRITA. Com o pool reduzido a UMA conexão, depois de escritas
 * confirmadas e recusadas, a mesma conexão do servidor (mesmo pg_backend_pid) não carrega papel nem identidade, e o
 * autor gravado na escrita seguinte é quem mandou o pedido, não o anterior.
 */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
@TestPropertySource(properties = {
        "spring.datasource.hikari.maximum-pool-size=1",
        "spring.datasource.hikari.minimum-idle=1"})
class PoolIdentidadeEscritaTest extends ApiComBancoBase {

    @Autowired
    DataSource pool;

    private record Estado(String pid, String usuario, String claims) {
    }

    private Estado estadoDaConexao() throws Exception {
        try (Connection c = pool.getConnection(); Statement s = c.createStatement();
             ResultSet r = s.executeQuery("SELECT pg_backend_pid()::text, current_user, coalesce(current_setting('request.jwt.claims', true), '')")) {
            r.next();
            return new Estado(r.getString(1), r.getString(2), r.getString(3));
        }
    }

    private void conexaoLimpa(Estado antes, String depoisDe) throws Exception {
        Estado agora = estadoDaConexao();
        assertThat(agora.pid()).as("mesma conexão depois de " + depoisDe).isEqualTo(antes.pid());
        assertThat(agora.usuario()).as("papel da API depois de " + depoisDe).isEqualTo(BancoDeTeste.instancia().apiUsuario);
        assertThat(agora.claims()).as("sem identidade depois de " + depoisDe).isEmpty();
    }

    private static String k() {
        return "j06-pool-" + UUID.randomUUID();
    }

    @Test
    @DisplayName("T-POOL: escrita confirmada, recusada e com erro de banco; a conexão reaproveitada volta limpa")
    void identidadeDescartadaNoCaminhoDeEscrita() throws Exception {
        CenarioOs c = cenario();
        String os = c.novaOsParaEscrita();
        Estado antes = estadoDaConexao();
        assertThat(antes.claims()).isEmpty();

        assertThat(post("/api/business/ordens-servico/" + os + "/iniciar", CHAVES.token(GESTOR_A),
                "{\"versao\":1,\"chave\":\"" + k() + "\"}").statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "iniciar confirmado (Gestor A)");

        var pausa = post("/api/business/ordens-servico/" + os + "/pausar", CHAVES.token(GESTOR_A),
                "{\"versao\":2,\"chave\":\"" + k() + "\",\"motivo\":\"Pausa fictícia do T-POOL.\"}");
        assertThat(pausa.statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "pausar confirmado (Gestor A)");

        // Dono da Empresa B: a checagem prévia roda COM a identidade dele e falha (rollback)
        var outraEmpresa = post("/api/business/ordens-servico/" + os + "/retomar", CHAVES.token(DONO_B), "{\"versao\":3,\"chave\":\"" + k() + "\"}");
        assertThat(outraEmpresa.statusCode()).isEqualTo(404);
        conexaoLimpa(antes, "retomar recusado (Dono B)");

        // erro dentro da função de escrita (versão desatualizada), com rollback
        var conflito = post("/api/business/ordens-servico/" + os + "/retomar", CHAVES.token(GESTOR_A), "{\"versao\":2,\"chave\":\"" + k() + "\"}");
        assertThat(conflito.statusCode()).isEqualTo(409);
        conexaoLimpa(antes, "retomar com conflito de versão (Gestor A)");

        // depois do Dono B na mesma conexão, a retomada é gravada com o autor certo
        var retomada = post("/api/business/ordens-servico/" + os + "/retomar", CHAVES.token(GESTOR_A), "{\"versao\":3,\"chave\":\"" + k() + "\"}");
        assertThat(retomada.statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "retomar confirmado (Gestor A)");
        assertThat(c.adm("SELECT string_agg(DISTINCT autor_auth_id, ',') FROM public.os_eventos WHERE os_id = ?::uuid AND tipo IN ('iniciar', 'pausar', 'retomar')", os))
                .isEqualTo(GESTOR_A);
        assertThat(c.adm("SELECT string_agg(DISTINCT ator_auth_id, ',') FROM app_private.eventos_auditoria WHERE recurso_id = ?::uuid "
                + "AND tipo_acao IN ('servicos.os_iniciar', 'servicos.os_pausar', 'servicos.os_retomar')", os)).isEqualTo(GESTOR_A);

        // J07: conclusão recusada (outra empresa) e confirmada (Gestor A) na mesma conexão
        var concluirOutra = post("/api/business/ordens-servico/" + os + "/concluir", CHAVES.token(DONO_B), "{\"versao\":4,\"chave\":\"" + k() + "\"}");
        assertThat(concluirOutra.statusCode()).isEqualTo(404);
        conexaoLimpa(antes, "concluir recusado (Dono B)");
        var conclusao = post("/api/business/ordens-servico/" + os + "/concluir", CHAVES.token(GESTOR_A), "{\"versao\":4,\"chave\":\"" + k() + "\"}");
        assertThat(conclusao.statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "concluir confirmado (Gestor A)");
        assertThat(c.adm("SELECT string_agg(DISTINCT autor_auth_id, ',') FROM public.os_eventos WHERE os_id = ?::uuid AND tipo = 'concluir'", os))
                .isEqualTo(GESTOR_A);
        assertThat(c.adm("SELECT string_agg(DISTINCT criado_por, ',') FROM public.titulos_financeiros WHERE origem_id = ?::uuid", os)).isEqualTo(GESTOR_A);

        // a leitura seguinte, da cliente, só vê o que é dela
        var lista = get("/api/cliente/ordens-servico", CHAVES.token(CLIENTE_ESCRITA));
        assertThat(lista.statusCode()).isEqualTo(200);
        assertThat(ids(lista.body())).contains(os).doesNotContain(c.os1, c.os3);
        conexaoLimpa(antes, "leitura da cliente de escrita");

        // J08: respostas do Cliente na mesma conexão, alternando com a equipe da empresa e outro cliente
        String revisao = "{\"versao\":5,\"chave\":\"" + k() + "\",\"texto\":\"Pedido de revisão fictício do T-POOL.\"}";
        var revisaoDoGestor = post("/api/cliente/ordens-servico/" + os + "/pedir-revisao", CHAVES.token(GESTOR_A), revisao);
        assertThat(revisaoDoGestor.statusCode()).as("a equipe não responde pelo cliente").isEqualTo(404);
        conexaoLimpa(antes, "pedir revisão recusado (Gestor A)");
        var revisaoDeOutra = post("/api/cliente/ordens-servico/" + os + "/pedir-revisao", CHAVES.token(CLIENTE_1), revisao);
        assertThat(revisaoDeOutra.statusCode()).isEqualTo(404);
        conexaoLimpa(antes, "pedir revisão recusado (Cliente 1)");
        var revisaoAntiga = post("/api/cliente/ordens-servico/" + os + "/pedir-revisao", CHAVES.token(CLIENTE_ESCRITA),
                "{\"versao\":4,\"chave\":\"" + k() + "\",\"texto\":\"Pedido de revisão fictício do T-POOL.\"}");
        assertThat(revisaoAntiga.statusCode()).as("versão desatualizada desfaz a escrita").isEqualTo(409);
        conexaoLimpa(antes, "pedir revisão com versão desatualizada (Cliente de escrita)");
        assertThat(post("/api/cliente/ordens-servico/" + os + "/pedir-revisao", CHAVES.token(CLIENTE_ESCRITA), revisao).statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "pedir revisão confirmado (Cliente de escrita)");
        var encerrarPelaEmpresa = get("/api/business/ordens-servico/" + os, CHAVES.token(GESTOR_A));
        assertThat(encerrarPelaEmpresa.statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "leitura do Gestor A depois do pedido de revisão");
        assertThat(post("/api/cliente/ordens-servico/" + os + "/confirmar-recebimento", CHAVES.token(CLIENTE_ESCRITA),
                "{\"versao\":6,\"chave\":\"" + k() + "\"}").statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "confirmar recebimento (Cliente de escrita)");
        assertThat(c.adm("SELECT string_agg(DISTINCT autor_auth_id || ':' || autor_tipo, ',') FROM public.os_eventos "
                + "WHERE os_id = ?::uuid AND tipo IN ('revisao_pedida', 'recebimento_confirmado')", os)).isEqualTo(CLIENTE_ESCRITA + ":cliente");
        assertThat(c.adm("SELECT string_agg(DISTINCT ator_auth_id, ',') FROM app_private.eventos_auditoria WHERE recurso_id = ?::uuid "
                + "AND tipo_acao = 'servicos.os_encerrada_pelo_cliente'", os)).isEqualTo(CLIENTE_ESCRITA);

        // J09: reabrir e encerrar pela empresa numa OS interna, na mesma conexão, com recusas de outra empresa e do Cliente
        String interna = c.novaOsInternaParaEscrita();
        String b = "/api/business/ordens-servico/" + interna + "/";
        assertThat(post(b + "iniciar", CHAVES.token(GESTOR_A), "{\"versao\":1,\"chave\":\"" + k() + "\"}").statusCode()).isEqualTo(200);
        assertThat(post(b + "concluir", CHAVES.token(GESTOR_A), "{\"versao\":2,\"chave\":\"" + k() + "\"}").statusCode()).isEqualTo(200);
        String motivo = "\"motivo\":\"Revisão fictícia do T-POOL (J09).\"";
        assertThat(post(b + "reabrir", CHAVES.token(DONO_B), "{\"versao\":3,\"chave\":\"" + k() + "\"," + motivo + "}").statusCode()).isEqualTo(404);
        conexaoLimpa(antes, "reabrir recusado (Dono B)");
        assertThat(post(b + "reabrir", CHAVES.token(CLIENTE_ESCRITA), "{\"versao\":3,\"chave\":\"" + k() + "\"," + motivo + "}").statusCode()).isEqualTo(404);
        conexaoLimpa(antes, "reabrir recusado (Cliente)");
        assertThat(post(b + "reabrir", CHAVES.token(GESTOR_A), "{\"versao\":3,\"chave\":\"" + k() + "\"," + motivo + "}").statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "reabrir confirmado (Gestor A)");
        assertThat(post(b + "concluir", CHAVES.token(GESTOR_A), "{\"versao\":4,\"chave\":\"" + k() + "\"}").statusCode()).isEqualTo(200);
        assertThat(post(b + "encerrar", CHAVES.token(DONO_B), "{\"versao\":5,\"chave\":\"" + k() + "\"}").statusCode()).isEqualTo(404);
        conexaoLimpa(antes, "encerrar recusado (Dono B)");
        assertThat(post(b + "encerrar", CHAVES.token(GESTOR_A), "{\"versao\":4,\"chave\":\"" + k() + "\"}").statusCode()).isEqualTo(409);
        conexaoLimpa(antes, "encerrar com versão desatualizada (Gestor A)");
        assertThat(post(b + "encerrar", CHAVES.token(GESTOR_A), "{\"versao\":5,\"chave\":\"" + k() + "\"}").statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "encerrar confirmado (Gestor A)");
        assertThat(c.adm("SELECT string_agg(DISTINCT autor_auth_id, ',') FROM public.os_eventos WHERE os_id = ?::uuid AND tipo IN ('reabrir', 'encerrar')", interna))
                .isEqualTo(GESTOR_A);
        assertThat(c.adm("SELECT string_agg(DISTINCT ator_auth_id, ',') FROM app_private.eventos_auditoria WHERE recurso_id = ?::uuid "
                + "AND tipo_acao IN ('servicos.os_reabrir', 'servicos.os_encerrar')", interna)).isEqualTo(GESTOR_A);

        // J10: nota interna do Gestor e, na MESMA conexão, a leitura da cliente: a nota não aparece
        String nota = "NOTA-INTERNA-T-POOL-J10";
        String p = "/api/business/ordens-servico/" + os + "/";
        assertThat(post(p + "publicar-atualizacao", CHAVES.token(GESTOR_A), "{\"chave\":\"" + k() + "\",\"texto\":\"" + nota + "\",\"publica\":false}").statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "nota interna (Gestor A)");
        var daCliente = get("/api/cliente/ordens-servico/" + os, CHAVES.token(CLIENTE_ESCRITA));
        assertThat(daCliente.statusCode()).isEqualTo(200);
        assertThat(daCliente.body()).doesNotContain(nota);
        conexaoLimpa(antes, "leitura da cliente depois da nota interna");
        assertThat(post(p + "publicar-atualizacao", CHAVES.token(CLIENTE_ESCRITA), "{\"chave\":\"" + k() + "\",\"texto\":\"Tentativa da cliente.\",\"publica\":true}").statusCode()).isEqualTo(404);
        conexaoLimpa(antes, "publicar recusado (Cliente)");
        String v = c.adm("SELECT versao::text FROM public.ordens_servico WHERE id = ?::uuid", os);
        assertThat(post(p + "atualizar-dados", CHAVES.token(DONO_B), "{\"versao\":" + v + ",\"chave\":\"" + k() + "\",\"dados\":{\"responsavel_auth_id\":null}}").statusCode()).isEqualTo(404);
        conexaoLimpa(antes, "atualizar dados recusado (Dono B)");
        assertThat(post(p + "atualizar-dados", CHAVES.token(GESTOR_A), "{\"versao\":" + v + ",\"chave\":\"" + k() + "\",\"dados\":{\"responsavel_auth_id\":\"" + GESTOR_A + "\"}}").statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "atualizar dados confirmado (Gestor A)");
        String garantida = c.novaOsInternaParaEscrita();
        String g = "/api/business/ordens-servico/" + garantida + "/";
        assertThat(post(g + "iniciar", CHAVES.token(GESTOR_A), "{\"versao\":1,\"chave\":\"" + k() + "\"}").statusCode()).isEqualTo(200);
        assertThat(post(g + "concluir", CHAVES.token(GESTOR_A), "{\"versao\":2,\"chave\":\"" + k() + "\"}").statusCode()).isEqualTo(200);
        assertThat(post(g + "registrar-garantia", CHAVES.token(GESTOR_A), "{\"versao\":2,\"chave\":\"" + k() + "\",\"dias\":90}").statusCode()).isEqualTo(409);
        conexaoLimpa(antes, "garantia com versão desatualizada (rollback)");
        assertThat(post(g + "registrar-garantia", CHAVES.token(GESTOR_A), "{\"versao\":3,\"chave\":\"" + k() + "\",\"dias\":90}").statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "garantia confirmada (Gestor A)");
        assertThat(c.adm("SELECT string_agg(DISTINCT autor_auth_id, ',') FROM public.os_eventos WHERE os_id IN (?::uuid, ?::uuid) "
                + "AND tipo IN ('nota_interna', 'dados_atualizados', 'garantia')", os, garantida)).isEqualTo(GESTOR_A);

        // J11: materiais e estoque na mesma conexão, alternando a empresa de escrita (Gestor A) e a Empresa B
        String dados = "{\"nome\":\"Produto T-POOL J11 " + UUID.randomUUID().toString().substring(0, 8) + "\",\"finalidade\":\"uso_interno\","
                + "\"preco_centavos\":100,\"custo_centavos\":50,\"quantidade_inicial\":3}";
        String variacao = CenarioOs.ler(c.comoUsuario(DONO_A, "SELECT public.criar_produto(?::uuid, ?::jsonb, NULL, ?)::text", c.empresaEscrita, dados, k()))
                .get("variacoes").get(0).get("id").asText();
        String comMaterial = c.novaOsInternaParaEscrita();
        String b2 = "/api/business/ordens-servico/" + comMaterial + "/";
        assertThat(post(b2 + "iniciar", CHAVES.token(GESTOR_A), "{\"versao\":1,\"chave\":\"" + k() + "\"}").statusCode()).isEqualTo(200);
        assertThat(post(b2 + "materiais", CHAVES.token(DONO_B), "{\"chave\":\"" + k() + "\",\"variacao_id\":\"" + variacao + "\",\"quantidade\":2}").statusCode()).isEqualTo(404);
        conexaoLimpa(antes, "material recusado (Dono B)");
        assertThat(post(b2 + "materiais", CHAVES.token(GESTOR_A), "{\"chave\":\"" + k() + "\",\"variacao_id\":\"" + variacao + "\",\"quantidade\":2}").statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "material previsto (Gestor A)");
        String material = c.adm("SELECT id::text FROM public.os_materiais WHERE os_id = ?::uuid", comMaterial);
        assertThat(post(b2 + "materiais/" + material + "/reserva", CHAVES.token(GESTOR_A), "{\"chave\":\"" + k() + "\",\"reservar\":true}").statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "reserva (Gestor A)");
        assertThat(post(b2 + "usos-material", CHAVES.token(GESTOR_A), "{\"chave\":\"" + k() + "\",\"variacao_id\":\"" + variacao + "\",\"quantidade\":5}").statusCode()).isEqualTo(409);
        conexaoLimpa(antes, "uso recusado por estoque insuficiente (rollback)");
        assertThat(post(b2 + "usos-material", CHAVES.token(GESTOR_A), "{\"chave\":\"" + k() + "\",\"variacao_id\":\"" + variacao + "\",\"quantidade\":1}").statusCode()).isEqualTo(200);
        conexaoLimpa(antes, "uso confirmado (Gestor A)");
        assertThat(c.adm("SELECT fisico || '/' || reservado FROM public.saldos_estoque WHERE variacao_id = ?::uuid", variacao)).isEqualTo("2/1");
        assertThat(c.adm("SELECT string_agg(DISTINCT ator, ',') FROM public.movimentacoes_estoque WHERE variacao_id = ?::uuid AND origem_tipo = 'os'", variacao))
                .isEqualTo(GESTOR_A);
    }
}
