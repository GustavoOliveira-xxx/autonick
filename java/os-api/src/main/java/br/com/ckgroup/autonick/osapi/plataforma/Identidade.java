package br.com.ckgroup.autonick.osapi.plataforma;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Quem faz o pedido, a partir do token JÁ validado. O papel anônimo vem só de um token anônimo assinado (vitrine sem
 * login); qualquer outro token vale como pessoa autenticada com o "sub" do token. Nada vem do corpo do pedido.
 */
public record Identidade(String sub, boolean anonima) {

    public static Identidade de(Jwt jwt) {
        if (jwt == null) throw ErroDados.regra(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "Sessão ausente ou expirada.");
        boolean anonima = "anonymous".equals(jwt.getClaimAsString("role"));
        return new Identidade(jwt.getSubject(), anonima);
    }

    public String papel() {
        return anonima ? "anonymous" : "authenticated";
    }

    public Map<String, String> claims() {
        return anonima ? Map.of("role", "anonymous") : Map.of("sub", sub, "role", "authenticated");
    }
}
