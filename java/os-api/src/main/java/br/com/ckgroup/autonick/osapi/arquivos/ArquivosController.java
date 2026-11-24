package br.com.ckgroup.autonick.osapi.arquivos;

import br.com.ckgroup.autonick.osapi.plataforma.ErroDados;
import br.com.ckgroup.autonick.osapi.plataforma.Identidade;
import br.com.ckgroup.autonick.osapi.plataforma.LimiteUso;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.dao.DataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;

/**
 * Arquivos (E03): envio e leitura controlados pela API Java, com metadados no PostgreSQL.
 *
 * <pre>
 *   POST /api/arquivos            multipart: arquivo, finalidade, empresa_id?, referencia_tipo?, referencia_id?, chave
 *   GET  /api/arquivos/{id}       conteúdo, só para quem pode ler (visitante: só arquivos públicos)
 * </pre>
 * A remoção e o vínculo (logo, imagem do produto) são funções do catálogo, pela camada de dados.
 * A identidade vem só do token validado; a regra de quem pode enviar e ler está no banco (manutencao.*).
 */
@RestController
@RequestMapping("/api/arquivos")
public class ArquivosController {

    private static final Logger LOG = LoggerFactory.getLogger(ArquivosController.class);
    private static final int TAMANHO_ABSOLUTO = 20 * 1024 * 1024;
    private static final Set<String> FINALIDADES = Set.of("logo_empresa", "imagem_produto", "anexo_solicitacao", "evidencia_os", "documento");
    private static final Set<String> COM_PDF = Set.of("anexo_solicitacao", "evidencia_os", "documento");
    private static final Set<String> REFERENCIAS = Set.of("produto", "solicitacao", "ordem_servico");

    private final JdbcTemplate jdbc;
    private final TransactionTemplate escrita;
    private final TransactionTemplate leitura;
    private final ArmazenamentoArquivos armazenamento;
    private final LimiteUso limite;
    private final ObjectMapper json = new ObjectMapper();

    public ArquivosController(JdbcTemplate jdbc, PlatformTransactionManager transacoes, ArmazenamentoArquivos armazenamento, LimiteUso limite) {
        this.jdbc = jdbc;
        this.escrita = new TransactionTemplate(transacoes);
        this.leitura = new TransactionTemplate(transacoes);
        this.leitura.setReadOnly(true);
        this.armazenamento = armazenamento;
        this.limite = limite;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<String> enviar(@AuthenticationPrincipal Jwt jwt, @RequestParam("arquivo") MultipartFile arquivo,
            @RequestParam("finalidade") String finalidade, @RequestParam(name = "empresa_id", required = false) String empresaId,
            @RequestParam(name = "referencia_tipo", required = false) String referenciaTipo,
            @RequestParam(name = "referencia_id", required = false) String referenciaId,
            @RequestParam(name = "chave", required = false) String chave) throws IOException {
        Identidade quem = Identidade.de(jwt);
        if (quem.anonima()) throw ErroDados.regra(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "Entre para enviar arquivos.");
        limite.registrar(quem.sub(), true);
        if (!FINALIDADES.contains(finalidade)) throw ErroDados.validacao("Finalidade de arquivo desconhecida.");
        if (empresaId != null && !empresaId.isBlank() && !ArmazenamentoArquivos.idValido(empresaId)) throw ErroDados.validacao(ErroDados.CONFIRA);
        if (referenciaTipo != null && !referenciaTipo.isBlank() && !REFERENCIAS.contains(referenciaTipo)) throw ErroDados.validacao(ErroDados.CONFIRA);
        if (referenciaId != null && !referenciaId.isBlank() && !ArmazenamentoArquivos.idValido(referenciaId)) throw ErroDados.validacao(ErroDados.CONFIRA);
        if (chave == null || chave.isBlank() || chave.length() > 120) throw ErroDados.validacao("Chave de operação ausente.");
        if (arquivo.isEmpty()) throw ErroDados.validacao("Escolha um arquivo.");
        if (arquivo.getSize() > TAMANHO_ABSOLUTO) throw ErroDados.validacao("O arquivo é grande demais.");

        ConteudoArquivo.Resultado pronto = ConteudoArquivo.preparar(arquivo.getBytes(), COM_PDF.contains(finalidade));
        String sha = sha256(pronto.bytes());
        String nome = nomeSeguro(arquivo.getOriginalFilename());
        Path tmp = armazenamento.temporario(pronto.bytes());
        Path[] gravado = new Path[1];
        try {
            String resposta = escrita.execute(status -> {
                identidade(quem.sub());
                String r = jdbc.queryForObject("SELECT manutencao.arquivo_registrar(?::uuid, ?, ?, ?, ?, ?, ?, ?, ?, ?::uuid, ?)::text", String.class,
                        vazio(empresaId), finalidade, pronto.tipoMime(), pronto.bytes().length, pronto.largura(), pronto.altura(), sha, nome,
                        vazio(referenciaTipo), vazio(referenciaId), chave);
                UUID id = UUID.fromString(ler(r).path("id").asText());
                try {
                    // Repetição idempotente (mesma chave): o arquivo já existe; o temporário novo é descartado.
                    if (Files.exists(armazenamento.caminho(id))) armazenamento.apagarSilencioso(tmp);
                    else gravado[0] = armazenamento.efetivar(tmp, id);
                } catch (IOException erro) {
                    throw new IllegalStateException("Falha ao gravar o arquivo", erro);
                }
                return r;
            });
            return ResponseEntity.status(HttpStatus.CREATED).contentType(MediaType.APPLICATION_JSON).body(resposta);
        } catch (RuntimeException erro) {
            // A transação foi desfeita: nada pode ficar no disco sem metadados.
            armazenamento.apagarSilencioso(tmp);
            armazenamento.apagarSilencioso(gravado[0]);
            throw erro;
        }
    }

    @GetMapping("/{id}")
    ResponseEntity<Resource> ler(@AuthenticationPrincipal Jwt jwt, @PathVariable String id,
            @RequestHeader(name = HttpHeaders.IF_NONE_MATCH, required = false) String seNaoCombinar) {
        if (!ArmazenamentoArquivos.idValido(id)) return ResponseEntity.notFound().build();
        String sub = jwt == null || "anonymous".equals(jwt.getClaimAsString("role")) ? null : jwt.getSubject();
        String meta = leitura.execute(status -> {
            if (sub != null) identidade(sub); else anonimo();
            return jdbc.queryForObject("SELECT manutencao.arquivo_para_leitura(?::uuid)::text", String.class, id);
        });
        if (meta == null) return ResponseEntity.notFound().build();
        JsonNode m = ler(meta);
        Path caminho = armazenamento.caminho(UUID.fromString(id));
        if (!Files.isRegularFile(caminho)) {
            LOG.warn("Arquivo {} tem metadados mas não está no armazenamento", id);
            return ResponseEntity.notFound().build();
        }
        String etag = "\"" + m.path("sha256").asText() + "\"";
        boolean publico = m.path("publico").asBoolean(false);
        CacheControl cache = publico ? CacheControl.maxAge(java.time.Duration.ofHours(1)).cachePublic() : CacheControl.noStore().cachePrivate();
        if (etag.equals(seNaoCombinar)) return ResponseEntity.status(HttpStatus.NOT_MODIFIED).eTag(etag).cacheControl(cache).build();
        String tipo = m.path("tipo_mime").asText();
        boolean pdf = "application/pdf".equals(tipo);
        String nome = m.path("nome_original").asText(pdf ? "documento.pdf" : "imagem");
        String disposicao = (pdf ? "attachment" : "inline") + "; filename*=UTF-8''" + URLEncoder.encode(nome, StandardCharsets.UTF_8).replace("+", "%20");
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(tipo))
                .contentLength(m.path("tamanho_bytes").asLong())
                .eTag(etag)
                .cacheControl(cache)
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox")
                .header("Cross-Origin-Resource-Policy", "same-origin")
                .header(HttpHeaders.CONTENT_DISPOSITION, disposicao)
                .body(new FileSystemResource(caminho));
    }

    /** Limpeza de temporários e órfãos ao iniciar (sem identidade: função de manutenção do papel da API). */
    @EventListener(ApplicationReadyEvent.class)
    public void limparAoIniciar() {
        try {
            int[] r = armazenamento.limpar(ids -> ids.isEmpty() ? List.of()
                    : jdbc.queryForList("SELECT id FROM manutencao.arquivos_com_metadados(?::uuid[])", UUID.class, (Object) ids.stream().map(UUID::toString).toArray(String[]::new)));
            if (r[0] + r[1] > 0) LOG.info("Armazenamento de arquivos: {} temporário(s) e {} órfão(s) removidos", r[0], r[1]);
        } catch (DataAccessException erro) {
            LOG.warn("Limpeza do armazenamento adiada: {}", erro.getMostSpecificCause().getMessage());
        }
    }

    private void identidade(String sub) {
        Map<String, String> claims = Map.of("sub", sub, "role", "authenticated");
        jdbc.queryForObject("SELECT set_config('request.jwt.claims', ?, true)", String.class, texto(claims));
    }

    private void anonimo() {
        jdbc.queryForObject("SELECT set_config('request.jwt.claims', ?, true)", String.class, "{\"role\":\"anonymous\"}");
    }

    private String texto(Object o) {
        try {
            return json.writeValueAsString(o);
        } catch (IOException erro) {
            throw new IllegalStateException(erro);
        }
    }

    private JsonNode ler(String s) {
        try {
            return json.readTree(s);
        } catch (IOException erro) {
            throw new IllegalStateException(erro);
        }
    }

    private static String vazio(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    static String nomeSeguro(String original) {
        if (original == null) return null;
        String base = original.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}\"<>]", "").strip();
        return base.isEmpty() ? null : base.length() > 200 ? base.substring(0, 200) : base;
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException erro) {
            throw new IllegalStateException(erro);
        }
    }

    @ExceptionHandler(ErroDados.class)
    ResponseEntity<Map<String, Object>> recusa(ErroDados erro) {
        return ResponseEntity.status(erro.status).body(erro.corpo());
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<Map<String, Object>> grande(MaxUploadSizeExceededException erro) {
        return recusa(ErroDados.validacao("O arquivo é grande demais."));
    }

    @ExceptionHandler({DataAccessException.class, TransactionException.class})
    ResponseEntity<Map<String, Object>> banco(RuntimeException erro) {
        ErroDados traduzido = br.com.ckgroup.autonick.osapi.plataforma.DadosController.traduzirErro(erro);
        if (traduzido.status.is5xxServerError()) LOG.error("Falha do banco no envio de arquivo", erro);
        return recusa(traduzido);
    }
}
