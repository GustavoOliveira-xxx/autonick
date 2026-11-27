package br.com.ckgroup.autonick.osapi.enderecos;

import br.com.ckgroup.autonick.osapi.plataforma.ErroDados;
import br.com.ckgroup.autonick.osapi.plataforma.Identidade;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /api/enderecos/cep/{cep}}: logradouro, bairro, cidade e UF de um CEP, para preencher cadastros. Só para pessoa
 * autenticada (GET em /api/** exige token de pessoa). Número e complemento nunca vêm daqui; a tela mantém tudo editável.
 */
@RestController
@RequestMapping("/api/enderecos")
public class EnderecosController {

    private final ConsultaCep consulta;

    public EnderecosController(ConsultaCep consulta) {
        this.consulta = consulta;
    }

    @GetMapping("/cep/{cep}")
    ResponseEntity<Map<String, Object>> cep(@AuthenticationPrincipal Jwt jwt, @PathVariable String cep) {
        Identidade quem = Identidade.de(jwt);
        if (quem.anonima()) throw ErroDados.regra(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "Entre para buscar o CEP.");
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(consulta.consultar(cep, quem.sub()));
    }

    @ExceptionHandler(ErroDados.class)
    ResponseEntity<Map<String, Object>> recusa(ErroDados erro) {
        return ResponseEntity.status(erro.status).cacheControl(CacheControl.noStore()).body(erro.corpo());
    }
}
