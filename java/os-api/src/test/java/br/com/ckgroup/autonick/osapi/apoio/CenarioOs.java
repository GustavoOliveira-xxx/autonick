package br.com.ckgroup.autonick.osapi.apoio;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Map;

/**
 * Cenário fictício montado pelas FUNÇÕES do app (não por INSERT direto), como em tests/db/regressao-a8-cliente-gestor:
 * duas empresas [TESTE] aprovadas pela CK e marcadas como teste, Gestor A por convite com o perfil "Gestor da
 * demonstração" (catálogo menos a gestão de equipe), membro sem servicos.visualizar e três OS nascidas no aceite.
 */
public final class CenarioOs {

    private static final ObjectMapper JSON = new ObjectMapper();

    public static final String DONO_A = id(1), GESTOR_A = id(2), MEMBRO_SEM_VISAO = id(3), DONO_B = id(4),
            CLIENTE_1 = id(5), CLIENTE_2 = id(6), CK = id(7), SEM_PERFIL = id(8), CLIENTE_ESCRITA = id(9),
            /** J10: segunda cliente das OS de escrita, para não esgotar o limite diário de 100 solicitações por cliente. */
            CLIENTE_ACOMPANHAMENTO = id(10);

    public String empresaA, empresaB, servicoA, servicoB, os1, os2, os3, empresaEscrita;
    private String servicoEscrita;
    private final BancoDeTeste banco;
    private int chave;

    private static String id(int n) {
        return String.format("eb0a0100-0000-4000-8000-0000000000%02d", n);
    }

    private CenarioOs(BancoDeTeste banco) {
        this.banco = banco;
    }

    static CenarioOs montar(BancoDeTeste banco) throws SQLException {
        CenarioOs c = new CenarioOs(banco);
        c.criar();
        return c;
    }

    private void criar() throws SQLException {
        Object[][] pessoas = {
                {DONO_A, "dono-a-j01", "Dono da Elétrica A (fictício)", "business"},
                {GESTOR_A, "gestor-a-j01", "Gestor A (fictício)", "business"},
                {MEMBRO_SEM_VISAO, "membro-j01", "Membro sem visão (fictício)", "business"},
                {DONO_B, "dono-b-j01", "Dona da Empresa B (fictícia)", "business"},
                {CLIENTE_1, "cliente-1-j01", "Cliente 1 (fictício)", "cliente"},
                {CLIENTE_2, "cliente-2-j01", "Cliente 2 (fictícia)", "cliente"},
                {CLIENTE_ESCRITA, "cliente-escrita-j06", "Cliente de escrita (fictício)", "cliente"},
                {CLIENTE_ACOMPANHAMENTO, "cliente-acompanhamento-j10", "Cliente de acompanhamento (fictícia)", "cliente"},
                {CK, "ck-j01", "CK fictícia", "business"},
        };
        for (Object[] p : pessoas) {
            adm("INSERT INTO neon_auth.\"user\" (id, email, name, \"emailVerified\") VALUES (?::uuid, ?, ?, true)",
                    p[0], p[1] + "@autonick-teste.example", p[2]);
            comoUsuario((String) p[0], "SELECT public.garantir_perfil(?, ?)::text", p[3], p[2]);
        }
        adm("SELECT app_private.conceder_ck_admin(?, 'teste J01 (banco local)')", CK);

        empresaA = empresa(DONO_A, "[TESTE] Elétrica A (J01)");
        empresaB = empresa(DONO_B, "[TESTE] Empresa B (J01)");
        servicoA = servico(DONO_A, empresaA, "Instalação de chuveiro");
        servicoB = servico(DONO_B, empresaB, "Revisão elétrica");
        empresaEscrita = empresa(DONO_A, "[TESTE] Empresa de escrita (J06)");
        servicoEscrita = servico(DONO_A, empresaEscrita, "Serviço para testar escrita");
        // Só no banco de teste: os testes de escrita (J05 a J07) criam muitas OS novas da mesma cliente fictícia no mesmo
        // dia; o limite diário vai ao máximo que a própria plataforma permite (100). Nenhuma regra de OS depende dele.
        adm("UPDATE app_private.limites_plataforma SET valor = maximo WHERE chave = 'solicitacoes_novas_por_dia'");
        for (String cliente : List.of(CLIENTE_1, CLIENTE_2, CLIENTE_ESCRITA, CLIENTE_ACOMPANHAMENTO)) {
            adm("SELECT app_private.autorizar_demonstracao(?, 'teste J01: cliente da área de demonstração', 'teste J01 (SQL operacional)', 7)", cliente);
        }

        String gestao = adm("SELECT string_agg(codigo, ',' ORDER BY codigo) FROM public.permissoes_catalogo "
                + "WHERE codigo NOT IN ('equipe.alterar', 'equipe.convidar', 'equipe.revogar')");
        convidar(empresaA, perfil(empresaA, "Gestor da demonstração", gestao), GESTOR_A, "gestor-a-j01@autonick-teste.example");
        convidar(empresaA, perfil(empresaA, "Só clientes", "clientes.visualizar"), MEMBRO_SEM_VISAO, "membro-j01@autonick-teste.example");

        convidar(empresaEscrita, perfil(empresaEscrita, "Gestor de escrita", gestao), GESTOR_A, "gestor-a-j01@autonick-teste.example");
        convidar(empresaEscrita, perfil(empresaEscrita, "Só clientes", "clientes.visualizar"), MEMBRO_SEM_VISAO, "membro-j01@autonick-teste.example");

        os1 = contratar(CLIENTE_1, servicoA, GESTOR_A);
        os2 = contratar(CLIENTE_2, servicoA, GESTOR_A);
        os3 = contratar(CLIENTE_1, servicoB, DONO_B);
    }

    private String empresa(String dono, String nome) throws SQLException {
        String categoria = adm("SELECT id::text FROM public.categorias_plataforma WHERE slug = 'construcao-reformas'");
        String dados = json(Map.of("nome_publico", nome, "modalidade", "servicos", "categoria_id", categoria, "cidade", "Campinas",
                "bairro", "Taquaral", "uf", "SP", "email_contato", "privado-j01@autonick-teste.example"));
        String id = campo(comoUsuario(dono, "SELECT public.criar_empresa(?::jsonb, ?)::text", dados, k()), "id");
        comoUsuario(dono, "SELECT public.enviar_vitrine_para_analise(?::uuid, ?, ?)::text", id, versao("empresas", id), k());
        String pedido = adm("SELECT id::text FROM public.solicitacoes_publicacao WHERE empresa_id = ?::uuid AND estado = 'aberta'", id);
        comoUsuario(CK, "SELECT public.ck_decidir_solicitacao(?::uuid, 'aprovar', NULL, NULL, ?)::text", pedido, k());
        adm("SELECT app_private.marcar_empresa_de_teste(?::uuid, 'teste J01: empresa fictícia')", id);
        return id;
    }

    private String servico(String dono, String empresa, String nome) throws SQLException {
        String dados = json(Map.of("nome", nome, "politica_preco", "sob_consulta", "modalidade", "analise_manual", "duracao_min", 120));
        String id = campo(comoUsuario(dono, "SELECT public.criar_servico(?::uuid, ?::jsonb, ?)::text", empresa, dados, k()), "id");
        comoUsuario(dono, "SELECT public.definir_vitrine_servico(?::uuid, true, ?, ?)::text", id, versao("servicos", id), k());
        return id;
    }

    private String perfil(String empresa, String nome, String permissoes) throws SQLException {
        return campo(comoUsuario(empresa.equals(empresaB) ? DONO_B : DONO_A,
                "SELECT public.criar_perfil_permissao(?::uuid, ?, NULL, string_to_array(?, ','), ?)::text",
                empresa, nome, permissoes, k()), "id");
    }

    private void convidar(String empresa, String perfil, String pessoa, String email) throws SQLException {
        String convite = campo(comoUsuario(DONO_A, "SELECT public.convidar_funcionario(?::uuid, ?, ?::uuid, ?)::text",
                empresa, email, perfil, k()), "id");
        comoUsuario(pessoa, "SELECT public.aceitar_convite(?::uuid, ?)::text", convite, k());
    }

    private String contratar(String cliente, String servico, String orcamentista) throws SQLException {
        String solicitacao = campo(comoUsuario(cliente, "SELECT public.criar_solicitacao(?::uuid, ?::jsonb, ?)::text",
                servico, json(Map.of("relato", "Pedido fictício do teste J01.")), k()), "id");
        String componentes = json(Map.of("componentes", List.of(Map.of("tipo", "mao_de_obra", "descricao", "Mão de obra",
                "quantidade", 1, "valor_unitario_centavos", 18000))));
        JsonNode rascunho = ler(comoUsuario(orcamentista, "SELECT public.salvar_rascunho_orcamento(?::uuid, ?::jsonb, ?, ?)::text",
                solicitacao, componentes, versao("solicitacoes_servico", solicitacao), k()));
        JsonNode enviado = ler(comoUsuario(orcamentista, "SELECT public.enviar_orcamento(?::uuid, ?, ?)::text",
                rascunho.get("id").asText(), rascunho.get("versao").asInt(), k()));
        comoUsuario(cliente, "SELECT public.aceitar_orcamento(?::uuid, ?::uuid, true, ?)::text", solicitacao, enviado.get("id").asText(), k());
        return adm("SELECT id::text FROM public.ordens_servico WHERE solicitacao_id = ?::uuid", solicitacao);
    }

    // ----------------------------------------------------------------------------------------------- SQL de apoio

    /** OS nova em uma empresa separada, sem alterar as listas esperadas pelos testes de leitura. */
    public synchronized String novaOsParaEscrita() throws SQLException {
        return contratar(CLIENTE_ESCRITA, servicoEscrita, GESTOR_A);
    }

    /** J10: o mesmo, com a cliente de acompanhamento como titular. */
    public synchronized String novaOsDeAcompanhamento() throws SQLException {
        return contratar(CLIENTE_ACOMPANHAMENTO, servicoEscrita, GESTOR_A);
    }

    private String clienteInternoEscrita;

    /**
     * J09: OS INTERNA nova na empresa de escrita, pelas funções do app: cliente interno fictício (M06), solicitação
     * interna, orçamento e aceite registrados pela equipe (M08). Aguardando início, versão 1, R$ 180,00. Pela regra
     * vigente, uma OS interna concluída pode ser encerrada pela empresa sem esperar 7 dias.
     */
    public synchronized String novaOsInternaParaEscrita() throws SQLException {
        if (clienteInternoEscrita == null) {
            clienteInternoEscrita = campo(comoUsuario(DONO_A, "SELECT public.criar_cliente(?::uuid, ?::jsonb, ?)::text",
                    empresaEscrita, json(Map.of("nome", "Seu Lauro do balcão (fictício J09)")), k()), "id");
        }
        String solicitacao = campo(comoUsuario(GESTOR_A, "SELECT public.criar_solicitacao_interna(?::uuid, ?::uuid, ?::uuid, ?::jsonb, ?)::text",
                empresaEscrita, clienteInternoEscrita, servicoEscrita, json(Map.of("relato", "Pedido interno fictício do teste J09.")), k()), "id");
        String componentes = json(Map.of("componentes", List.of(Map.of("tipo", "mao_de_obra", "descricao", "Mão de obra",
                "quantidade", 1, "valor_unitario_centavos", 18000))));
        JsonNode rascunho = ler(comoUsuario(GESTOR_A, "SELECT public.salvar_rascunho_orcamento(?::uuid, ?::jsonb, ?, ?)::text",
                solicitacao, componentes, versao("solicitacoes_servico", solicitacao), k()));
        JsonNode enviado = ler(comoUsuario(GESTOR_A, "SELECT public.enviar_orcamento(?::uuid, ?, ?)::text",
                rascunho.get("id").asText(), rascunho.get("versao").asInt(), k()));
        comoUsuario(GESTOR_A, "SELECT public.aceitar_orcamento(?::uuid, ?::uuid, true, ?)::text", solicitacao, enviado.get("id").asText(), k());
        return adm("SELECT id::text FROM public.ordens_servico WHERE solicitacao_id = ?::uuid", solicitacao);
    }

    /** J06: pessoa fictícia nova, membro da empresa de escrita por convite, com as permissões dadas; devolve o id do perfil. */
    public synchronized String novoMembroDaEmpresaEscrita(String sub, String apelido, String permissoes) throws SQLException {
        adm("INSERT INTO neon_auth.\"user\" (id, email, name, \"emailVerified\") VALUES (?::uuid, ?, ?, true)",
                sub, apelido + "@autonick-teste.example", apelido + " (fictício)");
        comoUsuario(sub, "SELECT public.garantir_perfil(?, ?)::text", "business", apelido + " (fictício)");
        String perfil = perfil(empresaEscrita, "Perfil " + apelido, permissoes);
        convidar(empresaEscrita, perfil, sub, apelido + "@autonick-teste.example");
        return perfil;
    }

    private int versao(String tabela, String id) throws SQLException {
        return Integer.parseInt(adm("SELECT versao::text FROM public." + tabela + " WHERE id = ?::uuid", id));
    }

    private String k() {
        return "j01-teste-" + (++chave);
    }

    /** SQL como administrador do banco de teste; devolve a primeira coluna da primeira linha (ou null). */
    public String adm(String sql, Object... parametros) throws SQLException {
        try (Connection c = banco.admin()) {
            return primeira(c, sql, parametros);
        }
    }

    /** SQL como a pessoa: papel authenticated e declarações do token só dentro da transação (como a API faz). */
    public String comoUsuario(String sub, String sql, Object... parametros) throws SQLException {
        try (Connection c = banco.admin()) {
            c.setAutoCommit(false);
            try {
                try (Statement s = c.createStatement()) {
                    s.execute("SET LOCAL ROLE authenticated");
                }
                primeira(c, "SELECT set_config('request.jwt.claims', ?, true)", json(Map.of("sub", sub, "role", "authenticated")));
                String resultado = primeira(c, sql, parametros);
                c.commit();
                return resultado;
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

    public static JsonNode ler(String json) {
        try {
            return JSON.readTree(json);
        } catch (Exception erro) {
            throw new IllegalStateException(erro);
        }
    }

    private static String campo(String json, String nome) {
        return ler(json).get(nome).asText();
    }

    private static String json(Object valor) {
        try {
            return JSON.writeValueAsString(valor);
        } catch (Exception erro) {
            throw new IllegalStateException(erro);
        }
    }
}
