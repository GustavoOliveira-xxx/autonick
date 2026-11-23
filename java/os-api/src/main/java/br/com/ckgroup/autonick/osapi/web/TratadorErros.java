package br.com.ckgroup.autonick.osapi.web;

import java.util.Map;
import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** Respostas de erro em JSON: {"codigo": ..., "mensagem": ...}. Nada de SQL, pilha ou detalhe interno no corpo. */
@RestControllerAdvice
public class TratadorErros {

    private static final Logger LOG = LoggerFactory.getLogger(TratadorErros.class);

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<Map<String, String>> banco(DataAccessException erro) {
        return respostaBanco(erro, false);
    }

    static ResponseEntity<Map<String, String>> respostaBanco(DataAccessException erro, boolean detalhe) {
        return respostaBanco(erro, detalhe ? TradutorErrosBanco::traduzirDetalhe : TradutorErrosBanco::traduzir);
    }

    static ResponseEntity<Map<String, String>> respostaBanco(DataAccessException erro,
            java.util.function.BiFunction<String, String, TradutorErrosBanco.Resposta> tradutor) {
        PSQLException psql = causaPostgres(erro);
        ServerErrorMessage servidor = psql == null ? null : psql.getServerErrorMessage();
        TradutorErrosBanco.Resposta resposta = servidor == null
                ? TradutorErrosBanco.generica()
                : tradutor.apply(servidor.getHint(), servidor.getMessage());
        if (resposta.status().is5xxServerError()) LOG.error("Falha inesperada do banco na consulta de OS", erro);
        return corpo(resposta);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<Map<String, String>> parametro(MethodArgumentTypeMismatchException erro) {
        return corpo(new TradutorErrosBanco.Resposta(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                "Parâmetro inválido: " + erro.getName() + "."));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<Map<String, String>> naoEncontrado() {
        return corpo(new TradutorErrosBanco.Resposta(HttpStatus.NOT_FOUND, "NOT_FOUND", "Página não encontrada."));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, String>> inesperado(Exception erro) {
        LOG.error("Falha inesperada na consulta de OS", erro);
        return corpo(TradutorErrosBanco.generica());
    }

    private static ResponseEntity<Map<String, String>> corpo(TradutorErrosBanco.Resposta r) {
        return ResponseEntity.status(r.status()).body(Map.of("codigo", r.codigo(), "mensagem", r.mensagem()));
    }

    private static PSQLException causaPostgres(Throwable erro) {
        for (Throwable t = erro; t != null; t = t.getCause()) {
            if (t instanceof PSQLException p) return p;
        }
        return null;
    }
}
