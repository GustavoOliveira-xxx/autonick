-- 202611020002: M06, clientes internos, vendas, pedidos externos, a receber e recebimentos
-- (MINI-ESPEC_M06; ADR-G06 aprovada em 02/11/2026; implementação autorizada só no desenvolvimento).
-- Pedido não é venda; venda não é pagamento; reserva não é baixa (FIN-P2). Preço, desconto e total só no banco.
-- D6-08 (B com controle de entrega): item sob encomenda sem físico fica PENDENTE de entrega, com as unidades reais
-- reservadas; a baixa só acontece na entrega efetiva, com unidades existentes. Nunca negativo, nunca entrega fictícia.
-- D6-15: número da venda por contador transacional por empresa (sem lacunas por erro, sem reutilização).
-- Dinheiro trafega em CENTAVOS inteiros e é guardado em numeric(14,2).
-- Rollback: 202611020002_clientes_vendas.down.sql
BEGIN;

-- ===========================================================================
-- 1. Permissão nova (D6-17), limite de desconto por perfil (D6-04) e origens novas de estoque
-- ===========================================================================
INSERT INTO public.permissoes_catalogo (codigo, modulo, modulo_nome, acao, acao_nome, descricao, sensivel, ordem) VALUES
  ('vendas.registrar_recebimento', 'vendas', 'Vendas', 'registrar_recebimento', 'Registrar recebimentos',
   'Registrar recebimentos e devoluções de valores das vendas no balcão. Estornar continua no financeiro.', true, 86);

ALTER TABLE public.perfis_permissao
  ADD COLUMN desconto_maximo_percentual numeric(5,2) CHECK (desconto_maximo_percentual BETWEEN 0 AND 100);
COMMENT ON COLUMN public.perfis_permissao.desconto_maximo_percentual IS
  'Desconto máximo (% do subtotal) para quem usa o perfil e tem vendas.aplicar_desconto. NULL = 0%. O proprietário não tem limite.';
GRANT SELECT (desconto_maximo_percentual) ON public.perfis_permissao TO authenticated;

ALTER TABLE public.movimentacoes_estoque DROP CONSTRAINT movimentacoes_estoque_origem_tipo_check;
ALTER TABLE public.movimentacoes_estoque ADD CONSTRAINT movimentacoes_estoque_origem_tipo_check
  CHECK (origem_tipo IN ('proposta', 'estorno', 'reserva', 'venda', 'devolucao_venda'));

-- ===========================================================================
-- 2. Tabelas
-- ===========================================================================
CREATE TABLE public.clientes_empresa (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES public.empresas (id),
  nome              text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 120),
  telefone          text CHECK (telefone ~ '^\d{10,13}$'),
  email             text CHECK (char_length(email) <= 254),
  observacoes       text CHECK (char_length(observacoes) <= 500),
  perfil_cliente_id text,      -- conta pública do cliente; só preenchido por pedido externo aceito (D6-11)
  ativo             boolean NOT NULL DEFAULT true,
  versao            integer NOT NULL DEFAULT 1,
  criado_por        text NOT NULL,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id)
);
CREATE UNIQUE INDEX clientes_um_por_conta ON public.clientes_empresa (empresa_id, perfil_cliente_id) WHERE perfil_cliente_id IS NOT NULL;
CREATE INDEX clientes_nome ON public.clientes_empresa (empresa_id, lower(nome));

CREATE TABLE app_private.contadores_empresa (
  empresa_id     uuid PRIMARY KEY REFERENCES public.empresas (id),
  proxima_venda  integer NOT NULL DEFAULT 1 CHECK (proxima_venda >= 1)
);

CREATE TABLE public.pedidos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES public.empresas (id),
  cliente_auth_id    text NOT NULL,
  cliente_nome       text NOT NULL,
  cliente_empresa_id uuid,
  estado             text NOT NULL DEFAULT 'solicitado'
                       CHECK (estado IN ('solicitado', 'aceito', 'recusado', 'cancelado', 'concluido')),
  observacao_cliente text CHECK (char_length(observacao_cliente) <= 500),
  motivo_decisao     text CHECK (char_length(motivo_decisao) <= 300),
  total_estimado     numeric(14,2) NOT NULL CHECK (total_estimado > 0),
  venda_id           uuid,
  decidido_por       text,
  versao             integer NOT NULL DEFAULT 1,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  decidido_em        timestamptz,
  concluido_em       timestamptz,
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, cliente_empresa_id) REFERENCES public.clientes_empresa (empresa_id, id)
);
CREATE INDEX pedidos_fila ON public.pedidos (empresa_id, estado, criado_em DESC);
CREATE INDEX pedidos_do_cliente ON public.pedidos (cliente_auth_id, criado_em DESC);

CREATE TABLE public.pedido_itens (
  pedido_id       uuid NOT NULL,
  empresa_id      uuid NOT NULL,
  variacao_id     uuid NOT NULL,
  quantidade      integer NOT NULL CHECK (quantidade BETWEEN 1 AND 100000),
  preco_unitario  numeric(14,2) NOT NULL CHECK (preco_unitario > 0),
  nome_snapshot   text NOT NULL,
  rotulo_snapshot text NOT NULL,
  PRIMARY KEY (pedido_id, variacao_id),
  FOREIGN KEY (empresa_id, pedido_id) REFERENCES public.pedidos (empresa_id, id),
  FOREIGN KEY (empresa_id, variacao_id) REFERENCES public.produto_variacoes (empresa_id, id)
);

CREATE TABLE public.vendas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas (id),
  numero              integer,
  origem              text NOT NULL CHECK (origem IN ('balcao', 'pedido')),
  pedido_id           uuid,
  cliente_empresa_id  uuid,
  cliente_nome        text,     -- snapshot do nome no momento da venda
  estado              text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho', 'confirmada', 'cancelada')),
  entrega             text CHECK (entrega IN ('entregue', 'pendente', 'cancelada')),
  subtotal            numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  desconto_itens      numeric(14,2) NOT NULL DEFAULT 0 CHECK (desconto_itens >= 0),
  desconto_geral      numeric(14,2) NOT NULL DEFAULT 0 CHECK (desconto_geral >= 0),
  total               numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  condicao            text CHECK (condicao IN ('a_vista', 'parcelado')),
  observacao          text CHECK (char_length(observacao) <= 500),
  autor               text NOT NULL,
  confirmada_por      text,
  confirmada_em       timestamptz,
  cancelada_por       text,
  cancelada_em        timestamptz,
  motivo_cancelamento text CHECK (char_length(motivo_cancelamento) <= 300),
  versao              integer NOT NULL DEFAULT 1,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  UNIQUE (empresa_id, numero),
  FOREIGN KEY (empresa_id, pedido_id) REFERENCES public.pedidos (empresa_id, id),
  FOREIGN KEY (empresa_id, cliente_empresa_id) REFERENCES public.clientes_empresa (empresa_id, id),
  CONSTRAINT vendas_total_coerente CHECK (total = subtotal - desconto_itens - desconto_geral),
  CONSTRAINT vendas_numero_coerente CHECK ((estado = 'rascunho') = (numero IS NULL)),
  CONSTRAINT vendas_origem_coerente CHECK ((origem = 'pedido') = (pedido_id IS NOT NULL))
);
CREATE UNIQUE INDEX vendas_uma_por_pedido ON public.vendas (pedido_id) WHERE pedido_id IS NOT NULL;
CREATE INDEX vendas_lista ON public.vendas (empresa_id, estado, confirmada_em DESC);
CREATE INDEX vendas_cliente ON public.vendas (empresa_id, cliente_empresa_id);
ALTER TABLE public.pedidos ADD FOREIGN KEY (empresa_id, venda_id) REFERENCES public.vendas (empresa_id, id);

CREATE TABLE public.venda_itens (
  venda_id             uuid NOT NULL,
  empresa_id           uuid NOT NULL,
  variacao_id          uuid NOT NULL,
  quantidade           integer NOT NULL CHECK (quantidade BETWEEN 1 AND 100000),
  preco_unitario       numeric(14,2) NOT NULL CHECK (preco_unitario > 0),
  desconto             numeric(14,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
  valor                numeric(14,2) GENERATED ALWAYS AS (quantidade * preco_unitario - desconto) STORED,
  nome_snapshot        text NOT NULL,
  rotulo_snapshot      text NOT NULL,
  sob_encomenda        boolean NOT NULL DEFAULT false,
  custo_unitario       numeric(14,2),     -- último custo informado no momento da venda; sem GRANT
  entrega              text CHECK (entrega IN ('entregue', 'pendente', 'cancelada')),
  entregue_em          timestamptz,
  destino_cancelamento text CHECK (destino_cancelamento IN ('voltou', 'nao_voltou', 'danificado', 'nao_entregue')),
  PRIMARY KEY (venda_id, variacao_id),
  FOREIGN KEY (empresa_id, venda_id) REFERENCES public.vendas (empresa_id, id),
  FOREIGN KEY (empresa_id, variacao_id) REFERENCES public.produto_variacoes (empresa_id, id),
  CONSTRAINT venda_itens_valor_positivo CHECK (quantidade * preco_unitario - desconto >= 0)
);

CREATE TABLE public.eventos_comerciais (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas (id),
  tipo          text NOT NULL,
  ator          text NOT NULL,
  alvo_tipo     text NOT NULL CHECK (alvo_tipo IN ('cliente', 'venda', 'pedido', 'titulo', 'recebimento', 'perfil')),
  alvo_id       uuid,
  detalhes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  operation_key text,
  criado_em     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX eventos_comerciais_alvo ON public.eventos_comerciais (empresa_id, alvo_tipo, alvo_id, criado_em);
CREATE TRIGGER eventos_comerciais_somente_insercao BEFORE UPDATE OR DELETE ON public.eventos_comerciais
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

CREATE TABLE public.contas_financeiras (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  nome       text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 80),
  tipo       text NOT NULL DEFAULT 'caixa' CHECK (tipo IN ('caixa')),     -- o M07 amplia
  padrao     boolean NOT NULL DEFAULT false,
  ativa      boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id)
);
CREATE UNIQUE INDEX contas_uma_padrao ON public.contas_financeiras (empresa_id) WHERE padrao;

CREATE TABLE public.titulos_financeiros (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES public.empresas (id),
  tipo             text NOT NULL DEFAULT 'receber' CHECK (tipo IN ('receber')),
  origem_tipo      text NOT NULL CHECK (origem_tipo IN ('venda')),
  origem_id        uuid NOT NULL,
  descricao        text NOT NULL,
  total            numeric(14,2) NOT NULL CHECK (total >= 0),
  recebido         numeric(14,2) NOT NULL DEFAULT 0 CHECK (recebido >= 0),
  a_devolver       numeric(14,2) NOT NULL DEFAULT 0 CHECK (a_devolver >= 0),
  estado           text NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto', 'parcial', 'liquidado', 'cancelado')),
  versao           integer NOT NULL DEFAULT 1,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  cancelado_em     timestamptz,
  UNIQUE (empresa_id, id),
  UNIQUE (empresa_id, origem_tipo, origem_id),
  CONSTRAINT titulos_recebido_ate_total CHECK (recebido <= total)
);

CREATE TABLE public.parcelas_financeiras (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  titulo_id  uuid NOT NULL,
  sequencia  integer NOT NULL CHECK (sequencia BETWEEN 1 AND 24),
  valor      numeric(14,2) NOT NULL CHECK (valor > 0),
  vencimento date NOT NULL,
  saldo      numeric(14,2) NOT NULL CHECK (saldo >= 0),
  estado     text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'parcial', 'liquidada', 'cancelada')),
  versao     integer NOT NULL DEFAULT 1,
  UNIQUE (empresa_id, id),
  UNIQUE (titulo_id, sequencia),
  FOREIGN KEY (empresa_id, titulo_id) REFERENCES public.titulos_financeiros (empresa_id, id),
  CONSTRAINT parcelas_saldo_ate_valor CHECK (saldo <= valor)
);
CREATE INDEX parcelas_vencimento ON public.parcelas_financeiras (empresa_id, estado, vencimento);

CREATE TABLE public.recebimentos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  titulo_id     uuid NOT NULL,
  parcela_id    uuid,
  conta_id      uuid NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('recebimento', 'estorno', 'devolucao')),
  valor         numeric(14,2) NOT NULL CHECK (valor > 0),
  forma         text NOT NULL CHECK (forma IN ('dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia', 'outro')),
  data          date NOT NULL,
  motivo        text CHECK (char_length(motivo) <= 300),
  estorno_de    uuid UNIQUE REFERENCES public.recebimentos (id),
  autor         text NOT NULL,
  operation_key text,
  criado_em     timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, titulo_id) REFERENCES public.titulos_financeiros (empresa_id, id),
  FOREIGN KEY (empresa_id, parcela_id) REFERENCES public.parcelas_financeiras (empresa_id, id),
  FOREIGN KEY (empresa_id, conta_id) REFERENCES public.contas_financeiras (empresa_id, id),
  CONSTRAINT recebimentos_parcela_coerente CHECK ((tipo = 'devolucao') = (parcela_id IS NULL))
);
CREATE INDEX recebimentos_titulo ON public.recebimentos (empresa_id, titulo_id, criado_em);
CREATE TRIGGER recebimentos_somente_insercao BEFORE UPDATE OR DELETE ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- Itens de venda só mudam enquanto a venda é rascunho, exceto os campos de entrega e de cancelamento.
CREATE FUNCTION app_private.proteger_itens_venda() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM public.vendas WHERE id = coalesce(OLD.venda_id, NEW.venda_id);
  IF v_estado = 'rascunho' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.quantidade, NEW.preco_unitario, NEW.desconto, NEW.variacao_id, NEW.custo_unitario)
       IS NOT DISTINCT FROM (OLD.quantidade, OLD.preco_unitario, OLD.desconto, OLD.variacao_id, OLD.custo_unitario) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Itens de venda confirmada não podem ser alterados ou excluídos.'
    USING ERRCODE = 'insufficient_privilege', HINT = 'FORBIDDEN_ACTION';
END $$;
REVOKE ALL ON FUNCTION app_private.proteger_itens_venda() FROM PUBLIC;
CREATE TRIGGER venda_itens_protegidos BEFORE UPDATE OR DELETE ON public.venda_itens
  FOR EACH ROW EXECUTE FUNCTION app_private.proteger_itens_venda();

-- Venda confirmada ou cancelada nunca é apagada (FIN-I23).
CREATE FUNCTION app_private.proteger_venda() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF OLD.estado <> 'rascunho' THEN
    RAISE EXCEPTION 'Venda confirmada não pode ser excluída.' USING ERRCODE = 'insufficient_privilege', HINT = 'FORBIDDEN_ACTION';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION app_private.proteger_venda() FROM PUBLIC;
CREATE TRIGGER vendas_sem_exclusao BEFORE DELETE ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION app_private.proteger_venda();
CREATE TRIGGER pedidos_sem_exclusao BEFORE DELETE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
CREATE TRIGGER titulos_sem_exclusao BEFORE DELETE ON public.titulos_financeiros
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
CREATE TRIGGER parcelas_sem_exclusao BEFORE DELETE ON public.parcelas_financeiras
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
CREATE TRIGGER clientes_sem_exclusao BEFORE DELETE ON public.clientes_empresa
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- ===========================================================================
-- 3. Auxiliares (privadas)
-- ===========================================================================
CREATE FUNCTION app_private.evento_comercial(p_empresa uuid, p_tipo text, p_ator text, p_alvo_tipo text,
  p_alvo_id uuid, p_detalhes jsonb, p_chave text)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$
  INSERT INTO public.eventos_comerciais (empresa_id, tipo, ator, alvo_tipo, alvo_id, detalhes, operation_key)
  VALUES (p_empresa, p_tipo, p_ator, p_alvo_tipo, p_alvo_id, coalesce(p_detalhes, '{}'::jsonb), p_chave)
$$;

-- Conta "Caixa da empresa" (D6-03), criada na primeira necessidade.
CREATE FUNCTION app_private.conta_caixa(p_empresa uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.contas_financeiras WHERE empresa_id = p_empresa AND padrao;
  IF v_id IS NULL THEN
    INSERT INTO public.contas_financeiras (empresa_id, nome, tipo, padrao) VALUES (p_empresa, 'Caixa da empresa', 'caixa', true)
    ON CONFLICT (empresa_id) WHERE padrao DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.contas_financeiras WHERE empresa_id = p_empresa AND padrao;
    END IF;
  END IF;
  RETURN v_id;
END $$;

-- Variação que pode ser vendida: da empresa, ativa, comercializável e com venda não pausada (D6-07).
CREATE FUNCTION app_private.variacao_vendavel(p_empresa uuid, p_variacao uuid,
  OUT v public.produto_variacoes, OUT p public.produtos)
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  v := app_private.variacao_da_empresa(p_empresa, p_variacao);
  SELECT * INTO p FROM public.produtos WHERE id = v.produto_id;
  IF NOT (v.ativo AND p.ativo) THEN
    PERFORM app_private.erro('STATE_CONFLICT', format('O produto %s está desativado.', p.nome), p_variacao::text);
  END IF;
  IF p.finalidade <> 'comercializavel' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', format('%s é de uso interno e não pode ser vendido.', p.nome), p_variacao::text);
  END IF;
  IF p.venda_pausada THEN
    PERFORM app_private.erro('PRODUCT_PAUSED', format('A venda de %s está pausada.', p.nome), p_variacao::text);
  END IF;
END $$;

-- Lê e valida os itens: [{variacao_id, quantidade, desconto_centavos?}]. Sem repetição; de 1 a 100 itens.
CREATE FUNCTION app_private.ler_itens(p_itens jsonb, p_aceita_desconto boolean)
RETURNS TABLE (variacao_id uuid, quantidade integer, desconto numeric)
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  e jsonb;
  vistos uuid[] := ARRAY[]::uuid[];
  v_var uuid;
BEGIN
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) NOT BETWEEN 1 AND 100 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Inclua de 1 a 100 itens.', 'itens');
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    IF jsonb_typeof(e) <> 'object' THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Item inválido.', 'itens');
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(e) c WHERE c NOT IN ('variacao_id', 'quantidade', 'desconto_centavos')) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Campo não permitido no item: o preço vem do catálogo.', 'itens');   -- D6-05
    END IF;
    BEGIN
      v_var := (e->>'variacao_id')::uuid;
    EXCEPTION WHEN others THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Produto inválido.', 'variacao_id');
    END;
    IF v_var IS NULL THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha o produto.', 'variacao_id');
    END IF;
    IF v_var = ANY (vistos) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'O mesmo produto aparece duas vezes. Junte as quantidades.', 'itens');
    END IF;
    vistos := vistos || v_var;
    variacao_id := v_var;
    quantidade := app_private.quantidade(e->'quantidade', 'quantidade', false);
    IF quantidade > 100000 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Quantidade alta demais.', 'quantidade');
    END IF;
    desconto := coalesce(app_private.centavos(e->'desconto_centavos', 'desconto_centavos', false, 0), 0);
    IF desconto > 0 AND NOT p_aceita_desconto THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Este pedido não aceita desconto por item.', 'desconto_centavos');
    END IF;
    RETURN NEXT;
  END LOOP;
END $$;

-- Limite de desconto (% do subtotal) de quem vende (D6-04): proprietário sem limite (NULL);
-- sem vendas.aplicar_desconto, 0; com a permissão, o limite do perfil (NULL no perfil = 0).
CREATE FUNCTION app_private.limite_desconto(p_empresa uuid, p_usuario text) RETURNS numeric
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN app_private.eh_proprietario_de(p_empresa, p_usuario) THEN NULL
    WHEN NOT app_private.tem(p_empresa, p_usuario, 'vendas.aplicar_desconto') THEN 0
    ELSE coalesce((SELECT pp.desconto_maximo_percentual FROM public.membros_empresa m
                     JOIN public.perfis_permissao pp ON pp.id = m.perfil_permissao_id
                    WHERE m.empresa_id = p_empresa AND m.auth_user_id = p_usuario AND m.estado = 'ativo'), 0)
  END
$$;

-- Grava os itens do rascunho com o preço ATUAL do catálogo (D6-05) e recalcula os totais.
CREATE FUNCTION app_private.gravar_itens_venda(p_venda public.vendas, p_itens jsonb, p_desconto_geral numeric)
RETURNS public.vendas LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  it record;
  vv record;
  v_venda public.vendas;
BEGIN
  DELETE FROM public.venda_itens WHERE venda_id = p_venda.id;
  FOR it IN SELECT * FROM app_private.ler_itens(p_itens, true) LOOP
    SELECT * INTO vv FROM app_private.variacao_vendavel(p_venda.empresa_id, it.variacao_id);
    IF it.desconto > it.quantidade * (vv.v).preco THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'O desconto do item é maior que o valor do item.', 'desconto_centavos');
    END IF;
    INSERT INTO public.venda_itens (venda_id, empresa_id, variacao_id, quantidade, preco_unitario, desconto,
      nome_snapshot, rotulo_snapshot, sob_encomenda)
    VALUES (p_venda.id, p_venda.empresa_id, it.variacao_id, it.quantidade, (vv.v).preco, it.desconto,
      (vv.p).nome, app_private.rotulo_variacao((vv.v).atributos, (vv.v).padrao), (vv.p).sob_encomenda);
  END LOOP;
  UPDATE public.vendas v SET
    subtotal = s.subtotal, desconto_itens = s.descontos, desconto_geral = p_desconto_geral,
    total = s.subtotal - s.descontos - p_desconto_geral, versao = v.versao + 1, atualizado_em = now()
  FROM (SELECT coalesce(sum(quantidade * preco_unitario), 0) AS subtotal, coalesce(sum(desconto), 0) AS descontos
          FROM public.venda_itens WHERE venda_id = p_venda.id) s
  WHERE v.id = p_venda.id RETURNING v.* INTO v_venda;
  IF v_venda.total < 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O desconto é maior que o valor da venda.', 'desconto_geral_centavos');
  END IF;
  RETURN v_venda;
END $$;

-- Confere o limite de desconto de quem confirma (D6-04, FIN-I14). Desconto = itens + geral, em % do subtotal.
CREATE FUNCTION app_private.conferir_desconto(p_venda public.vendas, p_usuario text) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v_limite numeric := app_private.limite_desconto(p_venda.empresa_id, p_usuario);
  v_desconto numeric := p_venda.desconto_itens + p_venda.desconto_geral;
BEGIN
  IF v_desconto = 0 OR v_limite IS NULL THEN
    RETURN;
  END IF;
  IF v_desconto > round(p_venda.subtotal * v_limite / 100, 2) THEN
    PERFORM app_private.erro('DISCOUNT_EXCEEDS_LIMIT',
      format('O desconto passa do seu limite de %s%%. Peça ao proprietário para confirmar.', trim(to_char(v_limite, 'FM990D##'))),
      'desconto');
  END IF;
END $$;

-- Lê a condição de pagamento e cria o título e as parcelas (D6-03, D6-13). A soma das parcelas é o total.
CREATE FUNCTION app_private.criar_titulo_venda(p_venda public.vendas, p_pagamento jsonb) RETURNS uuid
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

-- Recebimento numa parcela, com trava na parcela: duas baixas simultâneas nunca somam além do saldo (FIN-I03).
CREATE FUNCTION app_private.receber_parcela(p_parcela uuid, p_valor numeric, p_forma text, p_data date,
  p_usuario text, p_chave text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  pa public.parcelas_financeiras;
  t public.titulos_financeiros;
  v_rec uuid;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO pa FROM public.parcelas_financeiras WHERE id = p_parcela FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Parcela não encontrada.');
  END IF;
  SELECT * INTO t FROM public.titulos_financeiros WHERE id = pa.titulo_id FOR UPDATE;
  IF t.estado = 'cancelado' OR pa.estado = 'cancelada' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta venda foi cancelada; não recebe mais valores.');
  END IF;
  IF p_forma IS NULL OR p_forma NOT IN ('dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia', 'outro') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha a forma de pagamento.', 'forma');
  END IF;
  IF p_data IS NULL OR p_data > v_hoje OR p_data < v_hoje - 3650 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A data do recebimento não pode estar no futuro.', 'data');
  END IF;
  IF p_valor > pa.saldo THEN
    PERFORM app_private.erro('PAYMENT_EXCEEDS_BALANCE',
      format('O valor é maior que o saldo da parcela (R$ %s).', to_char(pa.saldo, 'FM999G999G990D00')), 'valor_centavos');
  END IF;
  INSERT INTO public.recebimentos (empresa_id, titulo_id, parcela_id, conta_id, tipo, valor, forma, data, autor, operation_key)
  VALUES (pa.empresa_id, t.id, pa.id, app_private.conta_caixa(pa.empresa_id), 'recebimento', p_valor, p_forma, p_data, p_usuario, p_chave)
  RETURNING id INTO v_rec;
  UPDATE public.parcelas_financeiras SET saldo = saldo - p_valor,
    estado = CASE WHEN saldo - p_valor = 0 THEN 'liquidada' ELSE 'parcial' END, versao = versao + 1
   WHERE id = pa.id;
  UPDATE public.titulos_financeiros SET recebido = recebido + p_valor,
    estado = CASE WHEN recebido + p_valor = total THEN 'liquidado' ELSE 'parcial' END, versao = versao + 1
   WHERE id = t.id;
  PERFORM app_private.evento_comercial(pa.empresa_id, 'recebimento_registrado', p_usuario, 'titulo', t.id,
    jsonb_build_object('parcela', pa.sequencia, 'valor_centavos', app_private.para_centavos(p_valor), 'forma', p_forma), p_chave);
  PERFORM app_private.auditar(pa.empresa_id, p_usuario, 'venda.recebimento', 'recebimentos', v_rec,
    jsonb_build_object('valor_centavos', app_private.para_centavos(p_valor), 'forma', p_forma));
  RETURN jsonb_build_object('recebimento_id', v_rec, 'parcela_id', pa.id, 'saldo_parcela_centavos', app_private.para_centavos(pa.saldo - p_valor),
    'saldo_titulo_centavos', app_private.para_centavos(t.total - t.recebido - p_valor));
END $$;

-- Encerra a reserva ativa de UMA variação de uma origem e devolve a quantidade (para a entrega do item).
CREATE FUNCTION app_private.encerrar_reserva_item(p_empresa uuid, p_origem_tipo text, p_origem_id uuid, p_variacao uuid,
  p_estado text, p_motivo text) RETURNS integer
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  r public.reservas_estoque;
BEGIN
  SELECT * INTO r FROM public.reservas_estoque WHERE empresa_id = p_empresa AND origem_tipo = p_origem_tipo
     AND origem_id = p_origem_id AND variacao_id = p_variacao AND estado = 'ativa' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  UPDATE public.saldos_estoque SET reservado = reservado - r.quantidade, versao = versao + 1, atualizado_em = now()
   WHERE variacao_id = p_variacao;
  UPDATE public.reservas_estoque SET estado = p_estado, encerrada_em = now(), motivo_encerramento = p_motivo WHERE id = r.id;
  RETURN r.quantidade;
END $$;

-- Trava os saldos de uma venda em ordem de variação (evita impasse entre confirmações simultâneas).
CREATE FUNCTION app_private.travar_saldos_venda(p_venda uuid) RETURNS void
LANGUAGE sql SET search_path = ''
AS $$
  SELECT 1 FROM public.saldos_estoque s
   WHERE s.variacao_id IN (SELECT variacao_id FROM public.venda_itens WHERE venda_id = p_venda)
   ORDER BY s.variacao_id FOR UPDATE
$$;

-- Confirmação (núcleo): número, preços atuais, desconto, estoque (entrega no ato ou pendente sob encomenda),
-- título, parcelas e recebimento inicial opcional. Tudo na mesma transação (FIN-P5, FIN-I27).
CREATE FUNCTION app_private.confirmar_venda_nucleo(p_venda uuid, p_usuario text, p_pagamento jsonb,
  p_total_esperado bigint, p_chave text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v public.vendas;
  it record;
  s public.saldos_estoque;
  vv record;
  v_numero integer;
  v_titulo uuid;
  v_saidas jsonb := '[]'::jsonb;
  v_pendentes jsonb := '[]'::jsonb;
  v_reserva jsonb;
  v_receb jsonb;
  v_inicial numeric;
  v_parcela uuid;
BEGIN
  IF coalesce(p_pagamento->>'condicao', 'a_vista') NOT IN ('a_vista', 'parcelado') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Condição de pagamento inválida.', 'condicao');
  END IF;
  SELECT * INTO v FROM public.vendas WHERE id = p_venda FOR UPDATE;
  PERFORM app_private.travar_saldos_venda(v.id);
  -- Balcão: preço atual do catálogo (D6-05) e recusa de pausado/desativado (D6-07) no momento da confirmação.
  -- Pedido já aceito: mantém o preço combinado no pedido; a pausa posterior não desfaz o que foi aceito.
  IF v.origem = 'balcao' THEN
    FOR it IN SELECT * FROM public.venda_itens WHERE venda_id = v.id ORDER BY variacao_id LOOP
      SELECT * INTO vv FROM app_private.variacao_vendavel(v.empresa_id, it.variacao_id);
      IF (vv.v).preco <> it.preco_unitario OR (vv.p).sob_encomenda <> it.sob_encomenda THEN
        UPDATE public.venda_itens SET preco_unitario = (vv.v).preco, sob_encomenda = (vv.p).sob_encomenda
         WHERE venda_id = v.id AND variacao_id = it.variacao_id;
      END IF;
    END LOOP;
  END IF;
  IF v.origem = 'balcao' THEN
    UPDATE public.vendas x SET subtotal = q.subtotal, desconto_itens = q.descontos, total = q.subtotal - q.descontos - x.desconto_geral
      FROM (SELECT sum(quantidade * preco_unitario) AS subtotal, sum(desconto) AS descontos FROM public.venda_itens WHERE venda_id = v.id) q
     WHERE x.id = v.id RETURNING x.* INTO v;
  END IF;
  IF v.total < 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O desconto ficou maior que o valor da venda. Revise os itens.', 'desconto');
  END IF;
  IF p_total_esperado IS NOT NULL AND app_private.para_centavos(v.total) <> p_total_esperado THEN
    PERFORM app_private.erro('STATE_CONFLICT',
      format('O total mudou para R$ %s (preço atualizado no catálogo). Revise antes de confirmar.', to_char(v.total, 'FM999G999G990D00')),
      'total');
  END IF;
  IF v.origem = 'balcao' THEN
    PERFORM app_private.conferir_desconto(v, p_usuario);
  END IF;
  -- Estoque: entrega no ato quando há físico disponível; sob encomenda sem físico fica pendente (D6-08).
  FOR it IN SELECT i.*, (SELECT custo_atual FROM public.produto_variacoes WHERE id = i.variacao_id) AS custo
              FROM public.venda_itens i WHERE i.venda_id = v.id ORDER BY i.variacao_id LOOP
    SELECT * INTO s FROM public.saldos_estoque WHERE variacao_id = it.variacao_id;
    IF s.disponivel >= it.quantidade THEN
      v_saidas := v_saidas || jsonb_build_object('variacao_id', it.variacao_id, 'delta', -it.quantidade);
      UPDATE public.venda_itens SET entrega = 'entregue', entregue_em = now(), custo_unitario = it.custo
       WHERE venda_id = v.id AND variacao_id = it.variacao_id;
    ELSIF it.sob_encomenda THEN
      v_pendentes := v_pendentes || jsonb_build_object('variacao_id', it.variacao_id, 'quantidade', it.quantidade);
      UPDATE public.venda_itens SET entrega = 'pendente', custo_unitario = it.custo
       WHERE venda_id = v.id AND variacao_id = it.variacao_id;
    ELSE
      PERFORM app_private.erro('INSUFFICIENT_STOCK',
        format('Estoque insuficiente: há %s disponíveis de %s (%s).', s.disponivel, it.nome_snapshot, it.rotulo_snapshot),
        it.variacao_id::text);
    END IF;
  END LOOP;
  IF jsonb_array_length(v_saidas) > 0 THEN
    PERFORM app_private.aplicar_itens(v.empresa_id, p_usuario, 'saida', v_saidas, format('Venda (entrega no ato)'),
      'venda', v.id, NULL, p_chave);
  END IF;
  IF jsonb_array_length(v_pendentes) > 0 THEN
    -- Sob encomenda: reserva só as unidades que existem; o restante aparece como "a produzir".
    v_reserva := app_private.reservar_estoque(v.empresa_id, p_usuario, 'venda', v.id, v_pendentes, p_chave);
  END IF;
  INSERT INTO app_private.contadores_empresa (empresa_id) VALUES (v.empresa_id) ON CONFLICT (empresa_id) DO NOTHING;
  UPDATE app_private.contadores_empresa SET proxima_venda = proxima_venda + 1 WHERE empresa_id = v.empresa_id
  RETURNING proxima_venda - 1 INTO v_numero;
  UPDATE public.vendas SET estado = 'confirmada', numero = v_numero,
    entrega = CASE WHEN jsonb_array_length(v_pendentes) > 0 THEN 'pendente' ELSE 'entregue' END,
    condicao = coalesce(p_pagamento->>'condicao', 'a_vista'), confirmada_por = p_usuario, confirmada_em = now(),
    versao = versao + 1, atualizado_em = now()
   WHERE id = v.id RETURNING * INTO v;
  v_titulo := app_private.criar_titulo_venda(v, p_pagamento);
  IF p_pagamento ? 'recebimento_inicial' AND jsonb_typeof(p_pagamento->'recebimento_inicial') = 'object' THEN
    IF NOT (app_private.tem(v.empresa_id, p_usuario, 'vendas.registrar_recebimento') OR app_private.tem(v.empresa_id, p_usuario, 'financeiro.aprovar')) THEN
      PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite registrar recebimentos.', 'recebimento_inicial');
    END IF;
    v_inicial := app_private.centavos(p_pagamento->'recebimento_inicial'->'valor_centavos', 'valor_centavos', true, 1);
    SELECT id INTO v_parcela FROM public.parcelas_financeiras WHERE titulo_id = v_titulo ORDER BY sequencia LIMIT 1;
    IF v_parcela IS NULL THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Esta venda não tem valor a receber.', 'recebimento_inicial');
    END IF;
    v_receb := app_private.receber_parcela(v_parcela, v_inicial, p_pagamento->'recebimento_inicial'->>'forma',
      (now() AT TIME ZONE 'America/Sao_Paulo')::date, p_usuario, p_chave);
  END IF;
  PERFORM app_private.evento_comercial(v.empresa_id, 'venda_confirmada', p_usuario, 'venda', v.id,
    jsonb_build_object('numero', v.numero, 'total_centavos', app_private.para_centavos(v.total), 'origem', v.origem,
      'pendentes', jsonb_array_length(v_pendentes)), p_chave);
  PERFORM app_private.auditar(v.empresa_id, p_usuario, 'venda.confirmada', 'vendas', v.id,
    jsonb_build_object('numero', v.numero, 'total_centavos', app_private.para_centavos(v.total),
      'desconto_centavos', app_private.para_centavos(v.desconto_itens + v.desconto_geral)));
  RETURN jsonb_build_object('id', v.id, 'numero', v.numero, 'estado', v.estado, 'entrega', v.entrega,
    'total_centavos', app_private.para_centavos(v.total), 'titulo_id', v_titulo, 'reserva', v_reserva, 'recebimento', v_receb,
    'versao', v.versao);
END $$;

-- ===========================================================================
-- 4. Clientes da empresa (RF-033 a RF-038; D6-10, D6-11)
-- ===========================================================================
CREATE FUNCTION app_private.validar_cliente(p_atual public.clientes_empresa, p_dados jsonb) RETURNS public.clientes_empresa
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

CREATE FUNCTION public.criar_cliente(p_empresa_id uuid, p_dados jsonb, p_operation_key text)
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

CREATE FUNCTION public.alterar_cliente(p_cliente_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text)
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

CREATE FUNCTION public.definir_cliente_ativo(p_cliente_id uuid, p_ativo boolean, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_cliente_id, p_ativo, p_expected_version));
  anterior jsonb;
  c public.clientes_empresa;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_cliente_ativo', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.clientes_empresa WHERE id = p_cliente_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Cliente não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['clientes.alterar']);
  IF c.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este cliente foi alterado por outra pessoa. Atualize antes de continuar.');
  END IF;
  IF p_ativo IS NULL OR p_ativo = c.ativo THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN c.ativo THEN 'O cliente já está ativo.' ELSE 'O cliente já está desativado.' END);
  END IF;
  UPDATE public.clientes_empresa SET ativo = p_ativo, versao = versao + 1, atualizado_em = now() WHERE id = c.id;
  PERFORM app_private.evento_comercial(c.empresa_id, CASE WHEN p_ativo THEN 'cliente_reativado' ELSE 'cliente_desativado' END,
    usuario, 'cliente', c.id, '{}'::jsonb, p_operation_key);
  RETURN app_private.idem_fim(usuario, 'definir_cliente_ativo', p_operation_key, assinatura,
    jsonb_build_object('id', c.id, 'ativo', p_ativo, 'versao', c.versao + 1));
END $$;

CREATE FUNCTION public.clientes_da_empresa(p_empresa_id uuid, p_busca text DEFAULT NULL, p_limite integer DEFAULT 50,
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

CREATE FUNCTION public.historico_do_cliente(p_cliente_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  c public.clientes_empresa;
BEGIN
  SELECT * INTO c FROM public.clientes_empresa WHERE id = p_cliente_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Cliente não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['clientes.visualizar', 'vendas.visualizar']);
  RETURN jsonb_build_object('cliente', jsonb_build_object('id', c.id, 'nome', c.nome),
    'vendas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'numero', v.numero, 'estado', v.estado, 'entrega', v.entrega,
        'origem', v.origem, 'total_centavos', app_private.para_centavos(v.total), 'confirmada_em', v.confirmada_em)
        ORDER BY v.confirmada_em DESC NULLS LAST) FROM public.vendas v WHERE v.cliente_empresa_id = c.id AND v.estado <> 'rascunho'), '[]'::jsonb),
    'pedidos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'estado', p.estado,
        'total_centavos', app_private.para_centavos(p.total_estimado), 'criado_em', p.criado_em) ORDER BY p.criado_em DESC)
        FROM public.pedidos p WHERE p.cliente_empresa_id = c.id), '[]'::jsonb));
END $$;

-- ===========================================================================
-- 5. Limite de desconto por perfil (D6-04): só o proprietário define
-- ===========================================================================
CREATE FUNCTION public.definir_desconto_maximo(p_perfil_id uuid, p_percentual numeric, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_perfil_id, p_percentual, p_expected_version));
  anterior jsonb;
  pf public.perfis_permissao;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_desconto_maximo', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO pf FROM public.perfis_permissao WHERE id = p_perfil_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Perfil não encontrado.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = pf.empresa_id AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  IF NOT app_private.eh_proprietario_de(pf.empresa_id, usuario) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só o proprietário define o limite de desconto.');
  END IF;
  IF pf.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este perfil foi alterado por outra pessoa. Atualize antes de continuar.');
  END IF;
  IF p_percentual IS NOT NULL AND (p_percentual < 0 OR p_percentual > 100 OR p_percentual <> round(p_percentual, 2)) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Use um percentual de 0 a 100, com até duas casas.', 'percentual');
  END IF;
  UPDATE public.perfis_permissao SET desconto_maximo_percentual = p_percentual, versao = versao + 1, atualizado_em = now()
   WHERE id = pf.id;
  PERFORM app_private.evento_comercial(pf.empresa_id, 'limite_desconto_definido', usuario, 'perfil', pf.id,
    jsonb_build_object('anterior', pf.desconto_maximo_percentual, 'novo', p_percentual), p_operation_key);
  PERFORM app_private.auditar(pf.empresa_id, usuario, 'perfil.limite_desconto', 'perfis_permissao', pf.id,
    jsonb_build_object('anterior', pf.desconto_maximo_percentual, 'novo', p_percentual));
  RETURN app_private.idem_fim(usuario, 'definir_desconto_maximo', p_operation_key, assinatura,
    jsonb_build_object('id', pf.id, 'desconto_maximo_percentual', p_percentual, 'versao', pf.versao + 1));
END $$;

CREATE FUNCTION public.meu_limite_desconto(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = p_empresa_id AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  RETURN jsonb_build_object('percentual', app_private.limite_desconto(p_empresa_id, usuario),
    'sem_limite', app_private.limite_desconto(p_empresa_id, usuario) IS NULL);
END $$;

-- ===========================================================================
-- 6. Vendas de balcão (RF-067 a RF-074; D6-02, D6-05, D6-06, D6-07, D6-08)
-- ===========================================================================
CREATE FUNCTION app_private.dados_venda(p_empresa uuid, p_dados jsonb, OUT cliente uuid, OUT cliente_nome text,
  OUT desconto_geral numeric, OUT observacao text)
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  k text;
BEGIN
  IF p_dados IS NULL THEN p_dados := '{}'::jsonb; END IF;
  IF jsonb_typeof(p_dados) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Dados da venda inválidos.');
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_dados) LOOP
    IF k NOT IN ('cliente_empresa_id', 'desconto_geral_centavos', 'observacao') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Campo não permitido: ' || k, k);   -- preço e total vêm do banco
    END IF;
  END LOOP;
  cliente := nullif(p_dados->>'cliente_empresa_id', '')::uuid;
  IF cliente IS NOT NULL THEN
    SELECT c.nome INTO cliente_nome FROM public.clientes_empresa c WHERE c.id = cliente AND c.empresa_id = p_empresa AND c.ativo;
    IF NOT FOUND THEN
      PERFORM app_private.erro('NOT_FOUND', 'Cliente não encontrado nesta empresa.', 'cliente_empresa_id');
    END IF;
  END IF;
  desconto_geral := coalesce(app_private.centavos(p_dados->'desconto_geral_centavos', 'desconto_geral_centavos', false, 0), 0);
  observacao := nullif(btrim(coalesce(p_dados->>'observacao', '')), '');
  IF char_length(observacao) > 500 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A observação pode ter até 500 caracteres.', 'observacao');
  END IF;
END $$;

CREATE FUNCTION app_private.resumo_venda(p_venda uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', v.id, 'numero', v.numero, 'estado', v.estado, 'entrega', v.entrega, 'versao', v.versao,
    'subtotal_centavos', app_private.para_centavos(v.subtotal), 'desconto_itens_centavos', app_private.para_centavos(v.desconto_itens),
    'desconto_geral_centavos', app_private.para_centavos(v.desconto_geral), 'total_centavos', app_private.para_centavos(v.total))
  FROM public.vendas v WHERE v.id = p_venda
$$;

CREATE FUNCTION app_private.criar_rascunho(p_empresa uuid, p_usuario text, p_dados jsonb, p_itens jsonb) RETURNS public.vendas
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  d record;
  v public.vendas;
BEGIN
  SELECT * INTO d FROM app_private.dados_venda(p_empresa, p_dados);
  INSERT INTO public.vendas (empresa_id, origem, cliente_empresa_id, cliente_nome, observacao, autor)
  VALUES (p_empresa, 'balcao', d.cliente, d.cliente_nome, d.observacao, p_usuario) RETURNING * INTO v;
  v := app_private.gravar_itens_venda(v, p_itens, d.desconto_geral);
  IF v.desconto_itens + v.desconto_geral > 0 AND NOT app_private.tem(p_empresa, p_usuario, 'vendas.aplicar_desconto') THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite dar desconto.', 'desconto');
  END IF;
  PERFORM app_private.conferir_desconto(v, p_usuario);
  RETURN v;
END $$;

CREATE FUNCTION public.criar_venda(p_empresa_id uuid, p_dados jsonb, p_itens jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text, p_itens::text));
  anterior jsonb;
  v public.vendas;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_venda', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['vendas.criar']);
  v := app_private.criar_rascunho(p_empresa_id, usuario, p_dados, p_itens);
  PERFORM app_private.evento_comercial(p_empresa_id, 'venda_rascunho_criado', usuario, 'venda', v.id,
    jsonb_build_object('itens', jsonb_array_length(p_itens)), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'criar_venda', p_operation_key, assinatura, app_private.resumo_venda(v.id));
END $$;

CREATE FUNCTION public.alterar_venda(p_venda_id uuid, p_dados jsonb, p_itens jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_venda_id, p_dados::text, p_itens::text, p_expected_version));
  anterior jsonb;
  v public.vendas;
  d record;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_venda', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO v FROM public.vendas WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Venda não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(v.empresa_id, usuario, ARRAY['vendas.criar']);
  IF v.autor <> usuario AND NOT app_private.tem(v.empresa_id, usuario, 'vendas.aprovar') THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só quem criou o rascunho ou quem confirma vendas pode alterá-lo.');
  END IF;
  IF v.estado <> 'rascunho' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só rascunhos podem ser alterados.');
  END IF;
  IF v.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta venda foi alterada por outra pessoa. Atualize antes de continuar.');
  END IF;
  SELECT * INTO d FROM app_private.dados_venda(v.empresa_id, p_dados);
  UPDATE public.vendas SET cliente_empresa_id = d.cliente, cliente_nome = d.cliente_nome, observacao = d.observacao WHERE id = v.id
  RETURNING * INTO v;
  v := app_private.gravar_itens_venda(v, p_itens, d.desconto_geral);
  IF v.desconto_itens + v.desconto_geral > 0 AND NOT app_private.tem(v.empresa_id, usuario, 'vendas.aplicar_desconto') THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite dar desconto.', 'desconto');
  END IF;
  PERFORM app_private.conferir_desconto(v, usuario);
  PERFORM app_private.evento_comercial(v.empresa_id, 'venda_rascunho_alterado', usuario, 'venda', v.id, '{}'::jsonb, p_operation_key);
  RETURN app_private.idem_fim(usuario, 'alterar_venda', p_operation_key, assinatura, app_private.resumo_venda(v.id));
END $$;

CREATE FUNCTION public.descartar_venda(p_venda_id uuid, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_venda_id, p_expected_version));
  anterior jsonb;
  v public.vendas;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'descartar_venda', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO v FROM public.vendas WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Venda não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(v.empresa_id, usuario, ARRAY['vendas.criar']);
  IF v.autor <> usuario AND NOT app_private.tem(v.empresa_id, usuario, 'vendas.aprovar') THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só quem criou o rascunho ou quem confirma vendas pode descartá-lo.');
  END IF;
  IF v.estado <> 'rascunho' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Venda confirmada não é descartada; use o cancelamento.');
  END IF;
  IF v.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta venda foi alterada por outra pessoa. Atualize antes de continuar.');
  END IF;
  DELETE FROM public.venda_itens WHERE venda_id = v.id;
  DELETE FROM public.vendas WHERE id = v.id;
  PERFORM app_private.evento_comercial(v.empresa_id, 'venda_rascunho_descartado', usuario, 'venda', v.id, '{}'::jsonb, p_operation_key);
  RETURN app_private.idem_fim(usuario, 'descartar_venda', p_operation_key, assinatura, jsonb_build_object('id', v.id, 'descartada', true));
END $$;

CREATE FUNCTION public.confirmar_venda(p_venda_id uuid, p_pagamento jsonb, p_total_esperado_centavos bigint,
  p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_venda_id, p_pagamento::text, p_total_esperado_centavos, p_expected_version));
  anterior jsonb;
  v public.vendas;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'confirmar_venda', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO v FROM public.vendas WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Venda não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(v.empresa_id, usuario, ARRAY['vendas.aprovar']);
  IF v.estado <> 'rascunho' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta venda já foi confirmada ou cancelada.');
  END IF;
  IF v.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta venda mudou desde que você abriu a tela. Atualize antes de confirmar.');
  END IF;
  RETURN app_private.idem_fim(usuario, 'confirmar_venda', p_operation_key, assinatura,
    app_private.confirmar_venda_nucleo(v.id, usuario, coalesce(p_pagamento, '{}'::jsonb), p_total_esperado_centavos, p_operation_key));
END $$;

CREATE FUNCTION public.registrar_venda_direta(p_empresa_id uuid, p_dados jsonb, p_itens jsonb, p_pagamento jsonb,
  p_total_esperado_centavos bigint, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text, p_itens::text, p_pagamento::text, p_total_esperado_centavos));
  anterior jsonb;
  v public.vendas;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_venda_direta', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['vendas.criar', 'vendas.aprovar']);
  v := app_private.criar_rascunho(p_empresa_id, usuario, p_dados, p_itens);
  RETURN app_private.idem_fim(usuario, 'registrar_venda_direta', p_operation_key, assinatura,
    app_private.confirmar_venda_nucleo(v.id, usuario, coalesce(p_pagamento, '{}'::jsonb), p_total_esperado_centavos, p_operation_key));
END $$;

-- Entrega efetiva dos itens pendentes (D6-08): consome a reserva e baixa o físico SÓ com unidades reais.
CREATE FUNCTION public.registrar_entrega(p_venda_id uuid, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_venda_id, p_expected_version));
  anterior jsonb;
  v public.vendas;
  it record;
  v_saidas jsonb := '[]'::jsonb;
  v_itens integer := 0;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_entrega', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO v FROM public.vendas WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Venda não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(v.empresa_id, usuario, ARRAY['vendas.aprovar']);
  IF v.estado <> 'confirmada' OR v.entrega <> 'pendente' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta venda não tem entrega pendente.');
  END IF;
  IF v.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta venda mudou desde que você abriu a tela. Atualize antes de continuar.');
  END IF;
  PERFORM app_private.travar_saldos_venda(v.id);
  FOR it IN SELECT * FROM public.venda_itens WHERE venda_id = v.id AND entrega = 'pendente' ORDER BY variacao_id LOOP
    PERFORM app_private.encerrar_reserva_item(v.empresa_id, 'venda', v.id, it.variacao_id, 'consumida', NULL);
    v_saidas := v_saidas || jsonb_build_object('variacao_id', it.variacao_id, 'delta', -it.quantidade);
    UPDATE public.venda_itens SET entrega = 'entregue', entregue_em = now() WHERE venda_id = v.id AND variacao_id = it.variacao_id;
    v_itens := v_itens + 1;
  END LOOP;
  -- aplicar_itens recusa (INSUFFICIENT_STOCK) se não houver unidades reais: nada de entrega fictícia.
  PERFORM app_private.aplicar_itens(v.empresa_id, usuario, 'saida', v_saidas, 'Entrega de venda sob encomenda', 'venda', v.id, NULL, p_operation_key);
  UPDATE public.vendas SET entrega = 'entregue', versao = versao + 1, atualizado_em = now() WHERE id = v.id RETURNING * INTO v;
  PERFORM app_private.evento_comercial(v.empresa_id, 'venda_entregue', usuario, 'venda', v.id, jsonb_build_object('itens', v_itens), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'registrar_entrega', p_operation_key, assinatura,
    jsonb_build_object('id', v.id, 'entrega', v.entrega, 'itens_entregues', v_itens, 'versao', v.versao));
END $$;

-- Cancelamento total (D6-09): por item entregue, "voltou" (entrada de devolução), "nao_voltou" ou "danificado"
-- (não volta como vendável). Itens pendentes liberam a reserva. Valores recebidos ficam "a devolver".
CREATE FUNCTION public.cancelar_venda(p_venda_id uuid, p_motivo text, p_destinos jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_venda_id, p_motivo, p_destinos::text, p_expected_version));
  anterior jsonb;
  v public.vendas;
  it record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_destino text;
  v_entradas jsonb := '[]'::jsonb;
  t public.titulos_financeiros;
  v_liquido numeric;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'cancelar_venda', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO v FROM public.vendas WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Venda não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(v.empresa_id, usuario, ARRAY['vendas.cancelar']);
  IF v.estado <> 'confirmada' THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN v.estado = 'cancelada' THEN 'Esta venda já foi cancelada.'
      ELSE 'Rascunho não é cancelado; descarte o rascunho.' END);
  END IF;
  IF v.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta venda mudou desde que você abriu a tela. Atualize antes de cancelar.');
  END IF;
  IF v_motivo IS NULL OR char_length(v_motivo) NOT BETWEEN 10 AND 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique o cancelamento (10 a 300 caracteres).', 'motivo');
  END IF;
  IF p_destinos IS NOT NULL AND jsonb_typeof(p_destinos) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o destino de cada item.', 'destinos');
  END IF;
  PERFORM app_private.travar_saldos_venda(v.id);
  FOR it IN SELECT * FROM public.venda_itens WHERE venda_id = v.id ORDER BY variacao_id LOOP
    IF it.entrega = 'pendente' THEN
      PERFORM app_private.encerrar_reserva_item(v.empresa_id, 'venda', v.id, it.variacao_id, 'liberada', 'Venda cancelada');
      UPDATE public.venda_itens SET entrega = 'cancelada', destino_cancelamento = 'nao_entregue' WHERE venda_id = v.id AND variacao_id = it.variacao_id;
      CONTINUE;
    END IF;
    v_destino := p_destinos->>(it.variacao_id::text);
    IF v_destino IS NULL OR v_destino NOT IN ('voltou', 'nao_voltou', 'danificado') THEN
      PERFORM app_private.erro('VALIDATION_ERROR',
        format('Diga se %s (%s) voltou, não voltou ou voltou danificado.', it.nome_snapshot, it.rotulo_snapshot), it.variacao_id::text);
    END IF;
    IF v_destino = 'voltou' THEN
      v_entradas := v_entradas || jsonb_build_object('variacao_id', it.variacao_id, 'delta', it.quantidade);
    END IF;
    UPDATE public.venda_itens SET destino_cancelamento = v_destino WHERE venda_id = v.id AND variacao_id = it.variacao_id;
  END LOOP;
  IF jsonb_array_length(v_entradas) > 0 THEN
    PERFORM app_private.aplicar_itens(v.empresa_id, usuario, 'entrada', v_entradas, 'Devolução de venda cancelada', 'devolucao_venda', v.id, NULL, p_operation_key);
  END IF;
  SELECT * INTO t FROM public.titulos_financeiros WHERE empresa_id = v.empresa_id AND origem_tipo = 'venda' AND origem_id = v.id FOR UPDATE;
  IF FOUND THEN
    UPDATE public.parcelas_financeiras SET estado = 'cancelada', versao = versao + 1 WHERE titulo_id = t.id;
    v_liquido := t.recebido;
    UPDATE public.titulos_financeiros SET estado = 'cancelado', a_devolver = v_liquido, cancelado_em = now(), versao = versao + 1 WHERE id = t.id;
  END IF;
  UPDATE public.vendas SET estado = 'cancelada', entrega = CASE WHEN entrega = 'pendente' THEN 'cancelada' ELSE entrega END,
    cancelada_por = usuario, cancelada_em = now(), motivo_cancelamento = v_motivo, versao = versao + 1, atualizado_em = now()
   WHERE id = v.id RETURNING * INTO v;
  IF v.pedido_id IS NOT NULL THEN
    UPDATE public.pedidos SET estado = 'cancelado', motivo_decisao = v_motivo, versao = versao + 1 WHERE id = v.pedido_id;
  END IF;
  PERFORM app_private.evento_comercial(v.empresa_id, 'venda_cancelada', usuario, 'venda', v.id,
    jsonb_build_object('motivo', v_motivo, 'devolvidos', jsonb_array_length(v_entradas),
      'a_devolver_centavos', app_private.para_centavos(coalesce(v_liquido, 0))), p_operation_key);
  PERFORM app_private.auditar(v.empresa_id, usuario, 'venda.cancelada', 'vendas', v.id,
    jsonb_build_object('numero', v.numero, 'a_devolver_centavos', app_private.para_centavos(coalesce(v_liquido, 0))));
  RETURN app_private.idem_fim(usuario, 'cancelar_venda', p_operation_key, assinatura,
    jsonb_build_object('id', v.id, 'estado', v.estado, 'a_devolver_centavos', app_private.para_centavos(coalesce(v_liquido, 0)), 'versao', v.versao));
END $$;

-- ===========================================================================
-- 7. Recebimentos (RF-075 a RF-078; D6-03, D6-14, D6-17)
-- ===========================================================================
CREATE FUNCTION public.registrar_recebimento(p_parcela_id uuid, p_valor_centavos bigint, p_forma text, p_data date, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_parcela_id, p_valor_centavos, p_forma, p_data));
  anterior jsonb;
  v_empresa uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_recebimento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT empresa_id INTO v_empresa FROM public.parcelas_financeiras WHERE id = p_parcela_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Parcela não encontrada.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = v_empresa AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  IF NOT (app_private.tem(v_empresa, usuario, 'vendas.registrar_recebimento') OR app_private.tem(v_empresa, usuario, 'financeiro.aprovar')) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite registrar recebimentos.');
  END IF;
  IF p_valor_centavos IS NULL OR p_valor_centavos <= 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um valor maior que zero.', 'valor_centavos');
  END IF;
  RETURN app_private.idem_fim(usuario, 'registrar_recebimento', p_operation_key, assinatura,
    app_private.receber_parcela(p_parcela_id, round(p_valor_centavos::numeric / 100, 2), p_forma,
      coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date), usuario, p_operation_key));
END $$;

CREATE FUNCTION public.estornar_recebimento(p_recebimento_id uuid, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_recebimento_id, p_motivo));
  anterior jsonb;
  r public.recebimentos;
  pa public.parcelas_financeiras;
  t public.titulos_financeiros;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_id uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'estornar_recebimento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO r FROM public.recebimentos WHERE id = p_recebimento_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Recebimento não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(r.empresa_id, usuario, ARRAY['financeiro.cancelar']);
  SELECT * INTO pa FROM public.parcelas_financeiras WHERE id = r.parcela_id FOR UPDATE;
  SELECT * INTO t FROM public.titulos_financeiros WHERE id = r.titulo_id FOR UPDATE;
  IF r.tipo <> 'recebimento' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só recebimentos podem ser estornados.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.recebimentos WHERE estorno_de = r.id) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este recebimento já foi estornado.');
  END IF;
  IF t.estado = 'cancelado' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A venda foi cancelada; registre a devolução do valor ao cliente.');
  END IF;
  IF v_motivo IS NULL OR char_length(v_motivo) NOT BETWEEN 10 AND 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique o estorno (10 a 300 caracteres).', 'motivo');
  END IF;
  INSERT INTO public.recebimentos (empresa_id, titulo_id, parcela_id, conta_id, tipo, valor, forma, data, motivo, estorno_de, autor, operation_key)
  VALUES (r.empresa_id, r.titulo_id, r.parcela_id, r.conta_id, 'estorno', r.valor, r.forma, (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    v_motivo, r.id, usuario, p_operation_key) RETURNING id INTO v_id;
  UPDATE public.parcelas_financeiras SET saldo = saldo + r.valor, estado = CASE WHEN saldo + r.valor = valor THEN 'aberta' ELSE 'parcial' END,
    versao = versao + 1 WHERE id = pa.id;
  UPDATE public.titulos_financeiros SET recebido = recebido - r.valor, estado = CASE WHEN recebido - r.valor = 0 THEN 'aberto' ELSE 'parcial' END,
    versao = versao + 1 WHERE id = t.id;
  PERFORM app_private.evento_comercial(r.empresa_id, 'recebimento_estornado', usuario, 'titulo', t.id,
    jsonb_build_object('valor_centavos', app_private.para_centavos(r.valor), 'motivo', v_motivo), p_operation_key);
  PERFORM app_private.auditar(r.empresa_id, usuario, 'venda.recebimento_estornado', 'recebimentos', v_id, jsonb_build_object('estorno_de', r.id));
  RETURN app_private.idem_fim(usuario, 'estornar_recebimento', p_operation_key, assinatura, jsonb_build_object('id', v_id, 'estorno_de', r.id));
END $$;

-- Devolução de valor ao cliente depois do cancelamento (D6-09): registro declarado, não comprova banco.
CREATE FUNCTION public.registrar_devolucao_valor(p_titulo_id uuid, p_valor_centavos bigint, p_forma text, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_titulo_id, p_valor_centavos, p_forma, p_motivo));
  anterior jsonb;
  t public.titulos_financeiros;
  v_valor numeric;
  v_id uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_devolucao_valor', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO t FROM public.titulos_financeiros WHERE id = p_titulo_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Registro financeiro não encontrado.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = t.empresa_id AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  IF NOT (app_private.tem(t.empresa_id, usuario, 'vendas.registrar_recebimento') OR app_private.tem(t.empresa_id, usuario, 'financeiro.aprovar')) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite registrar devoluções de valor.');
  END IF;
  IF t.estado <> 'cancelado' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só há devolução de valor em venda cancelada.');
  END IF;
  IF p_valor_centavos IS NULL OR p_valor_centavos <= 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um valor maior que zero.', 'valor_centavos');
  END IF;
  v_valor := round(p_valor_centavos::numeric / 100, 2);
  IF v_valor > t.a_devolver THEN
    PERFORM app_private.erro('PAYMENT_EXCEEDS_BALANCE',
      format('O valor passa do que falta devolver (R$ %s).', to_char(t.a_devolver, 'FM999G999G990D00')), 'valor_centavos');
  END IF;
  IF p_forma IS NULL OR p_forma NOT IN ('dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia', 'outro') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha a forma da devolução.', 'forma');
  END IF;
  INSERT INTO public.recebimentos (empresa_id, titulo_id, parcela_id, conta_id, tipo, valor, forma, data, motivo, autor, operation_key)
  VALUES (t.empresa_id, t.id, NULL, app_private.conta_caixa(t.empresa_id), 'devolucao', v_valor, p_forma,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date, nullif(btrim(coalesce(p_motivo, '')), ''), usuario, p_operation_key) RETURNING id INTO v_id;
  UPDATE public.titulos_financeiros SET a_devolver = a_devolver - v_valor, versao = versao + 1 WHERE id = t.id;
  PERFORM app_private.evento_comercial(t.empresa_id, 'valor_devolvido', usuario, 'titulo', t.id,
    jsonb_build_object('valor_centavos', p_valor_centavos, 'forma', p_forma), p_operation_key);
  PERFORM app_private.auditar(t.empresa_id, usuario, 'venda.valor_devolvido', 'recebimentos', v_id, jsonb_build_object('valor_centavos', p_valor_centavos));
  RETURN app_private.idem_fim(usuario, 'registrar_devolucao_valor', p_operation_key, assinatura,
    jsonb_build_object('id', v_id, 'a_devolver_centavos', app_private.para_centavos(t.a_devolver - v_valor)));
END $$;

-- ===========================================================================
-- 8. Pedidos externos (RF-068, RF-069; D6-01, D6-06, D6-07, D6-11)
-- ===========================================================================
-- Empresa que pode receber pedido desta conta: vitrine publicada; empresa de teste só recebe de conta fictícia
-- (@autonick-teste.example) e conta fictícia só pede em empresa de teste (REGRAS_DADOS_FICTICIOS).
CREATE FUNCTION app_private.empresa_recebe_pedido(p_empresa uuid, p_usuario text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.empresas e
                  WHERE e.id = p_empresa AND e.situacao_vitrine = 'publicada' AND e.situacao_erp = 'ativa'
                    AND e.dado_de_teste = coalesce(app_private.email_da_pessoa(p_usuario) LIKE '%@autonick-teste.example', false))
$$;

CREATE FUNCTION app_private.exigir_perfil_cliente(p_usuario text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v_nome text;
BEGIN
  SELECT nome INTO v_nome FROM public.perfis_identidade WHERE auth_user_id = p_usuario AND tipo_conta = 'cliente';
  IF v_nome IS NULL THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Crie seu perfil de cliente para fazer pedidos.');
  END IF;
  RETURN v_nome;
END $$;

CREATE FUNCTION app_private.resumo_pedido(p_pedido uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', p.id, 'estado', p.estado, 'versao', p.versao,
    'total_centavos', app_private.para_centavos(p.total_estimado), 'venda_id', p.venda_id)
  FROM public.pedidos p WHERE p.id = p_pedido
$$;

CREATE FUNCTION public.empresas_para_pedido() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'nome', coalesce(e.dados_publicados->>'nome_publico', e.nome_publico),
      'cidade', coalesce(e.dados_publicados->>'cidade', e.cidade), 'dado_de_teste', e.dado_de_teste) ORDER BY lower(e.nome_publico))
    FROM public.empresas e WHERE app_private.empresa_recebe_pedido(e.id, usuario)), '[]'::jsonb);
END $$;

-- Itens que o cliente pode pedir: só comercializáveis, ativos e não pausados. Nunca estoque exato nem custo.
CREATE FUNCTION public.itens_para_pedido(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  IF NOT app_private.empresa_recebe_pedido(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Empresa não encontrada.');
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('variacao_id', v.id, 'produto', p.nome,
      'variacao', app_private.rotulo_variacao(v.atributos, v.padrao), 'preco_centavos', app_private.para_centavos(v.preco),
      'sob_encomenda', p.sob_encomenda) ORDER BY lower(p.nome), v.padrao DESC, v.id)
    FROM public.produtos p JOIN public.produto_variacoes v ON v.produto_id = p.id
   WHERE p.empresa_id = p_empresa_id AND p.ativo AND v.ativo AND p.finalidade = 'comercializavel' AND NOT p.venda_pausada), '[]'::jsonb);
END $$;

CREATE FUNCTION public.criar_pedido(p_empresa_id uuid, p_itens jsonb, p_observacao text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_itens::text, p_observacao));
  anterior jsonb;
  v_nome text;
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
  ped public.pedidos;
  it record;
  vv record;
  v_total numeric := 0;
  v_dica text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_pedido', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  v_nome := app_private.exigir_perfil_cliente(usuario);
  IF NOT app_private.empresa_recebe_pedido(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Empresa não encontrada.');
  END IF;
  IF char_length(v_obs) > 500 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A observação pode ter até 500 caracteres.', 'observacao');
  END IF;
  -- Proteção contra excesso: no máximo 5 pedidos aguardando aceite por cliente em cada empresa.
  PERFORM pg_advisory_xact_lock(hashtextextended('pedido|' || p_empresa_id || '|' || usuario, 0));
  IF (SELECT count(*) FROM public.pedidos WHERE empresa_id = p_empresa_id AND cliente_auth_id = usuario AND estado = 'solicitado') >= 5 THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Você já tem 5 pedidos aguardando esta empresa. Aguarde a resposta.');
  END IF;
  INSERT INTO public.pedidos (empresa_id, cliente_auth_id, cliente_nome, observacao_cliente, total_estimado)
  VALUES (p_empresa_id, usuario, v_nome, v_obs, 0.01) RETURNING * INTO ped;   -- total provisório, recalculado abaixo
  FOR it IN SELECT * FROM app_private.ler_itens(p_itens, false) LOOP
    -- Insumo interno, desativado ou de outra empresa: o cliente só ouve "não disponível" (ADR-004, sem revelar nomes).
    BEGIN
      SELECT * INTO vv FROM app_private.variacao_vendavel(p_empresa_id, it.variacao_id);
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_dica = PG_EXCEPTION_HINT;
      IF v_dica = 'PRODUCT_PAUSED' THEN RAISE; END IF;
      PERFORM app_private.erro('NOT_FOUND', 'Um dos produtos não está disponível para pedido.', it.variacao_id::text);
    END;
    INSERT INTO public.pedido_itens (pedido_id, empresa_id, variacao_id, quantidade, preco_unitario, nome_snapshot, rotulo_snapshot)
    VALUES (ped.id, p_empresa_id, it.variacao_id, it.quantidade, (vv.v).preco, (vv.p).nome,
      app_private.rotulo_variacao((vv.v).atributos, (vv.v).padrao));
    v_total := v_total + it.quantidade * (vv.v).preco;
  END LOOP;
  UPDATE public.pedidos SET total_estimado = v_total WHERE id = ped.id;
  PERFORM app_private.evento_comercial(p_empresa_id, 'pedido_criado', usuario, 'pedido', ped.id,
    jsonb_build_object('itens', jsonb_array_length(p_itens), 'total_centavos', app_private.para_centavos(v_total)), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'criar_pedido', p_operation_key, assinatura, app_private.resumo_pedido(ped.id));
END $$;

-- Aceite: reserva tudo ou nada pelo motor do M05 (D6-06). Produto pausado recusa o aceite (D6-07).
CREATE FUNCTION public.aceitar_pedido(p_pedido_id uuid, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_pedido_id, p_expected_version));
  anterior jsonb;
  ped public.pedidos;
  it record;
  vv record;
  v_itens jsonb := '[]'::jsonb;
  v_reserva jsonb;
  v_cliente uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'aceitar_pedido', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO ped FROM public.pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Pedido não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(ped.empresa_id, usuario, ARRAY['pedidos.aprovar']);
  IF ped.estado <> 'solicitado' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este pedido já foi respondido.');
  END IF;
  IF ped.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este pedido mudou desde que você abriu a tela. Atualize antes de continuar.');
  END IF;
  FOR it IN SELECT * FROM public.pedido_itens WHERE pedido_id = ped.id ORDER BY variacao_id LOOP
    SELECT * INTO vv FROM app_private.variacao_vendavel(ped.empresa_id, it.variacao_id);
    v_itens := v_itens || jsonb_build_object('variacao_id', it.variacao_id, 'quantidade', it.quantidade);
  END LOOP;
  v_reserva := app_private.reservar_estoque(ped.empresa_id, usuario, 'pedido', ped.id, v_itens, p_operation_key);
  -- D6-11: o vínculo com a conta pública nasce aqui, pelo pedido aceito; nunca por e-mail ou telefone.
  SELECT id INTO v_cliente FROM public.clientes_empresa WHERE empresa_id = ped.empresa_id AND perfil_cliente_id = ped.cliente_auth_id;
  IF v_cliente IS NULL THEN
    INSERT INTO public.clientes_empresa (empresa_id, nome, perfil_cliente_id, criado_por)
    VALUES (ped.empresa_id, ped.cliente_nome, ped.cliente_auth_id, usuario) RETURNING id INTO v_cliente;
    PERFORM app_private.evento_comercial(ped.empresa_id, 'cliente_criado_por_pedido', usuario, 'cliente', v_cliente,
      jsonb_build_object('pedido_id', ped.id), p_operation_key);
  END IF;
  UPDATE public.pedidos SET estado = 'aceito', cliente_empresa_id = v_cliente, decidido_por = usuario, decidido_em = now(),
    versao = versao + 1 WHERE id = ped.id;
  PERFORM app_private.evento_comercial(ped.empresa_id, 'pedido_aceito', usuario, 'pedido', ped.id,
    jsonb_build_object('reserva', v_reserva->'reservas'), p_operation_key);
  PERFORM app_private.auditar(ped.empresa_id, usuario, 'pedido.aceito', 'pedidos', ped.id, jsonb_build_object('cliente_empresa_id', v_cliente));
  RETURN app_private.idem_fim(usuario, 'aceitar_pedido', p_operation_key, assinatura,
    app_private.resumo_pedido(ped.id) || jsonb_build_object('reservas', v_reserva->'reservas'));
END $$;

CREATE FUNCTION public.recusar_pedido(p_pedido_id uuid, p_motivo text, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_pedido_id, p_motivo, p_expected_version));
  anterior jsonb;
  ped public.pedidos;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'recusar_pedido', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO ped FROM public.pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Pedido não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(ped.empresa_id, usuario, ARRAY['pedidos.aprovar']);
  IF ped.estado <> 'solicitado' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só pedidos aguardando aceite podem ser recusados.');
  END IF;
  IF ped.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este pedido mudou desde que você abriu a tela. Atualize antes de continuar.');
  END IF;
  IF v_motivo IS NULL OR char_length(v_motivo) NOT BETWEEN 10 AND 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique a recusa ao cliente (10 a 300 caracteres).', 'motivo');
  END IF;
  UPDATE public.pedidos SET estado = 'recusado', motivo_decisao = v_motivo, decidido_por = usuario, decidido_em = now(),
    versao = versao + 1 WHERE id = ped.id;
  PERFORM app_private.evento_comercial(ped.empresa_id, 'pedido_recusado', usuario, 'pedido', ped.id,
    jsonb_build_object('motivo', v_motivo), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'recusar_pedido', p_operation_key, assinatura, app_private.resumo_pedido(ped.id));
END $$;

-- Cancelar: o cliente, antes do aceite; a empresa (pedidos.cancelar), depois do aceite. Libera reservas uma vez.
CREATE FUNCTION public.cancelar_pedido(p_pedido_id uuid, p_motivo text, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_pedido_id, p_motivo, p_expected_version));
  anterior jsonb;
  ped public.pedidos;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_liberadas integer := 0;
  v_pelo_cliente boolean;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'cancelar_pedido', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO ped FROM public.pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Pedido não encontrado.');
  END IF;
  v_pelo_cliente := ped.cliente_auth_id = usuario AND NOT app_private.tem(ped.empresa_id, usuario, 'pedidos.cancelar');
  IF v_pelo_cliente THEN
    IF ped.estado <> 'solicitado' THEN
      PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN ped.estado = 'aceito'
        THEN 'A empresa já aceitou o pedido. Fale com ela para cancelar.' ELSE 'Este pedido não pode mais ser cancelado.' END);
    END IF;
  ELSE
    IF ped.cliente_auth_id <> usuario THEN
      PERFORM app_private.exigir_permissoes(ped.empresa_id, usuario, ARRAY['pedidos.cancelar']);
    END IF;
    IF ped.estado <> 'aceito' THEN
      PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN ped.estado = 'solicitado'
        THEN 'Pedido ainda não aceito: use "Recusar".' ELSE 'Este pedido não pode mais ser cancelado.' END);
    END IF;
    IF v_motivo IS NULL OR char_length(v_motivo) NOT BETWEEN 10 AND 300 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Explique o cancelamento ao cliente (10 a 300 caracteres).', 'motivo');
    END IF;
  END IF;
  IF ped.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este pedido mudou desde que você abriu a tela. Atualize antes de continuar.');
  END IF;
  IF char_length(v_motivo) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O motivo pode ter até 300 caracteres.', 'motivo');
  END IF;
  IF ped.estado = 'aceito' THEN
    v_liberadas := app_private.liberar_reservas(ped.empresa_id, usuario, 'pedido', ped.id, coalesce(v_motivo, 'Pedido cancelado'));
  END IF;
  UPDATE public.pedidos SET estado = 'cancelado', motivo_decisao = v_motivo,
    decidido_por = coalesce(decidido_por, usuario), decidido_em = coalesce(decidido_em, now()), versao = versao + 1 WHERE id = ped.id;
  PERFORM app_private.evento_comercial(ped.empresa_id, 'pedido_cancelado', usuario, 'pedido', ped.id,
    jsonb_build_object('motivo', v_motivo, 'pelo_cliente', v_pelo_cliente, 'reservas_liberadas', v_liberadas), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'cancelar_pedido', p_operation_key, assinatura,
    app_private.resumo_pedido(ped.id) || jsonb_build_object('reservas_liberadas', v_liberadas));
END $$;

-- Concluir: o pedido aceito vira venda (origem pedido), com os preços combinados. A reserva do pedido passa para a venda
-- na mesma transação: itens com físico saem no ato; sob encomenda sem físico ficam pendentes de entrega (D6-08).
CREATE FUNCTION public.concluir_pedido(p_pedido_id uuid, p_pagamento jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_pedido_id, p_pagamento::text, p_expected_version));
  anterior jsonb;
  ped public.pedidos;
  v public.vendas;
  v_resultado jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'concluir_pedido', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO ped FROM public.pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Pedido não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(ped.empresa_id, usuario, ARRAY['pedidos.aprovar', 'vendas.aprovar']);
  IF ped.estado <> 'aceito' THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN ped.estado = 'solicitado' THEN 'Aceite o pedido antes de concluir.'
      ELSE 'Este pedido já foi encerrado.' END);
  END IF;
  IF ped.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este pedido mudou desde que você abriu a tela. Atualize antes de continuar.');
  END IF;
  INSERT INTO public.vendas (empresa_id, origem, pedido_id, cliente_empresa_id, cliente_nome, observacao, autor)
  VALUES (ped.empresa_id, 'pedido', ped.id, ped.cliente_empresa_id, ped.cliente_nome, ped.observacao_cliente, usuario) RETURNING * INTO v;
  INSERT INTO public.venda_itens (venda_id, empresa_id, variacao_id, quantidade, preco_unitario, desconto, nome_snapshot, rotulo_snapshot, sob_encomenda)
  SELECT v.id, i.empresa_id, i.variacao_id, i.quantidade, i.preco_unitario, 0, i.nome_snapshot, i.rotulo_snapshot, p.sob_encomenda
    FROM public.pedido_itens i JOIN public.produto_variacoes pv ON pv.id = i.variacao_id JOIN public.produtos p ON p.id = pv.produto_id
   WHERE i.pedido_id = ped.id;
  UPDATE public.vendas SET subtotal = ped.total_estimado, total = ped.total_estimado WHERE id = v.id;
  PERFORM app_private.travar_saldos_venda(v.id);
  PERFORM app_private.liberar_reservas(ped.empresa_id, usuario, 'pedido', ped.id, 'Transferida para a venda do pedido');
  v_resultado := app_private.confirmar_venda_nucleo(v.id, usuario, coalesce(p_pagamento, '{}'::jsonb),
    app_private.para_centavos(ped.total_estimado), p_operation_key);
  UPDATE public.pedidos SET estado = 'concluido', venda_id = v.id, concluido_em = now(), versao = versao + 1 WHERE id = ped.id;
  PERFORM app_private.evento_comercial(ped.empresa_id, 'pedido_concluido', usuario, 'pedido', ped.id,
    jsonb_build_object('venda_id', v.id, 'numero', v_resultado->'numero'), p_operation_key);
  RETURN app_private.idem_fim(usuario, 'concluir_pedido', p_operation_key, assinatura,
    app_private.resumo_pedido(ped.id) || jsonb_build_object('venda', v_resultado));
END $$;

-- ===========================================================================
-- 9. Leituras (RF-081 a RF-083; D6-16)
-- ===========================================================================
CREATE FUNCTION app_private.situacao_pagamento(p_venda uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('titulo_id', t.id, 'estado', t.estado, 'total_centavos', app_private.para_centavos(t.total),
    'recebido_centavos', app_private.para_centavos(t.recebido), 'saldo_centavos', app_private.para_centavos(t.total - t.recebido),
    'a_devolver_centavos', app_private.para_centavos(t.a_devolver))
  FROM public.titulos_financeiros t WHERE t.origem_tipo = 'venda' AND t.origem_id = p_venda
$$;

-- Itens que o vendedor pode pôr na venda. Quantidade disponível só para quem vê estoque.
CREATE FUNCTION public.catalogo_para_venda(p_empresa_id uuid, p_busca text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_busca text := nullif(lower(btrim(coalesce(p_busca, ''))), '');
  v_estoque boolean;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['vendas.criar']);
  v_estoque := app_private.tem(p_empresa_id, usuario, 'estoque.visualizar');
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'produto', x->>'variacao') FROM (
    SELECT jsonb_build_object('variacao_id', v.id, 'produto', p.nome, 'variacao', app_private.rotulo_variacao(v.atributos, v.padrao),
      'sku', v.sku, 'preco_centavos', app_private.para_centavos(v.preco), 'sob_encomenda', p.sob_encomenda,
      'venda_pausada', p.venda_pausada, 'tem_estoque', s.disponivel > 0,
      'disponivel', CASE WHEN v_estoque THEN s.disponivel END) AS x
      FROM public.produtos p JOIN public.produto_variacoes v ON v.produto_id = p.id
      JOIN public.saldos_estoque s ON s.variacao_id = v.id
     WHERE p.empresa_id = p_empresa_id AND p.ativo AND v.ativo AND p.finalidade = 'comercializavel'
       AND (v_busca IS NULL OR lower(p.nome) LIKE '%' || v_busca || '%' OR lower(coalesce(v.sku, '')) LIKE '%' || v_busca || '%')
     LIMIT 200) q), '[]'::jsonb);
END $$;

CREATE FUNCTION public.vendas_da_empresa(p_empresa_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb, p_limite integer DEFAULT 50,
  p_deslocamento integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  f jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_de date;
  v_ate date;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['vendas.visualizar']);
  BEGIN
    v_de := nullif(f->>'de', '')::date;
    v_ate := nullif(f->>'ate', '')::date;
  EXCEPTION WHEN others THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Período inválido.', 'periodo');
  END;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'numero', v.numero, 'estado', v.estado, 'entrega', v.entrega,
      'origem', v.origem, 'cliente', v.cliente_nome, 'total_centavos', app_private.para_centavos(v.total),
      'confirmada_em', v.confirmada_em, 'criado_em', v.criado_em, 'versao', v.versao, 'autor_nome', app_private.nome_da_pessoa(v.autor),
      'pagamento', app_private.situacao_pagamento(v.id)) ORDER BY v.estado = 'rascunho' DESC, v.numero DESC NULLS FIRST, v.criado_em DESC)
    FROM (SELECT * FROM public.vendas v
           WHERE v.empresa_id = p_empresa_id
             AND (f->>'estado' IS NULL OR v.estado = f->>'estado')
             AND (f->>'origem' IS NULL OR v.origem = f->>'origem')
             AND (f->>'entrega' IS NULL OR v.entrega = f->>'entrega')
             AND (f->>'cliente_empresa_id' IS NULL OR v.cliente_empresa_id::text = f->>'cliente_empresa_id')
             AND (f->>'numero' IS NULL OR v.numero::text = f->>'numero')
             AND (v_de IS NULL OR (coalesce(v.confirmada_em, v.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date >= v_de)
             AND (v_ate IS NULL OR (coalesce(v.confirmada_em, v.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date <= v_ate)
           ORDER BY v.estado = 'rascunho' DESC, v.numero DESC NULLS FIRST, v.criado_em DESC
           LIMIT least(greatest(coalesce(p_limite, 50), 1), 100) OFFSET greatest(coalesce(p_deslocamento, 0), 0)) v), '[]'::jsonb);
END $$;

CREATE FUNCTION public.venda_detalhe(p_venda_id uuid) RETURNS jsonb
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

CREATE FUNCTION public.pedidos_da_empresa(p_empresa_id uuid, p_estado text DEFAULT NULL, p_limite integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_estoque boolean;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['pedidos.visualizar']);
  v_estoque := app_private.tem(p_empresa_id, usuario, 'estoque.visualizar');
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'estado', p.estado, 'versao', p.versao, 'cliente', p.cliente_nome,
      'observacao_cliente', p.observacao_cliente, 'motivo', p.motivo_decisao, 'total_centavos', app_private.para_centavos(p.total_estimado),
      'criado_em', p.criado_em, 'decidido_em', p.decidido_em, 'venda_id', p.venda_id,
      'venda_numero', (SELECT numero FROM public.vendas WHERE id = p.venda_id),
      'itens', (SELECT jsonb_agg(jsonb_build_object('variacao_id', i.variacao_id, 'produto', i.nome_snapshot, 'variacao', i.rotulo_snapshot,
          'quantidade', i.quantidade, 'preco_centavos', app_private.para_centavos(i.preco_unitario),
          'sob_encomenda', pr.sob_encomenda, 'venda_pausada', pr.venda_pausada,
          'suficiente', s.disponivel >= i.quantidade, 'disponivel', CASE WHEN v_estoque THEN s.disponivel END,
          'reservado', (SELECT r.quantidade FROM public.reservas_estoque r WHERE r.empresa_id = p.empresa_id AND r.origem_tipo = 'pedido'
                          AND r.origem_id = p.id AND r.variacao_id = i.variacao_id AND r.estado = 'ativa'))
          ORDER BY i.nome_snapshot)
        FROM public.pedido_itens i JOIN public.saldos_estoque s ON s.variacao_id = i.variacao_id
        JOIN public.produto_variacoes pv ON pv.id = i.variacao_id JOIN public.produtos pr ON pr.id = pv.produto_id
       WHERE i.pedido_id = p.id)) ORDER BY p.estado <> 'solicitado', p.criado_em DESC)
    FROM (SELECT * FROM public.pedidos p WHERE p.empresa_id = p_empresa_id AND (p_estado IS NULL OR p.estado = p_estado)
           ORDER BY p.estado <> 'solicitado', p.criado_em DESC LIMIT least(greatest(coalesce(p_limite, 50), 1), 100)) p), '[]'::jsonb);
END $$;

-- O cliente vê só os próprios pedidos e o estado público (sem estoque, custo ou notas internas).
CREATE FUNCTION public.meus_pedidos() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'estado', p.estado, 'versao', p.versao,
      'empresa', coalesce(e.dados_publicados->>'nome_publico', e.nome_publico), 'observacao', p.observacao_cliente,
      'motivo', CASE WHEN p.estado IN ('recusado', 'cancelado') THEN p.motivo_decisao END,
      'total_centavos', app_private.para_centavos(p.total_estimado), 'criado_em', p.criado_em, 'decidido_em', p.decidido_em,
      'entrega', (SELECT v.entrega FROM public.vendas v WHERE v.id = p.venda_id),
      'itens', (SELECT jsonb_agg(jsonb_build_object('produto', i.nome_snapshot, 'variacao', i.rotulo_snapshot, 'quantidade', i.quantidade,
          'preco_centavos', app_private.para_centavos(i.preco_unitario)) ORDER BY i.nome_snapshot)
        FROM public.pedido_itens i WHERE i.pedido_id = p.id)) ORDER BY p.criado_em DESC)
    FROM (SELECT * FROM public.pedidos WHERE cliente_auth_id = usuario ORDER BY criado_em DESC LIMIT 100) p
    JOIN public.empresas e ON e.id = p.empresa_id), '[]'::jsonb);
END $$;

-- Visão única das operações (RF-083): vendas e pedidos com a origem, conforme o que a pessoa pode ver.
CREATE FUNCTION public.operacoes_da_empresa(p_empresa_id uuid, p_limite integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_vendas boolean;
  v_pedidos boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = p_empresa_id AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  v_vendas := app_private.tem(p_empresa_id, usuario, 'vendas.visualizar');
  v_pedidos := app_private.tem(p_empresa_id, usuario, 'pedidos.visualizar');
  IF NOT (v_vendas OR v_pedidos) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite ver vendas nem pedidos.');
  END IF;
  RETURN coalesce((SELECT jsonb_agg(o ORDER BY o->>'quando' DESC) FROM (
    SELECT o FROM (
      SELECT jsonb_build_object('tipo', 'venda', 'id', v.id, 'numero', v.numero, 'origem', v.origem, 'estado', v.estado,
        'cliente', v.cliente_nome, 'total_centavos', app_private.para_centavos(v.total),
        'quando', coalesce(v.confirmada_em, v.criado_em)) AS o
        FROM public.vendas v WHERE v_vendas AND v.empresa_id = p_empresa_id AND v.estado <> 'rascunho'
      UNION ALL
      SELECT jsonb_build_object('tipo', 'pedido', 'id', p.id, 'numero', NULL, 'origem', 'externo', 'estado', p.estado,
        'cliente', p.cliente_nome, 'total_centavos', app_private.para_centavos(p.total_estimado), 'quando', p.criado_em,
        'venda_id', p.venda_id)
        FROM public.pedidos p WHERE v_pedidos AND p.empresa_id = p_empresa_id) u
    ORDER BY o->>'quando' DESC LIMIT least(greatest(coalesce(p_limite, 50), 1), 200)) q), '[]'::jsonb);
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
    'public.criar_cliente(uuid, jsonb, text)',
    'public.alterar_cliente(uuid, jsonb, integer, text)',
    'public.definir_cliente_ativo(uuid, boolean, integer, text)',
    'public.clientes_da_empresa(uuid, text, integer, integer)',
    'public.historico_do_cliente(uuid)',
    'public.definir_desconto_maximo(uuid, numeric, integer, text)',
    'public.meu_limite_desconto(uuid)',
    'public.criar_venda(uuid, jsonb, jsonb, text)',
    'public.alterar_venda(uuid, jsonb, jsonb, integer, text)',
    'public.descartar_venda(uuid, integer, text)',
    'public.confirmar_venda(uuid, jsonb, bigint, integer, text)',
    'public.registrar_venda_direta(uuid, jsonb, jsonb, jsonb, bigint, text)',
    'public.registrar_entrega(uuid, integer, text)',
    'public.cancelar_venda(uuid, text, jsonb, integer, text)',
    'public.registrar_recebimento(uuid, bigint, text, date, text)',
    'public.estornar_recebimento(uuid, text, text)',
    'public.registrar_devolucao_valor(uuid, bigint, text, text, text)',
    'public.empresas_para_pedido()',
    'public.itens_para_pedido(uuid)',
    'public.criar_pedido(uuid, jsonb, text, text)',
    'public.aceitar_pedido(uuid, integer, text)',
    'public.recusar_pedido(uuid, text, integer, text)',
    'public.cancelar_pedido(uuid, text, integer, text)',
    'public.concluir_pedido(uuid, jsonb, integer, text)',
    'public.catalogo_para_venda(uuid, text)',
    'public.vendas_da_empresa(uuid, jsonb, integer, integer)',
    'public.venda_detalhe(uuid)',
    'public.pedidos_da_empresa(uuid, text, integer)',
    'public.meus_pedidos()',
    'public.operacoes_da_empresa(uuid, integer)'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

ALTER TABLE app_private.contadores_empresa ENABLE ROW LEVEL SECURITY;   -- sem GRANT

ALTER TABLE public.clientes_empresa ENABLE ROW LEVEL SECURITY;
CREATE POLICY clientes_ler ON public.clientes_empresa FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'clientes.visualizar')));
GRANT SELECT (id, empresa_id, nome, telefone, email, observacoes, ativo, versao, criado_em, atualizado_em)
  ON public.clientes_empresa TO authenticated;   -- perfil_cliente_id só por função

ALTER TABLE public.vendas ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendas_ler ON public.vendas FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'vendas.visualizar')));
GRANT SELECT (id, empresa_id, numero, origem, pedido_id, cliente_empresa_id, cliente_nome, estado, entrega, subtotal, desconto_itens,
  desconto_geral, total, condicao, observacao, confirmada_em, cancelada_em, motivo_cancelamento, versao, criado_em, atualizado_em)
  ON public.vendas TO authenticated;

ALTER TABLE public.venda_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY venda_itens_ler ON public.venda_itens FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'vendas.visualizar')));
GRANT SELECT (venda_id, empresa_id, variacao_id, quantidade, preco_unitario, desconto, valor, nome_snapshot, rotulo_snapshot,
  sob_encomenda, entrega, entregue_em, destino_cancelamento) ON public.venda_itens TO authenticated;   -- custo_unitario: só por função

ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
CREATE POLICY pedidos_ler ON public.pedidos FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'pedidos.visualizar')) OR cliente_auth_id = (SELECT authz.usuario_atual()));
GRANT SELECT (id, empresa_id, estado, observacao_cliente, motivo_decisao, total_estimado, venda_id, versao, criado_em, decidido_em, concluido_em)
  ON public.pedidos TO authenticated;

-- O cliente do pedido lê os itens do próprio pedido (a coluna cliente_auth_id não é exposta ao app).
CREATE FUNCTION authz.eh_meu_pedido(p_pedido_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.pedidos WHERE id = p_pedido_id AND cliente_auth_id = authz.usuario_atual()) $$;
REVOKE ALL ON FUNCTION authz.eh_meu_pedido(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.eh_meu_pedido(uuid) TO authenticated;

ALTER TABLE public.pedido_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY pedido_itens_ler ON public.pedido_itens FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'pedidos.visualizar')) OR authz.eh_meu_pedido(pedido_id));
GRANT SELECT ON public.pedido_itens TO authenticated;

ALTER TABLE public.eventos_comerciais ENABLE ROW LEVEL SECURITY;
CREATE POLICY eventos_comerciais_ler ON public.eventos_comerciais FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'vendas.visualizar')));
GRANT SELECT (id, empresa_id, tipo, alvo_tipo, alvo_id, detalhes, criado_em) ON public.eventos_comerciais TO authenticated;

ALTER TABLE public.contas_financeiras ENABLE ROW LEVEL SECURITY;
CREATE POLICY contas_ler ON public.contas_financeiras FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar')) OR (SELECT authz.tem_permissao(empresa_id, 'vendas.registrar_recebimento')));
GRANT SELECT ON public.contas_financeiras TO authenticated;

ALTER TABLE public.titulos_financeiros ENABLE ROW LEVEL SECURITY;
CREATE POLICY titulos_ler ON public.titulos_financeiros FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'vendas.visualizar')) OR (SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar')));
GRANT SELECT ON public.titulos_financeiros TO authenticated;

ALTER TABLE public.parcelas_financeiras ENABLE ROW LEVEL SECURITY;
CREATE POLICY parcelas_ler ON public.parcelas_financeiras FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'vendas.visualizar')) OR (SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar')));
GRANT SELECT ON public.parcelas_financeiras TO authenticated;

ALTER TABLE public.recebimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY recebimentos_ler ON public.recebimentos FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'vendas.visualizar')) OR (SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar')));
GRANT SELECT (id, empresa_id, titulo_id, parcela_id, conta_id, tipo, valor, forma, data, motivo, estorno_de, criado_em)
  ON public.recebimentos TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611020002', 'M06: clientes da empresa, vendas de balcão e de pedido, sob encomenda, pedidos externos, a receber e recebimentos');

COMMIT;
