package br.com.ckgroup.autonick.osapi.demonstracao;

import br.com.ckgroup.autonick.osapi.config.AutenticacaoProperties;
import java.time.Clock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import br.com.ckgroup.autonick.osapi.plataforma.ConsultaTabelas;
import br.com.ckgroup.autonick.osapi.plataforma.ExecutorDados;
import br.com.ckgroup.autonick.osapi.plataforma.IsolamentoVisitante;
import br.com.ckgroup.autonick.osapi.plataforma.PoliticaDados;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;

/** Componentes do modo demonstração ({@code autonick.auth.modo=demo}). Fora dele, nada disto existe. */
@Configuration
@ConditionalOnProperty(name = "autonick.auth.modo", havingValue = "demo")
public class DemonstracaoConfig {

    @Bean
    TokensDemonstracao tokensDemonstracao(AutenticacaoProperties contrato, Clock relogio, PoliticaDados politica) {
        // Na demonstração pública pode haver várias instâncias: todas precisam do mesmo segredo, definido fora do código.
        if (politica.demonstracaoPublica() && (contrato.segredoDemo() == null || contrato.segredoDemo().isBlank())) {
            throw new IllegalStateException("A demonstração pública exige AUTONICK_DEMO_SEGREDO (32 caracteres ou mais).");
        }
        return new TokensDemonstracao(contrato, relogio);
    }

    @Bean
    ContasDemonstracao contasDemonstracao(JdbcTemplate jdbc) {
        return new ContasDemonstracao(jdbc);
    }

    @Bean
    CenarioDemonstracao cenarioDemonstracao(ExecutorDados executor, ConsultaTabelas tabelas, ContasDemonstracao contas,
            JdbcTemplate jdbc, ObjectMapper json) {
        return new CenarioDemonstracao(executor, tabelas, contas, jdbc, json);
    }

    /** Demonstração pública: cenário próprio por visitante e isolamento entre visitantes. */
    @Bean
    @ConditionalOnProperty(name = "autonick.dados.demonstracao-publica", havingValue = "true")
    EntradaVisitante entradaVisitante(CenarioDemonstracao cenario, ContasDemonstracao contas, JdbcTemplate jdbc, Clock relogio,
            AutenticacaoProperties contrato,
            @Value("${autonick.demo.validade-cenario:24h}") java.time.Duration validade,
            @Value("${autonick.demo.cenarios-por-origem-dia:3}") int porOrigem,
            @Value("${autonick.demo.cenarios-ativos-maximo:150}") int ativos) {
        return new CenariosVisitantes(cenario, contas, jdbc, relogio, validade, porOrigem, ativos, contrato.segredoDemo());
    }

    @Bean
    @ConditionalOnProperty(name = "autonick.dados.demonstracao-publica", havingValue = "true")
    IsolamentoVisitante isolamentoVisitante(JdbcTemplate jdbc, ObjectMapper json, Clock relogio) {
        return new IsolamentoVisitante(jdbc, json, relogio);
    }

    @Bean
    InicioDemonstracao inicioDemonstracao(CenarioDemonstracao cenario, ContasDemonstracao contas, JdbcTemplate jdbc,
            @Value("${autonick.demo.montar-cenario:false}") boolean montar) {
        return new InicioDemonstracao(cenario, contas, jdbc, montar);
    }
}
