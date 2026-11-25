package br.com.ckgroup.autonick.osapi.plataforma;

import jakarta.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Endereço de quem fez o pedido, para limite de uso e para a origem da demonstração pública.
 *
 * <p>O cabeçalho {@code X-Forwarded-For} pode ser escrito por qualquer pessoa. Ele só é usado quando a conexão vem de um
 * proxy CONFIGURADO como confiável ({@code autonick.rede.proxies-confiaveis}: endereços ou faixas CIDR separados por vírgula;
 * vazio por padrão). Nesse caso a lista é lida da direita para a esquerda, pulando os proxies confiáveis, e o primeiro
 * endereço que não é proxy confiável é o cliente. Sem proxy confiável, vale o endereço da conexão. Nenhum nome é resolvido
 * (sem DNS): entradas que não são endereços IP literais são ignoradas.</p>
 */
@Component
public class EnderecoCliente {

    private static final Pattern IP_LITERAL = Pattern.compile("^[0-9a-fA-F:.]{2,45}$");
    private final List<Faixa> confiaveis = new ArrayList<>();

    private record Faixa(byte[] rede, int bits) {
        boolean contem(byte[] ip) {
            if (ip.length != rede.length) return false;
            int inteiros = bits / 8, resto = bits % 8;
            for (int i = 0; i < inteiros; i++) if (ip[i] != rede[i]) return false;
            if (resto == 0) return true;
            int mascara = (0xFF << (8 - resto)) & 0xFF;
            return (ip[inteiros] & mascara) == (rede[inteiros] & mascara);
        }
    }

    public EnderecoCliente(@Value("${autonick.rede.proxies-confiaveis:}") String proxies) {
        if (proxies == null) return;
        for (String parte : proxies.split(",")) {
            String p = parte.trim();
            if (p.isEmpty()) continue;
            String[] f = p.split("/", 2);
            byte[] rede = literal(f[0]);
            if (rede == null) throw new IllegalArgumentException("Proxy confiável inválido: " + p);
            int bits = f.length == 2 ? Integer.parseInt(f[1]) : rede.length * 8;
            if (bits < 0 || bits > rede.length * 8) throw new IllegalArgumentException("Faixa inválida: " + p);
            confiaveis.add(new Faixa(rede, bits));
        }
    }

    public String de(HttpServletRequest pedido) {
        String conexao = pedido.getRemoteAddr();
        if (!confiavel(conexao)) return conexao;
        String encaminhado = pedido.getHeader("X-Forwarded-For");
        if (encaminhado == null || encaminhado.isBlank()) return conexao;
        String[] cadeia = encaminhado.split(",");
        for (int i = cadeia.length - 1; i >= 0; i--) {
            String candidato = cadeia[i].trim();
            if (literal(candidato) == null) return conexao; // cadeia malformada: não confia em nada dela
            if (!confiavel(candidato)) return candidato;
        }
        return conexao;
    }

    public boolean conexaoDeProxyConfiavel(HttpServletRequest pedido) {
        return confiavel(pedido.getRemoteAddr());
    }

    boolean confiavel(String endereco) {
        byte[] ip = literal(endereco);
        return ip != null && confiaveis.stream().anyMatch(f -> f.contem(ip));
    }

    private static byte[] literal(String texto) {
        if (texto == null || !IP_LITERAL.matcher(texto).matches() || (!texto.contains(".") && !texto.contains(":"))) return null;
        try {
            return InetAddress.getByName(texto).getAddress();
        } catch (Exception erro) {
            return null;
        }
    }
}
