package br.com.ckgroup.autonick.osapi.dados;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * Chama as funções SQL de consulta de OS com a identidade da pessoa (ADR-J01, J-03 e J-04).
 *
 * Cada consulta roda numa transação: SET LOCAL ROLE authenticated e set_config(..., true) valem só até o fim dela. No
 * commit ou no rollback, a conexão volta ao pool sem papel nem identidade do pedido anterior. Só o "sub" já validado
 * entra nas declarações; nenhum parâmetro do pedido escolhe a identidade. Todo valor vai por parâmetro (sem SQL montado).
 */
@Repository
public class ConsultaOrdensServico {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public ConsultaOrdensServico(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** {@code public.minhas_os()}: só as OS em que a pessoa é a cliente titular. */
    @Transactional
    public String minhasOrdens(String sub) {
        assumirIdentidade(sub);
        return jdbc.queryForObject("SELECT public.minhas_os()::text", String.class);
    }

    /** {@code public.ordens_da_empresa(...)}: exige {@code servicos.visualizar} na empresa; senão, TENANT_FORBIDDEN. */
    @Transactional
    public String ordensDaEmpresa(String sub, UUID empresaId, FiltrosOs filtros, int limite, int deslocamento) {
        assumirIdentidade(sub);
        return jdbc.queryForObject("SELECT public.ordens_da_empresa(?, ?::jsonb, ?, ?)::text", String.class,
                empresaId, paraJson(filtros.comoMapa()), limite, deslocamento);
    }

    @Transactional(readOnly = true)
    public String minhaOrdem(String sub, UUID osId) {
        assumirIdentidade(sub);
        return jdbc.queryForObject("SELECT public.minha_os(?)::text", String.class, osId);
    }

    @Transactional(readOnly = true)
    public String detalheDaEmpresa(String sub, UUID osId) {
        assumirIdentidade(sub);
        return jdbc.queryForObject("SELECT public.os_detalhe(?)::text", String.class, osId);
    }

    private void assumirIdentidade(String sub) {
        jdbc.execute("SET LOCAL ROLE authenticated");
        Map<String, String> claims = new LinkedHashMap<>();
        claims.put("sub", sub);
        claims.put("role", "authenticated");
        jdbc.queryForObject("SELECT set_config('request.jwt.claims', ?, true)", String.class, paraJson(claims));
    }

    private String paraJson(Object valor) {
        try {
            return json.writeValueAsString(valor);
        } catch (JsonProcessingException erro) {
            throw new IllegalStateException("Falha ao montar JSON", erro);
        }
    }

    /** Filtros aceitos por ordens_da_empresa; vazios ficam de fora. */
    public record FiltrosOs(String estado, String responsavel, String busca) {
        Map<String, String> comoMapa() {
            Map<String, String> mapa = new LinkedHashMap<>();
            if (estado != null && !estado.isBlank()) mapa.put("estado", estado);
            if (responsavel != null && !responsavel.isBlank()) mapa.put("responsavel", responsavel);
            if (busca != null && !busca.isBlank()) mapa.put("busca", busca);
            return mapa;
        }
    }
}
