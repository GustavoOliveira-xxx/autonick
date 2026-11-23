package br.com.ckgroup.autonick.osapi.plataforma;

import java.time.Duration;
import java.util.Set;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Limites da camada de dados.
 *
 * @param demonstracaoPublica  na demonstração pública: sem painel CK e sem as funções de {@code bloqueadasNaPublica}
 * @param escritasPorMinuto    escritas por identidade a cada minuto (0 = sem limite, como na demonstração local)
 * @param leiturasPorMinuto    leituras por identidade a cada minuto (0 = sem limite)
 * @param tempoMaximoComando   tempo máximo de cada comando no banco
 * @param bloqueadasNaPublica  funções recusadas na demonstração pública, além do domínio ADMIN_CK
 */
@ConfigurationProperties("autonick.dados")
public record PoliticaDados(boolean demonstracaoPublica, int escritasPorMinuto, int leiturasPorMinuto,
        Duration tempoMaximoComando, Set<String> bloqueadasNaPublica) {

    public PoliticaDados {
        if (tempoMaximoComando == null) tempoMaximoComando = Duration.ofSeconds(15);
        if (bloqueadasNaPublica == null) bloqueadasNaPublica = Set.of();
    }

    public boolean bloqueada(Dominio dominio, String funcao) {
        if (!demonstracaoPublica) return false;
        return dominio == Dominio.ADMIN_CK && !"sou_ck_admin".equals(funcao) || bloqueadasNaPublica.contains(funcao);
    }
}
