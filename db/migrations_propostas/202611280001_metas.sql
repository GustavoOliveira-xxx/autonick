-- 202611280001_metas: E06 (evolução integrada). Metas mensais com o realizado calculado dos dados reais.
-- Tipos: receita de vendas confirmadas no mês, quantidade de vendas confirmadas e ordens de serviço concluídas.
-- O realizado nunca é digitado: vem das vendas e OS, no fuso de São Paulo. "Atingida" só quando o realizado alcança o alvo.
-- Definir meta: proprietário ou quem pode alterar os dados da empresa. Ver: quem vê a área da meta (vendas ou OS).
BEGIN;

CREATE TABLE public.metas_empresa (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas (id),
  tipo          text NOT NULL CHECK (tipo IN ('receita_vendas', 'vendas_qtd', 'os_concluidas')),
  mes           date NOT NULL CHECK (extract(day FROM mes) = 1),
  alvo          bigint NOT NULL CHECK (alvo > 0 AND alvo <= 100000000000),
  versao        integer NOT NULL DEFAULT 1,
  definida_por  text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, tipo, mes)
);
ALTER TABLE public.metas_empresa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.metas_empresa FROM PUBLIC, anonymous, authenticated;

CREATE FUNCTION app_private.permissao_da_meta(p_tipo text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT CASE WHEN p_tipo = 'os_concluidas' THEN 'servicos.visualizar' ELSE 'vendas.visualizar' END $$;

CREATE FUNCTION app_private.realizado_da_meta(p_empresa uuid, p_tipo text, p_mes date) RETURNS bigint
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE p_tipo
    WHEN 'receita_vendas' THEN (SELECT coalesce(sum(app_private.para_centavos(v.total)), 0) FROM public.vendas v
      WHERE v.empresa_id = p_empresa AND v.estado = 'confirmada'
        AND (v.confirmada_em AT TIME ZONE 'America/Sao_Paulo') >= p_mes AND (v.confirmada_em AT TIME ZONE 'America/Sao_Paulo') < (p_mes + interval '1 month'))
    WHEN 'vendas_qtd' THEN (SELECT count(*) FROM public.vendas v
      WHERE v.empresa_id = p_empresa AND v.estado = 'confirmada'
        AND (v.confirmada_em AT TIME ZONE 'America/Sao_Paulo') >= p_mes AND (v.confirmada_em AT TIME ZONE 'America/Sao_Paulo') < (p_mes + interval '1 month'))
    WHEN 'os_concluidas' THEN (SELECT count(*) FROM public.ordens_servico o
      WHERE o.empresa_id = p_empresa AND o.concluida_em IS NOT NULL
        AND (o.concluida_em AT TIME ZONE 'America/Sao_Paulo') >= p_mes AND (o.concluida_em AT TIME ZONE 'America/Sao_Paulo') < (p_mes + interval '1 month'))
  END
$$;

CREATE FUNCTION public.metas_da_empresa(p_empresa_id uuid, p_mes date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_mes date := date_trunc('month', coalesce(p_mes, app_private.hoje_sp()))::date;
  perms text[];
  pode_definir boolean;
BEGIN
  IF NOT app_private.eh_membro(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  perms := app_private.permissoes_de(p_empresa_id, usuario);
  pode_definir := app_private.eh_proprietario_de(p_empresa_id, usuario) OR 'empresa.alterar' = ANY (perms);
  RETURN jsonb_build_object('mes', v_mes, 'pode_definir', pode_definir,
    'tipos_visiveis', (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM unnest(ARRAY['receita_vendas', 'vendas_qtd', 'os_concluidas']) t
                        WHERE app_private.permissao_da_meta(t) = ANY (perms)),
    'metas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'tipo', m.tipo, 'alvo', m.alvo, 'versao', m.versao,
        'realizado', r.realizado, 'atingida', r.realizado >= m.alvo,
        'percentual', least(999, floor(r.realizado * 100.0 / m.alvo))::integer,
        'definida_por', app_private.nome_da_pessoa(m.definida_por)) ORDER BY m.tipo)
      FROM public.metas_empresa m CROSS JOIN LATERAL (SELECT app_private.realizado_da_meta(m.empresa_id, m.tipo, m.mes) AS realizado) r
      WHERE m.empresa_id = p_empresa_id AND m.mes = v_mes AND app_private.permissao_da_meta(m.tipo) = ANY (perms)), '[]'::jsonb));
END $$;

-- Define (ou troca) o alvo; alvo NULL remove a meta do mês. Só meses atuais ou futuros.
CREATE FUNCTION public.definir_meta(p_empresa_id uuid, p_tipo text, p_mes date, p_alvo bigint, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_tipo, p_mes, p_alvo));
  anterior jsonb;
  v_mes date := date_trunc('month', p_mes)::date;
  m public.metas_empresa;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_meta', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  IF NOT app_private.eh_membro(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  IF NOT (app_private.eh_proprietario_de(p_empresa_id, usuario) OR 'empresa.alterar' = ANY (app_private.permissoes_de(p_empresa_id, usuario))) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só o proprietário ou quem altera os dados da empresa define metas.');
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('receita_vendas', 'vendas_qtd', 'os_concluidas') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Tipo de meta desconhecido.', 'tipo');
  END IF;
  IF v_mes IS NULL OR v_mes < date_trunc('month', app_private.hoje_sp())::date OR v_mes > (date_trunc('month', app_private.hoje_sp()) + interval '12 months')::date THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Defina metas do mês atual até 12 meses à frente.', 'mes');
  END IF;
  IF p_alvo IS NOT NULL AND (p_alvo <= 0 OR p_alvo > 100000000000) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um alvo maior que zero.', 'alvo');
  END IF;
  IF p_alvo IS NULL THEN
    DELETE FROM public.metas_empresa WHERE empresa_id = p_empresa_id AND tipo = p_tipo AND mes = v_mes RETURNING * INTO m;
  ELSE
    INSERT INTO public.metas_empresa AS e (empresa_id, tipo, mes, alvo, definida_por) VALUES (p_empresa_id, p_tipo, v_mes, p_alvo, usuario)
    ON CONFLICT (empresa_id, tipo, mes) DO UPDATE SET alvo = EXCLUDED.alvo, definida_por = EXCLUDED.definida_por, versao = e.versao + 1, atualizado_em = now()
    RETURNING * INTO m;
  END IF;
  PERFORM app_private.auditar(p_empresa_id, usuario, CASE WHEN p_alvo IS NULL THEN 'empresa.meta_removida' ELSE 'empresa.meta_definida' END,
    'metas_empresa', m.id, jsonb_build_object('tipo', p_tipo, 'mes', v_mes, 'alvo', p_alvo));
  RETURN app_private.idem_fim(usuario, 'definir_meta', p_operation_key, assinatura,
    jsonb_build_object('tipo', p_tipo, 'mes', v_mes, 'alvo', p_alvo, 'removida', p_alvo IS NULL));
END $$;

REVOKE ALL ON FUNCTION app_private.permissao_da_meta(text), app_private.realizado_da_meta(uuid, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.metas_da_empresa(uuid, date), public.definir_meta(uuid, text, date, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.metas_da_empresa(uuid, date), public.definir_meta(uuid, text, date, bigint, text) TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611280001', 'E06: metas mensais (receita e quantidade de vendas, OS concluídas) com realizado calculado dos dados reais');

COMMIT;
