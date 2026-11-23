package br.com.ckgroup.autonick.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;

/**
 * Substituto LOCAL da Data API, só para abrir as telas na demonstração (contexto da empresa, permissões, conversa).
 * As consultas de ordens de serviço (listas e detalhe) NÃO passam por aqui: vêm só da API Java (J03 e J04).
 *
 * - Só leitura: cada pedido roda numa transação com o papel authenticated e a identidade do token da demonstração, e
 *   termina SEMPRE em rollback (nada é gravado).
 * - Lista fechada de funções e tabelas. O DETALHE da OS (minha_os e os_detalhe) é recusado de propósito: na
 *   demonstração ele só pode vir da API Java.
 */
final class DadosSimulados {

    /** Funções de leitura usadas pelas telas de OS do Cliente e do Business (mais o cabeçalho e a conversa). */
    static final Set<String> FUNCOES = Set.of("minhas_permissoes", "minhas_empresas", "meus_convites",
            "sou_ck_admin", "conversa_atendimento", "mensagens_novas", "minha_avaliacao_os", "produtos_da_empresa", "painel_empresa");
    /** Escritas inofensivas que as telas fazem ao abrir (marcar mensagens como lidas): respondidas sem gravar nada. */
    static final Set<String> SEM_EFEITO = Set.of("marcar_conversa_lida");
    /** Detalhe da OS: nunca por aqui. */
    // J03 (detalhe) e J04 (listas): na demonstração, essas consultas só vêm da API Java; aqui são recusadas de propósito.
    static final Set<String> SO_PELO_JAVA = Set.of("minha_os", "os_detalhe", "minhas_os", "ordens_da_empresa");
    static final Set<String> TABELAS = Set.of("perfis_identidade", "empresas", "public_empresa_cards");

    private static final ObjectMapper JSON = new ObjectMapper();
    private final BancoDemo banco;
    private final ChavesDemo chaves;
    private final Map<String, Boolean> retornaConjunto = new ConcurrentHashMap<>();
    final List<String> recusadas = java.util.Collections.synchronizedList(new ArrayList<>());

    DadosSimulados(BancoDemo banco, ChavesDemo chaves) {
        this.banco = banco;
        this.chaves = chaves;
    }

    void atender(HttpExchange troca, String caminho) throws IOException {
        String autorizacao = troca.getRequestHeaders().getFirst("Authorization");
        Optional<String> sub = autorizacao != null && autorizacao.startsWith("Bearer ")
                ? chaves.validar(autorizacao.substring(7)) : Optional.empty();
        if (sub.isEmpty()) {
            Http.json(troca, 401, "{\"message\":\"JWT inválido ou ausente\"}");
            return;
        }
        try {
            if (caminho.startsWith("/rpc/") && "POST".equals(troca.getRequestMethod())) {
                rpc(troca, caminho.substring(5), sub.get());
            } else if ("GET".equals(troca.getRequestMethod()) && TABELAS.contains(caminho.substring(1))) {
                tabela(troca, caminho.substring(1), sub.get());
            } else {
                recusar(troca, caminho);
            }
        } catch (SQLException erro) {
            erroDoBanco(troca, erro);
        }
    }

    private void rpc(HttpExchange troca, String funcao, String sub) throws IOException, SQLException {
        if (SO_PELO_JAVA.contains(funcao)) {
            recusadas.add(funcao);
            Http.json(troca, 403, "{\"message\":\"Na demonstração, as ordens de serviço só vêm da API Java.\",\"hint\":\"FORBIDDEN_ACTION\"}");
            return;
        }
        if (SEM_EFEITO.contains(funcao)) {
            Http.json(troca, 200, "null");
            return;
        }
        if (!FUNCOES.contains(funcao)) {
            recusar(troca, "/rpc/" + funcao);
            return;
        }
        JsonNode corpo = JSON.readTree(troca.getRequestBody().readAllBytes());
        List<String> nomes = new ArrayList<>();
        List<JsonNode> valores = new ArrayList<>();
        if (corpo != null && corpo.isObject()) {
            for (Iterator<Map.Entry<String, JsonNode>> it = corpo.fields(); it.hasNext(); ) {
                Map.Entry<String, JsonNode> e = it.next();
                if (!e.getKey().matches("p_[a-z0-9_]{1,40}")) {
                    recusar(troca, "/rpc/" + funcao + " (parâmetro " + e.getKey() + ")");
                    return;
                }
                nomes.add(e.getKey());
                valores.add(e.getValue());
            }
        }
        StringBuilder chamada = new StringBuilder("public.").append(funcao).append('(');
        for (int i = 0; i < nomes.size(); i++) chamada.append(i == 0 ? "" : ", ").append(nomes.get(i)).append(" => ?");
        chamada.append(')');
        try (Connection c = banco.comoApi()) {
            boolean conjunto = retornaConjunto.computeIfAbsent(funcao, f -> conjunto(c, f));
            String sql = conjunto
                    ? "SELECT coalesce(json_agg(t), '[]'::json)::text FROM " + chamada + " t"
                    : "SELECT to_jsonb(" + chamada + ")::text";
            Http.json(troca, 200, consultar(c, sub, sql, valores));
        }
    }

    private void tabela(HttpExchange troca, String tabela, String sub) throws IOException, SQLException {
        Map<String, String> q = Http.consulta(troca.getRequestURI().getRawQuery());
        String colunas = q.getOrDefault("select", "*");
        if (!colunas.equals("*") && !colunas.matches("[a-z_]+(,[a-z_]+)*")) {
            recusar(troca, "/" + tabela + " (select)");
            return;
        }
        StringBuilder sql = new StringBuilder("SELECT ").append(colunas).append(" FROM public.").append(tabela);
        List<JsonNode> valores = new ArrayList<>();
        String ordem = null;
        for (Map.Entry<String, String> e : q.entrySet()) {
            if (e.getKey().equals("select")) continue;
            if (e.getKey().equals("order")) {
                if (!e.getValue().matches("[a-z_]+\\.(asc|desc)")) { recusar(troca, "/" + tabela + " (order)"); return; }
                ordem = e.getValue().replace(".", " ");
                continue;
            }
            if (!e.getKey().matches("[a-z_]+") || !e.getValue().startsWith("eq.")) { recusar(troca, "/" + tabela + " (filtro)"); return; }
            sql.append(valores.isEmpty() ? " WHERE " : " AND ").append(e.getKey()).append(" = ?");
            valores.add(JSON.getNodeFactory().textNode(e.getValue().substring(3)));
        }
        if (ordem != null) sql.append(" ORDER BY ").append(ordem);
        try (Connection c = banco.comoApi()) {
            Http.json(troca, 200, consultar(c, sub, "SELECT coalesce(json_agg(t), '[]'::json)::text FROM (" + sql + ") t", valores));
        }
    }

    /** Transação de leitura com a identidade da demonstração; sempre rollback. */
    private static String consultar(Connection c, String sub, String sql, List<JsonNode> valores) throws SQLException {
        c.setAutoCommit(false);
        try {
            try (Statement s = c.createStatement()) {
                s.execute("SET LOCAL ROLE authenticated");
            }
            try (PreparedStatement p = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
                p.setString(1, BancoDemo.json(Map.of("sub", sub, "role", "authenticated")));
                p.execute();
            }
            try (PreparedStatement p = c.prepareStatement(sql)) {
                for (int i = 0; i < valores.size(); i++) definir(p, i + 1, valores.get(i));
                try (ResultSet r = p.executeQuery()) {
                    r.next();
                    String resultado = r.getString(1);
                    return resultado == null ? "null" : resultado;
                }
            }
        } finally {
            c.rollback();
        }
    }

    private static void definir(PreparedStatement p, int i, JsonNode v) throws SQLException {
        // Tudo como texto "sem tipo" (stringtype=unspecified): o banco resolve uuid, integer, boolean e jsonb pela função.
        if (v == null || v.isNull()) p.setNull(i, Types.OTHER);
        else if (v.isValueNode()) p.setString(i, v.asText());
        else p.setString(i, v.toString());
    }

    private static boolean conjunto(Connection c, String funcao) {
        try (PreparedStatement p = c.prepareStatement("SELECT bool_or(p.proretset) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                + "WHERE n.nspname = 'public' AND p.proname = ?")) {
            p.setString(1, funcao);
            try (ResultSet r = p.executeQuery()) {
                return r.next() && r.getBoolean(1);
            }
        } catch (SQLException erro) {
            return false;
        }
    }

    private void recusar(HttpExchange troca, String oQue) throws IOException {
        recusadas.add(oQue);
        System.out.println("[demo] recusado (fora da lista da demonstração): " + oQue);
        Http.json(troca, 403, "{\"message\":\"Ação não disponível na demonstração local.\",\"hint\":\"FORBIDDEN_ACTION\"}");
    }

    private static void erroDoBanco(HttpExchange troca, SQLException erro) throws IOException {
        ServerErrorMessage m = erro instanceof PSQLException p ? p.getServerErrorMessage() : null;
        String hint = m == null ? null : m.getHint();
        int status = "AUTH_REQUIRED".equals(hint) ? 401 : ("TENANT_FORBIDDEN".equals(hint) || "FORBIDDEN_ACTION".equals(hint)) ? 403 : 400;
        String mensagem = hint == null ? "Falha na consulta da demonstração." : m.getMessage();
        Http.json(troca, status, BancoDemo.json(Map.of("message", mensagem, "hint", hint == null ? "" : hint,
                "details", m == null || m.getDetail() == null ? "" : m.getDetail())));
    }

    static String lerCorpo(HttpExchange troca) throws IOException {
        return new String(troca.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
    }
}
