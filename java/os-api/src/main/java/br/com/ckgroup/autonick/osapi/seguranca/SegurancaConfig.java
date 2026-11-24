package br.com.ckgroup.autonick.osapi.seguranca;

import br.com.ckgroup.autonick.osapi.config.AutenticacaoProperties;
import br.com.ckgroup.autonick.osapi.config.PwaProperties;
import br.com.ckgroup.autonick.osapi.demonstracao.TokensDemonstracao;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;

/**
 * Regras de acesso da API (deny by default):
 * <ul>
 *   <li>{@code /api/auth/**}: entrada da demonstração (só existe no modo demo);</li>
 *   <li>{@code POST /api/dados/rpc/*}: qualquer token válido; o catálogo decide o que o token anônimo pode chamar;</li>
 *   <li>{@code GET /api/dados/*}, GET em {@code /api/**} e as escritas de OS (J05 a J11): só token de PESSOA;</li>
 *   <li>{@code GET /api/saude}: verificação de funcionamento, sem dados;</li>
 *   <li>arquivos da PWA (GET fora de /api): só quando a API também entrega a PWA;</li>
 *   <li>todo o resto é negado.</li>
 * </ul>
 * Sem sessão de servidor e sem CSRF: os dados só aceitam o token Bearer (que fica na memória da aba). O cookie da
 * demonstração vale só em /api/auth (SameSite=Lax e conferência de Origin).
 */
@Configuration
public class SegurancaConfig {

    static final String PESSOA = "PESSOA";
    static final String ANONIMO = "ANONIMO";

    static final String CSP = String.join("; ", "default-src 'self'", "script-src 'self'", "style-src 'self'",
            "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'",
            "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'");

    @Bean
    Clock relogio() {
        return Clock.systemUTC();
    }

    @Bean
    @Primary
    JwtDecoder validadorToken(AutenticacaoProperties contrato, Clock relogio, Optional<TokensDemonstracao> demo) {
        if (contrato.demo()) return demo.orElseThrow(() -> new IllegalStateException("Modo demo sem emissor de tokens."));
        FonteChavesJwks chaves = new FonteChavesJwks(URI.create(contrato.jwksUri()), Duration.ofMinutes(1), relogio);
        return new ValidadorTokenNeonAuth(contrato, chaves, relogio);
    }

    @Bean
    SecurityFilterChain filtro(HttpSecurity http, JwtDecoder validador, PwaProperties pwa) throws Exception {
        String[] escritasOs = {"/api/business/ordens-servico/*/iniciar",
                "/api/business/ordens-servico/*/pausar", "/api/business/ordens-servico/*/retomar",
                "/api/business/ordens-servico/*/concluir", "/api/business/ordens-servico/*/reabrir",
                "/api/business/ordens-servico/*/encerrar",
                "/api/business/ordens-servico/*/publicar-atualizacao", "/api/business/ordens-servico/*/atualizar-dados",
                "/api/business/ordens-servico/*/registrar-garantia",
                "/api/business/ordens-servico/*/materiais", "/api/business/ordens-servico/*/materiais/*/reserva",
                "/api/business/ordens-servico/*/materiais/*/devolucao", "/api/business/ordens-servico/*/usos-material",
                "/api/business/ordens-servico/*/usos-material/*/decisao",
                "/api/cliente/ordens-servico/*/confirmar-recebimento", "/api/cliente/ordens-servico/*/pedir-revisao"};
        http.csrf(c -> c.disable())
                .httpBasic(b -> b.disable())
                .formLogin(f -> f.disable())
                .logout(l -> l.disable())
                .requestCache(r -> r.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .headers(h -> h.contentSecurityPolicy(c -> c.policyDirectives(CSP))
                        .referrerPolicy(r -> r.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN))
                        .permissionsPolicyHeader(p -> p.policy("camera=(), microphone=(), geolocation=()")))
                .authorizeHttpRequests(a -> {
                    a.requestMatchers(HttpMethod.GET, "/api/saude").permitAll()
                            .requestMatchers("/api/auth/**").permitAll()
                            .requestMatchers(HttpMethod.POST, "/api/dados/rpc/*").authenticated()
                            // Arquivos: o download decide no banco quem pode ler (visitante só vê arquivo público);
                            // o envio exige pessoa autenticada.
                            .requestMatchers(HttpMethod.GET, "/api/arquivos/*").permitAll()
                            .requestMatchers(HttpMethod.POST, "/api/arquivos").hasAuthority(PESSOA)
                            .requestMatchers(HttpMethod.GET, "/api/**").hasAuthority(PESSOA)
                            .requestMatchers(HttpMethod.POST, escritasOs).hasAuthority(PESSOA)
                            .requestMatchers("/api/**").denyAll();
                    if (pwa.ativa()) a.requestMatchers(HttpMethod.GET, "/**").permitAll();
                    a.anyRequest().denyAll();
                })
                .oauth2ResourceServer(o -> o.jwt(j -> j.decoder(validador).jwtAuthenticationConverter(jwt -> {
                    String papel = "anonymous".equals(jwt.getClaimAsString("role")) ? ANONIMO : PESSOA;
                    return new JwtAuthenticationToken(jwt, List.of(new SimpleGrantedAuthority(papel)), jwt.getSubject());
                })));
        return http.build();
    }
}
