package br.com.ckgroup.autonick.osapi.api;

import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_1;
import static br.com.ckgroup.autonick.osapi.apoio.CenarioOs.CLIENTE_2;
import static org.assertj.core.api.Assertions.assertThat;

import br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste;
import br.com.ckgroup.autonick.osapi.apoio.CenarioOs;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Set;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

/**
 * Teste J2: com o pool reduzido a UMA conexão, um erro no pedido do Cliente 1 (depois de a
 * identidade dele ser aplicada) é desfeito no rollback, e o pedido seguinte, do Cliente 2, usa a MESMA conexão do
 * servidor (mesmo pg_backend_pid) sem herdar papel nem identidade.
 */
@EnabledIf("br.com.ckgroup.autonick.osapi.apoio.BancoDeTeste#disponivel")
@TestPropertySource(properties = {
        "spring.datasource.hikari.maximum-pool-size=1",
        "spring.datasource.hikari.minimum-idle=1"})
class PoolIdentidadeAposRollbackTest extends ApiComBancoBase {

    @Autowired
    DataSource pool;

    private record Estado(String pid, String usuario, String claims) {
    }

    private Estado estadoDaConexao() throws Exception {
        try (Connection c = pool.getConnection(); Statement s = c.createStatement();
             ResultSet r = s.executeQuery("SELECT pg_backend_pid()::text, current_user, coalesce(current_setting('request.jwt.claims', true), '')")) {
            r.next();
            return new Estado(r.getString(1), r.getString(2), r.getString(3));
        }
    }

    @Test
    @DisplayName("J2: erro do Cliente 1 com rollback; a mesma conexão atende o Cliente 2 sem a identidade anterior")
    void identidadeDescartadaAposRollback() throws Exception {
        CenarioOs c = cenario();
        String apiUsuario = BancoDeTeste.instancia().apiUsuario;
        Estado antes = estadoDaConexao();
        assertThat(antes.usuario()).isEqualTo(apiUsuario);
        assertThat(antes.claims()).isEmpty();

        // Cliente 1 consulta uma empresa da qual não é membro: a função roda COM a identidade dele (senão seria
        // AUTH_REQUIRED/401) e falha com TENANT_FORBIDDEN, provocando o rollback da transação.
        HttpResponse<String> erro = get("/api/empresas/" + c.empresaA + "/ordens-servico", CHAVES.token(CLIENTE_1));
        assertThat(erro.statusCode()).isEqualTo(403);
        assertThat(codigo(erro)).isEqualTo("TENANT_FORBIDDEN");

        Estado depoisDoErro = estadoDaConexao();
        assertThat(depoisDoErro.pid()).as("mesma conexão do servidor").isEqualTo(antes.pid());
        assertThat(depoisDoErro.usuario()).as("papel voltou ao da API").isEqualTo(apiUsuario);
        assertThat(depoisDoErro.claims()).as("identidade do Cliente 1 descartada").isEmpty();

        HttpResponse<String> cliente2 = get("/api/cliente/ordens-servico", CHAVES.token(CLIENTE_2));
        assertThat(cliente2.statusCode()).isEqualTo(200);
        assertThat(ids(cliente2.body())).isEqualTo(Set.of(c.os2)).doesNotContain(c.os1, c.os3);
        Estado depoisDoCliente2 = estadoDaConexao();
        assertThat(depoisDoCliente2.pid()).as("o Cliente 2 usou a mesma conexão").isEqualTo(antes.pid());
        assertThat(depoisDoCliente2.usuario()).as("papel voltou ao da API depois do commit").isEqualTo(apiUsuario);
        assertThat(depoisDoCliente2.claims()).as("identidade do Cliente 2 descartada depois do commit").isEmpty();
    }
}
