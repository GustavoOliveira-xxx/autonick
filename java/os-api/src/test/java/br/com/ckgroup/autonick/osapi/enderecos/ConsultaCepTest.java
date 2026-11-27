package br.com.ckgroup.autonick.osapi.enderecos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import br.com.ckgroup.autonick.osapi.plataforma.ErroDados;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Consulta de CEP com um servidor local que imita a BrasilAPI (respostas determinísticas, sem internet): mapeamento dos
 * campos, cada tipo de falha, limite de tamanho, redirecionamento recusado, cache de 24 h, coalescência, limite por pessoa e
 * recusa de base arbitrária.
 */
class ConsultaCepTest {

    private HttpServer servidor;
    private final AtomicInteger chamadas = new AtomicInteger();
    private final AtomicReference<String> caminho = new AtomicReference<>();
    private volatile int status = 200;
    private volatile String corpo = "";
    private volatile long atrasoMs = 0;
    private volatile String cabecalhoCookie;

    @BeforeEach
    void subir() throws IOException {
        servidor = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        servidor.setExecutor(Executors.newCachedThreadPool());
        servidor.createContext("/api/cep/v2/", troca -> {
            chamadas.incrementAndGet();
            caminho.set(troca.getRequestURI().getPath());
            cabecalhoCookie = troca.getRequestHeaders().getFirst("Cookie");
            try {
                if (atrasoMs > 0) Thread.sleep(atrasoMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            byte[] b = corpo.getBytes(StandardCharsets.UTF_8);
            if (status == 302) troca.getResponseHeaders().add("Location", "https://exemplo.invalid/");
            troca.sendResponseHeaders(status, b.length == 0 ? -1 : b.length);
            if (b.length > 0) troca.getResponseBody().write(b);
            troca.close();
        });
        servidor.start();
    }

    @AfterEach
    void descer() {
        servidor.stop(0);
    }

    private ConsultaCep consulta(Clock relogio) {
        return new ConsultaCep("http://127.0.0.1:" + servidor.getAddress().getPort() + "/api", true, Duration.ofSeconds(1), Duration.ofMillis(800), relogio);
    }

    private static String codigo(Throwable t) {
        return ((ErroDados) t).dica;
    }

    @Test
    void mapeiaOsCamposEEnviaSoOCep() {
        corpo = "{\"cep\":\"01001000\",\"state\":\"SP\",\"city\":\"São Paulo\",\"neighborhood\":\"Sé\",\"street\":\"Praça da Sé\",\"service\":\"x\",\"location\":{}}";
        Map<String, Object> r = consulta(Clock.systemUTC()).consultar("01001-000", "pessoa-1");
        assertThat(r).containsEntry("cep", "01001000").containsEntry("uf", "SP").containsEntry("cidade", "São Paulo")
                .containsEntry("bairro", "Sé").containsEntry("logradouro", "Praça da Sé").doesNotContainKey("location");
        assertThat(caminho.get()).isEqualTo("/api/cep/v2/01001000");
        assertThat(cabecalhoCookie).isNull();
    }

    @Test
    void cepGenericoSemRuaNemBairroContinuaValido() {
        corpo = "{\"cep\":\"13000000\",\"state\":\"SP\",\"city\":\"Campinas\"}";
        Map<String, Object> r = consulta(Clock.systemUTC()).consultar("13000000", "p");
        assertThat(r.get("logradouro")).isNull();
        assertThat(r.get("bairro")).isNull();
        assertThat(r).containsEntry("cidade", "Campinas");
    }

    @Test
    void formatoInvalidoNemSaiParaAInternet() {
        ConsultaCep c = consulta(Clock.systemUTC());
        for (String ruim : new String[] {"1234567", "123456789", "ABCDE-123", "", "../../x"}) {
            assertThatThrownBy(() -> c.consultar(ruim, "p")).satisfies(t -> assertThat(codigo(t)).isEqualTo("CEP_INVALIDO"));
        }
        assertThat(chamadas.get()).isZero();
    }

    @Test
    void cadaFalhaTemSeuCodigo() {
        ConsultaCep c = consulta(Clock.systemUTC());
        status = 404;
        corpo = "{\"name\":\"CepPromiseError\"}";
        assertThatThrownBy(() -> c.consultar("99999999", "p")).satisfies(t -> assertThat(codigo(t)).isEqualTo("CEP_NAO_ENCONTRADO"));
        status = 429;
        assertThatThrownBy(() -> c.consultar("11111111", "p")).satisfies(t -> assertThat(codigo(t)).isEqualTo("CEP_LIMITE"));
        status = 500;
        assertThatThrownBy(() -> c.consultar("22222222", "p")).satisfies(t -> {
            assertThat(codigo(t)).isEqualTo("CEP_INDISPONIVEL");
            assertThat(t.getMessage()).isEqualTo(ConsultaCep.MENSAGEM_FALHA);
        });
        status = 302;
        corpo = "";
        assertThatThrownBy(() -> c.consultar("33333333", "p")).satisfies(t -> assertThat(codigo(t)).isEqualTo("CEP_INDISPONIVEL"));
        status = 200;
        corpo = "x".repeat(40_000);
        assertThatThrownBy(() -> c.consultar("44444444", "p")).satisfies(t -> assertThat(codigo(t)).isEqualTo("CEP_INDISPONIVEL"));
        corpo = "não é json";
        assertThatThrownBy(() -> c.consultar("55555555", "p")).satisfies(t -> assertThat(codigo(t)).isEqualTo("CEP_INDISPONIVEL"));
        corpo = "{}";
        atrasoMs = 1500;
        assertThatThrownBy(() -> c.consultar("66666666", "p")).satisfies(t -> assertThat(codigo(t)).isEqualTo("CEP_TEMPO_ESGOTADO"));
    }

    @Test
    void semConexaoViraIndisponivel() {
        ConsultaCep c = consulta(Clock.systemUTC());
        servidor.stop(0);
        assertThatThrownBy(() -> c.consultar("01001000", "p")).satisfies(t -> assertThat(codigo(t)).isIn("CEP_INDISPONIVEL", "CEP_TEMPO_ESGOTADO"));
    }

    @Test
    void cacheDe24HorasParaSucessoEFalhaNaoFicaGuardada() {
        AtomicReference<Instant> agora = new AtomicReference<>(Instant.parse("2026-11-27T12:00:00Z"));
        Clock relogio = new Clock() {
            @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(java.time.ZoneId z) { return this; }
            @Override public Instant instant() { return agora.get(); }
        };
        ConsultaCep c = consulta(relogio);
        corpo = "{\"state\":\"SP\",\"city\":\"Campinas\"}";
        c.consultar("13010000", "p");
        c.consultar("13010-000", "q");
        assertThat(chamadas.get()).isEqualTo(1);
        agora.set(agora.get().plus(Duration.ofHours(25)));
        c.consultar("13010000", "p");
        assertThat(chamadas.get()).isEqualTo(2);
        status = 500;
        assertThatThrownBy(() -> c.consultar("13020000", "p")).isInstanceOf(ErroDados.class);
        status = 200;
        c.consultar("13020000", "p");
        assertThat(chamadas.get()).isEqualTo(4);
    }

    @Test
    void consultasSimultaneasDoMesmoCepViramUmaChamada() throws Exception {
        corpo = "{\"state\":\"SP\",\"city\":\"Campinas\"}";
        atrasoMs = 300;
        ConsultaCep c = consulta(Clock.systemUTC());
        ExecutorService ex = Executors.newFixedThreadPool(6);
        CountDownLatch largada = new CountDownLatch(1);
        List<Future<Map<String, Object>>> fs = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            String quem = "pessoa-" + i;
            fs.add(ex.submit(() -> { largada.await(); return c.consultar("13030000", quem); }));
        }
        largada.countDown();
        for (Future<Map<String, Object>> f : fs) assertThat(f.get()).containsEntry("cidade", "Campinas");
        ex.shutdown();
        assertThat(chamadas.get()).isEqualTo(1);
    }

    @Test
    void limitePorPessoaACadaMinuto() {
        corpo = "{\"state\":\"SP\",\"city\":\"Campinas\"}";
        ConsultaCep c = consulta(Clock.systemUTC());
        for (int i = 0; i < 20; i++) c.consultar("13040000", "apressada");
        assertThatThrownBy(() -> c.consultar("13040000", "apressada")).satisfies(t -> assertThat(codigo(t)).isEqualTo("CEP_LIMITE"));
        assertThat(c.consultar("13040000", "outra")).containsEntry("cidade", "Campinas");
    }

    @Test
    void baseArbitrariaERecusadaNaPartida() {
        for (String base : new String[] {"https://evil.example/api", "http://brasilapi.com.br/api", "http://10.0.0.1/api", "file:///etc"}) {
            assertThatThrownBy(() -> new ConsultaCep(base, true, Duration.ofSeconds(1), Duration.ofSeconds(1), Clock.systemUTC()))
                    .isInstanceOf(IllegalStateException.class);
        }
        assertThat(new ConsultaCep("", true, Duration.ofSeconds(1), Duration.ofSeconds(1), Clock.systemUTC())).isNotNull();
    }

    @Test
    void desligadaNaoChamaNada() {
        ConsultaCep c = new ConsultaCep("http://127.0.0.1:" + servidor.getAddress().getPort() + "/api", false, Duration.ofSeconds(1), Duration.ofSeconds(1), Clock.systemUTC());
        assertThatThrownBy(() -> c.consultar("01001000", "p")).satisfies(t -> assertThat(codigo(t)).isEqualTo("CEP_DESLIGADO"));
        assertThat(chamadas.get()).isZero();
    }
}
