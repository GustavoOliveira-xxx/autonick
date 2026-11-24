import { h, esc } from '../ui.js';
import { CATEGORIAS, A, B, C, D, E, F, G, H, J, K } from '../catalogo.js';
import { loja } from '../estado.js';
import { vitrine3D } from './comum.js';
import { ANIMACOES, criarLaco, RITMOS } from '../motor/animacoes.js';

const CONTAGEM = { A: A.length - 1, B: B.length - 1, C: C.length - 1, D: D.length, E: E.length - 1, F: F.length - 1, G: G.length, H: H.length, I: 20, J: J.length - 1 };
const DESC = { A: 'Raios, luz e enquadramento centrados no sino', B: 'Martelinho, sino de balcão, mão, ímã, orbe e mais', C: 'Tempos reais medidos e cinco alternativas', D: 'Objetos procedurais no traço do sino', E: 'Movimento de fundo em três intensidades', F: 'Resposta imediata e estados honestos', G: 'Um indicador para cada contexto', H: 'Três linguagens nos componentes reais', I: 'Business, Cliente e CK Admin', J: 'A identidade CK em seis caminhos' };

export function montar(main) {
  const laco = criarLaco(ANIMACOES.B13, RITMOS.C06);
  const el = h(`<div class="cat">
    <section class="inicio-heroi">
      <div><p class="rotulo" style="font:600 .72rem var(--f-texto);letter-spacing:.18em;text-transform:uppercase;color:var(--ouro-claro)">Uma iniciativa da CK Group · em desenvolvimento contínuo</p>
        <h1>Laboratório de <em>direção artística</em> do AutoniCK</h1>
        <p>Cada alternativa aqui é uma demonstração funcionando, montada sobre os recursos reais do app: o mesmo modelo do sino, o mesmo Three.js, as mesmas fontes e cores. Experimente, compare, combine e marque o que quer levar para a próxima etapa. Nada aqui altera o aplicativo.</p>
        <div class="acoes-proposta" style="margin-top:1rem"><a class="bt bt--ouro" href="#fundo">Começar pela composição</a><a class="bt" href="#combinador">Ir direto ao combinador</a></div></div>
      <div class="inicio-sino vista"></div>
    </section>
    <div class="duas-colunas">
      <section class="painel"><h2>Como usar</h2><ol class="passos-uso">
        <li>Escolha uma categoria. No palco, troque entre desktop, celular e tela ampla e ligue "Comparar lado a lado".</li>
        <li>Passe o mouse (ou foque com o teclado) numa miniatura para tocá-la; clique para levá-la ao palco.</li>
        <li>Use ♥ para favoritar e "Escolher" para definir a sua opção da categoria (uma por categoria).</li>
        <li>No topo: pausar tudo, reiniciar, laço, velocidade, intensidade dos efeitos e simulação de movimento reduzido.</li>
        <li>No Combinador, monte a sua home misturando categorias. Em Minhas escolhas, anote e exporte em JSON ou texto.</li></ol>
        <p class="aviso-lab">Suas escolhas ficam só neste navegador${loja.persistente ? '' : ' (o armazenamento está bloqueado aqui: elas valem até fechar a página; exporte antes de sair)'}. Para levar de um navegador a outro, use Exportar e Importar em Minhas escolhas.</p></section>
      <section class="painel"><h2>O que a análise do código encontrou</h2><ul class="lista-limpa">
        <li><b>Foco do fundo fora do sino.</b> Os raios nascem em 82% × 40% do herói (componentes.css), enquanto o sino ocupa a coluna da direita: o centro não coincide e a diferença muda com a largura.</li>
        <li><b>Espera real maior do que parece no código.</b> A cena "Quem tocou?" dura 8,0 s, mas o movimento visível termina em ~7,06 s. Com a pausa de 3,5 s, o sino fica ~4,4 s parado em cada ciclo de 12,5 s.</li>
        <li><b>Recurso sem uso.</b> O GLB traz o clipe "HQ_Toque_de_Assinatura" (4,17 s), que o app não usa. Está na categoria B como B14.</li>
        <li><b>Base sólida.</b> Tokens bem nomeados (HQ Heroica, Forja Dourada, Noite Elétrica), fontes locais OFL, fallback sem WebGL e pausa fora da tela já existem; o laboratório reaproveita tudo isso.</li>
        <li><b>Clique sem estados.</b> Os botões só descem 3 px no :active; não há estado de recebido, processando, sucesso ou erro.</li></ul></section>
    </div>
    <section class="painel"><h2>Categorias</h2><div class="mapa-cats">${CATEGORIAS.map((c) => `<a href="#${c.rota}"><b>${c.id} · ${esc(c.nome)}</b><span>${CONTAGEM[c.id]} propostas · ${esc(DESC[c.id])}</span><span data-escolha="${c.id}"></span></a>`).join('')}
      <a href="#combinacoes"><b>K · Combinações prontas</b><span>${K.length} montagens completas para abrir e ajustar</span></a></div></section>
  </div>`);
  main.append(el);
  const pintar = () => el.querySelectorAll('[data-escolha]').forEach((s) => { const id = loja.escolhida(s.dataset.escolha); s.textContent = id ? `Sua escolha: ${id}` : 'Sem escolha ainda'; s.style.color = id ? 'var(--ok)' : ''; });
  const parar = loja.ouvir(pintar); pintar();
  const v = vitrine3D(el.querySelector('.inicio-sino'), { fonte: (t, ctx) => laco.quadro(t, ctx), enquadramento: ANIMACOES.B13.enquadramento, tocando: true, miniatura: false });
  return () => { parar(); v.destruir(); };
}
