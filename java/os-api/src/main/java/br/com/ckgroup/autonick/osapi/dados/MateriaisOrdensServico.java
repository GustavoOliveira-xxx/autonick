package br.com.ckgroup.autonick.osapi.dados;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * J11 (ADR-J02 §4.5): materiais e estoque da OS pela API Java. Chama as cinco funções SQL do
 * M09, que usam o motor de estoque do M05, sem reimplementar regra nenhuma.
 *
 * <p>Disciplina de cada pedido, como nas escritas anteriores: uma transação; identidade do token só nela; ANTES da função
 * (que devolve o resultado guardado de uma chave repetida antes de conferir a permissão), a leitura da empresa
 * ({@code os_detalhe}) com a identidade atual confere a permissão que a FUNÇÃO exige e que o material ou o registro de uso
 * pertence à OS da rota; DEPOIS, a resposta é montada de uma leitura nova, autorizada de novo, nunca do resultado guardado
 * (que traz custos conforme a permissão de quem fez a operação original).
 *
 * <p>Controle de versão (analisado função a função, sem aplicar o mecanismo do J08): nenhuma das cinco grava um valor
 * absoluto que um pedido antigo possa sobrescrever. Adicionar soma à quantidade prevista; registrar uso e devolver criam
 * um registro novo (a devolução limitada ao que foi baixado e não voltou); reservar liga ou desliga a reserva, com o estado
 * conferido sob a trava do material, e a quantidade é a que falta usar no momento; decidir o uso confere a versão do
 * próprio registro de uso, na função. A última unidade é protegida pelo motor do M05 (trava da linha do saldo; reserva só
 * do disponível; baixa nunca abaixo do reservado por outras OS, pedidos ou vendas).
 */
@Repository
public class MateriaisOrdensServico {

    /** O material ou o registro de uso não é desta OS (ou não existe). */
    public static final class ItemNaoEncontrado extends RuntimeException {
        public ItemNaoEncontrado(String mensagem) {
            super(mensagem);
        }
    }

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public MateriaisOrdensServico(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** {@code adicionar_material_os}: material previsto (soma à quantidade, se a variação já estiver na OS). */
    @Transactional
    public String adicionar(String sub, UUID osId, UUID variacaoId, int quantidade, String chave) {
        exigir(sub, osId, List.of("alterar"));
        jdbc.queryForObject("SELECT public.adicionar_material_os(?, ?, ?, ?)::text", String.class, osId, variacaoId, quantidade, chave);
        return materiais(osId, List.of("alterar"));
    }

    /** {@code reservar_material_os}: reserva o que falta usar ({@code reservar = true}) ou desfaz a reserva. */
    @Transactional
    public String reservar(String sub, UUID osId, UUID materialId, boolean reservar, String chave) {
        JsonNode detalhe = exigir(sub, osId, List.of("estoque_propor"));
        exigirMaterial(detalhe, materialId);
        jdbc.queryForObject("SELECT public.reservar_material_os(?, ?, ?)::text", String.class, materialId, reservar, chave);
        return materiais(osId, List.of("estoque_propor"));
    }

    /**
     * {@code registrar_uso_material}: quem também tem {@code estoque.aprovar} baixa na hora; os demais deixam o uso
     * pendente. Resposta no formato da função ({@code uso_id}, {@code estado}, {@code materiais}), com o estado e os
     * materiais lidos de novo.
     */
    @Transactional
    public String registrarUso(String sub, UUID osId, UUID variacaoId, int quantidade, String motivo, String chave) {
        exigir(sub, osId, List.of("alterar"));
        String resultado = jdbc.queryForObject("SELECT public.registrar_uso_material(?, ?, ?, ?, ?)::text", String.class,
                osId, variacaoId, quantidade, motivo, chave);
        String usoId = ler(resultado).path("uso_id").asText();
        JsonNode detalhe = detalheAutorizado(osId, List.of("alterar"));
        String estado = "pendente";
        for (JsonNode m : detalhe.path("materiais")) {
            for (JsonNode u : m.path("usos")) if (u.path("id").asText().equals(usoId)) estado = u.path("estado").asText();
        }
        ObjectNode resposta = json.createObjectNode();
        resposta.put("uso_id", usoId);
        resposta.put("estado", estado);
        resposta.set("materiais", detalhe.path("materiais"));
        return resposta.toString();
    }

    /** {@code decidir_uso_material}: confirma (baixa) ou recusa um uso pendente; a versão é a do registro de uso. */
    @Transactional
    public String decidirUso(String sub, UUID osId, UUID usoId, boolean aprovar, String motivo, int versaoDoUso, String chave) {
        JsonNode detalhe = exigir(sub, osId, List.of("estoque_aprovar"));
        boolean achou = false;
        for (JsonNode m : detalhe.path("materiais")) {
            for (JsonNode u : m.path("usos")) if (u.path("id").asText().equals(usoId.toString())) achou = true;
        }
        if (!achou) throw new ItemNaoEncontrado("Registro de uso não encontrado nesta OS.");
        jdbc.queryForObject("SELECT public.decidir_uso_material(?, ?, ?, ?, ?)::text", String.class, usoId, aprovar, motivo, versaoDoUso, chave);
        return materiais(osId, List.of("estoque_aprovar"));
    }

    /** {@code devolver_material_os}: devolve ao estoque parte do que foi baixado (exige servicos.alterar e estoque.aprovar). */
    @Transactional
    public String devolver(String sub, UUID osId, UUID materialId, int quantidade, String motivo, String chave) {
        JsonNode detalhe = exigir(sub, osId, List.of("alterar", "estoque_aprovar"));
        exigirMaterial(detalhe, materialId);
        jdbc.queryForObject("SELECT public.devolver_material_os(?, ?, ?, ?)::text", String.class, materialId, quantidade, motivo, chave);
        return materiais(osId, List.of("alterar", "estoque_aprovar"));
    }

    // ------------------------------------------------------------------------------------------------ apoio

    /** Identidade na transação e leitura da empresa com a permissão que a função exige, antes de qualquer resultado guardado. */
    private JsonNode exigir(String sub, UUID osId, List<String> poderes) {
        IdentidadeNaTransacao.assumir(jdbc, json, sub);
        return detalheAutorizado(osId, poderes);
    }

    private JsonNode detalheAutorizado(UUID osId, List<String> poderes) {
        JsonNode detalhe = ler(jdbc.queryForObject("SELECT public.os_detalhe(?)::text", String.class, osId));
        for (String poder : poderes) {
            if (!detalhe.path("pode").path(poder).asBoolean(false)) throw new AcoesOrdensServico.SemPermissaoParaAlterar();
        }
        return detalhe;
    }

    /** Os materiais da leitura nova, no mesmo formato que a função devolve (lista), com o custo conforme a permissão atual. */
    private String materiais(UUID osId, List<String> poderes) {
        return detalheAutorizado(osId, poderes).path("materiais").toString();
    }

    private static void exigirMaterial(JsonNode detalhe, UUID materialId) {
        for (JsonNode m : detalhe.path("materiais")) if (m.path("id").asText().equals(materialId.toString())) return;
        throw new ItemNaoEncontrado("Material não encontrado nesta OS.");
    }

    private JsonNode ler(String texto) {
        try {
            return json.readTree(texto);
        } catch (Exception erro) {
            throw new IllegalStateException("Resposta inesperada da função", erro);
        }
    }
}
