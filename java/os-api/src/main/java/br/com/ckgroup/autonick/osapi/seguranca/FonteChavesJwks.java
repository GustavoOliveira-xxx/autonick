package br.com.ckgroup.autonick.osapi.seguranca;

import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * Chaves públicas do emissor (JWKS), com cache. Uma chave desconhecida provoca no máximo uma nova leitura por intervalo,
 * para acompanhar a troca de chaves sem permitir que tokens forjados forcem leituras repetidas.
 */
public class FonteChavesJwks {

    private static final int LIMITE_BYTES = 64 * 1024;
    private static final int PRAZO_MS = 5_000;

    private final URI endereco;
    private final Duration intervaloMinimo;
    private final Clock relogio;
    private volatile JWKSet chaves;
    private volatile Instant ultimaLeitura = Instant.EPOCH;

    public FonteChavesJwks(URI endereco, Duration intervaloMinimo, Clock relogio) {
        this.endereco = endereco;
        this.intervaloMinimo = intervaloMinimo;
        this.relogio = relogio;
    }

    public Optional<JWK> chave(String kid) {
        JWKSet atual = chaves;
        if (atual == null || (atual.getKeyByKeyId(kid) == null && podeReler())) {
            atual = reler();
        }
        return Optional.ofNullable(atual.getKeyByKeyId(kid));
    }

    private boolean podeReler() {
        return Duration.between(ultimaLeitura, relogio.instant()).compareTo(intervaloMinimo) >= 0;
    }

    private synchronized JWKSet reler() {
        if (chaves != null && !podeReler()) return chaves;
        try {
            URLConnection conexao = endereco.toURL().openConnection();
            conexao.setConnectTimeout(PRAZO_MS);
            conexao.setReadTimeout(PRAZO_MS);
            try (InputStream entrada = conexao.getInputStream()) {
                byte[] bytes = entrada.readNBytes(LIMITE_BYTES + 1);
                if (bytes.length > LIMITE_BYTES) throw new IOException("JWKS maior que o limite");
                chaves = JWKSet.parse(new String(bytes, StandardCharsets.UTF_8));
            }
        } catch (Exception erro) {
            if (chaves == null) chaves = new JWKSet();
        } finally {
            ultimaLeitura = relogio.instant();
        }
        return chaves;
    }
}
