package br.com.ckgroup.autonick.osapi.seguranca;

import br.com.ckgroup.autonick.osapi.config.AutenticacaoProperties;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.OctetKeyPair;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.Clock;
import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;

/**
 * Validador do token do Neon Auth (ADR-J01, J-04): assinatura EdDSA com chave Ed25519 da JWKS, emissor exato, validade,
 * "nbf" quando houver, "sub" obrigatório e audiência só quando configurada. Qualquer falha vira 401, sem tocar o banco.
 *
 * A verificação usa o Ed25519 nativo do Java (JCA), sem biblioteca extra.
 */
public class ValidadorTokenNeonAuth implements JwtDecoder {

    /** Prefixo DER (SubjectPublicKeyInfo) de uma chave pública Ed25519 de 32 bytes. */
    private static final byte[] PREFIXO_ED25519 = HexFormat.of().parseHex("302a300506032b6570032100");
    private static final Set<JWSAlgorithm> ALGORITMOS = Set.of(JWSAlgorithm.EdDSA);
    private static final int TAMANHO_MAXIMO_SUB = 255;

    private final AutenticacaoProperties contrato;
    private final FonteChavesJwks chaves;
    private final Clock relogio;

    public ValidadorTokenNeonAuth(AutenticacaoProperties contrato, FonteChavesJwks chaves, Clock relogio) {
        this.contrato = contrato;
        this.chaves = chaves;
        this.relogio = relogio;
    }

    @Override
    public Jwt decode(String token) throws JwtException {
        SignedJWT jwt;
        try {
            jwt = SignedJWT.parse(token);
        } catch (Exception erro) {
            throw new BadJwtException("Token malformado");
        }
        JWSHeader cabecalho = jwt.getHeader();
        if (!ALGORITMOS.contains(cabecalho.getAlgorithm())) throw new BadJwtException("Algoritmo não aceito");
        if (cabecalho.getKeyID() == null) throw new BadJwtException("Token sem identificador de chave");
        JWK jwk = chaves.chave(cabecalho.getKeyID()).orElseThrow(() -> new BadJwtException("Chave desconhecida"));
        if (!(jwk instanceof OctetKeyPair okp) || !Curve.Ed25519.equals(okp.getCurve())) {
            throw new BadJwtException("Chave não é Ed25519");
        }
        if (!assinaturaValida(jwt, okp)) throw new BadJwtException("Assinatura inválida");

        JWTClaimsSet claims;
        try {
            claims = jwt.getJWTClaimsSet();
        } catch (Exception erro) {
            throw new BadJwtException("Conteúdo do token inválido");
        }
        validarClaims(claims);
        return paraJwt(token, cabecalho, claims);
    }

    private boolean assinaturaValida(SignedJWT jwt, OctetKeyPair okp) {
        try {
            byte[] x = okp.getDecodedX();
            byte[] der = new byte[PREFIXO_ED25519.length + x.length];
            System.arraycopy(PREFIXO_ED25519, 0, der, 0, PREFIXO_ED25519.length);
            System.arraycopy(x, 0, der, PREFIXO_ED25519.length, x.length);
            PublicKey publica = KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(der));
            Signature verificador = Signature.getInstance("Ed25519");
            verificador.initVerify(publica);
            verificador.update(jwt.getSigningInput());
            return verificador.verify(jwt.getSignature().decode());
        } catch (Exception erro) {
            return false;
        }
    }

    private void validarClaims(JWTClaimsSet claims) {
        Instant agora = relogio.instant();
        if (!contrato.emissor().equals(claims.getIssuer())) throw new BadJwtException("Emissor inválido");
        Date exp = claims.getExpirationTime();
        if (exp == null) throw new BadJwtException("Token sem validade");
        if (!agora.isBefore(exp.toInstant().plus(contrato.tolerancia()))) throw new BadJwtException("Token vencido");
        Date nbf = claims.getNotBeforeTime();
        if (nbf != null && agora.plus(contrato.tolerancia()).isBefore(nbf.toInstant())) {
            throw new BadJwtException("Token ainda não válido");
        }
        String sub = claims.getSubject();
        if (sub == null || sub.isBlank() || sub.length() > TAMANHO_MAXIMO_SUB) throw new BadJwtException("Token sem identidade");
        if (contrato.exigeAudiencia() && (claims.getAudience() == null || !claims.getAudience().contains(contrato.audiencia()))) {
            throw new BadJwtException("Audiência inválida");
        }
    }

    private static Jwt paraJwt(String token, JWSHeader cabecalho, JWTClaimsSet claims) {
        Map<String, Object> valores = new HashMap<>();
        claims.getClaims().forEach((nome, valor) -> valores.put(nome, valor instanceof Date d ? d.toInstant() : valor));
        return Jwt.withTokenValue(token)
                .headers(h -> h.putAll(cabecalho.toJSONObject()))
                .claims(c -> c.putAll(valores))
                .build();
    }
}
