package br.com.ckgroup.autonick.osapi.web;

import br.com.ckgroup.autonick.osapi.config.AutenticacaoProperties;
import br.com.ckgroup.autonick.osapi.config.PwaProperties;
import br.com.ckgroup.autonick.osapi.plataforma.PoliticaDados;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Configuração pública da PWA quando ela é entregue pela API: backend Java na mesma origem. Só caminhos relativos e
 * indicadores; nunca segredos.
 */
@RestController
@ConditionalOnProperty(name = "autonick.pwa.pasta")
public class ConfigPublicaController {

    private final String corpo;

    public ConfigPublicaController(PwaProperties pwa, AutenticacaoProperties auth, PoliticaDados dados, ObjectMapper json) throws Exception {
        corpo = "export const CONFIG_PUBLICA = Object.freeze(" + json.writeValueAsString(config(pwa, auth, dados)) + ");\n";
    }

    static Map<String, Object> config(PwaProperties pwa, AutenticacaoProperties auth, PoliticaDados dados) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("ambiente", pwa.backend());
        c.put("backend", pwa.backend());
        c.put("apiJava", "/api");
        c.put("neonAuthUrl", "/api/auth");
        c.put("neonDataApiUrl", "/api/dados");
        c.put("demonstracao", Map.of("ativa", auth.demo(), "publica", dados.demonstracaoPublica()));
        return c;
    }

    @GetMapping("/js/config/public-config.js")
    ResponseEntity<String> configuracao() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .contentType(MediaType.parseMediaType("text/javascript; charset=utf-8")).body(corpo);
    }
}
