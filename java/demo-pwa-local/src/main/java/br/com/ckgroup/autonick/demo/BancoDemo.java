package br.com.ckgroup.autonick.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Banco PostgreSQL LOCAL e descartável da demonstração (nunca o Neon). A cada início: apaga e recria
 * {@value #BANCO}, aplica db/tests/emulacao-neon.sql e as 22 migrations, recria o papel da API (LOGIN, NOINHERIT,
 * membro de authenticated, senha aleatória) e monta o cenário fictício pelas FUNÇÕES do app.
 */
public final class BancoDemo {

    public static final String BANCO = "autonick_demo_j03";
    public static final String PAPEL_API = "autonick_api_demo_j03";
    public static final String NOTA_INTERNA = "Nota interna da demonstração J03: levar o disjuntor reserva.";
    public static final String ATUALIZACAO_PUBLICA = "Atualização pública da demonstração J03: visita confirmada para amanhã às 9h.";
    private static final Pattern URL_JDBC = Pattern.compile("^(jdbc:postgresql://)([^/:]+|\\[[^]]+])(:\\d+)?/([^?]*)(.*)$");
    private static final Set<String> HOSTS_LOCAIS = Set.of("localhost", "127.0.0.1", "[::1]");
    private static final ObjectMapper JSON = new ObjectMapper();

    private final String urlAdmin;
    private final String usuarioAdmin;
    private final String senhaAdmin;
    public final String urlBanco;
    public final String senhaApi;
    private int chave;

    public String empresaA, empresaB, osCliente, osClienteOutraEmpresa, osOutroCliente, osOutraEmpresa, osIniciar, osVersao, osSemJava,
            osConfirmar, osRevisao, osVersaoCliente, osInterna, osInternaSemJava, osCiclo,
            osMateriais, osMateriais2, variacaoChuveiro, variacaoResistencia, variacaoDisjuntor, usoPendente;

    public BancoDemo(String urlAdmin, String usuarioAdmin, String senhaAdmin) {
        Matcher m = URL_JDBC.matcher(urlAdmin);
        if (!m.matches()) throw new IllegalArgumentException("URL JDBC inesperada: " + urlAdmin);
        String host = m.group(2).toLowerCase(Locale.ROOT);
        if (!HOSTS_LOCAIS.contains(host) || urlAdmin.toLowerCase(Locale.ROOT).contains("neon.tech")) {
            throw new IllegalArgumentException("A demonstração só usa PostgreSQL em localhost (ADR-J01, J-05).");
        }
        this.urlAdmin = urlAdmin;
        this.usuarioAdmin = usuarioAdmin;
        this.senhaAdmin = senhaAdmin;
        this.urlBanco = m.group(1) + m.group(2) + (m.group(3) == null ? "" : m.group(3)) + "/" + BANCO + m.group(5);
        byte[] b = new byte[18];
        new SecureRandom().nextBytes(b);
        this.senhaApi = HexFormat.of().formatHex(b);
    }

    public void preparar(Path raiz) throws Exception {
        try (Connection c = DriverManager.getConnection(urlAdmin, usuarioAdmin, senhaAdmin); Statement s = c.createStatement()) {
            s.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '" + BANCO + "' AND pid <> pg_backend_pid()");
            s.execute("DROP DATABASE IF EXISTS " + BANCO);
            s.execute("CREATE DATABASE " + BANCO);
        }
        try (Connection c = admin(); Statement s = c.createStatement()) {
            s.execute(Files.readString(raiz.resolve("db/tests/emulacao-neon.sql")));
            for (Path migration : migrations(raiz)) s.execute(Files.readString(migration));
            s.execute("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '" + PAPEL_API + "') THEN "
                    + "EXECUTE 'ALTER ROLE " + PAPEL_API + " LOGIN NOINHERIT PASSWORD ''" + senhaApi + "'''; "
                    + "ELSE EXECUTE 'CREATE ROLE " + PAPEL_API + " LOGIN NOINHERIT PASSWORD ''" + senhaApi + "'''; END IF; END $$");
            s.execute("GRANT authenticated TO " + PAPEL_API);
            s.execute("GRANT CONNECT ON DATABASE " + BANCO + " TO " + PAPEL_API);
        }
        semear();
    }

    private static List<Path> migrations(Path raiz) throws Exception {
        try (Stream<Path> arquivos = Files.list(raiz.resolve("db/migrations_propostas"))) {
            List<Path> lista = arquivos.filter(p -> p.getFileName().toString().matches("\\d{12}_.+\\.sql"))
                    .filter(p -> !p.getFileName().toString().endsWith(".down.sql")).sorted().toList();
            if (lista.size() != 22) throw new IllegalStateException("Esperadas 22 migrations, encontradas " + lista.size());
            return lista;
        }
    }

    public Connection admin() throws SQLException {
        return DriverManager.getConnection(urlBanco, usuarioAdmin, senhaAdmin);
    }

    /** Conexão do papel da API, com parâmetros de texto "sem tipo" (como a Data API): o banco resolve uuid, jsonb, etc. */
    public Connection comoApi() throws SQLException {
        String url = urlBanco + (urlBanco.contains("?") ? "&" : "?") + "stringtype=unspecified";
        return DriverManager.getConnection(url, PAPEL_API, senhaApi);
    }

    // ------------------------------------------------------------------------------------------------ cenário fictício

    private void semear() throws SQLException {
        for (Pessoas.Pessoa p : List.of(Pessoas.CLIENTE, Pessoas.GESTOR, Pessoas.OUTRO_CLIENTE, Pessoas.DONO_A, Pessoas.DONO_B, Pessoas.CK,
                Pessoas.TECNICO, Pessoas.CLIENTE_TRES, Pessoas.CLIENTE_QUATRO, Pessoas.AUXILIAR)) {
            adm("INSERT INTO neon_auth.\"user\" (id, email, name, \"emailVerified\") VALUES (?::uuid, ?, ?, true)", p.id(), p.email(), p.nome());
            comoUsuario(p.id(), "SELECT public.garantir_perfil(?, ?)::text", p.tipo(), p.nome());
        }
        adm("SELECT app_private.conceder_ck_admin(?, 'demonstração local J03 (dados fictícios)')", Pessoas.CK.id());
        empresaA = empresa(Pessoas.DONO_A.id(), "[TESTE] Elétrica Demo (J03)");
        empresaB = empresa(Pessoas.DONO_B.id(), "[TESTE] Outra Empresa (J03)");
        String servicoA = servico(Pessoas.DONO_A.id(), empresaA, "Instalação de chuveiro");
        String servicoB = servico(Pessoas.DONO_B.id(), empresaB, "Revisão elétrica");
        for (Pessoas.Pessoa c : List.of(Pessoas.CLIENTE, Pessoas.OUTRO_CLIENTE, Pessoas.CLIENTE_TRES, Pessoas.CLIENTE_QUATRO)) {
            adm("SELECT app_private.autorizar_demonstracao(?, 'demonstração local J03: cliente fictício', 'demonstração local J03 (SQL operacional)', 7)", c.id());
        }
        String perms = adm("SELECT string_agg(codigo, ',' ORDER BY codigo) FROM public.permissoes_catalogo "
                + "WHERE codigo NOT IN ('equipe.alterar', 'equipe.convidar', 'equipe.revogar')");
        String perfil = campo(comoUsuario(Pessoas.DONO_A.id(), "SELECT public.criar_perfil_permissao(?::uuid, 'Gestor da demonstração', NULL, string_to_array(?, ','), ?)::text",
                empresaA, perms, k()), "id");
        String convite = campo(comoUsuario(Pessoas.DONO_A.id(), "SELECT public.convidar_funcionario(?::uuid, ?, ?::uuid, ?)::text",
                empresaA, Pessoas.GESTOR.email(), perfil, k()), "id");
        comoUsuario(Pessoas.GESTOR.id(), "SELECT public.aceitar_convite(?::uuid, ?)::text", convite, k());
        // J05: técnico que vê as OS (servicos.visualizar) mas não pode alterá-las (sem servicos.alterar).
        String perfilTecnico = campo(comoUsuario(Pessoas.DONO_A.id(), "SELECT public.criar_perfil_permissao(?::uuid, 'Técnico sem alterar OS', NULL, string_to_array(?, ','), ?)::text",
                empresaA, "servicos.visualizar", k()), "id");
        String conviteTecnico = campo(comoUsuario(Pessoas.DONO_A.id(), "SELECT public.convidar_funcionario(?::uuid, ?, ?::uuid, ?)::text",
                empresaA, Pessoas.TECNICO.email(), perfilTecnico, k()), "id");
        comoUsuario(Pessoas.TECNICO.id(), "SELECT public.aceitar_convite(?::uuid, ?)::text", conviteTecnico, k());

        osCliente = contratar(Pessoas.CLIENTE.id(), servicoA, Pessoas.GESTOR.id());
        osOutroCliente = contratar(Pessoas.OUTRO_CLIENTE.id(), servicoA, Pessoas.GESTOR.id());
        osOutraEmpresa = contratar(Pessoas.OUTRO_CLIENTE.id(), servicoB, Pessoas.DONO_B.id());
        // J04: o Cliente também tem OS na outra empresa (a lista dele mostra as duas; o Gestor da Elétrica não vê esta).
        osClienteOutraEmpresa = contratar(Pessoas.CLIENTE.id(), servicoB, Pessoas.DONO_B.id());
        // J04: responsável definido numa OS da Elétrica, para o filtro por responsável da lista da empresa.
        comoUsuario(Pessoas.DONO_A.id(), "SELECT public.atualizar_dados_os(?::uuid, ?::jsonb, 1, ?)::text", osOutroCliente,
                json(Map.of("responsavel_auth_id", Pessoas.GESTOR.id())), k());
        // J05: três OS aguardando início, só para testar "Iniciar" (clique, versão desatualizada e API desligada).
        osIniciar = contratar(Pessoas.CLIENTE_TRES.id(), servicoA, Pessoas.GESTOR.id());
        osVersao = contratar(Pessoas.CLIENTE_TRES.id(), servicoA, Pessoas.GESTOR.id());
        osSemJava = contratar(Pessoas.CLIENTE_TRES.id(), servicoA, Pessoas.GESTOR.id());
        // J08: três OS da Cliente Quatro na Outra Empresa, já concluídas pela dona (com a conta a receber do saldo), para
        // "Confirmar que recebi" e "Pedir revisão". Ficam fora das listas do Cliente Demo e do Gestor da Elétrica.
        osConfirmar = concluida(Pessoas.CLIENTE_QUATRO.id(), servicoB, Pessoas.DONO_B.id());
        osRevisao = concluida(Pessoas.CLIENTE_QUATRO.id(), servicoB, Pessoas.DONO_B.id());
        osVersaoCliente = concluida(Pessoas.CLIENTE_QUATRO.id(), servicoB, Pessoas.DONO_B.id());
        // J09: duas OS INTERNAS da Elétrica (cliente de balcão fictício, sem conta na plataforma), contratadas e concluídas
        // pelas funções do app. Pela regra vigente, a empresa pode encerrar uma OS interna concluída sem esperar 7 dias;
        // nenhuma data é alterada. E uma OS da Cliente Quatro na Elétrica, aguardando início, para o ciclo completo.
        String clienteBalcao = campo(comoUsuario(Pessoas.DONO_A.id(), "SELECT public.criar_cliente(?::uuid, ?::jsonb, ?)::text",
                empresaA, json(Map.of("nome", "Seu Lauro do balcão (fictício J09)")), k()), "id");
        osInterna = concluidaInterna(clienteBalcao, servicoA);
        osInternaSemJava = concluidaInterna(clienteBalcao, servicoA);
        osCiclo = contratar(Pessoas.CLIENTE_QUATRO.id(), servicoA, Pessoas.GESTOR.id());
        // J11: produtos fictícios da Elétrica (estoque com 10, com a última unidade e esgotado), criados pela função do M05;
        // um auxiliar fictício que altera OS e propõe estoque, mas não aprova estoque; duas OS internas em execução: na
        // primeira, 3 chuveiros previstos e 1 uso registrado pelo auxiliar (pendente de confirmação); na segunda, a
        // resistência (última unidade) prevista, para a disputa com outra OS.
        variacaoChuveiro = produto("Chuveiro elétrico (fictício J11)", 10);
        variacaoResistencia = produto("Resistência de chuveiro (fictícia J11)", 1);
        variacaoDisjuntor = produto("Disjuntor (fictício J11, esgotado)", 0);
        String perfilAuxiliar = campo(comoUsuario(Pessoas.DONO_A.id(), "SELECT public.criar_perfil_permissao(?::uuid, 'Auxiliar sem aprovar estoque', NULL, string_to_array(?, ','), ?)::text",
                empresaA, "servicos.alterar,servicos.visualizar,estoque.propor", k()), "id");
        String conviteAuxiliar = campo(comoUsuario(Pessoas.DONO_A.id(), "SELECT public.convidar_funcionario(?::uuid, ?, ?::uuid, ?)::text",
                empresaA, Pessoas.AUXILIAR.email(), perfilAuxiliar, k()), "id");
        comoUsuario(Pessoas.AUXILIAR.id(), "SELECT public.aceitar_convite(?::uuid, ?)::text", conviteAuxiliar, k());
        String mudar = "SELECT public.mudar_estado_os(?::uuid, ?, NULL, ?, ?)::text";
        osMateriais = interna(clienteBalcao, servicoA);
        comoUsuario(Pessoas.GESTOR.id(), mudar, osMateriais, "iniciar", 1, k());
        comoUsuario(Pessoas.GESTOR.id(), "SELECT public.adicionar_material_os(?::uuid, ?::uuid, 3, ?)::text", osMateriais, variacaoChuveiro, k());
        usoPendente = campo(comoUsuario(Pessoas.AUXILIAR.id(), "SELECT public.registrar_uso_material(?::uuid, ?::uuid, 1, ?, ?)::text",
                osMateriais, variacaoChuveiro, "Instalado no banheiro (registrado pelo auxiliar)", k()), "uso_id");
        osMateriais2 = interna(clienteBalcao, servicoA);
        comoUsuario(Pessoas.GESTOR.id(), mudar, osMateriais2, "iniciar", 1, k());
        comoUsuario(Pessoas.GESTOR.id(), "SELECT public.adicionar_material_os(?::uuid, ?::uuid, 1, ?)::text", osMateriais2, variacaoResistencia, k());
        String publicar = "SELECT public.publicar_atualizacao_os(?::uuid, ?, ?, ?)::text";
        comoUsuario(Pessoas.GESTOR.id(), publicar, osCliente, NOTA_INTERNA, false, k());
        comoUsuario(Pessoas.GESTOR.id(), publicar, osCliente, ATUALIZACAO_PUBLICA, true, k());
    }

    private String empresa(String dono, String nome) throws SQLException {
        String categoria = adm("SELECT id::text FROM public.categorias_plataforma WHERE slug = 'construcao-reformas'");
        String dados = json(Map.of("nome_publico", nome, "modalidade", "servicos", "categoria_id", categoria, "cidade", "Campinas",
                "bairro", "Taquaral", "uf", "SP", "email_contato", "privado-j03@autonick-teste.example"));
        String id = campo(comoUsuario(dono, "SELECT public.criar_empresa(?::jsonb, ?)::text", dados, k()), "id");
        comoUsuario(dono, "SELECT public.enviar_vitrine_para_analise(?::uuid, ?, ?)::text", id, versao("empresas", id), k());
        String pedido = adm("SELECT id::text FROM public.solicitacoes_publicacao WHERE empresa_id = ?::uuid AND estado = 'aberta'", id);
        comoUsuario(Pessoas.CK.id(), "SELECT public.ck_decidir_solicitacao(?::uuid, 'aprovar', NULL, NULL, ?)::text", pedido, k());
        adm("SELECT app_private.marcar_empresa_de_teste(?::uuid, 'demonstração local J03: empresa fictícia')", id);
        return id;
    }

    private String servico(String dono, String empresa, String nome) throws SQLException {
        String dados = json(Map.of("nome", nome, "politica_preco", "sob_consulta", "modalidade", "analise_manual", "duracao_min", 120));
        String id = campo(comoUsuario(dono, "SELECT public.criar_servico(?::uuid, ?::jsonb, ?)::text", empresa, dados, k()), "id");
        comoUsuario(dono, "SELECT public.definir_vitrine_servico(?::uuid, true, ?, ?)::text", id, versao("servicos", id), k());
        return id;
    }

    /** OS contratada, iniciada e concluída pela empresa (versão 3), pelas mesmas funções SQL que a tela usa. */
    private String concluida(String cliente, String servico, String dono) throws SQLException {
        String os = contratar(cliente, servico, dono);
        String mudar = "SELECT public.mudar_estado_os(?::uuid, ?, NULL, ?, ?)::text";
        comoUsuario(dono, mudar, os, "iniciar", 1, k());
        comoUsuario(dono, mudar, os, "concluir", 2, k());
        return os;
    }

    /** Produto fictício de uso interno da Elétrica, com saldo inicial (função do M05); devolve a variação padrão. */
    private String produto(String nome, int quantidade) throws SQLException {
        String dados = json(Map.of("nome", nome, "finalidade", "uso_interno", "preco_centavos", 9000, "custo_centavos", 4500,
                "quantidade_inicial", quantidade));
        return ler(comoUsuario(Pessoas.DONO_A.id(), "SELECT public.criar_produto(?::uuid, ?::jsonb, NULL, ?)::text", empresaA, dados, k()))
                .get("variacoes").get(0).get("id").asText();
    }

    /** OS interna: solicitação, orçamento e aceite registrados pelo Gestor (M08); iniciada e concluída por ele (versão 3). */
    private String concluidaInterna(String clienteInterno, String servico) throws SQLException {
        String os = interna(clienteInterno, servico);
        String mudar = "SELECT public.mudar_estado_os(?::uuid, ?, NULL, ?, ?)::text";
        comoUsuario(Pessoas.GESTOR.id(), mudar, os, "iniciar", 1, k());
        comoUsuario(Pessoas.GESTOR.id(), mudar, os, "concluir", 2, k());
        return os;
    }

    /** OS interna aguardando início (versão 1), contratada pelas funções do app. */
    private String interna(String clienteInterno, String servico) throws SQLException {
        String gestor = Pessoas.GESTOR.id();
        String solicitacao = campo(comoUsuario(gestor, "SELECT public.criar_solicitacao_interna(?::uuid, ?::uuid, ?::uuid, ?::jsonb, ?)::text",
                empresaA, clienteInterno, servico, json(Map.of("relato", "Pedido interno fictício da demonstração J09.")), k()), "id");
        String componentes = json(Map.of("componentes", List.of(Map.of("tipo", "mao_de_obra", "descricao", "Mão de obra",
                "quantidade", 1, "valor_unitario_centavos", 18000))));
        JsonNode rascunho = ler(comoUsuario(gestor, "SELECT public.salvar_rascunho_orcamento(?::uuid, ?::jsonb, ?, ?)::text",
                solicitacao, componentes, versao("solicitacoes_servico", solicitacao), k()));
        JsonNode enviado = ler(comoUsuario(gestor, "SELECT public.enviar_orcamento(?::uuid, ?, ?)::text",
                rascunho.get("id").asText(), rascunho.get("versao").asInt(), k()));
        comoUsuario(gestor, "SELECT public.aceitar_orcamento(?::uuid, ?::uuid, true, ?)::text", solicitacao, enviado.get("id").asText(), k());
        return adm("SELECT id::text FROM public.ordens_servico WHERE solicitacao_id = ?::uuid", solicitacao);
    }

    private String contratar(String cliente, String servico, String orcamentista) throws SQLException {
        String solicitacao = campo(comoUsuario(cliente, "SELECT public.criar_solicitacao(?::uuid, ?::jsonb, ?)::text",
                servico, json(Map.of("relato", "Pedido fictício da demonstração J03.")), k()), "id");
        String componentes = json(Map.of("componentes", List.of(Map.of("tipo", "mao_de_obra", "descricao", "Mão de obra",
                "quantidade", 1, "valor_unitario_centavos", 18000))));
        JsonNode rascunho = ler(comoUsuario(orcamentista, "SELECT public.salvar_rascunho_orcamento(?::uuid, ?::jsonb, ?, ?)::text",
                solicitacao, componentes, versao("solicitacoes_servico", solicitacao), k()));
        JsonNode enviado = ler(comoUsuario(orcamentista, "SELECT public.enviar_orcamento(?::uuid, ?, ?)::text",
                rascunho.get("id").asText(), rascunho.get("versao").asInt(), k()));
        comoUsuario(cliente, "SELECT public.aceitar_orcamento(?::uuid, ?::uuid, true, ?)::text", solicitacao, enviado.get("id").asText(), k());
        return adm("SELECT id::text FROM public.ordens_servico WHERE solicitacao_id = ?::uuid", solicitacao);
    }

    private int versao(String tabela, String id) throws SQLException {
        return Integer.parseInt(adm("SELECT versao::text FROM public." + tabela + " WHERE id = ?::uuid", id));
    }

    private String k() {
        return "demo-j03-" + (++chave);
    }

    private String adm(String sql, Object... parametros) throws SQLException {
        try (Connection c = admin()) {
            return primeira(c, sql, parametros);
        }
    }

    private String comoUsuario(String sub, String sql, Object... parametros) throws SQLException {
        try (Connection c = admin()) {
            c.setAutoCommit(false);
            try {
                try (Statement s = c.createStatement()) {
                    s.execute("SET LOCAL ROLE authenticated");
                }
                primeira(c, "SELECT set_config('request.jwt.claims', ?, true)", json(Map.of("sub", sub, "role", "authenticated")));
                String r = primeira(c, sql, parametros);
                c.commit();
                return r;
            } catch (SQLException erro) {
                c.rollback();
                throw erro;
            }
        }
    }

    private static String primeira(Connection c, String sql, Object... parametros) throws SQLException {
        try (PreparedStatement p = c.prepareStatement(sql)) {
            for (int i = 0; i < parametros.length; i++) p.setObject(i + 1, parametros[i]);
            if (!p.execute()) return null;
            try (ResultSet r = p.getResultSet()) {
                return r.next() ? r.getString(1) : null;
            }
        }
    }

    static JsonNode ler(String json) {
        try {
            return JSON.readTree(json);
        } catch (Exception erro) {
            throw new IllegalStateException(erro);
        }
    }

    private static String campo(String json, String nome) {
        return ler(json).get(nome).asText();
    }

    static String json(Object valor) {
        try {
            return JSON.writeValueAsString(valor);
        } catch (Exception erro) {
            throw new IllegalStateException(erro);
        }
    }

    /** Endereço JDBC do banco da demonstração para a API Java (mesmo servidor local). */
    public String urlParaApi() {
        return urlBanco;
    }

    static boolean hostLocal(URI uri) {
        return uri.getHost() != null && HOSTS_LOCAIS.contains(uri.getHost().toLowerCase(Locale.ROOT));
    }
}
