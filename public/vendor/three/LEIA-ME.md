# three.js r160 (MIT)

Cópia mínima do pacote npm `three@0.160.0` (licença MIT, em `LICENSE`), usada só pelo sino 3D do herói da página de
apresentação (`js/ui/sino-hq/`). Carregada sob demanda, depois do texto e dos botões; não vem de CDN e não faz chamadas de
rede além do GLB do próprio app.

| Arquivo aqui | Origem no pacote | Alteração |
|---|---|---|
| `three.module.min.js` | `build/three.module.min.js` | nenhuma |
| `addons/loaders/GLTFLoader.js` | `examples/jsm/loaders/GLTFLoader.js` | `from 'three'` → `from '../../three.module.min.js'` |
| `addons/utils/BufferGeometryUtils.js` | `examples/jsm/utils/BufferGeometryUtils.js` | `from 'three'` → `from '../../three.module.min.js'` |

Por que a troca do `import`: a CSP do app (`script-src 'self'`) não aceita o `importmap` inline que resolveria o nome
`three`, então os dois complementos apontam direto para o arquivo do núcleo.

Para atualizar: trocar a versão, `npm pack three@<versão>` (ou `npm install` numa pasta à parte), copiar os três arquivos
acima e refazer a mesma troca de `import`. Conferir com `npm run test:unit` (o teste do sino carrega o laço da animação) e
`npx playwright test tests/e2e/apresentacao.spec.mjs`.
