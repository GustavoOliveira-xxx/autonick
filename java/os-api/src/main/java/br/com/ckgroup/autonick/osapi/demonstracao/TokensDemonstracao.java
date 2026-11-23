package br.com.ckgroup.autonick.osapi.demonstracao;

import br.com.ckgroup.autonick.osapi.config.AutenticacaoProperties;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;

/**
 * Tokens da DEMONSTRAÇÃO (modo {@code autonick.auth.modo=demo}), assinados com HMAC-SHA256 por um segredo só da
 * demonstração. Três tipos, conferidos pela claim {@code typ}:
 * <ul>
 *   <li>{@code acesso}: 15 minutos, papel authenticated, vai no cabeçalho Authorization (fica só na memória da aba);</li>
 *   <li>{@code anonimo}: 10 minutos, papel anonymous, só para a vitrine pública;</li>
 *   <li>{@code sessao}: 8 horas, só no cookie HttpOnly; NUNCA é aceito como token de acesso.</li>
 * </ul>
 * Nunca valida tokens do Neon e o Neon nunca aceita estes tokens.
 */
public class TokensDemonstracao implements JwtDecoder {

    static final Duration ACESSO = Duration.ofMinutes(15);
    static final Duration ANONIMO = Duration.ofMinutes(10);
    static final Duration SESSAO = Duration.ofHours(8);

    private final byte[] segredo;
    private final String emissor;
    private final Clock relogio;
    private final Duration tolerancia;

    public TokensDemonstracao(AutenticacaoProperties contrato, Clock relogio) {
        String configurado = contrato.segredoDemo();
        if (configurado != null && !configurado.isBlank()) {
            if (configurado.length() < 32) throw new IllegalArgumentException("autonick.auth.segredo-demo precisa de 32 caracteres ou mais.");
            this.segredo = configurado.getBytes(StandardCharsets.UTF_8);
        } else {
            this.segredo = new byte[32];
            new SecureRandom().nextBytes(this.segredo);
        }
        this.emissor = contrato.emissor();
        this.relogio = relogio;
        this.tolerancia = contrato.tolerancia();
    }

    public String acesso(String sub, String email, String nome) {
        return assinar(sub, "acesso", "authenticated", ACESSO, Map.of("email", email, "name", nome));
    }

    public String anonimo() {
        return assinar("anon-" + UUID.randomUUID(), "anonimo", "anonymous", ANONIMO, Map.of());
    }

    public String sessao(String sub) {
        return assinar(sub, "sessao", "authenticated", SESSAO, Map.of());
    }

    public Instant expiracaoSessao() {
        return relogio.instant().plus(SESSAO);
    }

    /** Sub de um cookie de sessão válido. */
    public Optional<String> lerSessao(String token) {
        try {
            JWTClaimsSet claims = verificar(token);
            return "sessao".equals(claims.getStringClaim("typ")) ? Optional.of(claims.getSubject()) : Optional.empty();
        } catch (Exception erro) {
            return Optional.empty();
        }
    }

    /** Validador dos tokens de acesso e anônimos (o cookie de sessão é recusado aqui). */
    @Override
    public Jwt decode(String token) throws JwtException {
        JWTClaimsSet claims;
        String tipo;
        try {
            claims = verificar(token);
            tipo = claims.getStringClaim("typ");
        } catch (JwtException erro) {
            throw erro;
        } catch (Exception erro) {
            throw new BadJwtException("Token inválido");
        }
        if (!"acesso".equals(tipo) && !"anonimo".equals(tipo)) throw new BadJwtException("Tipo de token não aceito");
        Map<String, Object> valores = new HashMap<>();
        claims.getClaims().forEach((k, v) -> valores.put(k, v instanceof Date d ? d.toInstant() : v));
        return Jwt.withTokenValue(token).header("alg", "HS256").claims(c -> c.putAll(valores)).build();
    }

    private JWTClaimsSet verificar(String token) throws Exception {
        SignedJWT jwt = SignedJWT.parse(token);
        if (!JWSAlgorithm.HS256.equals(jwt.getHeader().getAlgorithm())) throw new BadJwtException("Algoritmo não aceito");
        if (!jwt.verify(new MACVerifier(segredo))) throw new BadJwtException("Assinatura inválida");
        JWTClaimsSet claims = jwt.getJWTClaimsSet();
        if (!emissor.equals(claims.getIssuer())) throw new BadJwtException("Emissor inválido");
        Date exp = claims.getExpirationTime();
        if (exp == null || !relogio.instant().isBefore(exp.toInstant().plus(tolerancia))) throw new BadJwtException("Token vencido");
        String sub = claims.getSubject();
        if (sub == null || sub.isBlank() || sub.length() > 255) throw new BadJwtException("Token sem identidade");
        return claims;
    }

    private String assinar(String sub, String tipo, String papel, Duration validade, Map<String, Object> extras) {
        Instant agora = relogio.instant();
        JWTClaimsSet.Builder b = new JWTClaimsSet.Builder().issuer(emissor).subject(sub).issueTime(Date.from(agora))
                .expirationTime(Date.from(agora.plus(validade))).claim("typ", tipo).claim("role", papel)
                .jwtID(UUID.randomUUID().toString());
        extras.forEach(b::claim);
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), b.build());
            jwt.sign(new MACSigner(segredo));
            return jwt.serialize();
        } catch (JOSEException erro) {
            throw new IllegalStateException("Falha ao assinar token da demonstração", erro);
        }
    }
}
