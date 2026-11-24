-- 202611250002_favoritos: E05 (evolução integrada). Favoritos e atalhos da pessoa, guardados no servidor.
-- Favoritar NÃO concede nem preserva acesso: a lista volta filtrada pela associação atual com a empresa e as telas
-- conferem a permissão de novo. Itens de empresa em que a pessoa não é mais membro simplesmente não aparecem.
BEGIN;

CREATE TABLE public.favoritos (
  auth_user_id text NOT NULL,
  tipo         text NOT NULL CHECK (tipo IN ('empresa', 'modulo', 'acao', 'relatorio')),
  empresa_id   uuid REFERENCES public.empresas (id),
  chave        text NOT NULL CHECK (chave ~ '^[a-z0-9_.:-]{1,80}$'),
  rotulo       text CHECK (char_length(rotulo) <= 80),
  ordem        integer NOT NULL DEFAULT 0,
  criado_em    timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((tipo = 'empresa') = (empresa_id IS NOT NULL AND chave = empresa_id::text) OR tipo <> 'empresa')
);
CREATE UNIQUE INDEX favoritos_unicos ON public.favoritos (auth_user_id, tipo, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), chave);
ALTER TABLE public.favoritos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.favoritos FROM PUBLIC, anonymous, authenticated;

-- Favoritos da pessoa: os globais (empresas) e os da empresa informada. Só empresas em que ela é membro ativa.
CREATE FUNCTION public.meus_favoritos(p_empresa_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('tipo', f.tipo, 'empresa_id', f.empresa_id, 'chave', f.chave, 'rotulo', f.rotulo)
           ORDER BY f.tipo, f.ordem, f.criado_em), '[]'::jsonb)
    FROM public.favoritos f
   WHERE f.auth_user_id = app_private.exigir_usuario()
     AND (f.empresa_id IS NULL OR app_private.eh_membro(f.empresa_id, f.auth_user_id))
     AND (f.tipo = 'empresa' OR f.empresa_id IS NOT DISTINCT FROM p_empresa_id)
$$;

-- Liga ou desliga um favorito. Para itens de empresa, a pessoa precisa ser membro ativa no momento.
CREATE FUNCTION public.alternar_favorito(p_tipo text, p_chave text, p_empresa_id uuid DEFAULT NULL, p_rotulo text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_empresa uuid := CASE WHEN p_tipo = 'empresa' THEN NULLIF(p_chave, '')::uuid ELSE p_empresa_id END;
  removido integer;
BEGIN
  IF p_tipo NOT IN ('empresa', 'modulo', 'acao', 'relatorio') OR p_chave IS NULL OR p_chave !~ '^[a-z0-9_.:-]{1,80}$' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Favorito inválido.');
  END IF;
  IF v_empresa IS NULL OR NOT app_private.eh_membro(v_empresa, usuario) THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  DELETE FROM public.favoritos
   WHERE auth_user_id = usuario AND tipo = p_tipo AND chave = p_chave AND empresa_id IS NOT DISTINCT FROM v_empresa;
  GET DIAGNOSTICS removido = ROW_COUNT;
  IF removido = 0 THEN
    IF (SELECT count(*) FROM public.favoritos WHERE auth_user_id = usuario) >= 100 THEN
      PERFORM app_private.erro('LIMIT_REACHED', 'Você já tem 100 favoritos. Remova algum para adicionar outro.');
    END IF;
    INSERT INTO public.favoritos (auth_user_id, tipo, empresa_id, chave, rotulo)
    VALUES (usuario, p_tipo, v_empresa, p_chave, left(nullif(btrim(p_rotulo), ''), 80));
  END IF;
  RETURN jsonb_build_object('tipo', p_tipo, 'chave', p_chave, 'empresa_id', v_empresa, 'favorito', removido = 0);
END $$;

COMMIT;
