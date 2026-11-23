package br.com.ckgroup.autonick.osapi.web;

import br.com.ckgroup.autonick.osapi.dados.ConsultaOrdensServico;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DetalhesOrdensServicoController {

    private final ConsultaOrdensServico consulta;

    public DetalhesOrdensServicoController(ConsultaOrdensServico consulta) {
        this.consulta = consulta;
    }

    @GetMapping(value = "/api/cliente/ordens-servico/{osId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public String minhaOrdem(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId) {
        return consulta.minhaOrdem(token.getSubject(), osId);
    }

    @GetMapping(value = "/api/business/ordens-servico/{osId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public String detalheDaEmpresa(@AuthenticationPrincipal Jwt token, @PathVariable UUID osId) {
        return consulta.detalheDaEmpresa(token.getSubject(), osId);
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<Map<String, String>> banco(DataAccessException erro) {
        return TratadorErros.respostaBanco(erro, true);
    }
}
