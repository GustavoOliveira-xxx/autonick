-- Desfaz 202611250003: remove a função nova e devolve os privilégios ao estado deixado por 202611250001 e 202611250002
-- (EXECUTE para PUBLIC). Rollback fiel: quem desfizer volta à superfície anterior, mais aberta.
BEGIN;
DROP FUNCTION IF EXISTS public.imagens_publicas_de_produtos(uuid);
CREATE OR REPLACE FUNCTION app_private.pode_ler_arquivo(a public.arquivos, p_usuario text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  perms text[];
BEGIN
  IF a.estado <> 'ativo' THEN RETURN false; END IF;
  -- Público: logo aprovada no cartão de empresa publicada; imagem de produto exibido na vitrine de empresa publicada.
  IF EXISTS (SELECT 1 FROM public.public_empresa_cards c JOIN public.empresas e ON e.id = c.empresa_id
              WHERE c.logo_arquivo_id = a.id AND e.situacao_vitrine = 'publicada') THEN RETURN true; END IF;
  IF a.finalidade = 'imagem_produto' AND EXISTS (
       SELECT 1 FROM public.produtos p JOIN public.empresas e ON e.id = p.empresa_id
        WHERE p.imagem_arquivo_id = a.id AND p.ativo AND p.exibir_na_vitrine AND e.situacao_vitrine = 'publicada') THEN RETURN true; END IF;
  IF p_usuario IS NULL THEN RETURN false; END IF;
  -- Cliente titular da solicitação vê os anexos dela (os que ele mandou e os que a empresa anexou para ele).
  IF a.referencia_tipo = 'solicitacao' AND EXISTS (
       SELECT 1 FROM public.solicitacoes_servico s WHERE s.id = a.referencia_id AND s.cliente_auth_id = p_usuario) THEN RETURN true; END IF;
  IF a.empresa_id IS NULL THEN RETURN a.dono_auth_id = p_usuario; END IF;
  IF NOT app_private.eh_membro(a.empresa_id, p_usuario) THEN RETURN false; END IF;
  perms := app_private.permissoes_de(a.empresa_id, p_usuario);
  RETURN CASE a.finalidade
    WHEN 'logo_empresa' THEN true
    WHEN 'imagem_produto' THEN perms && ARRAY['produtos.visualizar', 'estoque.visualizar', 'vendas.visualizar', 'pedidos.visualizar']
    WHEN 'evidencia_os' THEN 'servicos.visualizar' = ANY (perms)
    WHEN 'anexo_solicitacao' THEN perms && ARRAY['orcamentos.visualizar', 'servicos.visualizar']
    WHEN 'documento' THEN 'empresa.visualizar' = ANY (perms) OR app_private.eh_proprietario_de(a.empresa_id, p_usuario)
    ELSE false END;
END $$;
CREATE OR REPLACE FUNCTION public.arquivo_remover(p_arquivo_id uuid, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  anterior jsonb;
  a public.arquivos;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'arquivo_remover', p_operation_key, p_arquivo_id::text);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO a FROM public.arquivos WHERE id = p_arquivo_id AND estado = 'ativo' FOR UPDATE;
  IF NOT FOUND OR a.empresa_id IS NULL OR NOT app_private.eh_membro(a.empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Arquivo não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(a.empresa_id, usuario, app_private.permissao_arquivo(a.finalidade));
  -- A logo aprovada na vitrine continua valendo até uma nova aprovação: ela não pode ser removida enquanto estiver publicada.
  IF EXISTS (SELECT 1 FROM public.public_empresa_cards c WHERE c.logo_arquivo_id = a.id) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta logo está publicada na vitrine. Envie outra e aguarde a aprovação para trocar.');
  END IF;
  UPDATE public.empresas SET logo_arquivo_id = NULL, atualizado_em = now() WHERE id = a.empresa_id AND logo_arquivo_id = a.id;
  UPDATE public.produtos SET imagem_arquivo_id = NULL WHERE imagem_arquivo_id = a.id;
  UPDATE public.arquivos SET estado = 'removido', removido_em = clock_timestamp(), removido_por = usuario WHERE id = a.id RETURNING * INTO a;
  PERFORM app_private.auditar(a.empresa_id, usuario, 'arquivo.removido', 'arquivos', a.id, jsonb_build_object('finalidade', a.finalidade));
  RETURN app_private.idem_fim(usuario, 'arquivo_remover', p_operation_key, p_arquivo_id::text, jsonb_build_object('id', a.id, 'estado', a.estado));
END $$;
CREATE OR REPLACE FUNCTION app_private.relevantes_pendentes(e public.empresas) RETURNS text[]
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(array_agg(c ORDER BY c), ARRAY[]::text[])
    FROM unnest(app_private.campos_relevantes()) AS c
   WHERE e.dados_publicados IS NOT NULL
     AND (app_private.dados_publicos(e) -> c) IS DISTINCT FROM (e.dados_publicados -> c)
$$;
REVOKE ALL ON FUNCTION
  public.arquivo_remover(uuid, text), public.definir_logo_empresa(uuid, uuid, text), public.logos_das_minhas_empresas(),
  public.definir_imagem_produto(uuid, uuid, text), public.imagens_de_produtos(uuid), public.arquivos_do_registro(text, uuid),
  public.meus_favoritos(uuid), public.alternar_favorito(text, text, uuid, text)
FROM authenticated;
REVOKE ALL ON FUNCTION public.logos_publicos(uuid[]) FROM anonymous, authenticated;
GRANT EXECUTE ON FUNCTION
  public.arquivo_remover(uuid, text), public.definir_logo_empresa(uuid, uuid, text), public.logos_das_minhas_empresas(),
  public.logos_publicos(uuid[]), public.definir_imagem_produto(uuid, uuid, text), public.imagens_de_produtos(uuid),
  public.arquivos_do_registro(text, uuid), public.meus_favoritos(uuid), public.alternar_favorito(text, text, uuid, text)
TO PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.solicitacao_copiar_logo(), app_private.solicitacao_logo_congelada(), app_private.cartao_logo_aprovada(),
  app_private.permissao_arquivo(text), app_private.arquivo_json(public.arquivos), app_private.logo_da_empresa(uuid) TO PUBLIC;
REVOKE SELECT (logo_arquivo_id) ON public.solicitacoes_publicacao FROM authenticated;
DELETE FROM app_private.historico_migracoes WHERE id = '202611250003';
COMMIT;
