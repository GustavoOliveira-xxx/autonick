package br.com.ckgroup.autonick.osapi.plataforma;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Executa as operações do catálogo ({@link Dominio}) no PostgreSQL, uma transação por pedido:
 * <ol>
 *   <li>função fora do catálogo, visitante anônimo fora da vitrine pública ou função bloqueada na demonstração pública:
 *   recusa sem tocar o banco;</li>
 *   <li>parâmetros: só os nomes da assinatura lida do banco; obrigatórios presentes; chave de operação válida;</li>
 *   <li>transação SOMENTE LEITURA para funções STABLE/IMMUTABLE; tempo máximo por comando;</li>
 *   <li>{@code SET LOCAL ROLE} e {@code request.jwt.claims} só com o "sub" do token validado: no fim da transação a
 *   conexão volta ao pool sem papel nem identidade;</li>
 *   <li>painel CK: confere {@code sou_ck_admin()} com a identidade do pedido antes da função (que confere de novo);</li>
 *   <li>a função SQL aplica permissões, RLS, versão, estado e idempotência; o resultado volta como JSON.</li>
 * </ol>
 */
@Component
public class ExecutorDados {

    private static final Pattern IDENTIFICADOR = Pattern.compile("[a-z_][a-z0-9_]{0,62}");
    private static final int TAMANHO_MAXIMO_CHAVE = 200;

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final CatalogoFuncoes catalogo;
    private final PoliticaDados politica;
    private final TransactionTemplate escrita;
    private final TransactionTemplate leitura;
    private final IsolamentoVisitante isolamento;

    public ExecutorDados(JdbcTemplate jdbc, ObjectMapper json, CatalogoFuncoes catalogo, PoliticaDados politica,
            PlatformTransactionManager transacoes, java.util.Optional<IsolamentoVisitante> isolamento) {
        this.isolamento = isolamento.orElse(null);
        this.jdbc = jdbc;
        this.json = json;
        this.catalogo = catalogo;
        this.politica = politica;
        this.escrita = new TransactionTemplate(transacoes);
        this.leitura = new TransactionTemplate(transacoes);
        this.leitura.setReadOnly(true);
    }

    /** Assinatura da função, já conferindo catálogo, papel e política (sem tocar dados). */
    public CatalogoFuncoes.Assinatura autorizarChamada(Identidade quem, String funcao) {
        if (!IDENTIFICADOR.matcher(funcao).matches()) throw ErroDados.indisponivel(funcao);
        Dominio dominio = Dominio.daFuncao(funcao).orElseThrow(() -> ErroDados.indisponivel(funcao));
        if (quem.anonima() && !dominio.publico) {
            throw ErroDados.regra(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "Entre para continuar.");
        }
        if (politica.bloqueada(dominio, funcao)) {
            throw ErroDados.regra(HttpStatus.FORBIDDEN, "FORBIDDEN_ACTION", "Esta ação não está disponível na demonstração pública.");
        }
        return catalogo.assinatura(funcao).orElseThrow(() -> ErroDados.indisponivel(funcao));
    }

    /**
     * Chama a função com os parâmetros do corpo (objeto JSON). {@code objeto}: a tela pediu uma única linha.
     * Devolve o JSON da resposta.
     */
    public String chamar(Identidade quem, CatalogoFuncoes.Assinatura assinatura, JsonNode corpo, boolean objeto) {
        if (isolamento == null) return executar(quem, assinatura, corpo, objeto);
        isolamento.conferirChamada(quem, assinatura.nome(), corpo);
        return isolamento.filtrarResultado(quem, assinatura.nome(), executar(quem, assinatura, corpo, objeto));
    }

    private String executar(Identidade quem, CatalogoFuncoes.Assinatura assinatura, JsonNode corpo, boolean objeto) {
        List<String> nomes = new ArrayList<>();
        List<JsonNode> valores = new ArrayList<>();
        validarParametros(assinatura, corpo, nomes, valores);

        StringBuilder chamada = new StringBuilder("public.").append(assinatura.nome()).append('(');
        for (int i = 0; i < nomes.size(); i++) {
            CatalogoFuncoes.Parametro p = assinatura.parametros().get(nomes.get(i));
            chamada.append(i == 0 ? "" : ", ").append(p.nome()).append(" => ?::").append(p.tipo());
        }
        chamada.append(')');
        String sql = switch (assinatura.retorno()) {
            case VALOR -> "SELECT to_jsonb(" + chamada + ")::text";
            case LINHA -> "SELECT to_jsonb(t)::text FROM " + chamada + " AS t";
            case CONJUNTO -> "SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text FROM " + chamada + " AS t";
        };
        List<CatalogoFuncoes.Parametro> tipos = nomes.stream().map(assinatura.parametros()::get).toList();
        String resultado = emTransacao(quem, assinatura.somenteLeitura(), () -> {
            if (Dominio.exigeCk(assinatura.nome())) exigirCk();
            return jdbc.query(sql, (PreparedStatement ps) -> {
                for (int i = 0; i < valores.size(); i++) vincular(ps, i + 1, tipos.get(i), valores.get(i));
            }, (ResultSet r) -> r.next() ? r.getString(1) : "null");
        });
        if (objeto && assinatura.retorno() == CatalogoFuncoes.Retorno.CONJUNTO) return unicaLinha(resultado);
        return resultado == null ? "null" : resultado;
    }

    /**
     * Uso INTERNO da API (montagem do cenário de demonstração): mesma função, mesma transação e mesma identidade de
     * um pedido, sem a política da demonstração pública (a montagem usa a CK interna para aprovar cartões).
     */
    public JsonNode chamarInterno(Identidade quem, String funcao, JsonNode corpo) {
        CatalogoFuncoes.Assinatura assinatura = catalogo.assinatura(funcao).orElseThrow(() -> ErroDados.indisponivel(funcao));
        try {
            return json.readTree(executar(quem, assinatura, corpo, false));
        } catch (JsonProcessingException erro) {
            throw new IllegalStateException(erro);
        }
    }

    /** Isolamento da demonstração pública (nulo fora dela). */
    IsolamentoVisitante isolamento() {
        return isolamento;
    }

    /** Transação do pedido com papel e identidade aplicados só nela. */
    public <T> T emTransacao(Identidade quem, boolean somenteLeitura, java.util.function.Supplier<T> trabalho) {
        TransactionTemplate tx = somenteLeitura ? leitura : escrita;
        return tx.execute(status -> {
            if (somenteLeitura) jdbc.execute("SET TRANSACTION READ ONLY");
            jdbc.execute("SET LOCAL statement_timeout = " + Math.max(1000, politica.tempoMaximoComando().toMillis()));
            jdbc.execute("SET LOCAL ROLE " + quem.papel());
            jdbc.queryForObject("SELECT set_config('request.jwt.claims', ?, true)", String.class, texto(quem.claims()));
            return trabalho.get();
        });
    }

    /** Confere, com a identidade já aplicada na transação, que a pessoa é da administração CK. */
    void exigirCk() {
        Boolean ck = jdbc.queryForObject("SELECT public.sou_ck_admin()", Boolean.class);
        if (!Boolean.TRUE.equals(ck)) {
            throw ErroDados.regra(HttpStatus.FORBIDDEN, "FORBIDDEN_ACTION", "Esta área é só da administração CK.");
        }
    }

    private void validarParametros(CatalogoFuncoes.Assinatura assinatura, JsonNode corpo, List<String> nomes, List<JsonNode> valores) {
        if (corpo != null && !corpo.isNull() && !corpo.isObject()) throw ErroDados.validacao(ErroDados.CONFIRA);
        if (corpo != null && corpo.isObject()) {
            for (Iterator<Map.Entry<String, JsonNode>> it = corpo.fields(); it.hasNext(); ) {
                Map.Entry<String, JsonNode> e = it.next();
                if (!assinatura.parametros().containsKey(e.getKey())) {
                    throw ErroDados.validacao("Parâmetro não reconhecido: " + e.getKey() + ".");
                }
                nomes.add(e.getKey());
                valores.add(e.getValue());
            }
        }
        for (CatalogoFuncoes.Parametro p : assinatura.parametros().values()) {
            if (!p.temPadrao() && !nomes.contains(p.nome())) throw ErroDados.validacao("Parâmetro obrigatório ausente: " + p.nome() + ".");
        }
        if (assinatura.temChaveDeOperacao()) {
            int i = nomes.indexOf("p_operation_key");
            JsonNode chave = i < 0 ? null : valores.get(i);
            if (chave != null && !chave.isNull() && (!chave.isTextual() || chave.asText().isBlank() || chave.asText().length() > TAMANHO_MAXIMO_CHAVE)) {
                throw ErroDados.validacao("Chave de operação inválida.");
            }
        }
    }

    private static void vincular(PreparedStatement ps, int posicao, CatalogoFuncoes.Parametro p, JsonNode valor) throws java.sql.SQLException {
        if (valor == null || valor.isNull()) {
            ps.setNull(posicao, Types.VARCHAR);
            return;
        }
        String tipo = p.tipo();
        if (tipo.equals("jsonb") || tipo.equals("json")) {
            ps.setString(posicao, valor.toString());
        } else if (tipo.endsWith("[]")) {
            if (!valor.isArray()) throw ErroDados.validacao("Lista esperada em " + p.nome() + ".");
            ps.setString(posicao, literalDeLista(valor));
        } else if (valor.isContainerNode()) {
            throw ErroDados.validacao("Valor inválido em " + p.nome() + ".");
        } else {
            ps.setString(posicao, escalar(valor));
        }
    }

    private static String escalar(JsonNode valor) {
        if (valor.isFloatingPointNumber()) return valor.decimalValue().toPlainString();
        return valor.asText();
    }

    /** Literal de array do PostgreSQL com cada elemento entre aspas (nunca concatenado no SQL: vai por parâmetro). */
    static String literalDeLista(JsonNode lista) {
        StringBuilder s = new StringBuilder("{");
        for (int i = 0; i < lista.size(); i++) {
            JsonNode e = lista.get(i);
            if (i > 0) s.append(',');
            if (e == null || e.isNull()) {
                s.append("NULL");
            } else if (e.isContainerNode()) {
                throw ErroDados.validacao("Lista com valor inválido.");
            } else {
                s.append('"').append(escalar(e).replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
            }
        }
        return s.append('}').toString();
    }

    private String unicaLinha(String conjunto) {
        try {
            JsonNode linhas = json.readTree(conjunto);
            if (!linhas.isArray() || linhas.size() != 1) {
                throw new ErroDados(HttpStatus.NOT_ACCEPTABLE, "PGRST116", "Era esperada uma única linha.", null, null);
            }
            return linhas.get(0).toString();
        } catch (JsonProcessingException erro) {
            throw new IllegalStateException(erro);
        }
    }

    private String texto(Object valor) {
        try {
            return json.writeValueAsString(valor);
        } catch (JsonProcessingException erro) {
            throw new IllegalStateException(erro);
        }
    }
}
