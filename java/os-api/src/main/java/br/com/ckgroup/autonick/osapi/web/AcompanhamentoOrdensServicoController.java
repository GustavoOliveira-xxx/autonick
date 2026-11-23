package br.com.ckgroup.autonick.osapi.web;

import br.com.ckgroup.autonick.osapi.dados.AcoesOrdensServico;
import br.com.ckgroup.autonick.osapi.dados.AcompanhamentoOrdensServico;
import br.com.ckgroup.autonick.osapi.dados.RespostasDoCliente;
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
 * J10: acompanhamento da OS pela equipe (ADR-J02 §4.4), uma rota por ação, corpo estrito:
 * <ul>
 *   <li>{@code POST /api/business/ordens-servico/{osId}/publicar-atualizacao} com {@code {"chave", "texto", "publica"}}:
 *       {@code publica} obrigatório (true = o cliente vê; false = nota interna); texto de 2 a 500 (pública) ou 1.000
 *       (interna) caracteres. Sem versão: a operação só acrescenta um evento;</li>
 *   <li>{@code POST .../atualizar-dados} com {@code {"versao", "chave", "dados"}}: {@code dados} só com
 *       {@code responsavel_auth_id}, {@code previsao_conclusao} e {@code recorrencia} (texto ou null); os ausentes ficam
 *       como estão;</li>
 *   <li>{@code POST .../registrar-garantia} com {@code {"versao", "chave", "dias"}} e, opcional, {@code "condicoes"}:
 *       0 a 3.650 dias, condições de até 1.000 caracteres.</li>
 * </ul>
 * Erros: OS inexistente ou de outra empresa → o mesmo 404 do detalhe; sem {@code servicos.alterar} → 403; estado
 * incompatível, versão desatualizada ou chave repetida com outros dados → 409; corpo inválido → 400. As regras de texto,
 * contato, responsável, datas e estado continuam no banco, que valida de novo.
 */
@RestController
public class AcompanhamentoOrdensServicoController {

    private static final String ROTA = "/api/business/ordens-servico/{osId}/";
    private static final Set<String> ATUALIZACAO = Set.of("chave", "texto", "publica");
    private static final Set<String> DADOS = Set.of("versao", "chave", "dados");
    private static final Set<String> CAMPOS_DOS_DADOS = Set.of("responsavel_auth_id", "previsao_conclusao", "recorrencia");
    private static final Set<String> GARANTIA = Set.of("versao", "chave", "dias", "condicoes");

    private final AcompanhamentoOrdensServico acompanhamento;

    public AcompanhamentoOrdensServicoController(AcompanhamentoOrdensServico acompanhamento) {
        this.acompanhamento = acompanhamento;
    }

    @PostMapping(value = ROTA + "publicar-atualizacao", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> publicarAtualizacao(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @RequestBody JsonNode corpo) {
        String invalido = soCampos(corpo, ATUALIZACAO, "chave, texto e publica");
        if (invalido == null) invalido = chaveInvalida(corpo);
        if (invalido == null && (corpo.get("publica") == null || !corpo.get("publica").isBoolean())) {
            invalido = "Diga se o cliente pode ver a atualização (publica: true ou false).";
        }
        if (invalido == null) {
            boolean publica = corpo.get("publica").booleanValue();
            invalido = AcoesOrdensServicoController.validarTexto(corpo.get("texto"), 2, publica ? 500 : 1000,
                    "Escreva a atualização (até 500 caracteres; nota interna até 1.000).");
        }
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(acompanhamento.publicarAtualizacao(token.getSubject(), osId, corpo.get("texto").textValue(),
                corpo.get("publica").booleanValue(), corpo.get("chave").textValue()));
    }

    @PostMapping(value = ROTA + "atualizar-dados", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> atualizarDados(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @RequestBody JsonNode corpo) {
        String invalido = AcoesOrdensServicoController.validar(corpo, DADOS, "versao, chave e dados");
        JsonNode dados = invalido == null ? corpo.get("dados") : null;
        if (invalido == null) invalido = dadosInvalidos(dados);
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        return ok(acompanhamento.atualizarDados(token.getSubject(), osId, dados.toString(), corpo.get("versao").intValue(),
                corpo.get("chave").textValue()));
    }

    @PostMapping(value = ROTA + "registrar-garantia", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> registrarGarantia(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId, @RequestBody JsonNode corpo) {
        String invalido = soCampos(corpo, GARANTIA, "versao, chave, dias e, se quiser, condicoes");
        if (invalido == null) invalido = versaoInvalida(corpo);
        if (invalido == null) invalido = chaveInvalida(corpo);
        JsonNode dias = corpo == null ? null : corpo.get("dias");
        if (invalido == null && (dias == null || !dias.isIntegralNumber() || !dias.canConvertToInt() || dias.intValue() < 0 || dias.intValue() > 3650)) {
            invalido = "O prazo de garantia vai de 0 a 3.650 dias.";
        }
        JsonNode condicoes = corpo == null ? null : corpo.get("condicoes");
        if (invalido == null && condicoes != null && !condicoes.isNull()) {
            if (!condicoes.isTextual()) invalido = "As condições são um texto.";
            else if (condicoes.textValue().codePointCount(0, condicoes.textValue().length()) > 1000) invalido = "As condições têm até 1.000 caracteres.";
        }
        if (invalido != null) return erro(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", invalido);
        String texto = condicoes == null || condicoes.isNull() ? null : condicoes.textValue();
        return ok(acompanhamento.registrarGarantia(token.getSubject(), osId, dias.intValue(), texto, corpo.get("versao").intValue(),
                corpo.get("chave").textValue()));
    }

    // ------------------------------------------------------------------------------------------------ validação

    private static String soCampos(JsonNode corpo, Set<String> campos, String lista) {
        if (corpo == null || !corpo.isObject()) return "Envie um objeto JSON com " + lista + ".";
        for (Iterator<String> nomes = corpo.fieldNames(); nomes.hasNext(); ) {
            String nome = nomes.next();
            if (!campos.contains(nome)) return "Campo não aceito: " + nome + ". Envie só " + lista + ".";
        }
        return null;
    }

    private static String versaoInvalida(JsonNode corpo) {
        JsonNode versao = corpo.get("versao");
        return versao == null || !versao.isIntegralNumber() || !versao.canConvertToInt() || versao.intValue() < 1
                ? "Informe a versão da OS (inteiro a partir de 1)." : null;
    }

    private static String chaveInvalida(JsonNode corpo) {
        JsonNode chave = corpo.get("chave");
        return chave == null || !chave.isTextual() || !AcoesOrdensServicoController.CHAVE.matcher(chave.textValue()).matches()
                ? "Chave de operação ausente ou inválida." : null;
    }

    /** Só os três campos já tratados pela função; cada um texto ou null (a função interpreta e valida o conteúdo). */
    private static String dadosInvalidos(JsonNode dados) {
        if (dados == null || !dados.isObject()) return "Envie em dados um objeto com responsavel_auth_id, previsao_conclusao ou recorrencia.";
        for (Iterator<Map.Entry<String, JsonNode>> campos = dados.fields(); campos.hasNext(); ) {
            Map.Entry<String, JsonNode> campo = campos.next();
            if (!CAMPOS_DOS_DADOS.contains(campo.getKey())) return "Campo não permitido: " + campo.getKey() + ".";
            if (!campo.getValue().isNull() && !campo.getValue().isTextual()) return "O campo " + campo.getKey() + " é um texto ou vazio.";
        }
        return null;
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

    @ExceptionHandler(RespostasDoCliente.VersaoDesatualizada.class)
    ResponseEntity<Map<String, String>> versaoDesatualizada(RespostasDoCliente.VersaoDesatualizada erro) {
        return erro(HttpStatus.CONFLICT, "VERSION_CONFLICT", erro.getMessage());
    }

    @ExceptionHandler(RespostasDoCliente.ChaveComOutrosDados.class)
    ResponseEntity<Map<String, String>> chaveComOutrosDados(RespostasDoCliente.ChaveComOutrosDados erro) {
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
