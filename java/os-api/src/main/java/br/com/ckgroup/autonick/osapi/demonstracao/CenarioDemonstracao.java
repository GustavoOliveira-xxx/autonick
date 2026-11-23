package br.com.ckgroup.autonick.osapi.demonstracao;

import br.com.ckgroup.autonick.osapi.plataforma.ConsultaTabelas;
import br.com.ckgroup.autonick.osapi.plataforma.ExecutorDados;
import br.com.ckgroup.autonick.osapi.plataforma.Identidade;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Monta o cenário FICTÍCIO da demonstração pelas FUNÇÕES do app, cada passo como a pessoa fictícia que o faria (mesma
 * transação, identidade, permissões e regras de um pedido real): quatro empresas de setores diferentes, equipe com
 * funcionária de perfil limitado, produtos e estoque, serviços, clientes, vendas, contas a pagar, pedidos pela vitrine,
 * orçamentos, OS em estados diferentes, avaliação e mensagens. Nada é inserido direto nas tabelas do app; só a conta
 * fictícia de entrada, a marcação "dado de teste" e a autorização de demonstração dos clientes passam pelas funções
 * administrativas do schema demo_auth.
 *
 */
public class CenarioDemonstracao {

    private static final Logger LOG = LoggerFactory.getLogger(CenarioDemonstracao.class);
    private static final ZoneId SP = ZoneId.of("America/Sao_Paulo");
    public static final String SENHA_LOCAL = "demo1234";

    /** Pessoa fictícia que pode entrar na demonstração. */
    public record Definicao(String pessoa, String nome, String area, String tipoPerfil, String descricao, int ordem) {
    }

    public static final List<Definicao> PESSOAS = List.of(
            new Definicao("cliente", "Cida Ramos", "cliente", "cliente", "Cliente: pede orçamentos, compra pela vitrine e acompanha OS.", 1),
            new Definicao("gestor", "Rafael Souza", "business", "business", "Gestor da Conserta Celular (assistência técnica): vendas, estoque, financeiro e OS.", 2),
            new Definicao("funcionario", "Bianca Alves", "business", "business", "Funcionária da Conserta Celular com perfil limitado (atendimento e vendas).", 3),
            new Definicao("gestora-loja", "Rosa Martins", "business", "business", "Gestora da Doceria Vó Rosa (comércio): pedidos, estoque e vendas.", 4),
            new Definicao("gestor-servicos", "Paulo Nunes", "business", "business", "Gestor da Elétrica Luz Forte (prestadora de serviços): orçamentos e agenda.", 5),
            new Definicao("gestora-atelie", "Lia Costa", "business", "business", "Gestora do Ateliê Ponto Firme (serviços e produtos).", 6),
            new Definicao("cliente2", "Marcos Lima", "cliente", "cliente", "Segundo cliente: pedidos aguardando aceite e OS em execução.", 7),
            new Definicao("ck", "Administração CK (fictícia)", "ck", "business", "Administrador CK: aprovação, moderação e contestações.", 8));

    /** Onde o cenário vai: local (fixo, com senha) ou de um visitante (cenário próprio, sem senha, com validade). */
    public record Destino(UUID cenario, String prefixoEmail, String senha, Instant expiraEm, boolean comCk) {

        public static Destino local() {
            return new Destino(null, "", SENHA_LOCAL, null, true);
        }

        String email(String pessoa) {
            return prefixoEmail + pessoa + ContasDemonstracao.DOMINIO;
        }
    }

    private final ExecutorDados executor;
    private final ConsultaTabelas tabelas;
    private final ContasDemonstracao contas;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final AtomicInteger contador = new AtomicInteger();
    private final String rodada = Long.toString(System.currentTimeMillis(), 36);

    public CenarioDemonstracao(ExecutorDados executor, ConsultaTabelas tabelas, ContasDemonstracao contas, JdbcTemplate jdbc, ObjectMapper json) {
        this.executor = executor;
        this.tabelas = tabelas;
        this.contas = contas;
        this.jdbc = jdbc;
        this.json = json;
    }

    /** Contas de cada pessoa e empresas criadas. */
    public record Resultado(Map<String, UUID> pessoas, List<String> empresas) {
    }

    /** Monta o cenário e devolve o id da conta de cada pessoa e as empresas criadas. */
    public Resultado montar(Destino destino) {
        long inicio = System.currentTimeMillis();
        Map<String, UUID> ids = new LinkedHashMap<>();
        for (Definicao d : PESSOAS) {
            if (d.area().equals("ck") && !destino.comCk()) continue;
            UUID id = UUID.randomUUID();
            contas.criar(id, destino.email(d.pessoa()), d.nome(), destino.senha(), d.pessoa(), d.area(), d.descricao(), d.ordem(),
                    destino.cenario(), destino.expiraEm());
            rpc(id, "garantir_perfil", p("p_tipo_conta", d.tipoPerfil(), "p_nome", d.nome()));
            if (d.area().equals("cliente")) jdbc.queryForObject("SELECT demo_auth.autorizar_cliente(?)::text", String.class, id);
            if (d.area().equals("ck")) jdbc.queryForObject("SELECT demo_auth.conceder_ck(?)::text", String.class, id);
            ids.put(d.pessoa(), id);
        }
        UUID ck = jdbc.queryForObject("SELECT demo_auth.garantir_ck_interna()", UUID.class);

        // --- Empresas: criação pelo dono, marcação de teste e aprovação do cartão pelo caminho real -------------------
        Map<String, String> categoria = new LinkedHashMap<>();
        for (JsonNode c : tabela(ids.get("gestor"), "categorias_plataforma", "select=id,slug&tipo=eq.negocio")) {
            categoria.put(c.path("slug").asText(), c.path("id").asText());
        }
        UUID gAssist = ids.get("gestor");
        UUID gDoceria = ids.get("gestora-loja");
        UUID gEletrica = ids.get("gestor-servicos");
        UUID gAtelie = ids.get("gestora-atelie");
        UUID cida = ids.get("cliente");
        UUID marcos = ids.get("cliente2");
        String assist = empresa(gAssist, ck, "[TESTE] Conserta Celular", "ambos", categoria.get("assistencia-tecnica"), "Centro",
                "Troca de tela, bateria e acessórios para celular. Demonstração com dados fictícios.", destino);
        String doceria = empresa(gDoceria, ck, "[TESTE] Doceria Vó Rosa", "comercio", categoria.get("alimentacao"), "Barão Geraldo",
                "Doces caseiros por encomenda e pronta entrega. Demonstração com dados fictícios.", destino);
        String eletrica = empresa(gEletrica, ck, "[TESTE] Elétrica Luz Forte", "servicos", categoria.get("construcao-reformas"), "Taquaral",
                "Instalações elétricas residenciais e pequenos reparos. Demonstração com dados fictícios.", destino);
        String atelie = empresa(gAtelie, ck, "[TESTE] Ateliê Ponto Firme", "ambos", categoria.get("costura-moda"), "Cambuí",
                "Ajustes, barras e consertos de roupas, com hora marcada. Demonstração com dados fictícios.", destino);

        // --- Equipe: funcionária da assistência com perfil limitado, pelo convite real --------------------------------
        JsonNode perfil = rpc(gAssist, "criar_perfil_permissao", p("p_empresa_id", assist, "p_nome", "Atendimento e vendas",
                "p_descricao", "Atende clientes, registra vendas e acompanha as OS. Não mexe no financeiro nem na equipe.",
                "p_permissoes", List.of("clientes.visualizar", "clientes.criar", "clientes.alterar", "produtos.visualizar", "estoque.visualizar",
                        "estoque.propor", "pedidos.visualizar", "pedidos.aprovar", "vendas.visualizar", "vendas.criar", "vendas.registrar_recebimento",
                        "orcamentos.visualizar", "orcamentos.criar", "servicos.visualizar", "catalogo_servicos.visualizar", "agenda.visualizar"),
                "p_operation_key", k()));
        UUID funcionaria = ids.get("funcionario");
        rpc(gAssist, "convidar_funcionario", p("p_empresa_id", assist, "p_email", destino.email("funcionario"),
                "p_perfil_id", perfil.path("id").asText(), "p_operation_key", k()));
        for (JsonNode convite : rpc(funcionaria, "meus_convites", p())) {
            rpc(funcionaria, "aceitar_convite", p("p_convite_id", convite.path("convite_id").asText(), "p_operation_key", k()));
        }

        // --- Produtos e estoque ---------------------------------------------------------------------------------------
        String pelicula = produto(gAssist, assist, "Película de vidro", 3500, 25, 5, 1200);
        String capa = produto(gAssist, assist, "Capa de silicone", 4500, 2, 5, 1800);
        String bateria = produto(gAssist, assist, "Bateria para celular (modelo comum)", 12000, 6, 2, 6500);
        String carregador = produto(gAssist, assist, "Carregador USB-C 20 W", 6900, 12, 4, 3100);
        String brigadeiro = produto(gDoceria, doceria, "Brigadeiro gourmet (cento)", 12000, 10, 2, 5000);
        String bolo = produto(gDoceria, doceria, "Bolo de pote", 1500, 30, 10, 600);
        produto(gDoceria, doceria, "Pão de mel", 800, 4, 8, 300);
        String tomada = produto(gEletrica, eletrica, "Tomada 10 A (unidade)", 1500, 30, 10, 700);
        produto(gEletrica, eletrica, "Disjuntor 20 A", 3200, 8, 3, 1900);
        String linha = produto(gAtelie, atelie, "Linha poliéster preta", 1200, 3, 10, 500);
        String ziper = produto(gAtelie, atelie, "Zíper invisível 20 cm", 800, 40, 10, 300);

        // --- Serviços -------------------------------------------------------------------------------------------------
        String[] tela = servicoPorRegras(gAssist, assist, "Troca de tela", "Quantos aparelhos", 18000);
        String[] bateriaServ = servicoPorRegras(gAssist, assist, "Troca de bateria", "Quantos aparelhos", 9000);
        String[] barra = servicoPorRegras(gAtelie, atelie, "Barra de calça", "Quantas peças", 2500);
        String chuveiro = servicoManual(gEletrica, eletrica, "Instalação de chuveiro");
        String reparo = servicoManual(gEletrica, eletrica, "Reparo em tomadas e interruptores");

        // --- Clientes internos, vendas e financeiro -------------------------------------------------------------------
        JsonNode balcao = rpc(gAssist, "criar_cliente", p("p_empresa_id", assist, "p_dados", p("nome", "João Pereira (fictício)",
                "telefone", "(19) 90000-0001", "email", null, "observacoes", "Cliente de balcão da demonstração."), "p_operation_key", k()));
        rpc(gAssist, "criar_cliente", p("p_empresa_id", assist, "p_dados", p("nome", "Ana Ferreira (fictícia)",
                "telefone", "(19) 90000-0002", "email", null, "observacoes", null), "p_operation_key", k()));
        venda(gAssist, assist, List.of(item(pelicula, 2)), p("recebimento_inicial", p("valor_centavos", 7000, "forma", "pix")));
        venda(gAssist, assist, List.of(item(carregador, 1), item(capa, 1)), p("recebimento_inicial", p("valor_centavos", 11400, "forma", "debito")));
        venda(gAssist, assist, List.of(item(bateria, 1)), p());
        venda(gDoceria, doceria, List.of(item(bolo, 6)), p("recebimento_inicial", p("valor_centavos", 9000, "forma", "pix")));
        venda(gDoceria, doceria, List.of(item(brigadeiro, 1)), p("recebimento_inicial", p("valor_centavos", 5000, "forma", "dinheiro")));
        venda(gEletrica, eletrica, List.of(item(tomada, 4)), p());
        venda(gAtelie, atelie, List.of(item(ziper, 3)), p("recebimento_inicial", p("valor_centavos", 2400, "forma", "dinheiro")));
        venda(gAtelie, atelie, List.of(item(linha, 1)), p());
        contaPagar(gAssist, assist, "Aluguel da loja (fictício)", "Aluguel", 150000, 5);
        contaPagar(gAssist, assist, "Compra de peças (fictícia)", "Compras para revenda", 42000, 12);
        contaPagar(gDoceria, doceria, "Aluguel do ponto (fictício)", "Aluguel", 90000, 5);
        contaPagar(gAtelie, atelie, "Aluguel do ateliê (fictício)", "Aluguel", 80000, 8);

        // --- Pedidos pela vitrine (área de demonstração) --------------------------------------------------------------
        JsonNode ped1 = rpc(cida, "criar_pedido", p("p_empresa_id", doceria, "p_itens", List.of(item(brigadeiro, 1)),
                "p_observacao", "Para sábado de manhã.", "p_operation_key", k()));
        rpc(gDoceria, "aceitar_pedido", p("p_pedido_id", id(ped1), "p_expected_version", versaoPedido(gDoceria, doceria, id(ped1)), "p_operation_key", k()));
        rpc(gDoceria, "concluir_pedido", p("p_pedido_id", id(ped1), "p_pagamento", p("recebimento_inicial", p("valor_centavos", 12000, "forma", "pix")),
                "p_expected_version", versaoPedido(gDoceria, doceria, id(ped1)), "p_operation_key", k()));
        JsonNode ped2 = rpc(marcos, "criar_pedido", p("p_empresa_id", doceria, "p_itens", List.of(item(bolo, 4)), "p_observacao", null, "p_operation_key", k()));
        JsonNode ped3 = rpc(cida, "criar_pedido", p("p_empresa_id", assist, "p_itens", List.of(item(carregador, 1)),
                "p_observacao", "Posso retirar amanhã?", "p_operation_key", k()));
        mensagem(marcos, "pedido", id(ped2), "Consegue entregar até as 17h?");
        mensagem(cida, "pedido", id(ped3), "Tem na cor branca também?");

        // --- Solicitações, orçamentos e OS ----------------------------------------------------------------------------
        // Ateliê: orçamento automático aceito, OS concluída, recebimento confirmado e avaliação aprovada.
        String os1 = osPorOrcamento(cida, barra, 3, "Três calças jeans para fazer a barra.");
        acaoOs(gAtelie, os1, "iniciar");
        rpc(gAtelie, "publicar_atualizacao_os", p("p_os_id", os1, "p_texto", "Barras medidas e alfinetadas.", "p_publica", true, "p_operation_key", k()));
        acaoOs(gAtelie, os1, "concluir");
        rpc(cida, "confirmar_recebimento_servico", p("p_os_id", os1, "p_operation_key", k()));
        JsonNode av = rpc(cida, "avaliar_os", p("p_os_id", os1, "p_nota", 5, "p_comentario", "Serviço caprichado e entregue no prazo.", "p_operation_key", k()));
        rpc(ck, "ck_moderar_publicacao", p("p_alvo_tipo", "avaliacao", "p_alvo_id", id(av), "p_medida", "aprovar", "p_motivo_resumo", null,
                "p_justificativa", null, "p_operation_key", k()));
        // Assistência: uma OS em execução (Marcos, com mensagem), uma aguardando início (Cida) e uma concluída (Cida).
        String os2 = osPorOrcamento(marcos, tela, 1, "Tela trincada no canto.");
        acaoOs(gAssist, os2, "iniciar");
        rpc(gAssist, "publicar_atualizacao_os", p("p_os_id", os2, "p_texto", "Peça separada, troca começa à tarde.", "p_publica", true, "p_operation_key", k()));
        mensagem(marcos, "os", os2, "Fica pronto hoje?");
        osPorOrcamento(cida, bateriaServ, 1, "A bateria descarrega muito rápido.");
        String os4 = osPorOrcamento(cida, tela, 1, "Tela sem toque na parte de baixo.");
        acaoOs(gAssist, os4, "iniciar");
        acaoOs(gAssist, os4, "concluir");
        // Elétrica: duas solicitações com análise manual, aguardando orçamento.
        JsonNode sol3 = rpc(cida, "criar_solicitacao", p("p_servico_id", chuveiro, "p_dados", p("respostas", p(), "relato",
                "Chuveiro novo de 220 V no banheiro social."), "p_operation_key", k()));
        rpc(marcos, "criar_solicitacao", p("p_servico_id", reparo, "p_dados", p("respostas", p(), "relato", "Duas tomadas da cozinha sem energia."),
                "p_operation_key", k()));
        mensagem(cida, "solicitacao", id(sol3), "Posso enviar foto do quadro de luz?");

        LOG.info("Cenário de demonstração {} montado em {} ms (cliente interno {}).", destino.cenario() == null ? "fixo" : destino.cenario(),
                System.currentTimeMillis() - inicio, id(balcao));
        return new Resultado(ids, List.of(assist, doceria, eletrica, atelie));
    }

    // ------------------------------------------------------------------------------------------------- passos

    private String empresa(UUID dono, UUID ck, String nome, String modalidade, String categoria, String bairro, String descricao, Destino destino) {
        JsonNode e = rpc(dono, "criar_empresa", p("p_dados", p("nome_publico", nome, "modalidade", modalidade, "categoria_id", categoria,
                "cidade", "Campinas", "bairro", bairro, "uf", "SP",
                "email_contato", destino.email("contato-" + contador.incrementAndGet())), "p_operation_key", k()));
        String id = id(e);
        if (destino.cenario() != null) {
            jdbc.queryForObject("SELECT demo_auth.registrar_empresa_cenario(?::uuid, ?)::text", String.class, id, destino.cenario());
        }
        rpc(dono, "atualizar_empresa", p("p_empresa_id", id, "p_dados", p("descricao_publica", descricao), "p_expected_version", 1, "p_operation_key", k()));
        jdbc.queryForObject("SELECT demo_auth.marcar_empresa(?::uuid)::text", String.class, id);
        int versao = tabela(dono, "empresas", "id=eq." + id + "&select=versao").get(0).path("versao").asInt();
        rpc(dono, "enviar_vitrine_para_analise", p("p_empresa_id", id, "p_expected_version", versao, "p_operation_key", k()));
        String solicitacao = tabela(ck, "solicitacoes_publicacao", "empresa_id=eq." + id + "&estado=eq.aberta&select=id").get(0).path("id").asText();
        rpc(ck, "ck_decidir_solicitacao", p("p_solicitacao_id", solicitacao, "p_decisao", "aprovar", "p_motivo", null, "p_campos", null, "p_operation_key", k()));
        return id;
    }

    private String produto(UUID dono, String empresa, String nome, int preco, int quantidade, int minimo, int custo) {
        JsonNode p = rpc(dono, "criar_produto", p("p_empresa_id", empresa, "p_dados", p("nome", nome, "finalidade", "comercializavel",
                "preco_centavos", preco, "quantidade_inicial", quantidade, "estoque_minimo", minimo, "custo_centavos", custo),
                "p_variacoes", null, "p_operation_key", k()));
        String produtoId = id(p);
        JsonNode lido = doCatalogo(dono, "produtos_da_empresa", empresa, produtoId);
        rpc(dono, "definir_vitrine_produto", p("p_produto_id", produtoId, "p_exibir", true, "p_expected_version", lido.path("versao").asInt(),
                "p_operation_key", k()));
        return lido.path("variacoes").path(0).path("id").asText();
    }

    private String[] servicoPorRegras(UUID dono, String empresa, String nome, String pergunta, int valorUnitario) {
        JsonNode sv = rpc(dono, "criar_servico", p("p_empresa_id", empresa, "p_dados", p("nome", nome, "politica_preco", "por_regras",
                "modalidade", "orcamento_automatico", "duracao_min", 60), "p_operation_key", k()));
        sv = rpc(dono, "salvar_formulario_servico", p("p_servico_id", id(sv), "p_perguntas", List.of(p("texto", pergunta, "tipo", "numero",
                "obrigatoria", true, "configuracao", p("minimo", 1, "maximo", 50))), "p_expected_version", sv.path("versao").asInt(), "p_operation_key", k()));
        String perguntaId = sv.path("perguntas").path(0).path("id").asText();
        rpc(dono, "salvar_regras_servico", p("p_servico_id", id(sv), "p_regras", List.of(p("tipo", "por_quantidade", "pergunta_id", perguntaId,
                "rotulo", pergunta, "valor_unitario_centavos", valorUnitario)), "p_expected_version", sv.path("versao").asInt(), "p_operation_key", k()));
        publicarServico(dono, empresa, id(sv));
        return new String[] {id(sv), perguntaId};
    }

    private String servicoManual(UUID dono, String empresa, String nome) {
        JsonNode sv = rpc(dono, "criar_servico", p("p_empresa_id", empresa, "p_dados", p("nome", nome, "politica_preco", "sob_consulta",
                "modalidade", "analise_manual", "duracao_min", 120), "p_operation_key", k()));
        publicarServico(dono, empresa, id(sv));
        return id(sv);
    }

    private void publicarServico(UUID dono, String empresa, String servico) {
        JsonNode lido = doCatalogo(dono, "servicos_da_empresa", empresa, servico);
        rpc(dono, "definir_vitrine_servico", p("p_servico_id", servico, "p_exibir", true, "p_expected_version", lido.path("versao").asInt(),
                "p_operation_key", k()));
    }

    private void venda(UUID dono, String empresa, List<Map<String, Object>> itens, Map<String, Object> pagamento) {
        rpc(dono, "registrar_venda_direta", p("p_empresa_id", empresa, "p_dados", p(), "p_itens", itens, "p_pagamento", pagamento,
                "p_total_esperado_centavos", null, "p_operation_key", k()));
    }

    private void contaPagar(UUID dono, String empresa, String descricao, String categoriaNome, int valor, int emDias) {
        String categoria = null;
        if (categoriaNome != null) {
            for (JsonNode c : rpc(dono, "categorias_financeiras_da_empresa", p("p_empresa_id", empresa))) {
                if (categoriaNome.equals(c.path("nome").asText())) categoria = c.path("id").asText();
            }
        }
        rpc(dono, "criar_titulo", p("p_empresa_id", empresa, "p_dados", p("tipo", "pagar", "descricao", descricao, "categoria_id", categoria,
                "parcelas", List.of(p("valor_centavos", valor, "vencimento", LocalDate.now(SP).plusDays(emDias).toString()))), "p_operation_key", k()));
    }

    private String osPorOrcamento(UUID cliente, String[] servico, int quantidade, String relato) {
        JsonNode sol = rpc(cliente, "criar_solicitacao", p("p_servico_id", servico[0], "p_dados", p("respostas", p(servico[1], quantidade),
                "relato", relato), "p_operation_key", k()));
        JsonNode minha = rpc(cliente, "minha_solicitacao", p("p_solicitacao_id", id(sol)));
        rpc(cliente, "aceitar_orcamento", p("p_solicitacao_id", id(sol), "p_versao_id", minha.path("versao_vigente_id").asText(),
                "p_condicoes_aceitas", true, "p_operation_key", k()));
        return rpc(cliente, "minha_solicitacao", p("p_solicitacao_id", id(sol))).path("os").path("id").asText();
    }

    private void acaoOs(UUID quem, String os, String acao) {
        int versao = rpc(quem, "os_detalhe", p("p_os_id", os)).path("versao").asInt();
        rpc(quem, "mudar_estado_os", p("p_os_id", os, "p_acao", acao, "p_motivo", null, "p_expected_version", versao, "p_operation_key", k()));
    }

    private int versaoPedido(UUID dono, String empresa, String pedido) {
        for (JsonNode p : rpc(dono, "pedidos_da_empresa", p("p_empresa_id", empresa, "p_estado", null, "p_limite", 100))) {
            if (pedido.equals(p.path("id").asText())) return p.path("versao").asInt();
        }
        throw new IllegalStateException("Pedido não encontrado na montagem: " + pedido);
    }

    private void mensagem(UUID quem, String tipo, String alvo, String texto) {
        rpc(quem, "enviar_mensagem", p("p_tipo", tipo, "p_id", alvo, "p_texto", texto, "p_operation_key", k()));
    }

    private JsonNode doCatalogo(UUID dono, String funcao, String empresa, String id) {
        for (JsonNode x : rpc(dono, funcao, p("p_empresa_id", empresa))) {
            if (id.equals(x.path("id").asText())) return x;
        }
        throw new IllegalStateException("Item não encontrado na montagem: " + id);
    }

    // ------------------------------------------------------------------------------------------------- apoio

    private JsonNode rpc(UUID quem, String funcao, Map<String, Object> parametros) {
        try {
            return executor.chamarInterno(new Identidade(quem.toString(), false), funcao, json.valueToTree(parametros));
        } catch (RuntimeException erro) {
            throw new IllegalStateException("Montagem do cenário: " + funcao + " falhou: " + erro.getMessage(), erro);
        }
    }

    private JsonNode tabela(UUID quem, String tabela, String consulta) {
        try {
            return json.readTree(tabelas.consultarInterno(new Identidade(quem.toString(), false), tabela, consulta));
        } catch (Exception erro) {
            throw new IllegalStateException("Montagem do cenário: leitura de " + tabela + " falhou: " + erro.getMessage(), erro);
        }
    }

    private String k() {
        return "demo-" + rodada + "-" + contador.incrementAndGet();
    }

    private static String id(JsonNode n) {
        return n.path("id").asText();
    }

    private static Map<String, Object> item(String variacao, int quantidade) {
        return p("variacao_id", variacao, "quantidade", quantidade);
    }

    /** Mapa ordenado que aceita valores nulos (os parâmetros opcionais das funções vão como null). */
    static Map<String, Object> p(Object... chaveValor) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < chaveValor.length; i += 2) m.put((String) chaveValor[i], chaveValor[i + 1]);
        return m;
    }
}
