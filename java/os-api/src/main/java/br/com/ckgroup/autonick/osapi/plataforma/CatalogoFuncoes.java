package br.com.ckgroup.autonick.osapi.plataforma;

import java.sql.Array;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Assinaturas das funções do catálogo ({@link Dominio}), lidas do próprio banco (pg_proc) na primeira chamada de cada
 * uma. Os nomes e tipos vêm do catálogo do PostgreSQL, nunca do pedido: o pedido só fornece VALORES, sempre por
 * parâmetro do JDBC. Função ausente ou com mais de uma assinatura é tratada como indisponível.
 */
@Component
public class CatalogoFuncoes {

    /** Como o resultado volta: valor único (jsonb, boolean...), uma linha composta ou um conjunto de linhas. */
    public enum Retorno { VALOR, LINHA, CONJUNTO }

    public record Parametro(String nome, String tipo, boolean temPadrao) {
    }

    public record Assinatura(String nome, Dominio dominio, Map<String, Parametro> parametros, boolean somenteLeitura,
            Retorno retorno) {

        public boolean temChaveDeOperacao() {
            return parametros.containsKey("p_operation_key");
        }
    }

    private final JdbcTemplate jdbc;
    private final Map<String, Optional<Assinatura>> cache = new ConcurrentHashMap<>();

    public CatalogoFuncoes(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Assinatura> assinatura(String funcao) {
        Optional<Dominio> dominio = Dominio.daFuncao(funcao);
        if (dominio.isEmpty()) return Optional.empty();
        return cache.computeIfAbsent(funcao, f -> ler(f, dominio.get()));
    }

    private Optional<Assinatura> ler(String funcao, Dominio dominio) {
        List<Assinatura> encontradas = jdbc.query("""
                SELECT p.proname, p.proargnames, p.proargmodes, p.pronargs, p.pronargdefaults, p.provolatile, p.proretset,
                       t.typtype = 'c' AS composto,
                       ARRAY(SELECT format_type(a, NULL) FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS u(a, n) ORDER BY n) AS tipos
                FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_type t ON t.oid = p.prorettype
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ? AND p.prokind = 'f'
                """, (r, i) -> {
            String[] nomes = textos(r.getArray("proargnames"));
            String[] modos = textos(r.getArray("proargmodes"));
            String[] tipos = textos(r.getArray("tipos"));
            int total = r.getInt("pronargs");
            int comPadrao = r.getInt("pronargdefaults");
            List<String> nomesEntrada = new ArrayList<>();
            for (int k = 0; k < (nomes == null ? 0 : nomes.length); k++) {
                String modo = modos == null ? "i" : modos[k];
                if (modo.equals("i") || modo.equals("b") || modo.equals("v")) nomesEntrada.add(nomes[k]);
            }
            Map<String, Parametro> parametros = new LinkedHashMap<>();
            if (nomesEntrada.size() == total) {
                for (int k = 0; k < total; k++) {
                    parametros.put(nomesEntrada.get(k), new Parametro(nomesEntrada.get(k), tipos[k], k >= total - comPadrao));
                }
            } else if (total > 0) {
                return null; // parâmetro sem nome: não pode ser chamado por nome
            }
            Retorno retorno = r.getBoolean("proretset") ? Retorno.CONJUNTO : r.getBoolean("composto") ? Retorno.LINHA : Retorno.VALOR;
            boolean leitura = !"v".equals(r.getString("provolatile"));
            return new Assinatura(funcao, dominio, Map.copyOf(parametros), leitura, retorno);
        }, funcao);
        if (encontradas.size() != 1 || encontradas.get(0) == null) return Optional.empty();
        return Optional.of(encontradas.get(0));
    }

    private static String[] textos(Array array) throws java.sql.SQLException {
        if (array == null) return null;
        Object valor = array.getArray();
        if (valor instanceof String[] s) return s;
        Object[] objetos = (Object[]) valor;
        String[] saida = new String[objetos.length];
        for (int i = 0; i < objetos.length; i++) saida[i] = String.valueOf(objetos[i]);
        return saida;
    }
}
