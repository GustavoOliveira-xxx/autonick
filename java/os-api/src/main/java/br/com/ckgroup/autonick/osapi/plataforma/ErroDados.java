package br.com.ckgroup.autonick.osapi.plataforma;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * Recusa ou falha da camada de dados, no mesmo formato de erro que a PWA já interpreta (code, message, hint, details):
 * o código de regra vai em {@code hint}, a mensagem em português em {@code message} e o campo em {@code details}.
 */
public class ErroDados extends RuntimeException {

    public static final String CONFIRA = "Confira os dados informados.";

    public final HttpStatus status;
    public final String codigo;
    public final String dica;
    public final String detalhe;

    public ErroDados(HttpStatus status, String codigo, String mensagem, String dica, String detalhe) {
        super(mensagem);
        this.status = status;
        this.codigo = codigo;
        this.dica = dica;
        this.detalhe = detalhe;
    }

    public static ErroDados regra(HttpStatus status, String dica, String mensagem) {
        return new ErroDados(status, "P0001", mensagem, dica, null);
    }

    public static ErroDados validacao(String mensagem) {
        return new ErroDados(HttpStatus.BAD_REQUEST, "P0001", mensagem, "VALIDATION_ERROR", null);
    }

    public static ErroDados indisponivel(String recurso) {
        return new ErroDados(HttpStatus.NOT_FOUND, "PGRST202", "Operação não disponível: " + recurso + ".", null, null);
    }

    public Map<String, Object> corpo() {
        Map<String, Object> corpo = new LinkedHashMap<>();
        corpo.put("code", codigo);
        corpo.put("message", getMessage());
        corpo.put("hint", dica);
        corpo.put("details", detalhe);
        return corpo;
    }
}
