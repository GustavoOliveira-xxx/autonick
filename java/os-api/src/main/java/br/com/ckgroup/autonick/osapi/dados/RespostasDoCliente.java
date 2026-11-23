package br.com.ckgroup.autonick.osapi.dados;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * J08 (ADR-J02 §4.2, decisão J8-1 = A): escritas do CLIENTE titular. Chama as funções existentes
 * {@code confirmar_recebimento_servico} e {@code pedir_revisao_os}, sem reimplementar regra nenhuma.
 *
 * <p>As duas funções não recebem versão esperada. O controle de versão fica aqui, dentro de uma única transação:
 * <ol>
 *   <li><b>Titularidade antes de qualquer dado</b>: {@code minha_os(os)} com a identidade do token; quem não é o titular
 *       (outro cliente, a equipe da empresa, qualquer pessoa) recebe o mesmo NOT_FOUND da OS inexistente, inclusive
 *       num reenvio. Não usa nenhuma permissão da empresa.</li>
 *   <li>A função SQL roda. Numa execução nova, ela trava a linha da OS ({@code os_trava}, FOR UPDATE) e sobe a versão
 *       exatamente uma vez; numa repetição de chave já gravada, ela só devolve o resultado guardado, sem gravar.</li>
 *   <li>Execução nova e repetição são distinguidas por {@code pg_current_xact_id_if_assigned()}: a transação só ganha
 *       identificador quando grava algo.</li>
 *   <li><b>Execução nova</b>: com a OS ainda travada por esta transação, a versão atual tem de ser a enviada + 1, isto é,
 *       a versão que a função encontrou ao travar a OS era a enviada. Se não for, a requisição é desatualizada:
 *       VERSION_CONFLICT e a transação inteira é desfeita (estado, versão, histórico, auditoria, reservas e chave). Como
 *       a comparação acontece sob a trava e antes do commit, uma operação concorrente não contorna a verificação, e
 *       nada fica gravado antes da recusa.</li>
 *   <li><b>Repetição</b>: o resultado guardado traz a versão de depois da operação original; ela tem de ser a enviada
 *       + 1. Assim a mesma chave com outra versão é recusada (IDEMPOTENCY_CONFLICT), como a função já recusa outro
 *       texto. A repetição idêntica é reconhecida mesmo que a OS já tenha mudado depois.</li>
 *   <li>A resposta é sempre a leitura atual do Cliente ({@code minha_os}), feita depois da verificação.</li>
 * </ol>
 * Verificar a versão ANTES da função exigiria travar a linha da OS, o que o papel da API não pode fazer sem mudar o
 * SQL (opção B, não aprovada); por isso a comparação definitiva acontece sob a trava da própria função.
 */
@Repository
public class RespostasDoCliente {

    /** A OS mudou depois que a tela foi aberta. */
    public static final class VersaoDesatualizada extends RuntimeException {
        public VersaoDesatualizada() {
            super("A ordem de serviço mudou desde que você abriu a tela. Atualize e tente de novo.");
        }
    }

    /** A mesma chave já foi gravada com outros dados (aqui, outra versão). */
    public static final class ChaveComOutrosDados extends RuntimeException {
        public ChaveComOutrosDados() {
            super("Esta operação já foi registrada com outros dados.");
        }
    }

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public RespostasDoCliente(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** Encerra a OS pelo Cliente; não registra pagamento nem mexe na conta a receber (regra da função). */
    @Transactional
    public String confirmarRecebimento(String sub, UUID osId, int versaoEsperada, String chaveOperacao) {
        return responder(sub, osId, versaoEsperada, "SELECT public.confirmar_recebimento_servico(?, ?)::text", osId, chaveOperacao);
    }

    /** Mantém a OS concluída com revisão pendente; o texto (10 a 1.000, sem contato) é validado pela função. */
    @Transactional
    public String pedirRevisao(String sub, UUID osId, String texto, int versaoEsperada, String chaveOperacao) {
        return responder(sub, osId, versaoEsperada, "SELECT public.pedir_revisao_os(?, ?, ?)::text", osId, texto, chaveOperacao);
    }

    private String responder(String sub, UUID osId, int versaoEsperada, String funcao, Object... argumentos) {
        IdentidadeNaTransacao.assumir(jdbc, json, sub);
        jdbc.queryForObject("SELECT public.minha_os(?)::text", String.class, osId);
        if (gravouNestaTransacao()) throw new IllegalStateException("A transação já tinha gravado antes da ação do Cliente.");

        String resultadoDaFuncao = jdbc.queryForObject(funcao, String.class, argumentos);
        boolean gravou = gravouNestaTransacao();
        String atual = jdbc.queryForObject("SELECT public.minha_os(?)::text", String.class, osId);

        if (gravou) {
            if (versao(atual) != versaoEsperada + 1) throw new VersaoDesatualizada();
        } else if (versao(resultadoDaFuncao) != versaoEsperada + 1) {
            throw new ChaveComOutrosDados();
        }
        return atual;
    }

    private boolean gravouNestaTransacao() {
        return ChecagensNaTransacao.gravouNestaTransacao(jdbc);
    }

    private int versao(String osJson) {
        try {
            JsonNode no = json.readTree(osJson);
            return no.path("versao").asInt(-1);
        } catch (Exception erro) {
            throw new IllegalStateException("Resposta inesperada da função", erro);
        }
    }
}
