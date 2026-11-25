package br.com.ckgroup.autonick.osapi.demonstracao;

import br.com.ckgroup.autonick.osapi.config.AutenticacaoProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Entrada da DEMONSTRAÇÃO, no mesmo formato de pedidos e respostas que a PWA já usa com o Neon Auth (para as telas de
 * entrada e conta funcionarem sem mudança): {@code POST /sign-in/email}, {@code POST /sign-up/email},
 * {@code GET /get-session} (token de acesso no cabeçalho {@code set-auth-jwt}), {@code POST /sign-out} e
 * {@code GET /token/anonymous}. Mais {@code GET /demo/pessoas} e {@code POST /demo/entrar} (entrar como uma pessoa
 * fictícia, sem senha). Só contas fictícias; a sessão é um cookie HttpOnly assinado, restrito a /api/auth.
 */
@RestController
@RequestMapping("/api/auth")
@ConditionalOnProperty(name = "autonick.auth.modo", havingValue = "demo")
public class AutenticacaoDemoController {

    static final String COOKIE = "autonick_sessao";
    /** Na demonstração pública só se entra por uma pessoa fictícia do próprio cenário (nunca por e-mail e senha). */
    private static final ResponseEntity<?> SO_PESSOAS_NA_PUBLICA = ResponseEntity.status(HttpStatus.FORBIDDEN)
            .body(Map.of("message", "Na demonstração pública, entre por uma das pessoas fictícias.", "code", "FORBIDDEN"));
    private static final Pattern EMAIL = Pattern.compile("[a-z0-9._+-]{1,64}@autonick-teste\\.example");

    private final TokensDemonstracao tokens;
    private final ContasDemonstracao contas;
    private final AutenticacaoProperties contrato;
    private final EntradaVisitante visitantes;
    private final Clock relogio;
    private final Set<String> origensPermitidas;

    private final br.com.ckgroup.autonick.osapi.plataforma.EnderecoCliente endereco;

    public AutenticacaoDemoController(TokensDemonstracao tokens, ContasDemonstracao contas, AutenticacaoProperties contrato,
            Optional<EntradaVisitante> visitantes, Clock relogio,
            @Value("${autonick.auth.origens-permitidas:}") String origens, br.com.ckgroup.autonick.osapi.plataforma.EnderecoCliente endereco) {
        this.endereco = endereco;
        this.origensPermitidas = Arrays.stream(origens.split(",")).map(String::trim).filter(o -> !o.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
        this.tokens = tokens;
        this.contas = contas;
        this.contrato = contrato;
        this.visitantes = visitantes.orElse(null);
        this.relogio = relogio;
    }

    public record Credenciais(String email, String password, String name) {
    }

    public record Pessoa(String pessoa) {
    }

    @PostMapping("/sign-in/email")
    ResponseEntity<?> entrar(@RequestBody(required = false) Credenciais c, HttpServletRequest pedido) {
        exigirMesmaOrigem(pedido);
        if (visitantes != null) return SO_PESSOAS_NA_PUBLICA;
        if (c == null || c.email() == null || c.password() == null) return erro(HttpStatus.UNAUTHORIZED, "E-mail ou senha incorretos.");
        Optional<ContasDemonstracao.Conta> conta = contas.porEmail(c.email().trim());
        if (conta.isEmpty() || !conta.get().valida(relogio.instant()) || !contas.senhaConfere(conta.get(), c.password())) {
            if (conta.isEmpty()) contas.senhaConfere(new ContasDemonstracao.Conta(null, null, null, null, null, null, null, 0, null, null), c.password());
            return erro(HttpStatus.UNAUTHORIZED, "E-mail ou senha incorretos.");
        }
        return sessaoAberta(conta.get());
    }

    @PostMapping("/sign-up/email")
    ResponseEntity<?> cadastrar(@RequestBody(required = false) Credenciais c, HttpServletRequest pedido) {
        exigirMesmaOrigem(pedido);
        if (visitantes != null) return SO_PESSOAS_NA_PUBLICA;
        if (!contrato.cadastroAberto()) return erro(HttpStatus.BAD_REQUEST, "Nesta demonstração, entre com uma das pessoas fictícias.");
        String email = c == null || c.email() == null ? "" : c.email().trim().toLowerCase();
        String nome = c == null || c.name() == null ? "" : c.name().trim();
        if (!EMAIL.matcher(email).matches()) {
            return erro(HttpStatus.BAD_REQUEST, "Na demonstração, use um e-mail fictício terminado em @autonick-teste.example.");
        }
        if (nome.length() < 2 || nome.length() > 80 || c.password() == null || c.password().length() < 8 || c.password().length() > 128) {
            return erro(HttpStatus.BAD_REQUEST, "Confira o nome e a senha (8 a 128 caracteres).");
        }
        if (contas.porEmail(email).isPresent()) return erro(HttpStatus.BAD_REQUEST, "Não foi possível criar a conta com esses dados.");
        UUID id = UUID.randomUUID();
        contas.criar(id, email, nome, c.password(), null, "cliente", "Conta criada na demonstração", 500, null, null);
        return ResponseEntity.ok(Map.of("user", usuario(contas.porId(id).orElseThrow())));
    }

    @GetMapping("/get-session")
    ResponseEntity<?> sessao(HttpServletRequest pedido) {
        Optional<ContasDemonstracao.Conta> conta = contaDaSessao(pedido);
        if (conta.isEmpty()) return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body("null");
        ContasDemonstracao.Conta c = conta.get();
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header("set-auth-jwt", tokens.acesso(c.id().toString(), c.email(), c.nome()))
                .body(Map.of("user", usuario(c), "session", Map.of("userId", c.id().toString())));
    }

    @PostMapping("/sign-out")
    ResponseEntity<?> sair(HttpServletRequest pedido) {
        exigirMesmaOrigem(pedido);
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO)).body(Map.of("success", true));
    }

    @GetMapping("/token/anonymous")
    ResponseEntity<?> anonimo() {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(Map.of("token", tokens.anonimo()));
    }

    /** Verificação de e-mail: as contas fictícias já nascem confirmadas. */
    @PostMapping("/email-otp/send-verification-otp")
    ResponseEntity<?> enviarCodigo() {
        return ResponseEntity.ok(Map.of("success", true));
    }

    @PostMapping({"/email-otp/verify-email", "/email-otp/request-password-reset", "/email-otp/reset-password",
            "/change-password", "/revoke-other-sessions"})
    ResponseEntity<?> indisponivel() {
        return erro(HttpStatus.BAD_REQUEST, "Indisponível na demonstração: as contas são fictícias.");
    }

    /** Pessoas fictícias que podem entrar sem senha (cenário fixo, ou o cenário do visitante na demonstração pública). */
    @GetMapping("/demo/pessoas")
    ResponseEntity<?> pessoas(HttpServletRequest pedido) {
        if (visitantes != null) return ResponseEntity.ok(Map.of("publica", true, "pessoas", visitantes.pessoasDisponiveis()));
        List<Map<String, Object>> lista = contas.doCenario(null).stream().map(AutenticacaoDemoController::resumo).toList();
        return ResponseEntity.ok(Map.of("publica", false, "senha", CenarioDemonstracao.SENHA_LOCAL, "pessoas", lista));
    }

    @PostMapping("/demo/entrar")
    ResponseEntity<?> entrarComoPessoa(@RequestBody(required = false) Pessoa p, HttpServletRequest pedido) {
        exigirMesmaOrigem(pedido);
        if (p == null || p.pessoa() == null || !p.pessoa().matches("[a-z0-9-]{1,40}")) return erro(HttpStatus.BAD_REQUEST, "Pessoa inválida.");
        if (visitantes != null) {
            Optional<ContasDemonstracao.Conta> atual = contaDaSessao(pedido);
            ContasDemonstracao.Conta conta = visitantes.entrar(p.pessoa(), atual.map(ContasDemonstracao.Conta::cenario).orElse(null), pedido);
            return sessaoAberta(conta);
        }
        Optional<ContasDemonstracao.Conta> conta = contas.doCenario(null).stream().filter(c -> p.pessoa().equals(c.pessoa())).findFirst();
        if (conta.isEmpty()) return erro(HttpStatus.NOT_FOUND, "Pessoa fictícia não encontrada.");
        return sessaoAberta(conta.get());
    }

    private Optional<ContasDemonstracao.Conta> contaDaSessao(HttpServletRequest pedido) {
        if (pedido.getCookies() == null) return Optional.empty();
        for (Cookie c : pedido.getCookies()) {
            if (!COOKIE.equals(c.getName())) continue;
            Optional<String> sub = tokens.lerSessao(c.getValue());
            if (sub.isEmpty()) return Optional.empty();
            try {
                return contas.porId(UUID.fromString(sub.get())).filter(conta -> conta.valida(relogio.instant()));
            } catch (IllegalArgumentException erro) {
                return Optional.empty();
            }
        }
        return Optional.empty();
    }

    private ResponseEntity<?> sessaoAberta(ContasDemonstracao.Conta conta) {
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookie(tokens.sessao(conta.id().toString()), TokensDemonstracao.SESSAO))
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(Map.of("user", usuario(conta), "redirect", false));
    }

    private String cookie(String valor, Duration validade) {
        return ResponseCookie.from(COOKIE, valor).httpOnly(true).secure(contrato.cookieSeguro()).sameSite("Lax")
                .path("/api/auth").maxAge(validade).build().toString();
    }

    /**
     * Pedidos que mudam a sessão só da mesma origem: o cookie é SameSite=Lax e, além disso, um Origin de outro site é
     * recusado (proteção contra entrar ou sair por outro site).
     */
    private void exigirMesmaOrigem(HttpServletRequest pedido) {
        String origem = pedido.getHeader("Origin");
        if (origem == null || origensPermitidas.contains(origem)) return;
        // X-Forwarded-Host só vale quando a conexão vem de um proxy confiável configurado (E11).
        String host = endereco.conexaoDeProxyConfiavel(pedido) ? pedido.getHeader("X-Forwarded-Host") : null;
        if (host == null) host = pedido.getHeader("Host");
        try {
            if (host != null && !host.equalsIgnoreCase(URI.create(origem).getAuthority())) {
                throw new OrigemRecusada();
            }
        } catch (IllegalArgumentException erro) {
            throw new OrigemRecusada();
        }
    }

    static final class OrigemRecusada extends RuntimeException {
        OrigemRecusada() {
            super("Origem não permitida.");
        }
    }

    @ExceptionHandler(OrigemRecusada.class)
    ResponseEntity<?> origemRecusada() {
        return erro(HttpStatus.FORBIDDEN, "Origem não permitida.");
    }

    @ExceptionHandler(EntradaVisitante.Recusa.class)
    ResponseEntity<?> recusaVisitante(EntradaVisitante.Recusa r) {
        return erro(r.status, r.getMessage());
    }

    private static Map<String, Object> usuario(ContasDemonstracao.Conta c) {
        Map<String, Object> u = new LinkedHashMap<>();
        u.put("id", c.id().toString());
        u.put("name", c.nome());
        u.put("email", c.email());
        u.put("emailVerified", true);
        return u;
    }

    static Map<String, Object> resumo(ContasDemonstracao.Conta c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pessoa", c.pessoa());
        m.put("nome", c.nome());
        m.put("area", c.area());
        m.put("descricao", c.descricao());
        m.put("email", c.email());
        return m;
    }

    private static ResponseEntity<?> erro(HttpStatus status, String mensagem) {
        return ResponseEntity.status(status).body(Map.of("message", mensagem, "code", status.name()));
    }
}
