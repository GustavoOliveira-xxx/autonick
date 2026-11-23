package br.com.ckgroup.autonick.osapi.apoio;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Chaves Ed25519 geradas na hora (nunca reais) e tokens assinados como o Neon Auth: cabeçalho {alg: EdDSA, kid}, emissor,
 * sub e validade. A JWKS vai para um arquivo temporário lido pelo validador REAL da aplicação.
 */
public final class ChavesDeTeste {

    public static final String EMISSOR = "https://auth.autonick-teste.example";
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final ObjectMapper JSON = new ObjectMapper();
    private static ChavesDeTeste instancia;

    public final String kid = "chave-teste-1";
    public final KeyPair par;
    /** Outra chave, fora da JWKS: assina tokens que devem ser recusados. */
    public final KeyPair intrusa;
    public final Path jwks;

    private ChavesDeTeste() throws Exception {
        KeyPairGenerator gerador = KeyPairGenerator.getInstance("Ed25519");
        par = gerador.generateKeyPair();
        intrusa = gerador.generateKeyPair();
        jwks = Files.createTempFile("autonick-jwks-", ".json");
        jwks.toFile().deleteOnExit();
        Files.writeString(jwks, JSON.writeValueAsString(Map.of("keys", List.of(jwk(par, kid)))));
    }

    public static synchronized ChavesDeTeste instancia() {
        if (instancia == null) {
            try {
                instancia = new ChavesDeTeste();
            } catch (Exception erro) {
                throw new IllegalStateException(erro);
            }
        }
        return instancia;
    }

    public String jwksUri() {
        return jwks.toUri().toString();
    }

    private static Map<String, String> jwk(KeyPair par, String kid) {
        byte[] codificada = par.getPublic().getEncoded();
        byte[] x = Arrays.copyOfRange(codificada, codificada.length - 32, codificada.length);
        return Map.of("kty", "OKP", "crv", "Ed25519", "kid", kid, "use", "sig", "alg", "EdDSA", "x", B64.encodeToString(x));
    }

    /** Token válido para o sub, com 15 minutos de validade. */
    public String token(String sub) {
        return token(sub, Map.of());
    }

    /** Token com claims trocadas ou acrescentadas (valor null remove a claim). */
    public String token(String sub, Map<String, Object> ajustes) {
        Map<String, Object> claims = new LinkedHashMap<>();
        long agora = Instant.now().getEpochSecond();
        claims.put("iss", EMISSOR);
        claims.put("sub", sub);
        claims.put("iat", agora);
        claims.put("exp", agora + 900);
        claims.put("role", "authenticated");
        ajustes.forEach((k, v) -> {
            if (v == null) claims.remove(k);
            else claims.put(k, v);
        });
        return assinar(Map.of("alg", "EdDSA", "kid", kid, "typ", "JWT"), claims, par);
    }

    public String assinar(Map<String, Object> cabecalho, Map<String, Object> claims, KeyPair chave) {
        try {
            String entrada = B64.encodeToString(JSON.writeValueAsBytes(cabecalho)) + "." + B64.encodeToString(JSON.writeValueAsBytes(claims));
            Signature assinador = Signature.getInstance("Ed25519");
            assinador.initSign(chave.getPrivate());
            assinador.update(entrada.getBytes(StandardCharsets.US_ASCII));
            return entrada + "." + B64.encodeToString(assinador.sign());
        } catch (Exception erro) {
            throw new IllegalStateException(erro);
        }
    }

    /** Token sem assinatura ("alg": "none"). */
    public String tokenSemAssinatura(String sub) {
        try {
            long agora = Instant.now().getEpochSecond();
            return B64.encodeToString(JSON.writeValueAsBytes(Map.of("alg", "none", "kid", kid))) + "."
                    + B64.encodeToString(JSON.writeValueAsBytes(Map.of("iss", EMISSOR, "sub", sub, "exp", agora + 900))) + ".";
        } catch (Exception erro) {
            throw new IllegalStateException(erro);
        }
    }
}
