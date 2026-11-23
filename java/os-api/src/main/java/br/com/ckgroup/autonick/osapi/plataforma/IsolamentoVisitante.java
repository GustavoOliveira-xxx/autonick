package br.com.ckgroup.autonick.osapi.plataforma;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Demonstração PÚBLICA: o visitante só alcança as empresas do PRÓPRIO cenário. Complementa (não substitui) as regras do
 * app, que já isolam empresa e identidade: aqui se fecha o único espaço compartilhado entre visitantes, a vitrine de
 * demonstração (todas as empresas fictícias aprovadas aparecem para todo cliente fictício autorizado).
 * <ul>
 *   <li>antes da função: {@code p_empresa_id} precisa ser do cenário; na solicitação, a empresa do serviço também;</li>
 *   <li>depois: a busca da vitrine e a lista de empresas para pedido só trazem empresas do cenário;</li>
 *   <li>leituras de tabela filtradas por empresa só com empresas do cenário.</li>
 * </ul>
 * Fechado por padrão: uma identidade autenticada sem cenário de visitante (cadastro, cenário fixo no mesmo banco ou
 * falha ao ler o cenário) é recusada. A montagem interna do cenário usa caminhos próprios que não passam por aqui.
 */
public class IsolamentoVisitante {

    private record Escopo(UUID cenario, Set<String> empresas, long lidoEm) {
    }

    private static final long VALIDADE_MS = 30_000;
    private static final ErroDados FORA = ErroDados.regra(HttpStatus.FORBIDDEN, "TENANT_FORBIDDEN",
            "Na demonstração pública, você só acessa as empresas fictícias da sua visita.");

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final Clock relogio;
    private final Map<String, Escopo> escopos = new ConcurrentHashMap<>();

    public IsolamentoVisitante(JdbcTemplate jdbc, ObjectMapper json, Clock relogio) {
        this.jdbc = jdbc;
        this.json = json;
        this.relogio = relogio;
    }

    private Optional<Escopo> escopo(Identidade quem) {
        return escopo(quem, false);
    }

    /** Pessoa autenticada sem cenário de visitante não usa a demonstração pública. */
    public void exigirCenario(Identidade quem) {
        if (!quem.anonima() && escopo(quem).isEmpty()) throw FORA;
    }

    /** Escopo do visitante; {@code reler}: ignora o que está na memória (empresa criada há pouco no cenário). */
    private Optional<Escopo> escopo(Identidade quem, boolean reler) {
        if (quem.anonima()) return Optional.empty();
        long agora = relogio.millis();
        Escopo atual = escopos.get(quem.sub());
        if (!reler && atual != null && agora - atual.lidoEm() < VALIDADE_MS) return Optional.ofNullable(atual.cenario() == null ? null : atual);
        UUID cenario;
        try {
            List<UUID> c = jdbc.queryForList("SELECT cenario FROM demo_auth.contas WHERE id = ?::uuid", UUID.class, quem.sub());
            cenario = c.isEmpty() ? null : c.get(0);
        } catch (RuntimeException erro) {
            throw FORA;
        }
        Set<String> empresas = cenario == null ? Set.of() : Set.copyOf(jdbc.queryForList(
                "SELECT empresa_id::text FROM demo_auth.empresas_cenario WHERE cenario = ?", String.class, cenario));
        if (escopos.size() > 20_000) escopos.clear();
        Escopo novo = new Escopo(cenario, empresas, agora);
        escopos.put(quem.sub(), novo);
        return Optional.ofNullable(cenario == null ? null : novo);
    }

    /** Antes de chamar a função. */
    public void conferirChamada(Identidade quem, String funcao, JsonNode corpo) {
        if (quem.anonima()) return;
        exigirCenario(quem);
        if (corpo == null || !corpo.isObject()) return;
        JsonNode empresa = corpo.get("p_empresa_id");
        if (empresa != null && !empresa.isNull() && !permitida(quem, List.of(empresa.asText()))) throw FORA;
        if (funcao.equals("criar_solicitacao") && corpo.hasNonNull("p_servico_id")) {
            List<String> dona = jdbc.queryForList("SELECT demo_auth.empresa_do_servico(?::uuid)::text", String.class, corpo.get("p_servico_id").asText());
            if (dona.isEmpty() || dona.get(0) == null || !permitida(quem, List.of(dona.get(0)))) throw FORA;
        }
    }

    /** Depois da função: tira da resposta as empresas de outros cenários. */
    public String filtrarResultado(Identidade quem, String funcao, String resultado) {
        if (!funcao.equals("buscar_demonstracao") && !funcao.equals("empresas_para_pedido")) return resultado;
        Optional<Escopo> e = escopo(quem);
        if (e.isEmpty()) return resultado;
        Set<String> minhas = e.get().empresas();
        try {
            JsonNode raiz = json.readTree(resultado);
            if (funcao.equals("empresas_para_pedido") && raiz.isArray()) {
                return json.writeValueAsString(filtrar((ArrayNode) raiz, "id", minhas));
            }
            if (raiz.isObject() && raiz.get("itens") instanceof ArrayNode itens) {
                ArrayNode filtrados = filtrar(itens, "empresa_id", minhas);
                ((ObjectNode) raiz).set("itens", filtrados);
                ((ObjectNode) raiz).put("total", filtrados.size());
                ((ObjectNode) raiz).put("ha_mais", false);
                ((ObjectNode) raiz).put("mais_de_100", false);
            }
            return json.writeValueAsString(raiz);
        } catch (Exception erro) {
            throw new IllegalStateException("Falha ao filtrar a vitrine da demonstração", erro);
        }
    }

    /** Leitura de tabela filtrada por empresa: só empresas do cenário. */
    public void conferirTabela(Identidade quem, String tabela, String coluna, List<String> valores) {
        boolean porEmpresa = coluna.equals("empresa_id") || (coluna.equals("id") && tabela.equals("empresas"));
        if (porEmpresa && !permitida(quem, valores)) throw FORA;
    }

    private boolean permitida(Identidade quem, List<String> empresas) {
        Optional<Escopo> e = escopo(quem);
        if (e.isEmpty()) return false;
        if (e.get().empresas().containsAll(empresas)) return true;
        return escopo(quem, true).map(n -> n.empresas().containsAll(empresas)).orElse(false);
    }

    private static ArrayNode filtrar(ArrayNode lista, String campo, Set<String> minhas) {
        ArrayNode saida = lista.arrayNode();
        lista.forEach(item -> {
            if (minhas.contains(item.path(campo).asText())) saida.add(item);
        });
        return saida;
    }
}
