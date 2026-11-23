package br.com.ckgroup.autonick.osapi.config;

import java.util.Locale;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * ADR-J01, J-05: por padrão a API só usa PostgreSQL local e recusa iniciar com um banco do Neon. A demonstração
 * PÚBLICA (banco exclusivo de demonstração, dados fictícios) liga {@code autonick.banco.permitir-remoto=true} de forma
 * explícita, e só junto com o modo demo; o branch de desenvolvimento e production continuam fora.
 */
@Component
public class SomenteBancoLocal implements InitializingBean {

    private final String url;
    private final boolean permitirRemoto;
    private final AutenticacaoProperties auth;

    public SomenteBancoLocal(@Value("${spring.datasource.url:}") String url,
            @Value("${autonick.banco.permitir-remoto:false}") boolean permitirRemoto, AutenticacaoProperties auth) {
        this.url = url;
        this.permitirRemoto = permitirRemoto;
        this.auth = auth;
    }

    @Override
    public void afterPropertiesSet() {
        if (!url.toLowerCase(Locale.ROOT).contains("neon.tech")) return;
        if (!permitirRemoto) {
            throw new IllegalStateException(
                    "A API usa só PostgreSQL local (ADR-J01, J-05). O Neon remoto exige autorização explícita.");
        }
        if (!auth.demo()) {
            throw new IllegalStateException("O banco remoto só é aceito na demonstração (autonick.auth.modo=demo), com dados fictícios.");
        }
    }
}
