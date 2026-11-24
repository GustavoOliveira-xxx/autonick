import { h, esc, cabecalho, acoes, segmentado } from '../ui.js';
import { OBJETOS } from '../motor/objetos.js';
import { poseNeutra } from '../motor/curvas.js';
import { vitrine3D } from './comum.js';

const linhas = (n) => Array.from({ length: n }, (_, i) => `<span style="display:block;height:.55rem;margin:.35rem 0;background:#e9dcc2;width:${90 - i * 14}%"></span>`).join('');
const S = (id, area, nome, obj, onde, ideia, porque, mock = '') => ({ id, area, nome, obj, onde, ideia, porque, mock, intensidade: obj ? 'Equilibrado' : 'Sutil' });
export const CENAS = [
  S('IB01', 'business', 'Dashboard: meta batida', 'moeda', 'Painel, escudo "Vendas do mês"', 'Quando a venda do mês passa da meta, a moeda CK gira uma vez ao lado do número e o valor conta até o total.', 'Celebra um fato real, uma vez; nos outros dias o painel fica quieto.', '<b class="kpi">R$ 304,00</b><span>3 vendas confirmadas · meta R$ 300</span>'),
  S('IB02', 'business', 'Estoque: estado vazio', 'caixa', 'Estoque sem produtos cadastrados', 'Uma caixa CK se abre com brilho e convida a cadastrar o primeiro produto.', 'Explica a ação no lugar mais vazio do app.', '<b>Nenhum produto ainda</b><span>Cadastre o primeiro para controlar o estoque.</span>'),
  S('IB03', 'business', 'Vendas: venda concluída', 'recibo', 'Depois de "Salvar venda" confirmado', 'O recibo sai da impressora por 1 s ao lado do resumo da venda.', 'Confirmação concreta de que o documento existe.', '<b>Venda nº 18 salva</b><span>Cida Ramos · R$ 69,90 · Pix</span>'),
  S('IB04', 'business', 'Financeiro: fechamento', 'calculadora', 'Fechar caixa do dia', 'A calculadora soma enquanto as etapas reais avançam; no fim mostra o saldo no visor.', 'Traduz uma operação sensível em algo compreensível.', '<b>Fechar caixa</b><span>Validando · Calculando · Registrando</span>'),
  S('IB05', 'business', 'Produtos: sem foto', 'etiqueta', 'Cadastro de produto sem imagem', 'No lugar da foto, a etiqueta de preço balança com o valor do produto.', 'Evita o quadrado cinza genérico.', '<b>Capa de silicone</b><span>R$ 29,90 · 5 em estoque</span>'),
  S('IB06', 'business', 'Ordens de serviço: etapa concluída', 'prancheta', 'Ao informar conclusão da OS', 'A prancheta marca o item e o sino toca "PRONTO!".', 'O cliente e a empresa veem o mesmo momento.', '<b>OS nº 3 · Troca de tela</b><span>Diagnóstico ✓ · Troca ✓ · Teste ✓</span>'),
  S('IB07', 'business', 'Agenda: lembrete', 'campainha', 'Compromisso em 15 minutos', 'A campainha de balcão dá um DING discreto ao lado do horário.', 'Lembrete com a cara do atendimento.', '<b>14:30 · Retirada</b><span>Cida Ramos · em 15 min</span>'),
  S('IB08', 'business', 'Relatórios: só movimento', null, 'Relatório mensal', 'Sem 3D: barras crescem uma vez ao abrir e os números entram em sequência.', 'Exemplo de onde o 3D não agrega: o dado é o protagonista.', '<div class="mini-barras"><i style="--h:30%"></i><i style="--h:55%"></i><i style="--h:42%"></i><i style="--h:90%"></i></div>'),
  S('IC01', 'cliente', 'Descoberta: empresa verificada', 'escudo', 'Cartão de empresa aprovada na vitrine', 'Um pequeno escudo CK brilha ao lado do nome das empresas aprovadas pela moderação.', 'Confiança visível, com a marca.', '<b>[TESTE] Conserta Celular</b><span>Campinas (SP) · aprovada pela CK</span>'),
  S('IC02', 'cliente', 'Busca sem resultado', 'balao', 'Busca que não encontrou nada', 'O balão "digitando" sugere trocar o bairro ou a categoria.', 'Transforma o vazio em conversa.', '<b>Nada encontrado em "chaveiro"</b><span>Tente outro bairro ou categoria.</span>'),
  S('IC03', 'cliente', 'Pedidos: item adicionado', 'cesta', 'Ao pedir um produto', 'Os itens caem na cesta e ela quica de leve.', 'Feedback de compra sem carrinho genérico.', '<b>Seu pedido</b><span>2 itens · R$ 49,80</span>'),
  S('IC04', 'cliente', 'Orçamentos: resposta chegando', 'balao', 'Orçamento aguardando a empresa', 'O balão digitando enquanto a empresa responde; vira "!" quando chega.', 'Mostra que há uma pessoa do outro lado.', '<b>Orçamento: troca de bateria</b><span>A empresa está respondendo…</span>'),
  S('IC05', 'cliente', 'Acompanhamento do serviço', 'chave', 'Página da OS do lado do cliente', 'A chave inglesa dá um toque no sino a cada etapa concluída pela empresa.', 'Acompanhar vira uma pequena história.', '<b>Seu serviço</b><span>Aguardando início → Em execução</span>'),
  S('IC06', 'cliente', 'Confirmação de aceite', 'carimbo', 'Cliente aceita o orçamento', 'O carimbo APROVADO bate na folha do orçamento.', 'Confirmação inequívoca de um acordo.', '<b>Orçamento aceito</b><span>R$ 180,00 · início amanhã</span>'),
  S('IA01', 'ck', 'Aprovação de empresas', 'carimbo', 'Fila de aprovação do CK Admin', 'Ao aprovar, o carimbo marca a ficha da empresa.', 'Registra visualmente uma decisão de moderação.', '<b>Ateliê Ponto Firme</b><span>Aguardando aprovação</span>'),
  S('IA02', 'ck', 'Moderação', 'escudo', 'Ao suspender uma vitrine', 'O escudo bloqueia o raio: a vitrine sai do ar com segurança.', 'Comunica proteção, não punição.', '<b>Suspender vitrine</b><span>Gravidade: comum</span>'),
  S('IA03', 'ck', 'Indicadores administrativos', 'engrenagem', 'Painel do CK Admin', 'A engrenagem gira enquanto os indicadores são recalculados; os números entram em contagem.', 'Mostra trabalho real em andamento.', '<b class="kpi">4 empresas</b><span>1 em análise · 0 denúncias</span>'),
  S('IA04', 'ck', 'Denúncias', 'balao', 'Nova denúncia recebida', 'Balão com "!" vermelho aparece ao lado do contador.', 'Atenção sem alarme estridente.', '<b>Denúncias</b><span>1 nova para analisar</span>'),
  S('IA05', 'ck', 'Contestações', 'manopla', 'Contestação de moderação', 'A manopla aponta para o trecho contestado.', 'Guia o olhar para o ponto da discussão.', '<b>Contestação nº 2</b><span>"A avaliação foi removida sem motivo."</span>'),
  S('IA06', 'ck', 'Configurações da plataforma', 'engrenagem', 'Futuras configurações e limites', 'Engrenagens se encaixam ao salvar uma configuração.', 'Metáfora clara para ajustes do sistema.', '<b>Limites da plataforma</b><span>Empresas por conta: 3</span>'),
];

export function montar(main) {
  let area = 'business';
  main.append(cabecalho('I', 'Dinamismo e 3D nas áreas do AutoniCK', 'Vinte momentos em Business, Cliente e CK Admin. Em cada um, o 3D aparece uma vez, motivado por um evento real (meta batida, venda salva, aprovação), e some. Um exemplo (Relatórios) mostra onde o 3D não deve entrar.', [
    ['Regra', 'nada de 3D em tabelas ou formulários; só estados vazios, confirmações e marcos'],
    ['Custo', 'um objeto por vez, no mesmo contexto WebGL; pausado fora da tela'],
    ['CK Admin', 'mantém a Noite Elétrica do app'],
  ]));
  const barra = h('<div class="palco-barra"><div class="titulo-palco"><b>Área</b></div></div>');
  barra.append(segmentado('Área', [['business', 'Business'], ['cliente', 'Cliente'], ['ck', 'CK Admin']], area, (v) => { area = v; render(); }));
  const grade = h('<div class="grade grade--larga"></div>');
  const bloco = h('<section class="palco-bloco"></section>'); bloco.append(barra, grade);
  main.append(bloco);
  let vistas = [];
  function render() {
    vistas.forEach((v) => v.destruir()); vistas = []; grade.innerHTML = '';
    for (const c of CENAS.filter((x) => x.area === area)) {
      const escuro = area === 'ck';
      const el = h(`<article class="cartao-prop" data-id="${c.id}"><div class="cena-i ${escuro ? 'cena-i--ck' : ''}"><div class="cena-i-mock">${c.mock}</div><div class="cena-i-3d vista"></div></div>
        <div class="corpo"><h3><span class="id">${c.id}</span>${esc(c.nome)}</h3><p><b>Onde:</b> ${esc(c.onde)}</p><p><b>Ideia:</b> ${esc(c.ideia)}</p><p><b>Por que agrega:</b> ${esc(c.porque)}</p><div class="rodape-cartao"><button type="button" class="bt bt--pequeno bt--ouro" data-rep>▶ Reproduzir</button></div></div></article>`);
      el.querySelector('.rodape-cartao').append(acoes('I', c, { pequeno: true, semEscolher: true }));
      const palco = el.querySelector('.cena-i-3d');
      if (c.obj) {
        const d = OBJETOS[c.obj]; let t0 = -10;
        const v = vitrine3D(palco, {
          sino: false, miniatura: true, enquadramento: { meiaAltura: 0.95, meiaLargura: 0.95, deslocX: d.pouso[0], deslocY: d.pouso[1] + 0.35 - 1.15 },
          fonte: (t) => { const p = poseNeutra(); const u = t - t0; const e = u >= 0 && u < d.dur.interacao ? d.interacao(u, p) : d.ocioso(t); p.hq = p.hq.filter((g) => Array.isArray(g.em)); p.objetos = [{ id: c.obj, ...e }]; return { pose: p, info: {} }; },
        });
        vistas.push(v);
        el.querySelector('[data-rep]').addEventListener('click', () => { const vv = v.vista; if (!vv) return; t0 = vv.t; vv.tocar(); setTimeout(() => vv.pausar(), (d.dur.interacao + 0.4) * 1000); });
      } else {
        palco.remove();
        el.querySelector('[data-rep]').addEventListener('click', () => { const b = el.querySelector('.mini-barras'); b.classList.remove('cresce'); void b.offsetWidth; b.classList.add('cresce'); });
      }
      grade.append(el);
    }
  }
  render();
  return () => vistas.forEach((v) => v.destruir());
}
