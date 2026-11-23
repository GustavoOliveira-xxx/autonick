package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_ESCRITA;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.DONO_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.DONO_B;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.GESTOR_A;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.MEMBRO_SEM_VISAO;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.SEM_PERFIL;
import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.CenarioOs;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.http.HttpResponse;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/**
 * J06 (ADR-J02): POST .../pausar e .../retomar. Cada teste usa OS NOVAS, para não alterar o cenário compartilhado.
 */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class PausarRetomarOrdemServicoTest extends ApiComBancoBase {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String MOTIVO = "Aguardando a peça fictícia do fornecedor (teste J06).";
    private static final String BASE = "/api/business/ordens-servico/";

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
        return "j06-" + UUID.randomUUID();
    }

    /** OS nova da Cliente 2 na Elétrica A, já iniciada pela API (em execução, versão 2). */
    private String osEmExecucao(CenarioOs c) throws Exception {
        String os = c.novaOsParaEscrita();
        assertThat(acao("iniciar", os, GESTOR_A, corpo("versao", 1, "chave", chave())).statusCode()).isEqualTo(200);
        return os;
    }

    /**
     * estado|versao|eventos pausar,pausa_publica,retomar|auditorias pausar,retomar, lidos direto no banco.
     */
    static String situacao(CenarioOs c, String os) throws Exception {
        return c.adm("SELECT o.estado || '|' || o.versao || '|' "
                + "|| (SELECT count(*) FROM public.os_eventos e WHERE e.os_id = o.id AND e.tipo = 'pausar') || ',' "
                + "|| (SELECT count(*) FROM public.os_eventos e WHERE e.os_id = o.id AND e.tipo = 'pausa_publica') || ',' "
                + "|| (SELECT count(*) FROM public.os_eventos e WHERE e.os_id = o.id AND e.tipo = 'retomar') || '|' "
                + "|| (SELECT count(*) FROM app_private.eventos_auditoria a WHERE a.recurso_id = o.id AND a.tipo_acao = 'servicos.os_pausar') || ',' "
                + "|| (SELECT count(*) FROM app_private.eventos_auditoria a WHERE a.recurso_id = o.id AND a.tipo_acao = 'servicos.os_retomar') "
                + "FROM public.ordens_servico o WHERE o.id = ?::uuid", os);
    }

    private static String chaveGravada(CenarioOs c, String chave) throws Exception {
        return c.adm("SELECT count(*)::text FROM app_private.operacoes_idempotentes WHERE funcao = 'mudar_estado_os' AND chave = ?", chave);
    }

    @Test
    void cicloEmExecucaoPausadaEmExecucaoComMotivoSoParaAEquipe() throws Exception {
        CenarioOs c = cenario();
        String os = osEmExecucao(c);
        assertThat(situacao(c, os)).isEqualTo("em_execucao|2|0,0,0|0,0");

        var pausa = acao("pausar", os, GESTOR_A, corpo("versao", 2, "chave", chave(), "motivo", MOTIVO));
        assertThat(pausa.statusCode()).isEqualTo(200);
        assertThat(CenarioOs.ler(pausa.body()).get("estado").asText()).isEqualTo("pausada");
        assertThat(situacao(c, os)).isEqualTo("pausada|3|1,1,0|1,0");
        // a equipe vê o motivo (evento interno); o cliente vê só que pausou
        var empresa = get(BASE + os, CHAVES.token(GESTOR_A));
        assertThat(empresa.body()).contains(MOTIVO);
        var detalheCliente = get("/api/cliente/ordens-servico/" + os, CHAVES.token(CLIENTE_ESCRITA));
        assertThat(detalheCliente.statusCode()).isEqualTo(200);
        assertThat(CenarioOs.ler(detalheCliente.body()).get("estado").asText()).isEqualTo("pausada");
        assertThat(detalheCliente.body()).contains("pausa_publica").doesNotContain(MOTIVO).doesNotContain("\"tipo\": \"pausar\"");
        var listaCliente = get("/api/cliente/ordens-servico", CHAVES.token(CLIENTE_ESCRITA));
        assertThat(listaCliente.body()).doesNotContain(MOTIVO);
        assertThat(CenarioOs.ler(listaCliente.body()).findValues("id").stream().anyMatch(n -> n.asText().equals(os))).isTrue();

        var retomada = acao("retomar", os, GESTOR_A, corpo("versao", 3, "chave", chave()));
        assertThat(retomada.statusCode()).isEqualTo(200);
        assertThat(CenarioOs.ler(retomada.body()).get("estado").asText()).isEqualTo("em_execucao");
        assertThat(situacao(c, os)).isEqualTo("em_execucao|4|1,1,1|1,1");
        assertThat(get("/api/cliente/ordens-servico/" + os, CHAVES.token(CLIENTE_ESCRITA)).body()).doesNotContain(MOTIVO);
    }

    @Test
    void motivoDaPausaDe5a300ERetomarSemMotivo() throws Exception {
        CenarioOs c = cenario();
        String os = osEmExecucao(c);
        List<Object> invalidos = List.of(
                corpo("versao", 2, "chave", chave()),
                corpo("versao", 2, "chave", chave(), "motivo", null),
                corpo("versao", 2, "chave", chave(), "motivo", 12345),
                corpo("versao", 2, "chave", chave(), "motivo", "abcd"),
                corpo("versao", 2, "chave", chave(), "motivo", "   abcd   "),
                corpo("versao", 2, "chave", chave(), "motivo", "x".repeat(301)),
                corpo("versao", 2, "chave", chave(), "motivo", MOTIVO, "acao", "concluir"),
                corpo("versao", 2, "chave", chave(), "motivo", MOTIVO, "publico", true));
        for (Object corpo : invalidos) {
            var r = acao("pausar", os, GESTOR_A, corpo);
            assertThat(r.statusCode()).as(String.valueOf(corpo)).isEqualTo(400);
            assertThat(codigo(r)).isEqualTo("VALIDATION_ERROR");
        }
        assertThat(situacao(c, os)).isEqualTo("em_execucao|2|0,0,0|0,0");

        assertThat(acao("pausar", os, GESTOR_A, corpo("versao", 2, "chave", chave(), "motivo", "abcde")).statusCode()).isEqualTo(200);
        var comMotivo = acao("retomar", os, GESTOR_A, corpo("versao", 3, "chave", chave(), "motivo", "Peça chegou, vamos retomar."));
        assertThat(comMotivo.statusCode()).isEqualTo(400);
        assertThat(codigo(comMotivo)).isEqualTo("VALIDATION_ERROR");
        assertThat(acao("retomar", os, GESTOR_A, corpo("versao", 3, "chave", chave())).statusCode()).isEqualTo(200);
        // segundo ciclo na mesma OS, com o motivo no limite de 300
        assertThat(acao("pausar", os, GESTOR_A, corpo("versao", 4, "chave", chave(), "motivo", "y".repeat(300))).statusCode()).isEqualTo(200);
        assertThat(situacao(c, os)).isEqualTo("pausada|5|2,2,1|2,1");
    }

    @Test
    void estadoIncompativelEVersaoDesatualizada() throws Exception {
        CenarioOs c = cenario();
        String aguardando = c.novaOsParaEscrita();
        var pausarAguardando = acao("pausar", aguardando, GESTOR_A, corpo("versao", 1, "chave", chave(), "motivo", MOTIVO));
        assertThat(pausarAguardando.statusCode()).isEqualTo(409);
        assertThat(codigo(pausarAguardando)).isEqualTo("STATE_CONFLICT");

        String os = osEmExecucao(c);
        var retomarEmExecucao = acao("retomar", os, GESTOR_A, corpo("versao", 2, "chave", chave()));
        assertThat(retomarEmExecucao.statusCode()).isEqualTo(409);
        assertThat(codigo(retomarEmExecucao)).isEqualTo("STATE_CONFLICT");
        var desatualizada = acao("pausar", os, GESTOR_A, corpo("versao", 1, "chave", chave(), "motivo", MOTIVO));
        assertThat(desatualizada.statusCode()).isEqualTo(409);
        assertThat(codigo(desatualizada)).isEqualTo("VERSION_CONFLICT");
        assertThat(situacao(c, os)).isEqualTo("em_execucao|2|0,0,0|0,0");

        assertThat(acao("pausar", os, GESTOR_A, corpo("versao", 2, "chave", chave(), "motivo", MOTIVO)).statusCode()).isEqualTo(200);
        var pausarDeNovo = acao("pausar", os, GESTOR_A, corpo("versao", 3, "chave", chave(), "motivo", MOTIVO));
        assertThat(pausarDeNovo.statusCode()).isEqualTo(409);
        assertThat(codigo(pausarDeNovo)).isEqualTo("STATE_CONFLICT");
        assertThat(situacao(c, os)).isEqualTo("pausada|3|1,1,0|1,0");
    }

    @Test
    void quemNaoPodeAlterarNaoPausaNemRetoma() throws Exception {
        CenarioOs c = cenario();
        String os = osEmExecucao(c);
        String soVer = "eb0a0100-0000-4000-8000-000000000060";
        c.novoMembroDaEmpresaEscrita(soVer, "so-ver-j06", "servicos.visualizar");
        var inexistente = acao("pausar", UUID.randomUUID().toString(), GESTOR_A, corpo("versao", 2, "chave", chave(), "motivo", MOTIVO));
        assertThat(inexistente.statusCode()).isEqualTo(404);
        for (String acao : List.of("pausar", "retomar")) {
            Map<String, Object> corpo = acao.equals("pausar") ? corpo("versao", 2, "chave", chave(), "motivo", MOTIVO) : corpo("versao", 2, "chave", chave());
            for (String sub : List.of(CLIENTE_ESCRITA, DONO_B, SEM_PERFIL)) {
                var r = acao(acao, os, sub, corpo);
                assertThat(r.statusCode()).as(acao + " " + sub).isEqualTo(404);
                assertThat(r.body()).as(acao + " " + sub).isEqualTo(inexistente.body());
            }
            for (String sub : List.of(MEMBRO_SEM_VISAO, soVer)) {
                var r = acao(acao, os, sub, corpo);
                assertThat(r.statusCode()).as(acao + " " + sub).isEqualTo(403);
                assertThat(codigo(r)).isEqualTo("FORBIDDEN_ACTION");
            }
            assertThat(acao(acao, os, null, corpo).statusCode()).isEqualTo(401);
        }
        assertThat(situacao(c, os)).isEqualTo("em_execucao|2|0,0,0|0,0");
        // o dono da empresa pode
        assertThat(acao("pausar", os, DONO_A, corpo("versao", 2, "chave", chave(), "motivo", MOTIVO)).statusCode()).isEqualTo(200);
    }

    /** Ajuste 1 da W-1: a ação foi gravada, a resposta se perdeu; o reenvio igual não cria nada de novo. */
    @Test
    void respostaPerdidaReenvioComAMesmaChaveNaoDuplica() throws Exception {
        CenarioOs c = cenario();
        String os = osEmExecucao(c);
        String k = chave();
        String pedido = JSON.writeValueAsString(corpo("versao", 2, "chave", k, "motivo", MOTIVO));

        int status = postDescartandoResposta(BASE + os + "/pausar", CHAVES.token(GESTOR_A), pedido);
        assertThat(status).isEqualTo(200);
        // a gravação está no banco, embora a tela não tenha recebido a resposta
        assertThat(situacao(c, os)).isEqualTo("pausada|3|1,1,0|1,0");
        assertThat(chaveGravada(c, k)).isEqualTo("1");

        // reenvio com a mesma chave, versão e conteúdo: resposta de sucesso, sem novo evento, auditoria ou versão
        var reenvio = post(BASE + os + "/pausar", CHAVES.token(GESTOR_A), pedido);
        assertThat(reenvio.statusCode()).isEqualTo(200);
        assertThat(CenarioOs.ler(reenvio.body()).get("estado").asText()).isEqualTo("pausada");
        assertThat(CenarioOs.ler(reenvio.body()).get("versao").asInt()).isEqualTo(3);
        assertThat(situacao(c, os)).isEqualTo("pausada|3|1,1,0|1,0");
        assertThat(chaveGravada(c, k)).isEqualTo("1");

        // mesma chave com outro conteúdo: conflito, nada muda
        var outroMotivo = acao("pausar", os, GESTOR_A, corpo("versao", 2, "chave", k, "motivo", MOTIVO + " (editado)"));
        assertThat(outroMotivo.statusCode()).isEqualTo(409);
        assertThat(codigo(outroMotivo)).isEqualTo("IDEMPOTENCY_CONFLICT");
        assertThat(situacao(c, os)).isEqualTo("pausada|3|1,1,0|1,0");

        assertThat(acao("retomar", os, GESTOR_A, corpo("versao", 3, "chave", chave())).statusCode()).isEqualTo(200);
        var depoisDaRetomada = post(BASE + os + "/pausar", CHAVES.token(GESTOR_A), pedido);
        assertThat(depoisDaRetomada.statusCode()).isEqualTo(200);
        assertThat(CenarioOs.ler(depoisDaRetomada.body()).get("estado").asText()).isEqualTo("em_execucao");
        assertThat(situacao(c, os)).isEqualTo("em_execucao|4|1,1,1|1,1");
        assertThat(chaveGravada(c, k)).isEqualTo("1");
    }

    /** Ajuste 2 da W-1: quem perdeu o acesso não recebe o detalhe guardado ao repetir a chave. */
    @Test
    void reenvioDeQuemPerdeuAcessoNaoDevolveODetalheGuardado() throws Exception {
        CenarioOs c = cenario();
        String inexistenteCorpo = acao("pausar", UUID.randomUUID().toString(), GESTOR_A, corpo("versao", 2, "chave", chave(), "motivo", MOTIVO)).body();

        // (a) continua membro, mas perdeu servicos.alterar
        String semAlterar = "eb0a0100-0000-4000-8000-000000000061";
        String perfil = c.novoMembroDaEmpresaEscrita(semAlterar, "perde-alterar-j06", "servicos.alterar,servicos.visualizar");
        String os1 = osEmExecucao(c);
        String k1 = chave();
        Map<String, Object> pedido1 = corpo("versao", 2, "chave", k1, "motivo", MOTIVO);
        assertThat(acao("pausar", os1, semAlterar, pedido1).statusCode()).isEqualTo(200);
        c.adm("DELETE FROM public.perfil_permissoes WHERE perfil_id = ?::uuid AND codigo = 'servicos.alterar'", perfil);
        var r1 = acao("pausar", os1, semAlterar, pedido1);
        assertThat(r1.statusCode()).isEqualTo(403);
        assertThat(codigo(r1)).isEqualTo("FORBIDDEN_ACTION");
        assertThat(CenarioOs.ler(r1.body()).size()).as("só codigo e mensagem").isEqualTo(2);
        assertThat(r1.body()).doesNotContain(os1).doesNotContain(MOTIVO);
        // controle: chamada direta à função SQL devolve o resultado guardado (comportamento que a API passa a barrar)
        String direto = c.comoUsuario(semAlterar, "SELECT public.mudar_estado_os(?::uuid, 'pausar', ?, 2, ?)::text", os1, MOTIVO, k1);
        assertThat(direto).contains(os1);

        // (b) desligado da empresa
        String desligado = "eb0a0100-0000-4000-8000-000000000062";
        c.novoMembroDaEmpresaEscrita(desligado, "desligado-j06", "servicos.alterar,servicos.visualizar");
        String os2 = osEmExecucao(c);
        Map<String, Object> pedido2 = corpo("versao", 2, "chave", chave(), "motivo", MOTIVO);
        assertThat(acao("pausar", os2, desligado, pedido2).statusCode()).isEqualTo(200);
        String membro = c.adm("SELECT id::text FROM public.membros_empresa WHERE empresa_id = ?::uuid AND auth_user_id = ?", c.empresaEscrita, desligado);
        c.comoUsuario(DONO_A, "SELECT public.desligar_membro(?::uuid, 'Desligamento fictício do teste J06.', ?)::text", membro, chave());
        var r2 = acao("pausar", os2, desligado, pedido2);
        assertThat(r2.statusCode()).isEqualTo(404);
        assertThat(r2.body()).isEqualTo(inexistenteCorpo);
        assertThat(situacao(c, os1)).isEqualTo("pausada|3|1,1,0|1,0");
        assertThat(situacao(c, os2)).isEqualTo("pausada|3|1,1,0|1,0");
    }

    /** T-ATOM: falha forçada DEPOIS do UPDATE da OS desfaz estado, versão, histórico, auditoria e chave. */
    @Test
    void falhaDepoisDaAtualizacaoDesfazTudo() throws Exception {
        CenarioOs c = cenario();
        c.adm("CREATE SCHEMA IF NOT EXISTS teste_j06");
        // A sequência NÃO volta no rollback: se avançar, prova que, no momento da falha, a mesma transação já via a OS
        // como "pausada" (ou seja, a falha aconteceu DEPOIS do UPDATE da OS).
        c.adm("CREATE SEQUENCE IF NOT EXISTS teste_j06.viu_update");
        c.adm("CREATE OR REPLACE FUNCTION teste_j06.falhar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                + "IF (SELECT estado FROM public.ordens_servico WHERE id = TG_ARGV[0]::uuid) = 'pausada' THEN "
                + "PERFORM nextval('teste_j06.viu_update'); END IF; "
                + "RAISE EXCEPTION 'falha forçada pelo teste T-ATOM'; END $$");
        String[][] pontos = {
                {"historico", "public.os_eventos", "NEW.os_id = '%s'::uuid AND NEW.tipo = 'pausar'"},
                {"auditoria", "app_private.eventos_auditoria", "NEW.recurso_id = '%s'::uuid AND NEW.tipo_acao = 'servicos.os_pausar'"},
                {"chave", "app_private.operacoes_idempotentes", "NEW.funcao = 'mudar_estado_os' AND NEW.chave = '%2$s'"}};
        for (String[] ponto : pontos) {
            String os = osEmExecucao(c);
            String k = chave();
            String gatilho = "t_atom_" + ponto[0];
            c.adm("CREATE TRIGGER " + gatilho + " BEFORE INSERT ON " + ponto[1] + " FOR EACH ROW WHEN ("
                    + String.format(ponto[2], os, k) + ") EXECUTE FUNCTION teste_j06.falhar('" + os + "')");
            try {
                long antes = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j06.viu_update"));
                var r = acao("pausar", os, GESTOR_A, corpo("versao", 2, "chave", k, "motivo", MOTIVO));
                assertThat(r.statusCode()).as(ponto[0]).isEqualTo(500);
                long depois = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j06.viu_update"));
                assertThat(depois).as("falha no " + ponto[0] + " aconteceu depois do UPDATE da OS").isEqualTo(antes + 1);
                assertThat(r.body()).as(ponto[0]).doesNotContain("T-ATOM").doesNotContain("trigger");
                assertThat(situacao(c, os)).as("falha no " + ponto[0] + ": nada gravado").isEqualTo("em_execucao|2|0,0,0|0,0");
                assertThat(chaveGravada(c, k)).as("falha no " + ponto[0] + ": chave não gravada").isEqualTo("0");
            } finally {
                c.adm("DROP TRIGGER " + gatilho + " ON " + ponto[1]);
            }
            // sem a falha, a MESMA chave executa de verdade (prova de que nada ficou registrado antes)
            var depois = acao("pausar", os, GESTOR_A, corpo("versao", 2, "chave", k, "motivo", MOTIVO));
            assertThat(depois.statusCode()).as(ponto[0]).isEqualTo(200);
            assertThat(situacao(c, os)).as(ponto[0]).isEqualTo("pausada|3|1,1,0|1,0");
            assertThat(chaveGravada(c, k)).isEqualTo("1");
        }
        c.adm("DROP SCHEMA teste_j06 CASCADE");
    }
}
