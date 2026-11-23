package br.com.ckgroup.autonick.osapi.web;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Verificação de funcionamento (API e conexão com o banco), sem dados. */
@RestController
public class SaudeController {

    private final JdbcTemplate jdbc;

    public SaudeController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/api/saude")
    ResponseEntity<Map<String, Object>> saude() {
        try {
            jdbc.queryForObject("SELECT 1", Integer.class);
            return ResponseEntity.ok(Map.of("api", "ok", "banco", "ok"));
        } catch (Exception erro) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("api", "ok", "banco", "indisponível"));
        }
    }
}
