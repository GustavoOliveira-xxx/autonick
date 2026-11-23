-- 202611120001: M07, financeiro (contas e caixas, livro-caixa, a receber e a pagar, recorrências, transferências,
-- aportes e retiradas do proprietário, fechamento mensal, indicadores, relatórios e CSV, integração com o M06).
-- MINI-ESPEC_M07; ADR-G07 aprovada em 12/11/2026 (D7-01 a D7-18); implementação autorizada só no desenvolvimento.
-- Princípios (FIN-P1 a FIN-P7): saldo = soma dos lançamentos (o saldo da conta é cache sob trava, nunca UPDATE direto
-- pelo app); só inclusão (correção por estorno ligado); transferência e dinheiro do proprietário nunca são receita nem
-- despesa; cada baixa gera exatamente um lançamento, garantido por índice único de origem; período fechado congelado.
-- Nenhum dinheiro real é movimentado: todo valor é registro manual e demonstrativo (RF-140).
-- Dinheiro trafega em CENTAVOS inteiros e é guardado em numeric(14,2).
-- Rollback: 202611120001_financeiro.down.sql
BEGIN;

-- ===========================================================================
-- 1. Estruturas
-- ===========================================================================

-- 1.1 Contas e caixas (D7-02, D7-03): só o nome identifica a conta; nada de agência, número, chave ou cartão.
ALTER TABLE public.contas_financeiras DROP CONSTRAINT contas_financeiras_tipo_check;
ALTER TABLE public.contas_financeiras ADD CONSTRAINT contas_financeiras_tipo_check
  CHECK (tipo IN ('caixa', 'banco', 'carteira_digital', 'outro'));
ALTER TABLE public.contas_financeiras
  ADD COLUMN permite_negativo boolean NOT NULL DEFAULT false,
  ADD COLUMN saldo numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN versao integer NOT NULL DEFAULT 1,
  ADD COLUMN criado_por text,
  ADD COLUMN atualizado_em timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT contas_caixa_nunca_negativo CHECK (NOT (tipo = 'caixa' AND permite_negativo)),
  ADD CONSTRAINT contas_saldo_permitido CHECK (permite_negativo OR saldo >= 0);
CREATE UNIQUE INDEX contas_nome_unico ON public.contas_financeiras (empresa_id, lower(nome)) WHERE ativa;
COMMENT ON COLUMN public.contas_financeiras.saldo IS
  'Cache do saldo: soma dos lançamentos da conta, atualizada na mesma transação sob trava da conta. Conferida por reconciliar_financeiro.';

-- 1.2 Categorias (D7-04). Transferência, retirada e aporte NÃO são categorias: são tipos do sistema (RN-026, RN-027).
CREATE TABLE public.categorias_financeiras (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES public.empresas (id),
  tipo           text NOT NULL CHECK (tipo IN ('receita', 'despesa')),
  nome           text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 2 AND 60),
  codigo_sistema text CHECK (codigo_sistema IN ('vendas', 'compras')),
  ativa          boolean NOT NULL DEFAULT true,
  ordem          integer NOT NULL DEFAULT 100,
  versao         integer NOT NULL DEFAULT 1,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  CONSTRAINT categorias_sistema_tipo CHECK (codigo_sistema IS NULL OR (codigo_sistema = 'vendas' AND tipo = 'receita')
    OR (codigo_sistema = 'compras' AND tipo = 'despesa'))
);
CREATE UNIQUE INDEX categorias_nome_unico ON public.categorias_financeiras (empresa_id, tipo, lower(nome)) WHERE ativa;
CREATE UNIQUE INDEX categorias_sistema_unico ON public.categorias_financeiras (empresa_id, codigo_sistema) WHERE codigo_sistema IS NOT NULL;
CREATE TRIGGER categorias_sem_exclusao BEFORE DELETE ON public.categorias_financeiras
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- 1.3 Títulos: a pagar, manuais, de compra e de recorrência (RF-122, RF-123, D7-07).
-- `recebido` passa a significar "valor baixado": recebido (a receber) ou pago (a pagar).
ALTER TABLE public.titulos_financeiros DROP CONSTRAINT titulos_financeiros_tipo_check;
ALTER TABLE public.titulos_financeiros ADD CONSTRAINT titulos_financeiros_tipo_check CHECK (tipo IN ('receber', 'pagar'));
ALTER TABLE public.titulos_financeiros DROP CONSTRAINT titulos_financeiros_origem_tipo_check;
ALTER TABLE public.titulos_financeiros ADD CONSTRAINT titulos_financeiros_origem_tipo_check
  CHECK (origem_tipo IN ('venda', 'manual', 'compra', 'recorrencia'));
ALTER TABLE public.titulos_financeiros DROP CONSTRAINT titulos_financeiros_empresa_id_origem_tipo_origem_id_key;
ALTER TABLE public.titulos_financeiros ALTER COLUMN origem_id DROP NOT NULL;
ALTER TABLE public.titulos_financeiros
  ADD COLUMN categoria_id uuid,
  ADD COLUMN competencia date,
  ADD COLUMN contraparte_tipo text CHECK (contraparte_tipo IN ('cliente', 'fornecedor', 'texto')),
  ADD COLUMN cliente_empresa_id uuid,
  ADD COLUMN fornecedor_id uuid,
  ADD COLUMN contraparte_texto text CHECK (char_length(contraparte_texto) BETWEEN 2 AND 120),
  ADD COLUMN motivo_cancelamento text CHECK (char_length(motivo_cancelamento) <= 300),
  ADD COLUMN criado_por text,
  ADD COLUMN cancelado_por text,
  ADD CONSTRAINT titulos_categoria_fk FOREIGN KEY (empresa_id, categoria_id) REFERENCES public.categorias_financeiras (empresa_id, id),
  ADD CONSTRAINT titulos_cliente_fk FOREIGN KEY (empresa_id, cliente_empresa_id) REFERENCES public.clientes_empresa (empresa_id, id),
  ADD CONSTRAINT titulos_fornecedor_fk FOREIGN KEY (empresa_id, fornecedor_id) REFERENCES public.fornecedores (empresa_id, id),
  ADD CONSTRAINT titulos_origem_coerente CHECK ((origem_tipo = 'manual') = (origem_id IS NULL)),
  ADD CONSTRAINT titulos_tipo_origem CHECK ((origem_tipo = 'venda' AND tipo = 'receber')
    OR (origem_tipo IN ('compra', 'recorrencia') AND tipo = 'pagar') OR origem_tipo = 'manual'),
  ADD CONSTRAINT titulos_devolucao_so_receber CHECK (tipo = 'receber' OR a_devolver = 0),
  ADD CONSTRAINT titulos_contraparte_coerente CHECK (
    (contraparte_tipo IS NULL AND cliente_empresa_id IS NULL AND fornecedor_id IS NULL AND contraparte_texto IS NULL)
    OR (contraparte_tipo = 'cliente' AND cliente_empresa_id IS NOT NULL AND fornecedor_id IS NULL AND contraparte_texto IS NULL)
    OR (contraparte_tipo = 'fornecedor' AND fornecedor_id IS NOT NULL AND cliente_empresa_id IS NULL AND contraparte_texto IS NULL)
    OR (contraparte_tipo = 'texto' AND contraparte_texto IS NOT NULL AND cliente_empresa_id IS NULL AND fornecedor_id IS NULL));
CREATE UNIQUE INDEX titulos_uma_por_venda ON public.titulos_financeiros (empresa_id, origem_id) WHERE origem_tipo = 'venda';
-- Uma conta a pagar ativa por compra (D7-07); cancelada, a compra pode gerar outra.
CREATE UNIQUE INDEX titulos_uma_por_compra ON public.titulos_financeiros (empresa_id, origem_id)
  WHERE origem_tipo = 'compra' AND estado <> 'cancelado';
CREATE INDEX titulos_lista ON public.titulos_financeiros (empresa_id, tipo, estado, competencia DESC);
COMMENT ON COLUMN public.titulos_financeiros.recebido IS 'Valor baixado: recebido (a receber) ou pago (a pagar). Soma das baixas válidas.';

-- 1.4 Livro-caixa: só inclusão; cada linha tem origem identificável (FIN-P6, RF-120, RF-139).
CREATE TABLE public.lancamentos_financeiros (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas (id),
  conta_id      uuid NOT NULL,
  data          date NOT NULL,
  sentido       text NOT NULL CHECK (sentido IN ('entrada', 'saida')),
  valor         numeric(14,2) NOT NULL CHECK (valor > 0),
  tipo          text NOT NULL CHECK (tipo IN ('saldo_inicial', 'recebimento', 'pagamento', 'receita_avulsa', 'despesa_avulsa',
                  'transferencia_saida', 'transferencia_entrada', 'retirada', 'aporte', 'devolucao_cliente', 'estorno', 'ajuste_conferencia')),
  natureza      text NOT NULL CHECK (natureza IN ('receita', 'despesa', 'interna', 'proprietario', 'ajuste')),
  categoria_id  uuid,
  origem_tipo   text NOT NULL CHECK (origem_tipo IN ('conta', 'recebimento', 'pagamento', 'transferencia', 'manual', 'fechamento', 'estorno')),
  origem_id     uuid,
  titulo_id     uuid,
  parcela_id    uuid,
  descricao     text CHECK (char_length(descricao) <= 300),
  estorno_de    uuid UNIQUE REFERENCES public.lancamentos_financeiros (id),
  carga_m06     boolean NOT NULL DEFAULT false,
  autor         text NOT NULL,
  operation_key text,
  criado_em     timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, conta_id) REFERENCES public.contas_financeiras (empresa_id, id),
  FOREIGN KEY (empresa_id, categoria_id) REFERENCES public.categorias_financeiras (empresa_id, id),
  FOREIGN KEY (empresa_id, titulo_id) REFERENCES public.titulos_financeiros (empresa_id, id),
  FOREIGN KEY (empresa_id, parcela_id) REFERENCES public.parcelas_financeiras (empresa_id, id),
  -- Natureza e sentido são consequência do tipo: o usuário nunca escolhe "receita" para uma transferência (RN-026, RN-027).
  CONSTRAINT lancamentos_tipo_coerente CHECK (
       (tipo = 'saldo_inicial' AND natureza = 'ajuste' AND sentido = 'entrada')
    OR (tipo = 'recebimento' AND natureza = 'receita' AND sentido = 'entrada')
    OR (tipo = 'pagamento' AND natureza = 'despesa' AND sentido = 'saida')
    OR (tipo = 'receita_avulsa' AND natureza = 'receita' AND sentido = 'entrada')
    OR (tipo = 'despesa_avulsa' AND natureza = 'despesa' AND sentido = 'saida')
    OR (tipo = 'transferencia_saida' AND natureza = 'interna' AND sentido = 'saida')
    OR (tipo = 'transferencia_entrada' AND natureza = 'interna' AND sentido = 'entrada')
    OR (tipo = 'retirada' AND natureza = 'proprietario' AND sentido = 'saida')
    OR (tipo = 'aporte' AND natureza = 'proprietario' AND sentido = 'entrada')
    OR (tipo = 'devolucao_cliente' AND natureza = 'receita' AND sentido = 'saida')
    OR (tipo = 'ajuste_conferencia' AND natureza = 'ajuste')
    OR (tipo = 'estorno' AND natureza IN ('receita', 'despesa', 'proprietario', 'ajuste'))),
  CONSTRAINT lancamentos_estorno_coerente CHECK ((tipo = 'estorno') = (estorno_de IS NOT NULL)),
  CONSTRAINT lancamentos_categoria_coerente CHECK ((natureza IN ('receita', 'despesa')) = (categoria_id IS NOT NULL)),
  CONSTRAINT lancamentos_origem_coerente CHECK ((origem_tipo = 'manual') = (origem_id IS NULL))
);
-- Uma baixa, uma transferência, um saldo inicial ou um estorno geram exatamente um lançamento por conta e sentido.
CREATE UNIQUE INDEX lancamentos_origem_unica ON public.lancamentos_financeiros (origem_tipo, origem_id, conta_id, sentido)
  WHERE origem_id IS NOT NULL;
CREATE INDEX lancamentos_conta_data ON public.lancamentos_financeiros (empresa_id, conta_id, data DESC);
CREATE INDEX lancamentos_empresa_data ON public.lancamentos_financeiros (empresa_id, data DESC, criado_em DESC);
CREATE TRIGGER lancamentos_somente_insercao BEFORE UPDATE OR DELETE ON public.lancamentos_financeiros
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- 1.5 Pagamentos de contas a pagar (espelho dos recebimentos do M06).
CREATE TABLE public.pagamentos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  titulo_id     uuid NOT NULL,
  parcela_id    uuid NOT NULL,
  conta_id      uuid NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('pagamento', 'estorno')),
  valor         numeric(14,2) NOT NULL CHECK (valor > 0),
  forma         text NOT NULL CHECK (forma IN ('dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia', 'outro')),
  data          date NOT NULL,
  motivo        text CHECK (char_length(motivo) <= 300),
  estorno_de    uuid UNIQUE REFERENCES public.pagamentos (id),
  autor         text NOT NULL,
  operation_key text,
  criado_em     timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, titulo_id) REFERENCES public.titulos_financeiros (empresa_id, id),
  FOREIGN KEY (empresa_id, parcela_id) REFERENCES public.parcelas_financeiras (empresa_id, id),
  FOREIGN KEY (empresa_id, conta_id) REFERENCES public.contas_financeiras (empresa_id, id),
  CONSTRAINT pagamentos_estorno_coerente CHECK ((tipo = 'estorno') = (estorno_de IS NOT NULL))
);
CREATE INDEX pagamentos_titulo ON public.pagamentos (empresa_id, titulo_id, criado_em);
CREATE TRIGGER pagamentos_somente_insercao BEFORE UPDATE OR DELETE ON public.pagamentos
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- 1.6 Transferências entre contas da mesma empresa (RF-129, RN-026, FIN-I04).
CREATE TABLE public.transferencias_financeiras (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES public.empresas (id),
  conta_origem_id  uuid NOT NULL,
  conta_destino_id uuid NOT NULL,
  valor            numeric(14,2) NOT NULL CHECK (valor > 0),
  data             date NOT NULL,
  descricao        text CHECK (char_length(descricao) <= 300),
  estorno_de       uuid UNIQUE REFERENCES public.transferencias_financeiras (id),
  motivo           text CHECK (char_length(motivo) <= 300),
  autor            text NOT NULL,
  operation_key    text,
  criado_em        timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, conta_origem_id) REFERENCES public.contas_financeiras (empresa_id, id),
  FOREIGN KEY (empresa_id, conta_destino_id) REFERENCES public.contas_financeiras (empresa_id, id),
  CONSTRAINT transferencias_contas_diferentes CHECK (conta_origem_id <> conta_destino_id)
);
CREATE TRIGGER transferencias_somente_insercao BEFORE UPDATE OR DELETE ON public.transferencias_financeiras
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- 1.7 Despesas recorrentes (RF-125, D7-08, D7-09).
CREATE TABLE public.despesas_recorrentes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES public.empresas (id),
  descricao      text NOT NULL CHECK (char_length(btrim(descricao)) BETWEEN 2 AND 120),
  valor          numeric(14,2) NOT NULL CHECK (valor > 0),
  categoria_id   uuid NOT NULL,
  fornecedor_id  uuid,
  periodicidade  text NOT NULL CHECK (periodicidade IN ('mensal', 'anual')),
  dia_vencimento integer NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  inicio         date NOT NULL CHECK (inicio = date_trunc('month', inicio)::date),
  fim            date CHECK (fim = date_trunc('month', fim)::date),
  ativa          boolean NOT NULL DEFAULT true,
  versao         integer NOT NULL DEFAULT 1,
  criado_por     text NOT NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, categoria_id) REFERENCES public.categorias_financeiras (empresa_id, id),
  FOREIGN KEY (empresa_id, fornecedor_id) REFERENCES public.fornecedores (empresa_id, id),
  CONSTRAINT recorrencias_periodo CHECK (fim IS NULL OR fim >= inicio)
);
CREATE TRIGGER recorrencias_sem_exclusao BEFORE DELETE ON public.despesas_recorrentes
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
-- Um título por regra e competência: gerar duas vezes, ou ao mesmo tempo, nunca duplica.
CREATE UNIQUE INDEX titulos_recorrencia_competencia ON public.titulos_financeiros (empresa_id, origem_id, competencia)
  WHERE origem_tipo = 'recorrencia';

-- 1.8 Fechamento mensal (RF-135, RF-136, D7-11 a D7-13). Os meses fechados formam sempre um prefixo contínuo.
CREATE TABLE public.fechamentos_financeiros (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES public.empresas (id),
  mes               date NOT NULL CHECK (mes = date_trunc('month', mes)::date),
  estado            text NOT NULL DEFAULT 'fechado' CHECK (estado IN ('fechado', 'reaberto')),
  saldos            jsonb NOT NULL,
  resumo            jsonb NOT NULL,
  conferencias      jsonb NOT NULL DEFAULT '[]'::jsonb,
  fechado_por       text NOT NULL,
  fechado_em        timestamptz NOT NULL DEFAULT now(),
  reaberto_por      text,
  reaberto_em       timestamptz,
  motivo_reabertura text CHECK (char_length(motivo_reabertura) BETWEEN 10 AND 300),
  operation_key     text,
  UNIQUE (empresa_id, id),
  CONSTRAINT fechamentos_reabertura_coerente CHECK ((estado = 'reaberto') = (reaberto_em IS NOT NULL AND reaberto_por IS NOT NULL
    AND motivo_reabertura IS NOT NULL))
);
CREATE UNIQUE INDEX fechamentos_um_por_mes ON public.fechamentos_financeiros (empresa_id, mes) WHERE estado = 'fechado';

-- Controle por empresa: até que dia está fechado. Lançamentos travam a linha em modo compartilhado;
-- fechar e reabrir travam em modo exclusivo. Assim nenhum lançamento entra num mês enquanto ele é fechado.
CREATE TABLE app_private.controle_financeiro (
  empresa_id    uuid PRIMARY KEY REFERENCES public.empresas (id),
  fechado_ate   date,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Fechamento só muda para "reaberto", preenchendo os campos da reabertura; nunca é apagado (FIN-I21).
CREATE FUNCTION app_private.proteger_fechamento() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.estado = 'fechado' AND NEW.estado = 'reaberto'
     AND (NEW.id, NEW.empresa_id, NEW.mes, NEW.saldos, NEW.resumo, NEW.conferencias, NEW.fechado_por, NEW.fechado_em)
         IS NOT DISTINCT FROM (OLD.id, OLD.empresa_id, OLD.mes, OLD.saldos, OLD.resumo, OLD.conferencias, OLD.fechado_por, OLD.fechado_em) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Fechamento não pode ser alterado ou excluído; só reaberto.' USING ERRCODE = 'insufficient_privilege', HINT = 'FORBIDDEN_ACTION';
END $$;
CREATE TRIGGER fechamentos_protegidos BEFORE UPDATE OR DELETE ON public.fechamentos_financeiros
  FOR EACH ROW EXECUTE FUNCTION app_private.proteger_fechamento();

-- Conta com histórico nunca é apagada.
CREATE TRIGGER contas_sem_exclusao BEFORE DELETE ON public.contas_financeiras
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- ===========================================================================
-- 2. Núcleo (privado): datas, períodos, categorias e o único caminho que grava lançamentos
-- ===========================================================================
CREATE FUNCTION app_private.hoje_sp() RETURNS date
LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

CREATE FUNCTION app_private.brl(p numeric) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT 'R$ ' || translate(to_char(p, 'FM999,999,999,990.00'), ',.', '.,') $$;

-- Trava compartilhada do controle do período e devolve até quando está fechado.
CREATE FUNCTION app_private.travar_periodo(p_empresa uuid) RETURNS date
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v date;
BEGIN
  INSERT INTO app_private.controle_financeiro (empresa_id) VALUES (p_empresa) ON CONFLICT (empresa_id) DO NOTHING;
  SELECT fechado_ate INTO v FROM app_private.controle_financeiro WHERE empresa_id = p_empresa FOR SHARE;
  RETURN v;
END $$;

-- Data de um efeito financeiro: não futura, até 10 anos para trás (D7-18) e fora de mês fechado (D7-13).
CREATE FUNCTION app_private.exigir_data_aberta(p_empresa uuid, p_data date, p_campo text DEFAULT 'data') RETURNS void
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_fechado date := app_private.travar_periodo(p_empresa);
BEGIN
  IF p_data IS NULL THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe a data.', p_campo);
  END IF;
  IF p_data > app_private.hoje_sp() THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A data não pode estar no futuro. O que ainda vai acontecer é uma conta a pagar ou a receber.', p_campo);
  END IF;
  IF p_data < app_private.hoje_sp() - 3650 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A data é antiga demais (mais de 10 anos).', p_campo);
  END IF;
  IF v_fechado IS NOT NULL AND p_data <= v_fechado THEN
    PERFORM app_private.erro('PERIOD_LOCKED',
      format('O mês de %s já foi fechado. Registre a correção com a data de hoje; ela entra no período aberto.',
        to_char(p_data, 'MM/YYYY')), p_campo);
  END IF;
END $$;

-- Competência (mês de referência) de títulos: precisa estar em mês aberto (D7-13).
CREATE FUNCTION app_private.exigir_competencia_aberta(p_empresa uuid, p_competencia date) RETURNS void
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_fechado date := app_private.travar_periodo(p_empresa);
BEGIN
  IF v_fechado IS NOT NULL AND p_competencia <= v_fechado THEN
    PERFORM app_private.erro('PERIOD_LOCKED',
      format('O mês de %s já foi fechado. Use um mês aberto como referência.', to_char(p_competencia, 'MM/YYYY')), 'competencia');
  END IF;
END $$;

-- Categorias iniciais (D7-04), criadas na primeira necessidade de cada empresa.
CREATE FUNCTION app_private.garantir_categorias(p_empresa uuid) RETURNS void
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND codigo_sistema = 'vendas') THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('categorias|' || p_empresa::text, 0));
  INSERT INTO public.categorias_financeiras (empresa_id, tipo, nome, codigo_sistema, ordem)
  SELECT p_empresa, c.tipo, c.nome, c.codigo, c.ordem FROM (VALUES
    ('receita', 'Vendas', 'vendas', 1), ('receita', 'Outras receitas', NULL, 90),
    ('despesa', 'Compras de mercadorias e insumos', 'compras', 1), ('despesa', 'Aluguel', NULL, 10),
    ('despesa', 'Energia, água e internet', NULL, 11), ('despesa', 'Salários e encargos', NULL, 12),
    ('despesa', 'Impostos e taxas', NULL, 13), ('despesa', 'Transporte', NULL, 14), ('despesa', 'Manutenção', NULL, 15),
    ('despesa', 'Divulgação', NULL, 16), ('despesa', 'Tarifas bancárias', NULL, 17), ('despesa', 'Outras despesas', NULL, 90)
  ) AS c (tipo, nome, codigo, ordem)
  WHERE NOT EXISTS (SELECT 1 FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND codigo_sistema = 'vendas');
END $$;

CREATE FUNCTION app_private.categoria_sistema(p_empresa uuid, p_codigo text) RETURNS uuid
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v uuid;
BEGIN
  PERFORM app_private.garantir_categorias(p_empresa);
  SELECT id INTO v FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND codigo_sistema = p_codigo;
  RETURN v;
END $$;

-- Categoria escolhida pelo usuário: da empresa, ativa e do tipo certo (nunca revela categoria de outra empresa).
CREATE FUNCTION app_private.categoria_valida(p_empresa uuid, p_categoria uuid, p_tipo text) RETURNS uuid
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  c public.categorias_financeiras;
BEGIN
  PERFORM app_private.garantir_categorias(p_empresa);
  SELECT * INTO c FROM public.categorias_financeiras WHERE id = p_categoria AND empresa_id = p_empresa;
  IF NOT FOUND OR NOT c.ativa THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha uma categoria ativa desta empresa.', 'categoria_id');
  END IF;
  IF c.tipo <> p_tipo THEN
    PERFORM app_private.erro('VALIDATION_ERROR',
      CASE p_tipo WHEN 'receita' THEN 'Escolha uma categoria de receita.' ELSE 'Escolha uma categoria de despesa.' END, 'categoria_id');
  END IF;
  RETURN c.id;
END $$;

-- Conta escolhida pelo usuário: da empresa e ativa.
CREATE FUNCTION app_private.conta_valida(p_empresa uuid, p_conta uuid, p_campo text DEFAULT 'conta_id') RETURNS public.contas_financeiras
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  c public.contas_financeiras;
BEGIN
  SELECT * INTO c FROM public.contas_financeiras WHERE id = p_conta AND empresa_id = p_empresa;
  IF NOT FOUND THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha uma conta desta empresa.', p_campo);
  END IF;
  IF NOT c.ativa THEN
    PERFORM app_private.erro('STATE_CONFLICT', format('A conta "%s" está desativada.', c.nome), p_campo);
  END IF;
  RETURN c;
END $$;

-- Menor saldo da conta de uma data em diante (saldo no próprio dia e depois de cada dia com lançamento posterior).
CREATE FUNCTION app_private.menor_saldo_desde(p_conta uuid, p_data date) RETURNS numeric
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH por_dia AS (
    SELECT data, sum(CASE sentido WHEN 'entrada' THEN valor ELSE -valor END) AS v
      FROM public.lancamentos_financeiros WHERE conta_id = p_conta GROUP BY data),
  acumulado AS (SELECT data, sum(v) OVER (ORDER BY data) AS r FROM por_dia)
  SELECT least((SELECT coalesce(sum(v), 0) FROM por_dia WHERE data <= p_data), (SELECT min(r) FROM acumulado WHERE data > p_data))
$$;

-- O ÚNICO caminho que grava no livro-caixa. Na mesma transação: período aberto (trava compartilhada), trava da conta,
-- saldo nunca negativo onde não é permitido (D7-03; duas saídas simultâneas nunca passam do saldo, FIN-I03),
-- inclusão do lançamento e atualização do saldo da conta.
CREATE FUNCTION app_private.lancar(p_empresa uuid, p_conta uuid, p_data date, p_sentido text, p_valor numeric, p_tipo text,
  p_natureza text, p_categoria uuid, p_origem_tipo text, p_origem_id uuid, p_titulo uuid, p_parcela uuid, p_descricao text,
  p_estorno_de uuid, p_autor text, p_chave text, p_carga boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  c public.contas_financeiras;
  v_novo numeric;
  v_disponivel numeric;
  v_id uuid;
BEGIN
  IF NOT p_carga THEN
    PERFORM app_private.exigir_data_aberta(p_empresa, p_data);
  END IF;
  SELECT * INTO c FROM public.contas_financeiras WHERE id = p_conta AND empresa_id = p_empresa FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha uma conta desta empresa.', 'conta_id');
  END IF;
  IF NOT c.ativa AND NOT p_carga THEN
    PERFORM app_private.erro('STATE_CONFLICT', format('A conta "%s" está desativada.', c.nome), 'conta_id');
  END IF;
  v_novo := c.saldo + CASE WHEN p_sentido = 'entrada' THEN p_valor ELSE -p_valor END;
  IF p_sentido = 'saida' AND NOT c.permite_negativo THEN
    -- A saída vale da data dela em diante: o saldo não pode ficar negativo em NENHUM dia a partir dela
    -- (uma saída retroativa não pode usar dinheiro que só entrou depois).
    v_disponivel := app_private.menor_saldo_desde(c.id, p_data);
    IF v_disponivel - p_valor < 0 THEN
      PERFORM app_private.erro('INSUFFICIENT_FUNDS',
        format('Saldo insuficiente em "%s" (%s disponível %s). %s', c.nome, app_private.brl(greatest(v_disponivel, 0)),
          CASE WHEN p_data < app_private.hoje_sp() THEN 'a partir de ' || to_char(p_data, 'DD/MM/YYYY') ELSE 'agora' END,
          CASE WHEN c.tipo = 'caixa' THEN 'O caixa físico nunca fica negativo.'
               ELSE 'Esta conta não está marcada para permitir saldo negativo.' END), 'valor_centavos');
    END IF;
  END IF;
  INSERT INTO public.lancamentos_financeiros (empresa_id, conta_id, data, sentido, valor, tipo, natureza, categoria_id, origem_tipo,
    origem_id, titulo_id, parcela_id, descricao, estorno_de, carga_m06, autor, operation_key)
  VALUES (p_empresa, p_conta, p_data, p_sentido, p_valor, p_tipo, p_natureza, p_categoria, p_origem_tipo, p_origem_id, p_titulo,
    p_parcela, nullif(btrim(coalesce(p_descricao, '')), ''), p_estorno_de, p_carga, p_autor, p_chave)
  RETURNING id INTO v_id;
  UPDATE public.contas_financeiras SET saldo = v_novo, versao = versao + 1, atualizado_em = now() WHERE id = c.id;
  RETURN v_id;
END $$;

-- Estorno de um lançamento: mesma conta, mesma natureza e categoria, sentido inverso, data de hoje (período aberto).
CREATE FUNCTION app_private.lancar_estorno(p_original uuid, p_origem_tipo text, p_origem_id uuid, p_motivo text, p_autor text,
  p_chave text, p_carga boolean DEFAULT false, p_data date DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  o public.lancamentos_financeiros;
BEGIN
  SELECT * INTO o FROM public.lancamentos_financeiros WHERE id = p_original;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Lançamento original não encontrado.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.lancamentos_financeiros WHERE estorno_de = o.id) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este lançamento já foi estornado.');
  END IF;
  RETURN app_private.lancar(o.empresa_id, o.conta_id, coalesce(p_data, app_private.hoje_sp()),
    CASE o.sentido WHEN 'entrada' THEN 'saida' ELSE 'entrada' END, o.valor, 'estorno', o.natureza, o.categoria_id,
    p_origem_tipo, p_origem_id, o.titulo_id, o.parcela_id, p_motivo, o.id, p_autor, p_chave, p_carga);
END $$;

-- Todo recebimento do M06 (recebimento, estorno, devolução) gera seu lançamento na MESMA transação (D7-16).
-- Se o período estiver fechado ou o caixa não tiver o valor, a operação inteira é recusada.
CREATE FUNCTION app_private.lancar_recebimento(r public.recebimentos, p_carga boolean) RETURNS uuid
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_cat uuid := app_private.categoria_sistema(r.empresa_id, 'vendas');
  v_cat_titulo uuid;
  v_original uuid;
BEGIN
  SELECT coalesce(categoria_id, v_cat) INTO v_cat_titulo FROM public.titulos_financeiros WHERE id = r.titulo_id;
  IF r.tipo = 'recebimento' THEN
    RETURN app_private.lancar(r.empresa_id, r.conta_id, r.data, 'entrada', r.valor, 'recebimento', 'receita', v_cat_titulo,
      'recebimento', r.id, r.titulo_id, r.parcela_id, NULL, NULL, r.autor, r.operation_key, p_carga);
  ELSIF r.tipo = 'devolucao' THEN
    RETURN app_private.lancar(r.empresa_id, r.conta_id, r.data, 'saida', r.valor, 'devolucao_cliente', 'receita', v_cat_titulo,
      'recebimento', r.id, r.titulo_id, NULL, r.motivo, NULL, r.autor, r.operation_key, p_carga);
  END IF;
  SELECT id INTO v_original FROM public.lancamentos_financeiros WHERE origem_tipo = 'recebimento' AND origem_id = r.estorno_de;
  RETURN app_private.lancar_estorno(v_original, 'recebimento', r.id, r.motivo, r.autor, r.operation_key, p_carga, r.data);
END $$;

CREATE FUNCTION app_private.recebimento_lanca() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.lancar_recebimento(NEW, false);
  RETURN NEW;
END $$;
CREATE TRIGGER recebimentos_geram_lancamento AFTER INSERT ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION app_private.recebimento_lanca();

CREATE FUNCTION app_private.pagamento_lanca() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_cat uuid;
  v_original uuid;
BEGIN
  IF NEW.tipo = 'pagamento' THEN
    SELECT categoria_id INTO v_cat FROM public.titulos_financeiros WHERE id = NEW.titulo_id;
    PERFORM app_private.lancar(NEW.empresa_id, NEW.conta_id, NEW.data, 'saida', NEW.valor, 'pagamento', 'despesa', v_cat,
      'pagamento', NEW.id, NEW.titulo_id, NEW.parcela_id, NULL, NULL, NEW.autor, NEW.operation_key);
  ELSE
    SELECT id INTO v_original FROM public.lancamentos_financeiros WHERE origem_tipo = 'pagamento' AND origem_id = NEW.estorno_de;
    PERFORM app_private.lancar_estorno(v_original, 'pagamento', NEW.id, NEW.motivo, NEW.autor, NEW.operation_key, false, NEW.data);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pagamentos_geram_lancamento AFTER INSERT ON public.pagamentos
  FOR EACH ROW EXECUTE FUNCTION app_private.pagamento_lanca();

-- Título de venda (M06) ganha categoria "Vendas", competência da confirmação e o cliente como contraparte.
CREATE FUNCTION app_private.completar_titulo() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_cliente uuid;
BEGIN
  IF NEW.origem_tipo = 'venda' THEN
    NEW.categoria_id := coalesce(NEW.categoria_id, app_private.categoria_sistema(NEW.empresa_id, 'vendas'));
    IF NEW.contraparte_tipo IS NULL THEN
      SELECT cliente_empresa_id INTO v_cliente FROM public.vendas WHERE id = NEW.origem_id;
      IF v_cliente IS NOT NULL THEN
        NEW.contraparte_tipo := 'cliente';
        NEW.cliente_empresa_id := v_cliente;
      END IF;
    END IF;
  END IF;
  NEW.competencia := coalesce(NEW.competencia, app_private.hoje_sp());
  RETURN NEW;
END $$;
CREATE TRIGGER titulos_completar BEFORE INSERT ON public.titulos_financeiros
  FOR EACH ROW EXECUTE FUNCTION app_private.completar_titulo();

-- ===========================================================================
-- 3. Carga dos registros do M06 (D7-16): idempotente (índice único de origem), auditável e sem duplicação
-- ===========================================================================
CREATE FUNCTION app_private.carregar_lancamentos_m06() RETURNS jsonb
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  r public.recebimentos;
  v_novos integer := 0;
  v_empresas uuid[] := ARRAY[]::uuid[];
  e uuid;
BEGIN
  FOR r IN SELECT * FROM public.recebimentos rc
            WHERE NOT EXISTS (SELECT 1 FROM public.lancamentos_financeiros l WHERE l.origem_tipo = 'recebimento' AND l.origem_id = rc.id)
            ORDER BY rc.criado_em, rc.id LOOP
    PERFORM app_private.lancar_recebimento(r, true);
    v_novos := v_novos + 1;
    IF NOT r.empresa_id = ANY (v_empresas) THEN
      v_empresas := v_empresas || r.empresa_id;
    END IF;
  END LOOP;
  FOREACH e IN ARRAY v_empresas LOOP
    PERFORM app_private.auditar(e, 'migracao:202611120001', 'financeiro.carga_m06', 'lancamentos_financeiros', NULL,
      jsonb_build_object('lancamentos', (SELECT count(*) FROM public.lancamentos_financeiros WHERE empresa_id = e AND carga_m06)));
  END LOOP;
  RETURN jsonb_build_object('lancamentos_criados', v_novos, 'empresas', coalesce(array_length(v_empresas, 1), 0));
END $$;

-- Títulos de venda existentes: categoria, competência (dia da confirmação) e cliente.
DO $$
DECLARE e uuid;
BEGIN
  FOR e IN SELECT DISTINCT empresa_id FROM public.titulos_financeiros LOOP
    PERFORM app_private.garantir_categorias(e);
  END LOOP;
END $$;
UPDATE public.titulos_financeiros t SET
  categoria_id = (SELECT c.id FROM public.categorias_financeiras c WHERE c.empresa_id = t.empresa_id AND c.codigo_sistema = 'vendas'),
  competencia = coalesce((SELECT (v.confirmada_em AT TIME ZONE 'America/Sao_Paulo')::date FROM public.vendas v WHERE v.id = t.origem_id),
                         (t.criado_em AT TIME ZONE 'America/Sao_Paulo')::date),
  contraparte_tipo = CASE WHEN (SELECT v.cliente_empresa_id FROM public.vendas v WHERE v.id = t.origem_id) IS NOT NULL THEN 'cliente' END,
  cliente_empresa_id = (SELECT v.cliente_empresa_id FROM public.vendas v WHERE v.id = t.origem_id)
 WHERE t.origem_tipo = 'venda' AND t.categoria_id IS NULL;
ALTER TABLE public.titulos_financeiros ALTER COLUMN competencia SET NOT NULL;
ALTER TABLE public.titulos_financeiros ADD CONSTRAINT titulos_categoria_obrigatoria CHECK (categoria_id IS NOT NULL);
SELECT app_private.carregar_lancamentos_m06();

-- ===========================================================================
-- 4. Auxiliares de validação e o M06 com escolha da conta (D7-16)
-- ===========================================================================
CREATE FUNCTION app_private.exigir_chaves(p_dados jsonb, p_permitidas text[]) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  v text;
BEGIN
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Dados inválidos.');
  END IF;
  SELECT k INTO v FROM jsonb_object_keys(p_dados) AS k WHERE NOT k = ANY (p_permitidas) LIMIT 1;
  IF v IS NOT NULL THEN
    PERFORM app_private.erro('VALIDATION_ERROR', format('Campo não permitido: %s.', v), v);
  END IF;
END $$;

CREATE FUNCTION app_private.ler_uuid(p text, p_campo text) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
BEGIN
  IF p IS NULL OR p = '' THEN RETURN NULL; END IF;
  RETURN p::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  PERFORM app_private.erro('VALIDATION_ERROR', 'Identificador inválido.', p_campo);
  RETURN NULL;
END $$;

CREATE FUNCTION app_private.ler_data(p text, p_campo text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
BEGIN
  IF p IS NULL OR p = '' THEN RETURN NULL; END IF;
  IF p !~ '^\d{4}-\d{2}-\d{2}$' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Data inválida.', p_campo);
  END IF;
  RETURN p::date;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  PERFORM app_private.erro('VALIDATION_ERROR', 'Data inválida.', p_campo);
  RETURN NULL;
END $$;

CREATE FUNCTION app_private.ler_texto(p text, p_min integer, p_max integer, p_campo text, p_mensagem text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  v text := nullif(btrim(coalesce(p, '')), '');
BEGIN
  IF v IS NULL AND p_min = 0 THEN RETURN NULL; END IF;
  IF v IS NULL OR char_length(v) NOT BETWEEN greatest(p_min, 1) AND p_max THEN
    PERFORM app_private.erro('VALIDATION_ERROR', p_mensagem, p_campo);
  END IF;
  RETURN v;
END $$;

CREATE FUNCTION app_private.exigir_proprietario(p_empresa uuid, p_usuario text, p_mensagem text) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = p_empresa AND auth_user_id = p_usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  IF NOT app_private.eh_proprietario_de(p_empresa, p_usuario) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', p_mensagem);
  END IF;
END $$;

-- Recebimento numa parcela de conta a receber, com trava na parcela (FIN-I03), na conta escolhida (padrão: conta padrão).
DROP FUNCTION app_private.receber_parcela(uuid, numeric, text, date, text, text);
CREATE FUNCTION app_private.receber_parcela(p_parcela uuid, p_valor numeric, p_forma text, p_data date,
  p_usuario text, p_chave text, p_conta uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  pa public.parcelas_financeiras;
  t public.titulos_financeiros;
  c public.contas_financeiras;
  v_rec uuid;
BEGIN
  SELECT * INTO pa FROM public.parcelas_financeiras WHERE id = p_parcela FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Parcela não encontrada.');
  END IF;
  SELECT * INTO t FROM public.titulos_financeiros WHERE id = pa.titulo_id FOR UPDATE;
  IF t.tipo <> 'receber' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta é uma conta a pagar: registre um pagamento.');
  END IF;
  IF t.estado = 'cancelado' OR pa.estado = 'cancelada' THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN t.origem_tipo = 'venda'
      THEN 'Esta venda foi cancelada; não recebe mais valores.' ELSE 'Esta conta foi cancelada; não recebe mais valores.' END);
  END IF;
  IF p_forma IS NULL OR p_forma NOT IN ('dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia', 'outro') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha a forma de pagamento.', 'forma');
  END IF;
  IF p_data IS NULL OR p_data > app_private.hoje_sp() OR p_data < app_private.hoje_sp() - 3650 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A data do recebimento não pode estar no futuro.', 'data');
  END IF;
  IF p_valor > pa.saldo THEN
    PERFORM app_private.erro('PAYMENT_EXCEEDS_BALANCE',
      format('O valor é maior que o saldo da parcela (R$ %s).', to_char(pa.saldo, 'FM999G999G990D00')), 'valor_centavos');
  END IF;
  c := app_private.conta_valida(pa.empresa_id, coalesce(p_conta, app_private.conta_caixa(pa.empresa_id)));
  INSERT INTO public.recebimentos (empresa_id, titulo_id, parcela_id, conta_id, tipo, valor, forma, data, autor, operation_key)
  VALUES (pa.empresa_id, t.id, pa.id, c.id, 'recebimento', p_valor, p_forma, p_data, p_usuario, p_chave)
  RETURNING id INTO v_rec;
  UPDATE public.parcelas_financeiras SET saldo = saldo - p_valor,
    estado = CASE WHEN saldo - p_valor = 0 THEN 'liquidada' ELSE 'parcial' END, versao = versao + 1
   WHERE id = pa.id;
  UPDATE public.titulos_financeiros SET recebido = recebido + p_valor,
    estado = CASE WHEN recebido + p_valor = total THEN 'liquidado' ELSE 'parcial' END, versao = versao + 1
   WHERE id = t.id;
  PERFORM app_private.evento_comercial(pa.empresa_id, 'recebimento_registrado', p_usuario, 'titulo', t.id,
    jsonb_build_object('parcela', pa.sequencia, 'valor_centavos', app_private.para_centavos(p_valor), 'forma', p_forma,
      'conta', c.nome), p_chave);
  PERFORM app_private.auditar(pa.empresa_id, p_usuario, 'venda.recebimento', 'recebimentos', v_rec,
    jsonb_build_object('valor_centavos', app_private.para_centavos(p_valor), 'forma', p_forma, 'conta_id', c.id));
  RETURN jsonb_build_object('recebimento_id', v_rec, 'parcela_id', pa.id, 'conta_id', c.id,
    'saldo_parcela_centavos', app_private.para_centavos(pa.saldo - p_valor),
    'saldo_titulo_centavos', app_private.para_centavos(t.total - t.recebido - p_valor));
END $$;

-- Núcleo da confirmação de venda (M06), idêntico ao original exceto pela conta do recebimento inicial (D7-16).
CREATE OR REPLACE FUNCTION app_private.confirmar_venda_nucleo(p_venda uuid, p_usuario text, p_pagamento jsonb,
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
      (now() AT TIME ZONE 'America/Sao_Paulo')::date, p_usuario, p_chave,
      app_private.ler_uuid(p_pagamento->'recebimento_inicial'->>'conta_id', 'conta_id'));   -- M07: conta escolhida (D7-16)
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

DROP FUNCTION public.registrar_recebimento(uuid, bigint, text, date, text);
CREATE FUNCTION public.registrar_recebimento(p_parcela_id uuid, p_valor_centavos bigint, p_forma text, p_data date,
  p_operation_key text, p_conta_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_parcela_id, p_valor_centavos, p_forma, p_data, p_conta_id));
  anterior jsonb;
  v_empresa uuid;
  v_origem text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_recebimento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT pa.empresa_id, t.origem_tipo INTO v_empresa, v_origem
    FROM public.parcelas_financeiras pa JOIN public.titulos_financeiros t ON t.id = pa.titulo_id WHERE pa.id = p_parcela_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Parcela não encontrada.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = v_empresa AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  -- Recebimento de venda: caixa (vendas.registrar_recebimento) ou financeiro. Conta a receber manual: só o financeiro.
  IF NOT (app_private.tem(v_empresa, usuario, 'financeiro.aprovar')
          OR (v_origem = 'venda' AND app_private.tem(v_empresa, usuario, 'vendas.registrar_recebimento'))) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite registrar recebimentos.');
  END IF;
  IF p_valor_centavos IS NULL OR p_valor_centavos <= 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um valor maior que zero.', 'valor_centavos');
  END IF;
  RETURN app_private.idem_fim(usuario, 'registrar_recebimento', p_operation_key, assinatura,
    app_private.receber_parcela(p_parcela_id, round(p_valor_centavos::numeric / 100, 2), p_forma,
      coalesce(p_data, app_private.hoje_sp()), usuario, p_operation_key, p_conta_id));
END $$;

-- Devolução de valor ao cliente depois do cancelamento (D6-09), saindo da conta escolhida.
DROP FUNCTION public.registrar_devolucao_valor(uuid, bigint, text, text, text);
CREATE FUNCTION public.registrar_devolucao_valor(p_titulo_id uuid, p_valor_centavos bigint, p_forma text, p_motivo text,
  p_operation_key text, p_conta_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_titulo_id, p_valor_centavos, p_forma, p_motivo, p_conta_id));
  anterior jsonb;
  t public.titulos_financeiros;
  c public.contas_financeiras;
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
  IF t.estado <> 'cancelado' OR t.origem_tipo <> 'venda' THEN
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
  c := app_private.conta_valida(t.empresa_id, coalesce(p_conta_id, app_private.conta_caixa(t.empresa_id)));
  INSERT INTO public.recebimentos (empresa_id, titulo_id, parcela_id, conta_id, tipo, valor, forma, data, motivo, autor, operation_key)
  VALUES (t.empresa_id, t.id, NULL, c.id, 'devolucao', v_valor, p_forma, app_private.hoje_sp(),
    nullif(btrim(coalesce(p_motivo, '')), ''), usuario, p_operation_key) RETURNING id INTO v_id;
  UPDATE public.titulos_financeiros SET a_devolver = a_devolver - v_valor, versao = versao + 1 WHERE id = t.id;
  PERFORM app_private.evento_comercial(t.empresa_id, 'valor_devolvido', usuario, 'titulo', t.id,
    jsonb_build_object('valor_centavos', p_valor_centavos, 'forma', p_forma, 'conta', c.nome), p_operation_key);
  PERFORM app_private.auditar(t.empresa_id, usuario, 'venda.valor_devolvido', 'recebimentos', v_id,
    jsonb_build_object('valor_centavos', p_valor_centavos, 'conta_id', c.id));
  RETURN app_private.idem_fim(usuario, 'registrar_devolucao_valor', p_operation_key, assinatura,
    jsonb_build_object('id', v_id, 'a_devolver_centavos', app_private.para_centavos(t.a_devolver - v_valor)));
END $$;

-- ===========================================================================
-- 5. Contas e categorias (RF-128, RF-121; D7-02 a D7-04)
-- ===========================================================================
CREATE FUNCTION app_private.conta_json(c public.contas_financeiras) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', c.id, 'nome', c.nome, 'tipo', c.tipo, 'permite_negativo', c.permite_negativo, 'padrao', c.padrao,
    'ativa', c.ativa, 'saldo_centavos', app_private.para_centavos(c.saldo), 'versao', c.versao)
$$;

CREATE FUNCTION app_private.nome_conta_livre(p_empresa uuid, p_nome text, p_exceto uuid) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.contas_financeiras WHERE empresa_id = p_empresa AND ativa AND lower(nome) = lower(p_nome)
              AND id IS DISTINCT FROM p_exceto) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Já existe uma conta ativa com este nome.', 'nome');
  END IF;
END $$;

CREATE FUNCTION public.criar_conta(p_empresa_id uuid, p_dados jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text));
  anterior jsonb;
  v_nome text;
  v_tipo text;
  v_neg boolean;
  v_inicial numeric;
  v_data date;
  c public.contas_financeiras;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_conta', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.criar']);
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['nome', 'tipo', 'permite_negativo', 'saldo_inicial_centavos', 'data_saldo_inicial']);
  v_nome := app_private.ler_texto(p_dados->>'nome', 2, 80, 'nome', 'Dê um nome à conta (2 a 80 caracteres).');
  v_tipo := p_dados->>'tipo';
  IF v_tipo IS NULL OR v_tipo NOT IN ('caixa', 'banco', 'carteira_digital', 'outro') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha o tipo: caixa, banco, carteira digital ou outro.', 'tipo');
  END IF;
  v_neg := coalesce((p_dados->>'permite_negativo')::boolean, false);
  IF v_neg AND v_tipo = 'caixa' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O caixa físico nunca fica negativo.', 'permite_negativo');
  END IF;
  v_inicial := coalesce(app_private.centavos(p_dados->'saldo_inicial_centavos', 'saldo_inicial_centavos', false, 0), 0);
  v_data := coalesce(app_private.ler_data(p_dados->>'data_saldo_inicial', 'data_saldo_inicial'), app_private.hoje_sp());
  PERFORM app_private.nome_conta_livre(p_empresa_id, v_nome, NULL);
  PERFORM app_private.conta_caixa(p_empresa_id);   -- toda empresa tem a conta padrão
  INSERT INTO public.contas_financeiras (empresa_id, nome, tipo, permite_negativo, criado_por)
  VALUES (p_empresa_id, v_nome, v_tipo, v_neg, usuario) RETURNING * INTO c;
  IF v_inicial > 0 THEN
    PERFORM app_private.lancar(p_empresa_id, c.id, v_data, 'entrada', v_inicial, 'saldo_inicial', 'ajuste', NULL, 'conta', c.id,
      NULL, NULL, 'Saldo inicial informado na criação da conta', NULL, usuario, p_operation_key);
    SELECT * INTO c FROM public.contas_financeiras WHERE id = c.id;
  END IF;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.conta_criada', 'contas_financeiras', c.id,
    jsonb_build_object('tipo', v_tipo, 'saldo_inicial_centavos', app_private.para_centavos(v_inicial)));
  RETURN app_private.idem_fim(usuario, 'criar_conta', p_operation_key, assinatura, app_private.conta_json(c));
END $$;

CREATE FUNCTION public.alterar_conta(p_conta_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_conta_id, p_dados::text, p_expected_version));
  anterior jsonb;
  c public.contas_financeiras;
  v_nome text;
  v_tipo text;
  v_neg boolean;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_conta', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.contas_financeiras WHERE id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Conta não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['financeiro.criar']);
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['nome', 'tipo', 'permite_negativo']);
  IF c.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta conta mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  v_nome := CASE WHEN p_dados ? 'nome' THEN app_private.ler_texto(p_dados->>'nome', 2, 80, 'nome', 'Dê um nome à conta (2 a 80 caracteres).') ELSE c.nome END;
  v_tipo := coalesce(p_dados->>'tipo', c.tipo);
  IF v_tipo NOT IN ('caixa', 'banco', 'carteira_digital', 'outro') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha o tipo: caixa, banco, carteira digital ou outro.', 'tipo');
  END IF;
  v_neg := coalesce((p_dados->>'permite_negativo')::boolean, c.permite_negativo);
  IF v_tipo = 'caixa' AND v_neg THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O caixa físico nunca fica negativo.', 'permite_negativo');
  END IF;
  IF NOT v_neg AND c.saldo < 0 THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A conta está negativa. Regularize o saldo antes de desligar o saldo negativo.', 'permite_negativo');
  END IF;
  IF c.ativa THEN
    PERFORM app_private.nome_conta_livre(c.empresa_id, v_nome, c.id);
  END IF;
  UPDATE public.contas_financeiras SET nome = v_nome, tipo = v_tipo, permite_negativo = v_neg, versao = versao + 1, atualizado_em = now()
   WHERE id = c.id RETURNING * INTO c;
  PERFORM app_private.auditar(c.empresa_id, usuario, 'financeiro.conta_alterada', 'contas_financeiras', c.id,
    jsonb_build_object('tipo', v_tipo, 'permite_negativo', v_neg));
  RETURN app_private.idem_fim(usuario, 'alterar_conta', p_operation_key, assinatura, app_private.conta_json(c));
END $$;

CREATE FUNCTION public.definir_conta_ativa(p_conta_id uuid, p_ativa boolean, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_conta_id, p_ativa, p_expected_version));
  anterior jsonb;
  c public.contas_financeiras;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_conta_ativa', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.contas_financeiras WHERE id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Conta não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['financeiro.criar']);
  IF c.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta conta mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF c.ativa = p_ativa THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN p_ativa THEN 'A conta já está ativa.' ELSE 'A conta já está desativada.' END);
  END IF;
  IF NOT p_ativa THEN
    IF c.padrao THEN
      PERFORM app_private.erro('STATE_CONFLICT', 'Esta é a conta padrão. Escolha outra conta padrão antes de desativar.');
    END IF;
    IF c.saldo <> 0 THEN
      PERFORM app_private.erro('STATE_CONFLICT', format('Só é possível desativar com saldo zero (saldo atual: %s). Transfira o saldo antes.',
        app_private.brl(c.saldo)));
    END IF;
  ELSE
    PERFORM app_private.nome_conta_livre(c.empresa_id, c.nome, c.id);
  END IF;
  UPDATE public.contas_financeiras SET ativa = p_ativa, versao = versao + 1, atualizado_em = now() WHERE id = c.id RETURNING * INTO c;
  PERFORM app_private.auditar(c.empresa_id, usuario, CASE WHEN p_ativa THEN 'financeiro.conta_reativada' ELSE 'financeiro.conta_desativada' END,
    'contas_financeiras', c.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'definir_conta_ativa', p_operation_key, assinatura, app_private.conta_json(c));
END $$;

-- Conta padrão: recebe os valores quando ninguém escolhe outra (balcão, pedidos).
CREATE FUNCTION public.definir_conta_padrao(p_conta_id uuid, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_conta_id, p_expected_version));
  anterior jsonb;
  c public.contas_financeiras;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_conta_padrao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.contas_financeiras WHERE id = p_conta_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Conta não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['financeiro.criar']);
  PERFORM 1 FROM public.contas_financeiras WHERE empresa_id = c.empresa_id AND (padrao OR id = c.id) ORDER BY id FOR UPDATE;
  SELECT * INTO c FROM public.contas_financeiras WHERE id = p_conta_id;
  IF c.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta conta mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF NOT c.ativa THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Reative a conta antes de torná-la padrão.');
  END IF;
  IF c.padrao THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta já é a conta padrão.');
  END IF;
  UPDATE public.contas_financeiras SET padrao = false, versao = versao + 1, atualizado_em = now() WHERE empresa_id = c.empresa_id AND padrao;
  UPDATE public.contas_financeiras SET padrao = true, versao = versao + 1, atualizado_em = now() WHERE id = c.id RETURNING * INTO c;
  PERFORM app_private.auditar(c.empresa_id, usuario, 'financeiro.conta_padrao', 'contas_financeiras', c.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'definir_conta_padrao', p_operation_key, assinatura, app_private.conta_json(c));
END $$;

CREATE FUNCTION app_private.categoria_json(c public.categorias_financeiras) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', c.id, 'tipo', c.tipo, 'nome', c.nome, 'sistema', c.codigo_sistema IS NOT NULL,
    'codigo_sistema', c.codigo_sistema, 'ativa', c.ativa, 'ordem', c.ordem, 'versao', c.versao)
$$;

CREATE FUNCTION app_private.nome_categoria_livre(p_empresa uuid, p_tipo text, p_nome text, p_exceto uuid) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND tipo = p_tipo AND ativa
              AND lower(nome) = lower(p_nome) AND id IS DISTINCT FROM p_exceto) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Já existe uma categoria ativa com este nome.', 'nome');
  END IF;
END $$;

CREATE FUNCTION public.criar_categoria_financeira(p_empresa_id uuid, p_dados jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text));
  anterior jsonb;
  v_tipo text;
  v_nome text;
  c public.categorias_financeiras;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_categoria_financeira', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.criar']);
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['tipo', 'nome']);
  PERFORM app_private.garantir_categorias(p_empresa_id);
  v_tipo := p_dados->>'tipo';
  IF v_tipo IS NULL OR v_tipo NOT IN ('receita', 'despesa') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha se é categoria de receita ou de despesa.', 'tipo');
  END IF;
  v_nome := app_private.ler_texto(p_dados->>'nome', 2, 60, 'nome', 'Dê um nome à categoria (2 a 60 caracteres).');
  PERFORM app_private.nome_categoria_livre(p_empresa_id, v_tipo, v_nome, NULL);
  INSERT INTO public.categorias_financeiras (empresa_id, tipo, nome) VALUES (p_empresa_id, v_tipo, v_nome) RETURNING * INTO c;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.categoria_criada', 'categorias_financeiras', c.id, jsonb_build_object('tipo', v_tipo));
  RETURN app_private.idem_fim(usuario, 'criar_categoria_financeira', p_operation_key, assinatura, app_private.categoria_json(c));
END $$;

CREATE FUNCTION public.alterar_categoria_financeira(p_categoria_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_categoria_id, p_dados::text, p_expected_version));
  anterior jsonb;
  c public.categorias_financeiras;
  v_nome text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_categoria_financeira', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.categorias_financeiras WHERE id = p_categoria_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Categoria não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['financeiro.criar']);
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['nome']);
  IF c.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta categoria mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF c.codigo_sistema IS NOT NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Categorias do sistema (Vendas e Compras) não são renomeadas nem desativadas.');
  END IF;
  v_nome := app_private.ler_texto(p_dados->>'nome', 2, 60, 'nome', 'Dê um nome à categoria (2 a 60 caracteres).');
  IF c.ativa THEN
    PERFORM app_private.nome_categoria_livre(c.empresa_id, c.tipo, v_nome, c.id);
  END IF;
  UPDATE public.categorias_financeiras SET nome = v_nome, versao = versao + 1 WHERE id = c.id RETURNING * INTO c;
  PERFORM app_private.auditar(c.empresa_id, usuario, 'financeiro.categoria_alterada', 'categorias_financeiras', c.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'alterar_categoria_financeira', p_operation_key, assinatura, app_private.categoria_json(c));
END $$;

CREATE FUNCTION public.definir_categoria_ativa(p_categoria_id uuid, p_ativa boolean, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_categoria_id, p_ativa, p_expected_version));
  anterior jsonb;
  c public.categorias_financeiras;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_categoria_ativa', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.categorias_financeiras WHERE id = p_categoria_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Categoria não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['financeiro.criar']);
  IF c.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta categoria mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF c.codigo_sistema IS NOT NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Categorias do sistema (Vendas e Compras) não são renomeadas nem desativadas.');
  END IF;
  IF c.ativa = p_ativa THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN p_ativa THEN 'A categoria já está ativa.' ELSE 'A categoria já está desativada.' END);
  END IF;
  IF NOT p_ativa AND EXISTS (SELECT 1 FROM public.despesas_recorrentes WHERE categoria_id = c.id AND ativa) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Uma despesa recorrente ativa usa esta categoria. Altere ou pause a recorrência antes.');
  END IF;
  IF p_ativa THEN
    PERFORM app_private.nome_categoria_livre(c.empresa_id, c.tipo, c.nome, c.id);
  END IF;
  UPDATE public.categorias_financeiras SET ativa = p_ativa, versao = versao + 1 WHERE id = c.id RETURNING * INTO c;
  PERFORM app_private.auditar(c.empresa_id, usuario, 'financeiro.categoria_' || CASE WHEN p_ativa THEN 'reativada' ELSE 'desativada' END,
    'categorias_financeiras', c.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'definir_categoria_ativa', p_operation_key, assinatura, app_private.categoria_json(c));
END $$;

-- ===========================================================================
-- 6. Contas a receber e a pagar, baixas, lançamentos avulsos, transferências e proprietário
-- ===========================================================================
CREATE FUNCTION app_private.estado_exibicao(p_estado text, p_vencimento date, p_parcial boolean) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  -- D7-10: "vencido" é calculado na leitura (fuso de São Paulo), nunca gravado.
  SELECT CASE
    WHEN p_estado IN ('cancelada', 'cancelado') THEN 'cancelado'
    WHEN p_estado IN ('liquidada', 'liquidado') THEN 'liquidado'
    WHEN p_vencimento IS NOT NULL AND p_vencimento < app_private.hoje_sp() THEN 'vencido'
    WHEN p_parcial THEN 'parcial'
    ELSE 'pendente' END
$$;

CREATE FUNCTION app_private.titulo_json(p_titulo uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', t.id, 'tipo', t.tipo, 'origem_tipo', t.origem_tipo, 'origem_id', t.origem_id, 'descricao', t.descricao,
    'categoria_id', t.categoria_id, 'categoria', c.nome, 'competencia', t.competencia,
    'contraparte_tipo', t.contraparte_tipo, 'contraparte', coalesce(ce.nome, f.nome, t.contraparte_texto),
    'total_centavos', app_private.para_centavos(t.total), 'baixado_centavos', app_private.para_centavos(t.recebido),
    'saldo_centavos', app_private.para_centavos(t.total - t.recebido) * CASE WHEN t.estado = 'cancelado' THEN 0 ELSE 1 END,
    'a_devolver_centavos', app_private.para_centavos(t.a_devolver), 'estado', t.estado,
    'estado_exibicao', app_private.estado_exibicao(t.estado,
      (SELECT min(pa.vencimento) FROM public.parcelas_financeiras pa WHERE pa.titulo_id = t.id AND pa.estado IN ('aberta', 'parcial')),
      t.estado = 'parcial'),
    'proximo_vencimento', (SELECT min(pa.vencimento) FROM public.parcelas_financeiras pa WHERE pa.titulo_id = t.id AND pa.estado IN ('aberta', 'parcial')),
    'motivo_cancelamento', t.motivo_cancelamento, 'versao', t.versao, 'criado_em', t.criado_em,
    'parcelas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', pa.id, 'sequencia', pa.sequencia,
        'valor_centavos', app_private.para_centavos(pa.valor), 'saldo_centavos', app_private.para_centavos(pa.saldo),
        'vencimento', pa.vencimento, 'estado', pa.estado,
        'estado_exibicao', app_private.estado_exibicao(pa.estado, pa.vencimento, pa.estado = 'parcial'), 'versao', pa.versao)
        ORDER BY pa.sequencia) FROM public.parcelas_financeiras pa WHERE pa.titulo_id = t.id), '[]'::jsonb))
    FROM public.titulos_financeiros t
    LEFT JOIN public.categorias_financeiras c ON c.id = t.categoria_id
    LEFT JOIN public.clientes_empresa ce ON ce.id = t.cliente_empresa_id
    LEFT JOIN public.fornecedores f ON f.id = t.fornecedor_id
   WHERE t.id = p_titulo
$$;

-- Parcelas de um título novo: 1 a 24, vencimentos em ordem, soma = total (D6-13). Sem juros nem multa (FIN-D05).
CREATE FUNCTION app_private.gravar_parcelas(p_empresa uuid, p_titulo uuid, p_dados jsonb) RETURNS numeric
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_lista jsonb;
  e jsonb;
  v_seq integer := 0;
  v_soma numeric := 0;
  v_valor numeric;
  v_venc date;
  v_anterior date;
BEGIN
  IF p_dados ? 'parcelas' THEN
    v_lista := p_dados->'parcelas';
    IF jsonb_typeof(v_lista) <> 'array' OR jsonb_array_length(v_lista) NOT BETWEEN 1 AND 24 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Informe de 1 a 24 parcelas.', 'parcelas');
    END IF;
  ELSE
    v_lista := jsonb_build_array(jsonb_build_object('valor_centavos', p_dados->'valor_centavos', 'vencimento', p_dados->'vencimento'));
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(v_lista) LOOP
    v_seq := v_seq + 1;
    v_valor := app_private.centavos(e->'valor_centavos', 'valor_centavos', true, 1);
    v_venc := app_private.ler_data(e->>'vencimento', 'vencimento');
    IF v_venc IS NULL OR v_venc < app_private.hoje_sp() - 3650 OR v_venc > app_private.hoje_sp() + 3650 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o vencimento de cada parcela.', 'vencimento');
    END IF;
    IF v_anterior IS NOT NULL AND v_venc < v_anterior THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Os vencimentos precisam estar em ordem.', 'vencimento');
    END IF;
    v_anterior := v_venc;
    v_soma := v_soma + v_valor;
    INSERT INTO public.parcelas_financeiras (empresa_id, titulo_id, sequencia, valor, vencimento, saldo)
    VALUES (p_empresa, p_titulo, v_seq, v_valor, v_venc, v_valor);
  END LOOP;
  UPDATE public.titulos_financeiros SET total = v_soma WHERE id = p_titulo;
  RETURN v_soma;
END $$;

CREATE FUNCTION public.criar_titulo(p_empresa_id uuid, p_dados jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text));
  anterior jsonb;
  v_tipo text := p_dados->>'tipo';
  v_desc text;
  v_cat uuid;
  v_comp date;
  v_ctipo text := nullif(p_dados->>'contraparte_tipo', '');
  v_cliente uuid;
  v_forn uuid;
  v_texto text;
  v_id uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_titulo', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.criar']);
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['tipo', 'descricao', 'categoria_id', 'competencia', 'contraparte_tipo',
    'cliente_empresa_id', 'fornecedor_id', 'contraparte_texto', 'valor_centavos', 'vencimento', 'parcelas']);
  IF v_tipo IS NULL OR v_tipo NOT IN ('receber', 'pagar') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha se é conta a receber ou a pagar.', 'tipo');
  END IF;
  v_desc := app_private.ler_texto(p_dados->>'descricao', 2, 120, 'descricao', 'Descreva a conta (2 a 120 caracteres).');
  v_cat := app_private.categoria_valida(p_empresa_id, app_private.ler_uuid(p_dados->>'categoria_id', 'categoria_id'),
    CASE v_tipo WHEN 'receber' THEN 'receita' ELSE 'despesa' END);
  v_comp := coalesce(app_private.ler_data(p_dados->>'competencia', 'competencia'), app_private.hoje_sp());
  IF v_comp > app_private.hoje_sp() + 3650 OR v_comp < app_private.hoje_sp() - 3650 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Mês de referência inválido.', 'competencia');
  END IF;
  PERFORM app_private.exigir_competencia_aberta(p_empresa_id, v_comp);
  IF v_ctipo IS NOT NULL AND v_ctipo NOT IN ('cliente', 'fornecedor', 'texto') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Contraparte inválida.', 'contraparte_tipo');
  END IF;
  IF v_ctipo = 'cliente' THEN
    v_cliente := app_private.ler_uuid(p_dados->>'cliente_empresa_id', 'cliente_empresa_id');
    IF NOT EXISTS (SELECT 1 FROM public.clientes_empresa WHERE id = v_cliente AND empresa_id = p_empresa_id) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha um cliente desta empresa.', 'cliente_empresa_id');
    END IF;
  ELSIF v_ctipo = 'fornecedor' THEN
    v_forn := app_private.ler_uuid(p_dados->>'fornecedor_id', 'fornecedor_id');
    IF NOT EXISTS (SELECT 1 FROM public.fornecedores WHERE id = v_forn AND empresa_id = p_empresa_id) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha um fornecedor desta empresa.', 'fornecedor_id');
    END IF;
  ELSIF v_ctipo = 'texto' THEN
    v_texto := app_private.ler_texto(p_dados->>'contraparte_texto', 2, 120, 'contraparte_texto', 'Diga de quem é ou para quem é (2 a 120 caracteres).');
  END IF;
  INSERT INTO public.titulos_financeiros (empresa_id, tipo, origem_tipo, origem_id, descricao, total, categoria_id, competencia,
    contraparte_tipo, cliente_empresa_id, fornecedor_id, contraparte_texto, criado_por)
  VALUES (p_empresa_id, v_tipo, 'manual', NULL, v_desc, 0, v_cat, v_comp, v_ctipo, v_cliente, v_forn, v_texto, usuario)
  RETURNING id INTO v_id;
  PERFORM app_private.gravar_parcelas(p_empresa_id, v_id, p_dados);
  PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.titulo_criado', 'titulos_financeiros', v_id,
    jsonb_build_object('tipo', v_tipo, 'total_centavos', (SELECT app_private.para_centavos(total) FROM public.titulos_financeiros WHERE id = v_id)));
  RETURN app_private.idem_fim(usuario, 'criar_titulo', p_operation_key, assinatura, app_private.titulo_json(v_id));
END $$;

CREATE FUNCTION public.cancelar_titulo(p_titulo_id uuid, p_motivo text, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_titulo_id, p_motivo, p_expected_version));
  anterior jsonb;
  t public.titulos_financeiros;
  v_motivo text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'cancelar_titulo', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO t FROM public.titulos_financeiros WHERE id = p_titulo_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Conta não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(t.empresa_id, usuario, ARRAY['financeiro.cancelar']);
  IF t.origem_tipo = 'venda' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A conta de uma venda é cancelada pela própria venda.');
  END IF;
  IF t.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta conta mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF t.estado = 'cancelado' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta conta já foi cancelada.');
  END IF;
  IF t.recebido > 0 THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE t.tipo WHEN 'pagar' THEN 'Há pagamentos registrados. Estorne-os antes de cancelar.'
      ELSE 'Há recebimentos registrados. Estorne-os antes de cancelar.' END);
  END IF;
  v_motivo := app_private.ler_texto(p_motivo, 10, 300, 'motivo', 'Explique o cancelamento (10 a 300 caracteres).');
  UPDATE public.parcelas_financeiras SET estado = 'cancelada', versao = versao + 1 WHERE titulo_id = t.id;
  UPDATE public.titulos_financeiros SET estado = 'cancelado', cancelado_em = now(), cancelado_por = usuario, motivo_cancelamento = v_motivo,
    versao = versao + 1 WHERE id = t.id;
  PERFORM app_private.auditar(t.empresa_id, usuario, 'financeiro.titulo_cancelado', 'titulos_financeiros', t.id, jsonb_build_object('motivo', v_motivo));
  RETURN app_private.idem_fim(usuario, 'cancelar_titulo', p_operation_key, assinatura, app_private.titulo_json(t.id));
END $$;

-- Pagamento de parcela de conta a pagar (API-027): trava parcela e título; o lançamento de saída sai junto.
CREATE FUNCTION public.registrar_pagamento(p_parcela_id uuid, p_valor_centavos bigint, p_conta_id uuid, p_forma text, p_data date,
  p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_parcela_id, p_valor_centavos, p_conta_id, p_forma, p_data));
  anterior jsonb;
  pa public.parcelas_financeiras;
  t public.titulos_financeiros;
  c public.contas_financeiras;
  v_valor numeric;
  v_data date := coalesce(p_data, app_private.hoje_sp());
  v_id uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_pagamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO pa FROM public.parcelas_financeiras WHERE id = p_parcela_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Parcela não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(pa.empresa_id, usuario, ARRAY['financeiro.aprovar']);
  SELECT * INTO pa FROM public.parcelas_financeiras WHERE id = p_parcela_id FOR UPDATE;
  SELECT * INTO t FROM public.titulos_financeiros WHERE id = pa.titulo_id FOR UPDATE;
  IF t.tipo <> 'pagar' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta é uma conta a receber: registre um recebimento.');
  END IF;
  IF t.estado = 'cancelado' OR pa.estado = 'cancelada' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta conta foi cancelada; não recebe pagamentos.');
  END IF;
  IF p_valor_centavos IS NULL OR p_valor_centavos <= 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um valor maior que zero.', 'valor_centavos');
  END IF;
  v_valor := round(p_valor_centavos::numeric / 100, 2);
  IF v_valor > pa.saldo THEN
    PERFORM app_private.erro('PAYMENT_EXCEEDS_BALANCE',
      format('O valor é maior que o saldo da parcela (%s).', app_private.brl(pa.saldo)), 'valor_centavos');
  END IF;
  IF p_forma IS NULL OR p_forma NOT IN ('dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia', 'outro') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha a forma de pagamento.', 'forma');
  END IF;
  c := app_private.conta_valida(pa.empresa_id, p_conta_id);
  INSERT INTO public.pagamentos (empresa_id, titulo_id, parcela_id, conta_id, tipo, valor, forma, data, autor, operation_key)
  VALUES (pa.empresa_id, t.id, pa.id, c.id, 'pagamento', v_valor, p_forma, v_data, usuario, p_operation_key) RETURNING id INTO v_id;
  UPDATE public.parcelas_financeiras SET saldo = saldo - v_valor,
    estado = CASE WHEN saldo - v_valor = 0 THEN 'liquidada' ELSE 'parcial' END, versao = versao + 1 WHERE id = pa.id;
  UPDATE public.titulos_financeiros SET recebido = recebido + v_valor,
    estado = CASE WHEN recebido + v_valor = total THEN 'liquidado' ELSE 'parcial' END, versao = versao + 1 WHERE id = t.id;
  PERFORM app_private.auditar(pa.empresa_id, usuario, 'financeiro.pagamento', 'pagamentos', v_id,
    jsonb_build_object('valor_centavos', p_valor_centavos, 'forma', p_forma, 'conta_id', c.id));
  RETURN app_private.idem_fim(usuario, 'registrar_pagamento', p_operation_key, assinatura,
    jsonb_build_object('pagamento_id', v_id, 'parcela_id', pa.id, 'conta_id', c.id,
      'saldo_parcela_centavos', app_private.para_centavos(pa.saldo - v_valor),
      'saldo_titulo_centavos', app_private.para_centavos(t.total - t.recebido - v_valor)));
END $$;

CREATE FUNCTION public.estornar_pagamento(p_pagamento_id uuid, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_pagamento_id, p_motivo));
  anterior jsonb;
  g public.pagamentos;
  v_motivo text;
  v_id uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'estornar_pagamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO g FROM public.pagamentos WHERE id = p_pagamento_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Pagamento não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(g.empresa_id, usuario, ARRAY['financeiro.cancelar']);
  PERFORM 1 FROM public.parcelas_financeiras WHERE id = g.parcela_id FOR UPDATE;
  PERFORM 1 FROM public.titulos_financeiros WHERE id = g.titulo_id FOR UPDATE;
  IF g.tipo <> 'pagamento' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só pagamentos podem ser estornados.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.pagamentos WHERE estorno_de = g.id) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este pagamento já foi estornado.');
  END IF;
  v_motivo := app_private.ler_texto(p_motivo, 10, 300, 'motivo', 'Explique o estorno (10 a 300 caracteres).');
  INSERT INTO public.pagamentos (empresa_id, titulo_id, parcela_id, conta_id, tipo, valor, forma, data, motivo, estorno_de, autor, operation_key)
  VALUES (g.empresa_id, g.titulo_id, g.parcela_id, g.conta_id, 'estorno', g.valor, g.forma, app_private.hoje_sp(), v_motivo, g.id,
    usuario, p_operation_key) RETURNING id INTO v_id;
  UPDATE public.parcelas_financeiras SET saldo = saldo + g.valor, estado = CASE WHEN saldo + g.valor = valor THEN 'aberta' ELSE 'parcial' END,
    versao = versao + 1 WHERE id = g.parcela_id;
  UPDATE public.titulos_financeiros SET recebido = recebido - g.valor, estado = CASE WHEN recebido - g.valor = 0 THEN 'aberto' ELSE 'parcial' END,
    versao = versao + 1 WHERE id = g.titulo_id;
  PERFORM app_private.auditar(g.empresa_id, usuario, 'financeiro.pagamento_estornado', 'pagamentos', v_id, jsonb_build_object('estorno_de', g.id));
  RETURN app_private.idem_fim(usuario, 'estornar_pagamento', p_operation_key, assinatura, jsonb_build_object('id', v_id, 'estorno_de', g.id));
END $$;

CREATE FUNCTION app_private.lancamento_json(l public.lancamentos_financeiros) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', l.id, 'data', l.data, 'sentido', l.sentido, 'valor_centavos', app_private.para_centavos(l.valor),
    'tipo', l.tipo, 'natureza', l.natureza, 'categoria_id', l.categoria_id,
    'categoria', (SELECT nome FROM public.categorias_financeiras WHERE id = l.categoria_id),
    'conta_id', l.conta_id, 'conta', (SELECT nome FROM public.contas_financeiras WHERE id = l.conta_id),
    'descricao', coalesce(l.descricao, (SELECT descricao FROM public.titulos_financeiros WHERE id = l.titulo_id)),
    'origem_tipo', l.origem_tipo, 'origem_id', l.origem_id, 'titulo_id', l.titulo_id, 'estorno_de', l.estorno_de,
    'estornado', EXISTS (SELECT 1 FROM public.lancamentos_financeiros x WHERE x.estorno_de = l.id),
    'carga_m06', l.carga_m06, 'autor', app_private.nome_da_pessoa(l.autor), 'criado_em', l.criado_em)
$$;

-- Receita ou despesa avulsa à vista, sem conta a pagar ou a receber (RF-120, RF-121, RF-126).
CREATE FUNCTION public.registrar_lancamento(p_empresa_id uuid, p_dados jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text));
  anterior jsonb;
  v_tipo text := p_dados->>'tipo';
  c public.contas_financeiras;
  v_valor numeric;
  v_cat uuid;
  v_desc text;
  v_id uuid;
  l public.lancamentos_financeiros;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_lancamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.aprovar']);
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['tipo', 'conta_id', 'valor_centavos', 'data', 'categoria_id', 'descricao']);
  IF v_tipo IS NULL OR v_tipo NOT IN ('receita_avulsa', 'despesa_avulsa') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha se é uma entrada (receita) ou uma saída (despesa).', 'tipo');
  END IF;
  c := app_private.conta_valida(p_empresa_id, app_private.ler_uuid(p_dados->>'conta_id', 'conta_id'));
  v_valor := app_private.centavos(p_dados->'valor_centavos', 'valor_centavos', true, 1);
  v_cat := app_private.categoria_valida(p_empresa_id, app_private.ler_uuid(p_dados->>'categoria_id', 'categoria_id'),
    CASE v_tipo WHEN 'receita_avulsa' THEN 'receita' ELSE 'despesa' END);
  v_desc := app_private.ler_texto(p_dados->>'descricao', 2, 300, 'descricao', 'Descreva o lançamento (2 a 300 caracteres).');
  v_id := app_private.lancar(p_empresa_id, c.id, coalesce(app_private.ler_data(p_dados->>'data', 'data'), app_private.hoje_sp()),
    CASE v_tipo WHEN 'receita_avulsa' THEN 'entrada' ELSE 'saida' END, v_valor, v_tipo,
    CASE v_tipo WHEN 'receita_avulsa' THEN 'receita' ELSE 'despesa' END, v_cat, 'manual', NULL, NULL, NULL, v_desc, NULL, usuario, p_operation_key);
  SELECT * INTO l FROM public.lancamentos_financeiros WHERE id = v_id;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.lancamento', 'lancamentos_financeiros', v_id,
    jsonb_build_object('tipo', v_tipo, 'valor_centavos', app_private.para_centavos(v_valor)));
  RETURN app_private.idem_fim(usuario, 'registrar_lancamento', p_operation_key, assinatura, app_private.lancamento_json(l));
END $$;

-- Aporte e retirada do proprietário (RF-130, D7-05, D7-06): só o proprietário; nunca receita nem despesa (RN-027, FIN-I22).
CREATE FUNCTION public.registrar_movimento_proprietario(p_empresa_id uuid, p_dados jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text));
  anterior jsonb;
  v_tipo text := p_dados->>'tipo';
  c public.contas_financeiras;
  v_valor numeric;
  v_id uuid;
  l public.lancamentos_financeiros;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_movimento_proprietario', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_proprietario(p_empresa_id, usuario, 'Só o proprietário registra aportes e retiradas.');
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['tipo', 'conta_id', 'valor_centavos', 'data', 'descricao']);
  IF v_tipo IS NULL OR v_tipo NOT IN ('retirada', 'aporte') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha retirada ou aporte.', 'tipo');
  END IF;
  c := app_private.conta_valida(p_empresa_id, app_private.ler_uuid(p_dados->>'conta_id', 'conta_id'));
  v_valor := app_private.centavos(p_dados->'valor_centavos', 'valor_centavos', true, 1);
  v_id := app_private.lancar(p_empresa_id, c.id, coalesce(app_private.ler_data(p_dados->>'data', 'data'), app_private.hoje_sp()),
    CASE v_tipo WHEN 'aporte' THEN 'entrada' ELSE 'saida' END, v_valor, v_tipo, 'proprietario', NULL, 'manual', NULL, NULL, NULL,
    coalesce(app_private.ler_texto(p_dados->>'descricao', 0, 300, 'descricao', 'Descrição de até 300 caracteres.'),
      CASE v_tipo WHEN 'aporte' THEN 'Aporte do proprietário' ELSE 'Retirada do proprietário' END),
    NULL, usuario, p_operation_key);
  SELECT * INTO l FROM public.lancamentos_financeiros WHERE id = v_id;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.' || v_tipo, 'lancamentos_financeiros', v_id,
    jsonb_build_object('valor_centavos', app_private.para_centavos(v_valor)));
  RETURN app_private.idem_fim(usuario, 'registrar_movimento_proprietario', p_operation_key, assinatura, app_private.lancamento_json(l));
END $$;

-- Estorno de lançamento manual (avulso, saldo inicial, aporte ou retirada). Baixas e transferências têm o próprio estorno.
CREATE FUNCTION public.estornar_lancamento(p_lancamento_id uuid, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_lancamento_id, p_motivo));
  anterior jsonb;
  o public.lancamentos_financeiros;
  v_motivo text;
  v_id uuid;
  l public.lancamentos_financeiros;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'estornar_lancamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO o FROM public.lancamentos_financeiros WHERE id = p_lancamento_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Lançamento não encontrado.');
  END IF;
  IF o.tipo IN ('retirada', 'aporte') THEN
    PERFORM app_private.exigir_proprietario(o.empresa_id, usuario, 'Só o proprietário estorna aportes e retiradas.');
  ELSE
    PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['financeiro.cancelar']);
  END IF;
  IF o.tipo NOT IN ('receita_avulsa', 'despesa_avulsa', 'saldo_inicial', 'retirada', 'aporte') THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE
      WHEN o.origem_tipo = 'recebimento' THEN 'Este lançamento veio de um recebimento: estorne o recebimento.'
      WHEN o.origem_tipo = 'pagamento' THEN 'Este lançamento veio de um pagamento: estorne o pagamento.'
      WHEN o.origem_tipo = 'transferencia' THEN 'Este lançamento faz parte de uma transferência: estorne a transferência.'
      ELSE 'Este lançamento não pode ser estornado.' END);
  END IF;
  v_motivo := app_private.ler_texto(p_motivo, 10, 300, 'motivo', 'Explique o estorno (10 a 300 caracteres).');
  v_id := app_private.lancar_estorno(o.id, 'estorno', o.id, v_motivo, usuario, p_operation_key);
  SELECT * INTO l FROM public.lancamentos_financeiros WHERE id = v_id;
  PERFORM app_private.auditar(o.empresa_id, usuario, 'financeiro.lancamento_estornado', 'lancamentos_financeiros', v_id,
    jsonb_build_object('estorno_de', o.id));
  RETURN app_private.idem_fim(usuario, 'estornar_lancamento', p_operation_key, assinatura, app_private.lancamento_json(l));
END $$;

-- Transferência entre contas da mesma empresa (RF-129, API-028): dois lançamentos ligados, natureza "interna".
-- Travas das duas contas em ordem de id: transferências em sentidos opostos nunca travam uma à outra.
CREATE FUNCTION app_private.executar_transferencia(p_empresa uuid, p_origem uuid, p_destino uuid, p_valor numeric, p_data date,
  p_descricao text, p_estorno_de uuid, p_motivo text, p_usuario text, p_chave text) RETURNS uuid
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app_private.exigir_data_aberta(p_empresa, p_data);
  PERFORM 1 FROM public.contas_financeiras WHERE id IN (p_origem, p_destino) ORDER BY id FOR UPDATE;
  INSERT INTO public.transferencias_financeiras (empresa_id, conta_origem_id, conta_destino_id, valor, data, descricao, estorno_de,
    motivo, autor, operation_key)
  VALUES (p_empresa, p_origem, p_destino, p_valor, p_data, p_descricao, p_estorno_de, p_motivo, p_usuario, p_chave) RETURNING id INTO v_id;
  PERFORM app_private.lancar(p_empresa, p_origem, p_data, 'saida', p_valor, 'transferencia_saida', 'interna', NULL, 'transferencia', v_id,
    NULL, NULL, coalesce(p_descricao, p_motivo), NULL, p_usuario, p_chave);
  PERFORM app_private.lancar(p_empresa, p_destino, p_data, 'entrada', p_valor, 'transferencia_entrada', 'interna', NULL, 'transferencia', v_id,
    NULL, NULL, coalesce(p_descricao, p_motivo), NULL, p_usuario, p_chave);
  RETURN v_id;
END $$;

CREATE FUNCTION app_private.transferencia_json(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', t.id, 'conta_origem_id', t.conta_origem_id, 'conta_origem', o.nome, 'conta_destino_id', t.conta_destino_id,
    'conta_destino', d.nome, 'valor_centavos', app_private.para_centavos(t.valor), 'data', t.data, 'descricao', t.descricao,
    'estorno_de', t.estorno_de, 'motivo', t.motivo,
    'estornada', EXISTS (SELECT 1 FROM public.transferencias_financeiras x WHERE x.estorno_de = t.id),
    'saldo_origem_centavos', app_private.para_centavos(o.saldo), 'saldo_destino_centavos', app_private.para_centavos(d.saldo))
    FROM public.transferencias_financeiras t
    JOIN public.contas_financeiras o ON o.id = t.conta_origem_id
    JOIN public.contas_financeiras d ON d.id = t.conta_destino_id
   WHERE t.id = p_id
$$;

CREATE FUNCTION public.transferir(p_empresa_id uuid, p_dados jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text));
  anterior jsonb;
  o public.contas_financeiras;
  d public.contas_financeiras;
  v_valor numeric;
  v_id uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'transferir', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.aprovar']);
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['conta_origem_id', 'conta_destino_id', 'valor_centavos', 'data', 'descricao']);
  o := app_private.conta_valida(p_empresa_id, app_private.ler_uuid(p_dados->>'conta_origem_id', 'conta_origem_id'), 'conta_origem_id');
  d := app_private.conta_valida(p_empresa_id, app_private.ler_uuid(p_dados->>'conta_destino_id', 'conta_destino_id'), 'conta_destino_id');
  IF o.id = d.id THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha contas diferentes para origem e destino.', 'conta_destino_id');
  END IF;
  v_valor := app_private.centavos(p_dados->'valor_centavos', 'valor_centavos', true, 1);
  v_id := app_private.executar_transferencia(p_empresa_id, o.id, d.id, v_valor,
    coalesce(app_private.ler_data(p_dados->>'data', 'data'), app_private.hoje_sp()),
    app_private.ler_texto(p_dados->>'descricao', 0, 300, 'descricao', 'Descrição de até 300 caracteres.'), NULL, NULL, usuario, p_operation_key);
  PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.transferencia', 'transferencias_financeiras', v_id,
    jsonb_build_object('valor_centavos', app_private.para_centavos(v_valor), 'origem', o.id, 'destino', d.id));
  RETURN app_private.idem_fim(usuario, 'transferir', p_operation_key, assinatura, app_private.transferencia_json(v_id));
END $$;

CREATE FUNCTION public.estornar_transferencia(p_transferencia_id uuid, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_transferencia_id, p_motivo));
  anterior jsonb;
  t public.transferencias_financeiras;
  v_motivo text;
  v_id uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'estornar_transferencia', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO t FROM public.transferencias_financeiras WHERE id = p_transferencia_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Transferência não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(t.empresa_id, usuario, ARRAY['financeiro.cancelar']);
  IF t.estorno_de IS NOT NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta transferência já é um estorno.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.transferencias_financeiras WHERE estorno_de = t.id) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta transferência já foi estornada.');
  END IF;
  v_motivo := app_private.ler_texto(p_motivo, 10, 300, 'motivo', 'Explique o estorno (10 a 300 caracteres).');
  PERFORM app_private.conta_valida(t.empresa_id, t.conta_origem_id);
  PERFORM app_private.conta_valida(t.empresa_id, t.conta_destino_id);
  v_id := app_private.executar_transferencia(t.empresa_id, t.conta_destino_id, t.conta_origem_id, t.valor, app_private.hoje_sp(),
    NULL, t.id, v_motivo, usuario, p_operation_key);
  PERFORM app_private.auditar(t.empresa_id, usuario, 'financeiro.transferencia_estornada', 'transferencias_financeiras', v_id,
    jsonb_build_object('estorno_de', t.id));
  RETURN app_private.idem_fim(usuario, 'estornar_transferencia', p_operation_key, assinatura, app_private.transferencia_json(v_id));
END $$;

-- ===========================================================================
-- 7. Despesas recorrentes (RF-125; D7-08, D7-09) e conta a pagar de compra (RF-127; D7-07)
-- ===========================================================================
CREATE FUNCTION app_private.vencimento_no_mes(p_mes date, p_dia integer) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  -- D7-09: dia inexistente (29, 30 ou 31) vira o último dia do mês; sem ajuste por feriado.
  SELECT make_date(extract(year FROM p_mes)::integer, extract(month FROM p_mes)::integer,
    least(p_dia, extract(day FROM (date_trunc('month', p_mes) + interval '1 month - 1 day'))::integer))
$$;

-- Competências de uma regra, de `de` até `ate` (meses), respeitando início, fim e periodicidade.
CREATE FUNCTION app_private.competencias_da_regra(r public.despesas_recorrentes, p_de date, p_ate date) RETURNS SETOF date
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT m::date FROM generate_series(greatest(r.inicio, date_trunc('month', p_de)::date),
                                      least(coalesce(r.fim, date_trunc('month', p_ate)::date), date_trunc('month', p_ate)::date),
                                      interval '1 month') AS m
   WHERE r.periodicidade = 'mensal' OR extract(month FROM m) = extract(month FROM r.inicio)
$$;

CREATE FUNCTION app_private.recorrencia_json(r public.despesas_recorrentes) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', r.id, 'descricao', r.descricao, 'valor_centavos', app_private.para_centavos(r.valor),
    'categoria_id', r.categoria_id, 'categoria', (SELECT nome FROM public.categorias_financeiras WHERE id = r.categoria_id),
    'fornecedor_id', r.fornecedor_id, 'fornecedor', (SELECT nome FROM public.fornecedores WHERE id = r.fornecedor_id),
    'periodicidade', r.periodicidade, 'dia_vencimento', r.dia_vencimento, 'inicio', r.inicio, 'fim', r.fim, 'ativa', r.ativa,
    'versao', r.versao,
    'gerados', (SELECT count(*) FROM public.titulos_financeiros t WHERE t.origem_tipo = 'recorrencia' AND t.origem_id = r.id),
    'ultimo_gerado', (SELECT max(competencia) FROM public.titulos_financeiros t WHERE t.origem_tipo = 'recorrencia' AND t.origem_id = r.id),
    -- D7-10: "previsto" = projeção ainda não gerada (próximas ocorrências depois do mês atual).
    'previstos', CASE WHEN r.ativa THEN coalesce((SELECT jsonb_agg(jsonb_build_object('competencia', m,
        'vencimento', app_private.vencimento_no_mes(m, r.dia_vencimento), 'valor_centavos', app_private.para_centavos(r.valor)) ORDER BY m)
      FROM (SELECT m FROM app_private.competencias_da_regra(r, (date_trunc('month', app_private.hoje_sp()) + interval '1 month')::date,
              (date_trunc('month', app_private.hoje_sp()) + interval '12 months')::date) AS m LIMIT 3) x), '[]'::jsonb)
      ELSE '[]'::jsonb END)
$$;

CREATE FUNCTION app_private.validar_recorrencia(p_empresa uuid, p_atual public.despesas_recorrentes, p_dados jsonb)
RETURNS public.despesas_recorrentes
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  r public.despesas_recorrentes := p_atual;
  v_mes date := date_trunc('month', app_private.hoje_sp())::date;
  v_forn uuid;
BEGIN
  r.empresa_id := p_empresa;
  IF p_atual.id IS NULL OR p_dados ? 'descricao' THEN
    r.descricao := app_private.ler_texto(p_dados->>'descricao', 2, 120, 'descricao', 'Descreva a despesa (2 a 120 caracteres).');
  END IF;
  IF p_atual.id IS NULL OR p_dados ? 'valor_centavos' THEN
    r.valor := app_private.centavos(p_dados->'valor_centavos', 'valor_centavos', true, 1);
  END IF;
  IF p_atual.id IS NULL OR p_dados ? 'categoria_id' THEN
    r.categoria_id := app_private.categoria_valida(p_empresa, app_private.ler_uuid(p_dados->>'categoria_id', 'categoria_id'), 'despesa');
  END IF;
  IF p_dados ? 'fornecedor_id' THEN
    v_forn := app_private.ler_uuid(p_dados->>'fornecedor_id', 'fornecedor_id');
    IF v_forn IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fornecedores WHERE id = v_forn AND empresa_id = p_empresa) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha um fornecedor desta empresa.', 'fornecedor_id');
    END IF;
    r.fornecedor_id := v_forn;
  END IF;
  IF p_atual.id IS NULL THEN
    r.periodicidade := p_dados->>'periodicidade';
    IF r.periodicidade IS NULL OR r.periodicidade NOT IN ('mensal', 'anual') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha mensal ou anual.', 'periodicidade');
    END IF;
    r.inicio := date_trunc('month', coalesce(app_private.ler_data(p_dados->>'inicio', 'inicio'), v_mes))::date;
    IF r.inicio < (v_mes - interval '12 months')::date OR r.inicio > (v_mes + interval '24 months')::date THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'O início precisa estar entre 12 meses atrás e 24 meses à frente.', 'inicio');
    END IF;
  ELSIF p_dados ? 'periodicidade' OR p_dados ? 'inicio' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Periodicidade e início não mudam; crie uma nova recorrência.', 'periodicidade');
  END IF;
  IF p_atual.id IS NULL OR p_dados ? 'dia_vencimento' THEN
    r.dia_vencimento := (p_dados->>'dia_vencimento')::integer;
    IF r.dia_vencimento IS NULL OR r.dia_vencimento NOT BETWEEN 1 AND 31 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha o dia do vencimento (1 a 31).', 'dia_vencimento');
    END IF;
  END IF;
  IF p_dados ? 'fim' THEN
    r.fim := date_trunc('month', app_private.ler_data(p_dados->>'fim', 'fim'))::date;
    IF r.fim IS NOT NULL AND r.fim < r.inicio THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'O fim não pode ser antes do início.', 'fim');
    END IF;
  END IF;
  RETURN r;
EXCEPTION WHEN invalid_text_representation THEN
  PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha o dia do vencimento (1 a 31).', 'dia_vencimento');
  RETURN r;
END $$;

CREATE FUNCTION public.criar_recorrencia(p_empresa_id uuid, p_dados jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text));
  anterior jsonb;
  r public.despesas_recorrentes;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_recorrencia', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.criar']);
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['descricao', 'valor_centavos', 'categoria_id', 'fornecedor_id', 'periodicidade',
    'dia_vencimento', 'inicio', 'fim']);
  r := app_private.validar_recorrencia(p_empresa_id, NULL::public.despesas_recorrentes, p_dados);
  INSERT INTO public.despesas_recorrentes (empresa_id, descricao, valor, categoria_id, fornecedor_id, periodicidade, dia_vencimento,
    inicio, fim, criado_por)
  VALUES (p_empresa_id, r.descricao, r.valor, r.categoria_id, r.fornecedor_id, r.periodicidade, r.dia_vencimento, r.inicio, r.fim, usuario)
  RETURNING * INTO r;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.recorrencia_criada', 'despesas_recorrentes', r.id,
    jsonb_build_object('valor_centavos', app_private.para_centavos(r.valor), 'periodicidade', r.periodicidade));
  RETURN app_private.idem_fim(usuario, 'criar_recorrencia', p_operation_key, assinatura, app_private.recorrencia_json(r));
END $$;

CREATE FUNCTION public.alterar_recorrencia(p_recorrencia_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_recorrencia_id, p_dados::text, p_expected_version));
  anterior jsonb;
  r public.despesas_recorrentes;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_recorrencia', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO r FROM public.despesas_recorrentes WHERE id = p_recorrencia_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Recorrência não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(r.empresa_id, usuario, ARRAY['financeiro.criar']);
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['descricao', 'valor_centavos', 'categoria_id', 'fornecedor_id', 'dia_vencimento', 'fim',
    'periodicidade', 'inicio']);
  IF r.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta recorrência mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  r := app_private.validar_recorrencia(r.empresa_id, r, p_dados);
  UPDATE public.despesas_recorrentes SET descricao = r.descricao, valor = r.valor, categoria_id = r.categoria_id, fornecedor_id = r.fornecedor_id,
    dia_vencimento = r.dia_vencimento, fim = r.fim, versao = versao + 1, atualizado_em = now()
   WHERE id = r.id RETURNING * INTO r;
  PERFORM app_private.auditar(r.empresa_id, usuario, 'financeiro.recorrencia_alterada', 'despesas_recorrentes', r.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'alterar_recorrencia', p_operation_key, assinatura, app_private.recorrencia_json(r));
END $$;

CREATE FUNCTION public.definir_recorrencia_ativa(p_recorrencia_id uuid, p_ativa boolean, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_recorrencia_id, p_ativa, p_expected_version));
  anterior jsonb;
  r public.despesas_recorrentes;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_recorrencia_ativa', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO r FROM public.despesas_recorrentes WHERE id = p_recorrencia_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Recorrência não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(r.empresa_id, usuario, ARRAY['financeiro.criar']);
  IF r.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta recorrência mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF r.ativa = p_ativa THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN p_ativa THEN 'A recorrência já está ativa.' ELSE 'A recorrência já está pausada.' END);
  END IF;
  IF p_ativa THEN
    PERFORM app_private.categoria_valida(r.empresa_id, r.categoria_id, 'despesa');
  END IF;
  UPDATE public.despesas_recorrentes SET ativa = p_ativa, versao = versao + 1, atualizado_em = now() WHERE id = r.id RETURNING * INTO r;
  PERFORM app_private.auditar(r.empresa_id, usuario, CASE WHEN p_ativa THEN 'financeiro.recorrencia_retomada' ELSE 'financeiro.recorrencia_pausada' END,
    'despesas_recorrentes', r.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'definir_recorrencia_ativa', p_operation_key, assinatura, app_private.recorrencia_json(r));
END $$;

-- Geração sob demanda e idempotente (D7-08): cria as contas a pagar dos meses até o atual que ainda não existem.
-- Duas pessoas abrindo o financeiro ao mesmo tempo não duplicam (índice único por regra e competência).
-- Meses já fechados não recebem contas novas (D7-13): aparecem como "não geradas" para decisão humana.
CREATE FUNCTION public.gerar_recorrencias(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  r public.despesas_recorrentes;
  m date;
  v_fechado date;
  v_titulo uuid;
  v_gerados integer := 0;
  v_fechados integer := 0;
  v_ate date := date_trunc('month', app_private.hoje_sp())::date;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.visualizar']);
  v_fechado := app_private.travar_periodo(p_empresa_id);
  FOR r IN SELECT * FROM public.despesas_recorrentes WHERE empresa_id = p_empresa_id AND ativa ORDER BY id LOOP
    FOR m IN SELECT c FROM app_private.competencias_da_regra(r, r.inicio, v_ate) AS c LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.titulos_financeiros WHERE empresa_id = p_empresa_id AND origem_tipo = 'recorrencia'
                             AND origem_id = r.id AND competencia = m);
      IF v_fechado IS NOT NULL AND m <= v_fechado THEN
        v_fechados := v_fechados + 1;
        CONTINUE;
      END IF;
      v_titulo := NULL;
      INSERT INTO public.titulos_financeiros (empresa_id, tipo, origem_tipo, origem_id, descricao, total, categoria_id, competencia,
        contraparte_tipo, fornecedor_id, criado_por)
      VALUES (p_empresa_id, 'pagar', 'recorrencia', r.id, format('%s (%s)', r.descricao, to_char(m, 'MM/YYYY')), r.valor, r.categoria_id, m,
        CASE WHEN r.fornecedor_id IS NOT NULL THEN 'fornecedor' END, r.fornecedor_id, usuario)
      ON CONFLICT (empresa_id, origem_id, competencia) WHERE origem_tipo = 'recorrencia' DO NOTHING
      RETURNING id INTO v_titulo;
      IF v_titulo IS NOT NULL THEN
        INSERT INTO public.parcelas_financeiras (empresa_id, titulo_id, sequencia, valor, vencimento, saldo)
        VALUES (p_empresa_id, v_titulo, 1, r.valor, app_private.vencimento_no_mes(m, r.dia_vencimento), r.valor);
        v_gerados := v_gerados + 1;
      END IF;
    END LOOP;
  END LOOP;
  IF v_gerados > 0 THEN
    PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.recorrencias_geradas', 'despesas_recorrentes', NULL,
      jsonb_build_object('gerados', v_gerados));
  END IF;
  RETURN jsonb_build_object('gerados', v_gerados, 'nao_gerados_mes_fechado', v_fechados,
    'aviso', 'As contas recorrentes são geradas quando alguém abre o financeiro; não há processamento automático contínuo.');
END $$;

-- Compras do M05 que ainda podem virar conta a pagar (D7-07: opcional, uma por compra).
CREATE FUNCTION public.compras_para_conta_pagar(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.criar']);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'data_compra', c.data_compra, 'numero_documento', c.numero_documento,
      'fornecedor', f.nome, 'custo_total_centavos', app_private.para_centavos(c.custo_total), 'estado', c.estado) ORDER BY c.data_compra DESC)
    FROM public.compras_fornecedor c LEFT JOIN public.fornecedores f ON f.id = c.fornecedor_id
   WHERE c.empresa_id = p_empresa_id AND c.estado IN ('registrada', 'recebida') AND coalesce(c.custo_total, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM public.titulos_financeiros t WHERE t.origem_tipo = 'compra' AND t.origem_id = c.id AND t.estado <> 'cancelado')),
    '[]'::jsonb);
END $$;

CREATE FUNCTION public.gerar_titulo_compra(p_compra_id uuid, p_dados jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_compra_id, p_dados::text));
  anterior jsonb;
  c public.compras_fornecedor;
  v_cat uuid;
  v_comp date;
  v_total numeric;
  v_id uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'gerar_titulo_compra', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.compras_fornecedor WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Compra não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['financeiro.criar']);
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['categoria_id', 'competencia', 'valor_centavos', 'vencimento', 'parcelas']);
  IF c.estado NOT IN ('registrada', 'recebida') OR coalesce(c.custo_total, 0) = 0 THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só compras registradas e com custo informado geram conta a pagar.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.titulos_financeiros WHERE origem_tipo = 'compra' AND origem_id = c.id AND estado <> 'cancelado') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta compra já tem uma conta a pagar.');
  END IF;
  v_cat := CASE WHEN p_dados ? 'categoria_id'
    THEN app_private.categoria_valida(c.empresa_id, app_private.ler_uuid(p_dados->>'categoria_id', 'categoria_id'), 'despesa')
    ELSE app_private.categoria_sistema(c.empresa_id, 'compras') END;
  v_comp := coalesce(app_private.ler_data(p_dados->>'competencia', 'competencia'), c.data_compra);
  PERFORM app_private.exigir_competencia_aberta(c.empresa_id, v_comp);
  INSERT INTO public.titulos_financeiros (empresa_id, tipo, origem_tipo, origem_id, descricao, total, categoria_id, competencia,
    contraparte_tipo, fornecedor_id, criado_por)
  VALUES (c.empresa_id, 'pagar', 'compra', c.id,
    left(concat_ws(' ', 'Compra', CASE WHEN c.numero_documento IS NOT NULL THEN 'nº ' || c.numero_documento END,
      'de ' || to_char(c.data_compra, 'DD/MM/YYYY')), 120),
    0, v_cat, v_comp, CASE WHEN c.fornecedor_id IS NOT NULL THEN 'fornecedor' END, c.fornecedor_id, usuario)
  RETURNING id INTO v_id;
  v_total := app_private.gravar_parcelas(c.empresa_id, v_id,
    CASE WHEN p_dados ? 'parcelas' OR p_dados ? 'valor_centavos' THEN p_dados
         ELSE jsonb_build_object('valor_centavos', app_private.para_centavos(c.custo_total),
                                 'vencimento', coalesce(p_dados->>'vencimento', app_private.hoje_sp()::text)) END);
  IF v_total <> c.custo_total THEN
    PERFORM app_private.erro('VALIDATION_ERROR', format('A soma das parcelas (%s) precisa ser igual ao custo da compra (%s).',
      app_private.brl(v_total), app_private.brl(c.custo_total)), 'parcelas');
  END IF;
  PERFORM app_private.auditar(c.empresa_id, usuario, 'financeiro.titulo_de_compra', 'titulos_financeiros', v_id,
    jsonb_build_object('compra_id', c.id, 'total_centavos', app_private.para_centavos(v_total)));
  RETURN app_private.idem_fim(usuario, 'gerar_titulo_compra', p_operation_key, assinatura, app_private.titulo_json(v_id));
END $$;

-- ===========================================================================
-- 8. Fechamento mensal e reabertura (RF-135, RF-136; D7-11 a D7-13, D7-17)
-- ===========================================================================
CREATE FUNCTION app_private.saldo_em(p_conta uuid, p_ate date) RETURNS numeric
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(sum(CASE sentido WHEN 'entrada' THEN valor ELSE -valor END), 0)
    FROM public.lancamentos_financeiros WHERE conta_id = p_conta AND data <= p_ate
$$;

-- Próximo mês a fechar: o seguinte ao último fechado ou, sem fechamentos, o mês do primeiro registro financeiro.
CREATE FUNCTION app_private.proximo_mes_a_fechar(p_empresa uuid) RETURNS date
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE WHEN c.fechado_ate IS NOT NULL THEN (c.fechado_ate + 1)
    ELSE date_trunc('month', least(
      (SELECT min(data) FROM public.lancamentos_financeiros WHERE empresa_id = p_empresa),
      (SELECT min(competencia) FROM public.titulos_financeiros WHERE empresa_id = p_empresa)))::date END
    FROM (SELECT (SELECT fechado_ate FROM app_private.controle_financeiro WHERE empresa_id = p_empresa) AS fechado_ate) c
$$;

CREATE FUNCTION app_private.pendencias_do_mes(p_empresa uuid, p_mes date) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'parcelas_vencidas_receber', (SELECT count(*) FROM public.parcelas_financeiras pa JOIN public.titulos_financeiros t ON t.id = pa.titulo_id
       WHERE t.empresa_id = p_empresa AND t.tipo = 'receber' AND pa.estado IN ('aberta', 'parcial')
         AND pa.vencimento <= (p_mes + interval '1 month - 1 day')::date),
    'parcelas_vencidas_pagar', (SELECT count(*) FROM public.parcelas_financeiras pa JOIN public.titulos_financeiros t ON t.id = pa.titulo_id
       WHERE t.empresa_id = p_empresa AND t.tipo = 'pagar' AND pa.estado IN ('aberta', 'parcial')
         AND pa.vencimento <= (p_mes + interval '1 month - 1 day')::date),
    'devolucoes_a_fazer_centavos', (SELECT app_private.para_centavos(coalesce(sum(a_devolver), 0)) FROM public.titulos_financeiros
       WHERE empresa_id = p_empresa AND a_devolver > 0),
    'recorrencias_nao_geradas', (SELECT count(*) FROM public.despesas_recorrentes r, app_private.competencias_da_regra(r, p_mes, p_mes) AS m
       WHERE r.empresa_id = p_empresa AND r.ativa AND NOT EXISTS (SELECT 1 FROM public.titulos_financeiros t
         WHERE t.origem_tipo = 'recorrencia' AND t.origem_id = r.id AND t.competencia = m)))
$$;

CREATE FUNCTION public.fechar_periodo(p_empresa_id uuid, p_mes date, p_conferencias jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_mes, coalesce(p_conferencias, '[]'::jsonb)::text));
  anterior jsonb;
  v_proximo date;
  v_fim date;
  v_id uuid := gen_random_uuid();
  e jsonb;
  c public.contas_financeiras;
  v_contado numeric;
  v_esperado numeric;
  v_dif numeric;
  v_motivo text;
  v_conf jsonb := '[]'::jsonb;
  v_saldos jsonb;
  v_resumo jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'fechar_periodo', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.fechar']);
  INSERT INTO app_private.controle_financeiro (empresa_id) VALUES (p_empresa_id) ON CONFLICT (empresa_id) DO NOTHING;
  -- Trava exclusiva: espera os lançamentos em andamento e impede novos até o fim do fechamento.
  PERFORM 1 FROM app_private.controle_financeiro WHERE empresa_id = p_empresa_id FOR UPDATE;
  v_proximo := app_private.proximo_mes_a_fechar(p_empresa_id);
  IF v_proximo IS NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Ainda não há registros financeiros para fechar.');
  END IF;
  IF p_mes IS NULL OR date_trunc('month', p_mes)::date <> v_proximo THEN
    PERFORM app_private.erro('STATE_CONFLICT', format('Os meses são fechados em ordem. O próximo a fechar é %s.', to_char(v_proximo, 'MM/YYYY')), 'mes');
  END IF;
  v_fim := (v_proximo + interval '1 month - 1 day')::date;
  IF v_fim >= app_private.hoje_sp() THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só é possível fechar um mês depois que ele termina.', 'mes');
  END IF;
  IF p_conferencias IS NOT NULL AND jsonb_typeof(p_conferencias) <> 'array' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Conferências inválidas.', 'conferencias');
  END IF;
  -- Conferência opcional do caixa físico (D7-11). Diferença vira ajuste com motivo, datado do último dia do mês,
  -- e só o proprietário registra diferença (D7-17).
  FOR e IN SELECT value FROM jsonb_array_elements(coalesce(p_conferencias, '[]'::jsonb)) LOOP
    c := app_private.conta_valida(p_empresa_id, app_private.ler_uuid(e->>'conta_id', 'conta_id'));
    IF c.tipo <> 'caixa' THEN
      PERFORM app_private.erro('VALIDATION_ERROR', format('"%s" não é caixa físico; a conferência é só do dinheiro em espécie.', c.nome), 'conta_id');
    END IF;
    IF v_conf @> jsonb_build_array(jsonb_build_object('conta_id', c.id)) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Cada caixa é conferido uma vez.', 'conta_id');
    END IF;
    v_contado := app_private.centavos(e->'contado_centavos', 'contado_centavos', true, 0);
    v_esperado := app_private.saldo_em(c.id, v_fim);
    v_dif := v_contado - v_esperado;
    v_motivo := NULL;
    IF v_dif <> 0 THEN
      PERFORM app_private.exigir_proprietario(p_empresa_id, usuario, 'Só o proprietário registra diferença na conferência do caixa.');
      v_motivo := app_private.ler_texto(e->>'motivo', 10, 300, 'motivo', 'Explique a diferença do caixa (10 a 300 caracteres).');
      PERFORM app_private.lancar(p_empresa_id, c.id, v_fim, CASE WHEN v_dif > 0 THEN 'entrada' ELSE 'saida' END, abs(v_dif),
        'ajuste_conferencia', 'ajuste', NULL, 'fechamento', v_id, NULL, NULL, 'Conferência de caixa: ' || v_motivo, NULL, usuario, p_operation_key);
    END IF;
    v_conf := v_conf || jsonb_build_object('conta_id', c.id, 'conta', c.nome, 'esperado_centavos', app_private.para_centavos(v_esperado),
      'contado_centavos', app_private.para_centavos(v_contado), 'diferenca_centavos', app_private.para_centavos(v_dif), 'motivo', v_motivo);
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('conta_id', ct.id, 'conta', ct.nome, 'tipo', ct.tipo,
      'saldo_centavos', app_private.para_centavos(app_private.saldo_em(ct.id, v_fim))) ORDER BY ct.nome), '[]'::jsonb)
    INTO v_saldos FROM public.contas_financeiras ct WHERE ct.empresa_id = p_empresa_id;
  v_resumo := app_private.resumo_periodo(p_empresa_id, v_proximo, v_fim, true)
    || jsonb_build_object('pendencias', app_private.pendencias_do_mes(p_empresa_id, v_proximo));
  INSERT INTO public.fechamentos_financeiros (id, empresa_id, mes, saldos, resumo, conferencias, fechado_por, operation_key)
  VALUES (v_id, p_empresa_id, v_proximo, v_saldos, v_resumo, v_conf, usuario, p_operation_key);
  UPDATE app_private.controle_financeiro SET fechado_ate = v_fim, atualizado_em = now() WHERE empresa_id = p_empresa_id;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.periodo_fechado', 'fechamentos_financeiros', v_id,
    jsonb_build_object('mes', v_proximo, 'conferencias', jsonb_array_length(v_conf)));
  RETURN app_private.idem_fim(usuario, 'fechar_periodo', p_operation_key, assinatura,
    jsonb_build_object('id', v_id, 'mes', v_proximo, 'fechado_ate', v_fim, 'saldos', v_saldos, 'conferencias', v_conf));
END $$;

-- Reabertura (D7-12): só o proprietário, só o último mês fechado, com justificativa; o fechamento anterior fica no histórico.
CREATE FUNCTION public.reabrir_periodo(p_empresa_id uuid, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_motivo));
  anterior jsonb;
  f public.fechamentos_financeiros;
  v_motivo text;
  v_ate date;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'reabrir_periodo', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_proprietario(p_empresa_id, usuario, 'Só o proprietário reabre um mês fechado.');
  INSERT INTO app_private.controle_financeiro (empresa_id) VALUES (p_empresa_id) ON CONFLICT (empresa_id) DO NOTHING;
  PERFORM 1 FROM app_private.controle_financeiro WHERE empresa_id = p_empresa_id FOR UPDATE;
  SELECT * INTO f FROM public.fechamentos_financeiros WHERE empresa_id = p_empresa_id AND estado = 'fechado' ORDER BY mes DESC LIMIT 1;
  IF NOT FOUND THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Não há mês fechado para reabrir.');
  END IF;
  v_motivo := app_private.ler_texto(p_motivo, 10, 300, 'motivo', 'Explique a reabertura (10 a 300 caracteres).');
  UPDATE public.fechamentos_financeiros SET estado = 'reaberto', reaberto_por = usuario, reaberto_em = now(), motivo_reabertura = v_motivo
   WHERE id = f.id;
  SELECT (max(mes) + interval '1 month - 1 day')::date INTO v_ate FROM public.fechamentos_financeiros
   WHERE empresa_id = p_empresa_id AND estado = 'fechado';
  UPDATE app_private.controle_financeiro SET fechado_ate = v_ate, atualizado_em = now() WHERE empresa_id = p_empresa_id;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.periodo_reaberto', 'fechamentos_financeiros', f.id,
    jsonb_build_object('mes', f.mes, 'motivo', v_motivo));
  RETURN app_private.idem_fim(usuario, 'reabrir_periodo', p_operation_key, assinatura,
    jsonb_build_object('id', f.id, 'mes', f.mes, 'estado', 'reaberto', 'fechado_ate', v_ate));
END $$;

-- ===========================================================================
-- 9. Leituras, indicadores, relatórios, exportação e reconciliação (RF-133, RF-134, RF-137, RF-139; D7-14, D7-15)
-- ===========================================================================
CREATE FUNCTION app_private.exigir_financeiro(p_empresa uuid, p_usuario text) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa, p_usuario, ARRAY['financeiro.visualizar']);
END $$;

CREATE FUNCTION app_private.ler_periodo(p_de date, p_ate date, OUT de date, OUT ate date)
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  de := coalesce(p_de, date_trunc('month', app_private.hoje_sp())::date);
  ate := coalesce(p_ate, app_private.hoje_sp());
  IF de > ate THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O início do período precisa ser antes do fim.', 'de');
  END IF;
  IF ate - de > 1100 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha um período de até 3 anos.', 'ate');
  END IF;
END $$;

-- Fluxo de caixa (regime de caixa) e resultado gerencial estimado (competência simplificada), com método explicado.
-- Transferências, aportes e retiradas NUNCA entram no resultado (RN-026, RN-027). Compras de mercadorias também não:
-- viram custo quando o produto é vendido (CMV), para não contar duas vezes.
CREATE FUNCTION app_private.resumo_periodo(p_empresa uuid, p_de date, p_ate date, p_ver_custo boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  f record;
  v_inicial numeric;
  v_compras uuid := (SELECT id FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND codigo_sistema = 'compras');
  v_vendas numeric;
  v_canceladas numeric;
  v_outras numeric;
  v_despesas numeric;
  v_compras_valor numeric;
  v_cmv numeric;
  v_cmv_estorno numeric;
  v_cob_valor numeric;
  v_cob_total numeric;
  v_receita numeric;
  v_resultado jsonb;
BEGIN
  SELECT coalesce(sum(CASE WHEN sentido = 'entrada' THEN valor ELSE -valor END), 0) INTO v_inicial
    FROM public.lancamentos_financeiros WHERE empresa_id = p_empresa AND data < p_de;
  SELECT
    coalesce(sum(valor) FILTER (WHERE natureza = 'receita' AND sentido = 'entrada'), 0) AS receitas_entradas,
    coalesce(sum(valor) FILTER (WHERE natureza = 'receita' AND sentido = 'saida'), 0) AS receitas_saidas,
    coalesce(sum(valor) FILTER (WHERE natureza = 'despesa' AND sentido = 'saida'), 0) AS despesas_saidas,
    coalesce(sum(valor) FILTER (WHERE natureza = 'despesa' AND sentido = 'entrada'), 0) AS despesas_entradas,
    coalesce(sum(valor) FILTER (WHERE natureza = 'interna' AND sentido = 'saida'), 0) AS transferido,
    coalesce(sum(valor) FILTER (WHERE natureza = 'interna' AND sentido = 'entrada'), 0) AS transferido_entrada,
    -- Estorno de aporte reduz os aportes; estorno de retirada reduz as retiradas (nunca vira o oposto).
    coalesce(sum(CASE WHEN l.tipo = 'estorno' THEN -valor ELSE valor END) FILTER (WHERE coalesce(o_tipo, l.tipo) = 'aporte'), 0) AS aportes,
    coalesce(sum(CASE WHEN l.tipo = 'estorno' THEN -valor ELSE valor END) FILTER (WHERE coalesce(o_tipo, l.tipo) = 'retirada'), 0) AS retiradas,
    coalesce(sum(CASE WHEN sentido = 'entrada' THEN valor ELSE -valor END) FILTER (WHERE natureza = 'ajuste'), 0) AS ajustes
    INTO f FROM (SELECT x.*, (SELECT o.tipo FROM public.lancamentos_financeiros o WHERE o.id = x.estorno_de) AS o_tipo
                   FROM public.lancamentos_financeiros x WHERE x.empresa_id = p_empresa AND x.data BETWEEN p_de AND p_ate) l;

  -- Vendas: entram no mês da confirmação e saem no mês do cancelamento (o mês fechado não muda depois).
  SELECT coalesce(sum(total), 0) INTO v_vendas FROM public.vendas
   WHERE empresa_id = p_empresa AND estado IN ('confirmada', 'cancelada') AND confirmada_em IS NOT NULL
     AND (confirmada_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate;
  SELECT coalesce(sum(total), 0) INTO v_canceladas FROM public.vendas
   WHERE empresa_id = p_empresa AND estado = 'cancelada' AND (cancelada_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate;
  -- Outras receitas: contas a receber manuais pela competência (menos as canceladas no período) e receitas avulsas.
  SELECT coalesce(sum(total) FILTER (WHERE competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(total) FILTER (WHERE estado = 'cancelado' AND (cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_outras FROM public.titulos_financeiros WHERE empresa_id = p_empresa AND tipo = 'receber' AND origem_tipo = 'manual';
  v_outras := v_outras + coalesce((SELECT sum(CASE WHEN l.sentido = 'entrada' THEN l.valor ELSE -l.valor END)
    FROM public.lancamentos_financeiros l LEFT JOIN public.lancamentos_financeiros o ON o.id = l.estorno_de
   WHERE l.empresa_id = p_empresa AND l.data BETWEEN p_de AND p_ate
     AND (l.tipo = 'receita_avulsa' OR o.tipo = 'receita_avulsa')), 0);
  -- Despesas: contas a pagar pela competência (menos canceladas no período) e despesas avulsas, exceto compras de mercadorias.
  SELECT coalesce(sum(total) FILTER (WHERE competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(total) FILTER (WHERE estado = 'cancelado' AND (cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_despesas FROM public.titulos_financeiros
   WHERE empresa_id = p_empresa AND tipo = 'pagar' AND categoria_id IS DISTINCT FROM v_compras;
  v_despesas := v_despesas + coalesce((SELECT sum(CASE WHEN l.sentido = 'saida' THEN l.valor ELSE -l.valor END)
    FROM public.lancamentos_financeiros l LEFT JOIN public.lancamentos_financeiros o ON o.id = l.estorno_de
   WHERE l.empresa_id = p_empresa AND l.data BETWEEN p_de AND p_ate AND l.categoria_id IS DISTINCT FROM v_compras
     AND (l.tipo = 'despesa_avulsa' OR o.tipo = 'despesa_avulsa')), 0);
  SELECT coalesce(sum(total) FILTER (WHERE competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(total) FILTER (WHERE estado = 'cancelado' AND (cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_compras_valor FROM public.titulos_financeiros WHERE empresa_id = p_empresa AND tipo = 'pagar' AND categoria_id = v_compras;
  v_receita := v_vendas - v_canceladas + v_outras;

  IF p_ver_custo THEN
    -- D7-15: custo do momento da venda; itens sem custo reduzem a cobertura e o resultado é chamado de parcial.
    SELECT coalesce(sum(vi.custo_unitario * vi.quantidade), 0), coalesce(sum(vi.valor) FILTER (WHERE vi.custo_unitario IS NOT NULL), 0),
           coalesce(sum(vi.valor), 0)
      INTO v_cmv, v_cob_valor, v_cob_total
      FROM public.venda_itens vi JOIN public.vendas v ON v.id = vi.venda_id
     WHERE v.empresa_id = p_empresa AND v.estado IN ('confirmada', 'cancelada') AND v.confirmada_em IS NOT NULL
       AND (v.confirmada_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate;
    SELECT coalesce(sum(vi.custo_unitario * vi.quantidade), 0) INTO v_cmv_estorno
      FROM public.venda_itens vi JOIN public.vendas v ON v.id = vi.venda_id
     WHERE v.empresa_id = p_empresa AND v.estado = 'cancelada' AND vi.destino_cancelamento IN ('voltou', 'nao_entregue')
       AND (v.cancelada_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate;
    v_cmv := v_cmv - v_cmv_estorno;
    v_resultado := jsonb_build_object('disponivel', true,
      'receita_vendas_centavos', app_private.para_centavos(v_vendas),
      'vendas_canceladas_centavos', app_private.para_centavos(v_canceladas),
      'outras_receitas_centavos', app_private.para_centavos(v_outras),
      'custo_mercadorias_vendidas_centavos', app_private.para_centavos(v_cmv),
      'margem_bruta_centavos', app_private.para_centavos(v_vendas - v_canceladas - v_cmv),
      'despesas_centavos', app_private.para_centavos(v_despesas),
      'resultado_estimado_centavos', app_private.para_centavos(v_receita - v_cmv - v_despesas),
      'compras_mercadorias_centavos', app_private.para_centavos(v_compras_valor),
      'cobertura_custo_percentual', CASE WHEN v_cob_total = 0 THEN NULL ELSE round(100 * v_cob_valor / v_cob_total, 1) END,
      'parcial', v_cob_total > 0 AND v_cob_valor < v_cob_total);
  ELSE
    v_resultado := jsonb_build_object('disponivel', false,
      'motivo', 'O resultado usa o custo das mercadorias vendidas, e seu acesso não permite ver custos.',
      'receita_vendas_centavos', app_private.para_centavos(v_vendas),
      'vendas_canceladas_centavos', app_private.para_centavos(v_canceladas),
      'outras_receitas_centavos', app_private.para_centavos(v_outras),
      'despesas_centavos', app_private.para_centavos(v_despesas),
      'compras_mercadorias_centavos', app_private.para_centavos(v_compras_valor));
  END IF;
  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'fluxo', jsonb_build_object(
      'saldo_inicial_centavos', app_private.para_centavos(v_inicial),
      'receitas_recebidas_centavos', app_private.para_centavos(f.receitas_entradas),
      'devolucoes_e_estornos_de_receita_centavos', app_private.para_centavos(f.receitas_saidas),
      'despesas_pagas_centavos', app_private.para_centavos(f.despesas_saidas),
      'estornos_de_despesa_centavos', app_private.para_centavos(f.despesas_entradas),
      'transferido_entre_contas_centavos', app_private.para_centavos(f.transferido),
      'aportes_centavos', app_private.para_centavos(f.aportes),
      'retiradas_centavos', app_private.para_centavos(f.retiradas),
      'ajustes_centavos', app_private.para_centavos(f.ajustes),
      'variacao_operacional_centavos', app_private.para_centavos(f.receitas_entradas - f.receitas_saidas - f.despesas_saidas + f.despesas_entradas),
      'saldo_final_centavos', app_private.para_centavos(v_inicial + f.receitas_entradas - f.receitas_saidas - f.despesas_saidas
        + f.despesas_entradas + f.transferido_entrada - f.transferido + f.aportes - f.retiradas + f.ajustes),
      'metodo', 'Regime de caixa: soma do que entrou e saiu das contas, pela data de cada lançamento. Transferências entre contas '
        || 'não mudam o total; aportes e retiradas do proprietário aparecem separados e não são receita nem despesa.'),
    'resultado', v_resultado || jsonb_build_object(
      'metodo', 'Competência simplificada: vendas confirmadas no período (canceladas saem no mês do cancelamento), mais outras '
        || 'receitas, menos o custo das mercadorias vendidas (custo informado no momento da venda) e as despesas do mês de '
        || 'referência. Compras de mercadorias viram custo quando o produto é vendido. Transferências, aportes e retiradas '
        || 'não entram. Custos indiretos não são rateados.',
      'aviso', 'Estimativa gerencial. Não é contabilidade oficial nem substitui um contador.'));
END $$;

CREATE FUNCTION public.contas_da_empresa(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_ve boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = p_empresa_id AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  v_ve := app_private.tem(p_empresa_id, usuario, 'financeiro.visualizar');
  IF NOT (v_ve OR app_private.tem(p_empresa_id, usuario, 'vendas.registrar_recebimento')) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite ver as contas financeiras.');
  END IF;
  PERFORM app_private.conta_caixa(p_empresa_id);
  -- Quem só registra recebimentos no balcão escolhe a conta, mas não vê saldos.
  RETURN coalesce((SELECT jsonb_agg(CASE WHEN v_ve THEN app_private.conta_json(c)
      ELSE jsonb_build_object('id', c.id, 'nome', c.nome, 'tipo', c.tipo, 'padrao', c.padrao, 'ativa', c.ativa) END
      ORDER BY c.padrao DESC, c.ativa DESC, c.nome)
    FROM public.contas_financeiras c WHERE c.empresa_id = p_empresa_id AND (v_ve OR c.ativa)), '[]'::jsonb);
END $$;

CREATE FUNCTION public.categorias_financeiras_da_empresa(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_financeiro(p_empresa_id, usuario);
  PERFORM app_private.garantir_categorias(p_empresa_id);
  RETURN coalesce((SELECT jsonb_agg(app_private.categoria_json(c) ORDER BY c.tipo DESC, c.ativa DESC, c.ordem, c.nome)
    FROM public.categorias_financeiras c WHERE c.empresa_id = p_empresa_id), '[]'::jsonb);
END $$;

CREATE FUNCTION public.titulos_da_empresa(p_empresa_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb, p_limite integer DEFAULT 50,
  p_deslocamento integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  f jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_tipo text := f->>'tipo';
  v_sit text := coalesce(f->>'situacao', 'abertos');
  v_origem text := f->>'origem';
  v_texto text := nullif(btrim(coalesce(f->>'texto', '')), '');
  v_hoje date := app_private.hoje_sp();
  v_total integer;
  v_itens jsonb;
BEGIN
  PERFORM app_private.exigir_financeiro(p_empresa_id, usuario);
  PERFORM app_private.exigir_chaves(f, ARRAY['tipo', 'situacao', 'origem', 'texto', 'vence_ate']);
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('receber', 'pagar') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Filtro de tipo inválido.', 'tipo');
  END IF;
  IF v_sit NOT IN ('abertos', 'vencidos', 'liquidados', 'cancelados', 'todos') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Filtro de situação inválido.', 'situacao');
  END IF;
  WITH base AS (
    SELECT t.id, t.criado_em,
      (SELECT min(pa.vencimento) FROM public.parcelas_financeiras pa WHERE pa.titulo_id = t.id AND pa.estado IN ('aberta', 'parcial')) AS prox
      FROM public.titulos_financeiros t
      LEFT JOIN public.clientes_empresa ce ON ce.id = t.cliente_empresa_id
      LEFT JOIN public.fornecedores fo ON fo.id = t.fornecedor_id
     WHERE t.empresa_id = p_empresa_id
       AND (v_tipo IS NULL OR t.tipo = v_tipo)
       AND (v_origem IS NULL OR t.origem_tipo = v_origem)
       AND (v_texto IS NULL OR t.descricao ILIKE '%' || v_texto || '%' OR coalesce(ce.nome, fo.nome, t.contraparte_texto, '') ILIKE '%' || v_texto || '%')
       AND CASE v_sit
             WHEN 'abertos' THEN t.estado IN ('aberto', 'parcial') AND t.total > 0
             WHEN 'vencidos' THEN t.estado IN ('aberto', 'parcial') AND EXISTS (SELECT 1 FROM public.parcelas_financeiras pa
               WHERE pa.titulo_id = t.id AND pa.estado IN ('aberta', 'parcial') AND pa.vencimento < v_hoje)
             WHEN 'liquidados' THEN t.estado = 'liquidado'
             WHEN 'cancelados' THEN t.estado = 'cancelado'
             ELSE true END
       AND (f->>'vence_ate' IS NULL OR EXISTS (SELECT 1 FROM public.parcelas_financeiras pa WHERE pa.titulo_id = t.id
             AND pa.estado IN ('aberta', 'parcial') AND pa.vencimento <= app_private.ler_data(f->>'vence_ate', 'vence_ate'))))
  SELECT (SELECT count(*) FROM base),
         coalesce((SELECT jsonb_agg(app_private.titulo_json(b.id) ORDER BY b.prox NULLS LAST, b.criado_em DESC)
           FROM (SELECT * FROM base ORDER BY prox NULLS LAST, criado_em DESC
                  LIMIT least(greatest(coalesce(p_limite, 50), 1), 200) OFFSET greatest(coalesce(p_deslocamento, 0), 0)) b), '[]'::jsonb)
    INTO v_total, v_itens;
  RETURN jsonb_build_object('total', v_total, 'itens', v_itens);
END $$;

CREATE FUNCTION public.titulo_detalhe(p_titulo_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  t public.titulos_financeiros;
BEGIN
  SELECT * INTO t FROM public.titulos_financeiros WHERE id = p_titulo_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Conta não encontrada.');
  END IF;
  PERFORM app_private.exigir_financeiro(t.empresa_id, usuario);
  RETURN app_private.titulo_json(t.id) || jsonb_build_object('baixas', coalesce((
    SELECT jsonb_agg(b ORDER BY b->>'criado_em') FROM (
      SELECT jsonb_build_object('id', r.id, 'tipo', r.tipo, 'valor_centavos', app_private.para_centavos(r.valor), 'forma', r.forma,
        'data', r.data, 'motivo', r.motivo, 'estorno_de', r.estorno_de, 'conta', c.nome, 'autor', app_private.nome_da_pessoa(r.autor),
        'estornado', EXISTS (SELECT 1 FROM public.recebimentos x WHERE x.estorno_de = r.id), 'parcela_id', r.parcela_id,
        'criado_em', r.criado_em) AS b
        FROM public.recebimentos r JOIN public.contas_financeiras c ON c.id = r.conta_id WHERE r.titulo_id = t.id
      UNION ALL
      SELECT jsonb_build_object('id', g.id, 'tipo', g.tipo, 'valor_centavos', app_private.para_centavos(g.valor), 'forma', g.forma,
        'data', g.data, 'motivo', g.motivo, 'estorno_de', g.estorno_de, 'conta', c.nome, 'autor', app_private.nome_da_pessoa(g.autor),
        'estornado', EXISTS (SELECT 1 FROM public.pagamentos x WHERE x.estorno_de = g.id), 'parcela_id', g.parcela_id,
        'criado_em', g.criado_em)
        FROM public.pagamentos g JOIN public.contas_financeiras c ON c.id = g.conta_id WHERE g.titulo_id = t.id) q), '[]'::jsonb));
END $$;

-- Histórico financeiro pesquisável (RF-139): livro-caixa com autor e origem de cada lançamento.
CREATE FUNCTION public.lancamentos_da_empresa(p_empresa_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb, p_limite integer DEFAULT 50,
  p_deslocamento integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  f jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_de date;
  v_ate date;
  v_conta uuid;
  v_cat uuid;
  v_texto text := nullif(btrim(coalesce(f->>'texto', '')), '');
  v_min numeric;
  v_max numeric;
  v_total integer;
  v_itens jsonb;
BEGIN
  PERFORM app_private.exigir_financeiro(p_empresa_id, usuario);
  PERFORM app_private.exigir_chaves(f, ARRAY['de', 'ate', 'conta_id', 'tipo', 'natureza', 'categoria_id', 'texto', 'valor_min_centavos', 'valor_max_centavos']);
  v_de := app_private.ler_data(f->>'de', 'de');
  v_ate := app_private.ler_data(f->>'ate', 'ate');
  v_conta := app_private.ler_uuid(f->>'conta_id', 'conta_id');
  v_cat := app_private.ler_uuid(f->>'categoria_id', 'categoria_id');
  v_min := app_private.centavos(f->'valor_min_centavos', 'valor_min_centavos', false, 0);
  v_max := app_private.centavos(f->'valor_max_centavos', 'valor_max_centavos', false, 0);
  WITH base AS (
    SELECT l.* FROM public.lancamentos_financeiros l
     WHERE l.empresa_id = p_empresa_id
       AND (v_de IS NULL OR l.data >= v_de) AND (v_ate IS NULL OR l.data <= v_ate)
       AND (v_conta IS NULL OR l.conta_id = v_conta) AND (v_cat IS NULL OR l.categoria_id = v_cat)
       AND (f->>'tipo' IS NULL OR l.tipo = f->>'tipo') AND (f->>'natureza' IS NULL OR l.natureza = f->>'natureza')
       AND (v_min IS NULL OR l.valor >= v_min) AND (v_max IS NULL OR l.valor <= v_max)
       AND (v_texto IS NULL OR coalesce(l.descricao, '') ILIKE '%' || v_texto || '%'
            OR EXISTS (SELECT 1 FROM public.titulos_financeiros t WHERE t.id = l.titulo_id AND t.descricao ILIKE '%' || v_texto || '%')))
  SELECT (SELECT count(*) FROM base),
         coalesce((SELECT jsonb_agg(app_private.lancamento_json(b) ORDER BY b.data DESC, b.criado_em DESC)
           FROM (SELECT * FROM base ORDER BY data DESC, criado_em DESC
                  LIMIT least(greatest(coalesce(p_limite, 50), 1), 200) OFFSET greatest(coalesce(p_deslocamento, 0), 0)) b), '[]'::jsonb)
    INTO v_total, v_itens;
  RETURN jsonb_build_object('total', v_total, 'itens', v_itens);
END $$;

CREATE FUNCTION public.recorrencias_da_empresa(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_financeiro(p_empresa_id, usuario);
  RETURN coalesce((SELECT jsonb_agg(app_private.recorrencia_json(r) ORDER BY r.ativa DESC, r.descricao)
    FROM public.despesas_recorrentes r WHERE r.empresa_id = p_empresa_id), '[]'::jsonb);
END $$;

-- Painel (UI-042): cada número traz período, fonte e método (RF-134, FIN-I28).
CREATE FUNCTION public.painel_financeiro(p_empresa_id uuid, p_de date DEFAULT NULL, p_ate date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  p record;
  v_hoje date := app_private.hoje_sp();
  v_ver_custo boolean;
BEGIN
  PERFORM app_private.exigir_financeiro(p_empresa_id, usuario);
  p := app_private.ler_periodo(p_de, p_ate);
  v_ver_custo := app_private.tem(p_empresa_id, usuario, 'produtos.ver_custo');
  RETURN app_private.resumo_periodo(p_empresa_id, p.de, p.ate, v_ver_custo) || jsonb_build_object(
    'contas', coalesce((SELECT jsonb_agg(app_private.conta_json(c) ORDER BY c.padrao DESC, c.nome)
      FROM public.contas_financeiras c WHERE c.empresa_id = p_empresa_id AND c.ativa), '[]'::jsonb),
    'consolidado_centavos', (SELECT app_private.para_centavos(coalesce(sum(saldo), 0)) FROM public.contas_financeiras WHERE empresa_id = p_empresa_id),
    'a_receber', (SELECT jsonb_build_object('aberto_centavos', app_private.para_centavos(coalesce(sum(pa.saldo), 0)),
        'vencido_centavos', app_private.para_centavos(coalesce(sum(pa.saldo) FILTER (WHERE pa.vencimento < v_hoje), 0)),
        'parcelas_vencidas', count(*) FILTER (WHERE pa.vencimento < v_hoje))
      FROM public.parcelas_financeiras pa JOIN public.titulos_financeiros t ON t.id = pa.titulo_id
     WHERE t.empresa_id = p_empresa_id AND t.tipo = 'receber' AND pa.estado IN ('aberta', 'parcial')),
    'a_pagar', (SELECT jsonb_build_object('aberto_centavos', app_private.para_centavos(coalesce(sum(pa.saldo), 0)),
        'vencido_centavos', app_private.para_centavos(coalesce(sum(pa.saldo) FILTER (WHERE pa.vencimento < v_hoje), 0)),
        'parcelas_vencidas', count(*) FILTER (WHERE pa.vencimento < v_hoje),
        'vence_em_7_dias_centavos', app_private.para_centavos(coalesce(sum(pa.saldo) FILTER (WHERE pa.vencimento BETWEEN v_hoje AND v_hoje + 7), 0)))
      FROM public.parcelas_financeiras pa JOIN public.titulos_financeiros t ON t.id = pa.titulo_id
     WHERE t.empresa_id = p_empresa_id AND t.tipo = 'pagar' AND pa.estado IN ('aberta', 'parcial')),
    'devolucoes_a_fazer_centavos', (SELECT app_private.para_centavos(coalesce(sum(a_devolver), 0)) FROM public.titulos_financeiros
      WHERE empresa_id = p_empresa_id AND a_devolver > 0),
    'previsto_a_pagar_centavos', (SELECT app_private.para_centavos(coalesce(sum(r.valor), 0))
      FROM public.despesas_recorrentes r, app_private.competencias_da_regra(r, (date_trunc('month', v_hoje) + interval '1 month')::date,
        (date_trunc('month', v_hoje) + interval '3 months')::date) AS m WHERE r.empresa_id = p_empresa_id AND r.ativa),
    'fechado_ate', (SELECT fechado_ate FROM app_private.controle_financeiro WHERE empresa_id = p_empresa_id),
    've_custo', v_ver_custo,
    'fontes', jsonb_build_object(
      'contas', 'Saldo de cada conta = soma de todos os lançamentos registrados nela.',
      'a_receber_a_pagar', 'Parcelas abertas; "vencido" é calculado hoje, no horário de São Paulo.',
      'previsto', 'Despesas recorrentes ativas dos próximos 3 meses, ainda não geradas.'),
    'aviso_registro', 'Valores registrados manualmente na AutoniCK. Nenhum dinheiro é movimentado pelo sistema.');
END $$;

CREATE FUNCTION public.situacao_fechamento(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_prox date;
  v_fim date;
  v_ver_custo boolean;
BEGIN
  PERFORM app_private.exigir_financeiro(p_empresa_id, usuario);
  v_ver_custo := app_private.tem(p_empresa_id, usuario, 'produtos.ver_custo');
  v_prox := app_private.proximo_mes_a_fechar(p_empresa_id);
  v_fim := (v_prox + interval '1 month - 1 day')::date;
  RETURN jsonb_build_object(
    'fechado_ate', (SELECT fechado_ate FROM app_private.controle_financeiro WHERE empresa_id = p_empresa_id),
    'proximo_mes', v_prox,
    'pode_fechar', v_prox IS NOT NULL AND v_fim < app_private.hoje_sp(),
    'motivo', CASE WHEN v_prox IS NULL THEN 'Ainda não há registros financeiros para fechar.'
                   WHEN v_fim >= app_private.hoje_sp() THEN 'O mês só pode ser fechado depois que termina.' END,
    'pode_fechar_permissao', app_private.tem(p_empresa_id, usuario, 'financeiro.fechar'),
    'eh_proprietario', app_private.eh_proprietario_de(p_empresa_id, usuario),
    'pendencias', CASE WHEN v_prox IS NOT NULL THEN app_private.pendencias_do_mes(p_empresa_id, v_prox) END,
    'resumo', CASE WHEN v_prox IS NOT NULL THEN app_private.resumo_periodo(p_empresa_id, v_prox, least(v_fim, app_private.hoje_sp()), v_ver_custo) END,
    'caixas', coalesce((SELECT jsonb_agg(jsonb_build_object('conta_id', c.id, 'conta', c.nome,
        'esperado_centavos', app_private.para_centavos(app_private.saldo_em(c.id, v_fim))) ORDER BY c.nome)
      FROM public.contas_financeiras c WHERE c.empresa_id = p_empresa_id AND c.ativa AND c.tipo = 'caixa' AND v_prox IS NOT NULL), '[]'::jsonb),
    'fechamentos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', fe.id, 'mes', fe.mes, 'estado', fe.estado, 'fechado_em', fe.fechado_em,
        'fechado_por', app_private.nome_da_pessoa(fe.fechado_por), 'reaberto_em', fe.reaberto_em,
        'reaberto_por', CASE WHEN fe.reaberto_por IS NOT NULL THEN app_private.nome_da_pessoa(fe.reaberto_por) END,
        'motivo_reabertura', fe.motivo_reabertura, 'saldos', fe.saldos, 'conferencias', fe.conferencias,
        'resumo', CASE WHEN v_ver_custo THEN fe.resumo
          ELSE fe.resumo #- '{resultado,custo_mercadorias_vendidas_centavos}' #- '{resultado,margem_bruta_centavos}'
                         #- '{resultado,resultado_estimado_centavos}' #- '{resultado,cobertura_custo_percentual}' END)
        ORDER BY fe.mes DESC, fe.fechado_em DESC)
      FROM public.fechamentos_financeiros fe WHERE fe.empresa_id = p_empresa_id), '[]'::jsonb));
END $$;

-- Relatórios na tela (RF-137; D7-01: PDF fica no M13).
CREATE FUNCTION public.relatorio_financeiro(p_empresa_id uuid, p_tipo text, p_de date DEFAULT NULL, p_ate date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  p record;
  v_hoje date := app_private.hoje_sp();
  v_linhas jsonb;
  v_metodo text;
  v_ver_custo boolean;
BEGIN
  PERFORM app_private.exigir_financeiro(p_empresa_id, usuario);
  p := app_private.ler_periodo(p_de, p_ate);
  v_ver_custo := app_private.tem(p_empresa_id, usuario, 'produtos.ver_custo');
  IF p_tipo = 'categorias' THEN
    v_metodo := 'Regime de caixa: lançamentos do período por categoria. Transferências, aportes e retiradas aparecem sem categoria, separados.';
    SELECT coalesce(jsonb_agg(x ORDER BY x->>'natureza', x->>'categoria'), '[]'::jsonb) INTO v_linhas FROM (
      SELECT jsonb_build_object('natureza', l.natureza, 'categoria', coalesce(c.nome, CASE l.natureza WHEN 'interna' THEN 'Transferências entre contas'
          WHEN 'proprietario' THEN 'Proprietário (aportes e retiradas)' ELSE 'Ajustes e saldos iniciais' END),
        'entradas_centavos', app_private.para_centavos(coalesce(sum(l.valor) FILTER (WHERE l.sentido = 'entrada'), 0)),
        'saidas_centavos', app_private.para_centavos(coalesce(sum(l.valor) FILTER (WHERE l.sentido = 'saida'), 0)),
        'liquido_centavos', app_private.para_centavos(coalesce(sum(CASE WHEN l.sentido = 'entrada' THEN l.valor ELSE -l.valor END), 0)),
        'lancamentos', count(*)) AS x
        FROM public.lancamentos_financeiros l LEFT JOIN public.categorias_financeiras c ON c.id = l.categoria_id
       WHERE l.empresa_id = p_empresa_id AND l.data BETWEEN p.de AND p.ate
       GROUP BY l.natureza, c.nome) q;
  ELSIF p_tipo = 'contas' THEN
    v_metodo := 'Por conta: saldo antes do período, entradas, saídas e saldo no fim do período.';
    SELECT coalesce(jsonb_agg(jsonb_build_object('conta', c.nome, 'tipo', c.tipo, 'ativa', c.ativa,
        'saldo_inicial_centavos', app_private.para_centavos(app_private.saldo_em(c.id, p.de - 1)),
        'entradas_centavos', app_private.para_centavos(coalesce((SELECT sum(valor) FROM public.lancamentos_financeiros
           WHERE conta_id = c.id AND sentido = 'entrada' AND data BETWEEN p.de AND p.ate), 0)),
        'saidas_centavos', app_private.para_centavos(coalesce((SELECT sum(valor) FROM public.lancamentos_financeiros
           WHERE conta_id = c.id AND sentido = 'saida' AND data BETWEEN p.de AND p.ate), 0)),
        'saldo_final_centavos', app_private.para_centavos(app_private.saldo_em(c.id, p.ate))) ORDER BY c.nome), '[]'::jsonb)
      INTO v_linhas FROM public.contas_financeiras c WHERE c.empresa_id = p_empresa_id;
  ELSIF p_tipo = 'vencimentos' THEN
    v_metodo := 'Parcelas abertas por faixa de vencimento, contadas a partir de hoje (horário de São Paulo).';
    SELECT coalesce(jsonb_agg(x ORDER BY x->>'tipo', (x->>'ordem')::int), '[]'::jsonb) INTO v_linhas FROM (
      SELECT jsonb_build_object('tipo', tt.tipo, 'faixa', fx.nome, 'ordem', fx.ordem,
        'parcelas', count(pa.id), 'saldo_centavos', app_private.para_centavos(coalesce(sum(pa.saldo), 0))) AS x
        FROM (VALUES (1, 'Vencidas'), (2, 'Próximos 7 dias'), (3, 'De 8 a 30 dias'), (4, 'Depois de 30 dias')) AS fx (ordem, nome)
        CROSS JOIN (VALUES ('receber'), ('pagar')) AS tt (tipo)
        LEFT JOIN (SELECT pa.*, t.tipo AS titulo_tipo FROM public.parcelas_financeiras pa JOIN public.titulos_financeiros t ON t.id = pa.titulo_id
                    WHERE t.empresa_id = p_empresa_id AND pa.estado IN ('aberta', 'parcial')) pa
          ON pa.titulo_tipo = tt.tipo AND CASE fx.ordem
            WHEN 1 THEN pa.vencimento < v_hoje WHEN 2 THEN pa.vencimento BETWEEN v_hoje AND v_hoje + 7
            WHEN 3 THEN pa.vencimento BETWEEN v_hoje + 8 AND v_hoje + 30 ELSE pa.vencimento > v_hoje + 30 END
       GROUP BY tt.tipo, fx.ordem, fx.nome) q;
  ELSIF p_tipo = 'mensal' THEN
    v_metodo := 'Mês a mês: fluxo de caixa e resultado gerencial estimado, com os mesmos métodos do painel.';
    IF p.ate - p.de > 370 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'O relatório mensal cobre no máximo 12 meses.', 'ate');
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('mes', m,
        'resumo', app_private.resumo_periodo(p_empresa_id, greatest(m, p.de), least((m + interval '1 month - 1 day')::date, p.ate), v_ver_custo))
        ORDER BY m), '[]'::jsonb)
      INTO v_linhas FROM (SELECT generate_series(date_trunc('month', p.de), date_trunc('month', p.ate), interval '1 month')::date AS m) g;
  ELSE
    PERFORM app_private.erro('VALIDATION_ERROR', 'Relatório desconhecido.', 'tipo');
  END IF;
  RETURN jsonb_build_object('tipo', p_tipo, 'periodo', jsonb_build_object('de', p.de, 'ate', p.ate), 'linhas', v_linhas, 'metodo', v_metodo,
    'aviso', 'Estimativa gerencial. Não é contabilidade oficial nem substitui um contador.');
END $$;

-- Exportação (D7-01): o banco entrega as linhas autorizadas e registra a exportação; o navegador monta o CSV.
CREATE FUNCTION public.exportar_financeiro(p_empresa_id uuid, p_tipo text, p_de date DEFAULT NULL, p_ate date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  p record;
  v_colunas jsonb;
  v_linhas jsonb;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.visualizar', 'financeiro.exportar']);
  p := app_private.ler_periodo(p_de, p_ate);
  IF p_tipo = 'lancamentos' THEN
    v_colunas := '["Data","Conta","Tipo","Natureza","Categoria","Entrada (R$)","Saída (R$)","Descrição","Origem","Estorno de","Registrado por"]';
    SELECT coalesce(jsonb_agg(jsonb_build_array(l.data, c.nome, l.tipo, l.natureza, cat.nome,
        CASE WHEN l.sentido = 'entrada' THEN app_private.para_centavos(l.valor) END,
        CASE WHEN l.sentido = 'saida' THEN app_private.para_centavos(l.valor) END,
        coalesce(l.descricao, t.descricao), l.origem_tipo, l.estorno_de, app_private.nome_da_pessoa(l.autor))
        ORDER BY l.data, l.criado_em), '[]'::jsonb)
      INTO v_linhas FROM (SELECT * FROM public.lancamentos_financeiros WHERE empresa_id = p_empresa_id AND data BETWEEN p.de AND p.ate
                           ORDER BY data, criado_em LIMIT 5000) l
      JOIN public.contas_financeiras c ON c.id = l.conta_id
      LEFT JOIN public.categorias_financeiras cat ON cat.id = l.categoria_id
      LEFT JOIN public.titulos_financeiros t ON t.id = l.titulo_id;
  ELSIF p_tipo = 'titulos' THEN
    v_colunas := '["Tipo","Descrição","Categoria","Referência","Contraparte","Parcela","Vencimento","Valor (R$)","Saldo (R$)","Situação"]';
    SELECT coalesce(jsonb_agg(jsonb_build_array(t.tipo, t.descricao, cat.nome, t.competencia, coalesce(ce.nome, fo.nome, t.contraparte_texto),
        pa.sequencia, pa.vencimento, app_private.para_centavos(pa.valor), app_private.para_centavos(pa.saldo),
        app_private.estado_exibicao(pa.estado, pa.vencimento, pa.estado = 'parcial')) ORDER BY pa.vencimento, t.descricao, pa.sequencia), '[]'::jsonb)
      INTO v_linhas FROM public.titulos_financeiros t
      JOIN public.parcelas_financeiras pa ON pa.titulo_id = t.id
      LEFT JOIN public.categorias_financeiras cat ON cat.id = t.categoria_id
      LEFT JOIN public.clientes_empresa ce ON ce.id = t.cliente_empresa_id
      LEFT JOIN public.fornecedores fo ON fo.id = t.fornecedor_id
     WHERE t.empresa_id = p_empresa_id AND (pa.vencimento BETWEEN p.de AND p.ate OR t.competencia BETWEEN p.de AND p.ate);
  ELSIF p_tipo IN ('categorias', 'contas') THEN
    v_linhas := (public.relatorio_financeiro(p_empresa_id, p_tipo, p.de, p.ate))->'linhas';
    IF p_tipo = 'categorias' THEN
      v_colunas := '["Natureza","Categoria","Entradas (R$)","Saídas (R$)","Líquido (R$)","Lançamentos"]';
      SELECT coalesce(jsonb_agg(jsonb_build_array(x->'natureza', x->'categoria', x->'entradas_centavos', x->'saidas_centavos',
        x->'liquido_centavos', x->'lancamentos')), '[]'::jsonb) INTO v_linhas FROM jsonb_array_elements(v_linhas) x;
    ELSE
      v_colunas := '["Conta","Tipo","Saldo inicial (R$)","Entradas (R$)","Saídas (R$)","Saldo final (R$)"]';
      SELECT coalesce(jsonb_agg(jsonb_build_array(x->'conta', x->'tipo', x->'saldo_inicial_centavos', x->'entradas_centavos',
        x->'saidas_centavos', x->'saldo_final_centavos')), '[]'::jsonb) INTO v_linhas FROM jsonb_array_elements(v_linhas) x;
    END IF;
  ELSE
    PERFORM app_private.erro('VALIDATION_ERROR', 'Exportação desconhecida.', 'tipo');
  END IF;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.exportacao', 'lancamentos_financeiros', NULL,
    jsonb_build_object('tipo', p_tipo, 'de', p.de, 'ate', p.ate, 'linhas', jsonb_array_length(v_linhas)));
  RETURN jsonb_build_object('tipo', p_tipo, 'periodo', jsonb_build_object('de', p.de, 'ate', p.ate), 'colunas', v_colunas,
    'linhas', v_linhas, 'valores_em_centavos', true, 'limite_atingido', jsonb_array_length(v_linhas) >= 5000);
END $$;

-- Reconciliação (FIN-P6): saldo de cada conta = soma dos lançamentos; baixado de cada título = soma das baixas válidas;
-- toda baixa tem exatamente um lançamento; toda transferência tem saída e entrada.
CREATE FUNCTION app_private.reconciliacao(p_empresa uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH contas AS (
    SELECT c.id, c.nome, c.saldo, coalesce(sum(CASE WHEN l.sentido = 'entrada' THEN l.valor ELSE -l.valor END), 0) AS soma
      FROM public.contas_financeiras c LEFT JOIN public.lancamentos_financeiros l ON l.conta_id = c.id
     WHERE c.empresa_id = p_empresa GROUP BY c.id, c.nome, c.saldo),
  titulos AS (
    SELECT t.id, t.descricao, t.tipo, t.recebido, t.a_devolver, t.estado,
      CASE t.tipo WHEN 'receber' THEN coalesce((SELECT sum(CASE r.tipo WHEN 'recebimento' THEN r.valor WHEN 'estorno' THEN -r.valor ELSE 0 END)
                                                  FROM public.recebimentos r WHERE r.titulo_id = t.id), 0)
                  ELSE coalesce((SELECT sum(CASE g.tipo WHEN 'pagamento' THEN g.valor ELSE -g.valor END)
                                   FROM public.pagamentos g WHERE g.titulo_id = t.id), 0) END AS baixas,
      coalesce((SELECT sum(r.valor) FROM public.recebimentos r WHERE r.titulo_id = t.id AND r.tipo = 'devolucao'), 0) AS devolvido
      FROM public.titulos_financeiros t WHERE t.empresa_id = p_empresa),
  parcelas AS (
    SELECT pa.id FROM public.parcelas_financeiras pa JOIN public.titulos_financeiros t ON t.id = pa.titulo_id
     WHERE t.empresa_id = p_empresa AND pa.saldo <> pa.valor - coalesce((
       SELECT sum(CASE WHEN x.tipo IN ('recebimento', 'pagamento') THEN x.valor ELSE -x.valor END) FROM (
         SELECT r.tipo, r.valor FROM public.recebimentos r WHERE r.parcela_id = pa.id AND r.tipo <> 'devolucao'
         UNION ALL SELECT g.tipo, g.valor FROM public.pagamentos g WHERE g.parcela_id = pa.id) x), 0))
  SELECT jsonb_build_object(
    'contas_divergentes', coalesce((SELECT jsonb_agg(jsonb_build_object('conta', nome, 'saldo_centavos', app_private.para_centavos(saldo),
        'soma_lancamentos_centavos', app_private.para_centavos(soma))) FROM contas WHERE saldo <> soma), '[]'::jsonb),
    'titulos_divergentes', coalesce((SELECT jsonb_agg(jsonb_build_object('titulo', descricao, 'baixado_centavos', app_private.para_centavos(recebido),
        'soma_baixas_centavos', app_private.para_centavos(baixas)))
      FROM titulos WHERE recebido <> baixas OR (tipo = 'receber' AND estado = 'cancelado' AND a_devolver <> recebido - devolvido)), '[]'::jsonb),
    'parcelas_divergentes', (SELECT count(*) FROM parcelas),
    'recebimentos_sem_lancamento', (SELECT count(*) FROM public.recebimentos r WHERE r.empresa_id = p_empresa
      AND (SELECT count(*) FROM public.lancamentos_financeiros l WHERE l.origem_tipo = 'recebimento' AND l.origem_id = r.id) <> 1),
    'pagamentos_sem_lancamento', (SELECT count(*) FROM public.pagamentos g WHERE g.empresa_id = p_empresa
      AND (SELECT count(*) FROM public.lancamentos_financeiros l WHERE l.origem_tipo = 'pagamento' AND l.origem_id = g.id) <> 1),
    'transferencias_incompletas', (SELECT count(*) FROM public.transferencias_financeiras tr WHERE tr.empresa_id = p_empresa
      AND (SELECT count(*) FROM public.lancamentos_financeiros l WHERE l.origem_tipo = 'transferencia' AND l.origem_id = tr.id) <> 2),
    'lancamentos_sem_origem', (SELECT count(*) FROM public.lancamentos_financeiros l WHERE l.empresa_id = p_empresa AND (
         (l.origem_tipo = 'recebimento' AND NOT EXISTS (SELECT 1 FROM public.recebimentos r WHERE r.id = l.origem_id))
      OR (l.origem_tipo = 'pagamento' AND NOT EXISTS (SELECT 1 FROM public.pagamentos g WHERE g.id = l.origem_id))
      OR (l.origem_tipo = 'transferencia' AND NOT EXISTS (SELECT 1 FROM public.transferencias_financeiras tr WHERE tr.id = l.origem_id))
      OR (l.origem_tipo = 'conta' AND l.origem_id <> l.conta_id)
      OR (l.origem_tipo = 'fechamento' AND NOT EXISTS (SELECT 1 FROM public.fechamentos_financeiros fe WHERE fe.id = l.origem_id))
      OR (l.origem_tipo = 'estorno' AND l.origem_id IS DISTINCT FROM l.estorno_de))))
$$;

CREATE FUNCTION public.reconciliar_financeiro(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  r jsonb;
BEGIN
  PERFORM app_private.exigir_proprietario(p_empresa_id, usuario, 'Só o proprietário confere a reconciliação dos saldos.');
  r := app_private.reconciliacao(p_empresa_id);
  RETURN r || jsonb_build_object('ok', jsonb_array_length(r->'contas_divergentes') = 0 AND jsonb_array_length(r->'titulos_divergentes') = 0
    AND (r->>'parcelas_divergentes')::int = 0 AND (r->>'recebimentos_sem_lancamento')::int = 0 AND (r->>'pagamentos_sem_lancamento')::int = 0
    AND (r->>'transferencias_incompletas')::int = 0 AND (r->>'lancamentos_sem_origem')::int = 0);
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
    'public.registrar_recebimento(uuid, bigint, text, date, text, uuid)',
    'public.registrar_devolucao_valor(uuid, bigint, text, text, text, uuid)',
    'public.criar_conta(uuid, jsonb, text)',
    'public.alterar_conta(uuid, jsonb, integer, text)',
    'public.definir_conta_ativa(uuid, boolean, integer, text)',
    'public.definir_conta_padrao(uuid, integer, text)',
    'public.criar_categoria_financeira(uuid, jsonb, text)',
    'public.alterar_categoria_financeira(uuid, jsonb, integer, text)',
    'public.definir_categoria_ativa(uuid, boolean, integer, text)',
    'public.criar_titulo(uuid, jsonb, text)',
    'public.cancelar_titulo(uuid, text, integer, text)',
    'public.registrar_pagamento(uuid, bigint, uuid, text, date, text)',
    'public.estornar_pagamento(uuid, text, text)',
    'public.registrar_lancamento(uuid, jsonb, text)',
    'public.registrar_movimento_proprietario(uuid, jsonb, text)',
    'public.estornar_lancamento(uuid, text, text)',
    'public.transferir(uuid, jsonb, text)',
    'public.estornar_transferencia(uuid, text, text)',
    'public.criar_recorrencia(uuid, jsonb, text)',
    'public.alterar_recorrencia(uuid, jsonb, integer, text)',
    'public.definir_recorrencia_ativa(uuid, boolean, integer, text)',
    'public.gerar_recorrencias(uuid)',
    'public.compras_para_conta_pagar(uuid)',
    'public.gerar_titulo_compra(uuid, jsonb, text)',
    'public.fechar_periodo(uuid, date, jsonb, text)',
    'public.reabrir_periodo(uuid, text, text)',
    'public.contas_da_empresa(uuid)',
    'public.categorias_financeiras_da_empresa(uuid)',
    'public.titulos_da_empresa(uuid, jsonb, integer, integer)',
    'public.titulo_detalhe(uuid)',
    'public.lancamentos_da_empresa(uuid, jsonb, integer, integer)',
    'public.recorrencias_da_empresa(uuid)',
    'public.painel_financeiro(uuid, date, date)',
    'public.situacao_fechamento(uuid)',
    'public.relatorio_financeiro(uuid, text, date, date)',
    'public.exportar_financeiro(uuid, text, date, date)',
    'public.reconciliar_financeiro(uuid)'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

ALTER TABLE app_private.controle_financeiro ENABLE ROW LEVEL SECURITY;   -- sem GRANT

-- Saldo das contas só por função (quem só registra recebimentos no balcão escolhe a conta, mas não vê saldo).
REVOKE SELECT ON public.contas_financeiras FROM authenticated;
GRANT SELECT (id, empresa_id, nome, tipo, padrao, ativa, criado_em) ON public.contas_financeiras TO authenticated;

-- Contas a pagar e contas a receber manuais são do financeiro; quem só vê vendas continua vendo só o a receber das vendas.
DROP POLICY titulos_ler ON public.titulos_financeiros;
CREATE POLICY titulos_ler ON public.titulos_financeiros FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar'))
      OR (origem_tipo = 'venda' AND (SELECT authz.tem_permissao(empresa_id, 'vendas.visualizar'))));
REVOKE SELECT ON public.titulos_financeiros FROM authenticated;
GRANT SELECT (id, empresa_id, tipo, origem_tipo, origem_id, descricao, total, recebido, a_devolver, estado, versao, criado_em, cancelado_em,
  categoria_id, competencia, contraparte_tipo, cliente_empresa_id, fornecedor_id, contraparte_texto, motivo_cancelamento)
  ON public.titulos_financeiros TO authenticated;

DROP POLICY parcelas_ler ON public.parcelas_financeiras;
CREATE POLICY parcelas_ler ON public.parcelas_financeiras FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar'))
      OR ((SELECT authz.tem_permissao(empresa_id, 'vendas.visualizar'))
          AND titulo_id IN (SELECT t.id FROM public.titulos_financeiros t WHERE t.origem_tipo = 'venda')));

DROP POLICY recebimentos_ler ON public.recebimentos;
CREATE POLICY recebimentos_ler ON public.recebimentos FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar'))
      OR ((SELECT authz.tem_permissao(empresa_id, 'vendas.visualizar'))
          AND titulo_id IN (SELECT t.id FROM public.titulos_financeiros t WHERE t.origem_tipo = 'venda')));

ALTER TABLE public.categorias_financeiras ENABLE ROW LEVEL SECURITY;
CREATE POLICY categorias_financeiras_ler ON public.categorias_financeiras FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar')));
GRANT SELECT (id, empresa_id, tipo, nome, codigo_sistema, ativa, ordem, versao) ON public.categorias_financeiras TO authenticated;

ALTER TABLE public.lancamentos_financeiros ENABLE ROW LEVEL SECURITY;
CREATE POLICY lancamentos_ler ON public.lancamentos_financeiros FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar')));
GRANT SELECT (id, empresa_id, conta_id, data, sentido, valor, tipo, natureza, categoria_id, origem_tipo, origem_id, titulo_id, parcela_id,
  descricao, estorno_de, carga_m06, criado_em) ON public.lancamentos_financeiros TO authenticated;

ALTER TABLE public.pagamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY pagamentos_ler ON public.pagamentos FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar')));
GRANT SELECT (id, empresa_id, titulo_id, parcela_id, conta_id, tipo, valor, forma, data, motivo, estorno_de, criado_em)
  ON public.pagamentos TO authenticated;

ALTER TABLE public.transferencias_financeiras ENABLE ROW LEVEL SECURITY;
CREATE POLICY transferencias_ler ON public.transferencias_financeiras FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar')));
GRANT SELECT (id, empresa_id, conta_origem_id, conta_destino_id, valor, data, descricao, estorno_de, motivo, criado_em)
  ON public.transferencias_financeiras TO authenticated;

ALTER TABLE public.despesas_recorrentes ENABLE ROW LEVEL SECURITY;
CREATE POLICY recorrencias_ler ON public.despesas_recorrentes FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar')));
GRANT SELECT (id, empresa_id, descricao, valor, categoria_id, fornecedor_id, periodicidade, dia_vencimento, inicio, fim, ativa, versao, criado_em)
  ON public.despesas_recorrentes TO authenticated;

ALTER TABLE public.fechamentos_financeiros ENABLE ROW LEVEL SECURITY;
CREATE POLICY fechamentos_ler ON public.fechamentos_financeiros FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar')));
GRANT SELECT (id, empresa_id, mes, estado, saldos, conferencias, fechado_em, reaberto_em, motivo_reabertura)
  ON public.fechamentos_financeiros TO authenticated;   -- o resumo (com custos) só por função

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611120001', 'M07: financeiro (contas, livro-caixa, a pagar e a receber, recorrências, transferências, proprietário, fechamento, indicadores, CSV, integração M06)');

COMMIT;
