package br.com.ckgroup.autonick.osapi.seguranca;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import br.com.ckgroup.autonick.osapi.apoio.ChavesDeTeste;
import br.com.ckgroup.autonick.osapi.config.AutenticacaoProperties;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;

/** Validador REAL (sem banco): roda em qualquer máquina, inclusive sem PostgreSQL e sem Docker. */
class ValidadorTokenNeonAuthTest {

    private static final ChavesDeTeste CHAVES = ChavesDeTeste.instancia();
    private static final String SUB = "eb0a0100-0000-4000-8000-000000000005";

    private static ValidadorTokenNeonAuth validador(String audiencia) {
        AutenticacaoProperties contrato = new AutenticacaoProperties(CHAVES.jwksUri(), ChavesDeTeste.EMISSOR, audiencia, Duration.ofSeconds(30));
        return new ValidadorTokenNeonAuth(contrato, new FonteChavesJwks(URI.create(CHAVES.jwksUri()), Duration.ofMinutes(1), Clock.systemUTC()), Clock.systemUTC());
    }

    @Test
    @DisplayName("token Ed25519 válido: aceita e devolve o sub")
    void valido() {
        Jwt jwt = validador(null).decode(CHAVES.token(SUB));
        assertThat(jwt.getSubject()).isEqualTo(SUB);
        assertThat(jwt.getExpiresAt()).isAfter(Instant.now());
    }

    @Test
    @DisplayName("recusa: emissor errado, vencido, ainda não válido, sem sub, sub vazio e sem validade")
    void claims() {
        long agora = Instant.now().getEpochSecond();
        ValidadorTokenNeonAuth v = validador(null);
        HashMap<String, Object> semSub = new HashMap<>();
        semSub.put("sub", null);
        HashMap<String, Object> semExp = new HashMap<>();
        semExp.put("exp", null);
        for (Map<String, Object> ajuste : new Map[] {
                Map.of("iss", "https://outro.example"), Map.of("exp", agora - 120), Map.of("nbf", agora + 600),
                semSub, Map.of("sub", "  "), semExp, Map.of("sub", "x".repeat(256))}) {
            assertThatThrownBy(() -> v.decode(CHAVES.token(SUB, ajuste))).as(ajuste.toString()).isInstanceOf(BadJwtException.class);
        }
    }

    @Test
    @DisplayName("recusa: alg none, HS256, chave intrusa, kid desconhecido, sem kid, assinatura adulterada e texto qualquer")
    void assinatura() {
        ValidadorTokenNeonAuth v = validador(null);
        long agora = Instant.now().getEpochSecond();
        Map<String, Object> claims = Map.of("iss", ChavesDeTeste.EMISSOR, "sub", SUB, "exp", agora + 900);
        String bom = CHAVES.token(SUB);
        String adulterado = bom.substring(0, bom.length() - 4) + (bom.endsWith("AAAA") ? "BBBB" : "AAAA");
        for (String token : new String[] {
                CHAVES.tokenSemAssinatura(SUB),
                CHAVES.assinar(Map.of("alg", "HS256", "kid", CHAVES.kid), claims, CHAVES.par),
                CHAVES.assinar(Map.of("alg", "EdDSA", "kid", CHAVES.kid), claims, CHAVES.intrusa),
                CHAVES.assinar(Map.of("alg", "EdDSA", "kid", "outra-chave"), claims, CHAVES.par),
                CHAVES.assinar(Map.of("alg", "EdDSA"), claims, CHAVES.par),
                adulterado, "nao.e.um-token", ""}) {
            assertThatThrownBy(() -> v.decode(token)).as(token).isInstanceOf(BadJwtException.class);
        }
    }

    @Test
    @DisplayName("audiência: sem configuração não é exigida; configurada, só a certa passa")
    void audiencia() {
        assertThat(validador(null).decode(CHAVES.token(SUB, Map.of("aud", "qualquer"))).getSubject()).isEqualTo(SUB);
        ValidadorTokenNeonAuth v = validador("autonick-os-api");
        assertThat(v.decode(CHAVES.token(SUB, Map.of("aud", "autonick-os-api"))).getSubject()).isEqualTo(SUB);
        assertThatThrownBy(() -> v.decode(CHAVES.token(SUB, Map.of("aud", "outra")))).isInstanceOf(BadJwtException.class);
        assertThatThrownBy(() -> v.decode(CHAVES.token(SUB))).isInstanceOf(BadJwtException.class);
    }
}
