-- 202611250003_vitrine_imagens: E03 (evolução integrada).
-- 1) Imagens dos produtos exibidos na vitrine pública (empresa publicada, produto ativo e marcado para a vitrine).
-- 2) Correção de privilégios das funções criadas em 202611250001 e 202611250002: no PostgreSQL, o
--    ALTER DEFAULT PRIVILEGES por schema não retira o EXECUTE global de PUBLIC, por isso toda função pública precisa do
--    REVOKE explícito (como nas migrations anteriores). Sem ele, o papel anônimo podia chamar funções de usuário logado
--    (elas recusavam por exigir usuário, mas a superfície ficava aberta). Agora: anônimo só nas leituras da vitrine.
-- 3) Troca de logo de empresa publicada conta como alteração relevante: sem isso, "enviar para análise" recusava o envio
--    ("não há alteração relevante") e a logo nova nunca chegava à vitrine.
-- 4) A CK vê a logo enviada na solicitação (antes decidia sem vê-la) e a logo em análise não pode ser removida pela empresa.
BEGIN;

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
  -- Equipe da CK: vê a logo enviada numa solicitação de publicação (para decidir) e a logo publicada.
  IF a.finalidade = 'logo_empresa' AND EXISTS (SELECT 1 FROM app_private.administradores_ck ck WHERE ck.auth_user_id = p_usuario AND ck.ativo)
     AND EXISTS (SELECT 1 FROM public.solicitacoes_publicacao s WHERE s.logo_arquivo_id = a.id) THEN RETURN true; END IF;
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
  IF EXISTS (SELECT 1 FROM public.solicitacoes_publicacao s WHERE s.logo_arquivo_id = a.id AND s.estado = 'aberta') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta logo está em análise pela CK. Aguarde a decisão para removê-la.');
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
  SELECT coalesce(array_agg(c ORDER BY c), ARRAY[]::text[]) FROM (
    SELECT c FROM unnest(app_private.campos_relevantes()) AS c
     WHERE e.dados_publicados IS NOT NULL
       AND (app_private.dados_publicos(e) -> c) IS DISTINCT FROM (e.dados_publicados -> c)
    UNION ALL
    SELECT 'logo' WHERE e.dados_publicados IS NOT NULL
       AND e.logo_arquivo_id IS DISTINCT FROM (SELECT pc.logo_arquivo_id FROM public.public_empresa_cards pc WHERE pc.empresa_id = e.id)
  ) x
$$;

CREATE FUNCTION public.imagens_publicas_de_produtos(p_empresa_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(jsonb_object_agg(p.id, '/api/arquivos/' || p.imagem_arquivo_id), '{}'::jsonb)
    FROM public.produtos p JOIN public.empresas e ON e.id = p.empresa_id
    JOIN public.arquivos a ON a.id = p.imagem_arquivo_id AND a.estado = 'ativo'
   WHERE p.empresa_id = p_empresa_id AND p.ativo AND p.exibir_na_vitrine AND e.situacao_vitrine = 'publicada'
$$;

REVOKE ALL ON FUNCTION
  public.arquivo_remover(uuid, text),
  public.definir_logo_empresa(uuid, uuid, text),
  public.logos_das_minhas_empresas(),
  public.logos_publicos(uuid[]),
  public.definir_imagem_produto(uuid, uuid, text),
  public.imagens_de_produtos(uuid),
  public.arquivos_do_registro(text, uuid),
  public.meus_favoritos(uuid),
  public.alternar_favorito(text, text, uuid, text),
  public.imagens_publicas_de_produtos(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.arquivo_remover(uuid, text),
  public.definir_logo_empresa(uuid, uuid, text),
  public.logos_das_minhas_empresas(),
  public.definir_imagem_produto(uuid, uuid, text),
  public.imagens_de_produtos(uuid),
  public.arquivos_do_registro(text, uuid),
  public.meus_favoritos(uuid),
  public.alternar_favorito(text, text, uuid, text)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.logos_publicos(uuid[]), public.imagens_publicas_de_produtos(uuid) TO anonymous, authenticated;

REVOKE ALL ON FUNCTION app_private.solicitacao_copiar_logo(), app_private.solicitacao_logo_congelada(), app_private.cartao_logo_aprovada(),
  app_private.permissao_arquivo(text), app_private.arquivo_json(public.arquivos), app_private.logo_da_empresa(uuid) FROM PUBLIC;

-- A fila da CK (e o histórico da própria empresa, pela política de leitura existente) lê qual logo foi enviada.
GRANT SELECT (logo_arquivo_id) ON public.solicitacoes_publicacao TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611250003', 'E03: imagens_publicas_de_produtos (imagens dos produtos da vitrine publicada), troca de logo como alteração relevante, logo visível para a CK na análise e protegida enquanto em análise, e privilégios explícitos das funções de arquivos, logos e favoritos (anônimo só nas leituras da vitrine)');

COMMIT;
