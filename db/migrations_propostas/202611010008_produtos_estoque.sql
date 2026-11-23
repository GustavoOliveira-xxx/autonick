-- 202611010008: M05, produtos, variações e estoque (MINI-ESPEC_M05; ADR-G05 aprovada em 01/11/2026).
-- Produtos físicos com variação padrão oculta (D5-12), preço por variação, custo protegido, estoque por variação
-- (físico, reservado, disponível), mínimo por variação (D5-02), sob encomenda com controle das unidades existentes
-- (D5-10), pausa comercial (D5-08), propostas e aprovação (D5-04), estornos, fornecedores (D5-06), compras,
-- histórico de preços e custos (D5-07) e motor interno de reservas (D5-05). Sem transferências (D5-03).
-- Dinheiro trafega em CENTAVOS inteiros (C-13) e é guardado em numeric(14,2).
-- Rollback: 202611010008_produtos_estoque.down.sql
BEGIN;

-- ===========================================================================
-- 1. Permissões novas de fornecedores (D5-06). Perfis existentes não ganham nada.
-- ===========================================================================
INSERT INTO public.permissoes_catalogo (codigo, modulo, modulo_nome, acao, acao_nome, descricao, sensivel, ordem) VALUES
  ('fornecedores.visualizar', 'fornecedores', 'Fornecedores', 'visualizar', 'Ver fornecedores', 'Ver fornecedores e seus dados de contato.', true, 65),
  ('fornecedores.alterar', 'fornecedores', 'Fornecedores', 'alterar', 'Cadastrar fornecedores', 'Cadastrar, alterar e desativar fornecedores.', true, 66);

-- ===========================================================================
-- 2. Tabelas
-- ===========================================================================
CREATE TABLE public.fornecedores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas (id),
  nome          text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 120),
  documento     text CHECK (documento ~ '^(\d{11}|\d{14})$'),
  telefone      text CHECK (telefone ~ '^\d{10,13}$'),
  email         text CHECK (char_length(email) <= 254 AND email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  observacoes   text CHECK (char_length(observacoes) <= 500),
  ativo         boolean NOT NULL DEFAULT true,
  versao        integer NOT NULL DEFAULT 1,
  criado_por    text NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id)
);
CREATE INDEX fornecedores_empresa_nome ON public.fornecedores (empresa_id, lower(nome));

CREATE TABLE public.produtos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES public.empresas (id),
  categoria_id         uuid REFERENCES public.categorias_plataforma (id),  -- tipo 'produto'; opcional até a lista ser aprovada (D5-11)
  nome                 text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 120),
  descricao            text CHECK (char_length(descricao) <= 2000),
  finalidade           text NOT NULL CHECK (finalidade IN ('comercializavel', 'uso_interno')),  -- sem padrão (D5-01)
  sob_encomenda        boolean NOT NULL DEFAULT false,
  venda_pausada        boolean NOT NULL DEFAULT false,
  motivo_pausa         text CHECK (char_length(motivo_pausa) <= 300),
  fornecedor_padrao_id uuid,
  ativo                boolean NOT NULL DEFAULT true,
  versao               integer NOT NULL DEFAULT 1,
  criado_por           text NOT NULL,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, fornecedor_padrao_id) REFERENCES public.fornecedores (empresa_id, id),
  CONSTRAINT produtos_pausa_coerente CHECK (venda_pausada OR motivo_pausa IS NULL)
);
CREATE INDEX produtos_empresa_nome ON public.produtos (empresa_id, ativo, lower(nome));

CREATE TABLE public.produto_variacoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  produto_id      uuid NOT NULL,
  padrao          boolean NOT NULL DEFAULT false,
  atributos       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(atributos) = 'object'),
  atributos_chave text NOT NULL DEFAULT '',
  sku             text CHECK (char_length(sku) BETWEEN 1 AND 60),
  preco           numeric(14,2) NOT NULL CHECK (preco > 0),
  custo_atual     numeric(14,2) CHECK (custo_atual >= 0),
  estoque_minimo  integer CHECK (estoque_minimo >= 0),   -- por variação (D5-02)
  ativo           boolean NOT NULL DEFAULT true,
  versao          integer NOT NULL DEFAULT 1,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, produto_id) REFERENCES public.produtos (empresa_id, id),
  CONSTRAINT variacoes_padrao_sem_atributos CHECK (NOT padrao OR atributos = '{}'::jsonb)
);
CREATE UNIQUE INDEX variacoes_sku_unico ON public.produto_variacoes (empresa_id, lower(sku)) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX variacoes_atributos_unicos ON public.produto_variacoes (empresa_id, produto_id, atributos_chave) WHERE ativo;
CREATE UNIQUE INDEX variacoes_uma_padrao ON public.produto_variacoes (empresa_id, produto_id) WHERE padrao;
CREATE INDEX variacoes_produto ON public.produto_variacoes (empresa_id, produto_id);

-- Saldo materializado, sempre reconciliável com o histórico (FIN-P6). Nunca escrito pela API.
CREATE TABLE public.saldos_estoque (
  empresa_id    uuid NOT NULL,
  variacao_id   uuid PRIMARY KEY,
  fisico        integer NOT NULL DEFAULT 0 CHECK (fisico >= 0),
  reservado     integer NOT NULL DEFAULT 0,
  disponivel    integer GENERATED ALWAYS AS (fisico - reservado) STORED,
  versao        integer NOT NULL DEFAULT 1,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, variacao_id) REFERENCES public.produto_variacoes (empresa_id, id),
  CONSTRAINT saldos_reserva_coerente CHECK (reservado >= 0 AND reservado <= fisico)   -- D5-09
);
CREATE INDEX saldos_empresa ON public.saldos_estoque (empresa_id);

CREATE TABLE public.compras_fornecedor (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES public.empresas (id),
  fornecedor_id    uuid,
  data_compra      date NOT NULL,
  numero_documento text CHECK (char_length(numero_documento) <= 60),
  estado           text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho', 'registrada', 'recebida', 'cancelada')),
  custo_total      numeric(14,2) CHECK (custo_total >= 0),
  proposta_id      uuid,
  motivo_cancelamento text CHECK (char_length(motivo_cancelamento) <= 300),
  autor            text NOT NULL,
  versao           integer NOT NULL DEFAULT 1,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, fornecedor_id) REFERENCES public.fornecedores (empresa_id, id)
);
CREATE INDEX compras_empresa ON public.compras_fornecedor (empresa_id, estado, criado_em);

CREATE TABLE public.compra_itens (
  compra_id      uuid NOT NULL,
  empresa_id     uuid NOT NULL,
  variacao_id    uuid NOT NULL,
  quantidade     integer NOT NULL CHECK (quantidade > 0),
  custo_unitario numeric(14,2) CHECK (custo_unitario >= 0),
  PRIMARY KEY (compra_id, variacao_id),
  FOREIGN KEY (empresa_id, compra_id) REFERENCES public.compras_fornecedor (empresa_id, id),
  FOREIGN KEY (empresa_id, variacao_id) REFERENCES public.produto_variacoes (empresa_id, id)
);

CREATE TABLE public.propostas_movimentacao (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES public.empresas (id),
  tipo              text NOT NULL CHECK (tipo IN ('saldo_inicial', 'entrada', 'saida', 'ajuste')),
  estado            text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'aprovada', 'rejeitada', 'cancelada')),
  motivo            text CHECK (char_length(motivo) <= 300),
  compra_id         uuid,
  autor             text NOT NULL,
  aprovador         text,
  aprovacao_propria boolean NOT NULL DEFAULT false,
  decidida_em       timestamptz,
  motivo_decisao    text CHECK (char_length(motivo_decisao) <= 300),
  versao            integer NOT NULL DEFAULT 1,
  operation_key     text,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, compra_id) REFERENCES public.compras_fornecedor (empresa_id, id),
  CONSTRAINT propostas_decisao_coerente CHECK ((estado = 'pendente') = (decidida_em IS NULL))
);
CREATE INDEX propostas_empresa ON public.propostas_movimentacao (empresa_id, estado, criado_em);
ALTER TABLE public.compras_fornecedor
  ADD FOREIGN KEY (empresa_id, proposta_id) REFERENCES public.propostas_movimentacao (empresa_id, id);

CREATE TABLE public.proposta_itens (
  proposta_id    uuid NOT NULL,
  empresa_id     uuid NOT NULL,
  variacao_id    uuid NOT NULL,
  quantidade     integer NOT NULL CHECK (quantidade <> 0),   -- entrada/saída: positiva; ajuste: com sinal
  custo_unitario numeric(14,2) CHECK (custo_unitario >= 0),
  PRIMARY KEY (proposta_id, variacao_id),
  FOREIGN KEY (empresa_id, proposta_id) REFERENCES public.propostas_movimentacao (empresa_id, id),
  FOREIGN KEY (empresa_id, variacao_id) REFERENCES public.produto_variacoes (empresa_id, id)
);

-- Histórico de movimentações: SOMENTE INCLUSÃO (RF-064, FIN-I16, FIN-I30).
CREATE TABLE public.movimentacoes_estoque (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  variacao_id    uuid NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('saldo_inicial', 'entrada', 'saida', 'ajuste', 'estorno')),
  quantidade     integer NOT NULL CHECK (quantidade <> 0),   -- com sinal: efeito no físico
  fisico_apos    integer NOT NULL CHECK (fisico_apos >= 0),
  motivo         text CHECK (char_length(motivo) <= 300),
  origem_tipo    text NOT NULL CHECK (origem_tipo IN ('proposta', 'estorno', 'reserva')),
  origem_id      uuid,
  proposta_id    uuid,
  estorno_de     uuid UNIQUE REFERENCES public.movimentacoes_estoque (id),
  custo_unitario numeric(14,2),
  ator           text NOT NULL,
  operation_key  text,
  criado_em      timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, variacao_id) REFERENCES public.produto_variacoes (empresa_id, id),
  FOREIGN KEY (empresa_id, proposta_id) REFERENCES public.propostas_movimentacao (empresa_id, id)
);
CREATE INDEX movimentacoes_variacao ON public.movimentacoes_estoque (empresa_id, variacao_id, criado_em);
CREATE TRIGGER movimentacoes_somente_insercao BEFORE UPDATE OR DELETE ON public.movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

CREATE TABLE public.reservas_estoque (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  variacao_id         uuid NOT NULL,
  quantidade          integer NOT NULL CHECK (quantidade > 0),
  estado              text NOT NULL DEFAULT 'ativa' CHECK (estado IN ('ativa', 'consumida', 'liberada')),
  origem_tipo         text NOT NULL CHECK (char_length(origem_tipo) BETWEEN 2 AND 30),
  origem_id           uuid NOT NULL,
  motivo_encerramento text CHECK (char_length(motivo_encerramento) <= 300),
  criada_por          text NOT NULL,
  criada_em           timestamptz NOT NULL DEFAULT now(),
  encerrada_em        timestamptz,
  operation_key       text,
  FOREIGN KEY (empresa_id, variacao_id) REFERENCES public.produto_variacoes (empresa_id, id),
  CONSTRAINT reservas_encerramento_coerente CHECK ((estado = 'ativa') = (encerrada_em IS NULL))
);
CREATE UNIQUE INDEX reservas_uma_por_origem ON public.reservas_estoque (empresa_id, origem_tipo, origem_id, variacao_id);
CREATE INDEX reservas_variacao ON public.reservas_estoque (empresa_id, variacao_id, estado);
CREATE TRIGGER reservas_sem_exclusao BEFORE DELETE ON public.reservas_estoque
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

CREATE TABLE public.historico_precos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  variacao_id    uuid NOT NULL,
  preco_anterior numeric(14,2),
  preco_novo     numeric(14,2) NOT NULL,
  motivo         text CHECK (char_length(motivo) <= 300),
  autor          text NOT NULL,
  criado_em      timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (empresa_id, variacao_id) REFERENCES public.produto_variacoes (empresa_id, id)
);
CREATE INDEX historico_precos_variacao ON public.historico_precos (empresa_id, variacao_id, criado_em);
CREATE TRIGGER historico_precos_somente_insercao BEFORE UPDATE OR DELETE ON public.historico_precos
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

CREATE TABLE public.historico_custos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  variacao_id   uuid NOT NULL,
  custo         numeric(14,2) NOT NULL CHECK (custo >= 0),
  origem        text NOT NULL CHECK (origem IN ('cadastro', 'entrada', 'correcao')),
  compra_id     uuid,
  motivo        text CHECK (char_length(motivo) <= 300),
  autor         text NOT NULL,
  vigente_desde timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (empresa_id, variacao_id) REFERENCES public.produto_variacoes (empresa_id, id)
);
CREATE INDEX historico_custos_variacao ON public.historico_custos (empresa_id, variacao_id, vigente_desde);
CREATE TRIGGER historico_custos_somente_insercao BEFORE UPDATE OR DELETE ON public.historico_custos
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

CREATE TABLE public.eventos_estoque (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas (id),
  tipo          text NOT NULL,
  ator          text NOT NULL,
  alvo_tipo     text NOT NULL,
  alvo_id       uuid,
  detalhes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  operation_key text,
  criado_em     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX eventos_estoque_empresa ON public.eventos_estoque (empresa_id, criado_em);
CREATE TRIGGER eventos_estoque_somente_insercao BEFORE UPDATE OR DELETE ON public.eventos_estoque
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- ===========================================================================
-- 3. Funções auxiliares (privadas)
-- ===========================================================================
CREATE FUNCTION app_private.centavos(p_valor jsonb, p_campo text, p_obrigatorio boolean, p_minimo bigint)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  v numeric;
BEGIN
  IF p_valor IS NULL OR jsonb_typeof(p_valor) = 'null' THEN
    IF p_obrigatorio THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o valor em reais.', p_campo);
    END IF;
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_valor) <> 'number' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Valor inválido.', p_campo);
  END IF;
  v := (p_valor #>> '{}')::numeric;
  IF v <> trunc(v) OR v < p_minimo OR v > 99999999999999 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Valor inválido. Use reais com até duas casas decimais.', p_campo);
  END IF;
  RETURN round(v / 100, 2);
END $$;

CREATE FUNCTION app_private.para_centavos(p numeric) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT (p * 100)::bigint $$;

CREATE FUNCTION app_private.quantidade(p_valor jsonb, p_campo text, p_com_sinal boolean)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  v numeric;
BEGIN
  IF p_valor IS NULL OR jsonb_typeof(p_valor) <> 'number' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe a quantidade em unidades inteiras.', p_campo);
  END IF;
  v := (p_valor #>> '{}')::numeric;
  IF v <> trunc(v) OR v = 0 OR abs(v) > 1000000 OR (NOT p_com_sinal AND v < 0) THEN
    PERFORM app_private.erro('VALIDATION_ERROR',
      CASE WHEN p_com_sinal THEN 'A quantidade do ajuste deve ser um número inteiro diferente de zero.'
           ELSE 'A quantidade deve ser um número inteiro maior que zero.' END, p_campo);
  END IF;
  RETURN v::integer;
END $$;

-- Atributos: até 5 pares nome/valor de texto; a chave normalizada impede duplicatas (minúsculas, espaços).
CREATE FUNCTION app_private.normalizar_atributos(p jsonb, OUT atributos jsonb, OUT chave text)
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  k text;
  v jsonb;
BEGIN
  atributos := '{}'::jsonb;
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN
    chave := '';
    RETURN;
  END IF;
  IF jsonb_typeof(p) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Atributos inválidos.', 'atributos');
  END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(p) LOOP
    IF jsonb_typeof(v) <> 'string' OR char_length(btrim(k)) NOT BETWEEN 1 AND 40
       OR char_length(btrim(v #>> '{}')) NOT BETWEEN 1 AND 40 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Cada atributo precisa de nome e valor (até 40 caracteres).', 'atributos');
    END IF;
    atributos := atributos || jsonb_build_object(btrim(k), btrim(v #>> '{}'));
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(atributos)) > 5 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Use no máximo 5 atributos por variação.', 'atributos');
  END IF;
  SELECT coalesce(string_agg(lower(regexp_replace(key, '\s+', ' ', 'g')) || '=' || lower(regexp_replace(value #>> '{}', '\s+', ' ', 'g')), ';' ORDER BY lower(key)), '')
    INTO chave FROM jsonb_each(atributos);
END $$;

CREATE FUNCTION app_private.rotulo_variacao(p_atributos jsonb, p_padrao boolean) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE WHEN p_padrao THEN 'Padrão'
              ELSE coalesce((SELECT string_agg(value #>> '{}', ', ' ORDER BY key) FROM jsonb_each(p_atributos)), 'Padrão') END
$$;

CREATE FUNCTION app_private.registrar_evento_estoque(p_empresa uuid, p_tipo text, p_ator text, p_alvo_tipo text,
  p_alvo_id uuid, p_detalhes jsonb, p_chave text)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$
  INSERT INTO public.eventos_estoque (empresa_id, tipo, ator, alvo_tipo, alvo_id, detalhes, operation_key)
  VALUES (p_empresa, p_tipo, p_ator, p_alvo_tipo, p_alvo_id, coalesce(p_detalhes, '{}'::jsonb), p_chave)
$$;

CREATE FUNCTION app_private.tem(p_empresa uuid, p_usuario text, p_codigo text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT p_codigo = ANY (app_private.permissoes_de(p_empresa, p_usuario)) $$;

-- Variação da empresa (nunca revela variação de outra empresa: falha como "não encontrada").
CREATE FUNCTION app_private.variacao_da_empresa(p_empresa uuid, p_variacao uuid) RETURNS public.produto_variacoes
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v public.produto_variacoes;
BEGIN
  SELECT * INTO v FROM public.produto_variacoes WHERE id = p_variacao AND empresa_id = p_empresa;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Produto ou variação não encontrado nesta empresa.', 'variacao_id');
  END IF;
  RETURN v;
END $$;

CREATE FUNCTION app_private.produto_da_empresa_trava(p_produto uuid) RETURNS public.produtos
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  p public.produtos;
BEGIN
  SELECT * INTO p FROM public.produtos WHERE id = p_produto FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Produto não encontrado.');
  END IF;
  RETURN p;
END $$;

-- Valida e aplica campos do produto. Chaves desconhecidas são recusadas.
CREATE FUNCTION app_private.aplicar_dados_produto(p_atual public.produtos, p_dados jsonb, p_criacao boolean)
RETURNS public.produtos LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  p public.produtos := p_atual;
  k text;
BEGIN
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Dados do produto inválidos.');
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_dados) LOOP
    IF k NOT IN ('nome', 'descricao', 'categoria_id', 'finalidade', 'sob_encomenda', 'fornecedor_padrao_id') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Campo não permitido: ' || k, k);
    END IF;
  END LOOP;
  IF p_dados ? 'nome' THEN p.nome := btrim(p_dados->>'nome'); END IF;
  IF p_dados ? 'descricao' THEN p.descricao := nullif(btrim(coalesce(p_dados->>'descricao', '')), ''); END IF;
  IF p_dados ? 'finalidade' THEN p.finalidade := p_dados->>'finalidade'; END IF;
  IF p_dados ? 'sob_encomenda' THEN
    IF jsonb_typeof(p_dados->'sob_encomenda') <> 'boolean' THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Indique se o produto é sob encomenda.', 'sob_encomenda');
    END IF;
    p.sob_encomenda := (p_dados->>'sob_encomenda')::boolean;
  END IF;
  IF p_dados ? 'categoria_id' THEN p.categoria_id := nullif(p_dados->>'categoria_id', '')::uuid; END IF;
  IF p_dados ? 'fornecedor_padrao_id' THEN p.fornecedor_padrao_id := nullif(p_dados->>'fornecedor_padrao_id', '')::uuid; END IF;

  IF p.nome IS NULL OR char_length(p.nome) NOT BETWEEN 2 AND 120 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o nome do produto (2 a 120 caracteres).', 'nome');
  END IF;
  IF char_length(p.descricao) > 2000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A descrição pode ter até 2000 caracteres.', 'descricao');
  END IF;
  IF p.finalidade IS NULL OR p.finalidade NOT IN ('comercializavel', 'uso_interno') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha se o produto é comercializável ou de uso interno.', 'finalidade');
  END IF;
  IF p.categoria_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categorias_plataforma
       WHERE id = p.categoria_id AND tipo = 'produto' AND ativo) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Categoria de produto inválida.', 'categoria_id');
  END IF;
  IF p.fornecedor_padrao_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fornecedores
       WHERE id = p.fornecedor_padrao_id AND empresa_id = p.empresa_id AND ativo) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Fornecedor não encontrado nesta empresa.', 'fornecedor_padrao_id');
  END IF;
  RETURN p;
END $$;

-- Cria uma variação com saldo zerado. Devolve a variação criada.
CREATE FUNCTION app_private.criar_variacao(p_empresa uuid, p_produto uuid, p_usuario text, p_dados jsonb, p_padrao boolean)
RETURNS public.produto_variacoes LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  attr record;
  v public.produto_variacoes;
  v_sku text := nullif(btrim(coalesce(p_dados->>'sku', '')), '');
  custo numeric;
  minimo integer;
BEGIN
  IF p_padrao THEN
    SELECT * INTO attr FROM app_private.normalizar_atributos('{}'::jsonb);
  ELSE
    SELECT * INTO attr FROM app_private.normalizar_atributos(p_dados->'atributos');
    IF attr.chave = '' THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Informe ao menos um atributo da variação (por exemplo, cor ou tamanho).', 'atributos');
    END IF;
  END IF;
  IF v_sku IS NOT NULL AND char_length(v_sku) > 60 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O código (SKU) pode ter até 60 caracteres.', 'sku');
  END IF;
  IF v_sku IS NOT NULL AND EXISTS (SELECT 1 FROM public.produto_variacoes pv WHERE pv.empresa_id = p_empresa AND lower(pv.sku) = lower(v_sku)) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Já existe um produto com esse código (SKU) nesta empresa.', 'sku');
  END IF;
  IF EXISTS (SELECT 1 FROM public.produto_variacoes WHERE empresa_id = p_empresa AND produto_id = p_produto
              AND ativo AND atributos_chave = attr.chave) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Já existe uma variação com esses atributos.', 'atributos');
  END IF;
  custo := app_private.centavos(p_dados->'custo_centavos', 'custo_centavos', false, 0);
  IF custo IS NOT NULL AND NOT app_private.tem(p_empresa, p_usuario, 'produtos.ver_custo') THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite informar custo.', 'custo_centavos');
  END IF;
  IF p_dados ? 'estoque_minimo' AND jsonb_typeof(p_dados->'estoque_minimo') <> 'null' THEN
    IF jsonb_typeof(p_dados->'estoque_minimo') <> 'number' OR (p_dados->>'estoque_minimo')::numeric < 0
       OR (p_dados->>'estoque_minimo')::numeric <> trunc((p_dados->>'estoque_minimo')::numeric)
       OR (p_dados->>'estoque_minimo')::numeric > 1000000 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'O estoque mínimo deve ser um número inteiro de 0 em diante.', 'estoque_minimo');
    END IF;
    minimo := (p_dados->>'estoque_minimo')::integer;
  END IF;
  INSERT INTO public.produto_variacoes (empresa_id, produto_id, padrao, atributos, atributos_chave, sku, preco, custo_atual, estoque_minimo)
  VALUES (p_empresa, p_produto, p_padrao, attr.atributos, attr.chave, v_sku,
          app_private.centavos(p_dados->'preco_centavos', 'preco_centavos', true, 1), custo, minimo)
  RETURNING * INTO v;
  INSERT INTO public.saldos_estoque (empresa_id, variacao_id) VALUES (p_empresa, v.id);
  INSERT INTO public.historico_precos (empresa_id, variacao_id, preco_anterior, preco_novo, motivo, autor)
  VALUES (p_empresa, v.id, NULL, v.preco, 'Cadastro', p_usuario);
  IF custo IS NOT NULL THEN
    INSERT INTO public.historico_custos (empresa_id, variacao_id, custo, origem, motivo, autor)
    VALUES (p_empresa, v.id, custo, 'cadastro', 'Cadastro', p_usuario);
  END IF;
  RETURN v;
END $$;

-- Aplica itens ao estoque numa única transação: trava os saldos em ordem de variação (evita impasse),
-- confere disponível e grava o histórico. Nada é aplicado se algum item falhar (FIN-I27).
-- p_itens: [{variacao_id, delta, custo (numeric|null)}]
CREATE FUNCTION app_private.aplicar_itens(p_empresa uuid, p_usuario text, p_tipo text, p_itens jsonb, p_motivo text,
  p_origem_tipo text, p_origem_id uuid, p_proposta uuid, p_chave text, p_estorno_de uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  it record;
  s public.saldos_estoque;
  v public.produto_variacoes;
  p public.produtos;
  novo integer;
  resultado jsonb := '[]'::jsonb;
BEGIN
  FOR it IN SELECT (e->>'variacao_id')::uuid AS variacao_id, (e->>'delta')::integer AS delta,
                   nullif(e->>'custo', '')::numeric AS custo
              FROM jsonb_array_elements(p_itens) e ORDER BY (e->>'variacao_id')::uuid LOOP
    SELECT * INTO s FROM public.saldos_estoque WHERE variacao_id = it.variacao_id AND empresa_id = p_empresa FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM app_private.erro('NOT_FOUND', 'Produto ou variação não encontrado nesta empresa.', 'variacao_id');
    END IF;
    SELECT * INTO v FROM public.produto_variacoes WHERE id = it.variacao_id;
    SELECT * INTO p FROM public.produtos WHERE id = v.produto_id;
    IF p_tipo <> 'estorno' AND it.delta > 0 AND NOT (v.ativo AND p.ativo) THEN
      PERFORM app_private.erro('STATE_CONFLICT', 'Este produto ou variação está desativado e não recebe entradas.', 'variacao_id');
    END IF;
    novo := s.fisico + it.delta;
    IF novo < s.reservado THEN
      PERFORM app_private.erro('INSUFFICIENT_STOCK',
        format('Estoque insuficiente: há %s disponíveis de %s (%s).', s.disponivel, p.nome, app_private.rotulo_variacao(v.atributos, v.padrao)),
        it.variacao_id::text);
    END IF;
    UPDATE public.saldos_estoque SET fisico = novo, versao = versao + 1, atualizado_em = now()
     WHERE variacao_id = it.variacao_id;
    INSERT INTO public.movimentacoes_estoque (empresa_id, variacao_id, tipo, quantidade, fisico_apos, motivo,
      origem_tipo, origem_id, proposta_id, estorno_de, custo_unitario, ator, operation_key)
    VALUES (p_empresa, it.variacao_id, p_tipo, it.delta, novo, p_motivo, p_origem_tipo, p_origem_id, p_proposta,
      p_estorno_de, it.custo, p_usuario, p_chave);
    IF it.custo IS NOT NULL AND it.delta > 0 AND p_tipo IN ('entrada', 'saldo_inicial') THEN
      UPDATE public.produto_variacoes SET custo_atual = it.custo, atualizado_em = now() WHERE id = it.variacao_id;
      INSERT INTO public.historico_custos (empresa_id, variacao_id, custo, origem, compra_id, motivo, autor)
      VALUES (p_empresa, it.variacao_id, it.custo, 'entrada',
        (SELECT compra_id FROM public.propostas_movimentacao WHERE id = p_proposta), 'Entrada aprovada', p_usuario);
    END IF;
    resultado := resultado || jsonb_build_object('variacao_id', it.variacao_id, 'quantidade', it.delta,
      'fisico', novo, 'reservado', s.reservado, 'disponivel', novo - s.reservado);
  END LOOP;
  RETURN resultado;
END $$;

-- Itens de uma proposta, já com o efeito (delta) de cada um.
CREATE FUNCTION app_private.itens_para_aplicar(p_proposta uuid, p_tipo text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('variacao_id', variacao_id,
           'delta', CASE WHEN p_tipo = 'saida' THEN -quantidade ELSE quantidade END,
           'custo', custo_unitario) ORDER BY variacao_id), '[]'::jsonb)
    FROM public.proposta_itens WHERE proposta_id = p_proposta
$$;

-- Valida e grava uma proposta. Se p_aplicar, aplica na mesma transação (aprovação própria, D5-04).
CREATE FUNCTION app_private.criar_proposta(p_empresa uuid, p_usuario text, p_tipo text, p_itens jsonb, p_motivo text,
  p_compra uuid, p_aplicar boolean, p_chave text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  prop public.propostas_movimentacao;
  e jsonb;
  var public.produto_variacoes;
  q integer;
  custo numeric;
  motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  aplicado jsonb;
BEGIN
  IF p_tipo NOT IN ('saldo_inicial', 'entrada', 'saida', 'ajuste') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Tipo de movimentação inválido.', 'tipo');
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Inclua ao menos um item.', 'itens');
  END IF;
  IF jsonb_array_length(p_itens) > 200 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Use no máximo 200 itens por movimentação.', 'itens');
  END IF;
  IF p_tipo = 'saida' AND (motivo IS NULL OR char_length(motivo) < 3) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o motivo da saída.', 'motivo');
  END IF;
  IF p_tipo = 'ajuste' AND (motivo IS NULL OR char_length(motivo) < 10) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique o ajuste (pelo menos 10 caracteres).', 'motivo');
  END IF;
  IF char_length(motivo) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O motivo pode ter até 300 caracteres.', 'motivo');
  END IF;
  INSERT INTO public.propostas_movimentacao (empresa_id, tipo, motivo, compra_id, autor, operation_key)
  VALUES (p_empresa, p_tipo, motivo, p_compra, p_usuario, p_chave) RETURNING * INTO prop;
  FOR e IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    var := app_private.variacao_da_empresa(p_empresa, nullif(e->>'variacao_id', '')::uuid);
    q := app_private.quantidade(e->'quantidade', 'quantidade', p_tipo = 'ajuste');
    custo := app_private.centavos(e->'custo_centavos', 'custo_centavos', false, 0);
    IF custo IS NOT NULL AND (p_tipo NOT IN ('entrada', 'saldo_inicial')) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Custo só é informado em entradas.', 'custo_centavos');
    END IF;
    IF custo IS NOT NULL AND NOT app_private.tem(p_empresa, p_usuario, 'produtos.ver_custo') THEN
      PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite informar custo.', 'custo_centavos');
    END IF;
    IF EXISTS (SELECT 1 FROM public.proposta_itens WHERE proposta_id = prop.id AND variacao_id = var.id) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'A mesma variação aparece duas vezes. Junte as quantidades.', 'itens');
    END IF;
    INSERT INTO public.proposta_itens (proposta_id, empresa_id, variacao_id, quantidade, custo_unitario)
    VALUES (prop.id, p_empresa, var.id, q, custo);
  END LOOP;
  PERFORM app_private.registrar_evento_estoque(p_empresa, 'proposta_criada', p_usuario, 'proposta', prop.id,
    jsonb_build_object('tipo', p_tipo, 'itens', jsonb_array_length(p_itens), 'aplicada_direto', p_aplicar), p_chave);
  IF p_aplicar THEN
    aplicado := app_private.aplicar_itens(p_empresa, p_usuario, p_tipo, app_private.itens_para_aplicar(prop.id, p_tipo),
      motivo, 'proposta', prop.id, prop.id, p_chave);
    UPDATE public.propostas_movimentacao SET estado = 'aprovada', aprovador = p_usuario, aprovacao_propria = true,
      decidida_em = now(), versao = versao + 1 WHERE id = prop.id;
    PERFORM app_private.auditar(p_empresa, p_usuario, 'estoque.movimentacao_aplicada', 'propostas_movimentacao', prop.id,
      jsonb_build_object('tipo', p_tipo, 'aprovacao_propria', true));
  END IF;
  RETURN jsonb_build_object('proposta_id', prop.id, 'tipo', p_tipo,
    'estado', CASE WHEN p_aplicar THEN 'aprovada' ELSE 'pendente' END,
    'aprovacao_propria', p_aplicar, 'saldos', coalesce(aplicado, '[]'::jsonb));
END $$;

DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app_private' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
END $$;

-- ===========================================================================
-- 4. Produtos e variações (API-009, API-010)
-- ===========================================================================
-- p_variacoes: [] ou null => produto simples com variação padrão oculta (D5-12), usando p_dados->preco_centavos etc.
-- Cada variação: {atributos, sku, preco_centavos, custo_centavos, estoque_minimo, quantidade_inicial}
CREATE FUNCTION public.criar_produto(p_empresa_id uuid, p_dados jsonb, p_variacoes jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text, p_variacoes::text));
  anterior jsonb;
  base public.produtos;
  novo public.produtos;
  var public.produto_variacoes;
  lista jsonb;
  item jsonb;
  dados_produto jsonb;
  iniciais jsonb := '[]'::jsonb;
  criadas jsonb := '[]'::jsonb;
  qtd integer;
  proposta jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_produto', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['produtos.criar']);
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Dados do produto inválidos.');
  END IF;
  dados_produto := p_dados - 'preco_centavos' - 'custo_centavos' - 'estoque_minimo' - 'sku' - 'quantidade_inicial';
  base.empresa_id := p_empresa_id;
  base.sob_encomenda := false;
  novo := app_private.aplicar_dados_produto(base, dados_produto, true);
  INSERT INTO public.produtos (empresa_id, categoria_id, nome, descricao, finalidade, sob_encomenda, fornecedor_padrao_id, criado_por)
  VALUES (p_empresa_id, novo.categoria_id, novo.nome, novo.descricao, novo.finalidade, novo.sob_encomenda,
          novo.fornecedor_padrao_id, usuario)
  RETURNING * INTO novo;

  IF p_variacoes IS NULL OR jsonb_typeof(p_variacoes) = 'null' OR p_variacoes = '[]'::jsonb THEN
    lista := jsonb_build_array(jsonb_build_object('preco_centavos', p_dados->'preco_centavos', 'custo_centavos', p_dados->'custo_centavos',
      'estoque_minimo', p_dados->'estoque_minimo', 'sku', p_dados->'sku', 'quantidade_inicial', p_dados->'quantidade_inicial', '_padrao', true));
  ELSIF jsonb_typeof(p_variacoes) <> 'array' OR jsonb_array_length(p_variacoes) > 50 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe até 50 variações.', 'variacoes');
  ELSE
    lista := p_variacoes;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(lista) LOOP
    var := app_private.criar_variacao(p_empresa_id, novo.id, usuario, item, coalesce((item->>'_padrao')::boolean, false));
    criadas := criadas || jsonb_build_object('id', var.id, 'padrao', var.padrao, 'atributos', var.atributos);
    IF item ? 'quantidade_inicial' AND jsonb_typeof(item->'quantidade_inicial') <> 'null'
       AND NOT (jsonb_typeof(item->'quantidade_inicial') = 'number' AND (item->>'quantidade_inicial')::numeric = 0) THEN
      qtd := app_private.quantidade(item->'quantidade_inicial', 'quantidade_inicial', false);
      iniciais := iniciais || jsonb_build_object('variacao_id', var.id, 'quantidade', qtd, 'custo_centavos', item->'custo_centavos');
    END IF;
  END LOOP;
  IF jsonb_array_length(iniciais) > 0 THEN
    IF NOT (app_private.tem(p_empresa_id, usuario, 'estoque.propor') OR app_private.tem(p_empresa_id, usuario, 'estoque.aprovar')) THEN
      PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite lançar estoque inicial.', 'quantidade_inicial');
    END IF;
    proposta := app_private.criar_proposta(p_empresa_id, usuario, 'saldo_inicial', iniciais, 'Estoque inicial do cadastro', NULL,
      app_private.tem(p_empresa_id, usuario, 'estoque.aprovar'), p_operation_key);
  END IF;
  PERFORM app_private.registrar_evento_estoque(p_empresa_id, 'produto_criado', usuario, 'produto', novo.id,
    jsonb_build_object('nome', novo.nome, 'variacoes', jsonb_array_length(lista), 'finalidade', novo.finalidade), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'criar_produto', p_operation_key, assinatura,
    jsonb_build_object('id', novo.id, 'nome', novo.nome, 'versao', novo.versao,
      'variacoes', criadas,
      'estoque_inicial', proposta));
END $$;

CREATE FUNCTION public.alterar_produto(p_produto_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_produto_id, p_dados::text, p_expected_version));
  anterior jsonb;
  p public.produtos;
  novo public.produtos;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_produto', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  p := app_private.produto_da_empresa_trava(p_produto_id);
  PERFORM app_private.exigir_permissoes(p.empresa_id, usuario, ARRAY['produtos.alterar']);
  IF p.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este produto foi alterado por outra pessoa. Atualize antes de continuar.');
  END IF;
  novo := app_private.aplicar_dados_produto(p, p_dados, false);
  UPDATE public.produtos SET nome = novo.nome, descricao = novo.descricao, categoria_id = novo.categoria_id,
    finalidade = novo.finalidade, sob_encomenda = novo.sob_encomenda, fornecedor_padrao_id = novo.fornecedor_padrao_id,
    versao = versao + 1, atualizado_em = now()
  WHERE id = p.id RETURNING * INTO novo;
  PERFORM app_private.registrar_evento_estoque(p.empresa_id, 'produto_alterado', usuario, 'produto', p.id,
    jsonb_build_object('campos', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_dados) k),
      'finalidade_antes', p.finalidade, 'finalidade_depois', novo.finalidade), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'alterar_produto', p_operation_key, assinatura,
    jsonb_build_object('id', novo.id, 'versao', novo.versao, 'finalidade', novo.finalidade, 'sob_encomenda', novo.sob_encomenda));
END $$;

-- Pausa comercial (D5-08): o produto deixa de ser vendido ou pedido, mesmo com estoque. Não mexe no estoque.
CREATE FUNCTION public.pausar_venda_produto(p_produto_id uuid, p_pausar boolean, p_motivo text, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_produto_id, p_pausar, p_motivo, p_expected_version));
  anterior jsonb;
  p public.produtos;
  motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'pausar_venda_produto', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  p := app_private.produto_da_empresa_trava(p_produto_id);
  PERFORM app_private.exigir_permissoes(p.empresa_id, usuario, ARRAY['produtos.alterar']);
  IF p.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este produto foi alterado por outra pessoa. Atualize antes de continuar.');
  END IF;
  IF p_pausar IS NULL OR p_pausar = p.venda_pausada THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN p.venda_pausada THEN 'A venda deste produto já está pausada.' ELSE 'A venda deste produto já está ativa.' END);
  END IF;
  IF char_length(motivo) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O motivo pode ter até 300 caracteres.', 'motivo');
  END IF;
  UPDATE public.produtos SET venda_pausada = p_pausar, motivo_pausa = CASE WHEN p_pausar THEN motivo END,
    versao = versao + 1, atualizado_em = now() WHERE id = p.id;
  PERFORM app_private.registrar_evento_estoque(p.empresa_id, CASE WHEN p_pausar THEN 'venda_pausada' ELSE 'venda_retomada' END,
    usuario, 'produto', p.id, jsonb_build_object('motivo', motivo), p_operation_key);
  PERFORM app_private.auditar(p.empresa_id, usuario, CASE WHEN p_pausar THEN 'produto.venda_pausada' ELSE 'produto.venda_retomada' END,
    'produtos', p.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'pausar_venda_produto', p_operation_key, assinatura,
    jsonb_build_object('id', p.id, 'venda_pausada', p_pausar, 'versao', p.versao + 1));
END $$;

CREATE FUNCTION public.definir_produto_ativo(p_produto_id uuid, p_ativo boolean, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_produto_id, p_ativo, p_expected_version));
  anterior jsonb;
  p public.produtos;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_produto_ativo', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  p := app_private.produto_da_empresa_trava(p_produto_id);
  PERFORM app_private.exigir_permissoes(p.empresa_id, usuario, ARRAY['produtos.alterar']);
  IF p.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este produto foi alterado por outra pessoa. Atualize antes de continuar.');
  END IF;
  IF p_ativo IS NULL OR p_ativo = p.ativo THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN p.ativo THEN 'O produto já está ativo.' ELSE 'O produto já está desativado.' END);
  END IF;
  IF NOT p_ativo AND EXISTS (SELECT 1 FROM public.reservas_estoque r JOIN public.produto_variacoes v ON v.id = r.variacao_id
                              WHERE v.produto_id = p.id AND r.estado = 'ativa') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Há unidades reservadas deste produto. Libere ou conclua as reservas antes de desativar.');
  END IF;
  UPDATE public.produtos SET ativo = p_ativo, versao = versao + 1, atualizado_em = now() WHERE id = p.id;
  PERFORM app_private.registrar_evento_estoque(p.empresa_id, CASE WHEN p_ativo THEN 'produto_reativado' ELSE 'produto_desativado' END,
    usuario, 'produto', p.id, '{}'::jsonb, p_operation_key);
  RETURN app_private.idem_fim(usuario, 'definir_produto_ativo', p_operation_key, assinatura,
    jsonb_build_object('id', p.id, 'ativo', p_ativo, 'versao', p.versao + 1));
END $$;

-- Nova variação. Em produto simples (só a variação padrão), a primeira variação nomeada substitui a padrão,
-- que precisa estar sem estoque e sem reserva.
CREATE FUNCTION public.adicionar_variacao(p_produto_id uuid, p_dados jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_produto_id, p_dados::text));
  anterior jsonb;
  p public.produtos;
  var_padrao public.produto_variacoes;
  sp public.saldos_estoque;
  var public.produto_variacoes;
  proposta jsonb;
  qtd integer;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'adicionar_variacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  p := app_private.produto_da_empresa_trava(p_produto_id);
  PERFORM app_private.exigir_permissoes(p.empresa_id, usuario, ARRAY['produtos.criar']);
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Dados da variação inválidos.');
  END IF;
  SELECT * INTO var_padrao FROM public.produto_variacoes pv WHERE pv.produto_id = p.id AND pv.padrao AND pv.ativo;
  IF FOUND THEN
    SELECT * INTO sp FROM public.saldos_estoque WHERE variacao_id = var_padrao.id FOR UPDATE;
    IF sp.fisico <> 0 OR sp.reservado <> 0 THEN
      PERFORM app_private.erro('STATE_CONFLICT', 'Este produto ainda tem estoque sem variação. Zere esse estoque (saída ou ajuste) antes de criar variações.');
    END IF;
    UPDATE public.produto_variacoes SET ativo = false, versao = versao + 1, atualizado_em = now() WHERE id = var_padrao.id;
  END IF;
  var := app_private.criar_variacao(p.empresa_id, p.id, usuario, p_dados, false);
  IF p_dados ? 'quantidade_inicial' AND jsonb_typeof(p_dados->'quantidade_inicial') = 'number'
     AND (p_dados->>'quantidade_inicial')::numeric <> 0 THEN
    IF NOT (app_private.tem(p.empresa_id, usuario, 'estoque.propor') OR app_private.tem(p.empresa_id, usuario, 'estoque.aprovar')) THEN
      PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite lançar estoque inicial.', 'quantidade_inicial');
    END IF;
    qtd := app_private.quantidade(p_dados->'quantidade_inicial', 'quantidade_inicial', false);
    proposta := app_private.criar_proposta(p.empresa_id, usuario, 'saldo_inicial',
      jsonb_build_array(jsonb_build_object('variacao_id', var.id, 'quantidade', qtd, 'custo_centavos', p_dados->'custo_centavos')),
      'Estoque inicial da variação', NULL, app_private.tem(p.empresa_id, usuario, 'estoque.aprovar'), p_operation_key);
  END IF;
  UPDATE public.produtos SET versao = versao + 1, atualizado_em = now() WHERE id = p.id;
  PERFORM app_private.registrar_evento_estoque(p.empresa_id, 'variacao_criada', usuario, 'variacao', var.id,
    jsonb_build_object('produto_id', p.id, 'atributos', var.atributos, 'substituiu_padrao', var_padrao.id IS NOT NULL), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'adicionar_variacao', p_operation_key, assinatura,
    jsonb_build_object('id', var.id, 'produto_id', p.id, 'atributos', var.atributos, 'estoque_inicial', proposta));
END $$;

-- Atributos, SKU e estoque mínimo da variação. Preço e custo têm funções próprias.
CREATE FUNCTION public.alterar_variacao(p_variacao_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_variacao_id, p_dados::text, p_expected_version));
  anterior jsonb;
  v public.produto_variacoes;
  attr record;
  novo_sku text;
  novo_minimo integer;
  k text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_variacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO v FROM public.produto_variacoes WHERE id = p_variacao_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Variação não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(v.empresa_id, usuario, ARRAY['produtos.alterar']);
  IF v.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta variação foi alterada por outra pessoa. Atualize antes de continuar.');
  END IF;
  SELECT v.atributos AS atributos, v.atributos_chave AS chave INTO attr;
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Dados da variação inválidos.');
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_dados) LOOP
    IF k NOT IN ('atributos', 'sku', 'estoque_minimo') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Campo não permitido: ' || k, k);
    END IF;
  END LOOP;
  IF p_dados ? 'atributos' THEN
    IF v.padrao THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'A variação padrão não tem atributos.', 'atributos');
    END IF;
    SELECT * INTO attr FROM app_private.normalizar_atributos(p_dados->'atributos');
    IF attr.chave = '' THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Informe ao menos um atributo da variação.', 'atributos');
    END IF;
    IF EXISTS (SELECT 1 FROM public.produto_variacoes WHERE produto_id = v.produto_id AND ativo AND id <> v.id
                AND atributos_chave = attr.chave) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Já existe uma variação com esses atributos.', 'atributos');
    END IF;
  END IF;
  novo_sku := CASE WHEN p_dados ? 'sku' THEN nullif(btrim(coalesce(p_dados->>'sku', '')), '') ELSE v.sku END;
  IF char_length(novo_sku) > 60 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O código (SKU) pode ter até 60 caracteres.', 'sku');
  END IF;
  IF novo_sku IS NOT NULL AND EXISTS (SELECT 1 FROM public.produto_variacoes pv WHERE pv.empresa_id = v.empresa_id
       AND lower(pv.sku) = lower(novo_sku) AND pv.id <> v.id) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Já existe um produto com esse código (SKU) nesta empresa.', 'sku');
  END IF;
  novo_minimo := v.estoque_minimo;
  IF p_dados ? 'estoque_minimo' THEN
    IF jsonb_typeof(p_dados->'estoque_minimo') = 'null' THEN
      novo_minimo := NULL;
    ELSIF jsonb_typeof(p_dados->'estoque_minimo') <> 'number' OR (p_dados->>'estoque_minimo')::numeric < 0
       OR (p_dados->>'estoque_minimo')::numeric <> trunc((p_dados->>'estoque_minimo')::numeric)
       OR (p_dados->>'estoque_minimo')::numeric > 1000000 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'O estoque mínimo deve ser um número inteiro de 0 em diante.', 'estoque_minimo');
    ELSE
      novo_minimo := (p_dados->>'estoque_minimo')::integer;
    END IF;
  END IF;
  UPDATE public.produto_variacoes SET
    atributos = attr.atributos, atributos_chave = attr.chave,
    sku = novo_sku, estoque_minimo = novo_minimo, versao = versao + 1, atualizado_em = now()
  WHERE id = v.id RETURNING * INTO v;
  PERFORM app_private.registrar_evento_estoque(v.empresa_id, 'variacao_alterada', usuario, 'variacao', v.id,
    jsonb_build_object('campos', (SELECT jsonb_agg(k2 ORDER BY k2) FROM jsonb_object_keys(p_dados) k2)), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'alterar_variacao', p_operation_key, assinatura,
    jsonb_build_object('id', v.id, 'versao', v.versao, 'estoque_minimo', v.estoque_minimo, 'sku', v.sku, 'atributos', v.atributos));
END $$;

CREATE FUNCTION public.definir_variacao_ativa(p_variacao_id uuid, p_ativo boolean, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_variacao_id, p_ativo, p_expected_version));
  anterior jsonb;
  v public.produto_variacoes;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_variacao_ativa', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO v FROM public.produto_variacoes WHERE id = p_variacao_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Variação não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(v.empresa_id, usuario, ARRAY['produtos.alterar']);
  IF v.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta variação foi alterada por outra pessoa. Atualize antes de continuar.');
  END IF;
  IF p_ativo IS NULL OR p_ativo = v.ativo THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN v.ativo THEN 'A variação já está ativa.' ELSE 'A variação já está desativada.' END);
  END IF;
  IF v.padrao AND p_ativo THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A variação padrão substituída não pode ser reativada.');
  END IF;
  IF NOT p_ativo AND (SELECT reservado FROM public.saldos_estoque WHERE variacao_id = v.id) > 0 THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Há unidades reservadas desta variação. Libere ou conclua as reservas antes de desativar.');
  END IF;
  IF p_ativo AND EXISTS (SELECT 1 FROM public.produto_variacoes WHERE produto_id = v.produto_id AND ativo AND id <> v.id
                          AND atributos_chave = v.atributos_chave) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Já existe uma variação ativa com esses atributos.');
  END IF;
  UPDATE public.produto_variacoes SET ativo = p_ativo, versao = versao + 1, atualizado_em = now() WHERE id = v.id;
  PERFORM app_private.registrar_evento_estoque(v.empresa_id, CASE WHEN p_ativo THEN 'variacao_reativada' ELSE 'variacao_desativada' END,
    usuario, 'variacao', v.id, '{}'::jsonb, p_operation_key);
  RETURN app_private.idem_fim(usuario, 'definir_variacao_ativa', p_operation_key, assinatura,
    jsonb_build_object('id', v.id, 'ativo', p_ativo, 'versao', v.versao + 1));
END $$;

-- Preço (RF-045): só com produtos.alterar_preco; histórico permanente; nada retroage (FIN-I13).
CREATE FUNCTION public.alterar_preco(p_variacao_id uuid, p_preco_centavos bigint, p_motivo text, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_variacao_id, p_preco_centavos, p_motivo, p_expected_version));
  anterior jsonb;
  v public.produto_variacoes;
  novo numeric;
  motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_preco', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO v FROM public.produto_variacoes WHERE id = p_variacao_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Variação não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(v.empresa_id, usuario, ARRAY['produtos.alterar_preco']);
  IF v.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta variação foi alterada por outra pessoa. Atualize antes de continuar.');
  END IF;
  novo := app_private.centavos(to_jsonb(p_preco_centavos), 'preco_centavos', true, 1);
  IF char_length(motivo) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O motivo pode ter até 300 caracteres.', 'motivo');
  END IF;
  IF novo = v.preco THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O preço informado é igual ao atual.', 'preco_centavos');
  END IF;
  UPDATE public.produto_variacoes SET preco = novo, versao = versao + 1, atualizado_em = now() WHERE id = v.id;
  INSERT INTO public.historico_precos (empresa_id, variacao_id, preco_anterior, preco_novo, motivo, autor)
  VALUES (v.empresa_id, v.id, v.preco, novo, motivo, usuario);
  PERFORM app_private.auditar(v.empresa_id, usuario, 'produto.preco_alterado', 'produto_variacoes', v.id,
    jsonb_build_object('antes', app_private.para_centavos(v.preco), 'depois', app_private.para_centavos(novo)));
  RETURN app_private.idem_fim(usuario, 'alterar_preco', p_operation_key, assinatura,
    jsonb_build_object('id', v.id, 'preco_centavos', app_private.para_centavos(novo), 'versao', v.versao + 1));
END $$;

-- Custo (D5-07): correção manual com histórico; só quem vê custo.
CREATE FUNCTION public.alterar_custo(p_variacao_id uuid, p_custo_centavos bigint, p_motivo text, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_variacao_id, p_custo_centavos, p_motivo, p_expected_version));
  anterior jsonb;
  v public.produto_variacoes;
  novo numeric;
  motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_custo', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO v FROM public.produto_variacoes WHERE id = p_variacao_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Variação não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(v.empresa_id, usuario, ARRAY['produtos.ver_custo', 'produtos.alterar']);
  IF v.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta variação foi alterada por outra pessoa. Atualize antes de continuar.');
  END IF;
  novo := app_private.centavos(to_jsonb(p_custo_centavos), 'custo_centavos', true, 0);
  IF motivo IS NULL OR char_length(motivo) NOT BETWEEN 3 AND 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique a correção do custo (3 a 300 caracteres).', 'motivo');
  END IF;
  UPDATE public.produto_variacoes SET custo_atual = novo, versao = versao + 1, atualizado_em = now() WHERE id = v.id;
  INSERT INTO public.historico_custos (empresa_id, variacao_id, custo, origem, motivo, autor)
  VALUES (v.empresa_id, v.id, novo, 'correcao', motivo, usuario);
  PERFORM app_private.auditar(v.empresa_id, usuario, 'produto.custo_corrigido', 'produto_variacoes', v.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'alterar_custo', p_operation_key, assinatura,
    jsonb_build_object('id', v.id, 'custo_centavos', app_private.para_centavos(novo), 'versao', v.versao + 1));
END $$;

-- ===========================================================================
-- 5. Movimentações, aprovação e estorno (API-011, API-012; D5-04)
-- ===========================================================================
CREATE FUNCTION public.propor_movimentacao(p_empresa_id uuid, p_tipo text, p_itens jsonb, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_tipo, p_itens::text, p_motivo));
  anterior jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'propor_movimentacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['estoque.propor']);
  IF p_tipo = 'saldo_inicial' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Estoque inicial é lançado no cadastro da variação.', 'tipo');
  END IF;
  RETURN app_private.idem_fim(usuario, 'propor_movimentacao', p_operation_key, assinatura,
    app_private.criar_proposta(p_empresa_id, usuario, p_tipo, p_itens, p_motivo, NULL, false, p_operation_key));
END $$;

CREATE FUNCTION public.registrar_movimentacao(p_empresa_id uuid, p_tipo text, p_itens jsonb, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_tipo, p_itens::text, p_motivo));
  anterior jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_movimentacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['estoque.aprovar']);
  IF p_tipo = 'saldo_inicial' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Estoque inicial é lançado no cadastro da variação.', 'tipo');
  END IF;
  RETURN app_private.idem_fim(usuario, 'registrar_movimentacao', p_operation_key, assinatura,
    app_private.criar_proposta(p_empresa_id, usuario, p_tipo, p_itens, p_motivo, NULL, true, p_operation_key));
END $$;

CREATE FUNCTION public.aprovar_proposta(p_proposta_id uuid, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_proposta_id, p_expected_version));
  anterior jsonb;
  prop public.propostas_movimentacao;
  aplicado jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'aprovar_proposta', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO prop FROM public.propostas_movimentacao WHERE id = p_proposta_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Movimentação não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(prop.empresa_id, usuario, ARRAY['estoque.aprovar']);
  IF prop.estado <> 'pendente' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta movimentação já foi decidida.');
  END IF;
  IF prop.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta movimentação mudou desde que você abriu a tela. Atualize antes de continuar.');
  END IF;
  aplicado := app_private.aplicar_itens(prop.empresa_id, usuario, prop.tipo, app_private.itens_para_aplicar(prop.id, prop.tipo),
    prop.motivo, 'proposta', prop.id, prop.id, p_operation_key);
  UPDATE public.propostas_movimentacao SET estado = 'aprovada', aprovador = usuario, aprovacao_propria = (prop.autor = usuario),
    decidida_em = now(), versao = versao + 1 WHERE id = prop.id;
  IF prop.compra_id IS NOT NULL THEN
    UPDATE public.compras_fornecedor SET estado = 'recebida', versao = versao + 1, atualizado_em = now() WHERE id = prop.compra_id;
  END IF;
  PERFORM app_private.registrar_evento_estoque(prop.empresa_id, 'proposta_aprovada', usuario, 'proposta', prop.id,
    jsonb_build_object('tipo', prop.tipo, 'aprovacao_propria', prop.autor = usuario), p_operation_key);
  PERFORM app_private.auditar(prop.empresa_id, usuario, 'estoque.movimentacao_aplicada', 'propostas_movimentacao', prop.id,
    jsonb_build_object('tipo', prop.tipo, 'aprovacao_propria', prop.autor = usuario));
  RETURN app_private.idem_fim(usuario, 'aprovar_proposta', p_operation_key, assinatura,
    jsonb_build_object('proposta_id', prop.id, 'estado', 'aprovada', 'saldos', aplicado));
END $$;

CREATE FUNCTION public.decidir_proposta_sem_aplicar(p_proposta_id uuid, p_decisao text, p_motivo text, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_proposta_id, p_decisao, p_motivo, p_expected_version));
  anterior jsonb;
  prop public.propostas_movimentacao;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  novo_estado text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'decidir_proposta_sem_aplicar', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  IF p_decisao NOT IN ('rejeitar', 'cancelar') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Decisão inválida.', 'decisao');
  END IF;
  SELECT * INTO prop FROM public.propostas_movimentacao WHERE id = p_proposta_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Movimentação não encontrada.');
  END IF;
  IF p_decisao = 'rejeitar' OR prop.autor <> usuario THEN
    PERFORM app_private.exigir_permissoes(prop.empresa_id, usuario, ARRAY['estoque.aprovar']);
  ELSE
    PERFORM app_private.exigir_permissoes(prop.empresa_id, usuario, ARRAY['estoque.propor']);
  END IF;
  IF prop.estado <> 'pendente' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta movimentação já foi decidida.');
  END IF;
  IF prop.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta movimentação mudou desde que você abriu a tela. Atualize antes de continuar.');
  END IF;
  IF p_decisao = 'rejeitar' AND (v_motivo IS NULL OR char_length(v_motivo) NOT BETWEEN 3 AND 300) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique a rejeição (3 a 300 caracteres).', 'motivo');
  END IF;
  novo_estado := CASE p_decisao WHEN 'rejeitar' THEN 'rejeitada' ELSE 'cancelada' END;
  UPDATE public.propostas_movimentacao SET estado = novo_estado, aprovador = usuario, decidida_em = now(),
    motivo_decisao = v_motivo, versao = versao + 1 WHERE id = prop.id;
  IF prop.compra_id IS NOT NULL THEN
    UPDATE public.compras_fornecedor SET estado = 'cancelada', motivo_cancelamento = coalesce(v_motivo, 'Entrada ' || novo_estado),
      versao = versao + 1, atualizado_em = now() WHERE id = prop.compra_id;
  END IF;
  PERFORM app_private.registrar_evento_estoque(prop.empresa_id, 'proposta_' || novo_estado, usuario, 'proposta', prop.id,
    jsonb_build_object('motivo', v_motivo), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'decidir_proposta_sem_aplicar', p_operation_key, assinatura,
    jsonb_build_object('proposta_id', prop.id, 'estado', novo_estado));
END $$;

-- Estorno (RF-054, FIN-I16): movimentação inversa, uma única vez, sem apagar a original.
CREATE FUNCTION public.estornar_movimentacao(p_movimentacao_id uuid, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_movimentacao_id, p_motivo));
  anterior jsonb;
  m public.movimentacoes_estoque;
  motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  aplicado jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'estornar_movimentacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO m FROM public.movimentacoes_estoque WHERE id = p_movimentacao_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Movimentação não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(m.empresa_id, usuario, ARRAY['estoque.aprovar']);
  -- Trava o saldo antes de conferir o estorno: dois estornos simultâneos ficam em fila.
  PERFORM 1 FROM public.saldos_estoque WHERE variacao_id = m.variacao_id FOR UPDATE;
  IF m.tipo = 'estorno' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Um estorno não pode ser estornado. Faça um ajuste, se precisar.');
  END IF;
  IF m.origem_tipo <> 'proposta' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta movimentação veio de outro módulo e só é corrigida por lá.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.movimentacoes_estoque WHERE estorno_de = m.id) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta movimentação já foi estornada.');
  END IF;
  IF motivo IS NULL OR char_length(motivo) NOT BETWEEN 10 AND 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique o estorno (10 a 300 caracteres).', 'motivo');
  END IF;
  aplicado := app_private.aplicar_itens(m.empresa_id, usuario, 'estorno',
    jsonb_build_array(jsonb_build_object('variacao_id', m.variacao_id, 'delta', -m.quantidade)),
    motivo, 'estorno', m.id, NULL, p_operation_key, m.id);
  PERFORM app_private.registrar_evento_estoque(m.empresa_id, 'movimentacao_estornada', usuario, 'movimentacao', m.id,
    jsonb_build_object('motivo', motivo, 'quantidade', -m.quantidade), p_operation_key);
  PERFORM app_private.auditar(m.empresa_id, usuario, 'estoque.estorno', 'movimentacoes_estoque', m.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'estornar_movimentacao', p_operation_key, assinatura,
    jsonb_build_object('movimentacao_id', m.id, 'estornada', true, 'saldos', aplicado));
END $$;

-- ===========================================================================
-- 6. Fornecedores (RF-065; D5-06)
-- ===========================================================================
CREATE FUNCTION app_private.validar_fornecedor(p_atual public.fornecedores, p_dados jsonb) RETURNS public.fornecedores
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
REVOKE ALL ON FUNCTION app_private.validar_fornecedor(public.fornecedores, jsonb) FROM PUBLIC;

CREATE FUNCTION public.criar_fornecedor(p_empresa_id uuid, p_dados jsonb, p_operation_key text)
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

CREATE FUNCTION public.alterar_fornecedor(p_fornecedor_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text)
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

-- ===========================================================================
-- 7. Compras de fornecedor (RF-055, RF-056; FIN-001 §4.3)
-- ===========================================================================
CREATE FUNCTION public.criar_compra(p_empresa_id uuid, p_dados jsonb, p_itens jsonb, p_operation_key text)
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

-- Registrar a compra gera a proposta de entrada. Quem tem estoque.aprovar recebe na hora (D5-04).
CREATE FUNCTION public.registrar_compra(p_compra_id uuid, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_compra_id, p_expected_version));
  anterior jsonb;
  c public.compras_fornecedor;
  aplicar boolean;
  prop jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_compra', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.compras_fornecedor WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Compra não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['estoque.propor']);
  IF c.estado <> 'rascunho' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta compra já foi registrada ou cancelada.');
  END IF;
  IF c.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta compra mudou desde que você abriu a tela. Atualize antes de continuar.');
  END IF;
  aplicar := app_private.tem(c.empresa_id, usuario, 'estoque.aprovar');
  prop := app_private.criar_proposta(c.empresa_id, usuario, 'entrada',
    (SELECT jsonb_agg(jsonb_build_object('variacao_id', variacao_id, 'quantidade', quantidade,
       'custo_centavos', CASE WHEN custo_unitario IS NULL THEN NULL ELSE app_private.para_centavos(custo_unitario) END) ORDER BY variacao_id)
       FROM public.compra_itens WHERE compra_id = c.id),
    'Compra de fornecedor' || coalesce(' (doc. ' || c.numero_documento || ')', ''), c.id, aplicar, p_operation_key);
  UPDATE public.compras_fornecedor SET estado = CASE WHEN aplicar THEN 'recebida' ELSE 'registrada' END,
    proposta_id = (prop->>'proposta_id')::uuid, versao = versao + 1, atualizado_em = now() WHERE id = c.id;
  RETURN app_private.idem_fim(usuario, 'registrar_compra', p_operation_key, assinatura,
    jsonb_build_object('id', c.id, 'estado', CASE WHEN aplicar THEN 'recebida' ELSE 'registrada' END, 'proposta', prop));
END $$;

CREATE FUNCTION public.cancelar_compra(p_compra_id uuid, p_motivo text, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_compra_id, p_motivo, p_expected_version));
  anterior jsonb;
  c public.compras_fornecedor;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'cancelar_compra', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.compras_fornecedor WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Compra não encontrada.');
  END IF;
  IF c.estado = 'rascunho' AND c.autor = usuario THEN
    PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['estoque.propor']);
  ELSE
    PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['estoque.aprovar']);
  END IF;
  IF c.estado NOT IN ('rascunho', 'registrada') THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN c.estado = 'recebida'
      THEN 'A entrada desta compra já foi aplicada. Para corrigir, estorne a movimentação.' ELSE 'Esta compra já foi cancelada.' END);
  END IF;
  IF c.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta compra mudou desde que você abriu a tela. Atualize antes de continuar.');
  END IF;
  IF v_motivo IS NULL OR char_length(v_motivo) NOT BETWEEN 3 AND 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique o cancelamento (3 a 300 caracteres).', 'motivo');
  END IF;
  IF c.proposta_id IS NOT NULL THEN
    UPDATE public.propostas_movimentacao SET estado = 'cancelada', aprovador = usuario, decidida_em = now(),
      motivo_decisao = v_motivo, versao = versao + 1 WHERE id = c.proposta_id AND estado = 'pendente';
  END IF;
  UPDATE public.compras_fornecedor SET estado = 'cancelada', motivo_cancelamento = v_motivo, versao = versao + 1, atualizado_em = now()
   WHERE id = c.id;
  PERFORM app_private.registrar_evento_estoque(c.empresa_id, 'compra_cancelada', usuario, 'compra', c.id,
    jsonb_build_object('motivo', v_motivo), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'cancelar_compra', p_operation_key, assinatura,
    jsonb_build_object('id', c.id, 'estado', 'cancelada'));
END $$;

-- ===========================================================================
-- 8. Leituras (a permissão decide o que entra no resultado)
-- ===========================================================================
-- Catálogo com variações; preço só com produtos.visualizar; saldo só com estoque.visualizar; custo só com ver_custo.
-- Visão consolidada por produto (D5-02): totais e quantidade de variações em alerta.
CREATE FUNCTION public.produtos_da_empresa(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  perms text[];
  ver_preco boolean;
  ver_estoque boolean;
  ver_custo boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = p_empresa_id AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  perms := app_private.permissoes_de(p_empresa_id, usuario);
  ver_preco := 'produtos.visualizar' = ANY (perms);
  ver_estoque := 'estoque.visualizar' = ANY (perms);
  ver_custo := 'produtos.ver_custo' = ANY (perms);
  IF NOT (ver_preco OR ver_estoque) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite ver os produtos desta empresa.');
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'nome', p.nome, 'descricao', p.descricao, 'categoria_id', p.categoria_id, 'finalidade', p.finalidade,
      'sob_encomenda', p.sob_encomenda, 'venda_pausada', p.venda_pausada, 'motivo_pausa', p.motivo_pausa,
      'fornecedor_padrao_id', p.fornecedor_padrao_id, 'ativo', p.ativo, 'versao', p.versao,
      'variacoes', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', v.id, 'padrao', v.padrao, 'atributos', v.atributos, 'rotulo', app_private.rotulo_variacao(v.atributos, v.padrao),
          'sku', v.sku, 'ativo', v.ativo, 'versao', v.versao, 'estoque_minimo', v.estoque_minimo,
          'preco_centavos', CASE WHEN ver_preco THEN app_private.para_centavos(v.preco) END,
          'custo_centavos', CASE WHEN ver_custo AND v.custo_atual IS NOT NULL THEN app_private.para_centavos(v.custo_atual) END,
          'fisico', CASE WHEN ver_estoque THEN s.fisico END,
          'reservado', CASE WHEN ver_estoque THEN s.reservado END,
          'disponivel', CASE WHEN ver_estoque THEN s.disponivel END,
          'abaixo_minimo', CASE WHEN ver_estoque THEN (v.estoque_minimo IS NOT NULL AND s.disponivel <= v.estoque_minimo) END))
          ORDER BY v.padrao DESC, v.criado_em, v.id), '[]'::jsonb)
        FROM public.produto_variacoes v JOIN public.saldos_estoque s ON s.variacao_id = v.id
        WHERE v.produto_id = p.id AND (v.ativo OR NOT v.padrao)),
      'resumo', CASE WHEN ver_estoque THEN (SELECT jsonb_build_object(
          'fisico', coalesce(sum(s.fisico), 0), 'reservado', coalesce(sum(s.reservado), 0), 'disponivel', coalesce(sum(s.disponivel), 0),
          'variacoes_em_alerta', count(*) FILTER (WHERE v.estoque_minimo IS NOT NULL AND s.disponivel <= v.estoque_minimo))
        FROM public.produto_variacoes v JOIN public.saldos_estoque s ON s.variacao_id = v.id
        WHERE v.produto_id = p.id AND v.ativo) END)
      ORDER BY p.ativo DESC, lower(p.nome))
      FROM public.produtos p WHERE p.empresa_id = p_empresa_id), '[]'::jsonb);
END $$;

-- Alertas por variação (D5-02): disponível igual ou abaixo do mínimo; só ativos.
CREATE FUNCTION public.alertas_estoque(p_empresa_id uuid)
RETURNS TABLE (produto_id uuid, produto_nome text, variacao_id uuid, rotulo text, disponivel integer, estoque_minimo integer, sob_encomenda boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['estoque.visualizar']);
  RETURN QUERY
    SELECT p.id, p.nome, v.id, app_private.rotulo_variacao(v.atributos, v.padrao), s.disponivel, v.estoque_minimo, p.sob_encomenda
      FROM public.produto_variacoes v
      JOIN public.produtos p ON p.id = v.produto_id
      JOIN public.saldos_estoque s ON s.variacao_id = v.id
     WHERE v.empresa_id = p_empresa_id AND v.ativo AND p.ativo AND v.estoque_minimo IS NOT NULL AND s.disponivel <= v.estoque_minimo
     ORDER BY (s.disponivel - v.estoque_minimo), lower(p.nome);
END $$;

CREATE FUNCTION public.historico_movimentacoes(p_empresa_id uuid, p_variacao_id uuid DEFAULT NULL, p_limite integer DEFAULT 100)
RETURNS TABLE (id uuid, criado_em timestamptz, tipo text, produto_nome text, rotulo text, variacao_id uuid, quantidade integer,
               fisico_apos integer, motivo text, ator_nome text, origem_tipo text, proposta_id uuid, estorno_de uuid,
               estornada boolean, custo_centavos bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  ver_custo boolean;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['estoque.visualizar']);
  ver_custo := app_private.tem(p_empresa_id, usuario, 'produtos.ver_custo');
  RETURN QUERY
    SELECT m.id, m.criado_em, m.tipo, p.nome, app_private.rotulo_variacao(v.atributos, v.padrao), m.variacao_id, m.quantidade,
           m.fisico_apos, m.motivo, app_private.nome_da_pessoa(m.ator), m.origem_tipo, m.proposta_id, m.estorno_de,
           EXISTS (SELECT 1 FROM public.movimentacoes_estoque e WHERE e.estorno_de = m.id),
           CASE WHEN ver_custo AND m.custo_unitario IS NOT NULL THEN app_private.para_centavos(m.custo_unitario) END
      FROM public.movimentacoes_estoque m
      JOIN public.produto_variacoes v ON v.id = m.variacao_id
      JOIN public.produtos p ON p.id = v.produto_id
     WHERE m.empresa_id = p_empresa_id AND (p_variacao_id IS NULL OR m.variacao_id = p_variacao_id)
     ORDER BY m.criado_em DESC, m.id
     LIMIT least(greatest(coalesce(p_limite, 100), 1), 500);
END $$;

CREATE FUNCTION public.propostas_da_empresa(p_empresa_id uuid, p_estado text DEFAULT 'pendente') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  ver_custo boolean;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['estoque.visualizar']);
  ver_custo := app_private.tem(p_empresa_id, usuario, 'produtos.ver_custo');
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'tipo', pr.tipo, 'estado', pr.estado, 'motivo', pr.motivo,
      'compra_id', pr.compra_id, 'autor_nome', app_private.nome_da_pessoa(pr.autor), 'sou_autor', pr.autor = usuario,
      'aprovador_nome', CASE WHEN pr.aprovador IS NULL THEN NULL ELSE app_private.nome_da_pessoa(pr.aprovador) END,
      'aprovacao_propria', pr.aprovacao_propria, 'motivo_decisao', pr.motivo_decisao, 'versao', pr.versao,
      'criado_em', pr.criado_em, 'decidida_em', pr.decidida_em,
      'itens', (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('variacao_id', i.variacao_id, 'produto_nome', p.nome,
          'rotulo', app_private.rotulo_variacao(v.atributos, v.padrao), 'quantidade', i.quantidade,
          'custo_centavos', CASE WHEN ver_custo AND i.custo_unitario IS NOT NULL THEN app_private.para_centavos(i.custo_unitario) END)) ORDER BY p.nome)
        FROM public.proposta_itens i JOIN public.produto_variacoes v ON v.id = i.variacao_id JOIN public.produtos p ON p.id = v.produto_id
        WHERE i.proposta_id = pr.id))
      ORDER BY pr.criado_em DESC)
      FROM public.propostas_movimentacao pr
     WHERE pr.empresa_id = p_empresa_id AND (p_estado IS NULL OR pr.estado = p_estado)), '[]'::jsonb);
END $$;

CREATE FUNCTION public.custos_da_variacao(p_variacao_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v public.produto_variacoes;
BEGIN
  SELECT * INTO v FROM public.produto_variacoes WHERE id = p_variacao_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Variação não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(v.empresa_id, usuario, ARRAY['produtos.ver_custo']);
  RETURN jsonb_build_object('variacao_id', v.id,
    'ultimo_custo_centavos', CASE WHEN v.custo_atual IS NULL THEN NULL ELSE app_private.para_centavos(v.custo_atual) END,
    'metodo', 'ultimo_custo_informado',
    'historico', coalesce((SELECT jsonb_agg(jsonb_build_object('custo_centavos', app_private.para_centavos(h.custo), 'origem', h.origem,
        'motivo', h.motivo, 'autor_nome', app_private.nome_da_pessoa(h.autor), 'vigente_desde', h.vigente_desde, 'compra_id', h.compra_id)
        ORDER BY h.vigente_desde DESC) FROM public.historico_custos h WHERE h.variacao_id = v.id), '[]'::jsonb),
    'precos', coalesce((SELECT jsonb_agg(jsonb_build_object('preco_centavos', app_private.para_centavos(h.preco_novo),
        'autor_nome', app_private.nome_da_pessoa(h.autor), 'motivo', h.motivo, 'criado_em', h.criado_em) ORDER BY h.criado_em DESC)
        FROM public.historico_precos h WHERE h.variacao_id = v.id), '[]'::jsonb));
END $$;

CREATE FUNCTION public.compras_da_empresa(p_empresa_id uuid) RETURNS jsonb
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

-- Reconciliação (FIN-P6): devolve as divergências entre saldo, histórico e reservas. Vazio = íntegro.
CREATE FUNCTION public.reconciliar_estoque(p_empresa_id uuid)
RETURNS TABLE (variacao_id uuid, fisico_saldo integer, fisico_historico bigint, reservado_saldo integer, reservado_reservas bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  IF NOT app_private.eh_proprietario_de(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Somente o proprietário pode conferir a reconciliação do estoque.');
  END IF;
  RETURN QUERY SELECT * FROM app_private.divergencias_estoque(p_empresa_id);
END $$;

CREATE FUNCTION app_private.divergencias_estoque(p_empresa_id uuid)
RETURNS TABLE (variacao_id uuid, fisico_saldo integer, fisico_historico bigint, reservado_saldo integer, reservado_reservas bigint)
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT s.variacao_id, s.fisico, coalesce(m.total, 0), s.reservado, coalesce(r.total, 0)
    FROM public.saldos_estoque s
    LEFT JOIN (SELECT mv.variacao_id, sum(mv.quantidade) AS total FROM public.movimentacoes_estoque mv
                WHERE mv.empresa_id = p_empresa_id GROUP BY mv.variacao_id) m ON m.variacao_id = s.variacao_id
    LEFT JOIN (SELECT rv.variacao_id, sum(rv.quantidade) AS total FROM public.reservas_estoque rv
                WHERE rv.empresa_id = p_empresa_id AND rv.estado = 'ativa' GROUP BY rv.variacao_id) r ON r.variacao_id = s.variacao_id
   WHERE s.empresa_id = p_empresa_id
     AND (s.fisico <> coalesce(m.total, 0) OR s.reservado <> coalesce(r.total, 0))
$$;
REVOKE ALL ON FUNCTION app_private.divergencias_estoque(uuid) FROM PUBLIC;

-- ===========================================================================
-- 9. Motor interno de reservas (D5-05). NÃO exposto à Data API: usado pelos pedidos (M11) e vendas (M06).
-- ===========================================================================
-- Reserva por origem (ex.: pedido). Tudo ou nada, travas em ordem de variação. Repetir a mesma origem não reserva de novo.
-- Sob encomenda (D5-10): reserva o que houver e informa o restante em 'a_encomendar'; os demais exigem disponível.
CREATE FUNCTION app_private.reservar_estoque(p_empresa uuid, p_usuario text, p_origem_tipo text, p_origem_id uuid,
  p_itens jsonb, p_chave text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  it record;
  s public.saldos_estoque;
  v public.produto_variacoes;
  p public.produtos;
  reservar integer;
  resultado jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('reserva|' || p_empresa || '|' || p_origem_tipo || '|' || p_origem_id, 0));
  IF EXISTS (SELECT 1 FROM public.reservas_estoque WHERE empresa_id = p_empresa AND origem_tipo = p_origem_tipo AND origem_id = p_origem_id) THEN
    RETURN jsonb_build_object('repetida', true, 'reservas', (SELECT jsonb_agg(jsonb_build_object('variacao_id', variacao_id,
      'reservado', quantidade, 'estado', estado) ORDER BY variacao_id) FROM public.reservas_estoque
      WHERE empresa_id = p_empresa AND origem_tipo = p_origem_tipo AND origem_id = p_origem_id));
  END IF;
  FOR it IN SELECT (e->>'variacao_id')::uuid AS variacao_id, sum((e->>'quantidade')::integer) AS quantidade
              FROM jsonb_array_elements(p_itens) e GROUP BY 1 ORDER BY 1 LOOP
    IF it.quantidade IS NULL OR it.quantidade <= 0 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Quantidade de reserva inválida.', 'quantidade');
    END IF;
    SELECT * INTO s FROM public.saldos_estoque WHERE variacao_id = it.variacao_id AND empresa_id = p_empresa FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM app_private.erro('NOT_FOUND', 'Produto ou variação não encontrado nesta empresa.', 'variacao_id');
    END IF;
    SELECT * INTO v FROM public.produto_variacoes WHERE id = it.variacao_id;
    SELECT * INTO p FROM public.produtos WHERE id = v.produto_id;
    IF NOT (v.ativo AND p.ativo) THEN
      PERFORM app_private.erro('STATE_CONFLICT', 'Este produto ou variação está desativado.', it.variacao_id::text);
    END IF;
    IF s.disponivel >= it.quantidade THEN
      reservar := it.quantidade;
    ELSIF p.sob_encomenda THEN
      reservar := greatest(s.disponivel, 0);
    ELSE
      PERFORM app_private.erro('INSUFFICIENT_STOCK',
        format('Estoque insuficiente: há %s disponíveis de %s (%s).', s.disponivel, p.nome, app_private.rotulo_variacao(v.atributos, v.padrao)),
        it.variacao_id::text);
    END IF;
    IF reservar > 0 THEN
      UPDATE public.saldos_estoque SET reservado = reservado + reservar, versao = versao + 1, atualizado_em = now()
       WHERE variacao_id = it.variacao_id;
      INSERT INTO public.reservas_estoque (empresa_id, variacao_id, quantidade, origem_tipo, origem_id, criada_por, operation_key)
      VALUES (p_empresa, it.variacao_id, reservar, p_origem_tipo, p_origem_id, p_usuario, p_chave);
    END IF;
    resultado := resultado || jsonb_build_object('variacao_id', it.variacao_id, 'reservado', reservar,
      'a_encomendar', it.quantidade - reservar);
  END LOOP;
  PERFORM app_private.registrar_evento_estoque(p_empresa, 'estoque_reservado', p_usuario, p_origem_tipo, p_origem_id,
    jsonb_build_object('itens', resultado), p_chave);
  RETURN jsonb_build_object('repetida', false, 'reservas', resultado);
END $$;

-- Libera as reservas ativas da origem, exatamente uma vez (FIN-I09).
CREATE FUNCTION app_private.liberar_reservas(p_empresa uuid, p_usuario text, p_origem_tipo text, p_origem_id uuid, p_motivo text)
RETURNS integer LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  r public.reservas_estoque;
  total integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('reserva|' || p_empresa || '|' || p_origem_tipo || '|' || p_origem_id, 0));
  FOR r IN SELECT * FROM public.reservas_estoque WHERE empresa_id = p_empresa AND origem_tipo = p_origem_tipo
              AND origem_id = p_origem_id AND estado = 'ativa' ORDER BY variacao_id LOOP
    PERFORM 1 FROM public.saldos_estoque WHERE variacao_id = r.variacao_id FOR UPDATE;
    UPDATE public.saldos_estoque SET reservado = reservado - r.quantidade, versao = versao + 1, atualizado_em = now()
     WHERE variacao_id = r.variacao_id;
    UPDATE public.reservas_estoque SET estado = 'liberada', encerrada_em = now(), motivo_encerramento = p_motivo WHERE id = r.id;
    total := total + 1;
  END LOOP;
  IF total > 0 THEN
    PERFORM app_private.registrar_evento_estoque(p_empresa, 'reserva_liberada', p_usuario, p_origem_tipo, p_origem_id,
      jsonb_build_object('reservas', total, 'motivo', p_motivo), NULL);
  END IF;
  RETURN total;
END $$;

-- Consome as reservas ativas da origem: baixa físico e reservado juntos, com saída no histórico (FIN-001 §4.1, passo 5).
CREATE FUNCTION app_private.consumir_reservas(p_empresa uuid, p_usuario text, p_origem_tipo text, p_origem_id uuid, p_chave text)
RETURNS integer LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  r public.reservas_estoque;
  novo integer;
  total integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('reserva|' || p_empresa || '|' || p_origem_tipo || '|' || p_origem_id, 0));
  FOR r IN SELECT * FROM public.reservas_estoque WHERE empresa_id = p_empresa AND origem_tipo = p_origem_tipo
              AND origem_id = p_origem_id AND estado = 'ativa' ORDER BY variacao_id LOOP
    PERFORM 1 FROM public.saldos_estoque WHERE variacao_id = r.variacao_id FOR UPDATE;
    UPDATE public.saldos_estoque SET fisico = fisico - r.quantidade, reservado = reservado - r.quantidade,
      versao = versao + 1, atualizado_em = now() WHERE variacao_id = r.variacao_id RETURNING fisico INTO novo;
    INSERT INTO public.movimentacoes_estoque (empresa_id, variacao_id, tipo, quantidade, fisico_apos, motivo, origem_tipo,
      origem_id, ator, operation_key)
    VALUES (p_empresa, r.variacao_id, 'saida', -r.quantidade, novo, 'Reserva consumida (' || p_origem_tipo || ')', 'reserva', r.id,
      p_usuario, p_chave);
    UPDATE public.reservas_estoque SET estado = 'consumida', encerrada_em = now() WHERE id = r.id;
    total := total + 1;
  END LOOP;
  IF total > 0 THEN
    PERFORM app_private.registrar_evento_estoque(p_empresa, 'reserva_consumida', p_usuario, p_origem_tipo, p_origem_id,
      jsonb_build_object('reservas', total), p_chave);
  END IF;
  RETURN total;
END $$;

-- ===========================================================================
-- 10. Permissões de execução, RLS e GRANTs mínimos
-- ===========================================================================
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app_private' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
  FOR f IN SELECT unnest(ARRAY[
    'public.criar_produto(uuid, jsonb, jsonb, text)',
    'public.alterar_produto(uuid, jsonb, integer, text)',
    'public.pausar_venda_produto(uuid, boolean, text, integer, text)',
    'public.definir_produto_ativo(uuid, boolean, integer, text)',
    'public.adicionar_variacao(uuid, jsonb, text)',
    'public.alterar_variacao(uuid, jsonb, integer, text)',
    'public.definir_variacao_ativa(uuid, boolean, integer, text)',
    'public.alterar_preco(uuid, bigint, text, integer, text)',
    'public.alterar_custo(uuid, bigint, text, integer, text)',
    'public.propor_movimentacao(uuid, text, jsonb, text, text)',
    'public.registrar_movimentacao(uuid, text, jsonb, text, text)',
    'public.aprovar_proposta(uuid, integer, text)',
    'public.decidir_proposta_sem_aplicar(uuid, text, text, integer, text)',
    'public.estornar_movimentacao(uuid, text, text)',
    'public.criar_fornecedor(uuid, jsonb, text)',
    'public.alterar_fornecedor(uuid, jsonb, integer, text)',
    'public.criar_compra(uuid, jsonb, jsonb, text)',
    'public.registrar_compra(uuid, integer, text)',
    'public.cancelar_compra(uuid, text, integer, text)',
    'public.produtos_da_empresa(uuid)',
    'public.alertas_estoque(uuid)',
    'public.historico_movimentacoes(uuid, uuid, integer)',
    'public.propostas_da_empresa(uuid, text)',
    'public.custos_da_variacao(uuid)',
    'public.compras_da_empresa(uuid)',
    'public.reconciliar_estoque(uuid)'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;
CREATE POLICY fornecedores_ler ON public.fornecedores FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'fornecedores.visualizar')));
GRANT SELECT ON public.fornecedores TO authenticated;

ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
CREATE POLICY produtos_ler ON public.produtos FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'produtos.visualizar')) OR (SELECT authz.tem_permissao(empresa_id, 'estoque.visualizar')));
GRANT SELECT ON public.produtos TO authenticated;

ALTER TABLE public.produto_variacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY variacoes_ler ON public.produto_variacoes FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'produtos.visualizar')) OR (SELECT authz.tem_permissao(empresa_id, 'estoque.visualizar')));
GRANT SELECT (id, empresa_id, produto_id, padrao, atributos, sku, preco, estoque_minimo, ativo, versao, criado_em, atualizado_em)
  ON public.produto_variacoes TO authenticated;   -- custo_atual: só por função com produtos.ver_custo

ALTER TABLE public.saldos_estoque ENABLE ROW LEVEL SECURITY;
CREATE POLICY saldos_ler ON public.saldos_estoque FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'estoque.visualizar')));
GRANT SELECT ON public.saldos_estoque TO authenticated;

ALTER TABLE public.movimentacoes_estoque ENABLE ROW LEVEL SECURITY;
CREATE POLICY movimentacoes_ler ON public.movimentacoes_estoque FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'estoque.visualizar')));
GRANT SELECT (id, empresa_id, variacao_id, tipo, quantidade, fisico_apos, motivo, origem_tipo, origem_id, proposta_id, estorno_de, criado_em)
  ON public.movimentacoes_estoque TO authenticated;

ALTER TABLE public.propostas_movimentacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY propostas_ler ON public.propostas_movimentacao FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'estoque.visualizar')));
GRANT SELECT (id, empresa_id, tipo, estado, motivo, compra_id, aprovacao_propria, decidida_em, motivo_decisao, versao, criado_em)
  ON public.propostas_movimentacao TO authenticated;

ALTER TABLE public.proposta_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY proposta_itens_ler ON public.proposta_itens FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'estoque.visualizar')));
GRANT SELECT (proposta_id, empresa_id, variacao_id, quantidade) ON public.proposta_itens TO authenticated;

ALTER TABLE public.reservas_estoque ENABLE ROW LEVEL SECURITY;
CREATE POLICY reservas_ler ON public.reservas_estoque FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'estoque.visualizar')));
GRANT SELECT (id, empresa_id, variacao_id, quantidade, estado, origem_tipo, origem_id, criada_em, encerrada_em)
  ON public.reservas_estoque TO authenticated;

ALTER TABLE public.compras_fornecedor ENABLE ROW LEVEL SECURITY;
CREATE POLICY compras_ler ON public.compras_fornecedor FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'estoque.visualizar')));
GRANT SELECT (id, empresa_id, fornecedor_id, data_compra, numero_documento, estado, proposta_id, motivo_cancelamento, versao, criado_em)
  ON public.compras_fornecedor TO authenticated;

ALTER TABLE public.compra_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY compra_itens_ler ON public.compra_itens FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'estoque.visualizar')));
GRANT SELECT (compra_id, empresa_id, variacao_id, quantidade) ON public.compra_itens TO authenticated;

ALTER TABLE public.historico_precos ENABLE ROW LEVEL SECURITY;
CREATE POLICY historico_precos_ler ON public.historico_precos FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'produtos.visualizar')));
GRANT SELECT (id, empresa_id, variacao_id, preco_anterior, preco_novo, motivo, criado_em) ON public.historico_precos TO authenticated;

ALTER TABLE public.historico_custos ENABLE ROW LEVEL SECURITY;   -- sem GRANT: só por custos_da_variacao (produtos.ver_custo)

ALTER TABLE public.eventos_estoque ENABLE ROW LEVEL SECURITY;
CREATE POLICY eventos_estoque_ler ON public.eventos_estoque FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'estoque.visualizar')));
GRANT SELECT (id, empresa_id, tipo, alvo_tipo, alvo_id, detalhes, criado_em) ON public.eventos_estoque TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611010008', 'M05: produtos, variações, estoque, propostas, estornos, fornecedores, compras e motor de reservas');

COMMIT;
