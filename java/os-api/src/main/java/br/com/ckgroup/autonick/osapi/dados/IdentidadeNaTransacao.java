package br.com.ckgroup.autonick.osapi.dados;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Aplica, só dentro da transação corrente, o papel {@code authenticated} e a identidade do token já validado
 * ({@code SET LOCAL} e {@code set_config(..., true)}). No commit ou no rollback, a conexão volta ao pool sem papel nem
 * identidade (testes J2 e T-POOL). Usada pelas escritas da empresa e do Cliente.
 */
final class IdentidadeNaTransacao {

    private IdentidadeNaTransacao() {
    }

    static void assumir(JdbcTemplate jdbc, ObjectMapper json, String sub) {
        jdbc.execute("SET LOCAL ROLE authenticated");
        Map<String, String> claims = new LinkedHashMap<>();
        claims.put("sub", sub);
        claims.put("role", "authenticated");
        try {
            jdbc.queryForObject("SELECT set_config('request.jwt.claims', ?, true)", String.class, json.writeValueAsString(claims));
        } catch (JsonProcessingException erro) {
            throw new IllegalStateException("Falha ao montar JSON", erro);
        }
    }
}
