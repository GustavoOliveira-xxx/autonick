package br.com.ckgroup.autonick.osapi.plataforma;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.TransactionException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Camada de dados da PWA pela API Java: {@code POST /api/dados/rpc/{funcao}} e {@code GET /api/dados/{tabela}}, no
 * mesmo formato de pedido e de resposta que a camada de dados da PWA já usa, para as telas funcionarem sem mudança.
 * Só operações do catálogo ({@link Dominio}); a identidade vem SÓ do token validado.
 */
@RestController
@RequestMapping("/api/dados")
public class DadosController {

    private static final Logger LOG = LoggerFactory.getLogger(DadosController.class);
    private static final int TAMANHO_MAXIMO_CORPO = 256 * 1024;
    private static final String OBJETO = "application/vnd.pgrst.object+json";
    static final Set<String> CODIGOS_DE_REGRA = Set.of("AUTH_REQUIRED", "FORBIDDEN_ACTION", "TENANT_FORBIDDEN",
            "VALIDATION_ERROR", "STATE_CONFLICT", "VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT", "NOT_FOUND",
            "INSUFFICIENT_STOCK", "DISCOUNT_EXCEEDS_LIMIT", "PAYMENT_EXCEEDS_BALANCE", "PRODUCT_PAUSED",
            "INSUFFICIENT_FUNDS", "PERIOD_LOCKED", "QUOTE_EXPIRED", "QUOTE_VERSION_STALE", "RATE_LIMITED");

    /** Números decimais como BigDecimal: valores em dinheiro não passam por double. */
    private final ObjectMapper leitor = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
    private final ExecutorDados executor;
    private final ConsultaTabelas tabelas;
    private final LimiteUso limite;

    public DadosController(ExecutorDados executor, ConsultaTabelas tabelas, LimiteUso limite) {
        this.executor = executor;
        this.tabelas = tabelas;
        this.limite = limite;
    }

    @PostMapping(path = "/rpc/{funcao}")
    ResponseEntity<String> rpc(@AuthenticationPrincipal Jwt jwt, @PathVariable String funcao,
            @RequestBody(required = false) byte[] corpo, @RequestHeader(name = "Accept", required = false) String aceita,
            HttpServletRequest pedido) throws Exception {
        Identidade quem = Identidade.de(jwt);
        CatalogoFuncoes.Assinatura assinatura = executor.autorizarChamada(quem, funcao);
        limite.registrar(chaveDeLimite(quem, pedido), !assinatura.somenteLeitura());
        if (corpo != null && corpo.length > TAMANHO_MAXIMO_CORPO) throw ErroDados.validacao("Dados grandes demais.");
        JsonNode parametros = corpo == null || corpo.length == 0 ? null : lerJson(corpo);
        String resposta = executor.chamar(quem, assinatura, parametros, OBJETO.equals(aceita));
        return json(resposta);
    }

    @GetMapping(path = "/{tabela}")
    ResponseEntity<String> tabela(@AuthenticationPrincipal Jwt jwt, @PathVariable String tabela,
            @RequestHeader(name = "Accept", required = false) String aceita, HttpServletRequest pedido) {
        Identidade quem = Identidade.de(jwt);
        limite.registrar(chaveDeLimite(quem, pedido), false);
        return json(tabelas.consultar(quem, tabela, pedido.getQueryString(), OBJETO.equals(aceita)));
    }

    private JsonNode lerJson(byte[] corpo) {
        try {
            return leitor.readTree(new String(corpo, StandardCharsets.UTF_8));
        } catch (Exception erro) {
            throw ErroDados.validacao(ErroDados.CONFIRA);
        }
    }

    private static String chaveDeLimite(Identidade quem, HttpServletRequest pedido) {
        if (!quem.anonima()) return quem.sub();
        String encaminhado = pedido.getHeader("X-Forwarded-For");
        String origem = encaminhado == null ? pedido.getRemoteAddr() : encaminhado.split(",")[0].trim();
        return "ip:" + origem;
    }

    private static ResponseEntity<String> json(String corpo) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(corpo);
    }

    @ExceptionHandler(ErroDados.class)
    ResponseEntity<Map<String, Object>> recusa(ErroDados erro) {
        return ResponseEntity.status(erro.status).body(erro.corpo());
    }

    @ExceptionHandler({DataAccessException.class, TransactionException.class})
    ResponseEntity<Map<String, Object>> banco(RuntimeException erro) {
        ErroDados traduzido = traduzir(erro);
        if (traduzido.status.is5xxServerError()) LOG.error("Falha do banco na camada de dados", erro);
        return recusa(traduzido);
    }

    /** Erro de regra (código no HINT) passa adiante; o resto vira resposta genérica, sem SQL nem detalhe interno. */
    static ErroDados traduzir(Throwable erro) {
        PSQLException psql = null;
        for (Throwable t = erro; t != null; t = t.getCause()) {
            if (t instanceof ErroDados e) return e;
            if (t instanceof PSQLException p) {
                psql = p;
                break;
            }
        }
        ServerErrorMessage servidor = psql == null ? null : psql.getServerErrorMessage();
        if (servidor == null) {
            return new ErroDados(HttpStatus.SERVICE_UNAVAILABLE, "PGRST000", "O serviço está indisponível no momento.", null, null);
        }
        String dica = servidor.getHint();
        String estado = servidor.getSQLState() == null ? "" : servidor.getSQLState();
        if (dica != null && CODIGOS_DE_REGRA.contains(dica)) {
            String detalhe = servidor.getDetail();
            return new ErroDados(status(dica), estado, servidor.getMessage(), dica, detalhe == null || detalhe.isEmpty() ? null : detalhe);
        }
        if (estado.equals("57014")) {
            return new ErroDados(HttpStatus.SERVICE_UNAVAILABLE, estado, "A operação demorou demais. Tente de novo.", null, null);
        }
        if (estado.equals("40001") || estado.equals("40P01")) {
            return new ErroDados(HttpStatus.CONFLICT, estado, "Outra operação aconteceu ao mesmo tempo. Atualize e tente de novo.", "STATE_CONFLICT", null);
        }
        if (estado.equals("42501")) return new ErroDados(HttpStatus.FORBIDDEN, estado, "Seu perfil não permite esta ação.", null, null);
        if (estado.startsWith("22") || estado.startsWith("23") || estado.equals("42883") || estado.equals("42804")) {
            return new ErroDados(HttpStatus.BAD_REQUEST, estado, ErroDados.CONFIRA, null, null);
        }
        return new ErroDados(HttpStatus.INTERNAL_SERVER_ERROR, estado, "Não foi possível concluir a operação.", null, null);
    }

    static HttpStatus status(String codigo) {
        return switch (codigo) {
            case "AUTH_REQUIRED" -> HttpStatus.UNAUTHORIZED;
            case "FORBIDDEN_ACTION", "TENANT_FORBIDDEN" -> HttpStatus.FORBIDDEN;
            case "NOT_FOUND" -> HttpStatus.NOT_FOUND;
            case "VALIDATION_ERROR" -> HttpStatus.BAD_REQUEST;
            case "RATE_LIMITED" -> HttpStatus.TOO_MANY_REQUESTS;
            default -> HttpStatus.CONFLICT;
        };
    }
}
