package br.com.ckgroup.autonick.osapi.dados;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_2;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste;
import br.com.ckgroup.autonick.osapi.apoio.CenarioOs;
import br.com.ckgroup.autonick.osapi.web.TradutorErrosBanco;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.postgresql.util.PSQLException;
import org.springframework.http.HttpStatus;

/** Plano J01: T5 (falha fechada sem identidade) e R3 (o papel da API não lê tabelas nem funções internas). */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
class IdentidadeNoBancoTest {

    @Test
    @DisplayName("T5: sem declarações do token, a função responde AUTH_REQUIRED e a API traduz para 401")
    void t5() throws Exception {
        BancoDeTeste.instancia().cenario();
        try (Connection c = BancoDeTeste.instancia().comoApi()) {
            c.setAutoCommit(false);
            try (Statement s = c.createStatement()) {
                s.execute("SET LOCAL ROLE authenticated");
                PSQLException erro = catchThrowableOfType(PSQLException.class, () -> s.executeQuery("SELECT public.minhas_os()"));
                assertThat(erro.getServerErrorMessage().getHint()).isEqualTo("AUTH_REQUIRED");
                assertThat(TradutorErrosBanco.traduzir("AUTH_REQUIRED", erro.getMessage()).status()).isEqualTo(HttpStatus.UNAUTHORIZED);
            } finally {
                c.rollback();
            }
        }
    }

    @Test
    @DisplayName("R3: o papel da API, sozinho, não lê ordens_servico nem executa funções internas")
    void r3SemPapel() throws Exception {
        BancoDeTeste.instancia().cenario();
        try (Connection c = BancoDeTeste.instancia().comoApi(); Statement s = c.createStatement()) {
            assertThatThrownBy(() -> s.executeQuery("SELECT count(*) FROM public.ordens_servico"))
                    .isInstanceOf(SQLException.class).hasMessageContaining("permission denied");
            assertThatThrownBy(() -> s.executeQuery("SELECT app_private.conceder_ck_admin('x', 'y')"))
                    .isInstanceOf(SQLException.class).hasMessageContaining("permission denied");
        }
    }

    @Test
    @DisplayName("R3: mesmo como authenticated com a identidade do Cliente 2, a leitura direta não traz a OS do Cliente 1")
    void r3ComoCliente() throws Exception {
        CenarioOs cenario = BancoDeTeste.instancia().cenario();
        try (Connection c = BancoDeTeste.instancia().comoApi()) {
            c.setAutoCommit(false);
            try (Statement s = c.createStatement()) {
                s.execute("SET LOCAL ROLE authenticated");
                try (PreparedStatement p = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
                    p.setString(1, "{\"sub\":\"" + CLIENTE_2 + "\",\"role\":\"authenticated\"}");
                    p.execute();
                }
                try (PreparedStatement p = c.prepareStatement("SELECT count(*) FROM public.ordens_servico WHERE id = ?::uuid")) {
                    p.setString(1, cenario.os1);
                    try (ResultSet r = p.executeQuery()) {
                        r.next();
                        assertThat(r.getInt(1)).isZero();
                    }
                } catch (SQLException negado) {
                    assertThat(negado.getMessage()).contains("permission denied");
                }
            } finally {
                c.rollback();
            }
        }
    }
}
