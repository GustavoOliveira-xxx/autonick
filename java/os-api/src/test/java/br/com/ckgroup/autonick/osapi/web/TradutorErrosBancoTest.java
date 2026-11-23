package br.com.ckgroup.autonick.osapi.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/** Plano J01: tradução dos códigos do banco (ADR-J01, J-07) e R4 (erro inesperado sem detalhe interno). */
class TradutorErrosBancoTest {

    @Test
    @DisplayName("códigos de negócio viram 401, 403 e 400")
    void codigos() {
        assertThat(TradutorErrosBanco.traduzir("AUTH_REQUIRED", "x").status()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(TradutorErrosBanco.traduzir("TENANT_FORBIDDEN", "Você não tem acesso a esta empresa.").status()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(TradutorErrosBanco.traduzir("FORBIDDEN_ACTION", "x").status()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(TradutorErrosBanco.traduzir("VALIDATION_ERROR", "Paginação inválida.").mensagem()).isEqualTo("Paginação inválida.");
    }

    @Test
    @DisplayName("R4: erro desconhecido vira 500 com mensagem genérica, sem SQL nem detalhe")
    void r4() {
        TradutorErrosBanco.Resposta r = TradutorErrosBanco.traduzir(null, "relation \"app_private.x\" does not exist");
        assertThat(r.status()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(r.mensagem()).isEqualTo(TradutorErrosBanco.MENSAGEM_GENERICA).doesNotContain("relation", "app_private");
        assertThat(TradutorErrosBanco.traduzir("ALGO_NOVO", "detalhe interno").mensagem()).isEqualTo(TradutorErrosBanco.MENSAGEM_GENERICA);
    }
}
