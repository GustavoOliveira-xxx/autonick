package br.com.ckgroup.autonick.osapi.plataforma;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/** E11: o X-Forwarded-For só é aceito de proxies configurados; sem configuração, vale o endereço da conexão. */
class EnderecoClienteTest {

    private static MockHttpServletRequest pedido(String conexao, String encaminhado) {
        MockHttpServletRequest p = new MockHttpServletRequest();
        p.setRemoteAddr(conexao);
        if (encaminhado != null) p.addHeader("X-Forwarded-For", encaminhado);
        return p;
    }

    @Test
    void semProxyConfiavelOCabecalhoForjadoEIgnorado() {
        EnderecoCliente e = new EnderecoCliente("");
        assertThat(e.de(pedido("203.0.113.7", "1.2.3.4"))).isEqualTo("203.0.113.7");
        assertThat(e.conexaoDeProxyConfiavel(pedido("203.0.113.7", null))).isFalse();
    }

    @Test
    void conexaoDeProxyConfiavelUsaOPrimeiroEnderecoNaoConfiavelDaDireita() {
        EnderecoCliente e = new EnderecoCliente("10.0.0.0/8, 192.168.1.10");
        // O cliente forjou "1.1.1.1" à esquerda; o proxy acrescentou o endereço real (198.51.100.9).
        assertThat(e.de(pedido("10.1.2.3", "1.1.1.1, 198.51.100.9"))).isEqualTo("198.51.100.9");
        assertThat(e.de(pedido("10.1.2.3", "198.51.100.9, 192.168.1.10"))).isEqualTo("198.51.100.9");
        assertThat(e.de(pedido("10.1.2.3", null))).isEqualTo("10.1.2.3");
        assertThat(e.de(pedido("10.1.2.3", "nome-qualquer.example"))).as("sem DNS, entrada inválida").isEqualTo("10.1.2.3");
        assertThat(e.de(pedido("172.16.0.1", "1.1.1.1"))).as("conexão fora da lista").isEqualTo("172.16.0.1");
    }

    @Test
    void ipv6EConfiguracaoInvalida() {
        EnderecoCliente e = new EnderecoCliente("::1");
        assertThat(e.de(pedido("0:0:0:0:0:0:0:1", "2001:db8::5"))).isEqualTo("2001:db8::5");
        assertThatThrownBy(() -> new EnderecoCliente("proxy.interno")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new EnderecoCliente("10.0.0.0/40")).isInstanceOf(IllegalArgumentException.class);
    }
}
