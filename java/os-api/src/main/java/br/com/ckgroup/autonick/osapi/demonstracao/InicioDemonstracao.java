package br.com.ckgroup.autonick.osapi.demonstracao;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * No início da API em modo demo: se ainda não há cenário fixo e {@code autonick.demo.montar-cenario=true}, monta o
 * cenário fictício (só na primeira vez: os dados ficam entre execuções); depois renova as autorizações de demonstração
 * dos clientes fictícios. Nunca apaga dados.
 */
public class InicioDemonstracao implements ApplicationRunner {

    private static final Logger LOG = LoggerFactory.getLogger(InicioDemonstracao.class);

    private final CenarioDemonstracao cenario;
    private final ContasDemonstracao contas;
    private final JdbcTemplate jdbc;
    private final boolean montar;

    public InicioDemonstracao(CenarioDemonstracao cenario, ContasDemonstracao contas, JdbcTemplate jdbc,
            @Value("${autonick.demo.montar-cenario:false}") boolean montar) {
        this.cenario = cenario;
        this.contas = contas;
        this.jdbc = jdbc;
        this.montar = montar;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (montar && !contas.existeCenarioFixo()) {
            LOG.info("Montando o cenário fictício da demonstração (primeira execução)...");
            cenario.montar(CenarioDemonstracao.Destino.local());
        }
        Integer renovadas = jdbc.queryForObject("SELECT demo_auth.renovar_autorizacoes()", Integer.class);
        LOG.info("Demonstração pronta: {} clientes fictícios autorizados.", renovadas);
    }
}
