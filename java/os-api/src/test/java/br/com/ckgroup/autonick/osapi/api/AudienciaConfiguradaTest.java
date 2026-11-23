package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_1;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.test.context.TestPropertySource;

/**
 * Novo teste J1, parte da audiência. O contrato atual do Neon Auth NÃO exige audiência; se um dia exigir, a configuração
 * autonick.auth.audiencia passa a valer. Aqui ela está ligada para provar a recusa de audiência errada ou ausente.
 */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
@TestPropertySource(properties = "autonick.auth.audiencia=autonick-os-api")
class AudienciaConfiguradaTest extends ApiComBancoBase {

    private int status(Map<String, Object> ajustes) {
        return get("/api/cliente/ordens-servico", CHAVES.token(CLIENTE_1, ajustes)).statusCode();
    }

    @Test
    @DisplayName("J1: com audiência configurada, 'aud' certa passa; errada ou ausente dá 401")
    void audiencia() {
        cenario();
        assertThat(status(Map.of("aud", "autonick-os-api"))).isEqualTo(200);
        assertThat(status(Map.of("aud", List.of("outra", "autonick-os-api")))).isEqualTo(200);
        assertThat(status(Map.of("aud", "outra-api"))).isEqualTo(401);
        HashMap<String, Object> semAud = new HashMap<>();
        semAud.put("aud", null);
        assertThat(status(semAud)).isEqualTo(401);
    }
}
