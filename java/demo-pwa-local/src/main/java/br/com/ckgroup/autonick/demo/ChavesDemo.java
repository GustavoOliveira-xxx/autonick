package br.com.ckgroup.autonick.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Chave Ed25519 de TESTE, gerada a cada início (nunca salva, nunca real). Assina os tokens da demonstração no mesmo
 * formato do Neon Auth (EdDSA, kid, iss, sub, exp) e publica a JWKS que a API Java valida de verdade.
 */
public final class ChavesDemo {

    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();
    private static final ObjectMapper JSON = new ObjectMapper();
    public static final String KID = "demo-j03";

    private final KeyPair par;
    private final String emissor;

    public ChavesDemo(String emissor) throws Exception {
        this.par = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        this.emissor = emissor;
    }

    public String emissor() {
        return emissor;
    }

    public String jwks() throws Exception {
        byte[] codificada = par.getPublic().getEncoded();
        byte[] x = Arrays.copyOfRange(codificada, codificada.length - 32, codificada.length);
        return JSON.writeValueAsString(Map.of("keys", List.of(Map.of("kty", "OKP", "crv", "Ed25519", "kid", KID, "use", "sig",
                "alg", "EdDSA", "x", B64.encodeToString(x)))));
    }

    public String emitir(Pessoas.Pessoa pessoa) throws Exception {
        long agora = Instant.now().getEpochSecond();
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("iss", emissor);
        claims.put("sub", pessoa.id());
        claims.put("role", "authenticated");
        claims.put("email", pessoa.email());
        claims.put("name", pessoa.nome());
        claims.put("iat", agora);
        claims.put("exp", agora + 900);
        String entrada = B64.encodeToString(JSON.writeValueAsBytes(Map.of("alg", "EdDSA", "kid", KID, "typ", "JWT")))
                + "." + B64.encodeToString(JSON.writeValueAsBytes(claims));
        Signature assinador = Signature.getInstance("Ed25519");
        assinador.initSign(par.getPrivate());
        assinador.update(entrada.getBytes(StandardCharsets.US_ASCII));
        return entrada + "." + B64.encodeToString(assinador.sign());
    }

    /** Confere assinatura, emissor e validade de um token emitido aqui; devolve o sub. */
    public Optional<String> validar(String token) {
        try {
            String[] partes = token.split("\\.");
            if (partes.length != 3) return Optional.empty();
            JsonNode cabecalho = JSON.readTree(B64D.decode(partes[0]));
            if (!"EdDSA".equals(cabecalho.path("alg").asText()) || !KID.equals(cabecalho.path("kid").asText())) return Optional.empty();
            Signature verificador = Signature.getInstance("Ed25519");
            verificador.initVerify(par.getPublic());
            verificador.update((partes[0] + "." + partes[1]).getBytes(StandardCharsets.US_ASCII));
            if (!verificador.verify(B64D.decode(partes[2]))) return Optional.empty();
            JsonNode claims = JSON.readTree(B64D.decode(partes[1]));
            if (!emissor.equals(claims.path("iss").asText())) return Optional.empty();
            if (claims.path("exp").asLong() <= Instant.now().getEpochSecond()) return Optional.empty();
            String sub = claims.path("sub").asText("");
            return sub.isBlank() ? Optional.empty() : Optional.of(sub);
        } catch (Exception erro) {
            return Optional.empty();
        }
    }
}
