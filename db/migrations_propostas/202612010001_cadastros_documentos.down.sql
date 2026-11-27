-- Reversão de 202612010001_cadastros_documentos. Restaura as funções anteriores e remove colunas e funções novas.
-- Atenção: documentos alfanuméricos, endereços, tipo de pessoa, observações de compra e forma/prazo de parcelas gravados
-- depois da migration são descartados; documentos alfanuméricos de empresas e fornecedores são limpos para caber na
-- restrição antiga (só dígitos).
BEGIN;
DROP FUNCTION IF EXISTS public.buscar_clientes(uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.documento_em_uso(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.fornecedores_da_empresa(uuid, text, text);
CREATE OR REPLACE FUNCTION app_private.aplicar_campos(e public.empresas, d jsonb) RETURNS public.empresas
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  chave text;
  permitidas text[] := app_private.campos_relevantes() || app_private.campos_menor_risco() || app_private.campos_privados();
  valor text;
BEGIN
  IF d IS NULL OR jsonb_typeof(d) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Dados da empresa ausentes.');
  END IF;
  FOR chave IN SELECT jsonb_object_keys(d) LOOP
    IF NOT chave = ANY (permitidas) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Campo não permitido: ' || chave, chave);
    END IF;
    valor := nullif(btrim(d ->> chave), '');
    CASE chave
      WHEN 'nome_publico' THEN e.nome_publico := valor;
      WHEN 'categoria_id' THEN
        BEGIN
          e.categoria_id := valor::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
          PERFORM app_private.erro('VALIDATION_ERROR', 'Categoria inválida.', 'categoria_id');
        END;
      WHEN 'modalidade' THEN e.modalidade := valor;
      WHEN 'cidade' THEN e.cidade := valor;
      WHEN 'uf' THEN e.uf := upper(valor);
      WHEN 'bairro' THEN e.bairro := valor;
      WHEN 'area_atendimento' THEN e.area_atendimento := valor;
      WHEN 'telefone_publico' THEN e.telefone_publico := nullif(regexp_replace(coalesce(valor, ''), '\D', '', 'g'), '');
      WHEN 'whatsapp_publico' THEN e.whatsapp_publico := nullif(regexp_replace(coalesce(valor, ''), '\D', '', 'g'), '');
      WHEN 'email_publico' THEN e.email_publico := lower(valor);
      WHEN 'descricao_publica' THEN e.descricao_publica := valor;
      WHEN 'horario_funcionamento' THEN e.horario_funcionamento := valor;
      WHEN 'documento' THEN e.documento := nullif(regexp_replace(coalesce(valor, ''), '\D', '', 'g'), '');
      WHEN 'email_contato' THEN e.email_contato := lower(valor);
      WHEN 'endereco_privado' THEN e.endereco_privado := valor;
      WHEN 'observacoes_internas' THEN e.observacoes_internas := valor;
    END CASE;
  END LOOP;

  IF e.nome_publico IS NULL OR char_length(e.nome_publico) NOT BETWEEN 2 AND 120 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o nome do negócio (2 a 120 caracteres).', 'nome_publico');
  END IF;
  IF e.modalidade IS NULL OR e.modalidade NOT IN ('comercio', 'servicos', 'ambos') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha a modalidade: comércio, serviços ou ambos.', 'modalidade');
  END IF;
  IF e.categoria_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.categorias_plataforma
                                            WHERE id = e.categoria_id AND tipo = 'negocio' AND ativo) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha uma categoria da lista.', 'categoria_id');
  END IF;
  IF e.cidade IS NULL OR char_length(e.cidade) NOT BETWEEN 2 AND 80 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe a cidade.', 'cidade');
  END IF;
  IF e.uf IS DISTINCT FROM 'SP' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Nesta fase, o AutoniCK atende apenas o estado de São Paulo (SP).', 'uf');
  END IF;
  IF char_length(e.bairro) > 80 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O bairro pode ter até 80 caracteres.', 'bairro');
  END IF;
  IF char_length(e.area_atendimento) > 200 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A área de atendimento pode ter até 200 caracteres.', 'area_atendimento');
  END IF;
  IF e.telefone_publico IS NOT NULL AND e.telefone_publico !~ '^\d{10,13}$' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Telefone público inválido. Use DDD e número.', 'telefone_publico');
  END IF;
  IF e.whatsapp_publico IS NOT NULL AND e.whatsapp_publico !~ '^\d{10,13}$' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'WhatsApp público inválido. Use DDD e número.', 'whatsapp_publico');
  END IF;
  IF e.email_publico IS NOT NULL AND (e.email_publico !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR char_length(e.email_publico) > 254) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'E-mail público inválido.', 'email_publico');
  END IF;
  IF char_length(e.descricao_publica) > 1000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A descrição pode ter até 1000 caracteres.', 'descricao_publica');
  END IF;
  IF app_private.tem_contato(e.descricao_publica) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A descrição não pode ter telefone, e-mail ou link. Use os campos de contato público, que passam por análise.', 'descricao_publica');
  END IF;
  IF char_length(e.horario_funcionamento) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O horário pode ter até 300 caracteres.', 'horario_funcionamento');
  END IF;
  IF app_private.tem_contato(e.horario_funcionamento) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O horário não pode ter telefone, e-mail ou link.', 'horario_funcionamento');
  END IF;
  IF e.documento IS NOT NULL AND e.documento !~ '^(\d{11}|\d{14})$' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Documento inválido: use CPF (11 dígitos) ou CNPJ (14 dígitos).', 'documento');
  END IF;
  IF e.email_contato IS NULL OR e.email_contato !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR char_length(e.email_contato) > 254 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um e-mail de contato válido.', 'email_contato');
  END IF;
  IF char_length(e.endereco_privado) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O endereço pode ter até 300 caracteres.', 'endereco_privado');
  END IF;
  IF char_length(e.observacoes_internas) > 1000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'As observações podem ter até 1000 caracteres.', 'observacoes_internas');
  END IF;
  RETURN e;
END $$;


CREATE OR REPLACE FUNCTION app_private.validar_cliente(p_atual public.clientes_empresa, p_dados jsonb) RETURNS public.clientes_empresa
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  c public.clientes_empresa := p_atual;
  k text;
BEGIN
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Dados do cliente inválidos.');
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_dados) LOOP
    IF k NOT IN ('nome', 'telefone', 'email', 'observacoes') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Campo não permitido: ' || k, k);   -- CPF não é coletado (D6-10)
    END IF;
  END LOOP;
  IF p_dados ? 'nome' THEN c.nome := btrim(coalesce(p_dados->>'nome', '')); END IF;
  IF p_dados ? 'telefone' THEN c.telefone := nullif(regexp_replace(coalesce(p_dados->>'telefone', ''), '\D', '', 'g'), ''); END IF;
  IF p_dados ? 'email' THEN c.email := nullif(lower(btrim(coalesce(p_dados->>'email', ''))), ''); END IF;
  IF p_dados ? 'observacoes' THEN c.observacoes := nullif(btrim(coalesce(p_dados->>'observacoes', '')), ''); END IF;
  IF c.nome IS NULL OR char_length(c.nome) NOT BETWEEN 2 AND 120 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o nome do cliente (2 a 120 caracteres).', 'nome');
  END IF;
  IF c.telefone IS NOT NULL AND c.telefone !~ '^\d{10,13}$' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o telefone com DDD.', 'telefone');
  END IF;
  IF c.email IS NOT NULL AND (char_length(c.email) > 254 OR c.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um e-mail válido.', 'email');
  END IF;
  IF char_length(c.observacoes) > 500 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'As observações podem ter até 500 caracteres.', 'observacoes');
  END IF;
  RETURN c;
END $$;


CREATE OR REPLACE FUNCTION public.criar_cliente(p_empresa_id uuid, p_dados jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text));
  anterior jsonb;
  base public.clientes_empresa;
  c public.clientes_empresa;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_cliente', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['clientes.criar']);
  c := app_private.validar_cliente(base, p_dados);
  INSERT INTO public.clientes_empresa (empresa_id, nome, telefone, email, observacoes, criado_por)
  VALUES (p_empresa_id, c.nome, c.telefone, c.email, c.observacoes, usuario) RETURNING * INTO c;
  PERFORM app_private.evento_comercial(p_empresa_id, 'cliente_criado', usuario, 'cliente', c.id, '{}'::jsonb, p_operation_key);
  RETURN app_private.idem_fim(usuario, 'criar_cliente', p_operation_key, assinatura,
    jsonb_build_object('id', c.id, 'nome', c.nome, 'versao', c.versao));
END $$;


CREATE OR REPLACE FUNCTION public.alterar_cliente(p_cliente_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_cliente_id, p_dados::text, p_expected_version));
  anterior jsonb;
  atual public.clientes_empresa;
  c public.clientes_empresa;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_cliente', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO atual FROM public.clientes_empresa WHERE id = p_cliente_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Cliente não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(atual.empresa_id, usuario, ARRAY['clientes.alterar']);
  IF atual.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este cliente foi alterado por outra pessoa. Atualize antes de continuar.');
  END IF;
  c := app_private.validar_cliente(atual, p_dados);
  UPDATE public.clientes_empresa SET nome = c.nome, telefone = c.telefone, email = c.email, observacoes = c.observacoes,
    versao = versao + 1, atualizado_em = now() WHERE id = atual.id RETURNING * INTO c;
  PERFORM app_private.evento_comercial(atual.empresa_id, 'cliente_alterado', usuario, 'cliente', c.id,
    jsonb_build_object('campos', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_dados) k)), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'alterar_cliente', p_operation_key, assinatura,
    jsonb_build_object('id', c.id, 'versao', c.versao));
END $$;


CREATE OR REPLACE FUNCTION public.clientes_da_empresa(p_empresa_id uuid, p_busca text DEFAULT NULL, p_limite integer DEFAULT 50,
  p_deslocamento integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_busca text := nullif(lower(btrim(coalesce(p_busca, ''))), '');
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['clientes.visualizar']);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'email', c.email,
      'observacoes', c.observacoes, 'ativo', c.ativo, 'versao', c.versao, 'conta_vinculada', c.perfil_cliente_id IS NOT NULL,
      'vendas', (SELECT count(*) FROM public.vendas v WHERE v.cliente_empresa_id = c.id AND v.estado = 'confirmada'))
      ORDER BY c.ativo DESC, lower(c.nome))
    FROM (SELECT * FROM public.clientes_empresa c
           WHERE c.empresa_id = p_empresa_id
             AND (v_busca IS NULL OR lower(c.nome) LIKE '%' || v_busca || '%' OR c.telefone LIKE '%' || regexp_replace(v_busca, '\D', '', 'g') || '%')
           ORDER BY c.ativo DESC, lower(c.nome)
           LIMIT least(greatest(coalesce(p_limite, 50), 1), 100) OFFSET greatest(coalesce(p_deslocamento, 0), 0)) c), '[]'::jsonb);
END $$;


CREATE OR REPLACE FUNCTION app_private.validar_fornecedor(p_atual public.fornecedores, p_dados jsonb) RETURNS public.fornecedores
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  f public.fornecedores := p_atual;
  k text;
BEGIN
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Dados do fornecedor inválidos.');
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_dados) LOOP
    IF k NOT IN ('nome', 'documento', 'telefone', 'email', 'observacoes', 'ativo') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Campo não permitido: ' || k, k);
    END IF;
  END LOOP;
  IF p_dados ? 'nome' THEN f.nome := btrim(p_dados->>'nome'); END IF;
  IF p_dados ? 'documento' THEN f.documento := nullif(regexp_replace(coalesce(p_dados->>'documento', ''), '\D', '', 'g'), ''); END IF;
  IF p_dados ? 'telefone' THEN f.telefone := nullif(regexp_replace(coalesce(p_dados->>'telefone', ''), '\D', '', 'g'), ''); END IF;
  IF p_dados ? 'email' THEN f.email := nullif(lower(btrim(coalesce(p_dados->>'email', ''))), ''); END IF;
  IF p_dados ? 'observacoes' THEN f.observacoes := nullif(btrim(coalesce(p_dados->>'observacoes', '')), ''); END IF;
  IF p_dados ? 'ativo' THEN f.ativo := (p_dados->>'ativo')::boolean; END IF;
  IF f.nome IS NULL OR char_length(f.nome) NOT BETWEEN 2 AND 120 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o nome do fornecedor (2 a 120 caracteres).', 'nome');
  END IF;
  IF f.documento IS NOT NULL AND f.documento !~ '^(\d{11}|\d{14})$' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'CPF tem 11 dígitos e CNPJ tem 14.', 'documento');
  END IF;
  IF f.telefone IS NOT NULL AND f.telefone !~ '^\d{10,13}$' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o telefone com DDD.', 'telefone');
  END IF;
  IF f.email IS NOT NULL AND (char_length(f.email) > 254 OR f.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um e-mail válido.', 'email');
  END IF;
  IF char_length(f.observacoes) > 500 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'As observações podem ter até 500 caracteres.', 'observacoes');
  END IF;
  RETURN f;
END $$;

CREATE OR REPLACE FUNCTION public.criar_fornecedor(p_empresa_id uuid, p_dados jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text));
  anterior jsonb;
  base public.fornecedores;
  f public.fornecedores;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_fornecedor', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['fornecedores.alterar']);
  base.ativo := true;
  f := app_private.validar_fornecedor(base, p_dados - 'ativo');
  INSERT INTO public.fornecedores (empresa_id, nome, documento, telefone, email, observacoes, criado_por)
  VALUES (p_empresa_id, f.nome, f.documento, f.telefone, f.email, f.observacoes, usuario) RETURNING * INTO f;
  PERFORM app_private.registrar_evento_estoque(p_empresa_id, 'fornecedor_criado', usuario, 'fornecedor', f.id,
    jsonb_build_object('nome', f.nome), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'criar_fornecedor', p_operation_key, assinatura,
    jsonb_build_object('id', f.id, 'nome', f.nome, 'versao', f.versao));
END $$;


CREATE OR REPLACE FUNCTION public.alterar_fornecedor(p_fornecedor_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_fornecedor_id, p_dados::text, p_expected_version));
  anterior jsonb;
  atual public.fornecedores;
  f public.fornecedores;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_fornecedor', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO atual FROM public.fornecedores WHERE id = p_fornecedor_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Fornecedor não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(atual.empresa_id, usuario, ARRAY['fornecedores.alterar']);
  IF atual.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este fornecedor foi alterado por outra pessoa. Atualize antes de continuar.');
  END IF;
  f := app_private.validar_fornecedor(atual, p_dados);
  UPDATE public.fornecedores SET nome = f.nome, documento = f.documento, telefone = f.telefone, email = f.email,
    observacoes = f.observacoes, ativo = f.ativo, versao = versao + 1, atualizado_em = now()
  WHERE id = atual.id RETURNING * INTO f;
  PERFORM app_private.registrar_evento_estoque(atual.empresa_id, 'fornecedor_alterado', usuario, 'fornecedor', f.id,
    jsonb_build_object('campos', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_dados) k)), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'alterar_fornecedor', p_operation_key, assinatura,
    jsonb_build_object('id', f.id, 'versao', f.versao, 'ativo', f.ativo));
END $$;


CREATE OR REPLACE FUNCTION public.criar_compra(p_empresa_id uuid, p_dados jsonb, p_itens jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text, p_itens::text));
  anterior jsonb;
  c public.compras_fornecedor;
  e jsonb;
  var public.produto_variacoes;
  q integer;
  custo numeric;
  fornecedor uuid := nullif(p_dados->>'fornecedor_id', '')::uuid;
  data_compra date;
  documento text := nullif(btrim(coalesce(p_dados->>'numero_documento', '')), '');
  tem_custo boolean;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_compra', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['estoque.propor']);
  tem_custo := app_private.tem(p_empresa_id, usuario, 'produtos.ver_custo');
  IF fornecedor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fornecedores WHERE id = fornecedor AND empresa_id = p_empresa_id AND ativo) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Fornecedor não encontrado nesta empresa.', 'fornecedor_id');
  END IF;
  BEGIN
    data_compra := coalesce(nullif(p_dados->>'data_compra', '')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  EXCEPTION WHEN others THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Data da compra inválida.', 'data_compra');
  END;
  IF data_compra > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A data da compra não pode estar no futuro.', 'data_compra');
  END IF;
  IF char_length(documento) > 60 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O número do documento pode ter até 60 caracteres.', 'numero_documento');
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) NOT BETWEEN 1 AND 200 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Inclua de 1 a 200 itens na compra.', 'itens');
  END IF;
  INSERT INTO public.compras_fornecedor (empresa_id, fornecedor_id, data_compra, numero_documento, autor)
  VALUES (p_empresa_id, fornecedor, data_compra, documento, usuario) RETURNING * INTO c;
  FOR e IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    var := app_private.variacao_da_empresa(p_empresa_id, nullif(e->>'variacao_id', '')::uuid);
    q := app_private.quantidade(e->'quantidade', 'quantidade', false);
    custo := app_private.centavos(e->'custo_centavos', 'custo_centavos', false, 0);
    IF custo IS NOT NULL AND NOT tem_custo THEN
      PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite informar custo.', 'custo_centavos');
    END IF;
    IF EXISTS (SELECT 1 FROM public.compra_itens WHERE compra_id = c.id AND variacao_id = var.id) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'A mesma variação aparece duas vezes. Junte as quantidades.', 'itens');
    END IF;
    INSERT INTO public.compra_itens (compra_id, empresa_id, variacao_id, quantidade, custo_unitario)
    VALUES (c.id, p_empresa_id, var.id, q, custo);
  END LOOP;
  UPDATE public.compras_fornecedor SET custo_total = (
    SELECT CASE WHEN bool_and(custo_unitario IS NOT NULL) THEN sum(quantidade * custo_unitario) END
      FROM public.compra_itens WHERE compra_id = c.id)
  WHERE id = c.id;
  PERFORM app_private.registrar_evento_estoque(p_empresa_id, 'compra_criada', usuario, 'compra', c.id,
    jsonb_build_object('itens', jsonb_array_length(p_itens)), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'criar_compra', p_operation_key, assinatura,
    jsonb_build_object('id', c.id, 'estado', 'rascunho', 'versao', c.versao));
END $$;


CREATE OR REPLACE FUNCTION public.compras_da_empresa(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  ver_custo boolean;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['estoque.visualizar']);
  ver_custo := app_private.tem(p_empresa_id, usuario, 'produtos.ver_custo');
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', c.id, 'estado', c.estado, 'data_compra', c.data_compra,
      'numero_documento', c.numero_documento, 'fornecedor_nome', f.nome, 'versao', c.versao, 'sou_autor', c.autor = usuario,
      'autor_nome', app_private.nome_da_pessoa(c.autor), 'motivo_cancelamento', c.motivo_cancelamento, 'criado_em', c.criado_em,
      'custo_total_centavos', CASE WHEN ver_custo AND c.custo_total IS NOT NULL THEN app_private.para_centavos(c.custo_total) END,
      'itens', (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('variacao_id', i.variacao_id, 'produto_nome', p.nome,
          'rotulo', app_private.rotulo_variacao(v.atributos, v.padrao), 'quantidade', i.quantidade,
          'custo_centavos', CASE WHEN ver_custo AND i.custo_unitario IS NOT NULL THEN app_private.para_centavos(i.custo_unitario) END)) ORDER BY p.nome)
        FROM public.compra_itens i JOIN public.produto_variacoes v ON v.id = i.variacao_id JOIN public.produtos p ON p.id = v.produto_id
        WHERE i.compra_id = c.id)))
      ORDER BY c.criado_em DESC)
      FROM public.compras_fornecedor c LEFT JOIN public.fornecedores f ON f.id = c.fornecedor_id
     WHERE c.empresa_id = p_empresa_id), '[]'::jsonb);
END $$;


CREATE OR REPLACE FUNCTION app_private.criar_titulo_venda(p_venda public.vendas, p_pagamento jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_titulo uuid;
  v_condicao text := coalesce(p_pagamento->>'condicao', 'a_vista');
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  e jsonb;
  v_seq integer := 0;
  v_soma numeric := 0;
  v_valor numeric;
  v_venc date;
  v_anterior date;
BEGIN
  IF v_condicao NOT IN ('a_vista', 'parcelado') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Condição de pagamento inválida.', 'condicao');
  END IF;
  INSERT INTO public.titulos_financeiros (empresa_id, origem_tipo, origem_id, descricao, total)
  VALUES (p_venda.empresa_id, 'venda', p_venda.id, format('Venda nº %s', p_venda.numero), p_venda.total)
  RETURNING id INTO v_titulo;
  IF p_venda.total = 0 THEN
    UPDATE public.titulos_financeiros SET estado = 'liquidado' WHERE id = v_titulo;   -- venda de valor zero: nada a receber
    RETURN v_titulo;
  END IF;
  IF v_condicao = 'a_vista' THEN
    INSERT INTO public.parcelas_financeiras (empresa_id, titulo_id, sequencia, valor, vencimento, saldo)
    VALUES (p_venda.empresa_id, v_titulo, 1, p_venda.total, v_hoje, p_venda.total);
    RETURN v_titulo;
  END IF;
  IF jsonb_typeof(p_pagamento->'parcelas') <> 'array' OR jsonb_array_length(p_pagamento->'parcelas') NOT BETWEEN 2 AND 24 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Parcelado: informe de 2 a 24 parcelas.', 'parcelas');
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_pagamento->'parcelas') LOOP
    v_seq := v_seq + 1;
    v_valor := app_private.centavos(e->'valor_centavos', 'valor_centavos', true, 1);
    BEGIN
      v_venc := (e->>'vencimento')::date;
    EXCEPTION WHEN others THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Vencimento inválido.', 'vencimento');
    END;
    IF v_venc IS NULL OR v_venc < v_hoje OR v_venc > v_hoje + 3650 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Cada vencimento precisa ser de hoje em diante.', 'vencimento');
    END IF;
    IF v_anterior IS NOT NULL AND v_venc < v_anterior THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Os vencimentos precisam estar em ordem.', 'vencimento');
    END IF;
    v_anterior := v_venc;
    v_soma := v_soma + v_valor;
    INSERT INTO public.parcelas_financeiras (empresa_id, titulo_id, sequencia, valor, vencimento, saldo)
    VALUES (p_venda.empresa_id, v_titulo, v_seq, v_valor, v_venc, v_valor);
  END LOOP;
  IF v_soma <> p_venda.total THEN
    PERFORM app_private.erro('VALIDATION_ERROR',
      format('A soma das parcelas (R$ %s) precisa ser igual ao total (R$ %s).', to_char(v_soma, 'FM999G999G990D00'), to_char(p_venda.total, 'FM999G999G990D00')),
      'parcelas');
  END IF;
  RETURN v_titulo;
END $$;


CREATE OR REPLACE FUNCTION public.venda_detalhe(p_venda_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v public.vendas;
  v_custo boolean;
BEGIN
  SELECT * INTO v FROM public.vendas WHERE id = p_venda_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Venda não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(v.empresa_id, usuario, ARRAY['vendas.visualizar']);
  v_custo := app_private.tem(v.empresa_id, usuario, 'produtos.ver_custo');
  RETURN app_private.resumo_venda(v.id) || jsonb_build_object(
    'empresa_id', v.empresa_id, 'origem', v.origem, 'pedido_id', v.pedido_id, 'cliente_empresa_id', v.cliente_empresa_id,
    'cliente', v.cliente_nome, 'condicao', v.condicao, 'observacao', v.observacao, 'autor_nome', app_private.nome_da_pessoa(v.autor),
    'eh_autor', v.autor = usuario, 'confirmada_em', v.confirmada_em,
    'confirmada_por_nome', CASE WHEN v.confirmada_por IS NOT NULL THEN app_private.nome_da_pessoa(v.confirmada_por) END,
    'cancelada_em', v.cancelada_em, 'motivo_cancelamento', v.motivo_cancelamento, 'criado_em', v.criado_em,
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object('variacao_id', i.variacao_id, 'produto', i.nome_snapshot,
        'variacao', i.rotulo_snapshot, 'quantidade', i.quantidade, 'preco_centavos', app_private.para_centavos(i.preco_unitario),
        'desconto_centavos', app_private.para_centavos(i.desconto), 'valor_centavos', app_private.para_centavos(i.valor),
        'sob_encomenda', i.sob_encomenda, 'entrega', i.entrega, 'entregue_em', i.entregue_em,
        'destino_cancelamento', i.destino_cancelamento,
        'reservado', (SELECT r.quantidade FROM public.reservas_estoque r WHERE r.empresa_id = v.empresa_id AND r.origem_tipo = 'venda'
                        AND r.origem_id = v.id AND r.variacao_id = i.variacao_id AND r.estado = 'ativa'),
        'custo_centavos', CASE WHEN v_custo THEN app_private.para_centavos(i.custo_unitario) END)
        ORDER BY i.nome_snapshot, i.rotulo_snapshot) FROM public.venda_itens i WHERE i.venda_id = v.id), '[]'::jsonb),
    'pagamento', app_private.situacao_pagamento(v.id),
    'parcelas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', pa.id, 'sequencia', pa.sequencia,
        'valor_centavos', app_private.para_centavos(pa.valor), 'saldo_centavos', app_private.para_centavos(pa.saldo),
        'vencimento', pa.vencimento, 'estado', pa.estado) ORDER BY pa.sequencia)
        FROM public.parcelas_financeiras pa JOIN public.titulos_financeiros t ON t.id = pa.titulo_id
       WHERE t.origem_tipo = 'venda' AND t.origem_id = v.id), '[]'::jsonb),
    'recebimentos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'tipo', r.tipo, 'valor_centavos', app_private.para_centavos(r.valor),
        'forma', r.forma, 'data', r.data, 'motivo', r.motivo, 'estorno_de', r.estorno_de,
        'estornado', EXISTS (SELECT 1 FROM public.recebimentos x WHERE x.estorno_de = r.id),
        'parcela', (SELECT sequencia FROM public.parcelas_financeiras WHERE id = r.parcela_id),
        'autor_nome', app_private.nome_da_pessoa(r.autor), 'criado_em', r.criado_em) ORDER BY r.criado_em)
        FROM public.recebimentos r JOIN public.titulos_financeiros t ON t.id = r.titulo_id
       WHERE t.origem_tipo = 'venda' AND t.origem_id = v.id), '[]'::jsonb),
    'eventos', coalesce((SELECT jsonb_agg(jsonb_build_object('tipo', e.tipo, 'detalhes', e.detalhes, 'ator_nome', app_private.nome_da_pessoa(e.ator),
        'criado_em', e.criado_em) ORDER BY e.criado_em)
        FROM public.eventos_comerciais e WHERE e.empresa_id = v.empresa_id
         AND ((e.alvo_tipo = 'venda' AND e.alvo_id = v.id)
           OR (e.alvo_tipo = 'titulo' AND e.alvo_id = (SELECT id FROM public.titulos_financeiros WHERE origem_tipo = 'venda' AND origem_id = v.id)))), '[]'::jsonb));
END $$;


CREATE OR REPLACE FUNCTION public.ficha_cliente(p_cliente_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  c public.clientes_empresa;
  perms text[];
  r jsonb;
BEGIN
  SELECT * INTO c FROM public.clientes_empresa WHERE id = p_cliente_id;
  IF NOT FOUND OR NOT app_private.eh_membro(c.empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Cliente não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['clientes.visualizar']);
  perms := app_private.permissoes_de(c.empresa_id, usuario);
  r := jsonb_build_object('cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'email', c.email,
    'observacoes', c.observacoes, 'ativo', c.ativo, 'conta_vinculada', c.perfil_cliente_id IS NOT NULL, 'desde', c.criado_em, 'versao', c.versao));
  IF 'vendas.visualizar' = ANY (perms) THEN
    r := r || jsonb_build_object(
      'resumo', (SELECT jsonb_build_object('vendas', count(*), 'total_centavos', coalesce(sum(app_private.para_centavos(v.total)), 0),
          'ultima_compra', max(v.confirmada_em))
        FROM public.vendas v WHERE v.cliente_empresa_id = c.id AND v.estado = 'confirmada'),
      'vendas', coalesce((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('id', v.id, 'numero', v.numero, 'estado', v.estado,
          'total_centavos', app_private.para_centavos(v.total), 'data', coalesce(v.confirmada_em, v.criado_em)) x
        FROM public.vendas v WHERE v.cliente_empresa_id = c.id AND v.estado <> 'rascunho' ORDER BY coalesce(v.confirmada_em, v.criado_em) DESC LIMIT 30) s), '[]'::jsonb));
  END IF;
  IF 'pedidos.visualizar' = ANY (perms) THEN
    r := r || jsonb_build_object('pedidos', coalesce((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('id', p.id, 'estado', p.estado,
        'total_centavos', app_private.para_centavos(p.total_estimado), 'data', p.criado_em) x
      FROM public.pedidos p WHERE p.cliente_empresa_id = c.id ORDER BY p.criado_em DESC LIMIT 30) s), '[]'::jsonb));
  END IF;
  IF perms && ARRAY['orcamentos.visualizar', 'servicos.visualizar'] THEN
    r := r || jsonb_build_object('solicitacoes', coalesce((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('id', s.id, 'numero', s.numero,
        'servico', s.servico_nome, 'estado', s.estado, 'data', s.criado_em) x
      FROM public.solicitacoes_servico s WHERE s.empresa_id = c.empresa_id AND s.cliente_id = c.id ORDER BY s.criado_em DESC LIMIT 30) s), '[]'::jsonb));
  END IF;
  IF 'servicos.visualizar' = ANY (perms) THEN
    r := r || jsonb_build_object('ordens', coalesce((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('id', o.id, 'numero', o.numero,
        'servico', o.servico_nome, 'estado', o.estado, 'data', o.criado_em) x
      FROM public.ordens_servico o WHERE o.empresa_id = c.empresa_id AND o.cliente_id = c.id ORDER BY o.criado_em DESC LIMIT 30) s), '[]'::jsonb));
  END IF;
  RETURN r;
END $$;


DROP FUNCTION IF EXISTS app_private.cliente_casa_busca(public.clientes_empresa, text);
DROP FUNCTION IF EXISTS app_private.cadastro_cliente_json(public.clientes_empresa);
DROP FUNCTION IF EXISTS app_private.padrao_busca(text);
DROP FUNCTION IF EXISTS app_private.ler_endereco(jsonb);
DROP FUNCTION IF EXISTS app_private.exigir_documento(text, text);
DROP FUNCTION IF EXISTS app_private.tipo_documento(text);
DROP FUNCTION IF EXISTS app_private.cnpj_valido(text);
DROP FUNCTION IF EXISTS app_private.cpf_valido(text);
DROP FUNCTION IF EXISTS app_private.normalizar_documento(text);
ALTER TABLE public.parcelas_financeiras DROP COLUMN forma_prevista, DROP COLUMN prazo_dias;
ALTER TABLE public.compras_fornecedor DROP COLUMN observacao;
DROP INDEX IF EXISTS public.fornecedores_documento;
ALTER TABLE public.fornecedores DROP COLUMN tipo_pessoa, DROP COLUMN nome_fantasia, DROP COLUMN contato_nome, DROP COLUMN cep,
  DROP COLUMN logradouro, DROP COLUMN numero, DROP COLUMN complemento, DROP COLUMN bairro, DROP COLUMN cidade, DROP COLUMN uf;
DROP INDEX IF EXISTS public.clientes_documento;
ALTER TABLE public.clientes_empresa DROP COLUMN tipo_pessoa, DROP COLUMN documento, DROP COLUMN nome_fantasia, DROP COLUMN cep,
  DROP COLUMN logradouro, DROP COLUMN numero, DROP COLUMN complemento, DROP COLUMN bairro, DROP COLUMN cidade, DROP COLUMN uf;
ALTER TABLE public.fornecedores DROP CONSTRAINT fornecedores_documento_check;
UPDATE public.fornecedores SET documento = NULL WHERE documento !~ '^(\d{11}|\d{14})$';
ALTER TABLE public.fornecedores ADD CONSTRAINT fornecedores_documento_check CHECK (documento ~ '^(\d{11}|\d{14})$');
ALTER TABLE public.empresas DROP CONSTRAINT empresas_documento_check;
UPDATE public.empresas SET documento = NULL WHERE documento !~ '^(\d{11}|\d{14})$';
ALTER TABLE public.empresas ADD CONSTRAINT empresas_documento_check CHECK (documento ~ '^(\d{11}|\d{14})$');
DELETE FROM app_private.historico_migracoes WHERE id = '202612010001';
COMMIT;
