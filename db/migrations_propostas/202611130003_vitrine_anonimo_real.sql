-- 202611130003: correção do M10 achada na verificação real no Neon `desenvolvimento` (14/11/2026).
-- No Neon, o visitante sem login usa um JWT anônimo emitido pelo Neon Auth (`GET /token/anonymous`), com `role: anonymous`
-- e um `sub` próprio. `vitrine_publica` tratava qualquer identidade presente como "logado" e, com esse token, devolveria os
-- contatos públicos ao visitante, contrariando o D10-20 (comportamento restritivo: contatos só depois do login).
-- Correção: "logado" exige o papel `authenticated` da requisição, além da identidade. Nada mais muda.

BEGIN;

CREATE OR REPLACE FUNCTION public.vitrine_publica(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- O GUC `role` guarda o papel que a Data API definiu (SET ROLE), mesmo dentro de função SECURITY DEFINER.
  -- Token anônimo do Neon Auth: papel anonymous (com `sub`), portanto não é "logado". Papel authenticated sem
  -- identidade: authz.usuario_atual() falha fechado (AUTH_REQUIRED).
  RETURN app_private.vitrine_do_conjunto('publico', p_empresa_id,
    current_setting('role', true) = 'authenticated' AND (SELECT authz.usuario_atual()) IS NOT NULL);
END $$;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611130003', 'M10 (correção): vitrine_publica só considera logado quem usa o papel authenticated; o token anônimo do Neon Auth (com sub) não recebe contatos');

COMMIT;
