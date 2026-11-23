package br.com.ckgroup.autonick.osapi.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Entrega da PWA pela própria API, na mesma origem das rotas /api (sem CORS); usada na execução local.
 *
 * @param pasta   pasta {@code public/} do repositório; vazia = a API não entrega a PWA (por exemplo, com a PWA na Vercel)
 * @param backend nome do modo que a PWA mostra e usa: {@code java-local} ou {@code java-online}
 */
@ConfigurationProperties("autonick.pwa")
public record PwaProperties(String pasta, String backend) {

    public PwaProperties {
        if (backend == null || backend.isBlank()) backend = "java-local";
        if (!backend.equals("java-local") && !backend.equals("java-online")) {
            throw new IllegalArgumentException("autonick.pwa.backend deve ser java-local ou java-online");
        }
    }

    public boolean ativa() {
        return pasta != null && !pasta.isBlank();
    }
}
