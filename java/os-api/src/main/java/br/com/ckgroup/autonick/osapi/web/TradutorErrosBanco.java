package br.com.ckgroup.autonick.osapi.web;

import org.springframework.http.HttpStatus;

/**
 * Traduz o código que as funções SQL põem no HINT (app_private.erro) para HTTP (ADR-J01, J-07). Mensagens de erro de
 * negócio já são escritas para a pessoa; erro desconhecido vira 500 com texto genérico, sem detalhe interno.
 */
public final class TradutorErrosBanco {

    public static final String MENSAGEM_GENERICA = "Não foi possível concluir a consulta.";

    private TradutorErrosBanco() {
    }

    public record Resposta(HttpStatus status, String codigo, String mensagem) {
    }

    public static Resposta traduzir(String codigo, String mensagemDoBanco) {
        if (codigo == null) return generica();
        return switch (codigo) {
            case "AUTH_REQUIRED" -> new Resposta(HttpStatus.UNAUTHORIZED, codigo, "Sessão ausente ou expirada.");
            case "TENANT_FORBIDDEN", "FORBIDDEN_ACTION" -> new Resposta(HttpStatus.FORBIDDEN, codigo, mensagemDoBanco);
            case "VALIDATION_ERROR" -> new Resposta(HttpStatus.BAD_REQUEST, codigo, mensagemDoBanco);
            default -> generica();
        };
    }

    public static Resposta generica() {
        return new Resposta(HttpStatus.INTERNAL_SERVER_ERROR, "ERRO_INTERNO", MENSAGEM_GENERICA);
    }

    /**
     * J05 (iniciar a OS): sem acesso à empresa ou OS inexistente → o mesmo 404 do detalhe; membro sem a permissão → 403
     * com a mensagem da função; versão, estado ou chave em conflito → 409 com a mensagem da função.
     */
    static Resposta traduzirAcao(String codigo, String mensagemDoBanco) {
        if ("NOT_FOUND".equals(codigo) || "TENANT_FORBIDDEN".equals(codigo)) {
            return new Resposta(HttpStatus.NOT_FOUND, "NOT_FOUND", "Ordem de serviço não encontrada.");
        }
        // PERIOD_LOCKED (J07): a conclusão cria a conta a receber do saldo e o mês financeiro está fechado.
        // INSUFFICIENT_STOCK (J11): o motor do M05 recusa reservar ou baixar além do disponível.
        if ("VERSION_CONFLICT".equals(codigo) || "STATE_CONFLICT".equals(codigo) || "IDEMPOTENCY_CONFLICT".equals(codigo)
                || "PERIOD_LOCKED".equals(codigo) || "INSUFFICIENT_STOCK".equals(codigo)) {
            return new Resposta(HttpStatus.CONFLICT, codigo, mensagemDoBanco);
        }
        return traduzir(codigo, mensagemDoBanco);
    }

    static Resposta traduzirDetalhe(String codigo, String mensagemDoBanco) {
        if ("NOT_FOUND".equals(codigo) || "TENANT_FORBIDDEN".equals(codigo) || "FORBIDDEN_ACTION".equals(codigo)) {
            return new Resposta(HttpStatus.NOT_FOUND, "NOT_FOUND", "Ordem de serviço não encontrada.");
        }
        return traduzir(codigo, mensagemDoBanco);
    }
}
