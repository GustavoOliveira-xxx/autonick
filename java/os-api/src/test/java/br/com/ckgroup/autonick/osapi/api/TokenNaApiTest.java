package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_1;
import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.CenarioOs;
import br.com.ckgroup.autonick.osapi.apoio.ChavesDeTeste;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/** Teste J1 e T1 a T4 pela API, com o validador REAL da aplicação. */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class TokenNaApiTest extends ApiComBancoBase {

    private int status(String token) {
        return get("/api/cliente/ordens-servico", token).statusCode();
    }

    @Test
    @DisplayName("J1: JWT Ed25519 válido, assinado com chave local, passa pelo validador real e devolve as OS do Cliente 1")
    void j1Valido() {
        CenarioOs c = cenario();
        HttpResponse<String> r = get("/api/cliente/ordens-servico", CHAVES.token(CLIENTE_1));
        assertThat(r.statusCode()).isEqualTo(200);
        assertThat(ids(r.body())).isEqualTo(Set.of(c.os1, c.os3));
    }

    @Test
    @DisplayName("J1: emissor incorreto é recusado com 401")
    void j1EmissorIncorreto() {
        cenario();
        assertThat(status(CHAVES.token(CLIENTE_1, Map.of("iss", "https://outro-emissor.example")))).isEqualTo(401);
        assertThat(status(CHAVES.token(CLIENTE_1, Map.of("iss", ChavesDeTeste.EMISSOR + "/")))).isEqualTo(401);
    }

    @Test
    @DisplayName("J1: sem audiência configurada (contrato atual do Neon Auth), um 'aud' qualquer não bloqueia")
    void j1SemAudienciaNoContrato() {
        cenario();
        assertThat(status(CHAVES.token(CLIENTE_1, Map.of("aud", "qualquer")))).isEqualTo(200);
    }

    @Test
    @DisplayName("T1 a T4: sem token, sem assinatura, chave intrusa, assinatura adulterada, vencido e sem sub dão 401")
    void t1aT4() {
        cenario();
        long agora = Instant.now().getEpochSecond();
        assertThat(status(null)).as("T1 sem token").isEqualTo(401);
        assertThat(status(CHAVES.tokenSemAssinatura(CLIENTE_1))).as("T2 alg none").isEqualTo(401);
        Map<String, Object> claims = new HashMap<>(Map.of("iss", ChavesDeTeste.EMISSOR, "sub", CLIENTE_1, "exp", agora + 900));
        assertThat(status(CHAVES.assinar(Map.of("alg", "EdDSA", "kid", CHAVES.kid), claims, CHAVES.intrusa))).as("T2 chave intrusa").isEqualTo(401);
        String bom = CHAVES.token(CLIENTE_1);
        String adulterado = bom.substring(0, bom.lastIndexOf('.') + 1) + new StringBuilder(bom.substring(bom.lastIndexOf('.') + 1)).reverse();
        assertThat(status(adulterado)).as("T2 assinatura adulterada").isEqualTo(401);
        assertThat(status(CHAVES.token(CLIENTE_1, Map.of("exp", agora - 120)))).as("T3 vencido").isEqualTo(401);
        assertThat(status(CHAVES.token(CLIENTE_1, Map.of("sub", "")))).as("T4 sub vazio").isEqualTo(401);
        HashMap<String, Object> semSub = new HashMap<>();
        semSub.put("sub", null);
        assertThat(status(CHAVES.token(CLIENTE_1, semSub))).as("T4 sem sub").isEqualTo(401);
    }
}
