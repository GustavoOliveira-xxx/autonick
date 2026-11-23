package br.com.ckgroup.autonick.osapi.dados;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Checagens compartilhadas pelas escritas da empresa (J05 a J10) e do Cliente (J08), sempre DENTRO da transação da
 * escrita e com a identidade já assumida (ver {@link IdentidadeNaTransacao}).
 */
final class ChecagensNaTransacao {

    private ChecagensNaTransacao() {
    }

    /**
     * ADR-J02, E-04: antes de chamar a função (que devolve o resultado guardado de uma chave repetida ANTES de conferir a
     * permissão), confirma com a identidade atual que a pessoa vê a OS e tem {@code servicos.alterar}. Sem acesso à OS, a
     * própria leitura falha (NOT_FOUND, TENANT_FORBIDDEN ou FORBIDDEN_ACTION); sem a permissão, recusa aqui.
     */
    static void exigirPodeAlterar(JdbcTemplate jdbc, UUID osId) {
        Boolean podeAlterar = jdbc.queryForObject("SELECT (public.os_detalhe(?) -> 'pode' ->> 'alterar')::boolean", Boolean.class, osId);
        if (!Boolean.TRUE.equals(podeAlterar)) throw new AcoesOrdensServico.SemPermissaoParaAlterar();
    }

    /** Leitura nova da empresa, autorizada de novo na mesma transação: nunca o resultado guardado de uma repetição. */
    static String detalheAutorizado(JdbcTemplate jdbc, UUID osId) {
        return jdbc.queryForObject("""
                SELECT d::text, coalesce((d #>> '{pode,alterar}')::boolean, false) AS pode_alterar
                FROM public.os_detalhe(?) AS detalhe(d)
                """, (r, linha) -> {
            if (!r.getBoolean("pode_alterar")) throw new AcoesOrdensServico.SemPermissaoParaAlterar();
            return r.getString(1);
        }, osId);
    }

    /**
     * Se a transação já gravou ou travou alguma linha: o PostgreSQL só atribui identificador de transação quando há
     * escrita (inclusive {@code SELECT ... FOR UPDATE}). Leituras, {@code SET LOCAL} e o bloqueio consultivo da chave não
     * atribuem. Base do controle de versão das funções que não recebem versão esperada (J8-1 = A; J10 na garantia).
     */
    static boolean gravouNestaTransacao(JdbcTemplate jdbc) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT pg_current_xact_id_if_assigned() IS NOT NULL", Boolean.class));
    }
}
