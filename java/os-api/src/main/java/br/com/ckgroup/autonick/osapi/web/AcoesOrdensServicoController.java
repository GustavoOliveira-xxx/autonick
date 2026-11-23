package br.com.ckgroup.autonick.osapi.web;

import br.com.ckgroup.autonick.osapi.dados.AcoesOrdensServico;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
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
 * Escritas da OS pela API Java (ADR-J02), uma rota por ação, com a ação fixa:
 * <ul>
 *   <li>{@code POST /api/business/ordens-servico/{osId}/iniciar} com {@code {"versao", "chave"}} (J05);</li>
 *   <li>{@code POST .../{osId}/pausar} com {@code {"versao", "chave", "motivo"}}; motivo de 5 a 300 caracteres (J06);</li>
 *   <li>{@code POST .../{osId}/retomar} com {@code {"versao", "chave"}}; não aceita motivo (J06);</li>
 *   <li>{@code POST .../{osId}/concluir} com {@code {"versao", "chave"}}; informa a conclusão, sem texto (J07);</li>
 *   <li>{@code POST .../{osId}/reabrir} com {@code {"versao", "chave", "motivo"}}; motivo de 10 a 300 caracteres,
 *       PÚBLICO no histórico da OS (J09);</li>
 *   <li>{@code POST .../{osId}/encerrar} com {@code {"versao", "chave"}}; encerramento pela empresa, só quando a regra do
 *       banco permite, sem texto (J09).</li>
 * </ul>
 * O corpo só pode trazer os campos da ação; qualquer outro, inclusive {@code acao}, é recusado com 400. Erros: OS
 * inexistente ou de outra empresa → o mesmo 404 do detalhe; sem {@code servicos.alterar} → 403; versão desatualizada,
 * estado incompatível ou chave repetida com outros dados → 409.
 */
@RestController
public class AcoesOrdensServicoController {

    private static final Set<String> SO_VERSAO_E_CHAVE = Set.of("versao", "chave");
    private static final Set<String> COM_MOTIVO = Set.of("versao", "chave", "motivo");
    static final Pattern CHAVE = Pattern.compile("^[A-Za-z0-9._:-]{8,100}$");
    private static final String ROTA = "/api/business/ordens-servico/{osId}/";

    private final AcoesOrdensServico acoes;

    public AcoesOrdensServicoController(AcoesOrdensServico acoes) {
        this.acoes = acoes;
    }

    @PostMapping(value = ROTA + "iniciar", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> iniciar(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @RequestBody JsonNode corpo) {
        String invalido = validar(corpo, SO_VERSAO_E_CHAVE);
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(acoes.iniciar(token.getSubject(), osId, versao(corpo), chave(corpo)));
    }

    @PostMapping(value = ROTA + "pausar", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> pausar(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @RequestBody JsonNode corpo) {
        String invalido = validar(corpo, COM_MOTIVO);
        if (invalido == null) invalido = validarMotivo(corpo.get("motivo"));
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(acoes.pausar(token.getSubject(), osId, corpo.get("motivo").textValue(), versao(corpo), chave(corpo)));
    }

    @PostMapping(value = ROTA + "retomar", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> retomar(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @RequestBody JsonNode corpo) {
        String invalido = validar(corpo, SO_VERSAO_E_CHAVE);
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(acoes.retomar(token.getSubject(), osId, versao(corpo), chave(corpo)));
    }

    @PostMapping(value = ROTA + "concluir", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> concluir(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @RequestBody JsonNode corpo) {
        String invalido = validar(corpo, SO_VERSAO_E_CHAVE);
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(acoes.concluir(token.getSubject(), osId, versao(corpo), chave(corpo)));
    }

    @PostMapping(value = ROTA + "reabrir", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> reabrir(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @RequestBody JsonNode corpo) {
        String invalido = validar(corpo, COM_MOTIVO);
        if (invalido == null) invalido = validarTexto(corpo.get("motivo"), 10, 300, "Justifique a revisão (10 a 300 caracteres).");
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(acoes.reabrir(token.getSubject(), osId, corpo.get("motivo").textValue(), versao(corpo), chave(corpo)));
    }

    @PostMapping(value = ROTA + "encerrar", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> encerrar(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @RequestBody JsonNode corpo) {
        String invalido = validar(corpo, SO_VERSAO_E_CHAVE);
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(acoes.encerrar(token.getSubject(), osId, versao(corpo), chave(corpo)));
    }

    /** Campos permitidos, versão inteira ≥ 1 e chave segura. Os campos obrigatórios são todos os permitidos. */
    static String validar(JsonNode corpo, Set<String> campos) {
        return validar(corpo, campos, campos.contains("motivo") ? "versao, chave e motivo" : "versao e chave");
    }

    /** Campos permitidos (todos obrigatórios), versão inteira ≥ 1 e chave segura; {@code lista} entra nas mensagens. */
    static String validar(JsonNode corpo, Set<String> campos, String lista) {
        if (corpo == null || !corpo.isObject()) return "Envie um objeto JSON com " + lista + ".";
        for (Iterator<String> nomes = corpo.fieldNames(); nomes.hasNext(); ) {
            String nome = nomes.next();
            if (!campos.contains(nome)) return "Campo não aceito: " + nome + ". Envie só " + lista + ".";
        }
        JsonNode versao = corpo.get("versao");
        if (versao == null || !versao.isIntegralNumber() || !versao.canConvertToInt() || versao.intValue() < 1) {
            return "Informe a versão da OS (inteiro a partir de 1).";
        }
        JsonNode chave = corpo.get("chave");
        if (chave == null || !chave.isTextual() || !CHAVE.matcher(chave.textValue()).matches()) {
            return "Chave de operação ausente ou inválida.";
        }
        return null;
    }

    /** Mesma regra da função SQL para o motivo da pausa (btrim de espaços e 5 a 300 caracteres); a função valida de novo. */
    static String validarMotivo(JsonNode motivo) {
        return validarTexto(motivo, 5, 300, "Diga por que a OS está pausada (5 a 300 caracteres).");
    }

    /** Texto obrigatório com {@code minimo} a {@code maximo} caracteres depois de tirar os espaços das pontas (como o btrim do SQL). */
    static String validarTexto(JsonNode valor, int minimo, int maximo, String mensagem) {
        if (valor == null || !valor.isTextual()) return mensagem;
        String texto = valor.textValue().replaceAll("^ +| +$", "");
        int tamanho = texto.codePointCount(0, texto.length());
        return tamanho < minimo || tamanho > maximo ? mensagem : null;
    }

    private static int versao(JsonNode corpo) {
        return corpo.get("versao").intValue();
    }

    private static String chave(JsonNode corpo) {
        return corpo.get("chave").textValue();
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

    @ExceptionHandler({HttpMessageNotReadableException.class, HttpMediaTypeNotSupportedException.class})
    ResponseEntity<Map<String, String>> corpoIlegivel(Exception erro) {
        return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Envie um objeto JSON com os campos da ação.");
    }

    private static ResponseEntity<Map<String, String>> erro(HttpStatus status, String codigo, String mensagem) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(Map.of("codigo", codigo, "mensagem", mensagem));
    }
}
