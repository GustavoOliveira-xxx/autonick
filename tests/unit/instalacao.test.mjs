/** M13 (D13-02): qual orientação de instalação aparece em cada situação. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orientacao, TEXTOS_INSTALACAO } from '../../public/js/ui/instalacao.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

test('instalado tem prioridade sobre tudo', () => {
  assert.equal(orientacao({ instalado: true, temConvite: true, agente: DESKTOP }), 'instalado');
});

test('com o convite do navegador (Chrome ou Edge), aparece o botão', () => {
  assert.equal(orientacao({ instalado: false, temConvite: true, agente: ANDROID }), 'botao');
  assert.equal(orientacao({ instalado: false, temConvite: true, agente: DESKTOP }), 'botao');
});

test('sem o botão, cada aparelho recebe a orientação aplicável', () => {
  assert.equal(orientacao({ instalado: false, temConvite: false, agente: IPHONE }), 'ios-safari');
  assert.equal(orientacao({ instalado: false, temConvite: false, agente: IPAD, pontosDeToque: 5 }), 'ios-safari');
  assert.equal(orientacao({ instalado: false, temConvite: false, agente: IPHONE_CHROME }), 'ios-outro');
  assert.equal(orientacao({ instalado: false, temConvite: false, agente: ANDROID }), 'android');
  assert.equal(orientacao({ instalado: false, temConvite: false, agente: DESKTOP }), 'computador');
  assert.equal(orientacao({ instalado: false, temConvite: false, agente: IPAD, pontosDeToque: 0 }), 'computador');
});

test('textos lembram que as operações precisam de internet e não prometem instalação concluída', () => {
  assert.match(TEXTOS_INSTALACAO.botao, /precisando de internet/);
  for (const texto of Object.values(TEXTOS_INSTALACAO)) assert.doesNotMatch(texto, /instalado com sucesso/i);
});
