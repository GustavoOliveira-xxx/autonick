package br.com.ckgroup.autonick.osapi.web;

import br.com.ckgroup.autonick.osapi.dados.ConsultaOrdensServico;
import br.com.ckgroup.autonick.osapi.dados.ConsultaOrdensServico.FiltrosOs;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Listas de OS do Cliente e da empresa. A resposta é o JSON da função SQL, sem remapear (ADR-J01, J-07). */
@RestController
public class OrdensServicoController {

    private final ConsultaOrdensServico consulta;

    public OrdensServicoController(ConsultaOrdensServico consulta) {
        this.consulta = consulta;
    }

    @GetMapping("/api/cliente/ordens-servico")
    public ResponseEntity<String> minhasOrdens(@AuthenticationPrincipal Jwt token) {
        return json(consulta.minhasOrdens(token.getSubject()));
    }

    @GetMapping("/api/empresas/{empresaId}/ordens-servico")
    public ResponseEntity<String> ordensDaEmpresa(@AuthenticationPrincipal Jwt token,
                                                  @PathVariable UUID empresaId,
                                                  @RequestParam(required = false) String estado,
                                                  @RequestParam(required = false) String responsavel,
                                                  @RequestParam(required = false) String busca,
                                                  @RequestParam(defaultValue = "50") int limite,
                                                  @RequestParam(defaultValue = "0") int deslocamento) {
        return json(consulta.ordensDaEmpresa(token.getSubject(), empresaId, new FiltrosOs(estado, responsavel, busca),
                limite, deslocamento));
    }

    private static ResponseEntity<String> json(String corpo) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(corpo);
    }
}
