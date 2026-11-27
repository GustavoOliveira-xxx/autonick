package br.com.ckgroup.autonick.osapi.enderecos;

import br.com.ckgroup.autonick.osapi.plataforma.ErroDados;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Clock;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Consulta de CEP na BrasilAPI ({@code GET https://brasilapi.com.br/api/cep/v2/{cep}}), sem conta nem chave.
 *
 * <ul>
 *   <li>Host e caminho fixos, só HTTPS; o único dado enviado é o CEP de 8 dígitos já validado. Sem cookies, sem cabeçalhos
 *       de sessão, sem seguir redirecionamentos (um redirecionamento vira "indisponível").</li>
 *   <li>Tempo de conexão 3 s e total 7 s; resposta limitada a 32 KB.</li>
 *   <li>Cache em memória: sucesso por 24 h e "não encontrado" por 1 h, no máximo 5.000 CEPs. Consultas simultâneas do mesmo
 *       CEP compartilham uma única chamada.</li>
 *   <li>Limite de 20 consultas por pessoa a cada minuto, além do que a BrasilAPI aplicar (429 é repassado como limite).</li>
 *   <li>Falhas viram códigos distintos (inválido, não encontrado, limite, indisponível, tempo esgotado) e a tela sempre permite
 *       preencher o endereço à mão. O CEP não vai para o log junto com quem consultou.</li>
 * </ul>
 * A base pode ser trocada só para testes locais (http://127.0.0.1 ou localhost); qualquer outro endereço é recusado na partida.
 */
@Service
public class ConsultaCep {

    private static final Logger LOG = LoggerFactory.getLogger(ConsultaCep.class);
    public static final String BASE_OFICIAL = "https://brasilapi.com.br/api";
    private static final Pattern CEP = Pattern.compile("^[0-9]{8}$");
    private static final Pattern BASE_TESTE = Pattern.compile("^http://(127\\.0\\.0\\.1|localhost)(:[0-9]{1,5})?(/[A-Za-z0-9/_-]*)?$");
    private static final int TAMANHO_MAXIMO = 32 * 1024;
    private static final int CACHE_MAXIMO = 5_000;
    private static final long SUCESSO_MS = Duration.ofHours(24).toMillis();
    private static final long NAO_ENCONTRADO_MS = Duration.ofHours(1).toMillis();
    private static final int POR_MINUTO = 20;
    public static final String MENSAGEM_FALHA = "Não foi possível buscar o CEP. Preencha o endereço manualmente.";

    record Entrada(Map<String, Object> endereco, ErroDados erro, long expiraEm) {
    }

    private record Janela(long minuto, AtomicInteger usados) {
    }

    private final String base;
    private final boolean ativa;
    private final Clock relogio;
    private final HttpClient http;
    private final Duration tempoTotal;
    private final ObjectMapper json = new ObjectMapper();
    private final Map<String, Entrada> cache = new ConcurrentHashMap<>();
    private final Map<String, CompletableFuture<Entrada>> emAndamento = new ConcurrentHashMap<>();
    private final Map<String, Janela> janelas = new ConcurrentHashMap<>();
    private final AtomicInteger chamadasExternas = new AtomicInteger();

    public ConsultaCep(@Value("${autonick.cep.base:" + BASE_OFICIAL + "}") String base, @Value("${autonick.cep.ativa:true}") boolean ativa,
            @Value("${autonick.cep.tempo-conexao:3s}") Duration tempoConexao, @Value("${autonick.cep.tempo-total:7s}") Duration tempoTotal,
            Clock relogio) {
        String limpa = base == null || base.isBlank() ? BASE_OFICIAL : base.replaceAll("/+$", "");
        if (!limpa.equals(BASE_OFICIAL) && !BASE_TESTE.matcher(limpa).matches()) {
            throw new IllegalStateException("autonick.cep.base só aceita " + BASE_OFICIAL + " (ou 127.0.0.1/localhost em testes).");
        }
        this.base = limpa;
        this.ativa = ativa;
        this.relogio = relogio;
        this.tempoTotal = tempoTotal;
        this.http = HttpClient.newBuilder().connectTimeout(tempoConexao).followRedirects(HttpClient.Redirect.NEVER)
                .version(HttpClient.Version.HTTP_1_1).build();
    }

    /** Quantas chamadas saíram para a BrasilAPI (usado nos testes de cache e coalescência). */
    int chamadasExternas() {
        return chamadasExternas.get();
    }

    public static String normalizar(String cep) {
        return cep == null ? "" : cep.replaceAll("[\\s.-]", "");
    }

    public Map<String, Object> consultar(String cepInformado, String quem) {
        String cep = normalizar(cepInformado);
        if (!CEP.matcher(cep).matches()) {
            throw ErroDados.regra(HttpStatus.BAD_REQUEST, "CEP_INVALIDO", "CEP inválido: use 8 dígitos (00000-000).");
        }
        if (!ativa) throw ErroDados.regra(HttpStatus.SERVICE_UNAVAILABLE, "CEP_DESLIGADO", MENSAGEM_FALHA);
        registrarUso(quem);
        long agora = relogio.millis();
        Entrada guardada = cache.get(cep);
        if (guardada != null && guardada.expiraEm() > agora) return devolver(guardada);
        CompletableFuture<Entrada> nova = new CompletableFuture<>();
        CompletableFuture<Entrada> existente = emAndamento.putIfAbsent(cep, nova);
        if (existente != null) {
            try {
                return devolver(existente.join());
            } catch (CompletionException e) {
                throw ErroDados.regra(HttpStatus.SERVICE_UNAVAILABLE, "CEP_INDISPONIVEL", MENSAGEM_FALHA);
            }
        }
        try {
            Entrada e = buscar(cep);
            if (e.expiraEm() > 0) guardar(cep, e);
            nova.complete(e);
            return devolver(e);
        } catch (RuntimeException e) {
            nova.completeExceptionally(e);
            throw e;
        } finally {
            emAndamento.remove(cep);
        }
    }

    private Map<String, Object> devolver(Entrada e) {
        if (e.erro() != null) throw e.erro();
        return e.endereco();
    }

    private void guardar(String cep, Entrada e) {
        if (cache.size() >= CACHE_MAXIMO) {
            long agora = relogio.millis();
            cache.values().removeIf(x -> x.expiraEm() <= agora);
            if (cache.size() >= CACHE_MAXIMO) cache.clear();
        }
        cache.put(cep, e);
    }

    private void registrarUso(String quem) {
        long minuto = relogio.millis() / 60_000;
        if (janelas.size() > 20_000) janelas.values().removeIf(j -> j.minuto() < minuto);
        Janela j = janelas.compute(quem == null ? "?" : quem, (k, atual) -> atual == null || atual.minuto() != minuto ? new Janela(minuto, new AtomicInteger()) : atual);
        if (j.usados().incrementAndGet() > POR_MINUTO) {
            throw ErroDados.regra(HttpStatus.TOO_MANY_REQUESTS, "CEP_LIMITE", "Muitas buscas de CEP seguidas. Aguarde um minuto ou preencha o endereço manualmente.");
        }
    }

    /** Uma chamada à BrasilAPI. Devolve a entrada para cache (expiraEm 0 = não guardar) ou lança a falha. */
    private Entrada buscar(String cep) {
        HttpRequest pedido = HttpRequest.newBuilder(URI.create(base + "/cep/v2/" + cep)).timeout(tempoTotal).GET()
                .header("Accept", "application/json").header("User-Agent", "AutoniCK/1.0 (consulta de CEP)").build();
        chamadasExternas.incrementAndGet();
        HttpResponse<InputStream> resposta;
        try {
            resposta = http.send(pedido, HttpResponse.BodyHandlers.ofInputStream());
        } catch (HttpTimeoutException e) {
            throw ErroDados.regra(HttpStatus.GATEWAY_TIMEOUT, "CEP_TEMPO_ESGOTADO", MENSAGEM_FALHA);
        } catch (IOException e) {
            LOG.info("Consulta de CEP indisponível: {}", e.getClass().getSimpleName());
            throw ErroDados.regra(HttpStatus.SERVICE_UNAVAILABLE, "CEP_INDISPONIVEL", MENSAGEM_FALHA);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw ErroDados.regra(HttpStatus.SERVICE_UNAVAILABLE, "CEP_INDISPONIVEL", MENSAGEM_FALHA);
        }
        int status = resposta.statusCode();
        byte[] corpo;
        try (InputStream in = resposta.body()) {
            corpo = in.readNBytes(TAMANHO_MAXIMO + 1);
        } catch (IOException e) {
            throw ErroDados.regra(HttpStatus.SERVICE_UNAVAILABLE, "CEP_INDISPONIVEL", MENSAGEM_FALHA);
        }
        long agora = relogio.millis();
        if (status == 404) {
            return new Entrada(null, ErroDados.regra(HttpStatus.NOT_FOUND, "CEP_NAO_ENCONTRADO",
                    "CEP não encontrado. Confira o número ou preencha o endereço manualmente."), agora + NAO_ENCONTRADO_MS);
        }
        if (status == 429) throw ErroDados.regra(HttpStatus.TOO_MANY_REQUESTS, "CEP_LIMITE", "O serviço de CEP pediu uma pausa. " + MENSAGEM_FALHA);
        if (status == 400) throw ErroDados.regra(HttpStatus.BAD_REQUEST, "CEP_INVALIDO", "CEP inválido: use 8 dígitos (00000-000).");
        if (status != 200 || corpo.length > TAMANHO_MAXIMO) {
            throw ErroDados.regra(HttpStatus.SERVICE_UNAVAILABLE, "CEP_INDISPONIVEL", MENSAGEM_FALHA);
        }
        JsonNode r;
        try {
            r = json.readTree(corpo);
        } catch (IOException e) {
            throw ErroDados.regra(HttpStatus.SERVICE_UNAVAILABLE, "CEP_INDISPONIVEL", MENSAGEM_FALHA);
        }
        if (r == null || !r.isObject()) throw ErroDados.regra(HttpStatus.SERVICE_UNAVAILABLE, "CEP_INDISPONIVEL", MENSAGEM_FALHA);
        Map<String, Object> endereco = new LinkedHashMap<>();
        endereco.put("cep", cep);
        String uf = texto(r, "state", 2);
        endereco.put("uf", uf != null && uf.matches("^[A-Za-z]{2}$") ? uf.toUpperCase() : null);
        endereco.put("cidade", texto(r, "city", 80));
        endereco.put("bairro", texto(r, "neighborhood", 80));
        endereco.put("logradouro", texto(r, "street", 120));
        endereco.put("fonte", "BrasilAPI");
        return new Entrada(endereco, null, agora + SUCESSO_MS);
    }

    private static String texto(JsonNode r, String campo, int maximo) {
        JsonNode v = r.get(campo);
        if (v == null || !v.isTextual()) return null;
        String s = v.asText().replaceAll("[\\p{Cntrl}<>]", "").strip();
        if (s.isEmpty()) return null;
        return s.length() > maximo ? s.substring(0, maximo) : s;
    }
}
