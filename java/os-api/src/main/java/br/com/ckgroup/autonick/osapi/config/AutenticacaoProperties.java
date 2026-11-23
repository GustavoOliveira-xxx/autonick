package br.com.ckgroup.autonick.osapi.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.ConstructorBinding;

/**
 * Contrato do token (ADR-J01, J-04).
 *
 * @param modo       {@code neon} (padrão): só valida tokens do Neon Auth pela JWKS; {@code demo}: a própria API emite e
 *                   valida tokens das contas FICTÍCIAS da demonstração (nunca aceita token do Neon nesse modo)
 * @param jwksUri    modo neon: endereço das chaves públicas (no Neon Auth: {auth}/.well-known/jwks.json)
 * @param emissor    valor exato esperado em "iss" (modo neon: a origem do Auth; modo demo: o emissor da demonstração)
 * @param audiencia  opcional: o contrato atual do Neon Auth não exige audiência; se configurada, passa a ser obrigatória
 * @param tolerancia tolerância de relógio para "exp" e "nbf"
 * @param segredoDemo modo demo: segredo (32+ caracteres) que assina os tokens; vazio = aleatório a cada início (uma
 *                   instância só). Nunca é um segredo do Neon ou de produção.
 * @param cookieSeguro modo demo: cookie de sessão só por HTTPS (ligar na demonstração pública)
 * @param cadastroAberto modo demo: permite criar contas fictícias novas pela tela de cadastro
 */
@ConfigurationProperties("autonick.auth")
public record AutenticacaoProperties(
        String modo,
        String jwksUri,
        String emissor,
        String audiencia,
        Duration tolerancia,
        String segredoDemo,
        boolean cookieSeguro,
        boolean cadastroAberto) {

    @ConstructorBinding
    public AutenticacaoProperties {
        if (modo == null || modo.isBlank()) modo = "neon";
        if (tolerancia == null) tolerancia = Duration.ofSeconds(30);
        if (!modo.equals("neon") && !modo.equals("demo")) throw new IllegalArgumentException("autonick.auth.modo deve ser neon ou demo");
        if (modo.equals("neon") && (jwksUri == null || jwksUri.isBlank() || emissor == null || emissor.isBlank())) {
            throw new IllegalArgumentException("No modo neon, autonick.auth.jwks-uri e autonick.auth.emissor são obrigatórios.");
        }
        if (modo.equals("demo") && (emissor == null || emissor.isBlank())) emissor = "autonick-demonstracao";
    }

    /** Compatível com os testes do J01 a J11. */
    public AutenticacaoProperties(String jwksUri, String emissor, String audiencia, Duration tolerancia) {
        this("neon", jwksUri, emissor, audiencia, tolerancia, null, false, false);
    }

    public boolean demo() {
        return modo.equals("demo");
    }

    public boolean exigeAudiencia() {
        return audiencia != null && !audiencia.isBlank();
    }
}
