package br.com.ckgroup.autonick.osapi;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * API Java do AutoniCK (Spring Boot): cobre a camada de dados da PWA por
 * domínio ({@code plataforma.Dominio}), as rotas próprias de OS (J03 a J11), a autenticação da demonstração e a
 * entrega dos arquivos da PWA. As regras de negócio e de acesso continuam nas funções SQL; a API valida o token, passa
 * ao banco só a identidade validada, controla transações, limites e erros.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class OsApiApplication {
    public static void main(String[] args) {
        SpringApplication.run(OsApiApplication.class, args);
    }
}
