package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_1;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_ACOMPANHAMENTO;
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
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
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
 * J10 (ADR-J02 §4.4): publicar atualização, atualizar dados e registrar garantia pela API Java. Regras das funções SQL
 * existentes, sem mudança. Cada teste usa OS NOVAS da empresa de escrita, levadas a cada estado pelas próprias rotas.
 */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class AcompanhamentoOrdemServicoTest extends ApiComBancoBase {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String EMPRESA = "/api/business/ordens-servico/";
    private static final String CLIENTE = "/api/cliente/ordens-servico/";
    private static final String PUBLICA = "Equipe a caminho, chegamos às 14h (J10).";
    private static final String INTERNA = "NOTA-INTERNA-J10: cliente difícil, levar escada grande.";
    private static final String CONDICOES = "Cobre a instalação; não cobre mau uso (J10).";

    private static String chave() {
        return "j10-" + UUID.randomUUID();
    }

    private static Map<String, Object> corpo(Object... pares) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < pares.length; i += 2) m.put((String) pares[i], pares[i + 1]);
        return m;
    }

    private static String hoje(int dias) {
        return LocalDate.now(ZoneId.of("America/Sao_Paulo")).plusDays(dias).toString();
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

    private HttpResponse<String> publicar(String os, String sub, String texto, boolean publica) {
        return empresa(os, "publicar-atualizacao", sub, corpo("chave", chave(), "texto", texto, "publica", publica));
    }

    private HttpResponse<String> dados(String os, String sub, int versao, Map<String, Object> dados) {
        return empresa(os, "atualizar-dados", sub, corpo("versao", versao, "chave", chave(), "dados", dados));
    }

    private HttpResponse<String> garantia(String os, String sub, int versao, int dias, String condicoes) {
        return empresa(os, "registrar-garantia", sub, corpo("versao", versao, "chave", chave(), "dias", dias, "condicoes", condicoes));
    }

    private void ok(HttpResponse<String> r) {
        assertThat(r.statusCode()).as(r.body()).isEqualTo(200);
    }

    private String emExecucao(CenarioOs c) throws Exception {
        String os = c.novaOsDeAcompanhamento();
        ok(empresa(os, "iniciar", GESTOR_A, corpo("versao", 1, "chave", chave())));
        return os;
    }

    private String concluida(CenarioOs c, boolean interna) throws Exception {
        String os = interna ? c.novaOsInternaParaEscrita() : c.novaOsDeAcompanhamento();
        ok(empresa(os, "iniciar", GESTOR_A, corpo("versao", 1, "chave", chave())));
        ok(empresa(os, "concluir", GESTOR_A, corpo("versao", 2, "chave", chave())));
        return os;
    }

    private static String eventos(CenarioOs c, String os) throws Exception {
        return c.adm("SELECT coalesce(string_agg(tipo || ':' || publico, ',' ORDER BY criado_em, id), '-') FROM public.os_eventos "
                + "WHERE os_id = ?::uuid AND tipo IN ('atualizacao', 'nota_interna', 'dados_atualizados', 'previsao', 'garantia')", os);
    }

    /** versao|responsável|previsão|recorrência|garantia (dias:condições)|auditorias da OS|contas (n:total:recebido)|pagamentos,lançamentos. */
    static String situacao(CenarioOs c, String os) throws Exception {
        return c.adm("SELECT o.versao || '|' || coalesce(o.responsavel_auth_id, '-') || '|' || coalesce(o.previsao_conclusao::text, '-') || '|' "
                + "|| coalesce(o.recorrencia, '-') || '|' || coalesce(o.garantia_dias::text, '-') || ':' || coalesce(o.garantia_condicoes, '-') || '|' "
                + "|| (SELECT count(*) FROM app_private.eventos_auditoria a WHERE a.recurso_id = o.id) || '|' "
                + "|| (SELECT count(*) || ':' || coalesce(sum(t.total), 0)::numeric(12,2) || ':' || coalesce(sum(t.recebido), 0)::numeric(12,2) "
                + "    FROM public.titulos_financeiros t WHERE t.origem_id = o.id AND t.estado <> 'cancelado') || '|' "
                + "|| (SELECT count(*) FROM public.pagamentos p WHERE p.empresa_id = o.empresa_id) || ',' "
                + "|| (SELECT count(*) FROM public.lancamentos_financeiros l WHERE l.empresa_id = o.empresa_id) "
                + "FROM public.ordens_servico o WHERE o.id = ?::uuid", os);
    }

    private static String chaveGravada(CenarioOs c, String funcao, String chave) throws Exception {
        return c.adm("SELECT count(*)::text FROM app_private.operacoes_idempotentes WHERE funcao = ? AND chave = ?", funcao, chave);
    }

    private List<Integer> juntos(List<Supplier<HttpResponse<String>>> chamadas) {
        CountDownLatch largada = new CountDownLatch(1);
        List<CompletableFuture<HttpResponse<String>>> pedidos = new ArrayList<>();
        for (Supplier<HttpResponse<String>> s : chamadas) {
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

    // ================================================================================================ Publicar atualização

    /** A nota interna nunca chega ao Cliente: detalhe, lista, conversa, marcador de novidades e rotas da empresa. */
    @Test
    void notaInternaNuncaChegaAoCliente() throws Exception {
        CenarioOs c = cenario();
        String os = emExecucao(c);
        String antes = situacao(c, os);
        var rp = publicar(os, GESTOR_A, PUBLICA, true);
        ok(rp);
        var ri = publicar(os, GESTOR_A, INTERNA, false);
        ok(ri);
        // a resposta é a leitura da empresa, que mostra as duas, marcando a interna
        JsonNode empresaVe = CenarioOs.ler(ri.body());
        assertThat(empresaVe.toString()).contains(PUBLICA).contains(INTERNA);
        boolean marcada = false;
        for (JsonNode e : empresaVe.get("eventos")) if (e.path("tipo").asText().equals("nota_interna")) marcada = e.path("interno").asBoolean();
        assertThat(marcada).isTrue();
        // no banco: tipos e visibilidade separados; a OS e a versão não mudam; sem auditoria (regra vigente)
        assertThat(eventos(c, os)).isEqualTo("atualizacao:true,nota_interna:false");
        assertThat(c.adm("SELECT texto FROM public.os_eventos WHERE os_id = ?::uuid AND tipo = 'nota_interna'", os)).isEqualTo(INTERNA);
        assertThat(situacao(c, os)).isEqualTo(antes);

        // Cliente: detalhe e lista pela API Java
        String detalhe = get(CLIENTE + os, CHAVES.token(CLIENTE_ACOMPANHAMENTO)).body();
        assertThat(detalhe).contains(PUBLICA).doesNotContain(INTERNA).doesNotContain("nota_interna");
        String lista = get("/api/cliente/ordens-servico", CHAVES.token(CLIENTE_ACOMPANHAMENTO)).body();
        assertThat(lista).contains(os).doesNotContain(INTERNA);
        // Cliente pedindo a rota da empresa ou publicando: o mesmo 404, sem conteúdo
        var direto = get(EMPRESA + os, CHAVES.token(CLIENTE_ACOMPANHAMENTO));
        assertThat(direto.statusCode()).isEqualTo(404);
        assertThat(direto.body()).doesNotContain(INTERNA);
        // conversa da solicitação e marcador de novidades, pelas funções que a PWA usa (M12 e M13b)
        String solicitacao = c.adm("SELECT solicitacao_id::text FROM public.ordens_servico WHERE id = ?::uuid", os);
        String conversaCliente = c.comoUsuario(CLIENTE_ACOMPANHAMENTO, "SELECT public.conversa_atendimento('solicitacao', ?::uuid)::text", solicitacao);
        assertThat(conversaCliente).contains(PUBLICA).doesNotContain(INTERNA);
        String conversaEquipe = c.comoUsuario(GESTOR_A, "SELECT public.conversa_atendimento('solicitacao', ?::uuid)::text", solicitacao);
        assertThat(conversaEquipe).as("a conversa é com o cliente: também sem a nota").doesNotContain(INTERNA);
        assertThat(c.comoUsuario(CLIENTE_ACOMPANHAMENTO, "SELECT public.mensagens_novas(NULL)::text")).doesNotContain(INTERNA).doesNotContain(PUBLICA);
        // a mesma chave com publica trocada não transforma a nota em pública
        String k = chave();
        ok(empresa(os, "publicar-atualizacao", GESTOR_A, corpo("chave", k, "texto", INTERNA + " 2", "publica", false)));
        var virarPublica = empresa(os, "publicar-atualizacao", GESTOR_A, corpo("chave", k, "texto", INTERNA + " 2", "publica", true));
        assertThat(virarPublica.statusCode()).isEqualTo(409);
        assertThat(codigo(virarPublica)).isEqualTo("IDEMPOTENCY_CONFLICT");
        assertThat(get(CLIENTE + os, CHAVES.token(CLIENTE_ACOMPANHAMENTO)).body()).doesNotContain(INTERNA);
    }

    @Test
    void publicarValidaTextoEVisibilidade() throws Exception {
        CenarioOs c = cenario();
        String os = emExecucao(c);
        for (Object invalido : List.of(
                corpo("chave", chave(), "texto", "x", "publica", true),
                corpo("chave", chave(), "texto", "   x   ", "publica", false),
                corpo("chave", chave(), "texto", "a".repeat(501), "publica", true),
                corpo("chave", chave(), "texto", "a".repeat(1001), "publica", false),
                corpo("chave", chave(), "texto", "Ligue 11 98765-4321 para combinar.", "publica", true),
                corpo("chave", chave(), "texto", PUBLICA),
                corpo("chave", chave(), "texto", PUBLICA, "publica", "true"),
                corpo("chave", chave(), "texto", PUBLICA, "publica", null),
                corpo("chave", chave(), "texto", PUBLICA, "publica", true, "versao", 2),
                corpo("chave", chave(), "texto", PUBLICA, "publica", true, "acao", "concluir"),
                corpo("texto", PUBLICA, "publica", true),
                "não é json")) {
            var r = empresa(os, "publicar-atualizacao", GESTOR_A, invalido);
            assertThat(r.statusCode()).as(String.valueOf(invalido)).isEqualTo(400);
            assertThat(codigo(r)).isEqualTo("VALIDATION_ERROR");
        }
        assertThat(eventos(c, os)).isEqualTo("-");
        // limites e regra de contato só para a pública (regra vigente)
        ok(publicar(os, GESTOR_A, "ok", true));
        ok(publicar(os, GESTOR_A, "b".repeat(500), true));
        ok(publicar(os, GESTOR_A, "c".repeat(1000), false));
        ok(publicar(os, GESTOR_A, "Fornecedor: ligar 11 98765-4321 (nota interna).", false));
        assertThat(eventos(c, os)).isEqualTo("atualizacao:true,atualizacao:true,nota_interna:false,nota_interna:false");
    }

    /** Regra vigente: a função não restringe o estado; a tela só esconde o formulário na OS cancelada. */
    @Test
    void publicarValeEmQualquerEstadoDaOs() throws Exception {
        CenarioOs c = cenario();
        String aguardando = c.novaOsDeAcompanhamento();
        String encerrada = concluida(c, true);
        ok(empresa(encerrada, "encerrar", GESTOR_A, corpo("versao", 3, "chave", chave())));
        String cancelada = c.novaOsDeAcompanhamento();
        c.comoUsuario(GESTOR_A, "SELECT public.cancelar_os(?::uuid, 'Cancelamento fictício do teste J10.', false, ?)::text", cancelada, chave());
        for (String os : List.of(aguardando, encerrada, cancelada)) {
            ok(publicar(os, GESTOR_A, PUBLICA, true));
            ok(publicar(os, GESTOR_A, INTERNA, false));
            assertThat(eventos(c, os)).isEqualTo("atualizacao:true,nota_interna:false");
        }
    }

    @Test
    void publicarSoComPermissaoNaEmpresaDaOs() throws Exception {
        CenarioOs c = cenario();
        String soVer = "eb0a0100-0000-4000-8000-0000000000a0";
        c.novoMembroDaEmpresaEscrita(soVer, "so-ver-j10", "servicos.visualizar");
        String os = emExecucao(c);
        var inexistente = publicar(UUID.randomUUID().toString(), GESTOR_A, PUBLICA, true);
        assertThat(inexistente.statusCode()).isEqualTo(404);
        for (String sub : List.of(CLIENTE_ACOMPANHAMENTO, CLIENTE_1, DONO_B, SEM_PERFIL)) {
            for (boolean publica : List.of(true, false)) {
                var r = publicar(os, sub, PUBLICA, publica);
                assertThat(r.statusCode()).as(sub).isEqualTo(404);
                assertThat(r.body()).isEqualTo(inexistente.body());
            }
        }
        for (String sub : List.of(MEMBRO_SEM_VISAO, soVer)) {
            var r = publicar(os, sub, INTERNA, false);
            assertThat(r.statusCode()).as(sub).isEqualTo(403);
            assertThat(codigo(r)).isEqualTo("FORBIDDEN_ACTION");
            assertThat(r.body()).doesNotContain(INTERNA);
        }
        assertThat(publicar(os, null, PUBLICA, true).statusCode()).isEqualTo(401);
        assertThat(eventos(c, os)).isEqualTo("-");
        ok(publicar(os, DONO_A, PUBLICA, true));
    }

    @Test
    void publicarRespostaPerdidaEReenvioNaoDuplicam() throws Exception {
        CenarioOs c = cenario();
        String os = emExecucao(c);
        String k = chave();
        String pedido = JSON.writeValueAsString(corpo("chave", k, "texto", INTERNA, "publica", false));
        assertThat(postDescartandoResposta(EMPRESA + os + "/publicar-atualizacao", CHAVES.token(GESTOR_A), pedido)).isEqualTo(200);
        assertThat(eventos(c, os)).isEqualTo("nota_interna:false");
        var reenvio = post(EMPRESA + os + "/publicar-atualizacao", CHAVES.token(GESTOR_A), pedido);
        ok(reenvio);
        assertThat(eventos(c, os)).isEqualTo("nota_interna:false");
        assertThat(chaveGravada(c, "publicar_atualizacao_os", k)).isEqualTo("1");
        assertThat(codigo(empresa(os, "publicar-atualizacao", GESTOR_A, corpo("chave", k, "texto", INTERNA + " editada", "publica", false))))
                .isEqualTo("IDEMPOTENCY_CONFLICT");
        // o mesmo pedido enviado pelo Cliente (ou por outra empresa) não devolve nada guardado
        for (String sub : List.of(CLIENTE_ACOMPANHAMENTO, DONO_B)) {
            var r = post(EMPRESA + os + "/publicar-atualizacao", CHAVES.token(sub), pedido);
            assertThat(r.statusCode()).isEqualTo(404);
            assertThat(r.body()).doesNotContain(INTERNA);
        }
        // quem publicou e perdeu servicos.alterar não recebe a OS guardada
        String membro = "eb0a0100-0000-4000-8000-0000000000a1";
        String perfil = c.novoMembroDaEmpresaEscrita(membro, "perde-alterar-j10", "servicos.alterar,servicos.visualizar");
        Map<String, Object> dele = corpo("chave", chave(), "texto", INTERNA + " do membro", "publica", false);
        ok(empresa(os, "publicar-atualizacao", membro, dele));
        c.adm("DELETE FROM public.perfil_permissoes WHERE perfil_id = ?::uuid AND codigo = 'servicos.alterar'", perfil);
        var semPermissao = empresa(os, "publicar-atualizacao", membro, dele);
        assertThat(semPermissao.statusCode()).isEqualTo(403);
        assertThat(semPermissao.body()).doesNotContain(INTERNA);
    }

    /** Publicações simultâneas, públicas e internas, não se misturam: cada texto fica com a visibilidade pedida. */
    @Test
    void publicacoesSimultaneasNaoMisturamVisibilidade() throws Exception {
        CenarioOs c = cenario();
        String os = emExecucao(c);
        List<Supplier<HttpResponse<String>>> chamadas = new ArrayList<>();
        Map<String, Boolean> esperado = new HashMap<>();
        for (int i = 0; i < 12; i++) {
            boolean publica = i % 2 == 0;
            String texto = (publica ? "PUB-" : "INT-") + i + " atualização simultânea J10";
            esperado.put(texto, publica);
            chamadas.add(() -> publicar(os, i2(texto) ? GESTOR_A : DONO_A, texto, publica));
        }
        // mais duas com a MESMA chave ao mesmo tempo: uma só grava
        String k = chave();
        Map<String, Object> repetido = corpo("chave", k, "texto", "INT-repetida J10", "publica", false);
        chamadas.add(() -> empresa(os, "publicar-atualizacao", GESTOR_A, repetido));
        chamadas.add(() -> empresa(os, "publicar-atualizacao", GESTOR_A, repetido));
        assertThat(juntos(chamadas)).containsOnly(200);
        esperado.put("INT-repetida J10", false);
        String gravado = c.adm("SELECT string_agg(texto || '=' || publico, '|' ORDER BY texto) FROM public.os_eventos WHERE os_id = ?::uuid "
                + "AND tipo IN ('atualizacao', 'nota_interna')", os);
        List<String> linhas = List.of(gravado.split("\\|"));
        assertThat(linhas).hasSize(esperado.size());
        for (String linha : linhas) {
            String texto = linha.substring(0, linha.lastIndexOf('='));
            assertThat(linha).isEqualTo(texto + "=" + esperado.get(texto));
        }
        assertThat(c.adm("SELECT count(*)::text FROM public.os_eventos WHERE os_id = ?::uuid AND tipo = 'nota_interna' AND publico", os)).isEqualTo("0");
        assertThat(c.adm("SELECT count(*)::text FROM public.os_eventos WHERE os_id = ?::uuid AND tipo = 'atualizacao' AND NOT publico", os)).isEqualTo("0");
        String cliente = get(CLIENTE + os, CHAVES.token(CLIENTE_ACOMPANHAMENTO)).body();
        for (Map.Entry<String, Boolean> e : esperado.entrySet()) {
            if (e.getValue()) assertThat(cliente).contains(e.getKey());
            else assertThat(cliente).doesNotContain(e.getKey());
        }
    }

    private static boolean i2(String texto) {
        return texto.hashCode() % 2 == 0;
    }

    // ================================================================================================ Atualizar dados

    @Test
    void atualizarResponsavelEPrevisaoPreservandoOsCamposNaoEnviados() throws Exception {
        CenarioOs c = cenario();
        String os = emExecucao(c);
        String previsao = hoje(10);
        var r = dados(os, GESTOR_A, 2, corpo("responsavel_auth_id", GESTOR_A, "previsao_conclusao", previsao));
        ok(r);
        JsonNode resposta = CenarioOs.ler(r.body());
        assertThat(resposta.get("responsavel_auth_id").asText()).isEqualTo(GESTOR_A);
        assertThat(resposta.get("previsao_conclusao").asText()).isEqualTo(previsao);
        assertThat(situacao(c, os)).startsWith("3|" + GESTOR_A + "|" + previsao + "|-|-:-|");
        // histórico: os campos alterados (interno) e a previsão (pública); sem auditoria (regra vigente)
        assertThat(eventos(c, os)).isEqualTo("dados_atualizados:false,previsao:true");
        String auditorias = c.adm("SELECT count(*)::text FROM app_private.eventos_auditoria WHERE recurso_id = ?::uuid", os);
        // o Cliente vê a previsão, não quem é o responsável
        JsonNode cliente = CenarioOs.ler(get(CLIENTE + os, CHAVES.token(CLIENTE_ACOMPANHAMENTO)).body());
        assertThat(cliente.get("previsao_conclusao").asText()).isEqualTo(previsao);
        assertThat(cliente.has("responsavel_auth_id")).isFalse();
        assertThat(cliente.toString()).doesNotContain(GESTOR_A);

        // só a recorrência: responsável e previsão continuam
        ok(dados(os, GESTOR_A, 3, corpo("recorrencia", "mensal")));
        assertThat(situacao(c, os)).startsWith("4|" + GESTOR_A + "|" + previsao + "|mensal|");
        assertThat(eventos(c, os)).as("sem previsão no pedido, sem evento público").isEqualTo("dados_atualizados:false,previsao:true,dados_atualizados:false");
        // limpar (null e texto vazio) e o membro só com clientes.visualizar também pode ser responsável (regra: membro ativo)
        ok(dados(os, GESTOR_A, 4, corpo("responsavel_auth_id", null, "previsao_conclusao", "", "recorrencia", null)));
        assertThat(situacao(c, os)).startsWith("5|-|-|-|");
        ok(dados(os, GESTOR_A, 5, corpo("responsavel_auth_id", MEMBRO_SEM_VISAO)));
        assertThat(situacao(c, os)).startsWith("6|" + MEMBRO_SEM_VISAO + "|-|-|");
        // dados vazio é aceito pela função (sobe a versão e registra o evento interno)
        ok(dados(os, GESTOR_A, 6, corpo()));
        assertThat(situacao(c, os)).startsWith("7|" + MEMBRO_SEM_VISAO + "|");
        assertThat(c.adm("SELECT count(*)::text FROM app_private.eventos_auditoria WHERE recurso_id = ?::uuid", os)).isEqualTo(auditorias);
    }

    @Test
    void responsavelSoMembroAtivoDaEmpresaEValidacoes() throws Exception {
        CenarioOs c = cenario();
        String os = emExecucao(c);
        String antes = situacao(c, os);
        String desligado = "eb0a0100-0000-4000-8000-0000000000a2";
        c.novoMembroDaEmpresaEscrita(desligado, "desligado-j10", "servicos.visualizar");
        String membro = c.adm("SELECT id::text FROM public.membros_empresa WHERE empresa_id = ?::uuid AND auth_user_id = ?", c.empresaEscrita, desligado);
        c.comoUsuario(DONO_A, "SELECT public.desligar_membro(?::uuid, 'Desligamento fictício do teste J10.', ?)::text", membro, chave());
        for (Map<String, Object> invalido : List.of(
                corpo("responsavel_auth_id", DONO_B),
                corpo("responsavel_auth_id", CLIENTE_ACOMPANHAMENTO),
                corpo("responsavel_auth_id", desligado),
                corpo("responsavel_auth_id", UUID.randomUUID().toString()),
                corpo("previsao_conclusao", hoje(-1)),
                corpo("previsao_conclusao", hoje(366)),
                corpo("previsao_conclusao", "2026-13-40"),
                corpo("previsao_conclusao", "20/12/2026"),
                corpo("recorrencia", "anual"))) {
            var r = dados(os, GESTOR_A, 2, invalido);
            assertThat(r.statusCode()).as(String.valueOf(invalido)).isEqualTo(400);
            assertThat(codigo(r)).isEqualTo("VALIDATION_ERROR");
        }
        for (Object invalido : List.of(
                corpo("versao", 2, "chave", chave(), "dados", corpo("estado", "concluida")),
                corpo("versao", 2, "chave", chave(), "dados", corpo("previsao_conclusao", 20261220)),
                corpo("versao", 2, "chave", chave(), "dados", "responsavel"),
                corpo("versao", 2, "chave", chave(), "dados", corpo(), "acao", "x"),
                corpo("versao", 2, "chave", chave()),
                corpo("chave", chave(), "dados", corpo()),
                "não é json")) {
            var r = empresa(os, "atualizar-dados", GESTOR_A, invalido);
            assertThat(r.statusCode()).as(String.valueOf(invalido)).isEqualTo(400);
        }
        assertThat(situacao(c, os)).isEqualTo(antes);
        assertThat(eventos(c, os)).isEqualTo("-");
        // limites aceitos: hoje e 365 dias à frente
        ok(dados(os, GESTOR_A, 2, corpo("previsao_conclusao", hoje(0))));
        ok(dados(os, GESTOR_A, 3, corpo("previsao_conclusao", hoje(365))));
    }

    @Test
    void atualizarDadosVersaoEstadoEPermissoes() throws Exception {
        CenarioOs c = cenario();
        String os = emExecucao(c);
        String antes = situacao(c, os);
        String k = chave();
        var velha = empresa(os, "atualizar-dados", GESTOR_A, corpo("versao", 1, "chave", k, "dados", corpo("responsavel_auth_id", GESTOR_A)));
        assertThat(codigo(velha)).isEqualTo("VERSION_CONFLICT");
        assertThat(chaveGravada(c, "atualizar_dados_os", k)).isEqualTo("0");
        assertThat(codigo(dados(os, GESTOR_A, 3, corpo("responsavel_auth_id", GESTOR_A)))).isEqualTo("VERSION_CONFLICT");
        var inexistente = dados(UUID.randomUUID().toString(), GESTOR_A, 2, corpo());
        for (String sub : List.of(CLIENTE_ACOMPANHAMENTO, CLIENTE_1, DONO_B, SEM_PERFIL)) {
            var r = dados(os, sub, 2, corpo("responsavel_auth_id", GESTOR_A));
            assertThat(r.statusCode()).as(sub).isEqualTo(404);
            assertThat(r.body()).isEqualTo(inexistente.body());
        }
        assertThat(dados(os, MEMBRO_SEM_VISAO, 2, corpo("responsavel_auth_id", GESTOR_A)).statusCode()).isEqualTo(403);
        assertThat(dados(os, null, 2, corpo()).statusCode()).isEqualTo(401);
        assertThat(situacao(c, os)).isEqualTo(antes);
        // cancelada: recusado (regra vigente; os demais estados aceitam, inclusive encerrada)
        String cancelada = c.novaOsDeAcompanhamento();
        c.comoUsuario(GESTOR_A, "SELECT public.cancelar_os(?::uuid, 'Cancelamento fictício do teste J10.', false, ?)::text", cancelada, chave());
        int vc = Integer.parseInt(c.adm("SELECT versao::text FROM public.ordens_servico WHERE id = ?::uuid", cancelada));
        assertThat(codigo(dados(cancelada, GESTOR_A, vc, corpo("responsavel_auth_id", GESTOR_A)))).isEqualTo("STATE_CONFLICT");
        String encerrada = concluida(c, true);
        ok(empresa(encerrada, "encerrar", GESTOR_A, corpo("versao", 3, "chave", chave())));
        ok(dados(encerrada, GESTOR_A, 4, corpo("responsavel_auth_id", GESTOR_A)));
    }

    @Test
    void doisGestoresNaMesmaOsSoUmGrava() throws Exception {
        CenarioOs c = cenario();
        for (int i = 0; i < 4; i++) {
            String os = emExecucao(c);
            assertThat(juntos(List.of(
                    () -> dados(os, GESTOR_A, 2, corpo("responsavel_auth_id", GESTOR_A, "previsao_conclusao", hoje(5))),
                    () -> dados(os, DONO_A, 2, corpo("responsavel_auth_id", MEMBRO_SEM_VISAO, "previsao_conclusao", hoje(9)))))).containsExactly(200, 409);
            String s = situacao(c, os);
            assertThat(s.startsWith("3|" + GESTOR_A + "|" + hoje(5) + "|") || s.startsWith("3|" + MEMBRO_SEM_VISAO + "|" + hoje(9) + "|")).as(s).isTrue();
            assertThat(eventos(c, os)).isEqualTo("dados_atualizados:false,previsao:true");
        }
    }

    @Test
    void atualizarDadosRespostaPerdidaEChaveComOutrosDados() throws Exception {
        CenarioOs c = cenario();
        String os = emExecucao(c);
        String k = chave();
        String pedido = JSON.writeValueAsString(corpo("versao", 2, "chave", k, "dados", corpo("responsavel_auth_id", GESTOR_A, "previsao_conclusao", hoje(3))));
        assertThat(postDescartandoResposta(EMPRESA + os + "/atualizar-dados", CHAVES.token(GESTOR_A), pedido)).isEqualTo(200);
        String gravado = situacao(c, os) + eventos(c, os);
        ok(post(EMPRESA + os + "/atualizar-dados", CHAVES.token(GESTOR_A), pedido));
        assertThat(situacao(c, os) + eventos(c, os)).isEqualTo(gravado);
        assertThat(codigo(empresa(os, "atualizar-dados", GESTOR_A, corpo("versao", 2, "chave", k, "dados", corpo("responsavel_auth_id", DONO_A)))))
                .isEqualTo("IDEMPOTENCY_CONFLICT");
        assertThat(codigo(empresa(os, "atualizar-dados", GESTOR_A, corpo("versao", 3, "chave", k, "dados", corpo("responsavel_auth_id", GESTOR_A, "previsao_conclusao", hoje(3))))))
                .isEqualTo("IDEMPOTENCY_CONFLICT");
        assertThat(situacao(c, os) + eventos(c, os)).isEqualTo(gravado);
    }

    // ================================================================================================ Garantia

    @Test
    void garantiaNaOsConcluidaSemEfeitoFinanceiro() throws Exception {
        CenarioOs c = cenario();
        String os = concluida(c, false);
        String antes = situacao(c, os);
        assertThat(antes).startsWith("3|-|-|-|-:-|");
        String financeiro = antes.substring(antes.lastIndexOf('|', antes.lastIndexOf('|') - 1));
        var r = garantia(os, GESTOR_A, 3, 90, "  " + CONDICOES + "  ");
        ok(r);
        JsonNode resposta = CenarioOs.ler(r.body());
        assertThat(resposta.at("/garantia/dias").asInt()).isEqualTo(90);
        assertThat(resposta.get("versao").asInt()).isEqualTo(4);
        String depois = situacao(c, os);
        assertThat(depois).startsWith("4|-|-|-|90:" + CONDICOES + "|");
        assertThat(depois).endsWith(financeiro);
        assertThat(eventos(c, os)).isEqualTo("garantia:true");
        assertThat(c.adm("SELECT count(*)::text FROM app_private.eventos_auditoria WHERE recurso_id = ?::uuid AND tipo_acao = 'servicos.garantia_registrada'", os)).isEqualTo("1");
        // o Cliente vê a garantia (prazo e condições são públicos na regra vigente)
        assertThat(get(CLIENTE + os, CHAVES.token(CLIENTE_ACOMPANHAMENTO)).body()).contains(CONDICOES);
        // registrar de novo, com a versão atual, substitui (regra vigente); sem condições também vale
        ok(empresa(os, "registrar-garantia", GESTOR_A, corpo("versao", 4, "chave", chave(), "dias", 0)));
        assertThat(situacao(c, os)).startsWith("5|-|-|-|0:-|").endsWith(financeiro);
        assertThat(eventos(c, os)).isEqualTo("garantia:true,garantia:true");
    }

    @Test
    void garantiaSoAntesDoEncerramento() throws Exception {
        CenarioOs c = cenario();
        String aguardando = c.novaOsDeAcompanhamento();
        String emExecucao = emExecucao(c);
        String pausada = emExecucao(c);
        ok(empresa(pausada, "pausar", GESTOR_A, corpo("versao", 2, "chave", chave(), "motivo", "Pausa fictícia J10.")));
        String peloCliente = concluida(c, false);
        ok(enviar(CLIENTE, peloCliente, "confirmar-recebimento", CLIENTE_ACOMPANHAMENTO, corpo("versao", 3, "chave", chave())));
        String pelaEmpresa = concluida(c, true);
        ok(empresa(pelaEmpresa, "encerrar", GESTOR_A, corpo("versao", 3, "chave", chave())));
        for (String[] caso : new String[][] {{aguardando, "1"}, {emExecucao, "2"}, {pausada, "3"}, {peloCliente, "4"}, {pelaEmpresa, "4"}}) {
            String antes = situacao(c, caso[0]);
            var r = garantia(caso[0], GESTOR_A, Integer.parseInt(caso[1]), 90, CONDICOES);
            assertThat(r.statusCode()).as(caso[1]).isEqualTo(409);
            assertThat(codigo(r)).isEqualTo("STATE_CONFLICT");
            assertThat(CenarioOs.ler(r.body()).get("mensagem").asText()).contains("antes do encerramento");
            assertThat(situacao(c, caso[0])).isEqualTo(antes);
        }
    }

    @Test
    void garantiaValidacaoEPermissoes() throws Exception {
        CenarioOs c = cenario();
        String os = concluida(c, false);
        String antes = situacao(c, os);
        for (Object invalido : List.of(
                corpo("versao", 3, "chave", chave(), "dias", -1),
                corpo("versao", 3, "chave", chave(), "dias", 3651),
                corpo("versao", 3, "chave", chave(), "dias", "90"),
                corpo("versao", 3, "chave", chave(), "dias", 1.5),
                corpo("versao", 3, "chave", chave(), "dias", null),
                corpo("versao", 3, "chave", chave()),
                corpo("versao", 3, "chave", chave(), "dias", 90, "condicoes", "x".repeat(1001)),
                corpo("versao", 3, "chave", chave(), "dias", 90, "condicoes", 5),
                corpo("versao", 3, "chave", chave(), "dias", 90, "publica", false),
                corpo("chave", chave(), "dias", 90),
                "não é json")) {
            var r = empresa(os, "registrar-garantia", GESTOR_A, invalido);
            assertThat(r.statusCode()).as(String.valueOf(invalido)).isEqualTo(400);
        }
        var inexistente = garantia(UUID.randomUUID().toString(), GESTOR_A, 3, 90, null);
        for (String sub : List.of(CLIENTE_ACOMPANHAMENTO, CLIENTE_1, DONO_B, SEM_PERFIL)) {
            var r = garantia(os, sub, 3, 90, CONDICOES);
            assertThat(r.statusCode()).as(sub).isEqualTo(404);
            assertThat(r.body()).isEqualTo(inexistente.body());
        }
        assertThat(garantia(os, MEMBRO_SEM_VISAO, 3, 90, null).statusCode()).isEqualTo(403);
        assertThat(garantia(os, null, 3, 90, null).statusCode()).isEqualTo(401);
        assertThat(situacao(c, os)).isEqualTo(antes);
        ok(garantia(os, GESTOR_A, 3, 3650, "y".repeat(1000)));
    }

    /** Versão conferida na API (mecanismo do J08): pedido novo com versão diferente da atual → 409 e nada gravado. */
    @Test
    void garantiaComVersaoDesatualizadaNaoGravaNada() throws Exception {
        CenarioOs c = cenario();
        String os = concluida(c, false);
        String antes = situacao(c, os);
        for (int v : List.of(1, 2, 4, 99)) {
            String k = chave();
            var r = empresa(os, "registrar-garantia", GESTOR_A, corpo("versao", v, "chave", k, "dias", 90));
            assertThat(r.statusCode()).as("v" + v).isEqualTo(409);
            assertThat(codigo(r)).isEqualTo("VERSION_CONFLICT");
            assertThat(chaveGravada(c, "registrar_garantia_os", k)).isEqualTo("0");
        }
        assertThat(situacao(c, os)).isEqualTo(antes);
        assertThat(eventos(c, os)).isEqualTo("-");
        // uma mudança feita por outra transação depois da leitura da tela (outro gestor salvou os dados) é percebida
        ok(dados(os, DONO_A, 3, corpo("responsavel_auth_id", DONO_A)));
        var depoisDaOutra = garantia(os, GESTOR_A, 3, 90, CONDICOES);
        assertThat(codigo(depoisDaOutra)).isEqualTo("VERSION_CONFLICT");
        assertThat(situacao(c, os)).startsWith("4|" + DONO_A + "|-|-|-:-|");
        ok(garantia(os, GESTOR_A, 4, 90, CONDICOES));
    }

    @Test
    void garantiaConcorrenteComEncerrarEComOutraGarantia() throws Exception {
        CenarioOs c = cenario();
        int garantiaVenceu = 0, encerrarVenceu = 0;
        for (int i = 0; i < 5; i++) {
            String os = concluida(c, true);
            assertThat(juntos(List.of(() -> garantia(os, GESTOR_A, 3, 90, CONDICOES),
                    () -> empresa(os, "encerrar", DONO_A, corpo("versao", 3, "chave", chave()))))).containsExactly(200, 409);
            String estado = c.adm("SELECT estado || '|' || versao || '|' || coalesce(garantia_dias::text, '-') FROM public.ordens_servico WHERE id = ?::uuid", os);
            if (estado.equals("concluida|4|90")) garantiaVenceu++;
            else if (estado.equals("encerrada|4|-")) encerrarVenceu++;
            else throw new AssertionError("estado inesperado: " + estado);
            assertThat(eventos(c, os)).isIn("garantia:true", "-");
        }
        assertThat(garantiaVenceu + encerrarVenceu).isEqualTo(5);
        String os = concluida(c, false);
        assertThat(juntos(List.of(() -> garantia(os, GESTOR_A, 3, 30, null), () -> garantia(os, DONO_A, 3, 60, null)))).containsExactly(200, 409);
        assertThat(eventos(c, os)).isEqualTo("garantia:true");
        assertThat(c.adm("SELECT versao::text FROM public.ordens_servico WHERE id = ?::uuid", os)).isEqualTo("4");
    }

    @Test
    void garantiaRespostaPerdidaReenvioERepeticaoDepoisDeOutrasMudancas() throws Exception {
        CenarioOs c = cenario();
        String os = concluida(c, true);
        String k = chave();
        String pedido = JSON.writeValueAsString(corpo("versao", 3, "chave", k, "dias", 90, "condicoes", CONDICOES));
        assertThat(postDescartandoResposta(EMPRESA + os + "/registrar-garantia", CHAVES.token(GESTOR_A), pedido)).isEqualTo(200);
        String gravado = situacao(c, os) + eventos(c, os);
        assertThat(gravado).startsWith("4|");
        ok(post(EMPRESA + os + "/registrar-garantia", CHAVES.token(GESTOR_A), pedido));
        assertThat(situacao(c, os) + eventos(c, os)).isEqualTo(gravado);
        assertThat(chaveGravada(c, "registrar_garantia_os", k)).isEqualTo("1");
        assertThat(codigo(empresa(os, "registrar-garantia", GESTOR_A, corpo("versao", 2, "chave", k, "dias", 90, "condicoes", CONDICOES))))
                .isEqualTo("IDEMPOTENCY_CONFLICT");
        assertThat(codigo(empresa(os, "registrar-garantia", GESTOR_A, corpo("versao", 3, "chave", k, "dias", 120, "condicoes", CONDICOES))))
                .isEqualTo("IDEMPOTENCY_CONFLICT");
        // a OS é encerrada depois: o reenvio idêntico continua reconhecido (sem gravar) e devolve a OS atual
        ok(empresa(os, "encerrar", GESTOR_A, corpo("versao", 4, "chave", chave())));
        var tardio = post(EMPRESA + os + "/registrar-garantia", CHAVES.token(GESTOR_A), pedido);
        ok(tardio);
        assertThat(CenarioOs.ler(tardio.body()).get("estado").asText()).isEqualTo("encerrada");
        assertThat(eventos(c, os)).isEqualTo("garantia:true");
        // um pedido NOVO de garantia na OS encerrada é recusado
        assertThat(codigo(garantia(os, GESTOR_A, 5, 90, CONDICOES))).isEqualTo("STATE_CONFLICT");
        // quem registrou e perdeu servicos.alterar não recebe a OS guardada
        String membro = "eb0a0100-0000-4000-8000-0000000000a3";
        String perfil = c.novoMembroDaEmpresaEscrita(membro, "perde-alterar-garantia-j10", "servicos.alterar,servicos.visualizar");
        String os2 = concluida(c, false);
        Map<String, Object> dele = corpo("versao", 3, "chave", chave(), "dias", 30);
        ok(empresa(os2, "registrar-garantia", membro, dele));
        c.adm("DELETE FROM public.perfil_permissoes WHERE perfil_id = ?::uuid AND codigo = 'servicos.alterar'", perfil);
        var semPermissao = empresa(os2, "registrar-garantia", membro, dele);
        assertThat(semPermissao.statusCode()).isEqualTo(403);
        assertThat(semPermissao.body()).doesNotContain(os2);
    }

    // ================================================================================================ T-ATOM

    /** Falha forçada depois da escrita desfaz tudo: dados, garantia, versão, histórico, auditoria e chave. */
    @Test
    void falhaDepoisDaEscritaDesfazTudo() throws Exception {
        CenarioOs c = cenario();
        c.adm("CREATE SCHEMA IF NOT EXISTS teste_j10");
        c.adm("CREATE SEQUENCE IF NOT EXISTS teste_j10.viu_escrita");
        // Não volta no rollback: prova que, na hora da falha, a escrita da OS (ou o evento anterior) já estava feita.
        c.adm("CREATE OR REPLACE FUNCTION teste_j10.falhar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                + "IF (SELECT versao > (TG_ARGV[1])::int OR EXISTS (SELECT 1 FROM public.os_eventos WHERE os_id = TG_ARGV[0]::uuid "
                + "    AND tipo = 'atualizacao') FROM public.ordens_servico WHERE id = TG_ARGV[0]::uuid) THEN "
                + "PERFORM nextval('teste_j10.viu_escrita'); END IF; "
                + "RAISE EXCEPTION 'falha forçada pelo teste T-ATOM'; END $$");
        record Ponto(String acao, String parte, String tabela, String quando) {
        }
        List<Ponto> pontos = List.of(
                new Ponto("dados", "historico_interno", "public.os_eventos", "NEW.os_id = '%s'::uuid AND NEW.tipo = 'dados_atualizados'"),
                new Ponto("dados", "historico_previsao", "public.os_eventos", "NEW.os_id = '%s'::uuid AND NEW.tipo = 'previsao'"),
                new Ponto("dados", "chave", "app_private.operacoes_idempotentes", "NEW.funcao = 'atualizar_dados_os' AND NEW.chave = '%2$s'"),
                new Ponto("garantia", "historico", "public.os_eventos", "NEW.os_id = '%s'::uuid AND NEW.tipo = 'garantia'"),
                new Ponto("garantia", "auditoria", "app_private.eventos_auditoria", "NEW.recurso_id = '%s'::uuid AND NEW.tipo_acao = 'servicos.garantia_registrada'"),
                new Ponto("garantia", "chave", "app_private.operacoes_idempotentes", "NEW.funcao = 'registrar_garantia_os' AND NEW.chave = '%2$s'"),
                new Ponto("publicar", "chave", "app_private.operacoes_idempotentes", "NEW.funcao = 'publicar_atualizacao_os' AND NEW.chave = '%2$s'"));
        for (Ponto p : pontos) {
            boolean garantia = p.acao().equals("garantia");
            String os = garantia ? concluida(c, false) : emExecucao(c);
            int versao = garantia ? 3 : 2;
            String k = chave();
            String antes = situacao(c, os) + eventos(c, os);
            String gatilho = "t_atom_j10_" + p.acao() + "_" + p.parte();
            c.adm("CREATE TRIGGER " + gatilho + " BEFORE INSERT ON " + p.tabela() + " FOR EACH ROW WHEN ("
                    + String.format(p.quando(), os, k) + ") EXECUTE FUNCTION teste_j10.falhar('" + os + "', '" + versao + "')");
            String rota = switch (p.acao()) {
                case "dados" -> "atualizar-dados";
                case "garantia" -> "registrar-garantia";
                default -> "publicar-atualizacao";
            };
            Map<String, Object> pedido = switch (p.acao()) {
                case "dados" -> corpo("versao", versao, "chave", k, "dados", corpo("responsavel_auth_id", GESTOR_A, "previsao_conclusao", hoje(4)));
                case "garantia" -> corpo("versao", versao, "chave", k, "dias", 90, "condicoes", CONDICOES);
                default -> corpo("chave", k, "texto", PUBLICA, "publica", true);
            };
            String funcao = switch (p.acao()) {
                case "dados" -> "atualizar_dados_os";
                case "garantia" -> "registrar_garantia_os";
                default -> "publicar_atualizacao_os";
            };
            try {
                long antesSeq = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j10.viu_escrita"));
                var r = empresa(os, rota, GESTOR_A, pedido);
                assertThat(r.statusCode()).as(p.acao() + "/" + p.parte()).isEqualTo(500);
                assertThat(r.body()).doesNotContain("T-ATOM").doesNotContain("trigger");
                long depoisSeq = Long.parseLong(c.adm("SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text FROM teste_j10.viu_escrita"));
                assertThat(depoisSeq).as(p.acao() + "/" + p.parte() + ": a falha veio depois da escrita").isEqualTo(antesSeq + 1);
                assertThat(situacao(c, os) + eventos(c, os)).as(p.acao() + "/" + p.parte() + ": nada gravado").isEqualTo(antes);
                assertThat(chaveGravada(c, funcao, k)).isEqualTo("0");
            } finally {
                c.adm("DROP TRIGGER " + gatilho + " ON " + p.tabela());
            }
            ok(empresa(os, rota, GESTOR_A, pedido));
            assertThat(chaveGravada(c, funcao, k)).isEqualTo("1");
        }
        c.adm("DROP SCHEMA teste_j10 CASCADE");
    }

    @Test
    void registrarGarantiaNoBancoDiretoContinuaSemVersao() throws Exception {
        // Referência: a função SQL não recebe versão (a PWA fora da demonstração chama assim); o controle é da API Java.
        CenarioOs c = cenario();
        String os = concluida(c, false);
        assertThatThrownBy(() -> c.comoUsuario(GESTOR_A, "SELECT public.registrar_garantia_os(?::uuid, 90, NULL, 4, ?)::text", os, chave()))
                .hasMessageContaining("registrar_garantia_os");
    }
}
