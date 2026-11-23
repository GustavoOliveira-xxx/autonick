package br.com.ckgroup.autonick.osapi.demonstracao;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/** Contas FICTÍCIAS de entrada da demonstração (schema demo_auth). Senhas só com hash BCrypt. */
public class ContasDemonstracao {

    public static final String SEM_SENHA = "!sem-senha";
    public static final String DOMINIO = "@autonick-teste.example";

    public record Conta(UUID id, String email, String nome, String senhaHash, String pessoa, String area, String descricao,
            int ordem, UUID cenario, Instant expiraEm) {

        public boolean valida(Instant agora) {
            return expiraEm == null || agora.isBefore(expiraEm);
        }
    }

    private static final RowMapper<Conta> LINHA = (r, i) -> new Conta(r.getObject("id", UUID.class), r.getString("email"),
            r.getString("nome"), r.getString("senha_hash"), r.getString("pessoa"), r.getString("area"), r.getString("descricao"),
            r.getInt("ordem"), r.getObject("cenario", UUID.class),
            r.getTimestamp("expira_em") == null ? null : r.getTimestamp("expira_em").toInstant());
    private static final String COLUNAS = "id, email, nome, senha_hash, pessoa, area, descricao, ordem, cenario, expira_em";

    private final JdbcTemplate jdbc;
    private final BCryptPasswordEncoder hash = new BCryptPasswordEncoder(10);
    private final String hashFalso = hash.encode(UUID.randomUUID().toString());

    public ContasDemonstracao(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Conta> porId(UUID id) {
        return jdbc.query("SELECT " + COLUNAS + " FROM demo_auth.contas WHERE id = ?", LINHA, id).stream().findFirst();
    }

    public Optional<Conta> porEmail(String email) {
        return jdbc.query("SELECT " + COLUNAS + " FROM demo_auth.contas WHERE email = lower(?)", LINHA, email).stream().findFirst();
    }

    /** Pessoas do cenário fixo (demonstração local) ou do cenário do visitante. */
    public List<Conta> doCenario(UUID cenario) {
        return cenario == null
                ? jdbc.query("SELECT " + COLUNAS + " FROM demo_auth.contas WHERE cenario IS NULL AND pessoa IS NOT NULL ORDER BY ordem, nome", LINHA)
                : jdbc.query("SELECT " + COLUNAS + " FROM demo_auth.contas WHERE cenario = ? ORDER BY ordem, nome", LINHA, cenario);
    }

    public boolean existeCenarioFixo() {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM demo_auth.contas WHERE cenario IS NULL AND pessoa IS NOT NULL)", Boolean.class));
    }

    public boolean senhaConfere(Conta conta, String senha) {
        if (senha == null || conta.senhaHash() == null || conta.senhaHash().startsWith("!")) {
            hash.matches("x", hashFalso); // mesmo tempo de resposta
            return false;
        }
        return hash.matches(senha, conta.senhaHash());
    }

    /** Cria a conta fictícia com e-mail confirmado. {@code senha} nula: só entra pelo botão da pessoa. */
    public UUID criar(UUID id, String email, String nome, String senha, String pessoa, String area, String descricao, int ordem,
            UUID cenario, Instant expiraEm) {
        String senhaHash = senha == null ? SEM_SENHA : hash.encode(senha);
        jdbc.queryForObject("SELECT demo_auth.criar_conta(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", UUID.class, id, email, nome, senhaHash,
                pessoa, area, descricao, ordem, cenario, expiraEm == null ? null : Timestamp.from(expiraEm));
        return id;
    }
}
