package br.com.ckgroup.autonick.osapi.plataforma;

import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Catálogo FECHADO das operações que a API Java executa, agrupadas por domínio. Cada nome é uma função SQL do app, que
 * continua sendo a dona da regra de negócio, da permissão por empresa (RLS e checagens internas), da versão e da
 * idempotência. Nada fora desta lista é executado, mesmo que exista no banco e o papel tenha permissão.
 *
 * As ordens de serviço também têm rotas próprias (J03 a J11, em {@code /api/business} e {@code /api/cliente}), com
 * checagens adicionais na mesma transação; as funções de OS abaixo existem para as telas que leem pela camada de dados.
 */
public enum Dominio {

    IDENTIDADE(false, "garantir_perfil", "minhas_permissoes", "minhas_empresas", "meus_convites", "aceitar_convite", "meus_favoritos", "alternar_favorito",
            "recusar_convite", "sair_da_empresa", "minha_autorizacao_demonstracao"),

    EMPRESAS_EQUIPE(false, "criar_empresa", "atualizar_empresa", "empresa_dados_privados", "painel_empresa",
            "horarios_empresa", "salvar_horarios_empresa", "excecoes_agenda", "salvar_excecao_agenda", "remover_excecao_agenda", "compromissos_agenda", "salvar_compromisso_agenda", "cancelar_compromisso_agenda", "equipe_membros", "equipe_historico", "convidar_funcionario",
            "cancelar_convite", "desligar_membro", "alterar_perfil_do_membro", "criar_perfil_permissao",
            "alterar_perfil_permissao", "desativar_perfil_permissao", "definir_desconto_maximo", "meu_limite_desconto",
            "enviar_vitrine_para_analise", "contestar_moderacao", "abrir_contestacao", "operacoes_da_empresa",
            "definir_logo_empresa", "logos_das_minhas_empresas", "arquivo_remover", "arquivos_do_registro", "busca_global", "atividades_da_empresa", "metas_da_empresa", "definir_meta"),

    PRODUTOS_ESTOQUE(false, "produtos_da_empresa", "criar_produto", "alterar_produto", "definir_produto_ativo",
            "adicionar_variacao", "alterar_variacao", "definir_variacao_ativa", "alterar_preco", "alterar_custo",
            "custos_da_variacao", "pausar_venda_produto", "definir_vitrine_produto", "alertas_estoque",
            "historico_movimentacoes", "registrar_movimentacao", "propor_movimentacao", "aprovar_proposta",
            "decidir_proposta_sem_aplicar", "propostas_da_empresa", "estornar_movimentacao", "criar_fornecedor",
            "alterar_fornecedor", "compras_da_empresa", "criar_compra", "registrar_compra", "cancelar_compra",
            "compras_para_conta_pagar", "gerar_titulo_compra", "definir_imagem_produto", "imagens_de_produtos"),

    VENDAS_PEDIDOS(false, "clientes_da_empresa", "criar_cliente", "alterar_cliente", "definir_cliente_ativo",
            "historico_do_cliente", "ficha_cliente", "catalogo_para_venda", "vendas_da_empresa", "venda_detalhe", "criar_venda",
            "alterar_venda", "confirmar_venda", "cancelar_venda", "descartar_venda", "registrar_venda_direta",
            "registrar_entrega", "pedidos_da_empresa", "aceitar_pedido", "recusar_pedido", "concluir_pedido",
            "cancelar_pedido", "criar_pedido", "meus_pedidos", "itens_para_pedido", "empresas_para_pedido"),

    FINANCEIRO(false, "painel_financeiro", "contas_da_empresa", "criar_conta", "alterar_conta", "definir_conta_ativa",
            "definir_conta_padrao", "categorias_financeiras_da_empresa", "criar_categoria_financeira",
            "alterar_categoria_financeira", "definir_categoria_ativa", "titulos_da_empresa", "titulo_detalhe",
            "criar_titulo", "cancelar_titulo", "registrar_pagamento", "estornar_pagamento", "registrar_recebimento",
            "estornar_recebimento", "registrar_lancamento", "estornar_lancamento", "lancamentos_da_empresa",
            "transferir", "estornar_transferencia", "registrar_movimento_proprietario", "registrar_devolucao_valor",
            "recorrencias_da_empresa", "criar_recorrencia", "alterar_recorrencia", "definir_recorrencia_ativa",
            "gerar_recorrencias", "situacao_fechamento", "fechar_periodo", "reabrir_periodo", "relatorio_financeiro",
            "reconciliar_financeiro", "exportar_financeiro"),

    SERVICOS_ORCAMENTOS(false, "servicos_da_empresa", "criar_servico", "alterar_servico", "definir_servico_ativo",
            "definir_vitrine_servico", "salvar_formulario_servico", "salvar_regras_servico", "salvar_itens_pacote",
            "estimar_servico", "servicos_para_cliente", "politica_cancelamento", "salvar_politica_cancelamento",
            "solicitacoes_da_empresa", "solicitacao_detalhe", "assumir_solicitacao", "criar_solicitacao",
            "criar_solicitacao_interna", "cancelar_solicitacao", "minhas_solicitacoes", "minha_solicitacao",
            "salvar_rascunho_orcamento", "enviar_orcamento", "aprovar_orcamento", "aceitar_orcamento",
            "recusar_orcamento", "pedir_revisao", "agenda_basica", "agenda_operacional"),

    ORDENS_SERVICO(false, "ordens_da_empresa", "os_detalhe", "minhas_os", "minha_os", "mudar_estado_os", "checklist_os", "checklist_os_cliente", "adicionar_itens_checklist", "alterar_item_checklist", "remover_item_checklist", "modelos_checklist", "salvar_modelo_checklist",
            "publicar_atualizacao_os", "atualizar_dados_os", "registrar_garantia_os", "adicionar_material_os",
            "reservar_material_os", "registrar_uso_material", "decidir_uso_material", "devolver_material_os",
            "confirmar_recebimento_servico", "pedir_revisao_os", "cancelar_os", "propor_horario_os",
            "confirmar_horario", "cancelar_horario_os", "pedir_reagendamento_os", "responder_reagendamento",
            "retirar_reagendamento", "gerar_antecipacao_os", "reparcelar_titulo_os", "propor_custos_cancelamento",
            "responder_custos", "revisar_custos", "retirar_custos", "registrar_acordo_custos", "gerar_titulo_custos",
            "gerar_proxima_os", "reconciliar_os"),

    COMUNICACAO(false, "conversa_atendimento", "enviar_mensagem", "registrar_mensagem", "mensagens_novas",
            "marcar_conversa_lida", "avaliar_os", "minha_avaliacao_os", "retirar_avaliacao", "responder_avaliacao",
            "avaliacoes_da_empresa", "denunciar", "minhas_denuncias", "registrar_exportacao_pdf"),

    /** Únicas funções do visitante sem login (papel anonymous). */
    VITRINE_PUBLICA(true, "filtros_vitrine", "buscar_vitrine", "vitrine_publica", "logos_publicos", "imagens_publicas_de_produtos"),

    VITRINE_DEMONSTRACAO(false, "filtros_demonstracao", "buscar_demonstracao", "vitrine_demonstracao"),

    /** Painel CK: a API confere {@code sou_ck_admin()} na mesma transação ANTES de chamar a função (que confere de novo). */
    ADMIN_CK(false, "sou_ck_admin", "ck_listar_empresas", "ck_historico_empresa", "ck_fila_moderacao",
            "ck_decidir_solicitacao", "ck_moderar_publicacao", "ck_moderar_alteracao_direta", "ck_suspender_vitrine",
            "ck_reativar_vitrine", "ck_assumir_contestacao", "ck_decidir_contestacao", "ck_assumir_contestacao_moderacao",
            "ck_decidir_contestacao_moderacao", "ck_assumir_denuncia", "ck_decidir_denuncia", "ck_limites", "ck_saude", "ck_auditoria",
            "ck_definir_limite", "ck_historico_limites");

    private static final Map<String, Dominio> POR_FUNCAO = Arrays.stream(values())
            .flatMap(d -> d.funcoes.stream().map(f -> Map.entry(f, d)))
            .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey, Map.Entry::getValue));

    /** Funções do painel CK que só informam se a pessoa é CK (não exigem ser CK para responder). */
    private static final Set<String> CK_SEM_EXIGENCIA = Set.of("sou_ck_admin");

    public final boolean publico;
    public final Set<String> funcoes;

    Dominio(boolean publico, String... funcoes) {
        this.publico = publico;
        this.funcoes = Set.of(funcoes);
    }

    public static Optional<Dominio> daFuncao(String funcao) {
        return Optional.ofNullable(POR_FUNCAO.get(funcao));
    }

    public static Set<String> todas() {
        return POR_FUNCAO.keySet();
    }

    /** A API exige ser CK antes de chamar a função. */
    public static boolean exigeCk(String funcao) {
        return daFuncao(funcao).map(d -> d == ADMIN_CK && !CK_SEM_EXIGENCIA.contains(funcao)).orElse(false);
    }

    static Map<String, Dominio> mapa() {
        return POR_FUNCAO;
    }
}
