package br.com.ckgroup.autonick.osapi.web;

import br.com.ckgroup.autonick.osapi.dados.RespostasDoCliente;
import com.fasterxml.jackson.databind.JsonNode;
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
 * J08: respostas do Cliente titular à conclusão (ADR-J02 §4.2), uma rota por ação:
 * <ul>
 *   <li>{@code POST /api/cliente/ordens-servico/{osId}/confirmar-recebimento} com {@code {"versao", "chave"}};</li>
 *   <li>{@code POST /api/cliente/ordens-servico/{osId}/pedir-revisao} com {@code {"versao", "chave", "texto"}}, texto
 *       de 10 a 1.000 caracteres (a regra de contato continua no banco).</li>
 * </ul>
 * Respostas: quem não é o titular → o mesmo 404 da OS inexistente; estado incompatível, versão desatualizada ou chave
 * repetida com outros dados → 409; corpo inválido → 400. Não há 403: o Cliente não tem perfil de permissões.
 */
@RestController
public class RespostasDoClienteController {

    private static final Set<String> CONFIRMAR = Set.of("versao", "chave");
    private static final Set<String> REVISAO = Set.of("versao", "chave", "texto");
    private static final String ROTA = "/api/cliente/ordens-servico/{osId}/";

    private final RespostasDoCliente respostas;

    public RespostasDoClienteController(RespostasDoCliente respostas) {
        this.respostas = respostas;
    }

    @PostMapping(value = ROTA + "confirmar-recebimento", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> confirmarRecebimento(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @RequestBody JsonNode corpo) {
        String invalido = AcoesOrdensServicoController.validar(corpo, CONFIRMAR, "versao e chave");
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(respostas.confirmarRecebimento(token.getSubject(), osId, corpo.get("versao").intValue(), corpo.get("chave").textValue()));
    }

    @PostMapping(value = ROTA + "pedir-revisao", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> pedirRevisao(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @RequestBody JsonNode corpo) {
        String invalido = AcoesOrdensServicoController.validar(corpo, REVISAO, "versao, chave e texto");
        if (invalido == null) invalido = validarTexto(corpo.get("texto"));
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(respostas.pedirRevisao(token.getSubject(), osId, corpo.get("texto").textValue(),
                corpo.get("versao").intValue(), corpo.get("chave").textValue()));
    }

    /** Mesmo tamanho da função SQL (espaços das pontas não contam, 10 a 1.000); a função valida de novo e barra contato. */
    static String validarTexto(JsonNode texto) {
        String mensagem = "Explique o que precisa ser revisto (10 a 1.000 caracteres).";
        if (texto == null || !texto.isTextual()) return mensagem;
        String limpo = texto.textValue().replaceAll("^ +| +$", "");
        int tamanho = limpo.codePointCount(0, limpo.length());
        return tamanho < 10 || tamanho > 1000 ? mensagem : null;
    }

    private static ResponseEntity<?> ok(String resultado) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(resultado);
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<Map<String, String>> banco(DataAccessException erro) {
        return TratadorErros.respostaBanco(erro, TradutorErrosBanco::traduzirAcao);
    }

    @ExceptionHandler(RespostasDoCliente.VersaoDesatualizada.class)
    ResponseEntity<Map<String, String>> versao(RespostasDoCliente.VersaoDesatualizada erro) {
        return erro(HttpStatus.CONFLICT, "VERSION_CONFLICT", erro.getMessage());
    }

    @ExceptionHandler(RespostasDoCliente.ChaveComOutrosDados.class)
    ResponseEntity<Map<String, String>> chave(RespostasDoCliente.ChaveComOutrosDados erro) {
        return erro(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", erro.getMessage());
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, HttpMediaTypeNotSupportedException.class})
    ResponseEntity<Map<String, String>> corpoIlegivel(Exception erro) {
        return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Envie um objeto JSON com os campos da ação.");
    }

    private static ResponseEntity<Map<String, String>> erro(HttpStatus status, String codigo, String mensagem) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(Map.of("codigo", codigo, "mensagem", mensagem));
    }
}
