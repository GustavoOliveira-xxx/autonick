package br.com.ckgroup.autonick.osapi.web;

import br.com.ckgroup.autonick.osapi.dados.AcoesOrdensServico;
import br.com.ckgroup.autonick.osapi.dados.MateriaisOrdensServico;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * J11: materiais e estoque da OS (ADR-J02 §4.5), uma rota por ação, corpo estrito:
 * <ul>
 *   <li>{@code POST /api/business/ordens-servico/{osId}/materiais} com {@code {"chave", "variacao_id", "quantidade"}}:
 *       material previsto;</li>
 *   <li>{@code POST .../materiais/{materialId}/reserva} com {@code {"chave", "reservar"}}: reserva o que falta usar ou
 *       desfaz a reserva;</li>
 *   <li>{@code POST .../usos-material} com {@code {"chave", "variacao_id", "quantidade"}} e {@code "motivo"} opcional:
 *       uso de material (baixa na hora para quem aprova o estoque; pendente para os demais);</li>
 *   <li>{@code POST .../usos-material/{usoId}/decisao} com {@code {"versao", "chave", "aprovar"}} e {@code "motivo"}
 *       (obrigatório para recusar): a versão é a do registro de uso;</li>
 *   <li>{@code POST .../materiais/{materialId}/devolucao} com {@code {"chave", "quantidade", "motivo"}}.</li>
 * </ul>
 * Erros: OS inexistente ou de outra empresa → o mesmo 404 do detalhe; material ou uso que não é desta OS → 404; sem a
 * permissão que a função exige → 403; estado, versão, chave repetida com outros dados ou estoque insuficiente → 409;
 * corpo inválido → 400. Quantidades, textos, estoque e estados continuam validados pelo banco.
 */
@RestController
public class MateriaisOrdensServicoController {

    private static final String ROTA = "/api/business/ordens-servico/{osId}/";
    private static final Set<String> ADICIONAR = Set.of("chave", "variacao_id", "quantidade");
    private static final Set<String> RESERVA = Set.of("chave", "reservar");
    private static final Set<String> USO = Set.of("chave", "variacao_id", "quantidade", "motivo");
    private static final Set<String> DECISAO = Set.of("versao", "chave", "aprovar", "motivo");
    private static final Set<String> DEVOLUCAO = Set.of("chave", "quantidade", "motivo");

    private final MateriaisOrdensServico materiais;

    public MateriaisOrdensServicoController(MateriaisOrdensServico materiais) {
        this.materiais = materiais;
    }

    @PostMapping(value = ROTA + "materiais", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> adicionar(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @RequestBody JsonNode corpo) {
        String invalido = primeiro(soCampos(corpo, ADICIONAR, "chave, variacao_id e quantidade"), chave(corpo), variacao(corpo), quantidade(corpo));
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(materiais.adicionar(token.getSubject(), osId, UUID.fromString(corpo.get("variacao_id").textValue()),
                corpo.get("quantidade").intValue(), corpo.get("chave").textValue()));
    }

    @PostMapping(value = ROTA + "materiais/{materialId}/reserva", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> reservar(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @PathVariable UUID materialId,
            @RequestBody JsonNode corpo) {
        String invalido = primeiro(soCampos(corpo, RESERVA, "chave e reservar"), chave(corpo),
                booleano(corpo, "reservar", "Diga se é para reservar (true) ou desfazer a reserva (false)."));
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(materiais.reservar(token.getSubject(), osId, materialId, corpo.get("reservar").booleanValue(), corpo.get("chave").textValue()));
    }

    @PostMapping(value = ROTA + "usos-material", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> registrarUso(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @RequestBody JsonNode corpo) {
        String invalido = primeiro(soCampos(corpo, USO, "chave, variacao_id, quantidade e, se quiser, motivo"), chave(corpo), variacao(corpo),
                quantidade(corpo), textoOpcional(corpo, "motivo", 300, "A observação tem até 300 caracteres."));
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(materiais.registrarUso(token.getSubject(), osId, UUID.fromString(corpo.get("variacao_id").textValue()),
                corpo.get("quantidade").intValue(), texto(corpo, "motivo"), corpo.get("chave").textValue()));
    }

    @PostMapping(value = ROTA + "usos-material/{usoId}/decisao", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> decidirUso(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @PathVariable UUID usoId,
            @RequestBody JsonNode corpo) {
        String invalido = primeiro(soCampos(corpo, DECISAO, "versao, chave, aprovar e motivo"), versao(corpo), chave(corpo),
                booleano(corpo, "aprovar", "Diga se o uso é confirmado (true) ou recusado (false)."));
        if (invalido == null) {
            boolean aprovar = corpo.get("aprovar").booleanValue();
            invalido = aprovar
                    ? (corpo.hasNonNull("motivo") ? "Para confirmar o uso, não envie motivo." : null)
                    : AcoesOrdensServicoController.validarTexto(corpo.get("motivo"), 3, 300, "Explique a recusa (3 a 300 caracteres).");
        }
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(materiais.decidirUso(token.getSubject(), osId, usoId, corpo.get("aprovar").booleanValue(), texto(corpo, "motivo"),
                corpo.get("versao").intValue(), corpo.get("chave").textValue()));
    }

    @PostMapping(value = ROTA + "materiais/{materialId}/devolucao", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> devolver(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @PathVariable UUID materialId,
            @RequestBody JsonNode corpo) {
        String invalido = primeiro(soCampos(corpo, DEVOLUCAO, "chave, quantidade e motivo"), chave(corpo), quantidade(corpo),
                AcoesOrdensServicoController.validarTexto(corpo == null ? null : corpo.get("motivo"), 3, 300, "Diga por que o material voltou (3 a 300 caracteres)."));
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(materiais.devolver(token.getSubject(), osId, materialId, corpo.get("quantidade").intValue(), texto(corpo, "motivo"),
                corpo.get("chave").textValue()));
    }

    // ------------------------------------------------------------------------------------------------ validação

    private static String primeiro(String... erros) {
        for (String e : erros) if (e != null) return e;
        return null;
    }

    private static String soCampos(JsonNode corpo, Set<String> campos, String lista) {
        if (corpo == null || !corpo.isObject()) return "Envie um objeto JSON com " + lista + ".";
        for (Iterator<String> nomes = corpo.fieldNames(); nomes.hasNext(); ) {
            String nome = nomes.next();
            if (!campos.contains(nome)) return "Campo não aceito: " + nome + ". Envie só " + lista + ".";
        }
        return null;
    }

    private static String chave(JsonNode corpo) {
        JsonNode c = corpo == null ? null : corpo.get("chave");
        return c == null || !c.isTextual() || !AcoesOrdensServicoController.CHAVE.matcher(c.textValue()).matches()
                ? "Chave de operação ausente ou inválida." : null;
    }

    private static String versao(JsonNode corpo) {
        JsonNode v = corpo == null ? null : corpo.get("versao");
        return v == null || !v.isIntegralNumber() || !v.canConvertToInt() || v.intValue() < 1 ? "Informe a versão do registro de uso (inteiro a partir de 1)." : null;
    }

    private static String variacao(JsonNode corpo) {
        JsonNode v = corpo == null ? null : corpo.get("variacao_id");
        if (v == null || !v.isTextual()) return "Escolha o produto (variacao_id).";
        try {
            UUID.fromString(v.textValue());
            return v.textValue().length() == 36 ? null : "Produto inválido.";
        } catch (IllegalArgumentException erro) {
            return "Produto inválido.";
        }
    }

    private static String quantidade(JsonNode corpo) {
        JsonNode q = corpo == null ? null : corpo.get("quantidade");
        return q == null || !q.isIntegralNumber() || !q.canConvertToInt() || q.intValue() < 1 || q.intValue() > 1_000_000
                ? "Informe a quantidade em unidades inteiras." : null;
    }

    private static String booleano(JsonNode corpo, String campo, String mensagem) {
        JsonNode b = corpo == null ? null : corpo.get(campo);
        return b == null || !b.isBoolean() ? mensagem : null;
    }

    private static String textoOpcional(JsonNode corpo, String campo, int maximo, String mensagem) {
        JsonNode t = corpo == null ? null : corpo.get(campo);
        if (t == null || t.isNull()) return null;
        if (!t.isTextual()) return mensagem;
        return t.textValue().codePointCount(0, t.textValue().length()) > maximo ? mensagem : null;
    }

    private static String texto(JsonNode corpo, String campo) {
        JsonNode t = corpo.get(campo);
        return t == null || t.isNull() ? null : t.textValue();
    }

    private static ResponseEntity<?> ok(String resultado) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(resultado);
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<Map<String, String>> banco(DataAccessException erro) {
        return TratadorErros.respostaBanco(erro, TradutorErrosBanco::traduzirAcao);
    }

    @ExceptionHandler(AcoesOrdensServico.SemPermissaoParaAlterar.class)
    ResponseEntity<Map<String, String>> semPermissao(AcoesOrdensServico.SemPermissaoParaAlterar erro) {
        return erro(HttpStatus.FORBIDDEN, "FORBIDDEN_ACTION", erro.getMessage());
    }

    @ExceptionHandler(MateriaisOrdensServico.ItemNaoEncontrado.class)
    ResponseEntity<Map<String, String>> itemNaoEncontrado(MateriaisOrdensServico.ItemNaoEncontrado erro) {
        return erro(HttpStatus.NOT_FOUND, "NOT_FOUND", erro.getMessage());
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, HttpMediaTypeNotSupportedException.class})
    ResponseEntity<Map<String, String>> corpoIlegivel(Exception erro) {
        return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Envie um objeto JSON com os campos da ação.");
    }

    private static ResponseEntity<Map<String, String>> erro(HttpStatus status, String codigo, String mensagem) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(Map.of("codigo", codigo, "mensagem", mensagem));
    }
}
