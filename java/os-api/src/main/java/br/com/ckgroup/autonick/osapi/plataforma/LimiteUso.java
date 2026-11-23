package br.com.ckgroup.autonick.osapi.plataforma;

import java.time.Clock;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Limite simples por identidade em janelas de um minuto (proteção contra abuso na demonstração pública). Contadores só
 * em memória: com várias instâncias, cada uma limita o que recebe.
 */
@Component
public class LimiteUso {

    private record Janela(long minuto, AtomicInteger escritas, AtomicInteger leituras) {
    }

    private final PoliticaDados politica;
    private final Clock relogio;
    private final Map<String, Janela> janelas = new ConcurrentHashMap<>();

    public LimiteUso(PoliticaDados politica, Clock relogio) {
        this.politica = politica;
        this.relogio = relogio;
    }

    /** @param chave a identidade (sub) ou, para o visitante anônimo, o endereço de origem */
    public void registrar(String chave, boolean escrita) {
        int limite = escrita ? politica.escritasPorMinuto() : politica.leiturasPorMinuto();
        if (limite <= 0) return;
        long minuto = relogio.millis() / 60_000;
        if (janelas.size() > 50_000) janelas.values().removeIf(j -> j.minuto() < minuto);
        Janela janela = janelas.compute(chave,
                (k, atual) -> atual == null || atual.minuto() != minuto ? new Janela(minuto, new AtomicInteger(), new AtomicInteger()) : atual);
        int usados = (escrita ? janela.escritas() : janela.leituras()).incrementAndGet();
        if (usados > limite) {
            throw ErroDados.regra(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "Muitas operações seguidas. Aguarde um minuto e tente de novo.");
        }
    }
}
