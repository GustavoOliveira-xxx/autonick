package br.com.ckgroup.autonick.demo;

import java.util.LinkedHashMap;
import java.util.Map;

/** Pessoas FICTÍCIAS da demonstração. Só Cliente Demo, Gestor, Técnico e Cliente Quatro podem "entrar"; as demais existem para o isolamento. */
public final class Pessoas {

    public record Pessoa(String id, String email, String nome, String tipo) {
    }

    public static final Pessoa CLIENTE = new Pessoa("ec0a0300-0000-4000-8000-000000000001", "cliente.j03@autonick-teste.example", "Cliente Demo J03", "cliente");
    public static final Pessoa GESTOR = new Pessoa("ec0a0300-0000-4000-8000-000000000002", "gestor.j03@autonick-teste.example", "Gestor Demo J03", "business");
    public static final Pessoa OUTRO_CLIENTE = new Pessoa("ec0a0300-0000-4000-8000-000000000003", "outro.j03@autonick-teste.example", "Outro Cliente J03", "cliente");
    public static final Pessoa DONO_A = new Pessoa("ec0a0300-0000-4000-8000-000000000004", "dono-a.j03@autonick-teste.example", "Dono da Elétrica Demo", "business");
    public static final Pessoa DONO_B = new Pessoa("ec0a0300-0000-4000-8000-000000000005", "dono-b.j03@autonick-teste.example", "Dona da Outra Empresa", "business");
    /** J05: membro da Elétrica que vê as OS mas não tem servicos.alterar (não pode iniciar). */
    public static final Pessoa TECNICO = new Pessoa("ec0a0300-0000-4000-8000-000000000007", "tecnico.j05@autonick-teste.example", "Técnico Demo J05", "business");
    /** J05: cliente das OS usadas só para testar "Iniciar" (não aparece nas listas do Cliente Demo). */
    public static final Pessoa CLIENTE_TRES = new Pessoa("ec0a0300-0000-4000-8000-000000000008", "cliente-tres.j05@autonick-teste.example", "Cliente Três J05", "cliente");
    /** J08: cliente com OS da Outra Empresa já concluídas, para testar as respostas do Cliente (não muda as listas acima). */
    public static final Pessoa CLIENTE_QUATRO = new Pessoa("ec0a0300-0000-4000-8000-000000000009", "cliente-quatro.j08@autonick-teste.example", "Cliente Quatro J08", "cliente");
    /** J11: membro da Elétrica que altera OS e propõe estoque, mas não aprova estoque (o uso dele fica pendente). Não entra pela /demo/. */
    public static final Pessoa AUXILIAR = new Pessoa("ec0a0300-0000-4000-8000-000000000010", "auxiliar.j11@autonick-teste.example", "Auxiliar Demo J11", "business");
    public static final Pessoa CK = new Pessoa("ec0a0300-0000-4000-8000-000000000006", "ck.j03@autonick-teste.example", "CK fictícia J03", "business");

    /** Quem pode entrar pela página /demo/. */
    public static final Map<String, Pessoa> PODEM_ENTRAR = new LinkedHashMap<>();

    static {
        PODEM_ENTRAR.put("cliente", CLIENTE);
        PODEM_ENTRAR.put("gestor", GESTOR);
        PODEM_ENTRAR.put("tecnico", TECNICO);
        PODEM_ENTRAR.put("cliente-quatro", CLIENTE_QUATRO);
    }

    private Pessoas() {
    }
}
