package br.com.ckgroup.autonick.osapi.dados;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * Escritas da empresa sobre o estado da OS (ADR-J02): iniciar (J05), pausar e retomar (J06),
 * informar a conclusão (J07), reabrir para revisão e encerrar (J09). Todas chamam
 * {@code public.mudar_estado_os} com a ação vinda de uma CONSTANTE desta classe; nada no pedido escolhe a ação.
 * Permissão, versão esperada, estado, histórico, auditoria e idempotência pela chave continuam na função SQL.
 *
 * Disciplina de cada pedido: uma transação; {@code SET LOCAL ROLE authenticated} e {@code set_config(..., true)} só com
 * o "sub" validado; no commit ou no rollback, a conexão volta ao pool limpa (teste T-POOL).
 *
 * Checagem prévia (ADR-J02, E-04): a função SQL devolve o resultado guardado de uma chave repetida ANTES de checar a
 * permissão. Para não devolver esse resultado a quem perdeu o acesso, a mesma transação primeiro lê
 * {@code os_detalhe(os)->'pode'->>'alterar'} com a identidade atual: sem acesso à OS, a função de leitura falha
 * (NOT_FOUND, TENANT_FORBIDDEN ou FORBIDDEN_ACTION); sem {@code servicos.alterar}, esta classe recusa. Só então a ação
 * (ou a repetição) é chamada. Pausar e Retomar só devolvem uma leitura fresca, novamente autorizada na mesma
 * transação. Assim uma repetição não expõe dados que deixaram de ser visíveis depois da operação original.
 */
@Repository
public class AcoesOrdensServico {

    /** Ações aceitas por esta API; o texto vai como constante para a função SQL. */
    public enum Acao {
        INICIAR("iniciar"), PAUSAR("pausar"), RETOMAR("retomar"), CONCLUIR("concluir"), REABRIR("reabrir"), ENCERRAR("encerrar");

        final String sql;

        Acao(String sql) {
            this.sql = sql;
        }
    }

    /** A pessoa vê a OS, mas não tem {@code servicos.alterar} agora. */
    public static final class SemPermissaoParaAlterar extends RuntimeException {
        public SemPermissaoParaAlterar() {
            super("Seu acesso não permite esta ação nesta empresa.");
        }
    }

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public AcoesOrdensServico(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional
    public String iniciar(String sub, UUID osId, int versaoEsperada, String chaveOperacao) {
        return mudarEstado(sub, osId, Acao.INICIAR, null, versaoEsperada, chaveOperacao);
    }

    /** O motivo fica só para a equipe (evento interno); o cliente vê apenas a pausa (evento público sem o motivo). */
    @Transactional
    public String pausar(String sub, UUID osId, String motivo, int versaoEsperada, String chaveOperacao) {
        return mudarEstado(sub, osId, Acao.PAUSAR, motivo, versaoEsperada, chaveOperacao);
    }

    /** Sem motivo: na função SQL, o motivo da retomada seria público; esta rota nunca envia texto livre ao cliente. */
    @Transactional
    public String retomar(String sub, UUID osId, int versaoEsperada, String chaveOperacao) {
        return mudarEstado(sub, osId, Acao.RETOMAR, null, versaoEsperada, chaveOperacao);
    }

    /**
     * J07: informa a conclusão (em execução → concluída). A função SQL libera as reservas de material e cria, uma única
     * vez, a conta a receber do saldo (contratado menos o sinal), sem registrar recebimento; o Cliente passa a poder
     * confirmar o recebimento ou pedir revisão. Sem texto: na função, o texto da conclusão seria público.
     */
    @Transactional
    public String concluir(String sub, UUID osId, int versaoEsperada, String chaveOperacao) {
        return mudarEstado(sub, osId, Acao.CONCLUIR, null, versaoEsperada, chaveOperacao);
    }

    /**
     * J09: reabre para revisão (concluída → em execução), normalmente em resposta ao pedido de revisão do Cliente. A
     * função SQL exige motivo de 10 a 300 caracteres, que vai para o histórico PÚBLICO da OS (o Cliente vê), limpa a
     * revisão pendente e a data de conclusão. Não mexe na conta a receber: a nova conclusão não cria outra.
     */
    @Transactional
    public String reabrir(String sub, UUID osId, String motivo, int versaoEsperada, String chaveOperacao) {
        return mudarEstado(sub, osId, Acao.REABRIR, motivo, versaoEsperada, chaveOperacao);
    }

    /**
     * J09: encerramento pela EMPRESA (concluída → encerrada, "encerrada_por = empresa"). A função SQL só permite com a
     * OS concluída, sem revisão pendente e, se a OS veio da plataforma, depois de 7 dias da conclusão (OS interna pode
     * encerrar já). Libera reservas ainda ativas; não registra pagamento nem altera a conta a receber. Sem texto: na
     * função, o texto do encerramento seria público. Não é a confirmação de recebimento pelo Cliente (J08).
     */
    @Transactional
    public String encerrar(String sub, UUID osId, int versaoEsperada, String chaveOperacao) {
        return mudarEstado(sub, osId, Acao.ENCERRAR, null, versaoEsperada, chaveOperacao);
    }

    private String mudarEstado(String sub, UUID osId, Acao acao, String motivo, int versaoEsperada, String chaveOperacao) {
        assumirIdentidade(sub);
        ChecagensNaTransacao.exigirPodeAlterar(jdbc, osId);
        String resultado = jdbc.queryForObject("SELECT public.mudar_estado_os(?, ?, ?, ?, ?)::text", String.class,
                osId, acao.sql, motivo, versaoEsperada, chaveOperacao);
        if (acao == Acao.INICIAR) return resultado;
        return ChecagensNaTransacao.detalheAutorizado(jdbc, osId);
    }

    private void assumirIdentidade(String sub) {
        IdentidadeNaTransacao.assumir(jdbc, json, sub);
    }
}
