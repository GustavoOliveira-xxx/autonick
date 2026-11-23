package br.com.ckgroup.autonick.osapi.plataforma;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Leituras de tabela usadas pelas telas, num subconjunto FECHADO do formato de consulta da Data API:
 * {@code select=col,col,relacao(col)} ou {@code *}; filtros {@code eq.}, {@code in.(...)} e {@code is.true|false|null};
 * {@code order=col.asc|desc}. Só as tabelas de {@link #TABELAS}. Nomes de coluna são conferidos no catálogo do banco;
 * valores vão sempre por parâmetro, convertidos para o tipo da coluna. A visibilidade de linhas e colunas continua no
 * banco: RLS e GRANT por coluna valem com o papel e a identidade do pedido. No máximo {@value #LIMITE} linhas.
 */
@Component
public class ConsultaTabelas {

    static final int LIMITE = 1000;

    /** Tabela → relações que podem vir embutidas (filhas com chave estrangeira simples para esta tabela). */
    static final Map<String, Set<String>> TABELAS = Map.ofEntries(
            Map.entry("perfis_identidade", Set.of()),
            Map.entry("categorias_plataforma", Set.of()),
            Map.entry("empresas", Set.of()),
            Map.entry("public_empresa_cards", Set.of()),
            Map.entry("eventos_publicacao", Set.of()),
            Map.entry("solicitacoes_publicacao", Set.of()),
            Map.entry("contestacoes", Set.of()),
            Map.entry("moderacoes_vitrine", Set.of()),
            Map.entry("fornecedores", Set.of()),
            Map.entry("historico_precos", Set.of()),
            Map.entry("permissoes_catalogo", Set.of()),
            Map.entry("perfis_permissao", Set.of("perfil_permissoes")),
            Map.entry("convites_empresa", Set.of()));

    /** Tabelas com dados do painel CK: a API exige ser CK para lê-las sem filtro de empresa. */
    static final Set<String> FILAS_CK = Set.of("solicitacoes_publicacao", "moderacoes_vitrine", "contestacoes");

    private static final Pattern NOME = Pattern.compile("[a-z_][a-z0-9_]{0,62}");
    private static final Pattern EMBUTIDA = Pattern.compile("([a-z_][a-z0-9_]{0,62})\\(([a-z0-9_,]+)\\)");
    private static final Pattern ORDEM = Pattern.compile("([a-z_][a-z0-9_]{0,62})\\.(asc|desc)(\\.(nullsfirst|nullslast))?");

    private record Embutida(String relacao, String colunaFilha, String colunaMae, List<String> colunas) {
    }

    private final JdbcTemplate jdbc;
    private final ExecutorDados executor;
    private final PoliticaDados politica;
    private final ObjectMapper json;
    private final Map<String, Map<String, String>> colunas = new ConcurrentHashMap<>();

    public ConsultaTabelas(JdbcTemplate jdbc, ExecutorDados executor, PoliticaDados politica,
            ObjectMapper json) {
        this.json = json;
        this.jdbc = jdbc;
        this.executor = executor;
        this.politica = politica;
    }

    /** Leitura de um pedido da PWA (com o isolamento da demonstração pública, quando ativo). */
    public String consultar(Identidade quem, String tabela, String consultaBruta, boolean objeto) {
        return consultar(quem, tabela, consultaBruta, objeto, executor.isolamento());
    }

    /** Uso INTERNO da API (montagem do cenário de demonstração): mesma leitura, sem o isolamento entre visitantes. */
    public String consultarInterno(Identidade quem, String tabela, String consultaBruta) {
        return consultar(quem, tabela, consultaBruta, false, null);
    }

    private String consultar(Identidade quem, String tabela, String consultaBruta, boolean objeto, IsolamentoVisitante isolamento) {
        if (quem.anonima()) throw ErroDados.regra(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "Entre para continuar.");
        if (!TABELAS.containsKey(tabela)) throw ErroDados.indisponivel(NOME.matcher(tabela).matches() ? tabela : "tabela");
        if (isolamento != null) isolamento.exigirCenario(quem);
        List<String[]> parametros = parametros(consultaBruta);
        Map<String, String> tipos = colunas(tabela);

        String selecao = "*";
        List<Embutida> embutidas = new ArrayList<>();
        List<String> filtros = new ArrayList<>();
        List<String> valores = new ArrayList<>();
        String ordem = null;
        boolean temFiltroEmpresa = false;
        for (String[] p : parametros) {
            String chave = p[0];
            String valor = p[1];
            switch (chave) {
                case "select" -> selecao = selecao(tabela, valor, tipos, embutidas);
                case "order" -> ordem = ordem(valor, tipos);
                default -> {
                    if (!NOME.matcher(chave).matches() || !tipos.containsKey(chave)) throw ErroDados.validacao("Filtro inválido: " + chave + ".");
                    Filtro f = filtro(chave, tipos.get(chave), valor);
                    filtros.add(f.sql());
                    if (f.parametro() != null) valores.add(f.parametro());
                    if (isolamento != null && !f.comparados().isEmpty()) isolamento.conferirTabela(quem, tabela, chave, f.comparados());
                    if (chave.equals("empresa_id") || chave.equals("id") || chave.equals("variacao_id")) temFiltroEmpresa = true;
                }
            }
        }
        boolean exigeCk = FILAS_CK.contains(tabela) && !temFiltroEmpresa;
        if (exigeCk && politica.demonstracaoPublica()) {
            throw ErroDados.regra(HttpStatus.FORBIDDEN, "FORBIDDEN_ACTION", "Esta ação não está disponível na demonstração pública.");
        }

        StringBuilder sql = new StringBuilder("SELECT ").append(selecao);
        for (Embutida e : embutidas) {
            StringBuilder objetoJson = new StringBuilder("jsonb_build_object(");
            for (int i = 0; i < e.colunas().size(); i++) {
                String c = e.colunas().get(i);
                objetoJson.append(i == 0 ? "" : ", ").append('\'').append(c).append("', e.\"").append(c).append('"');
            }
            objetoJson.append(')');
            sql.append(", (SELECT coalesce(jsonb_agg(").append(objetoJson).append("), '[]'::jsonb) FROM public.\"").append(e.relacao())
                    .append("\" AS e WHERE e.\"").append(e.colunaFilha()).append("\" = t.\"").append(e.colunaMae()).append("\") AS \"")
                    .append(e.relacao()).append('"');
        }
        sql.append(" FROM public.\"").append(tabela).append("\" AS t");
        if (!filtros.isEmpty()) sql.append(" WHERE ").append(String.join(" AND ", filtros));
        if (ordem != null) sql.append(" ORDER BY ").append(ordem);
        sql.append(" LIMIT ").append(LIMITE);
        String completo = "SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)::text FROM (" + sql + ") AS q";

        String resultado = executor.emTransacao(quem, true, () -> {
            if (exigeCk) executor.exigirCk();
            return jdbc.query(completo, (PreparedStatement ps) -> {
                for (int i = 0; i < valores.size(); i++) ps.setString(i + 1, valores.get(i));
            }, (ResultSet r) -> r.next() ? r.getString(1) : "[]");
        });
        if (!objeto) return resultado;
        try {
            JsonNode linhas = json.readTree(resultado);
            if (linhas.size() != 1) throw new ErroDados(HttpStatus.NOT_ACCEPTABLE, "PGRST116", "Era esperada uma única linha.", null, null);
            return linhas.get(0).toString();
        } catch (com.fasterxml.jackson.core.JsonProcessingException erro) {
            throw new IllegalStateException(erro);
        }
    }

    private String selecao(String tabela, String valor, Map<String, String> tipos, List<Embutida> embutidas) {
        if (valor.equals("*")) return "t.*";
        List<String> partes = dividir(valor);
        List<String> simples = new ArrayList<>();
        for (String parte : partes) {
            Matcher m = EMBUTIDA.matcher(parte);
            if (m.matches()) {
                String relacao = m.group(1);
                if (!TABELAS.get(tabela).contains(relacao)) throw ErroDados.validacao("Relação não disponível: " + relacao + ".");
                embutidas.add(embutida(tabela, relacao, List.of(m.group(2).split(","))));
            } else if (NOME.matcher(parte).matches() && tipos.containsKey(parte)) {
                simples.add("t.\"" + parte + '"');
            } else {
                throw ErroDados.validacao("Coluna inválida: " + parte + ".");
            }
        }
        if (simples.isEmpty()) throw ErroDados.validacao("Informe as colunas.");
        return String.join(", ", simples);
    }

    private Embutida embutida(String tabela, String relacao, List<String> cols) {
        Map<String, String> tiposFilha = colunas(relacao);
        for (String c : cols) {
            if (!NOME.matcher(c).matches() || !tiposFilha.containsKey(c)) throw ErroDados.validacao("Coluna inválida: " + c + ".");
        }
        List<String[]> chaves = jdbc.query("""
                SELECT af.attname, am.attname
                FROM pg_catalog.pg_constraint k
                JOIN pg_catalog.pg_attribute af ON af.attrelid = k.conrelid AND af.attnum = k.conkey[1]
                JOIN pg_catalog.pg_attribute am ON am.attrelid = k.confrelid AND am.attnum = k.confkey[1]
                WHERE k.contype = 'f' AND cardinality(k.conkey) = 1
                  AND k.conrelid = (SELECT oid FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ?)
                  AND k.confrelid = (SELECT oid FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ?)
                """, (r, i) -> new String[] {r.getString(1), r.getString(2)}, relacao, tabela);
        if (chaves.size() != 1) throw ErroDados.validacao("Relação não disponível: " + relacao + ".");
        return new Embutida(relacao, chaves.get(0)[0], chaves.get(0)[1], cols);
    }

    private static String ordem(String valor, Map<String, String> tipos) {
        List<String> saida = new ArrayList<>();
        for (String parte : valor.split(",")) {
            Matcher m = ORDEM.matcher(parte);
            if (!m.matches() || !tipos.containsKey(m.group(1))) throw ErroDados.validacao("Ordenação inválida.");
            String nulos = m.group(4) == null ? "" : m.group(4).equals("nullsfirst") ? " NULLS FIRST" : " NULLS LAST";
            saida.add('"' + m.group(1) + "\" " + m.group(2).toUpperCase() + nulos);
        }
        return String.join(", ", saida);
    }

    /** Trecho SQL de um filtro, o valor que vai por parâmetro (se houver) e os valores comparados com a coluna. */
    private record Filtro(String sql, String parametro, List<String> comparados) {
    }

    private static Filtro filtro(String coluna, String tipo, String valor) {
        String c = "t.\"" + coluna + '"';
        if (valor.startsWith("eq.")) {
            String comparado = valor.substring(3);
            return new Filtro(c + " = ?::" + tipo, comparado, List.of(comparado));
        }
        if (valor.startsWith("in.(") && valor.endsWith(")")) {
            List<String> itens = dividir(valor.substring(4, valor.length() - 1));
            if (itens.isEmpty() || itens.size() > 200) throw ErroDados.validacao("Filtro inválido: " + coluna + ".");
            ArrayNode lista = JsonNodeFactory.instance.arrayNode();
            itens.forEach(lista::add);
            return new Filtro(c + " = ANY(?::" + tipo + "[])", ExecutorDados.literalDeLista(lista), itens);
        }
        String sql = switch (valor) {
            case "is.true" -> c + " IS TRUE";
            case "is.false" -> c + " IS FALSE";
            case "is.null" -> c + " IS NULL";
            default -> throw ErroDados.validacao("Filtro inválido: " + coluna + ".");
        };
        return new Filtro(sql, null, List.of());
    }

    private static List<String> dividir(String texto) {
        List<String> partes = new ArrayList<>();
        int nivel = 0;
        StringBuilder atual = new StringBuilder();
        for (char ch : texto.toCharArray()) {
            if (ch == '(') nivel++;
            if (ch == ')') nivel--;
            if (ch == ',' && nivel == 0) {
                partes.add(atual.toString().trim());
                atual.setLength(0);
            } else {
                atual.append(ch);
            }
        }
        if (!atual.isEmpty()) partes.add(atual.toString().trim());
        partes.removeIf(String::isEmpty);
        return partes;
    }

    private static List<String[]> parametros(String bruta) {
        List<String[]> saida = new ArrayList<>();
        if (bruta == null || bruta.isBlank()) return saida;
        if (bruta.length() > 8192) throw ErroDados.validacao("Consulta longa demais.");
        for (String par : bruta.split("&")) {
            if (par.isEmpty()) continue;
            int i = par.indexOf('=');
            if (i <= 0) throw ErroDados.validacao("Consulta inválida.");
            saida.add(new String[] {decodificar(par.substring(0, i)), decodificar(par.substring(i + 1))});
        }
        return saida;
    }

    private static String decodificar(String s) {
        return URLDecoder.decode(s, StandardCharsets.UTF_8);
    }

    /** Colunas e tipos da tabela, do catálogo do banco. */
    private Map<String, String> colunas(String tabela) {
        return colunas.computeIfAbsent(tabela, t -> {
            Map<String, String> mapa = new LinkedHashMap<>();
            jdbc.query("""
                    SELECT a.attname, format_type(a.atttypid, NULL)
                    FROM pg_catalog.pg_attribute a
                    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
                    WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ? AND a.attnum > 0 AND NOT a.attisdropped
                    ORDER BY a.attnum
                    """, (ResultSet r) -> {
                mapa.put(r.getString(1), r.getString(2));
            }, t);
            if (mapa.isEmpty()) throw ErroDados.indisponivel(t);
            return Map.copyOf(mapa);
        });
    }
}
