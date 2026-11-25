package br.com.ckgroup.autonick.osapi.demonstracao;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Demonstração PÚBLICA: na primeira entrada, o visitante recebe um cenário fictício próprio (as mesmas empresas,
 * pessoas e movimentos do cenário local, montados pelas funções do app), sem senha e com validade. Trocar de pessoa
 * (Cliente, Gestor, Funcionário) continua no mesmo cenário. Sem CK: o painel administrativo não é oferecido ao público.
 *
 * Limites contra abuso: cenários novos por origem (endereço resumido por hash com segredo, nunca guardado em claro)
 * a cada 24 horas e cenários ativos no total. Cenários vencidos deixam de aceitar entrada; os dados ficam até a
 * restauração controlada do banco da demonstração (operação do responsável).
 */
public class CenariosVisitantes implements EntradaVisitante {

    private static final Logger LOG = LoggerFactory.getLogger(CenariosVisitantes.class);

    private final CenarioDemonstracao cenario;
    private final ContasDemonstracao contas;
    private final JdbcTemplate jdbc;
    private final Clock relogio;
    private final Duration validade;
    private final int porOrigemPorDia;
    private final int ativosNoMaximo;
    private final byte[] sal;

    private final br.com.ckgroup.autonick.osapi.plataforma.EnderecoCliente enderecoCliente;

    public CenariosVisitantes(CenarioDemonstracao cenario, ContasDemonstracao contas, JdbcTemplate jdbc, Clock relogio,
            Duration validade, int porOrigemPorDia, int ativosNoMaximo, String segredo, br.com.ckgroup.autonick.osapi.plataforma.EnderecoCliente enderecoCliente) {
        this.enderecoCliente = enderecoCliente;
        this.cenario = cenario;
        this.contas = contas;
        this.jdbc = jdbc;
        this.relogio = relogio;
        this.validade = validade;
        this.porOrigemPorDia = porOrigemPorDia;
        this.ativosNoMaximo = ativosNoMaximo;
        this.sal = (segredo == null ? UUID.randomUUID().toString() : segredo).getBytes(StandardCharsets.UTF_8);
    }

    @Override
    public List<Map<String, Object>> pessoasDisponiveis() {
        return CenarioDemonstracao.PESSOAS.stream().filter(d -> !d.area().equals("ck"))
                .map(d -> Map.<String, Object>of("pessoa", d.pessoa(), "nome", d.nome(), "area", d.area(), "descricao", d.descricao()))
                .toList();
    }

    @Override
    public ContasDemonstracao.Conta entrar(String pessoa, UUID cenarioAtual, HttpServletRequest pedido) {
        if (CenarioDemonstracao.PESSOAS.stream().noneMatch(d -> d.pessoa().equals(pessoa) && !d.area().equals("ck"))) {
            throw new Recusa(HttpStatus.NOT_FOUND, "Pessoa fictícia não encontrada.");
        }
        if (cenarioAtual != null) {
            Optional<ContasDemonstracao.Conta> conta = contaDaPessoa(cenarioAtual, pessoa);
            if (conta.isPresent()) return conta.get();
        }
        UUID novo = criarCenario(origem(pedido));
        return contaDaPessoa(novo, pessoa).orElseThrow(() -> new Recusa(HttpStatus.SERVICE_UNAVAILABLE, "Não foi possível preparar a demonstração."));
    }

    private Optional<ContasDemonstracao.Conta> contaDaPessoa(UUID id, String pessoa) {
        Instant agora = relogio.instant();
        return contas.doCenario(id).stream().filter(c -> pessoa.equals(c.pessoa()) && c.valida(agora)).findFirst();
    }

    private synchronized UUID criarCenario(String origem) {
        Timestamp agora = Timestamp.from(relogio.instant());
        Integer daOrigem = jdbc.queryForObject("SELECT count(*) FROM demo_auth.cenarios WHERE origem = ? AND criado_em > ?::timestamptz - interval '24 hours'",
                Integer.class, origem, agora);
        if (daOrigem != null && daOrigem >= porOrigemPorDia) {
            throw new Recusa(HttpStatus.TOO_MANY_REQUESTS, "Você já criou o limite de demonstrações de hoje. Use a sua demonstração atual ou volte amanhã.");
        }
        Integer ativos = jdbc.queryForObject("SELECT count(*) FROM demo_auth.cenarios WHERE expira_em > ?", Integer.class, agora);
        if (ativos != null && ativos >= ativosNoMaximo) {
            throw new Recusa(HttpStatus.SERVICE_UNAVAILABLE, "A demonstração está com muitas visitas agora. Tente de novo mais tarde.");
        }
        UUID id = UUID.randomUUID();
        Instant expira = relogio.instant().plus(validade);
        jdbc.queryForObject("SELECT demo_auth.criar_cenario(?, ?, ?)::text", String.class, id, origem, Timestamp.from(expira));
        String prefixo = "v" + id.toString().substring(0, 8) + "-";
        long inicio = System.currentTimeMillis();
        cenario.montar(new CenarioDemonstracao.Destino(id, prefixo, null, expira, false));
        LOG.info("Cenário de visitante criado em {} ms.", System.currentTimeMillis() - inicio);
        return id;
    }

    /** Origem do visitante resumida por hash com segredo (o endereço não é guardado). */
    private String origem(HttpServletRequest pedido) {
        String endereco = enderecoCliente.de(pedido);
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            sha.update(sal);
            return HexFormat.of().formatHex(sha.digest(endereco.getBytes(StandardCharsets.UTF_8))).substring(0, 32);
        } catch (Exception erro) {
            throw new IllegalStateException(erro);
        }
    }
}
