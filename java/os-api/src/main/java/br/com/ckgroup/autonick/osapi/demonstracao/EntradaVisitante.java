package br.com.ckgroup.autonick.osapi.demonstracao;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;

/**
 * Demonstração PÚBLICA: cada visitante recebe um cenário fictício próprio (empresas, equipe, clientes e movimentos),
 * isolado dos outros visitantes pelas mesmas regras de empresa e identidade do app.
 */
public interface EntradaVisitante {

    /** Pessoas que o visitante pode escolher (o cenário é criado na primeira entrada). */
    List<Map<String, Object>> pessoasDisponiveis();

    /** Conta da pessoa no cenário atual do visitante; sem cenário (ou vencido), cria um novo dentro dos limites. */
    ContasDemonstracao.Conta entrar(String pessoa, UUID cenarioAtual, HttpServletRequest pedido);

    final class Recusa extends RuntimeException {
        public final HttpStatus status;

        public Recusa(HttpStatus status, String mensagem) {
            super(mensagem);
            this.status = status;
        }
    }
}
