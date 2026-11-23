package br.com.ckgroup.autonick.osapi.dados;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * J10 (ADR-J02 §4.4): acompanhamento da OS pela equipe. Chama as funções SQL existentes, sem
 * reimplementar regra nenhuma, com a mesma disciplina das escritas anteriores: uma transação, identidade do token só nela,
 * permissão atual conferida antes ({@code servicos.alterar}) e, como resposta, a leitura NOVA da empresa autorizada de
 * novo, nunca o resultado guardado de uma repetição.
 *
 * <ul>
 *   <li>{@code publicar_atualizacao_os}: acrescenta um evento ({@code atualizacao} público ou {@code nota_interna}); não
 *       muda a OS nem a versão, por isso não recebe versão (decisão de projeto). A idempotência é a da função.</li>
 *   <li>{@code atualizar_dados_os}: responsável, previsão e recorrência, com a versão esperada conferida pela função.</li>
 *   <li>{@code registrar_garantia_os}: a função sobe a versão sem recebê-la. A versão é conferida aqui, com o mesmo
 *       mecanismo do J08 (J8-1 = A), ver {@link #registrarGarantia}.</li>
 * </ul>
 */
@Repository
public class AcompanhamentoOrdensServico {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public AcompanhamentoOrdensServico(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** Atualização pública (até 500 caracteres, sem contato) ou nota interna (até 1.000), conforme {@code publica}. */
    @Transactional
    public String publicarAtualizacao(String sub, UUID osId, String texto, boolean publica, String chaveOperacao) {
        IdentidadeNaTransacao.assumir(jdbc, json, sub);
        ChecagensNaTransacao.exigirPodeAlterar(jdbc, osId);
        jdbc.queryForObject("SELECT public.publicar_atualizacao_os(?, ?, ?, ?)::text", String.class, osId, texto, publica, chaveOperacao);
        return ChecagensNaTransacao.detalheAutorizado(jdbc, osId);
    }

    /** {@code dadosJson}: objeto só com responsavel_auth_id, previsao_conclusao e recorrencia; os ausentes ficam como estão. */
    @Transactional
    public String atualizarDados(String sub, UUID osId, String dadosJson, int versaoEsperada, String chaveOperacao) {
        IdentidadeNaTransacao.assumir(jdbc, json, sub);
        ChecagensNaTransacao.exigirPodeAlterar(jdbc, osId);
        jdbc.queryForObject("SELECT public.atualizar_dados_os(?, ?::jsonb, ?, ?)::text", String.class, osId, dadosJson, versaoEsperada, chaveOperacao);
        return ChecagensNaTransacao.detalheAutorizado(jdbc, osId);
    }

    /**
     * Garantia com controle de versão na API, sem mudar o SQL (mecanismo do J08, conferido para esta função):
     * <ol>
     *   <li>a função trava a linha da OS ({@code os_trava}, FOR UPDATE) antes de conferir estado e de gravar, e sobe a
     *       versão exatamente uma vez;</li>
     *   <li>numa chave já gravada, {@code idem_inicio} devolve o resultado guardado ANTES da trava, sem gravar nada; numa
     *       execução nova, a trava e o UPDATE atribuem identificador à transação. É assim que as duas se distinguem;</li>
     *   <li>execução nova: ainda com a OS travada por esta transação, a versão atual tem de ser a enviada + 1; senão,
     *       VERSION_CONFLICT e a transação inteira é desfeita (garantia, versão, histórico, auditoria e chave);</li>
     *   <li>repetição: a versão do resultado guardado tem de ser a enviada + 1; senão, IDEMPOTENCY_CONFLICT. Outro prazo ou
     *       outras condições com a mesma chave já são recusados pela função.</li>
     * </ol>
     * Toda alteração da linha da OS no banco sobe a versão (conferido nas migrations); por isso uma mudança feita por outra
     * transação entre a leitura da tela e este pedido aparece como versão diferente.
     */
    @Transactional
    public String registrarGarantia(String sub, UUID osId, int dias, String condicoes, int versaoEsperada, String chaveOperacao) {
        IdentidadeNaTransacao.assumir(jdbc, json, sub);
        ChecagensNaTransacao.exigirPodeAlterar(jdbc, osId);
        if (ChecagensNaTransacao.gravouNestaTransacao(jdbc)) {
            throw new IllegalStateException("A transação já tinha gravado antes de registrar a garantia.");
        }
        String resultadoDaFuncao = jdbc.queryForObject("SELECT public.registrar_garantia_os(?, ?, ?, ?)::text", String.class,
                osId, dias, condicoes, chaveOperacao);
        boolean gravou = ChecagensNaTransacao.gravouNestaTransacao(jdbc);
        String atual = ChecagensNaTransacao.detalheAutorizado(jdbc, osId);
        if (gravou) {
            if (versao(atual) != versaoEsperada + 1) throw new RespostasDoCliente.VersaoDesatualizada();
        } else if (versao(resultadoDaFuncao) != versaoEsperada + 1) {
            throw new RespostasDoCliente.ChaveComOutrosDados();
        }
        return atual;
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
