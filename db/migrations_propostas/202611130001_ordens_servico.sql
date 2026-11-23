-- 202611130001: M09, ordens de serviço, materiais, cancelamento com custos e contestação, agenda operacional,
-- reagendamento por acordo, garantia registrada, pacotes e serviços recorrentes (MINI-ESPEC_M09; ADR-G09 aprovada em
-- 12/11/2026, D9-01 a D9-28; implementação autorizada só no branch `desenvolvimento`).
-- Princípios: a OS nasce no aceite (D9-01 = B, substitui o D8-01), uma por aceite, na mesma transação; valores só no banco;
-- nada é cobrado automaticamente (custos só com aceite ou acordo); estoque pelo motor do M05; títulos pelo M07 sem
-- recebimento implícito; horário da OS muda só por acordo; tudo com chave de operação, trava da OS e auditoria.
-- Tabelas novas SEM acesso direto pela Data API: só funções. Nenhuma permissão nova (catálogo segue com 55; D9-27).

BEGIN;

-- ===========================================================================
-- 1. Estruturas
-- ===========================================================================
-- 1.1 Limites novos (D9-28), contador de OS (D9-02), pacotes (D9-22)
INSERT INTO app_private.limites_plataforma (chave, valor, minimo, maximo, descricao) VALUES
  ('reagendamentos_pendentes_por_os', 1, 1, 3, 'Pedidos de reagendamento pendentes ao mesmo tempo em cada ordem de serviço'),
  ('reagendamentos_por_os', 3, 1, 10, 'Pedidos de reagendamento do cliente em cada ordem de serviço (a empresa pode propor além disso com justificativa)');

ALTER TABLE app_private.contadores_empresa ADD COLUMN proxima_os integer NOT NULL DEFAULT 1;

ALTER TABLE public.servicos DROP CONSTRAINT servicos_politica_preco_check;
ALTER TABLE public.servicos ADD CONSTRAINT servicos_politica_preco_check
  CHECK (politica_preco IN ('fixo', 'a_partir_de', 'sob_consulta', 'por_regras', 'pacote'));
ALTER TABLE public.servicos DROP CONSTRAINT servicos_preco_politica;
ALTER TABLE public.servicos ADD CONSTRAINT servicos_preco_politica CHECK (
     (politica_preco IN ('fixo', 'a_partir_de', 'pacote') AND preco IS NOT NULL)
  OR (politica_preco = 'sob_consulta' AND preco IS NULL)
  OR (politica_preco = 'por_regras'));

CREATE TABLE public.servico_pacote_itens (
  empresa_id  uuid NOT NULL,
  pacote_id   uuid NOT NULL,
  servico_id  uuid NOT NULL,
  ordem       integer NOT NULL CHECK (ordem BETWEEN 1 AND 10),
  PRIMARY KEY (pacote_id, servico_id),
  UNIQUE (pacote_id, ordem),
  FOREIGN KEY (empresa_id, pacote_id) REFERENCES public.servicos (empresa_id, id),
  FOREIGN KEY (empresa_id, servico_id) REFERENCES public.servicos (empresa_id, id),
  CHECK (pacote_id <> servico_id)
);

-- 1.2 Política de cancelamento por empresa, versionada (D9-16)
CREATE TABLE public.politicas_cancelamento (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresas (id),
  versao      integer NOT NULL CHECK (versao >= 1),
  texto       text NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 20 AND 2000),
  ativa       boolean NOT NULL DEFAULT true,
  criada_por  text NOT NULL,
  criada_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  UNIQUE (empresa_id, versao)
);
CREATE UNIQUE INDEX politicas_uma_ativa ON public.politicas_cancelamento (empresa_id) WHERE ativa;

-- 1.3 Ordens de serviço (RF-102 a RF-106; D9-01 a D9-06)
CREATE TABLE public.ordens_servico (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES public.empresas (id),
  numero                integer NOT NULL CHECK (numero >= 1),
  solicitacao_id        uuid NOT NULL,
  versao_aceita_id      uuid NOT NULL,
  servico_id            uuid NOT NULL,
  servico_nome          text NOT NULL,
  origem                text NOT NULL CHECK (origem IN ('plataforma', 'interna')),
  cliente_id            uuid,
  cliente_auth_id       text,
  cliente_nome          text NOT NULL,
  valor_contratado      numeric(14,2) NOT NULL CHECK (valor_contratado >= 0),
  estado                text NOT NULL DEFAULT 'aguardando_inicio'
                        CHECK (estado IN ('aguardando_inicio', 'em_execucao', 'pausada', 'concluida', 'encerrada', 'cancelada')),
  responsavel_auth_id   text,
  previsao_conclusao    date,
  aceita_em             timestamptz NOT NULL,
  iniciada_em           timestamptz,
  concluida_em          timestamptz,
  encerrada_em          timestamptz,
  cancelada_em          timestamptz,
  encerrada_por         text CHECK (encerrada_por IN ('cliente', 'empresa')),
  revisao_pendente      boolean NOT NULL DEFAULT false,
  garantia_dias         integer CHECK (garantia_dias BETWEEN 0 AND 3650),
  garantia_condicoes    text CHECK (char_length(garantia_condicoes) <= 1000),
  garantia_registrada_em timestamptz,
  recorrencia           text CHECK (recorrencia IN ('semanal', 'quinzenal', 'mensal')),
  origem_carga          text CHECK (origem_carga IN ('m08')),
  versao                integer NOT NULL DEFAULT 1,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  UNIQUE (empresa_id, numero),
  UNIQUE (solicitacao_id),
  UNIQUE (versao_aceita_id),
  FOREIGN KEY (empresa_id, solicitacao_id) REFERENCES public.solicitacoes_servico (empresa_id, id),
  FOREIGN KEY (empresa_id, versao_aceita_id) REFERENCES public.orcamento_versoes (empresa_id, id),
  FOREIGN KEY (empresa_id, servico_id) REFERENCES public.servicos (empresa_id, id),
  FOREIGN KEY (empresa_id, cliente_id) REFERENCES public.clientes_empresa (empresa_id, id),
  CONSTRAINT os_origem_cliente CHECK (
       (origem = 'plataforma' AND cliente_auth_id IS NOT NULL)
    OR (origem = 'interna' AND cliente_auth_id IS NULL AND cliente_id IS NOT NULL)),
  CONSTRAINT os_datas_coerentes CHECK (
       (estado <> 'concluida' OR concluida_em IS NOT NULL)
    AND (estado <> 'encerrada' OR (encerrada_em IS NOT NULL AND concluida_em IS NOT NULL AND encerrada_por IS NOT NULL))
    AND (estado <> 'cancelada' OR cancelada_em IS NOT NULL))
);
CREATE INDEX ordens_empresa ON public.ordens_servico (empresa_id, estado, criado_em DESC);
CREATE INDEX ordens_cliente ON public.ordens_servico (cliente_auth_id, criado_em DESC) WHERE cliente_auth_id IS NOT NULL;

-- Próxima execução de serviço recorrente (D9-23): no máximo uma por OS.
ALTER TABLE public.solicitacoes_servico ADD COLUMN origem_os_id uuid;
ALTER TABLE public.solicitacoes_servico ADD CONSTRAINT solicitacoes_origem_os_fk
  FOREIGN KEY (empresa_id, origem_os_id) REFERENCES public.ordens_servico (empresa_id, id);
CREATE UNIQUE INDEX solicitacoes_uma_por_os ON public.solicitacoes_servico (origem_os_id) WHERE origem_os_id IS NOT NULL;

-- 1.4 Linha do tempo da OS (RN-038, RN-056): só inclusão.
CREATE TABLE public.os_eventos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  os_id          uuid NOT NULL,
  tipo           text NOT NULL,
  de_estado      text,
  para_estado    text,
  autor_tipo     text NOT NULL CHECK (autor_tipo IN ('cliente', 'equipe', 'sistema')),
  autor_auth_id  text,
  texto          text CHECK (char_length(texto) <= 1000),
  dados          jsonb NOT NULL DEFAULT '{}'::jsonb,
  publico        boolean NOT NULL,
  criado_em      timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (empresa_id, os_id) REFERENCES public.ordens_servico (empresa_id, id)
);
CREATE INDEX os_eventos_os ON public.os_eventos (os_id, criado_em);

-- 1.5 Materiais (RF-062, RF-063, FIN §4.4, FIN-I19; D9-07 a D9-09)
CREATE TABLE public.os_materiais (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  os_id              uuid NOT NULL,
  variacao_id        uuid NOT NULL,
  descricao          text NOT NULL CHECK (char_length(btrim(descricao)) BETWEEN 2 AND 120),
  origem             text NOT NULL CHECK (origem IN ('orcamento', 'adicionado')),
  qtd_prevista       integer NOT NULL DEFAULT 0 CHECK (qtd_prevista >= 0),
  qtd_usada          integer NOT NULL DEFAULT 0 CHECK (qtd_usada >= 0),
  qtd_devolvida      integer NOT NULL DEFAULT 0 CHECK (qtd_devolvida >= 0),
  reserva_origem_id  uuid,          -- origem da reserva ativa no motor do M05 (tipo 'os_material'); nula sem reserva
  versao             integer NOT NULL DEFAULT 1,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  UNIQUE (os_id, variacao_id),
  FOREIGN KEY (empresa_id, os_id) REFERENCES public.ordens_servico (empresa_id, id),
  FOREIGN KEY (empresa_id, variacao_id) REFERENCES public.produto_variacoes (empresa_id, id),
  CHECK (qtd_devolvida <= qtd_usada)
);

CREATE TABLE public.os_material_usos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  os_material_id  uuid NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('uso', 'devolucao')),
  quantidade      integer NOT NULL CHECK (quantidade > 0),
  estado          text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'confirmado', 'recusado')),
  custo_unitario  numeric(14,2),
  motivo          text CHECK (char_length(motivo) <= 300),
  autor           text NOT NULL,
  decidido_por    text,
  decidido_em     timestamptz,
  motivo_decisao  text CHECK (char_length(motivo_decisao) <= 300),
  operation_key   text,
  versao          integer NOT NULL DEFAULT 1,
  criado_em       timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, os_material_id) REFERENCES public.os_materiais (empresa_id, id),
  CHECK (tipo = 'uso' OR estado <> 'pendente')
);
CREATE INDEX os_usos_material ON public.os_material_usos (os_material_id, criado_em);
CREATE INDEX os_usos_pendentes ON public.os_material_usos (empresa_id) WHERE estado = 'pendente';

ALTER TABLE public.movimentacoes_estoque DROP CONSTRAINT movimentacoes_estoque_origem_tipo_check;
ALTER TABLE public.movimentacoes_estoque ADD CONSTRAINT movimentacoes_estoque_origem_tipo_check
  CHECK (origem_tipo IN ('proposta', 'estorno', 'reserva', 'venda', 'devolucao_venda', 'os'));

-- 1.6 Financeiro (D9-10, D9-11): títulos de serviço (sinal e saldo) e de custo de cancelamento aceito.
ALTER TABLE public.categorias_financeiras DROP CONSTRAINT categorias_financeiras_codigo_sistema_check;
ALTER TABLE public.categorias_financeiras ADD CONSTRAINT categorias_financeiras_codigo_sistema_check
  CHECK (codigo_sistema IN ('vendas', 'compras', 'insumos', 'servicos'));
ALTER TABLE public.categorias_financeiras DROP CONSTRAINT categorias_sistema_tipo;
ALTER TABLE public.categorias_financeiras ADD CONSTRAINT categorias_sistema_tipo CHECK (codigo_sistema IS NULL
  OR (codigo_sistema IN ('vendas', 'servicos') AND tipo = 'receita') OR (codigo_sistema IN ('compras', 'insumos') AND tipo = 'despesa'));

ALTER TABLE public.titulos_financeiros ADD COLUMN parte_servico text CHECK (parte_servico IN ('antecipacao', 'saldo'));
ALTER TABLE public.titulos_financeiros DROP CONSTRAINT titulos_financeiros_origem_tipo_check;
ALTER TABLE public.titulos_financeiros ADD CONSTRAINT titulos_financeiros_origem_tipo_check
  CHECK (origem_tipo IN ('venda', 'manual', 'compra', 'recorrencia', 'servico', 'cancelamento_servico'));
ALTER TABLE public.titulos_financeiros DROP CONSTRAINT titulos_tipo_origem;
ALTER TABLE public.titulos_financeiros ADD CONSTRAINT titulos_tipo_origem CHECK (
     (origem_tipo IN ('venda', 'servico', 'cancelamento_servico') AND tipo = 'receber')
  OR (origem_tipo IN ('compra', 'recorrencia') AND tipo = 'pagar') OR origem_tipo = 'manual');
ALTER TABLE public.titulos_financeiros ADD CONSTRAINT titulos_parte_servico CHECK ((origem_tipo = 'servico') = (parte_servico IS NOT NULL));
-- Sem título duplicado: um sinal e um saldo ativos por OS; um título ativo por proposta de custo.
CREATE UNIQUE INDEX titulos_servico_parte_unica ON public.titulos_financeiros (empresa_id, origem_id, parte_servico)
  WHERE origem_tipo = 'servico' AND estado <> 'cancelado';
CREATE UNIQUE INDEX titulos_custo_cancelamento_unico ON public.titulos_financeiros (empresa_id, origem_id)
  WHERE origem_tipo = 'cancelamento_servico' AND estado <> 'cancelado';

-- 1.7 Cancelamento depois do aceite, custos e contestação (RF-107 a RF-109; D9-12 a D9-16)
CREATE TABLE public.cancelamentos_os (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL,
  os_id                   uuid NOT NULL,
  solicitado_por          text NOT NULL CHECK (solicitado_por IN ('cliente', 'empresa')),
  registrado_por_tipo     text NOT NULL CHECK (registrado_por_tipo IN ('cliente', 'equipe')),
  autor                   text NOT NULL,
  motivo                  text CHECK (char_length(motivo) <= 300),
  estado_no_momento       text NOT NULL,
  arrependimento_possivel boolean NOT NULL,
  tinha_condicoes         boolean NOT NULL,
  condicoes_retrato       jsonb NOT NULL,
  recebido_no_momento     numeric(14,2) NOT NULL DEFAULT 0,
  criado_em               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  UNIQUE (os_id),
  FOREIGN KEY (empresa_id, os_id) REFERENCES public.ordens_servico (empresa_id, id)
);

CREATE TABLE public.propostas_custo_cancelamento (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL,
  cancelamento_id  uuid NOT NULL,
  os_id            uuid NOT NULL,
  numero           integer NOT NULL CHECK (numero >= 1),
  itens            jsonb NOT NULL,
  justificativa    text NOT NULL CHECK (char_length(btrim(justificativa)) BETWEEN 10 AND 1000),
  total            numeric(14,2) NOT NULL CHECK (total > 0),
  teto             numeric(14,2) NOT NULL,
  estado           text NOT NULL DEFAULT 'pendente'
                   CHECK (estado IN ('pendente', 'aceita', 'contestada', 'revisada', 'retirada', 'acordo_proposto', 'acordo')),
  contestacao      text CHECK (char_length(contestacao) <= 1000),
  resposta_por     text CHECK (resposta_por IN ('cliente', 'equipe')),
  resposta_autor   text,
  respondida_em    timestamptz,
  acordo_valor     numeric(14,2) CHECK (acordo_valor >= 0),
  acordo_texto     text CHECK (char_length(acordo_texto) <= 1000),
  motivo_retirada  text CHECK (char_length(motivo_retirada) <= 300),
  titulo_id        uuid,
  autor            text NOT NULL,
  versao           integer NOT NULL DEFAULT 1,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  UNIQUE (cancelamento_id, numero),
  FOREIGN KEY (empresa_id, cancelamento_id) REFERENCES public.cancelamentos_os (empresa_id, id),
  FOREIGN KEY (empresa_id, os_id) REFERENCES public.ordens_servico (empresa_id, id),
  FOREIGN KEY (empresa_id, titulo_id) REFERENCES public.titulos_financeiros (empresa_id, id),
  CHECK (total <= teto),
  CHECK (acordo_valor IS NULL OR acordo_valor <= total),
  CHECK (titulo_id IS NULL OR estado IN ('aceita', 'acordo'))
);
CREATE UNIQUE INDEX propostas_uma_ativa ON public.propostas_custo_cancelamento (cancelamento_id)
  WHERE estado NOT IN ('revisada', 'retirada');

-- 1.8 Reagendamento por acordo (RF-117; D9-18 a D9-20)
CREATE TABLE public.reagendamentos (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL,
  os_id                   uuid NOT NULL,
  tipo                    text NOT NULL CHECK (tipo IN ('definicao', 'alteracao')),
  proposto_por            text NOT NULL CHECK (proposto_por IN ('empresa', 'cliente')),
  autor                   text NOT NULL,
  inicio                  timestamptz NOT NULL,
  fim                     timestamptz NOT NULL,
  motivo                  text CHECK (char_length(motivo) <= 300),
  avisos                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  justificativa           text CHECK (char_length(justificativa) <= 300),
  estado                  text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'aceito', 'recusado', 'retirado', 'substituido')),
  resposta_motivo         text CHECK (char_length(resposta_motivo) <= 300),
  respondido_por          text,
  respondido_em           timestamptz,
  concordancia_informada  boolean NOT NULL DEFAULT false,
  agendamento_id          uuid,
  criado_em               timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, os_id) REFERENCES public.ordens_servico (empresa_id, id),
  CHECK (fim > inicio AND fim - inicio <= interval '12 hours')
);
CREATE INDEX reagendamentos_os ON public.reagendamentos (os_id, criado_em);
CREATE INDEX reagendamentos_pendentes ON public.reagendamentos (empresa_id, inicio) WHERE estado = 'pendente';

-- 1.9 Proteções: histórico sem exclusão e linha do tempo imutável
CREATE TRIGGER os_eventos_imutaveis BEFORE UPDATE OR DELETE ON public.os_eventos
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
CREATE TRIGGER ordens_sem_exclusao BEFORE DELETE ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
CREATE TRIGGER os_materiais_sem_exclusao BEFORE DELETE ON public.os_materiais
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
CREATE TRIGGER os_usos_sem_exclusao BEFORE DELETE ON public.os_material_usos
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
CREATE TRIGGER cancelamentos_os_imutaveis BEFORE UPDATE OR DELETE ON public.cancelamentos_os
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
CREATE TRIGGER propostas_custo_sem_exclusao BEFORE DELETE ON public.propostas_custo_cancelamento
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
CREATE TRIGGER reagendamentos_sem_exclusao BEFORE DELETE ON public.reagendamentos
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
CREATE TRIGGER politicas_cancelamento_sem_exclusao BEFORE DELETE ON public.politicas_cancelamento
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- ===========================================================================
-- 2. Auxiliares
-- ===========================================================================
CREATE FUNCTION app_private.os_trava(p_id uuid) RETURNS public.ordens_servico
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  o public.ordens_servico;
BEGIN
  SELECT * INTO o FROM public.ordens_servico WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Ordem de serviço não encontrada.');
  END IF;
  RETURN o;
END $$;

CREATE FUNCTION app_private.os_evento(p_os public.ordens_servico, p_tipo text, p_de text, p_para text, p_autor_tipo text,
  p_autor text, p_texto text, p_dados jsonb, p_publico boolean) RETURNS void
LANGUAGE sql SET search_path = ''
AS $$
  INSERT INTO public.os_eventos (empresa_id, os_id, tipo, de_estado, para_estado, autor_tipo, autor_auth_id, texto, dados, publico)
  VALUES (p_os.empresa_id, p_os.id, p_tipo, p_de, p_para, p_autor_tipo, p_autor, p_texto, coalesce(p_dados, '{}'::jsonb), p_publico)
$$;

-- Titular (cliente da plataforma) ou membro da equipe com a permissão. Quem não é nenhum dos dois recebe "não encontrada".
CREATE FUNCTION app_private.papel_na_os(p_os public.ordens_servico, p_usuario text, p_permissao text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF p_os.origem = 'plataforma' AND p_os.cliente_auth_id = p_usuario THEN
    RETURN 'cliente';
  END IF;
  IF p_permissao IS NOT NULL AND app_private.eh_membro(p_os.empresa_id, p_usuario) THEN
    PERFORM app_private.exigir_permissoes(p_os.empresa_id, p_usuario, ARRAY[p_permissao]);
    RETURN 'equipe';
  END IF;
  PERFORM app_private.erro('NOT_FOUND', 'Ordem de serviço não encontrada.');
  RETURN NULL;
END $$;

CREATE FUNCTION app_private.os_ativa(p_os public.ordens_servico) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT p_os.estado IN ('aguardando_inicio', 'em_execucao', 'pausada') $$;

-- Categoria de receita "Serviços prestados" (sistema), criada na primeira necessidade (não muda empresas sem serviço).
CREATE FUNCTION app_private.categoria_servicos(p_empresa uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v uuid;
BEGIN
  PERFORM app_private.garantir_categorias(p_empresa);
  SELECT id INTO v FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND codigo_sistema = 'servicos';
  IF v IS NOT NULL THEN RETURN v; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('categorias|' || p_empresa::text, 0));
  SELECT id INTO v FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND codigo_sistema = 'servicos';
  IF v IS NOT NULL THEN RETURN v; END IF;
  INSERT INTO public.categorias_financeiras (empresa_id, tipo, nome, codigo_sistema, ordem)
  VALUES (p_empresa, 'receita',
    CASE WHEN EXISTS (SELECT 1 FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND tipo = 'receita' AND ativa
                       AND lower(nome) = 'serviços prestados') THEN 'Serviços prestados (OS)' ELSE 'Serviços prestados' END,
    'servicos', 2)
  RETURNING id INTO v;
  RETURN v;
END $$;

-- Título a receber da OS (sinal ou saldo) ou de custo de cancelamento aceito. Nunca gera recebimento.
CREATE FUNCTION app_private.criar_titulo_os(p_os public.ordens_servico, p_origem_tipo text, p_origem_id uuid, p_parte text,
  p_descricao text, p_parcelas jsonb, p_usuario text) RETURNS uuid
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app_private.exigir_competencia_aberta(p_os.empresa_id, app_private.hoje_sp());
  INSERT INTO public.titulos_financeiros (empresa_id, tipo, origem_tipo, origem_id, parte_servico, descricao, total, categoria_id,
    competencia, contraparte_tipo, cliente_empresa_id, contraparte_texto, criado_por)
  VALUES (p_os.empresa_id, 'receber', p_origem_tipo, p_origem_id, p_parte, left(p_descricao, 120), 0,
    app_private.categoria_servicos(p_os.empresa_id), app_private.hoje_sp(),
    CASE WHEN p_os.cliente_id IS NOT NULL THEN 'cliente' ELSE 'texto' END, p_os.cliente_id,
    CASE WHEN p_os.cliente_id IS NULL THEN left(p_os.cliente_nome, 120) END, p_usuario)
  RETURNING id INTO v_id;
  PERFORM app_private.gravar_parcelas(p_os.empresa_id, v_id, p_parcelas);
  RETURN v_id;
END $$;

-- Valores da OS (D9-10, D9-25): contratado, sinal, titulado, recebido, saldo pendente e a devolver.
CREATE FUNCTION app_private.os_valores(p_os uuid, p_para_cliente boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'contratado_centavos', app_private.para_centavos(o.valor_contratado),
    'recebido_centavos', app_private.para_centavos(coalesce(sum(t.recebido), 0)),
    'saldo_pendente_centavos', app_private.para_centavos(coalesce(sum(t.total - t.recebido) FILTER (WHERE t.estado <> 'cancelado'), 0)),
    'a_devolver_centavos', app_private.para_centavos(coalesce(sum(t.a_devolver), 0)),
    'situacao', CASE
      WHEN coalesce(sum(t.total) FILTER (WHERE t.estado <> 'cancelado'), 0) = 0 AND coalesce(sum(t.recebido), 0) = 0 THEN 'sem_cobranca'
      WHEN coalesce(sum(t.total - t.recebido) FILTER (WHERE t.estado <> 'cancelado'), 0) = 0 THEN 'pago'
      WHEN coalesce(sum(t.recebido), 0) > 0 THEN 'parcial'
      ELSE 'pendente' END,
    'aviso', 'Situação conforme os registros da empresa; registro manual não é confirmação bancária nem pagamento pela plataforma.')
  || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object(
    'antecipado_centavos', app_private.para_centavos(coalesce(sum(t.total) FILTER (WHERE t.parte_servico = 'antecipacao' AND t.estado <> 'cancelado'), 0)),
    'titulado_centavos', app_private.para_centavos(coalesce(sum(t.total) FILTER (WHERE t.estado <> 'cancelado'), 0)),
    'a_titular_centavos', app_private.para_centavos(o.valor_contratado - coalesce(sum(t.total) FILTER (WHERE t.estado <> 'cancelado'), 0)),
    'titulos', coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'parte', t.parte_servico, 'estado', t.estado,
      'total_centavos', app_private.para_centavos(t.total), 'recebido_centavos', app_private.para_centavos(t.recebido),
      'a_devolver_centavos', app_private.para_centavos(t.a_devolver), 'versao', t.versao,
      'parcelas', (SELECT jsonb_agg(jsonb_build_object('id', pa.id, 'sequencia', pa.sequencia, 'vencimento', pa.vencimento,
          'saldo_centavos', app_private.para_centavos(pa.saldo), 'estado', pa.estado) ORDER BY pa.sequencia)
        FROM public.parcelas_financeiras pa WHERE pa.titulo_id = t.id)) ORDER BY t.criado_em) FILTER (WHERE t.id IS NOT NULL), '[]'::jsonb)) END
  FROM public.ordens_servico o
  LEFT JOIN public.titulos_financeiros t ON t.empresa_id = o.empresa_id AND t.origem_tipo = 'servico' AND t.origem_id = o.id
  WHERE o.id = p_os
  GROUP BY o.id, o.valor_contratado
$$;

CREATE FUNCTION app_private.os_materiais_json(p_os uuid, p_ver_custo boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'variacao_id', m.variacao_id, 'descricao', m.descricao, 'produto', p.nome,
      'variacao', app_private.rotulo_variacao(v.atributos, v.padrao), 'origem', m.origem, 'prevista', m.qtd_prevista,
      'usada', m.qtd_usada, 'devolvida', m.qtd_devolvida, 'reservada', coalesce((SELECT sum(r.quantidade) FROM public.reservas_estoque r
        WHERE r.empresa_id = m.empresa_id AND r.origem_tipo = 'os_material' AND r.origem_id = m.reserva_origem_id AND r.estado = 'ativa'), 0),
      'disponivel', s.disponivel, 'versao', m.versao,
      'usos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'tipo', u.tipo, 'quantidade', u.quantidade, 'estado', u.estado,
          'motivo', u.motivo, 'autor', app_private.nome_da_pessoa(u.autor), 'decidido_por', app_private.nome_da_pessoa(u.decidido_por),
          'motivo_decisao', u.motivo_decisao, 'criado_em', u.criado_em, 'versao', u.versao)
          || CASE WHEN p_ver_custo THEN jsonb_build_object('custo_unitario_centavos', app_private.para_centavos(u.custo_unitario)) ELSE '{}'::jsonb END
          ORDER BY u.criado_em) FROM public.os_material_usos u WHERE u.os_material_id = m.id), '[]'::jsonb))
      || CASE WHEN p_ver_custo THEN jsonb_build_object(
        'custo_previsto_centavos', app_private.para_centavos(v.custo_atual * m.qtd_prevista),
        'custo_confirmado_centavos', app_private.para_centavos(coalesce((SELECT sum(CASE u.tipo WHEN 'uso' THEN 1 ELSE -1 END * u.quantidade * u.custo_unitario)
          FROM public.os_material_usos u WHERE u.os_material_id = m.id AND u.estado = 'confirmado'), 0))) ELSE '{}'::jsonb END
      ORDER BY m.criado_em), '[]'::jsonb)
  FROM public.os_materiais m
  JOIN public.produto_variacoes v ON v.id = m.variacao_id
  JOIN public.produtos p ON p.id = v.produto_id
  LEFT JOIN public.saldos_estoque s ON s.variacao_id = m.variacao_id
  WHERE m.os_id = p_os
$$;

CREATE FUNCTION app_private.os_resumo(p_solicitacao uuid, p_para_cliente boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', o.id, 'numero', o.numero, 'estado', o.estado)
  FROM public.ordens_servico o WHERE o.solicitacao_id = p_solicitacao
$$;

-- Encerramento pela empresa (D9-06 com ajuste): 7 dias depois da conclusão, sem revisão nem contestação pendente;
-- solicitação interna, a qualquer momento depois da conclusão. Calculado na leitura; nada roda sozinho.
CREATE FUNCTION app_private.os_encerramento(p_os public.ordens_servico) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'empresa_pode_encerrar', p_os.estado = 'concluida' AND NOT p_os.revisao_pendente
      AND (p_os.origem = 'interna' OR now() >= p_os.concluida_em + interval '7 days'),
    'a_partir_de', CASE WHEN p_os.estado = 'concluida' AND p_os.origem = 'plataforma' THEN p_os.concluida_em + interval '7 days' END,
    'motivo', CASE
      WHEN p_os.estado <> 'concluida' THEN NULL
      WHEN p_os.revisao_pendente THEN 'O cliente pediu revisão: reabra a OS ou aguarde a confirmação dele.'
      WHEN p_os.origem = 'plataforma' AND now() < p_os.concluida_em + interval '7 days'
        THEN 'Aguardando a confirmação do cliente ou o prazo de 7 dias depois da conclusão.' END,
    'aviso', 'O encerramento é administrativo e não elimina direitos legais de garantia, reclamação ou contestação.')
$$;

CREATE FUNCTION app_private.os_json(p_id uuid, p_para_cliente boolean, p_ver_custo boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  o public.ordens_servico;
  s public.solicitacoes_servico;
  v public.orcamento_versoes;
  c public.cancelamentos_os;
  r jsonb;
BEGIN
  SELECT * INTO o FROM public.ordens_servico WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.solicitacoes_servico WHERE id = o.solicitacao_id;
  SELECT * INTO v FROM public.orcamento_versoes WHERE id = o.versao_aceita_id;
  SELECT * INTO c FROM public.cancelamentos_os WHERE os_id = o.id;
  r := jsonb_build_object('id', o.id, 'numero', o.numero, 'empresa_id', o.empresa_id,
    'empresa', (SELECT e.nome_publico FROM public.empresas e WHERE e.id = o.empresa_id),
    'solicitacao_id', o.solicitacao_id, 'solicitacao_numero', s.numero, 'servico', o.servico_nome, 'origem', o.origem,
    'cliente_nome', o.cliente_nome, 'estado', o.estado, 'previsao_conclusao', o.previsao_conclusao,
    'aceita_em', o.aceita_em, 'iniciada_em', o.iniciada_em, 'concluida_em', o.concluida_em, 'encerrada_em', o.encerrada_em,
    'cancelada_em', o.cancelada_em, 'encerrada_por', o.encerrada_por, 'revisao_pendente', o.revisao_pendente,
    'garantia', CASE WHEN o.garantia_dias IS NOT NULL THEN jsonb_build_object('dias', o.garantia_dias, 'condicoes', o.garantia_condicoes,
      'ate', (o.concluida_em AT TIME ZONE 'America/Sao_Paulo')::date + o.garantia_dias,
      'aviso', 'Garantia oferecida pela empresa; não substitui os direitos previstos em lei.') END,
    'recorrencia', o.recorrencia,
    'proxima', (SELECT jsonb_build_object('solicitacao_id', x.id, 'numero', x.numero, 'estado', x.estado)
      FROM public.solicitacoes_servico x WHERE x.origem_os_id = o.id),
    'valores', app_private.os_valores(o.id, p_para_cliente),
    'versao_aceita', app_private.versao_json(v, p_para_cliente),
    'condicoes_cancelamento', jsonb_build_object('politica', v.aceite->'politica_cancelamento', 'condicoes', v.condicoes),
    'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim, 'menos_de_24h', a.inicio - now() < interval '24 hours' AND a.inicio > now(),
        'aviso', 'Horário combinado. Para mudar, peça outro horário: a mudança só vale quando a outra parte concordar.')
        || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object('id', a.id, 'avisos', a.avisos, 'justificativa', a.justificativa) END
      FROM public.agendamentos a WHERE a.solicitacao_id = o.solicitacao_id AND a.estado = 'confirmado'),
    'reagendamentos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'tipo', g.tipo, 'proposto_por', g.proposto_por,
        'inicio', g.inicio, 'fim', g.fim, 'motivo', g.motivo, 'estado', g.estado, 'resposta_motivo', g.resposta_motivo,
        'respondido_em', g.respondido_em, 'concordancia_informada', g.concordancia_informada, 'criado_em', g.criado_em,
        'menos_de_24h', g.inicio - now() < interval '24 hours' AND g.inicio > now())
        || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object('avisos', g.avisos, 'justificativa', g.justificativa,
             'autor', app_private.nome_da_pessoa(g.autor)) END ORDER BY g.criado_em DESC)
      FROM public.reagendamentos g WHERE g.os_id = o.id), '[]'::jsonb),
    'pedidos_de_reagendamento_do_cliente', (SELECT count(*) FROM public.reagendamentos g WHERE g.os_id = o.id AND g.proposto_por = 'cliente'),
    'cancelamento', CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('solicitado_por', c.solicitado_por, 'motivo', c.motivo,
      'estado_no_momento', c.estado_no_momento, 'criado_em', c.criado_em, 'arrependimento_possivel', c.arrependimento_possivel,
      'tinha_condicoes', c.tinha_condicoes,
      'aviso_arrependimento', CASE WHEN c.arrependimento_possivel THEN 'Cancelamento em até 7 dias da contratação pela plataforma, antes do início do serviço: não há custos de cancelamento. Regra sujeita a revisão jurídica.' END) END,
    'custos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', pc.id, 'numero', pc.numero, 'itens', pc.itens,
        'justificativa', pc.justificativa, 'total_centavos', app_private.para_centavos(pc.total), 'estado', pc.estado,
        'contestacao', pc.contestacao, 'resposta_por', pc.resposta_por, 'respondida_em', pc.respondida_em,
        'acordo_valor_centavos', app_private.para_centavos(pc.acordo_valor), 'acordo_texto', pc.acordo_texto,
        'motivo_retirada', pc.motivo_retirada, 'tem_titulo', pc.titulo_id IS NOT NULL, 'versao', pc.versao, 'criado_em', pc.criado_em,
        'aviso', 'Proposta de custos não é dívida: só vale com a sua concordância ou um acordo registrado.')
        ORDER BY pc.numero DESC) FROM public.propostas_custo_cancelamento pc WHERE pc.os_id = o.id), '[]'::jsonb),
    'eventos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ev.id, 'tipo', ev.tipo, 'de', ev.de_estado, 'para', ev.para_estado,
        'autor_tipo', ev.autor_tipo,
        'autor', CASE WHEN ev.autor_tipo = 'equipe' AND NOT p_para_cliente THEN app_private.nome_da_pessoa(ev.autor_auth_id)
                      WHEN ev.autor_tipo = 'equipe' THEN 'Empresa' WHEN ev.autor_tipo = 'cliente' THEN o.cliente_nome ELSE 'AutoniCK' END,
        'texto', ev.texto, 'dados', CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE ev.dados END, 'interno', NOT ev.publico,
        'criado_em', ev.criado_em) ORDER BY ev.criado_em, ev.id)
      FROM public.os_eventos ev WHERE ev.os_id = o.id AND (NOT p_para_cliente OR ev.publico)), '[]'::jsonb),
    'encerramento', app_private.os_encerramento(o),
    'versao', o.versao);
  IF NOT p_para_cliente THEN
    r := r || jsonb_build_object('cliente_id', o.cliente_id, 'responsavel_auth_id', o.responsavel_auth_id,
      'responsavel', app_private.nome_da_pessoa(o.responsavel_auth_id),
      'materiais', app_private.os_materiais_json(o.id, p_ver_custo), 'ver_custo', p_ver_custo);
  END IF;
  RETURN r;
END $$;

-- Cria a OS do aceite (D9-01, D9-02): idempotente (uma por solicitação e por versão aceita), número na mesma transação.
CREATE FUNCTION app_private.criar_os(p_s public.solicitacoes_servico, p_v public.orcamento_versoes, p_usuario text, p_carga text)
RETURNS public.ordens_servico LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  o public.ordens_servico;
  v_num integer;
  c record;
BEGIN
  SELECT * INTO o FROM public.ordens_servico WHERE solicitacao_id = p_s.id;
  IF FOUND THEN RETURN o; END IF;
  INSERT INTO app_private.contadores_empresa (empresa_id) VALUES (p_s.empresa_id) ON CONFLICT (empresa_id) DO NOTHING;
  UPDATE app_private.contadores_empresa SET proxima_os = proxima_os + 1 WHERE empresa_id = p_s.empresa_id
    RETURNING proxima_os - 1 INTO v_num;
  INSERT INTO public.ordens_servico (empresa_id, numero, solicitacao_id, versao_aceita_id, servico_id, servico_nome, origem,
    cliente_id, cliente_auth_id, cliente_nome, valor_contratado, aceita_em, origem_carga)
  VALUES (p_s.empresa_id, v_num, p_s.id, p_v.id, p_s.servico_id, p_s.servico_nome, p_s.origem, p_s.cliente_id,
    CASE WHEN p_s.origem = 'plataforma' THEN p_s.cliente_auth_id END, p_s.cliente_nome, p_v.total,
    coalesce((p_v.aceite->>'aceito_em')::timestamptz, now()), p_carga)
  RETURNING * INTO o;
  FOR c IN SELECT variacao_id, sum(quantidade) AS q, min(descricao) AS d FROM public.orcamento_componentes
            WHERE versao_id = p_v.id AND tipo = 'material' AND variacao_id IS NOT NULL GROUP BY variacao_id LOOP
    INSERT INTO public.os_materiais (empresa_id, os_id, variacao_id, descricao, origem, qtd_prevista)
    VALUES (o.empresa_id, o.id, c.variacao_id, left(c.d, 120), 'orcamento', ceil(c.q)::integer);
  END LOOP;
  PERFORM app_private.os_evento(o, 'criada', NULL, 'aguardando_inicio', 'sistema', NULL, NULL,
    jsonb_build_object('numero', o.numero, 'versao_aceita', p_v.numero, 'carga', p_carga), true);
  PERFORM app_private.auditar(o.empresa_id, p_usuario, 'servicos.os_criada', 'ordens_servico', o.id,
    jsonb_build_object('numero', o.numero, 'solicitacao', p_s.numero, 'carga', p_carga));
  RETURN o;
END $$;

-- Libera todas as reservas ativas dos materiais da OS (cancelamento, conclusão, encerramento).
CREATE FUNCTION app_private.liberar_reservas_os(p_os public.ordens_servico, p_usuario text, p_motivo text) RETURNS integer
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  m public.os_materiais;
  total integer := 0;
BEGIN
  FOR m IN SELECT * FROM public.os_materiais WHERE os_id = p_os.id AND reserva_origem_id IS NOT NULL ORDER BY variacao_id FOR UPDATE LOOP
    total := total + app_private.liberar_reservas(p_os.empresa_id, p_usuario, 'os_material', m.reserva_origem_id, p_motivo);
    UPDATE public.os_materiais SET reserva_origem_id = NULL, versao = versao + 1 WHERE id = m.id;
  END LOOP;
  RETURN total;
END $$;

-- Confirma um uso ou devolução: baixa ou devolve no estoque (motor do M05, origem 'os'), com custo histórico.
CREATE FUNCTION app_private.confirmar_uso(p_uso public.os_material_usos, p_usuario text, p_chave text) RETURNS void
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  m public.os_materiais;
  o public.ordens_servico;
  v_custo numeric;
  v_resto integer;
  v_reservado boolean;
  v_nova uuid;
BEGIN
  SELECT * INTO m FROM public.os_materiais WHERE id = p_uso.os_material_id FOR UPDATE;
  SELECT * INTO o FROM public.ordens_servico WHERE id = m.os_id;
  SELECT custo_atual INTO v_custo FROM public.produto_variacoes WHERE id = m.variacao_id;
  IF p_uso.tipo = 'uso' THEN
    v_reservado := m.reserva_origem_id IS NOT NULL;
    IF v_reservado THEN
      PERFORM app_private.liberar_reservas(o.empresa_id, p_usuario, 'os_material', m.reserva_origem_id, 'Uso registrado na OS');
    END IF;
    PERFORM app_private.aplicar_itens(o.empresa_id, p_usuario, 'saida',
      jsonb_build_array(jsonb_build_object('variacao_id', m.variacao_id, 'delta', -p_uso.quantidade, 'custo', NULL)),
      format('Uso na OS nº %s', o.numero), 'os', o.id, NULL, p_chave);
    UPDATE public.os_materiais SET qtd_usada = qtd_usada + p_uso.quantidade, reserva_origem_id = NULL, versao = versao + 1
     WHERE id = m.id RETURNING * INTO m;
    -- Se ainda falta usar parte do previsto e havia reserva, a reserva do restante é refeita.
    v_resto := m.qtd_prevista - (m.qtd_usada - m.qtd_devolvida);
    IF v_reservado AND v_resto > 0 THEN
      v_nova := gen_random_uuid();
      PERFORM app_private.reservar_estoque(o.empresa_id, p_usuario, 'os_material', v_nova,
        jsonb_build_array(jsonb_build_object('variacao_id', m.variacao_id, 'quantidade', v_resto)), p_chave || ':resto');
      UPDATE public.os_materiais SET reserva_origem_id = v_nova WHERE id = m.id;
    END IF;
  ELSE
    PERFORM app_private.aplicar_itens(o.empresa_id, p_usuario, 'entrada',
      jsonb_build_array(jsonb_build_object('variacao_id', m.variacao_id, 'delta', p_uso.quantidade, 'custo', NULL)),
      format('Devolução de material da OS nº %s', o.numero), 'os', o.id, NULL, p_chave);
    UPDATE public.os_materiais SET qtd_devolvida = qtd_devolvida + p_uso.quantidade, versao = versao + 1 WHERE id = m.id;
  END IF;
  UPDATE public.os_material_usos SET estado = 'confirmado', custo_unitario = v_custo, decidido_por = p_usuario, decidido_em = now(),
    versao = versao + 1 WHERE id = p_uso.id;
END $$;

-- Títulos de serviço no cancelamento (D9-12): sem baixa, cancelados; com baixa, cancelados com o recebido "a devolver",
-- que só sai por devolução explícita no financeiro (nunca some sozinho).
CREATE FUNCTION app_private.cancelar_titulos_os(p_os public.ordens_servico, p_usuario text, p_motivo text) RETURNS numeric
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  t public.titulos_financeiros;
  v_recebido numeric := 0;
BEGIN
  FOR t IN SELECT * FROM public.titulos_financeiros WHERE empresa_id = p_os.empresa_id AND origem_tipo = 'servico'
              AND origem_id = p_os.id AND estado <> 'cancelado' ORDER BY criado_em FOR UPDATE LOOP
    UPDATE public.parcelas_financeiras SET estado = 'cancelada', versao = versao + 1 WHERE titulo_id = t.id AND estado <> 'cancelada';
    UPDATE public.titulos_financeiros SET estado = 'cancelado', a_devolver = t.recebido, cancelado_em = now(), cancelado_por = p_usuario,
      motivo_cancelamento = left('OS cancelada: ' || coalesce(p_motivo, 'sem motivo informado'), 300), versao = versao + 1 WHERE id = t.id;
    v_recebido := v_recebido + t.recebido;
  END LOOP;
  RETURN v_recebido;
END $$;

-- Lê e valida um horário proposto (mesmas regras do M08): futuro, até 180 dias, duração de 15 minutos a 12 horas.
CREATE FUNCTION app_private.validar_horario(p_inicio timestamptz, p_duracao integer) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF p_inicio IS NULL OR p_inicio < now() THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha uma data e hora a partir de agora.', 'inicio');
  END IF;
  IF p_inicio > now() + interval '180 days' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O horário pode ser marcado até 180 dias à frente.', 'inicio');
  END IF;
  IF p_duracao IS NULL OR p_duracao NOT BETWEEN 15 AND 720 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A duração vai de 15 minutos a 12 horas.', 'duracao_min');
  END IF;
  RETURN p_inicio + make_interval(mins => p_duracao);
END $$;

-- Aplica um horário aceito: o confirmado anterior vira substituído e o novo vale (um confirmado por solicitação, M08).
CREATE FUNCTION app_private.aplicar_horario(p_os public.ordens_servico, p_g public.reagendamentos, p_usuario text) RETURNS uuid
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.agendamentos SET estado = 'substituido', encerrado_em = now()
   WHERE solicitacao_id = p_os.solicitacao_id AND estado = 'confirmado';
  INSERT INTO public.agendamentos (empresa_id, solicitacao_id, inicio, fim, avisos, justificativa, confirmado_por)
  VALUES (p_os.empresa_id, p_os.solicitacao_id, p_g.inicio, p_g.fim, p_g.avisos, p_g.justificativa, coalesce(p_usuario, p_g.autor))
  RETURNING id INTO v_id;
  UPDATE public.reagendamentos SET agendamento_id = v_id WHERE id = p_g.id;
  RETURN v_id;
END $$;

-- ===========================================================================
-- 4. Leitura (RF-103, RF-104, RF-116)
-- ===========================================================================
CREATE FUNCTION public.ordens_da_empresa(p_empresa_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb, p_limite integer DEFAULT 50,
  p_deslocamento integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_estado text := nullif(p_filtros->>'estado', '');
  v_resp text := nullif(p_filtros->>'responsavel', '');
  v_busca text := nullif(btrim(coalesce(p_filtros->>'busca', '')), '');
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['servicos.visualizar']);
  IF p_limite NOT BETWEEN 1 AND 100 OR p_deslocamento < 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Paginação inválida.', 'limite');
  END IF;
  RETURN jsonb_build_object(
    'contagem', coalesce((SELECT jsonb_object_agg(estado, n) FROM (SELECT estado, count(*) n FROM public.ordens_servico
                  WHERE empresa_id = p_empresa_id GROUP BY estado) c), '{}'::jsonb),
    'total', (SELECT count(*) FROM public.ordens_servico o WHERE o.empresa_id = p_empresa_id
      AND (v_estado IS NULL OR o.estado = v_estado OR (v_estado = 'ativas' AND o.estado IN ('aguardando_inicio', 'em_execucao', 'pausada')))
      AND (v_resp IS NULL OR o.responsavel_auth_id = v_resp)
      AND (v_busca IS NULL OR o.numero::text = v_busca OR o.cliente_nome ILIKE '%' || v_busca || '%' OR o.servico_nome ILIKE '%' || v_busca || '%')),
    'itens', coalesce((SELECT jsonb_agg(x ORDER BY ord DESC) FROM (
      SELECT jsonb_build_object('id', o.id, 'numero', o.numero, 'solicitacao_numero', s.numero, 'servico', o.servico_nome,
        'cliente_nome', o.cliente_nome, 'origem', o.origem, 'estado', o.estado, 'responsavel', app_private.nome_da_pessoa(o.responsavel_auth_id),
        'previsao_conclusao', o.previsao_conclusao, 'revisao_pendente', o.revisao_pendente,
        'contratado_centavos', app_private.para_centavos(o.valor_contratado),
        'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim) FROM public.agendamentos a
                     WHERE a.solicitacao_id = o.solicitacao_id AND a.estado = 'confirmado'),
        'reagendamento_pendente', EXISTS (SELECT 1 FROM public.reagendamentos g WHERE g.os_id = o.id AND g.estado = 'pendente'),
        'usos_pendentes', (SELECT count(*) FROM public.os_material_usos u JOIN public.os_materiais m ON m.id = u.os_material_id
                            WHERE m.os_id = o.id AND u.estado = 'pendente'),
        'encerramento', app_private.os_encerramento(o), 'criado_em', o.criado_em) AS x, o.criado_em AS ord
        FROM public.ordens_servico o JOIN public.solicitacoes_servico s ON s.id = o.solicitacao_id
       WHERE o.empresa_id = p_empresa_id
         AND (v_estado IS NULL OR o.estado = v_estado OR (v_estado = 'ativas' AND o.estado IN ('aguardando_inicio', 'em_execucao', 'pausada')))
         AND (v_resp IS NULL OR o.responsavel_auth_id = v_resp)
         AND (v_busca IS NULL OR o.numero::text = v_busca OR o.cliente_nome ILIKE '%' || v_busca || '%' OR o.servico_nome ILIKE '%' || v_busca || '%')
       ORDER BY o.criado_em DESC LIMIT p_limite OFFSET p_deslocamento) q), '[]'::jsonb),
    'equipe', coalesce((SELECT jsonb_agg(jsonb_build_object('auth_user_id', m.auth_user_id, 'nome', app_private.nome_da_pessoa(m.auth_user_id))
        ORDER BY app_private.nome_da_pessoa(m.auth_user_id)) FROM public.membros_empresa m WHERE m.empresa_id = p_empresa_id AND m.estado = 'ativo'), '[]'::jsonb));
END $$;

CREATE FUNCTION public.os_detalhe(p_os_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_empresa uuid;
BEGIN
  SELECT empresa_id INTO v_empresa FROM public.ordens_servico WHERE id = p_os_id;
  IF v_empresa IS NULL THEN
    PERFORM app_private.erro('NOT_FOUND', 'Ordem de serviço não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(v_empresa, usuario, ARRAY['servicos.visualizar']);
  RETURN app_private.os_json(p_os_id, false, app_private.tem(v_empresa, usuario, 'produtos.ver_custo')) || jsonb_build_object(
    'pode', jsonb_build_object('alterar', app_private.tem(v_empresa, usuario, 'servicos.alterar'),
      'cancelar', app_private.tem(v_empresa, usuario, 'servicos.cancelar'),
      'estoque_propor', app_private.tem(v_empresa, usuario, 'estoque.propor'),
      'estoque_aprovar', app_private.tem(v_empresa, usuario, 'estoque.aprovar'),
      'financeiro_criar', app_private.tem(v_empresa, usuario, 'financeiro.criar'),
      'financeiro_aprovar', app_private.tem(v_empresa, usuario, 'financeiro.aprovar'),
      'agenda', app_private.tem(v_empresa, usuario, 'agenda.alterar'),
      'orcamentos_criar', app_private.tem(v_empresa, usuario, 'orcamentos.criar')),
    'equipe', coalesce((SELECT jsonb_agg(jsonb_build_object('auth_user_id', m.auth_user_id, 'nome', app_private.nome_da_pessoa(m.auth_user_id))
        ORDER BY app_private.nome_da_pessoa(m.auth_user_id)) FROM public.membros_empresa m WHERE m.empresa_id = v_empresa AND m.estado = 'ativo'), '[]'::jsonb));
END $$;

CREATE FUNCTION public.minhas_os() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'numero', o.numero, 'empresa', e.nome_publico, 'servico', o.servico_nome,
      'estado', o.estado, 'solicitacao_id', o.solicitacao_id, 'criado_em', o.criado_em,
      'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim) FROM public.agendamentos a
                   WHERE a.solicitacao_id = o.solicitacao_id AND a.estado = 'confirmado'),
      'acao_pendente', CASE
        WHEN EXISTS (SELECT 1 FROM public.reagendamentos g WHERE g.os_id = o.id AND g.estado = 'pendente' AND g.proposto_por = 'empresa') THEN 'responder_horario'
        WHEN EXISTS (SELECT 1 FROM public.propostas_custo_cancelamento pc WHERE pc.os_id = o.id AND pc.estado IN ('pendente', 'acordo_proposto')) THEN 'responder_custos'
        WHEN o.estado = 'concluida' AND NOT o.revisao_pendente THEN 'confirmar_recebimento' END) ORDER BY o.criado_em DESC)
    FROM (SELECT * FROM public.ordens_servico WHERE cliente_auth_id = usuario ORDER BY criado_em DESC LIMIT 100) o
    JOIN public.empresas e ON e.id = o.empresa_id), '[]'::jsonb);
END $$;

CREATE FUNCTION public.minha_os(p_os_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ordens_servico WHERE id = p_os_id AND cliente_auth_id = usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Ordem de serviço não encontrada.');
  END IF;
  RETURN app_private.os_json(p_os_id, true, false);
END $$;

-- ===========================================================================
-- 5. Execução (RF-103, RF-105, RF-106; D9-03 a D9-06, D9-10)
-- ===========================================================================
CREATE FUNCTION public.mudar_estado_os(p_os_id uuid, p_acao text, p_motivo text, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_acao, p_motivo, p_expected_version));
  anterior jsonb;
  o public.ordens_servico;
  v_de text;
  v_para text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_saldo numeric;
  v_titulo uuid;
  v_publico boolean := true;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'mudar_estado_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.alterar']);
  IF o.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'A ordem de serviço mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  v_de := o.estado;
  v_para := CASE
    WHEN p_acao = 'iniciar' AND o.estado = 'aguardando_inicio' THEN 'em_execucao'
    WHEN p_acao = 'pausar' AND o.estado = 'em_execucao' THEN 'pausada'
    WHEN p_acao = 'retomar' AND o.estado = 'pausada' THEN 'em_execucao'
    WHEN p_acao = 'concluir' AND o.estado = 'em_execucao' THEN 'concluida'
    WHEN p_acao = 'reabrir' AND o.estado = 'concluida' THEN 'em_execucao'
    WHEN p_acao = 'encerrar' AND o.estado = 'concluida' THEN 'encerrada' END;
  IF p_acao IS NULL OR p_acao NOT IN ('iniciar', 'pausar', 'retomar', 'concluir', 'reabrir', 'encerrar') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Ação inválida.', 'acao');
  END IF;
  IF v_para IS NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', format('Não é possível %s uma OS %s.', p_acao, replace(o.estado, '_', ' ')));
  END IF;
  IF p_acao = 'pausar' THEN
    v_motivo := app_private.ler_texto(v_motivo, 5, 300, 'motivo', 'Diga por que a OS está pausada (5 a 300 caracteres).');
    v_publico := false;
  ELSIF p_acao = 'reabrir' THEN
    v_motivo := app_private.ler_texto(v_motivo, 10, 300, 'motivo', 'Justifique a revisão (10 a 300 caracteres).');
  ELSIF char_length(v_motivo) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O texto tem até 300 caracteres.', 'motivo');
  END IF;
  IF p_acao = 'encerrar' AND NOT (app_private.os_encerramento(o)->>'empresa_pode_encerrar')::boolean THEN
    PERFORM app_private.erro('STATE_CONFLICT', app_private.os_encerramento(o)->>'motivo');
  END IF;
  UPDATE public.ordens_servico SET estado = v_para,
    iniciada_em = CASE WHEN p_acao = 'iniciar' THEN now() ELSE iniciada_em END,
    concluida_em = CASE WHEN p_acao = 'concluir' THEN now() WHEN p_acao = 'reabrir' THEN NULL ELSE concluida_em END,
    encerrada_em = CASE WHEN p_acao = 'encerrar' THEN now() ELSE encerrada_em END,
    encerrada_por = CASE WHEN p_acao = 'encerrar' THEN 'empresa' ELSE encerrada_por END,
    revisao_pendente = CASE WHEN p_acao IN ('reabrir', 'concluir') THEN false ELSE revisao_pendente END,
    versao = versao + 1, atualizado_em = now()
   WHERE id = o.id RETURNING * INTO o;
  IF p_acao IN ('concluir', 'encerrar') THEN
    PERFORM app_private.liberar_reservas_os(o, usuario, CASE p_acao WHEN 'concluir' THEN 'OS concluída' ELSE 'OS encerrada' END);
  END IF;
  -- D9-10: o título do saldo nasce na conclusão, uma única vez (o sinal já titulado é descontado).
  IF p_acao = 'concluir' AND NOT EXISTS (SELECT 1 FROM public.titulos_financeiros WHERE empresa_id = o.empresa_id
       AND origem_tipo = 'servico' AND origem_id = o.id AND parte_servico = 'saldo' AND estado <> 'cancelado') THEN
    v_saldo := o.valor_contratado - coalesce((SELECT sum(total) FROM public.titulos_financeiros WHERE empresa_id = o.empresa_id
      AND origem_tipo = 'servico' AND origem_id = o.id AND parte_servico = 'antecipacao' AND estado <> 'cancelado'), 0);
    IF v_saldo > 0 THEN
      v_titulo := app_private.criar_titulo_os(o, 'servico', o.id, 'saldo', format('Serviço da OS nº %s: %s', o.numero, o.servico_nome),
        jsonb_build_object('valor_centavos', app_private.para_centavos(v_saldo), 'vencimento', app_private.hoje_sp()::text), usuario);
      PERFORM app_private.auditar(o.empresa_id, usuario, 'financeiro.titulo_de_servico', 'titulos_financeiros', v_titulo,
        jsonb_build_object('os', o.numero, 'parte', 'saldo', 'total_centavos', app_private.para_centavos(v_saldo), 'automatico', true));
    END IF;
  END IF;
  PERFORM app_private.os_evento(o, p_acao, v_de, v_para, 'equipe', usuario, v_motivo,
    CASE WHEN v_titulo IS NOT NULL THEN jsonb_build_object('titulo_saldo_centavos', app_private.para_centavos(v_saldo)) ELSE '{}'::jsonb END, v_publico);
  IF p_acao = 'pausar' THEN
    PERFORM app_private.os_evento(o, 'pausa_publica', NULL, NULL, 'equipe', usuario, NULL, '{}'::jsonb, true);
  END IF;
  PERFORM app_private.auditar(o.empresa_id, usuario, 'servicos.os_' || p_acao, 'ordens_servico', o.id,
    jsonb_build_object('numero', o.numero, 'de', v_de, 'para', v_para));
  RETURN app_private.idem_fim(usuario, 'mudar_estado_os', p_operation_key, assinatura,
    app_private.os_json(o.id, false, app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

CREATE FUNCTION public.confirmar_recebimento_servico(p_os_id uuid, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id));
  anterior jsonb;
  o public.ordens_servico;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'confirmar_recebimento_servico', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  IF app_private.papel_na_os(o, usuario, NULL) <> 'cliente' THEN
    PERFORM app_private.erro('NOT_FOUND', 'Ordem de serviço não encontrada.');
  END IF;
  IF o.estado <> 'concluida' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só é possível confirmar o recebimento de um serviço concluído.');
  END IF;
  UPDATE public.ordens_servico SET estado = 'encerrada', encerrada_em = now(), encerrada_por = 'cliente', revisao_pendente = false,
    versao = versao + 1, atualizado_em = now() WHERE id = o.id RETURNING * INTO o;
  PERFORM app_private.liberar_reservas_os(o, usuario, 'OS encerrada');
  PERFORM app_private.os_evento(o, 'recebimento_confirmado', 'concluida', 'encerrada', 'cliente', usuario, NULL, '{}'::jsonb, true);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'servicos.os_encerrada_pelo_cliente', 'ordens_servico', o.id, jsonb_build_object('numero', o.numero));
  RETURN app_private.idem_fim(usuario, 'confirmar_recebimento_servico', p_operation_key, assinatura, app_private.os_json(o.id, true, false));
END $$;

CREATE FUNCTION public.pedir_revisao_os(p_os_id uuid, p_texto text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_texto));
  anterior jsonb;
  o public.ordens_servico;
  v_texto text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'pedir_revisao_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  IF app_private.papel_na_os(o, usuario, NULL) <> 'cliente' THEN
    PERFORM app_private.erro('NOT_FOUND', 'Ordem de serviço não encontrada.');
  END IF;
  IF o.estado <> 'concluida' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A revisão é pedida depois que a empresa informa a conclusão.');
  END IF;
  IF o.revisao_pendente THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Já existe um pedido de revisão aguardando a empresa.');
  END IF;
  v_texto := app_private.ler_texto(p_texto, 10, 1000, 'texto', 'Explique o que precisa ser revisto (10 a 1.000 caracteres).');
  IF app_private.tem_contato(v_texto) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Não inclua telefone, e-mail ou link.', 'texto');
  END IF;
  UPDATE public.ordens_servico SET revisao_pendente = true, versao = versao + 1, atualizado_em = now() WHERE id = o.id RETURNING * INTO o;
  PERFORM app_private.os_evento(o, 'revisao_pedida', NULL, NULL, 'cliente', usuario, v_texto, '{}'::jsonb, true);
  RETURN app_private.idem_fim(usuario, 'pedir_revisao_os', p_operation_key, assinatura, app_private.os_json(o.id, true, false));
END $$;

CREATE FUNCTION public.publicar_atualizacao_os(p_os_id uuid, p_texto text, p_publica boolean, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_texto, p_publica));
  anterior jsonb;
  o public.ordens_servico;
  v_texto text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'publicar_atualizacao_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.alterar']);
  v_texto := app_private.ler_texto(p_texto, 2, CASE WHEN coalesce(p_publica, false) THEN 500 ELSE 1000 END, 'texto',
    'Escreva a atualização (até 500 caracteres; nota interna até 1.000).');
  IF coalesce(p_publica, false) AND app_private.tem_contato(v_texto) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Atualização pública sem telefone, e-mail ou link.', 'texto');
  END IF;
  PERFORM app_private.os_evento(o, CASE WHEN coalesce(p_publica, false) THEN 'atualizacao' ELSE 'nota_interna' END, NULL, NULL,
    'equipe', usuario, v_texto, '{}'::jsonb, coalesce(p_publica, false));
  RETURN app_private.idem_fim(usuario, 'publicar_atualizacao_os', p_operation_key, assinatura,
    app_private.os_json(o.id, false, app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

-- Responsável (D9-05), previsão (UI-014: não prometer prazo sem cadastro) e recorrência (D9-23).
CREATE FUNCTION public.atualizar_dados_os(p_os_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_dados::text, p_expected_version));
  anterior jsonb;
  o public.ordens_servico;
  v_resp text;
  v_prev date;
  v_rec text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'atualizar_dados_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.alterar']);
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['responsavel_auth_id', 'previsao_conclusao', 'recorrencia']);
  IF o.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'A ordem de serviço mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF o.estado = 'cancelada' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta ordem de serviço foi cancelada.');
  END IF;
  v_resp := CASE WHEN p_dados ? 'responsavel_auth_id' THEN nullif(p_dados->>'responsavel_auth_id', '') ELSE o.responsavel_auth_id END;
  IF v_resp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = o.empresa_id AND auth_user_id = v_resp AND estado = 'ativo') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha um membro ativo da equipe.', 'responsavel_auth_id');
  END IF;
  v_prev := CASE WHEN p_dados ? 'previsao_conclusao' THEN app_private.ler_data(p_dados->>'previsao_conclusao', 'previsao_conclusao') ELSE o.previsao_conclusao END;
  IF p_dados ? 'previsao_conclusao' AND v_prev IS NOT NULL AND (v_prev < app_private.hoje_sp() OR v_prev > app_private.hoje_sp() + 365) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A previsão vai de hoje até 1 ano à frente.', 'previsao_conclusao');
  END IF;
  v_rec := CASE WHEN p_dados ? 'recorrencia' THEN nullif(p_dados->>'recorrencia', '') ELSE o.recorrencia END;
  IF v_rec IS NOT NULL AND v_rec NOT IN ('semanal', 'quinzenal', 'mensal') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Recorrência: semanal, quinzenal ou mensal.', 'recorrencia');
  END IF;
  UPDATE public.ordens_servico SET responsavel_auth_id = v_resp, previsao_conclusao = v_prev, recorrencia = v_rec,
    versao = versao + 1, atualizado_em = now() WHERE id = o.id RETURNING * INTO o;
  PERFORM app_private.os_evento(o, 'dados_atualizados', NULL, NULL, 'equipe', usuario, NULL,
    jsonb_build_object('campos', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_dados) k)), false);
  IF p_dados ? 'previsao_conclusao' THEN
    PERFORM app_private.os_evento(o, 'previsao', NULL, NULL, 'equipe', usuario, NULL, jsonb_build_object('previsao_conclusao', v_prev), true);
  END IF;
  RETURN app_private.idem_fim(usuario, 'atualizar_dados_os', p_operation_key, assinatura,
    app_private.os_json(o.id, false, app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

-- Garantia registrada (RF-110, RN-043; D9-21 = B)
CREATE FUNCTION public.registrar_garantia_os(p_os_id uuid, p_dias integer, p_condicoes text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_dias, p_condicoes));
  anterior jsonb;
  o public.ordens_servico;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_garantia_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.alterar']);
  IF o.estado <> 'concluida' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A garantia é registrada na OS concluída, antes do encerramento.');
  END IF;
  IF p_dias IS NULL OR p_dias NOT BETWEEN 0 AND 3650 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O prazo de garantia vai de 0 a 3.650 dias.', 'dias');
  END IF;
  IF char_length(p_condicoes) > 1000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'As condições têm até 1.000 caracteres.', 'condicoes');
  END IF;
  UPDATE public.ordens_servico SET garantia_dias = p_dias, garantia_condicoes = nullif(btrim(coalesce(p_condicoes, '')), ''),
    garantia_registrada_em = now(), versao = versao + 1, atualizado_em = now() WHERE id = o.id RETURNING * INTO o;
  PERFORM app_private.os_evento(o, 'garantia', NULL, NULL, 'equipe', usuario, o.garantia_condicoes, jsonb_build_object('dias', p_dias), true);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'servicos.garantia_registrada', 'ordens_servico', o.id, jsonb_build_object('dias', p_dias));
  RETURN app_private.idem_fim(usuario, 'registrar_garantia_os', p_operation_key, assinatura,
    app_private.os_json(o.id, false, app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

-- ===========================================================================
-- 6. Materiais e estoque (RF-062, RF-063, FIN-I19; D9-07 a D9-09)
-- ===========================================================================
CREATE FUNCTION public.adicionar_material_os(p_os_id uuid, p_variacao_id uuid, p_quantidade integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_variacao_id, p_quantidade));
  anterior jsonb;
  o public.ordens_servico;
  v public.produto_variacoes;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'adicionar_material_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.alterar']);
  IF NOT app_private.os_ativa(o) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Materiais previstos só mudam com a OS em andamento.');
  END IF;
  v := app_private.variacao_da_empresa(o.empresa_id, p_variacao_id);
  IF p_quantidade IS NULL OR p_quantidade NOT BETWEEN 1 AND 1000000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe a quantidade em unidades inteiras.', 'quantidade');
  END IF;
  INSERT INTO public.os_materiais (empresa_id, os_id, variacao_id, descricao, origem, qtd_prevista)
  VALUES (o.empresa_id, o.id, v.id, left((SELECT p.nome FROM public.produtos p WHERE p.id = v.produto_id), 120), 'adicionado', p_quantidade)
  ON CONFLICT (os_id, variacao_id) DO UPDATE SET qtd_prevista = public.os_materiais.qtd_prevista + excluded.qtd_prevista,
    versao = public.os_materiais.versao + 1;
  PERFORM app_private.os_evento(o, 'material_previsto', NULL, NULL, 'equipe', usuario, NULL,
    jsonb_build_object('variacao_id', v.id, 'quantidade', p_quantidade), false);
  RETURN app_private.idem_fim(usuario, 'adicionar_material_os', p_operation_key, assinatura,
    app_private.os_materiais_json(o.id, app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

-- D9-07 = C: reserva opcional do que falta usar; respeita o disponível (motor do M05).
CREATE FUNCTION public.reservar_material_os(p_material_id uuid, p_reservar boolean, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_material_id, p_reservar));
  anterior jsonb;
  m public.os_materiais;
  o public.ordens_servico;
  v_qtd integer;
  v_origem uuid;
  r jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'reservar_material_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO m FROM public.os_materiais WHERE id = p_material_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Material não encontrado.');
  END IF;
  o := app_private.os_trava(m.os_id);
  SELECT * INTO m FROM public.os_materiais WHERE id = p_material_id FOR UPDATE;
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['estoque.propor']);
  IF coalesce(p_reservar, true) THEN
    IF NOT app_private.os_ativa(o) THEN
      PERFORM app_private.erro('STATE_CONFLICT', 'Só se reserva material de OS em andamento.');
    END IF;
    IF m.reserva_origem_id IS NOT NULL THEN
      PERFORM app_private.erro('STATE_CONFLICT', 'Este material já está reservado.');
    END IF;
    v_qtd := m.qtd_prevista - (m.qtd_usada - m.qtd_devolvida);
    IF v_qtd <= 0 THEN
      PERFORM app_private.erro('STATE_CONFLICT', 'Não falta usar nada deste material.');
    END IF;
    v_origem := gen_random_uuid();
    r := app_private.reservar_estoque(o.empresa_id, usuario, 'os_material', v_origem,
      jsonb_build_array(jsonb_build_object('variacao_id', m.variacao_id, 'quantidade', v_qtd)), p_operation_key);
    UPDATE public.os_materiais SET reserva_origem_id = v_origem, versao = versao + 1 WHERE id = m.id;
    PERFORM app_private.os_evento(o, 'material_reservado', NULL, NULL, 'equipe', usuario, NULL, jsonb_build_object('variacao_id', m.variacao_id, 'reserva', r), false);
  ELSE
    IF m.reserva_origem_id IS NULL THEN
      PERFORM app_private.erro('STATE_CONFLICT', 'Este material não está reservado.');
    END IF;
    PERFORM app_private.liberar_reservas(o.empresa_id, usuario, 'os_material', m.reserva_origem_id, 'Reserva desfeita na OS');
    UPDATE public.os_materiais SET reserva_origem_id = NULL, versao = versao + 1 WHERE id = m.id;
    PERFORM app_private.os_evento(o, 'reserva_liberada', NULL, NULL, 'equipe', usuario, NULL, jsonb_build_object('variacao_id', m.variacao_id), false);
  END IF;
  RETURN app_private.idem_fim(usuario, 'reservar_material_os', p_operation_key, assinatura,
    app_private.os_materiais_json(o.id, app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

-- D9-08 = B: quem também pode aprovar estoque baixa na hora; os demais registram uso pendente de confirmação.
CREATE FUNCTION public.registrar_uso_material(p_os_id uuid, p_variacao_id uuid, p_quantidade integer, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_variacao_id, p_quantidade, p_motivo));
  anterior jsonb;
  o public.ordens_servico;
  v public.produto_variacoes;
  m public.os_materiais;
  u public.os_material_usos;
  v_direto boolean;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_uso_material', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.alterar']);
  IF o.estado NOT IN ('em_execucao', 'pausada', 'concluida') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O uso de material é registrado com a OS em execução, pausada ou concluída.');
  END IF;
  v := app_private.variacao_da_empresa(o.empresa_id, p_variacao_id);
  IF p_quantidade IS NULL OR p_quantidade NOT BETWEEN 1 AND 1000000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe a quantidade em unidades inteiras.', 'quantidade');
  END IF;
  IF char_length(p_motivo) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A observação tem até 300 caracteres.', 'motivo');
  END IF;
  INSERT INTO public.os_materiais (empresa_id, os_id, variacao_id, descricao, origem, qtd_prevista)
  VALUES (o.empresa_id, o.id, v.id, left((SELECT p.nome FROM public.produtos p WHERE p.id = v.produto_id), 120), 'adicionado', 0)
  ON CONFLICT (os_id, variacao_id) DO NOTHING;
  SELECT * INTO m FROM public.os_materiais WHERE os_id = o.id AND variacao_id = v.id FOR UPDATE;
  INSERT INTO public.os_material_usos (empresa_id, os_material_id, tipo, quantidade, motivo, autor, operation_key)
  VALUES (o.empresa_id, m.id, 'uso', p_quantidade, nullif(btrim(coalesce(p_motivo, '')), ''), usuario, p_operation_key) RETURNING * INTO u;
  v_direto := app_private.tem(o.empresa_id, usuario, 'estoque.aprovar');
  IF v_direto THEN
    PERFORM app_private.confirmar_uso(u, usuario, p_operation_key);
  END IF;
  PERFORM app_private.os_evento(o, CASE WHEN v_direto THEN 'material_usado' ELSE 'uso_proposto' END, NULL, NULL, 'equipe', usuario, NULL,
    jsonb_build_object('variacao_id', v.id, 'quantidade', p_quantidade), false);
  PERFORM app_private.auditar(o.empresa_id, usuario, CASE WHEN v_direto THEN 'servicos.material_baixado' ELSE 'servicos.uso_proposto' END,
    'os_material_usos', u.id, jsonb_build_object('os', o.numero, 'quantidade', p_quantidade));
  RETURN app_private.idem_fim(usuario, 'registrar_uso_material', p_operation_key, assinatura,
    jsonb_build_object('uso_id', u.id, 'estado', CASE WHEN v_direto THEN 'confirmado' ELSE 'pendente' END,
      'materiais', app_private.os_materiais_json(o.id, app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo'))));
END $$;

CREATE FUNCTION public.decidir_uso_material(p_uso_id uuid, p_aprovar boolean, p_motivo text, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_uso_id, p_aprovar, p_motivo, p_expected_version));
  anterior jsonb;
  u public.os_material_usos;
  m public.os_materiais;
  o public.ordens_servico;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'decidir_uso_material', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO u FROM public.os_material_usos WHERE id = p_uso_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Registro de uso não encontrado.');
  END IF;
  SELECT * INTO m FROM public.os_materiais WHERE id = u.os_material_id;
  o := app_private.os_trava(m.os_id);
  SELECT * INTO u FROM public.os_material_usos WHERE id = p_uso_id FOR UPDATE;
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['estoque.aprovar']);
  IF u.estado <> 'pendente' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este uso já foi decidido.');
  END IF;
  IF u.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este registro mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF coalesce(p_aprovar, false) THEN
    PERFORM app_private.confirmar_uso(u, usuario, p_operation_key);
  ELSE
    UPDATE public.os_material_usos SET estado = 'recusado', decidido_por = usuario, decidido_em = now(), versao = versao + 1,
      motivo_decisao = app_private.ler_texto(p_motivo, 3, 300, 'motivo', 'Explique a recusa (3 a 300 caracteres).') WHERE id = u.id;
  END IF;
  PERFORM app_private.os_evento(o, CASE WHEN coalesce(p_aprovar, false) THEN 'uso_confirmado' ELSE 'uso_recusado' END, NULL, NULL, 'equipe', usuario,
    NULL, jsonb_build_object('variacao_id', m.variacao_id, 'quantidade', u.quantidade), false);
  PERFORM app_private.auditar(o.empresa_id, usuario, CASE WHEN coalesce(p_aprovar, false) THEN 'servicos.material_baixado' ELSE 'servicos.uso_recusado' END,
    'os_material_usos', u.id, jsonb_build_object('os', o.numero, 'quantidade', u.quantidade));
  RETURN app_private.idem_fim(usuario, 'decidir_uso_material', p_operation_key, assinatura,
    app_private.os_materiais_json(o.id, app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

CREATE FUNCTION public.devolver_material_os(p_material_id uuid, p_quantidade integer, p_motivo text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_material_id, p_quantidade, p_motivo));
  anterior jsonb;
  m public.os_materiais;
  o public.ordens_servico;
  u public.os_material_usos;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'devolver_material_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO m FROM public.os_materiais WHERE id = p_material_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Material não encontrado.');
  END IF;
  o := app_private.os_trava(m.os_id);
  SELECT * INTO m FROM public.os_materiais WHERE id = p_material_id FOR UPDATE;
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.alterar', 'estoque.aprovar']);
  IF p_quantidade IS NULL OR p_quantidade < 1 OR p_quantidade > m.qtd_usada - m.qtd_devolvida THEN
    PERFORM app_private.erro('VALIDATION_ERROR', format('Devolva de 1 a %s unidade(s), o que foi baixado e ainda não voltou.', m.qtd_usada - m.qtd_devolvida), 'quantidade');
  END IF;
  INSERT INTO public.os_material_usos (empresa_id, os_material_id, tipo, quantidade, estado, motivo, autor, operation_key)
  VALUES (o.empresa_id, m.id, 'devolucao', p_quantidade, 'confirmado',
    app_private.ler_texto(p_motivo, 3, 300, 'motivo', 'Diga por que o material voltou (3 a 300 caracteres).'), usuario, p_operation_key)
  RETURNING * INTO u;
  PERFORM app_private.confirmar_uso(u, usuario, p_operation_key);
  PERFORM app_private.os_evento(o, 'material_devolvido', NULL, NULL, 'equipe', usuario, u.motivo,
    jsonb_build_object('variacao_id', m.variacao_id, 'quantidade', p_quantidade), false);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'servicos.material_devolvido', 'os_material_usos', u.id, jsonb_build_object('os', o.numero, 'quantidade', p_quantidade));
  RETURN app_private.idem_fim(usuario, 'devolver_material_os', p_operation_key, assinatura,
    app_private.os_materiais_json(o.id, app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

-- ===========================================================================
-- 7. Financeiro (D9-10, D9-11): sinal explícito e reparcelamento do saldo; recebimentos pelo M07.
-- ===========================================================================
CREATE FUNCTION public.gerar_antecipacao_os(p_os_id uuid, p_valor_centavos bigint, p_vencimento date, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_valor_centavos, p_vencimento));
  anterior jsonb;
  o public.ordens_servico;
  v_valor numeric;
  v_id uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'gerar_antecipacao_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['financeiro.criar']);
  IF NOT app_private.os_ativa(o) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O sinal é registrado antes da conclusão, com a OS em andamento.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.titulos_financeiros WHERE empresa_id = o.empresa_id AND origem_tipo = 'servico' AND origem_id = o.id
              AND estado <> 'cancelado') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta OS já tem conta a receber de sinal ou de saldo.');
  END IF;
  v_valor := round(coalesce(p_valor_centavos, 0)::numeric / 100, 2);
  IF v_valor <= 0 OR v_valor > o.valor_contratado THEN
    PERFORM app_private.erro('VALIDATION_ERROR', format('O sinal vai de R$ 0,01 até o valor contratado (%s).', app_private.brl(o.valor_contratado)), 'valor_centavos');
  END IF;
  v_id := app_private.criar_titulo_os(o, 'servico', o.id, 'antecipacao', format('Sinal da OS nº %s: %s', o.numero, o.servico_nome),
    jsonb_build_object('valor_centavos', p_valor_centavos, 'vencimento', coalesce(p_vencimento, app_private.hoje_sp())::text), usuario);
  PERFORM app_private.os_evento(o, 'sinal_registrado', NULL, NULL, 'equipe', usuario, NULL, jsonb_build_object('valor_centavos', p_valor_centavos), false);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'financeiro.titulo_de_servico', 'titulos_financeiros', v_id,
    jsonb_build_object('os', o.numero, 'parte', 'antecipacao', 'total_centavos', p_valor_centavos));
  RETURN app_private.idem_fim(usuario, 'gerar_antecipacao_os', p_operation_key, assinatura, app_private.os_valores(o.id, false));
END $$;

-- Reparcelar o saldo da OS antes de qualquer recebimento: a conta antiga é cancelada com motivo e a nova soma o mesmo total.
CREATE FUNCTION public.reparcelar_titulo_os(p_os_id uuid, p_parcelas jsonb, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_parcelas::text));
  anterior jsonb;
  o public.ordens_servico;
  t public.titulos_financeiros;
  v_id uuid;
  v_total numeric;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'reparcelar_titulo_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['financeiro.criar']);
  SELECT * INTO t FROM public.titulos_financeiros WHERE empresa_id = o.empresa_id AND origem_tipo = 'servico' AND origem_id = o.id
     AND parte_servico = 'saldo' AND estado <> 'cancelado' FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta OS ainda não tem conta a receber do saldo.');
  END IF;
  IF t.recebido > 0 THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Já há recebimento registrado nesta conta: não é possível reparcelar.');
  END IF;
  UPDATE public.parcelas_financeiras SET estado = 'cancelada', versao = versao + 1 WHERE titulo_id = t.id;
  UPDATE public.titulos_financeiros SET estado = 'cancelado', cancelado_em = now(), cancelado_por = usuario,
    motivo_cancelamento = 'Reparcelado na OS', versao = versao + 1 WHERE id = t.id;
  v_id := app_private.criar_titulo_os(o, 'servico', o.id, 'saldo', t.descricao, jsonb_build_object('parcelas', p_parcelas), usuario);
  SELECT total INTO v_total FROM public.titulos_financeiros WHERE id = v_id;
  IF v_total <> t.total THEN
    PERFORM app_private.erro('VALIDATION_ERROR', format('A soma das parcelas (%s) precisa ser igual ao saldo (%s).', app_private.brl(v_total), app_private.brl(t.total)), 'parcelas');
  END IF;
  PERFORM app_private.auditar(o.empresa_id, usuario, 'financeiro.titulo_reparcelado', 'titulos_financeiros', v_id,
    jsonb_build_object('os', o.numero, 'anterior', t.id, 'parcelas', jsonb_array_length(p_parcelas)));
  RETURN app_private.idem_fim(usuario, 'reparcelar_titulo_os', p_operation_key, assinatura, app_private.os_valores(o.id, false));
END $$;

-- ===========================================================================
-- 8. Política de cancelamento (D9-16)
-- ===========================================================================
CREATE FUNCTION public.politica_cancelamento(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['orcamentos.visualizar']);
  RETURN jsonb_build_object(
    'ativa', (SELECT jsonb_build_object('id', p.id, 'versao', p.versao, 'texto', p.texto, 'criada_em', p.criada_em,
        'criada_por', app_private.nome_da_pessoa(p.criada_por)) FROM public.politicas_cancelamento p WHERE p.empresa_id = p_empresa_id AND p.ativa),
    'historico', coalesce((SELECT jsonb_agg(jsonb_build_object('versao', p.versao, 'ativa', p.ativa, 'criada_em', p.criada_em) ORDER BY p.versao DESC)
      FROM public.politicas_cancelamento p WHERE p.empresa_id = p_empresa_id), '[]'::jsonb),
    'aviso', 'A política aparece no orçamento e fica gravada no aceite. Ela não prevalece sobre direitos previstos em lei.');
END $$;

-- Texto vazio desativa a política vigente (sem política, cancelamento sem custos). Versões antigas ficam no histórico.
CREATE FUNCTION public.salvar_politica_cancelamento(p_empresa_id uuid, p_texto text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_texto));
  anterior jsonb;
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
  v_ver integer;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'salvar_politica_cancelamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['servicos.cancelar', 'orcamentos.aprovar']);
  PERFORM pg_advisory_xact_lock(hashtextextended('politica_cancelamento|' || p_empresa_id, 0));
  IF v_texto IS NOT NULL THEN
    v_texto := app_private.ler_texto(v_texto, 20, 2000, 'texto', 'Escreva a política com 20 a 2.000 caracteres.');
    IF app_private.tem_contato(v_texto) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Não inclua telefone, e-mail ou link na política.', 'texto');
    END IF;
  END IF;
  UPDATE public.politicas_cancelamento SET ativa = false WHERE empresa_id = p_empresa_id AND ativa;
  IF v_texto IS NOT NULL THEN
    SELECT coalesce(max(versao), 0) + 1 INTO v_ver FROM public.politicas_cancelamento WHERE empresa_id = p_empresa_id;
    INSERT INTO public.politicas_cancelamento (empresa_id, versao, texto, criada_por) VALUES (p_empresa_id, v_ver, v_texto, usuario);
  END IF;
  PERFORM app_private.auditar(p_empresa_id, usuario, CASE WHEN v_texto IS NULL THEN 'servicos.politica_desativada' ELSE 'servicos.politica_salva' END,
    'politicas_cancelamento', NULL, jsonb_build_object('versao', v_ver));
  RETURN app_private.idem_fim(usuario, 'salvar_politica_cancelamento', p_operation_key, assinatura,
    jsonb_build_object('versao', v_ver, 'ativa', v_texto IS NOT NULL));
END $$;

-- ===========================================================================
-- 9. Cancelamento depois do aceite (RF-107; D9-12, D9-15, D9-16)
-- ===========================================================================
-- Cliente da plataforma: vale na hora, motivo opcional; a empresa não impede. Equipe: servicos.cancelar e motivo de 10 a 300.
-- Solicitação interna: a equipe pode registrar que o pedido foi do cliente. Nada é cobrado aqui (custos são outro fluxo).
CREATE FUNCTION public.cancelar_os(p_os_id uuid, p_motivo text, p_a_pedido_do_cliente boolean, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_motivo, p_a_pedido_do_cliente));
  anterior jsonb;
  o public.ordens_servico;
  s public.solicitacoes_servico;
  v public.orcamento_versoes;
  papel text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_por text;
  v_arrep boolean;
  v_cond boolean;
  v_recebido numeric;
  v_de text;
  v_reservas integer;
  v_usos integer;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'cancelar_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  papel := app_private.papel_na_os(o, usuario, 'servicos.cancelar');
  IF o.estado = 'cancelada' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta ordem de serviço já foi cancelada.');
  END IF;
  IF NOT app_private.os_ativa(o) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O serviço já foi concluído: não é possível cancelar. Use a revisão ou a mensagem da solicitação.');
  END IF;
  IF papel = 'equipe' THEN
    v_motivo := app_private.ler_texto(v_motivo, 10, 300, 'motivo', 'Explique ao cliente o motivo (10 a 300 caracteres).');
    v_por := CASE WHEN o.origem = 'interna' AND coalesce(p_a_pedido_do_cliente, false) THEN 'cliente' ELSE 'empresa' END;
    IF o.origem = 'plataforma' AND coalesce(p_a_pedido_do_cliente, false) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Na plataforma, o próprio cliente registra o cancelamento pela conta dele.', 'a_pedido_do_cliente');
    END IF;
  ELSE
    IF char_length(v_motivo) > 300 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'O motivo tem até 300 caracteres.', 'motivo');
    END IF;
    IF app_private.tem_contato(v_motivo) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Não inclua telefone, e-mail ou link.', 'motivo');
    END IF;
    v_por := 'cliente';
  END IF;
  SELECT * INTO v FROM public.orcamento_versoes WHERE id = o.versao_aceita_id;
  -- D9-15 (sujeito a revisão jurídica): contratação pela plataforma, até 7 dias do aceite, serviço não iniciado.
  v_arrep := o.origem = 'plataforma' AND v_por = 'cliente' AND now() <= o.aceita_em + interval '7 days' AND o.iniciada_em IS NULL;
  -- D9-16: só há base para custos se o aceite trazia condições de cancelamento.
  v_cond := (v.aceite->'politica_cancelamento') IS NOT NULL AND jsonb_typeof(v.aceite->'politica_cancelamento') = 'object'
            OR coalesce(v.condicoes, '') ~* 'cancel';
  v_de := o.estado;
  -- Efeitos na mesma transação (D9-12).
  UPDATE public.agendamentos SET estado = 'cancelado', encerrado_em = now() WHERE solicitacao_id = o.solicitacao_id AND estado = 'confirmado';
  UPDATE public.reagendamentos SET estado = 'retirado', resposta_motivo = 'OS cancelada', respondido_em = now()
   WHERE os_id = o.id AND estado = 'pendente';
  v_reservas := app_private.liberar_reservas_os(o, usuario, 'OS cancelada');
  UPDATE public.os_material_usos u SET estado = 'recusado', decidido_por = usuario, decidido_em = now(), motivo_decisao = 'OS cancelada',
    versao = u.versao + 1
   WHERE u.estado = 'pendente' AND u.os_material_id IN (SELECT id FROM public.os_materiais WHERE os_id = o.id);
  GET DIAGNOSTICS v_usos = ROW_COUNT;
  v_recebido := app_private.cancelar_titulos_os(o, usuario, v_motivo);
  UPDATE public.ordens_servico SET estado = 'cancelada', cancelada_em = now(), versao = versao + 1, atualizado_em = now()
   WHERE id = o.id RETURNING * INTO o;
  INSERT INTO public.cancelamentos_os (empresa_id, os_id, solicitado_por, registrado_por_tipo, autor, motivo, estado_no_momento,
    arrependimento_possivel, tinha_condicoes, condicoes_retrato, recebido_no_momento)
  VALUES (o.empresa_id, o.id, v_por, papel, usuario, v_motivo, v_de, v_arrep, v_cond,
    jsonb_build_object('politica', v.aceite->'politica_cancelamento', 'condicoes', v.condicoes), v_recebido);
  PERFORM app_private.os_evento(o, 'cancelada', v_de, 'cancelada', papel, usuario, v_motivo,
    jsonb_build_object('solicitado_por', v_por, 'arrependimento_possivel', v_arrep, 'reservas_liberadas', v_reservas,
      'usos_recusados', v_usos, 'recebido_a_devolver_centavos', app_private.para_centavos(v_recebido), 'sem_cobranca_automatica', true), true);
  SELECT * INTO s FROM public.solicitacoes_servico WHERE id = o.solicitacao_id;
  PERFORM app_private.evento_solicitacao(s, 'os_cancelada', papel, usuario, v_motivo, jsonb_build_object('os', o.numero), true);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'servicos.os_cancelada', 'ordens_servico', o.id,
    jsonb_build_object('numero', o.numero, 'por', v_por, 'registrado_por', papel, 'arrependimento', v_arrep,
      'recebido_centavos', app_private.para_centavos(v_recebido)));
  RETURN app_private.idem_fim(usuario, 'cancelar_os', p_operation_key, assinatura,
    app_private.os_json(o.id, papel = 'cliente', papel = 'equipe' AND app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

-- ===========================================================================
-- 10. Custos de cancelamento e contestação (RF-108, RF-109; D9-13, D9-14)
-- ===========================================================================
-- Valida os itens (1 a 10) e grava uma proposta nova com total calculado no banco e teto no valor contratado.
CREATE FUNCTION app_private.inserir_proposta_custos(p_o public.ordens_servico, p_c public.cancelamentos_os, p_itens jsonb,
  p_justificativa text, p_usuario text) RETURNS public.propostas_custo_cancelamento
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  e jsonb;
  v_itens jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_valor numeric;
  v_num integer;
  p public.propostas_custo_cancelamento;
BEGIN
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) NOT BETWEEN 1 AND 10 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe de 1 a 10 itens de custo.', 'itens');
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    IF jsonb_typeof(e) <> 'object' OR coalesce(e->>'tipo', '') NOT IN ('material_usado', 'deslocamento', 'mao_de_obra', 'outro') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Tipo de custo: material usado, deslocamento, mão de obra executada ou outro.', 'tipo');
    END IF;
    PERFORM app_private.exigir_chaves(e, ARRAY['tipo', 'descricao', 'valor_centavos', 'justificativa']);
    v_valor := app_private.centavos(e->'valor_centavos', 'valor_centavos', true, 1);
    v_total := v_total + v_valor;
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('tipo', e->>'tipo',
      'descricao', app_private.ler_texto(e->>'descricao', 2, 120, 'descricao', 'Descreva cada custo (2 a 120 caracteres).'),
      'valor_centavos', app_private.para_centavos(v_valor),
      'justificativa', app_private.ler_texto(e->>'justificativa', 5, 300, 'justificativa', 'Justifique cada custo (5 a 300 caracteres).')));
  END LOOP;
  IF v_total > p_o.valor_contratado THEN
    PERFORM app_private.erro('VALIDATION_ERROR', format('O total (%s) passa do valor contratado (%s).', app_private.brl(v_total),
      app_private.brl(p_o.valor_contratado)), 'itens');
  END IF;
  SELECT coalesce(max(numero), 0) + 1 INTO v_num FROM public.propostas_custo_cancelamento WHERE cancelamento_id = p_c.id;
  INSERT INTO public.propostas_custo_cancelamento (empresa_id, cancelamento_id, os_id, numero, itens, justificativa, total, teto, autor)
  VALUES (p_o.empresa_id, p_c.id, p_o.id, v_num, v_itens,
    app_private.ler_texto(p_justificativa, 10, 1000, 'justificativa', 'Explique a proposta (10 a 1.000 caracteres).'), v_total, p_o.valor_contratado, p_usuario)
  RETURNING * INTO p;
  RETURN p;
END $$;

-- Trava a proposta e a OS (sempre nessa ordem: OS, depois proposta).
CREATE FUNCTION app_private.proposta_custos_trava(p_id uuid) RETURNS public.propostas_custo_cancelamento
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  p public.propostas_custo_cancelamento;
BEGIN
  SELECT * INTO p FROM public.propostas_custo_cancelamento WHERE id = p_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Proposta não encontrada.');
  END IF;
  PERFORM app_private.os_trava(p.os_id);
  SELECT * INTO p FROM public.propostas_custo_cancelamento WHERE id = p_id FOR UPDATE;
  RETURN p;
END $$;

CREATE FUNCTION public.propor_custos_cancelamento(p_os_id uuid, p_itens jsonb, p_justificativa text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_itens::text, p_justificativa));
  anterior jsonb;
  o public.ordens_servico;
  c public.cancelamentos_os;
  p public.propostas_custo_cancelamento;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'propor_custos_cancelamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.cancelar', 'financeiro.criar']);
  SELECT * INTO c FROM public.cancelamentos_os WHERE os_id = o.id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Custos só podem ser propostos depois do cancelamento.');
  END IF;
  IF c.solicitado_por <> 'cliente' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O cancelamento foi da empresa: não há custos a propor ao cliente.');
  END IF;
  IF c.arrependimento_possivel THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Cancelamento no prazo de arrependimento, antes do início do serviço: não há custos.');
  END IF;
  IF NOT c.tinha_condicoes THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O orçamento aceito não trazia condições de cancelamento: o cancelamento é sem custos.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.propostas_custo_cancelamento WHERE cancelamento_id = c.id AND estado NOT IN ('revisada', 'retirada')) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Já existe uma proposta de custos ativa. Revise ou retire a atual.');
  END IF;
  p := app_private.inserir_proposta_custos(o, c, p_itens, p_justificativa, usuario);
  PERFORM app_private.os_evento(o, 'custos_propostos', NULL, NULL, 'equipe', usuario, p.justificativa,
    jsonb_build_object('proposta', p.numero, 'total_centavos', app_private.para_centavos(p.total)), true);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'servicos.custos_propostos', 'propostas_custo_cancelamento', p.id,
    jsonb_build_object('os', o.numero, 'proposta', p.numero, 'total_centavos', app_private.para_centavos(p.total)));
  RETURN app_private.idem_fim(usuario, 'propor_custos_cancelamento', p_operation_key, assinatura,
    app_private.os_json(o.id, false, app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

-- Resposta à proposta (ou ao acordo proposto): o titular na plataforma; na solicitação interna, a equipe registra a resposta informada.
CREATE FUNCTION public.responder_custos(p_proposta_id uuid, p_aceitar boolean, p_contestacao text, p_expected_version integer,
  p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_proposta_id, p_aceitar, p_contestacao, p_expected_version));
  anterior jsonb;
  p public.propostas_custo_cancelamento;
  o public.ordens_servico;
  papel text;
  v_texto text;
  v_novo text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'responder_custos', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  p := app_private.proposta_custos_trava(p_proposta_id);
  SELECT * INTO o FROM public.ordens_servico WHERE id = p.os_id;
  IF o.origem = 'plataforma' THEN
    IF o.cliente_auth_id IS DISTINCT FROM usuario THEN
      IF app_private.eh_membro(o.empresa_id, usuario) THEN
        PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só o cliente responde à proposta de custos.');
      END IF;
      PERFORM app_private.erro('NOT_FOUND', 'Proposta não encontrada.');
    END IF;
    papel := 'cliente';
  ELSE
    PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.cancelar', 'financeiro.criar']);
    papel := 'equipe';
  END IF;
  IF p.estado NOT IN ('pendente', 'acordo_proposto') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta proposta não aguarda resposta.');
  END IF;
  IF p.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'A proposta mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF coalesce(p_aceitar, false) THEN
    v_novo := CASE p.estado WHEN 'pendente' THEN 'aceita' ELSE 'acordo' END;
  ELSE
    v_texto := app_private.ler_texto(p_contestacao, 10, 1000, 'contestacao', 'Explique a contestação (10 a 1.000 caracteres).');
    IF papel = 'cliente' AND app_private.tem_contato(v_texto) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Não inclua telefone, e-mail ou link.', 'contestacao');
    END IF;
    v_novo := 'contestada';
  END IF;
  UPDATE public.propostas_custo_cancelamento SET estado = v_novo, contestacao = coalesce(v_texto, contestacao), resposta_por = papel,
    resposta_autor = usuario, respondida_em = now(), versao = versao + 1, atualizado_em = now() WHERE id = p.id RETURNING * INTO p;
  PERFORM app_private.os_evento(o, 'custos_' || v_novo, NULL, NULL, papel, usuario, v_texto,
    jsonb_build_object('proposta', p.numero, 'informado_pela_equipe', papel = 'equipe'), true);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'servicos.custos_' || v_novo, 'propostas_custo_cancelamento', p.id,
    jsonb_build_object('os', o.numero, 'proposta', p.numero, 'por', papel));
  RETURN app_private.idem_fim(usuario, 'responder_custos', p_operation_key, assinatura,
    app_private.os_json(o.id, papel = 'cliente', false));
END $$;

-- Revisão: a proposta pendente, contestada ou com acordo proposto vira "revisada" e nasce outra, pendente.
CREATE FUNCTION public.revisar_custos(p_proposta_id uuid, p_itens jsonb, p_justificativa text, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_proposta_id, p_itens::text, p_justificativa, p_expected_version));
  anterior jsonb;
  p public.propostas_custo_cancelamento;
  nova public.propostas_custo_cancelamento;
  o public.ordens_servico;
  c public.cancelamentos_os;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'revisar_custos', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  p := app_private.proposta_custos_trava(p_proposta_id);
  SELECT * INTO o FROM public.ordens_servico WHERE id = p.os_id;
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.cancelar', 'financeiro.criar']);
  IF p.estado NOT IN ('pendente', 'contestada', 'acordo_proposto') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só se revisa uma proposta pendente ou contestada.');
  END IF;
  IF p.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'A proposta mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  UPDATE public.propostas_custo_cancelamento SET estado = 'revisada', versao = versao + 1, atualizado_em = now() WHERE id = p.id;
  SELECT * INTO c FROM public.cancelamentos_os WHERE id = p.cancelamento_id;
  nova := app_private.inserir_proposta_custos(o, c, p_itens, p_justificativa, usuario);
  PERFORM app_private.os_evento(o, 'custos_revisados', NULL, NULL, 'equipe', usuario, nova.justificativa,
    jsonb_build_object('anterior', p.numero, 'proposta', nova.numero, 'total_centavos', app_private.para_centavos(nova.total)), true);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'servicos.custos_revisados', 'propostas_custo_cancelamento', nova.id,
    jsonb_build_object('os', o.numero, 'anterior', p.numero, 'proposta', nova.numero, 'total_centavos', app_private.para_centavos(nova.total)));
  RETURN app_private.idem_fim(usuario, 'revisar_custos', p_operation_key, assinatura,
    app_private.os_json(o.id, false, app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

CREATE FUNCTION public.retirar_custos(p_proposta_id uuid, p_motivo text, p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_proposta_id, p_motivo, p_expected_version));
  anterior jsonb;
  p public.propostas_custo_cancelamento;
  o public.ordens_servico;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'retirar_custos', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  p := app_private.proposta_custos_trava(p_proposta_id);
  SELECT * INTO o FROM public.ordens_servico WHERE id = p.os_id;
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.cancelar', 'financeiro.criar']);
  IF p.estado IN ('revisada', 'retirada') OR EXISTS (SELECT 1 FROM public.titulos_financeiros WHERE empresa_id = o.empresa_id
       AND origem_tipo = 'cancelamento_servico' AND origem_id = p.id AND estado <> 'cancelado') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta proposta não pode ser retirada (já encerrada ou com conta a receber ativa).');
  END IF;
  IF p.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'A proposta mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  UPDATE public.propostas_custo_cancelamento SET estado = 'retirada', titulo_id = NULL,
    motivo_retirada = app_private.ler_texto(p_motivo, 5, 300, 'motivo', 'Diga por que a proposta foi retirada (5 a 300 caracteres).'),
    versao = versao + 1, atualizado_em = now() WHERE id = p.id RETURNING * INTO p;
  PERFORM app_private.os_evento(o, 'custos_retirados', NULL, NULL, 'equipe', usuario, p.motivo_retirada, jsonb_build_object('proposta', p.numero), true);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'servicos.custos_retirados', 'propostas_custo_cancelamento', p.id,
    jsonb_build_object('os', o.numero, 'proposta', p.numero));
  RETURN app_private.idem_fim(usuario, 'retirar_custos', p_operation_key, assinatura,
    app_private.os_json(o.id, false, app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

-- Acordo: valor até o total proposto. Interna: vale como "acordo" (concordância informada). Plataforma: o cliente confirma.
CREATE FUNCTION public.registrar_acordo_custos(p_proposta_id uuid, p_valor_centavos bigint, p_texto text, p_concordancia_informada boolean,
  p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_proposta_id, p_valor_centavos, p_texto, p_concordancia_informada, p_expected_version));
  anterior jsonb;
  p public.propostas_custo_cancelamento;
  o public.ordens_servico;
  v_valor numeric;
  v_novo text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_acordo_custos', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  p := app_private.proposta_custos_trava(p_proposta_id);
  SELECT * INTO o FROM public.ordens_servico WHERE id = p.os_id;
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.cancelar', 'financeiro.criar']);
  IF p.estado NOT IN ('pendente', 'contestada') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O acordo é registrado sobre uma proposta pendente ou contestada.');
  END IF;
  IF p.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'A proposta mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  v_valor := app_private.centavos(to_jsonb(p_valor_centavos), 'valor_centavos', true, 0);
  IF v_valor > p.total THEN
    PERFORM app_private.erro('VALIDATION_ERROR', format('O acordo vai até o total proposto (%s).', app_private.brl(p.total)), 'valor_centavos');
  END IF;
  IF o.origem = 'interna' AND NOT coalesce(p_concordancia_informada, false) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Confirme que o cliente concordou com o acordo.', 'concordancia_informada');
  END IF;
  v_novo := CASE o.origem WHEN 'interna' THEN 'acordo' ELSE 'acordo_proposto' END;
  UPDATE public.propostas_custo_cancelamento SET estado = v_novo, acordo_valor = v_valor,
    acordo_texto = app_private.ler_texto(p_texto, 10, 1000, 'texto', 'Descreva o acordo (10 a 1.000 caracteres).'),
    resposta_por = CASE WHEN v_novo = 'acordo' THEN 'equipe' ELSE resposta_por END,
    resposta_autor = CASE WHEN v_novo = 'acordo' THEN usuario ELSE resposta_autor END,
    respondida_em = CASE WHEN v_novo = 'acordo' THEN now() ELSE respondida_em END,
    versao = versao + 1, atualizado_em = now() WHERE id = p.id RETURNING * INTO p;
  PERFORM app_private.os_evento(o, 'custos_' || v_novo, NULL, NULL, 'equipe', usuario, p.acordo_texto,
    jsonb_build_object('proposta', p.numero, 'valor_centavos', app_private.para_centavos(v_valor)), true);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'servicos.custos_' || v_novo, 'propostas_custo_cancelamento', p.id,
    jsonb_build_object('os', o.numero, 'proposta', p.numero, 'valor_centavos', app_private.para_centavos(v_valor)));
  RETURN app_private.idem_fim(usuario, 'registrar_acordo_custos', p_operation_key, assinatura,
    app_private.os_json(o.id, false, app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

-- Título do custo: só por ação explícita, depois do aceite ou do acordo; um ativo por proposta.
CREATE FUNCTION public.gerar_titulo_custos(p_proposta_id uuid, p_vencimento date, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_proposta_id, p_vencimento));
  anterior jsonb;
  p public.propostas_custo_cancelamento;
  o public.ordens_servico;
  v_valor numeric;
  v_id uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'gerar_titulo_custos', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  p := app_private.proposta_custos_trava(p_proposta_id);
  SELECT * INTO o FROM public.ordens_servico WHERE id = p.os_id;
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['financeiro.criar']);
  IF p.estado NOT IN ('aceita', 'acordo') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A conta a receber só nasce de proposta aceita pelo cliente ou de acordo registrado.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.titulos_financeiros WHERE empresa_id = o.empresa_id AND origem_tipo = 'cancelamento_servico'
              AND origem_id = p.id AND estado <> 'cancelado') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta proposta já tem conta a receber.');
  END IF;
  v_valor := CASE p.estado WHEN 'acordo' THEN p.acordo_valor ELSE p.total END;
  IF v_valor <= 0 THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O acordo foi sem valor: não há conta a receber.');
  END IF;
  v_id := app_private.criar_titulo_os(o, 'cancelamento_servico', p.id, NULL, format('Custos do cancelamento da OS nº %s', o.numero),
    jsonb_build_object('valor_centavos', app_private.para_centavos(v_valor), 'vencimento', coalesce(p_vencimento, app_private.hoje_sp())::text), usuario);
  UPDATE public.propostas_custo_cancelamento SET titulo_id = v_id, versao = versao + 1, atualizado_em = now() WHERE id = p.id;
  PERFORM app_private.os_evento(o, 'custos_titulados', NULL, NULL, 'equipe', usuario, NULL,
    jsonb_build_object('proposta', p.numero, 'valor_centavos', app_private.para_centavos(v_valor)), false);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'financeiro.titulo_de_custos', 'titulos_financeiros', v_id,
    jsonb_build_object('os', o.numero, 'proposta', p.numero, 'total_centavos', app_private.para_centavos(v_valor)));
  RETURN app_private.idem_fim(usuario, 'gerar_titulo_custos', p_operation_key, assinatura,
    jsonb_build_object('titulo_id', v_id, 'total_centavos', app_private.para_centavos(v_valor)));
END $$;

-- ===========================================================================
-- 11. Recorrência (RF-112; D9-23): próxima execução só por ação explícita, com novo aceite.
-- ===========================================================================
CREATE FUNCTION public.gerar_proxima_os(p_os_id uuid, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id));
  anterior jsonb;
  o public.ordens_servico;
  s public.solicitacoes_servico;
  v public.orcamento_versoes;
  sv public.servicos;
  nova public.solicitacoes_servico;
  nv public.orcamento_versoes;
  v_num integer;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'gerar_proxima_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['servicos.alterar', 'orcamentos.criar']);
  IF o.recorrencia IS NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta OS não está marcada como recorrente.');
  END IF;
  IF o.estado <> 'encerrada' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A próxima execução é gerada depois do encerramento da OS.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.solicitacoes_servico WHERE origem_os_id = o.id) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A próxima execução desta OS já foi gerada.');
  END IF;
  SELECT * INTO sv FROM public.servicos WHERE id = o.servico_id;
  IF NOT sv.ativo THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O serviço está desativado.');
  END IF;
  SELECT * INTO s FROM public.solicitacoes_servico WHERE id = o.solicitacao_id;
  SELECT * INTO v FROM public.orcamento_versoes WHERE id = o.versao_aceita_id;
  INSERT INTO app_private.contadores_empresa (empresa_id) VALUES (o.empresa_id) ON CONFLICT (empresa_id) DO NOTHING;
  UPDATE app_private.contadores_empresa SET proxima_solicitacao = proxima_solicitacao + 1 WHERE empresa_id = o.empresa_id
    RETURNING proxima_solicitacao - 1 INTO v_num;
  INSERT INTO public.solicitacoes_servico (empresa_id, numero, servico_id, servico_versao, servico_nome, origem, cliente_auth_id, cliente_id,
    cliente_nome, relato, cidade, bairro, preferencia, formulario, respostas, estimativa, criado_por, origem_os_id)
  VALUES (o.empresa_id, v_num, sv.id, sv.versao, sv.nome, s.origem, s.cliente_auth_id, s.cliente_id, s.cliente_nome,
    left(format('Próxima execução (%s) da OS nº %s. %s', o.recorrencia, o.numero, s.relato), 2000), s.cidade, s.bairro, NULL,
    s.formulario, s.respostas, s.estimativa, usuario, o.id)
  RETURNING * INTO nova;
  -- Mesmo preço do aceite anterior: copia os itens e descontos já aprovados; validade pelo cadastro do serviço.
  INSERT INTO public.orcamento_versoes (empresa_id, solicitacao_id, numero, tipo, estado, subtotal, desconto_itens, desconto_geral, total,
    valido_ate, prazo_execucao, condicoes, criada_por)
  VALUES (o.empresa_id, nova.id, 1, 'manual', 'rascunho', v.subtotal, v.desconto_itens, v.desconto_geral, v.total,
    app_private.hoje_sp() + sv.validade_dias, v.prazo_execucao, v.condicoes, usuario)
  RETURNING * INTO nv;
  INSERT INTO public.orcamento_componentes (empresa_id, versao_id, ordem, tipo, descricao, quantidade, valor_unitario, desconto, total, variacao_id)
  SELECT empresa_id, nv.id, ordem, tipo, descricao, quantidade, valor_unitario, desconto, total, variacao_id
    FROM public.orcamento_componentes WHERE versao_id = v.id;
  PERFORM app_private.evento_solicitacao(nova, 'criada', 'equipe', usuario, NULL, jsonb_build_object('recorrencia_da_os', o.numero), true);
  nv := app_private.publicar_versao(nova, nv, usuario, usuario);
  PERFORM app_private.os_evento(o, 'proxima_gerada', NULL, NULL, 'equipe', usuario, NULL, jsonb_build_object('solicitacao', nova.numero), true);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'servicos.proxima_execucao', 'solicitacoes_servico', nova.id,
    jsonb_build_object('os', o.numero, 'solicitacao', nova.numero, 'total_centavos', app_private.para_centavos(nv.total)));
  RETURN app_private.idem_fim(usuario, 'gerar_proxima_os', p_operation_key, assinatura,
    jsonb_build_object('solicitacao_id', nova.id, 'numero', nova.numero, 'aviso',
      CASE nova.origem WHEN 'plataforma' THEN 'Orçamento enviado ao cliente: a próxima OS nasce quando ele aceitar.'
        ELSE 'Registre o aceite informado pelo cliente para gerar a próxima OS.' END));
END $$;

-- ===========================================================================
-- 12. Pacotes (RF-111; D9-22): itens de um serviço do tipo pacote.
-- ===========================================================================
CREATE FUNCTION public.salvar_itens_pacote(p_servico_id uuid, p_itens uuid[], p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_servico_id, array_to_string(p_itens, ','), p_expected_version));
  anterior jsonb;
  sv public.servicos;
  v_item uuid;
  i integer := 0;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'salvar_itens_pacote', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  sv := app_private.servico_da_empresa_trava(p_servico_id);
  PERFORM app_private.exigir_permissoes(sv.empresa_id, usuario, ARRAY['catalogo_servicos.alterar']);
  IF sv.politica_preco <> 'pacote' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este serviço não é um pacote.');
  END IF;
  IF sv.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'O serviço mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF p_itens IS NULL OR cardinality(p_itens) NOT BETWEEN 2 AND 10 OR (SELECT count(DISTINCT x) FROM unnest(p_itens) x) <> cardinality(p_itens) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha de 2 a 10 serviços diferentes.', 'itens');
  END IF;
  DELETE FROM public.servico_pacote_itens WHERE pacote_id = sv.id;
  FOREACH v_item IN ARRAY p_itens LOOP
    i := i + 1;
    IF NOT EXISTS (SELECT 1 FROM public.servicos WHERE id = v_item AND empresa_id = sv.empresa_id AND ativo AND politica_preco <> 'pacote') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Cada item precisa ser um serviço ativo desta empresa e não pode ser outro pacote.', 'itens');
    END IF;
    INSERT INTO public.servico_pacote_itens (empresa_id, pacote_id, servico_id, ordem) VALUES (sv.empresa_id, sv.id, v_item, i);
  END LOOP;
  UPDATE public.servicos SET versao = versao + 1, atualizado_em = now() WHERE id = sv.id RETURNING * INTO sv;
  PERFORM app_private.auditar(sv.empresa_id, usuario, 'servicos.pacote_salvo', 'servicos', sv.id, jsonb_build_object('itens', i));
  RETURN app_private.idem_fim(usuario, 'salvar_itens_pacote', p_operation_key, assinatura, app_private.servico_json(sv, true));
END $$;

-- ===========================================================================
-- 13. Agenda operacional (RF-116; D9-17, D9-26)
-- ===========================================================================
CREATE FUNCTION public.agenda_operacional(p_empresa_id uuid, p_de date DEFAULT NULL, p_ate date DEFAULT NULL, p_responsavel text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_de date := coalesce(p_de, app_private.hoje_sp());
  v_ate date := coalesce(p_ate, coalesce(p_de, app_private.hoje_sp()) + 6);
  v_resp text := nullif(p_responsavel, '');
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['agenda.visualizar']);
  IF v_ate < v_de OR v_ate - v_de > 62 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha um período de até 62 dias.', 'ate');
  END IF;
  RETURN jsonb_build_object('periodo', jsonb_build_object('de', v_de, 'ate', v_ate), 'grade', app_private.grade_json(p_empresa_id),
    'responsavel', v_resp,
    'confirmados', coalesce((SELECT jsonb_agg(jsonb_build_object('solicitacao_id', s.id, 'solicitacao_numero', s.numero,
        'os_id', o.id, 'os_numero', o.numero, 'os_estado', o.estado, 'servico', s.servico_nome, 'cliente_nome', s.cliente_nome,
        'estado', s.estado, 'responsavel', app_private.nome_da_pessoa(o.responsavel_auth_id), 'inicio', a.inicio, 'fim', a.fim,
        'avisos', a.avisos, 'menos_de_24h', a.inicio - now() < interval '24 hours' AND a.inicio > now(),
        'reagendamento_pendente', EXISTS (SELECT 1 FROM public.reagendamentos g WHERE g.os_id = o.id AND g.estado = 'pendente')) ORDER BY a.inicio)
      FROM public.agendamentos a JOIN public.solicitacoes_servico s ON s.id = a.solicitacao_id
      LEFT JOIN public.ordens_servico o ON o.solicitacao_id = s.id
     WHERE a.empresa_id = p_empresa_id AND a.estado = 'confirmado'
       AND (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_de AND v_ate
       AND (v_resp IS NULL OR o.responsavel_auth_id = v_resp)), '[]'::jsonb),
    'propostos', coalesce((SELECT jsonb_agg(jsonb_build_object('reagendamento_id', g.id, 'os_id', o.id, 'os_numero', o.numero,
        'servico', o.servico_nome, 'cliente_nome', o.cliente_nome, 'tipo', g.tipo, 'proposto_por', g.proposto_por, 'inicio', g.inicio,
        'fim', g.fim, 'motivo', g.motivo, 'avisos', g.avisos, 'responsavel', app_private.nome_da_pessoa(o.responsavel_auth_id)) ORDER BY g.inicio)
      FROM public.reagendamentos g JOIN public.ordens_servico o ON o.id = g.os_id
     WHERE g.empresa_id = p_empresa_id AND g.estado = 'pendente'
       AND (g.inicio AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_de AND v_ate
       AND (v_resp IS NULL OR o.responsavel_auth_id = v_resp)), '[]'::jsonb),
    'os_sem_horario', coalesce((SELECT jsonb_agg(jsonb_build_object('os_id', o.id, 'os_numero', o.numero, 'servico', o.servico_nome,
        'cliente_nome', o.cliente_nome, 'estado', o.estado, 'previsao_conclusao', o.previsao_conclusao,
        'responsavel', app_private.nome_da_pessoa(o.responsavel_auth_id),
        'proposta_pendente', EXISTS (SELECT 1 FROM public.reagendamentos g WHERE g.os_id = o.id AND g.estado = 'pendente')) ORDER BY o.criado_em)
      FROM public.ordens_servico o WHERE o.empresa_id = p_empresa_id AND o.estado IN ('aguardando_inicio', 'em_execucao', 'pausada')
       AND (v_resp IS NULL OR o.responsavel_auth_id = v_resp)
       AND NOT EXISTS (SELECT 1 FROM public.agendamentos a WHERE a.solicitacao_id = o.solicitacao_id AND a.estado = 'confirmado')), '[]'::jsonb),
    'solicitacoes_sem_horario', CASE WHEN v_resp IS NULL THEN coalesce((SELECT jsonb_agg(jsonb_build_object('solicitacao_id', s.id,
        'numero', s.numero, 'servico', s.servico_nome, 'cliente_nome', s.cliente_nome, 'estado', s.estado, 'preferencia', s.preferencia)
        ORDER BY s.criado_em)
      FROM public.solicitacoes_servico s WHERE s.empresa_id = p_empresa_id AND s.estado IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida')
       AND NOT EXISTS (SELECT 1 FROM public.agendamentos a WHERE a.solicitacao_id = s.id AND a.estado = 'confirmado')), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'equipe', coalesce((SELECT jsonb_agg(jsonb_build_object('auth_user_id', m.auth_user_id, 'nome', app_private.nome_da_pessoa(m.auth_user_id))
        ORDER BY app_private.nome_da_pessoa(m.auth_user_id)) FROM public.membros_empresa m WHERE m.empresa_id = p_empresa_id AND m.estado = 'ativo'), '[]'::jsonb),
    'aviso', 'Filtro por responsável é informativo: não há agenda por funcionário, bloqueio de horário nem cálculo de vagas nesta etapa.');
END $$;

-- ===========================================================================
-- 14. Horário da OS e reagendamento por acordo (RF-114, RF-117, RF-118; D9-18 a D9-20, D9-24, D9-28)
-- ===========================================================================
-- Empresa define (sem horário) ou propõe outro. Avisos de conflito: sem p_aceitar_avisos, nada é gravado.
-- Plataforma: fica pendente até o cliente concordar. Interna: vale na hora, com a concordância informada pela equipe.
CREATE FUNCTION public.propor_horario_os(p_os_id uuid, p_inicio timestamptz, p_duracao_min integer, p_motivo text, p_aceitar_avisos boolean,
  p_justificativa text, p_concordancia_informada boolean, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_inicio, p_duracao_min, p_motivo, p_aceitar_avisos, p_justificativa, p_concordancia_informada));
  anterior jsonb;
  o public.ordens_servico;
  a public.agendamentos;
  g public.reagendamentos;
  v_fim timestamptz;
  v_avisos jsonb;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_subst integer;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'propor_horario_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['agenda.alterar']);
  IF NOT app_private.os_ativa(o) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Horário só se define em OS em andamento.');
  END IF;
  SELECT * INTO a FROM public.agendamentos WHERE solicitacao_id = o.solicitacao_id AND estado = 'confirmado';
  IF a.id IS NOT NULL THEN
    v_motivo := app_private.ler_texto(v_motivo, 5, 300, 'motivo', 'Diga por que o horário precisa mudar (5 a 300 caracteres).');
  ELSIF char_length(v_motivo) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O motivo tem até 300 caracteres.', 'motivo');
  END IF;
  IF char_length(p_justificativa) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A justificativa tem até 300 caracteres.', 'justificativa');
  END IF;
  IF o.origem = 'interna' AND NOT coalesce(p_concordancia_informada, false) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Confirme que o cliente concordou com o horário.', 'concordancia_informada');
  END IF;
  v_fim := app_private.validar_horario(p_inicio, p_duracao_min);
  PERFORM pg_advisory_xact_lock(hashtextextended('agenda|' || o.empresa_id, 0));
  v_avisos := app_private.avisos_horario(o.empresa_id, o.solicitacao_id, p_inicio, v_fim);
  IF jsonb_array_length(v_avisos) > 0 AND NOT coalesce(p_aceitar_avisos, false) THEN
    RETURN jsonb_build_object('gravado', false, 'avisos', v_avisos);
  END IF;
  UPDATE public.reagendamentos SET estado = 'substituido', respondido_em = now(), respondido_por = usuario
   WHERE os_id = o.id AND estado = 'pendente';
  GET DIAGNOSTICS v_subst = ROW_COUNT;
  INSERT INTO public.reagendamentos (empresa_id, os_id, tipo, proposto_por, autor, inicio, fim, motivo, avisos, justificativa, estado,
    concordancia_informada, respondido_por, respondido_em)
  VALUES (o.empresa_id, o.id, CASE WHEN a.id IS NULL THEN 'definicao' ELSE 'alteracao' END, 'empresa', usuario, p_inicio, v_fim, v_motivo,
    v_avisos, nullif(btrim(coalesce(p_justificativa, '')), ''), CASE o.origem WHEN 'interna' THEN 'aceito' ELSE 'pendente' END,
    o.origem = 'interna', CASE WHEN o.origem = 'interna' THEN usuario END, CASE WHEN o.origem = 'interna' THEN now() END)
  RETURNING * INTO g;
  IF g.estado = 'aceito' THEN
    PERFORM app_private.aplicar_horario(o, g, usuario);
  END IF;
  UPDATE public.ordens_servico SET versao = versao + 1, atualizado_em = now() WHERE id = o.id RETURNING * INTO o;
  PERFORM app_private.os_evento(o, CASE WHEN g.estado = 'aceito' THEN 'horario_definido' ELSE 'horario_proposto' END, NULL, NULL, 'equipe', usuario,
    v_motivo, jsonb_build_object('inicio', g.inicio, 'fim', g.fim, 'anterior', CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('inicio', a.inicio, 'fim', a.fim) END,
      'concordancia_informada', g.concordancia_informada, 'substituiu_pendentes', v_subst), true);
  IF jsonb_array_length(v_avisos) > 0 THEN
    PERFORM app_private.os_evento(o, 'aviso_horario_aceito', NULL, NULL, 'equipe', usuario, g.justificativa, jsonb_build_object('avisos', v_avisos), false);
  END IF;
  PERFORM app_private.auditar(o.empresa_id, usuario, 'agenda.horario_proposto', 'reagendamentos', g.id,
    jsonb_build_object('os', o.numero, 'estado', g.estado, 'avisos', jsonb_array_length(v_avisos), 'tipo', g.tipo));
  RETURN app_private.idem_fim(usuario, 'propor_horario_os', p_operation_key, assinatura,
    jsonb_build_object('gravado', true, 'estado', g.estado, 'avisos', v_avisos, 'reagendamento_id', g.id));
END $$;

-- Pedido do cliente (D9-19, D9-28): 1 pendente e até 3 por OS (limites da CK). Além do total, só com justificativa
-- de situação excepcional, que fica registrada; nunca impede o atendimento de um caso justificado.
CREATE FUNCTION public.pedir_reagendamento_os(p_os_id uuid, p_inicio timestamptz, p_duracao_min integer, p_motivo text,
  p_justificativa_excepcional text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_inicio, p_duracao_min, p_motivo, p_justificativa_excepcional));
  anterior jsonb;
  o public.ordens_servico;
  a public.agendamentos;
  g public.reagendamentos;
  v_motivo text;
  v_exc text := nullif(btrim(coalesce(p_justificativa_excepcional, '')), '');
  v_dur integer;
  v_fim timestamptz;
  v_total integer;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'pedir_reagendamento_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  IF app_private.papel_na_os(o, usuario, NULL) <> 'cliente' THEN
    PERFORM app_private.erro('NOT_FOUND', 'Ordem de serviço não encontrada.');
  END IF;
  IF NOT app_private.os_ativa(o) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só é possível pedir outro horário com o serviço em andamento.');
  END IF;
  v_motivo := app_private.ler_texto(p_motivo, 5, 300, 'motivo', 'Diga por que precisa de outro horário (5 a 300 caracteres).');
  IF app_private.tem_contato(v_motivo) OR app_private.tem_contato(v_exc) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Não inclua telefone, e-mail ou link.', 'motivo');
  END IF;
  IF EXISTS (SELECT 1 FROM public.reagendamentos WHERE os_id = o.id AND estado = 'pendente' AND proposto_por = 'empresa') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A empresa propôs um horário: aceite ou recuse essa proposta antes de pedir outro.');
  END IF;
  IF (SELECT count(*) FROM public.reagendamentos WHERE os_id = o.id AND estado = 'pendente' AND proposto_por = 'cliente')
       >= app_private.limite('reagendamentos_pendentes_por_os') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Você já tem um pedido de horário aguardando a empresa. Retire-o ou aguarde a resposta.');
  END IF;
  SELECT count(*) INTO v_total FROM public.reagendamentos WHERE os_id = o.id AND proposto_por = 'cliente';
  IF v_total >= app_private.limite('reagendamentos_por_os') THEN
    IF v_exc IS NULL THEN
      PERFORM app_private.erro('STATE_CONFLICT', format('Limite de %s pedidos de horário nesta OS. Em situação excepcional, explique o motivo para enviar mesmo assim.',
        app_private.limite('reagendamentos_por_os')), 'justificativa_excepcional');
    END IF;
    v_exc := app_private.ler_texto(v_exc, 20, 300, 'justificativa_excepcional', 'Explique a situação excepcional (20 a 300 caracteres).');
  ELSE
    v_exc := NULL;
  END IF;
  SELECT * INTO a FROM public.agendamentos WHERE solicitacao_id = o.solicitacao_id AND estado = 'confirmado';
  v_dur := coalesce(p_duracao_min, (extract(epoch FROM a.fim - a.inicio) / 60)::integer, 60);
  v_fim := app_private.validar_horario(p_inicio, v_dur);
  INSERT INTO public.reagendamentos (empresa_id, os_id, tipo, proposto_por, autor, inicio, fim, motivo, avisos, justificativa)
  VALUES (o.empresa_id, o.id, CASE WHEN a.id IS NULL THEN 'definicao' ELSE 'alteracao' END, 'cliente', usuario, p_inicio, v_fim, v_motivo,
    app_private.avisos_horario(o.empresa_id, o.solicitacao_id, p_inicio, v_fim), v_exc)
  RETURNING * INTO g;
  UPDATE public.ordens_servico SET versao = versao + 1, atualizado_em = now() WHERE id = o.id RETURNING * INTO o;
  PERFORM app_private.os_evento(o, 'reagendamento_pedido', NULL, NULL, 'cliente', usuario, v_motivo,
    jsonb_build_object('inicio', g.inicio, 'fim', g.fim, 'excepcional', v_exc IS NOT NULL), true);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'agenda.reagendamento_pedido', 'reagendamentos', g.id,
    jsonb_build_object('os', o.numero, 'pedido', v_total + 1, 'excepcional', v_exc IS NOT NULL));
  RETURN app_private.idem_fim(usuario, 'pedir_reagendamento_os', p_operation_key, assinatura, app_private.os_json(o.id, true, false));
END $$;

-- A outra parte responde. Até a resposta, o horário confirmado continua valendo (D9-19).
CREATE FUNCTION public.responder_reagendamento(p_reagendamento_id uuid, p_aceitar boolean, p_motivo text, p_aceitar_avisos boolean,
  p_justificativa text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_reagendamento_id, p_aceitar, p_motivo, p_aceitar_avisos, p_justificativa));
  anterior jsonb;
  g public.reagendamentos;
  o public.ordens_servico;
  papel text;
  v_avisos jsonb;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'responder_reagendamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO g FROM public.reagendamentos WHERE id = p_reagendamento_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Pedido de horário não encontrado.');
  END IF;
  o := app_private.os_trava(g.os_id);
  SELECT * INTO g FROM public.reagendamentos WHERE id = p_reagendamento_id FOR UPDATE;
  IF g.proposto_por = 'empresa' THEN
    IF app_private.papel_na_os(o, usuario, NULL) <> 'cliente' THEN
      PERFORM app_private.erro('NOT_FOUND', 'Pedido de horário não encontrado.');
    END IF;
    papel := 'cliente';
  ELSE
    IF o.cliente_auth_id = usuario THEN
      PERFORM app_private.erro('FORBIDDEN_ACTION', 'Quem responde ao seu pedido é a empresa.');
    END IF;
    PERFORM app_private.exigir_permissoes(o.empresa_id, usuario, ARRAY['agenda.alterar']);
    papel := 'equipe';
  END IF;
  IF g.estado <> 'pendente' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este pedido de horário já foi respondido ou substituído.');
  END IF;
  IF NOT app_private.os_ativa(o) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A ordem de serviço não está mais em andamento.');
  END IF;
  IF char_length(v_motivo) > 300 OR char_length(p_justificativa) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Os textos têm até 300 caracteres.', 'motivo');
  END IF;
  IF papel = 'cliente' AND app_private.tem_contato(v_motivo) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Não inclua telefone, e-mail ou link.', 'motivo');
  END IF;
  IF coalesce(p_aceitar, false) THEN
    IF g.inicio < now() THEN
      PERFORM app_private.erro('STATE_CONFLICT', 'Este horário já passou. Peça ou proponha outro.');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('agenda|' || o.empresa_id, 0));
    v_avisos := app_private.avisos_horario(o.empresa_id, o.solicitacao_id, g.inicio, g.fim);
    -- A empresa confirma conscientemente os avisos; para o cliente eles são internos e foram aceitos na proposta da empresa.
    IF papel = 'equipe' AND jsonb_array_length(v_avisos) > 0 AND NOT coalesce(p_aceitar_avisos, false) THEN
      RETURN jsonb_build_object('gravado', false, 'avisos', v_avisos);
    END IF;
    UPDATE public.reagendamentos SET estado = 'aceito', avisos = v_avisos, respondido_por = usuario, respondido_em = now(),
      resposta_motivo = v_motivo, justificativa = coalesce(nullif(btrim(coalesce(p_justificativa, '')), ''), justificativa)
     WHERE id = g.id RETURNING * INTO g;
    PERFORM app_private.aplicar_horario(o, g, usuario);
  ELSE
    IF papel = 'equipe' THEN
      v_motivo := app_private.ler_texto(v_motivo, 5, 300, 'motivo', 'Explique ao cliente por que o horário não serve (5 a 300 caracteres).');
    END IF;
    UPDATE public.reagendamentos SET estado = 'recusado', respondido_por = usuario, respondido_em = now(), resposta_motivo = v_motivo
     WHERE id = g.id RETURNING * INTO g;
  END IF;
  UPDATE public.ordens_servico SET versao = versao + 1, atualizado_em = now() WHERE id = o.id RETURNING * INTO o;
  PERFORM app_private.os_evento(o, 'reagendamento_' || g.estado, NULL, NULL, papel, usuario, v_motivo,
    jsonb_build_object('inicio', g.inicio, 'fim', g.fim), true);
  IF g.estado = 'aceito' AND papel = 'equipe' AND jsonb_array_length(v_avisos) > 0 THEN
    PERFORM app_private.os_evento(o, 'aviso_horario_aceito', NULL, NULL, 'equipe', usuario, g.justificativa, jsonb_build_object('avisos', v_avisos), false);
  END IF;
  PERFORM app_private.auditar(o.empresa_id, usuario, 'agenda.reagendamento_' || g.estado, 'reagendamentos', g.id,
    jsonb_build_object('os', o.numero, 'por', papel));
  RETURN app_private.idem_fim(usuario, 'responder_reagendamento', p_operation_key, assinatura,
    jsonb_build_object('gravado', true, 'estado', g.estado) || jsonb_build_object('os',
      app_private.os_json(o.id, papel = 'cliente', papel = 'equipe' AND app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo'))));
END $$;

-- Quem propôs pode retirar a proposta pendente.
CREATE FUNCTION public.retirar_reagendamento(p_reagendamento_id uuid, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_reagendamento_id));
  anterior jsonb;
  g public.reagendamentos;
  o public.ordens_servico;
  papel text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'retirar_reagendamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO g FROM public.reagendamentos WHERE id = p_reagendamento_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Pedido de horário não encontrado.');
  END IF;
  o := app_private.os_trava(g.os_id);
  SELECT * INTO g FROM public.reagendamentos WHERE id = p_reagendamento_id FOR UPDATE;
  papel := app_private.papel_na_os(o, usuario, 'agenda.alterar');
  IF (g.proposto_por = 'cliente') <> (papel = 'cliente') THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só quem fez a proposta pode retirá-la.');
  END IF;
  IF g.estado <> 'pendente' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este pedido de horário já foi respondido ou substituído.');
  END IF;
  UPDATE public.reagendamentos SET estado = 'retirado', respondido_por = usuario, respondido_em = now() WHERE id = g.id;
  UPDATE public.ordens_servico SET versao = versao + 1, atualizado_em = now() WHERE id = o.id RETURNING * INTO o;
  PERFORM app_private.os_evento(o, 'reagendamento_retirado', NULL, NULL, papel, usuario, NULL, jsonb_build_object('inicio', g.inicio), true);
  RETURN app_private.idem_fim(usuario, 'retirar_reagendamento', p_operation_key, assinatura,
    app_private.os_json(o.id, papel = 'cliente', papel = 'equipe' AND app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

-- Cancelar só o horário (D9-24): a OS continua e volta a "sem horário". Empresa (agenda.alterar) ou o titular, com motivo visível.
CREATE FUNCTION public.cancelar_horario_os(p_os_id uuid, p_motivo text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_os_id, p_motivo));
  anterior jsonb;
  o public.ordens_servico;
  a public.agendamentos;
  papel text;
  v_motivo text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'cancelar_horario_os', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  o := app_private.os_trava(p_os_id);
  papel := app_private.papel_na_os(o, usuario, 'agenda.alterar');
  IF NOT app_private.os_ativa(o) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A ordem de serviço não está em andamento.');
  END IF;
  SELECT * INTO a FROM public.agendamentos WHERE solicitacao_id = o.solicitacao_id AND estado = 'confirmado' FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta OS não tem horário confirmado.');
  END IF;
  v_motivo := app_private.ler_texto(p_motivo, 5, 300, 'motivo', 'Diga por que o horário foi cancelado (5 a 300 caracteres).');
  IF papel = 'cliente' AND app_private.tem_contato(v_motivo) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Não inclua telefone, e-mail ou link.', 'motivo');
  END IF;
  UPDATE public.agendamentos SET estado = 'cancelado', encerrado_em = now() WHERE id = a.id;
  UPDATE public.reagendamentos SET estado = 'retirado', respondido_por = usuario, respondido_em = now(), resposta_motivo = 'Horário cancelado'
   WHERE os_id = o.id AND estado = 'pendente';
  UPDATE public.ordens_servico SET versao = versao + 1, atualizado_em = now() WHERE id = o.id RETURNING * INTO o;
  PERFORM app_private.os_evento(o, 'horario_cancelado', NULL, NULL, papel, usuario, v_motivo,
    jsonb_build_object('inicio', a.inicio, 'fim', a.fim, 'menos_de_24h', a.inicio - now() < interval '24 hours' AND a.inicio > now()), true);
  PERFORM app_private.auditar(o.empresa_id, usuario, 'agenda.horario_cancelado', 'agendamentos', a.id, jsonb_build_object('os', o.numero, 'por', papel));
  RETURN app_private.idem_fim(usuario, 'cancelar_horario_os', p_operation_key, assinatura,
    app_private.os_json(o.id, papel = 'cliente', papel = 'equipe' AND app_private.tem(o.empresa_id, usuario, 'produtos.ver_custo')));
END $$;

-- ===========================================================================
-- 15. Conferência de consistência (só leitura; proprietário)
-- ===========================================================================
CREATE FUNCTION app_private.reconciliacao_os(p_empresa uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'aceites_sem_os', (SELECT count(*) FROM public.solicitacoes_servico s WHERE s.empresa_id = p_empresa AND s.estado = 'aceita'
       AND NOT EXISTS (SELECT 1 FROM public.ordens_servico o WHERE o.solicitacao_id = s.id)),
    'os_com_valor_diferente_do_aceite', (SELECT count(*) FROM public.ordens_servico o JOIN public.orcamento_versoes v ON v.id = o.versao_aceita_id
       WHERE o.empresa_id = p_empresa AND (o.valor_contratado <> v.total OR v.estado <> 'aceita')),
    'titulos_acima_do_contratado', (SELECT count(*) FROM public.ordens_servico o WHERE o.empresa_id = p_empresa
       AND (SELECT coalesce(sum(t.total), 0) FROM public.titulos_financeiros t WHERE t.empresa_id = o.empresa_id AND t.origem_tipo = 'servico'
             AND t.origem_id = o.id AND t.estado <> 'cancelado') > o.valor_contratado),
    'reservas_ativas_em_os_finalizada', (SELECT count(*) FROM public.os_materiais m JOIN public.ordens_servico o ON o.id = m.os_id
       JOIN public.reservas_estoque r ON r.empresa_id = m.empresa_id AND r.origem_tipo = 'os_material' AND r.origem_id = m.reserva_origem_id
       WHERE o.empresa_id = p_empresa AND o.estado IN ('concluida', 'encerrada', 'cancelada') AND r.estado = 'ativa'),
    'reservas_orfas', (SELECT count(*) FROM public.reservas_estoque r WHERE r.empresa_id = p_empresa AND r.origem_tipo = 'os_material'
       AND r.estado = 'ativa' AND NOT EXISTS (SELECT 1 FROM public.os_materiais m WHERE m.reserva_origem_id = r.origem_id)),
    'horario_confirmado_em_os_cancelada', (SELECT count(*) FROM public.agendamentos a JOIN public.ordens_servico o ON o.solicitacao_id = a.solicitacao_id
       WHERE o.empresa_id = p_empresa AND o.estado = 'cancelada' AND a.estado = 'confirmado'),
    'titulos_de_custo_sem_aceite', (SELECT count(*) FROM public.titulos_financeiros t
       LEFT JOIN public.propostas_custo_cancelamento p ON p.id = t.origem_id
       WHERE t.empresa_id = p_empresa AND t.origem_tipo = 'cancelamento_servico' AND t.estado <> 'cancelado'
         AND (p.id IS NULL OR p.estado NOT IN ('aceita', 'acordo'))),
    'quantidade_usada_divergente', (SELECT count(*) FROM public.os_materiais m WHERE m.empresa_id = p_empresa
       AND (m.qtd_usada <> coalesce((SELECT sum(u.quantidade) FROM public.os_material_usos u WHERE u.os_material_id = m.id
              AND u.tipo = 'uso' AND u.estado = 'confirmado'), 0)
         OR m.qtd_devolvida <> coalesce((SELECT sum(u.quantidade) FROM public.os_material_usos u WHERE u.os_material_id = m.id
              AND u.tipo = 'devolucao' AND u.estado = 'confirmado'), 0))),
    'movimento_de_os_divergente', (SELECT count(*) FROM public.os_materiais m WHERE m.empresa_id = p_empresa
       AND (m.qtd_usada - m.qtd_devolvida) <> -coalesce((SELECT sum(mv.quantidade) FROM public.movimentacoes_estoque mv
              WHERE mv.empresa_id = m.empresa_id AND mv.origem_tipo = 'os' AND mv.origem_id = m.os_id AND mv.variacao_id = m.variacao_id), 0)),
    'os_duplicada_por_aceite', (SELECT count(*) FROM (SELECT versao_aceita_id FROM public.ordens_servico WHERE empresa_id = p_empresa
       GROUP BY 1 HAVING count(*) > 1) d))
$$;

CREATE FUNCTION public.reconciliar_os(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  r jsonb;
BEGIN
  PERFORM app_private.exigir_proprietario(p_empresa_id, usuario, 'Só o proprietário confere a consistência das ordens de serviço.');
  r := app_private.reconciliacao_os(p_empresa_id);
  RETURN r || jsonb_build_object('consistente', NOT EXISTS (SELECT 1 FROM jsonb_each(r) WHERE value::text <> '0'));
END $$;

-- ===========================================================================
-- 15b. Ajustes em funções do M07 e do M08
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.aceitar_orcamento(p_solicitacao_id uuid, p_versao_id uuid, p_condicoes_aceitas boolean, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_versao_id, p_condicoes_aceitas));
  anterior jsonb;
  s public.solicitacoes_servico;
  v public.orcamento_versoes;
  papel text;
  v_cliente uuid;
  v_retrato jsonb;
  v_os public.ordens_servico;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'aceitar_orcamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.solicitacao_trava(p_solicitacao_id);
  papel := app_private.papel_na_solicitacao(s, usuario, CASE WHEN s.origem = 'interna' THEN 'orcamentos.aprovar' END);
  IF s.estado = 'aceita' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este orçamento já foi aceito.');
  END IF;
  IF s.estado NOT IN ('orcamento_enviado', 'revisao_pedida') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Não há orçamento disponível para aceitar.');
  END IF;
  SELECT * INTO v FROM public.orcamento_versoes WHERE id = p_versao_id AND solicitacao_id = s.id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Versão não encontrada.');
  END IF;
  IF v.id IS DISTINCT FROM s.versao_vigente_id OR v.estado <> 'enviada' THEN
    PERFORM app_private.erro('QUOTE_VERSION_STALE', 'Esta versão do orçamento foi substituída. Veja a versão atual.');
  END IF;
  IF v.valido_ate < app_private.hoje_sp() THEN
    PERFORM app_private.erro('QUOTE_EXPIRED', 'O prazo deste orçamento terminou. Peça uma atualização à empresa.');
  END IF;
  IF NOT coalesce(p_condicoes_aceitas, false) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Confirme que leu e aceita as condições.', 'condicoes_aceitas');
  END IF;
  v_retrato := app_private.versao_json(v, true) || jsonb_build_object(
    'aceito_em', now(), 'aceito_por', CASE papel WHEN 'cliente' THEN 'cliente' ELSE 'equipe (aceite informado pelo cliente)' END,
    'registrado_por', CASE WHEN papel = 'equipe' THEN app_private.nome_da_pessoa(usuario) END,
    'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim) FROM public.agendamentos a WHERE a.solicitacao_id = s.id AND a.estado = 'confirmado'),
    'servico', s.servico_nome, 'relato', s.relato,
    'politica_cancelamento', (SELECT jsonb_build_object('versao', pc.versao, 'texto', pc.texto) FROM public.politicas_cancelamento pc WHERE pc.empresa_id = s.empresa_id AND pc.ativa));
  UPDATE public.orcamento_versoes SET estado = 'aceita', aceite = v_retrato, versao = versao + 1, atualizado_em = now() WHERE id = v.id RETURNING * INTO v;
  IF s.origem = 'plataforma' THEN
    SELECT id INTO v_cliente FROM public.clientes_empresa WHERE empresa_id = s.empresa_id AND perfil_cliente_id = s.cliente_auth_id;
    IF v_cliente IS NULL THEN
      INSERT INTO public.clientes_empresa (empresa_id, nome, perfil_cliente_id, criado_por)
      VALUES (s.empresa_id, s.cliente_nome, s.cliente_auth_id, usuario) RETURNING id INTO v_cliente;
    END IF;
  ELSE
    v_cliente := s.cliente_id;
  END IF;
  UPDATE public.solicitacoes_servico SET estado = 'aceita', cliente_id = v_cliente, aceite = v_retrato || jsonb_build_object('versao_id', v.id),
    versao = versao + 1, atualizado_em = now() WHERE id = s.id RETURNING * INTO s;
  -- D9-01 = B (substitui o D8-01): a OS nasce no aceite, na mesma transação, uma só por aceite.
  v_os := app_private.criar_os(s, v, usuario, NULL);
  PERFORM app_private.evento_solicitacao(s, 'aceita', papel, usuario, NULL,
    jsonb_build_object('versao', v.numero, 'total_centavos', app_private.para_centavos(v.total), 'os', v_os.numero), true);
  PERFORM app_private.auditar(s.empresa_id, usuario, 'orcamentos.aceito', 'orcamento_versoes', v.id,
    jsonb_build_object('solicitacao', s.numero, 'versao', v.numero, 'total_centavos', app_private.para_centavos(v.total), 'por', papel));
  RETURN app_private.idem_fim(usuario, 'aceitar_orcamento', p_operation_key, assinatura, app_private.solicitacao_json(s.id, papel = 'cliente'));
END $$;

CREATE OR REPLACE FUNCTION app_private.solicitacao_json(p_id uuid, p_para_cliente boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', s.id, 'empresa_id', s.empresa_id, 'numero', s.numero, 'servico_id', s.servico_id, 'servico', s.servico_nome,
    'empresa', (SELECT e.nome_publico FROM public.empresas e WHERE e.id = s.empresa_id),
    'origem', s.origem, 'cliente_nome', s.cliente_nome, 'relato', s.relato, 'cidade', s.cidade, 'bairro', s.bairro,
    'preferencia', s.preferencia, 'respostas', s.respostas, 'estimativa', s.estimativa, 'estado', s.estado,
    'estado_exibicao', CASE WHEN s.estado IN ('orcamento_enviado', 'revisao_pedida') AND v.valido_ate < app_private.hoje_sp() THEN 'vencido' ELSE s.estado END,
    'aceite', s.aceite, 'motivo_encerramento', s.motivo_encerramento, 'encerrada_em', s.encerrada_em, 'versao', s.versao,
    'criado_em', s.criado_em,
    'aguarda_os', s.estado = 'aceita' AND NOT EXISTS (SELECT 1 FROM public.ordens_servico o2 WHERE o2.solicitacao_id = s.id),
    'os', app_private.os_resumo(s.id, p_para_cliente), 'origem_os_id', s.origem_os_id,
    'politica_cancelamento', CASE WHEN s.estado IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida') THEN (SELECT jsonb_build_object('versao', pc.versao, 'texto', pc.texto) FROM public.politicas_cancelamento pc WHERE pc.empresa_id = s.empresa_id AND pc.ativa) END,
    'versao_vigente_id', s.versao_vigente_id,
    'versoes', coalesce((SELECT jsonb_agg(app_private.versao_json(o, p_para_cliente) ORDER BY o.numero DESC)
      FROM public.orcamento_versoes o WHERE o.solicitacao_id = s.id
       AND (NOT p_para_cliente OR o.estado NOT IN ('rascunho', 'aguardando_aprovacao'))), '[]'::jsonb),
    'eventos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ev.id, 'tipo', ev.tipo, 'autor_tipo', ev.autor_tipo,
        'autor', CASE WHEN ev.autor_tipo = 'equipe' AND NOT p_para_cliente THEN app_private.nome_da_pessoa(ev.autor_auth_id)
                      WHEN ev.autor_tipo = 'equipe' THEN 'Empresa' WHEN ev.autor_tipo = 'cliente' THEN s.cliente_nome ELSE 'AutoniCK' END,
        'texto', ev.texto, 'dados', ev.dados, 'interno', NOT ev.visivel_cliente, 'criado_em', ev.criado_em) ORDER BY ev.criado_em, ev.id)
      FROM public.solicitacao_eventos ev WHERE ev.solicitacao_id = s.id AND (NOT p_para_cliente OR ev.visivel_cliente)), '[]'::jsonb),
    'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim, 'confirmado_pela_empresa', true,
        'aviso', 'Horário definido pela empresa. Se não puder, peça outro horário pela mensagem.')
        || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object('id', a.id, 'avisos', a.avisos, 'justificativa', a.justificativa,
             'confirmado_por', app_private.nome_da_pessoa(a.confirmado_por)) END
      FROM public.agendamentos a WHERE a.solicitacao_id = s.id AND a.estado = 'confirmado'))
  || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object(
    'cliente_id', s.cliente_id, 'horarios_gerais', app_private.grade_json(s.empresa_id),
    'historico_horarios', coalesce((SELECT jsonb_agg(jsonb_build_object('inicio', a.inicio, 'fim', a.fim, 'estado', a.estado, 'avisos', a.avisos,
        'justificativa', a.justificativa, 'criado_em', a.criado_em) ORDER BY a.criado_em DESC)
      FROM public.agendamentos a WHERE a.solicitacao_id = s.id), '[]'::jsonb),
    'servico_atual', (SELECT jsonb_build_object('versao', sv.versao, 'ativo', sv.ativo, 'validade_dias', sv.validade_dias, 'duracao_min', sv.duracao_min)
      FROM public.servicos sv WHERE sv.id = s.servico_id)) END
  FROM public.solicitacoes_servico s
  LEFT JOIN public.orcamento_versoes v ON v.id = s.versao_vigente_id
  WHERE s.id = p_id
$$;

CREATE OR REPLACE FUNCTION public.confirmar_horario(p_solicitacao_id uuid, p_inicio timestamptz, p_duracao_min integer, p_aceitar_avisos boolean,
  p_justificativa text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_inicio, p_duracao_min, p_aceitar_avisos, p_justificativa));
  anterior jsonb;
  s public.solicitacoes_servico;
  a public.agendamentos;
  v_fim timestamptz;
  v_avisos jsonb;
  v_ant public.agendamentos;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'confirmar_horario', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.solicitacao_trava(p_solicitacao_id);
  PERFORM app_private.exigir_permissoes(s.empresa_id, usuario, ARRAY['agenda.alterar']);
  IF s.estado IN ('recusada', 'cancelada') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta solicitação está encerrada.');
  END IF;
  SELECT * INTO v_ant FROM public.agendamentos WHERE solicitacao_id = s.id AND estado = 'confirmado' FOR UPDATE;
  -- D9-18: depois do aceite, o horário é da ordem de serviço (proposta e reagendamento por acordo).
  IF s.estado = 'aceita' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O orçamento já foi aceito: defina ou mude o horário na ordem de serviço, por proposta ou reagendamento.');
  END IF;
  IF p_inicio IS NULL OR p_inicio < now() THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha uma data e hora a partir de agora.', 'inicio');
  END IF;
  IF p_inicio > now() + interval '180 days' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O horário pode ser marcado até 180 dias à frente.', 'inicio');
  END IF;
  IF p_duracao_min IS NULL OR p_duracao_min NOT BETWEEN 15 AND 720 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A duração vai de 15 minutos a 12 horas.', 'duracao_min');
  END IF;
  IF char_length(p_justificativa) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A justificativa tem até 300 caracteres.', 'justificativa');
  END IF;
  v_fim := p_inicio + make_interval(mins => p_duracao_min);
  -- Trava da agenda da empresa: duas confirmações ao mesmo tempo veem uma a outra nos avisos de sobreposição.
  PERFORM pg_advisory_xact_lock(hashtextextended('agenda|' || s.empresa_id, 0));
  v_avisos := app_private.avisos_horario(s.empresa_id, s.id, p_inicio, v_fim);
  IF jsonb_array_length(v_avisos) > 0 AND NOT coalesce(p_aceitar_avisos, false) THEN
    -- Nada é gravado: a tela mostra os avisos e pede confirmação explícita.
    RETURN jsonb_build_object('confirmado', false, 'avisos', v_avisos);
  END IF;
  IF v_ant.id IS NOT NULL THEN
    UPDATE public.agendamentos SET estado = 'substituido', encerrado_em = now() WHERE id = v_ant.id;
  END IF;
  INSERT INTO public.agendamentos (empresa_id, solicitacao_id, inicio, fim, avisos, justificativa, confirmado_por)
  VALUES (s.empresa_id, s.id, p_inicio, v_fim, v_avisos, nullif(btrim(coalesce(p_justificativa, '')), ''), usuario) RETURNING * INTO a;
  UPDATE public.solicitacoes_servico SET versao = versao + 1, atualizado_em = now() WHERE id = s.id RETURNING * INTO s;
  PERFORM app_private.evento_solicitacao(s, CASE WHEN v_ant.id IS NULL THEN 'horario_confirmado' ELSE 'horario_alterado' END, 'equipe', usuario, NULL,
    jsonb_build_object('inicio', a.inicio, 'fim', a.fim, 'anterior', CASE WHEN v_ant.id IS NOT NULL THEN jsonb_build_object('inicio', v_ant.inicio, 'fim', v_ant.fim) END,
      'aviso_cliente', 'Horário definido pela empresa. Se não puder, peça outro horário pela mensagem.'), true);
  IF jsonb_array_length(v_avisos) > 0 THEN
    PERFORM app_private.evento_solicitacao(s, 'aviso_horario_aceito', 'equipe', usuario, a.justificativa, jsonb_build_object('avisos', v_avisos), false);
  END IF;
  PERFORM app_private.auditar(s.empresa_id, usuario, 'agenda.horario_confirmado', 'agendamentos', a.id,
    jsonb_build_object('solicitacao', s.numero, 'avisos', jsonb_array_length(v_avisos), 'substituiu', v_ant.id IS NOT NULL));
  RETURN app_private.idem_fim(usuario, 'confirmar_horario', p_operation_key, assinatura,
    jsonb_build_object('confirmado', true, 'avisos', v_avisos, 'horario', jsonb_build_object('id', a.id, 'inicio', a.inicio, 'fim', a.fim)));
END $$;

CREATE OR REPLACE FUNCTION public.cancelar_solicitacao(p_solicitacao_id uuid, p_motivo text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_motivo));
  anterior jsonb;
  s public.solicitacoes_servico;
  papel text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'cancelar_solicitacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.solicitacao_trava(p_solicitacao_id);
  papel := app_private.papel_na_solicitacao(s, usuario, 'orcamentos.cancelar');
  IF s.estado = 'aceita' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O orçamento já foi aceito: cancele pela ordem de serviço.');
  END IF;
  IF s.estado IN ('recusada', 'cancelada') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta solicitação já está encerrada.');
  END IF;
  IF papel = 'equipe' THEN
    v_motivo := app_private.ler_texto(v_motivo, 10, 300, 'motivo', 'Explique ao cliente o motivo (10 a 300 caracteres).');
  ELSIF char_length(v_motivo) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O motivo tem até 300 caracteres.', 'motivo');
  END IF;
  s := app_private.encerrar_solicitacao(s, 'cancelada', v_motivo);
  PERFORM app_private.evento_solicitacao(s, 'cancelada', papel, usuario, v_motivo, jsonb_build_object('sem_cobranca', true), true);
  PERFORM app_private.auditar(s.empresa_id, usuario, 'orcamentos.solicitacao_cancelada', 'solicitacoes_servico', s.id,
    jsonb_build_object('numero', s.numero, 'por', papel));
  RETURN app_private.idem_fim(usuario, 'cancelar_solicitacao', p_operation_key, assinatura, app_private.solicitacao_json(s.id, papel = 'cliente'));
END $$;

CREATE OR REPLACE FUNCTION app_private.aplicar_dados_servico(p_atual public.servicos, p_dados jsonb) RETURNS public.servicos
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  s public.servicos := p_atual;
BEGIN
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['nome', 'descricao', 'categoria_id', 'politica_preco', 'preco_centavos', 'duracao_min',
    'validade_dias', 'modalidade', 'exibicao', 'faixa_percentual']);
  IF p_dados ? 'nome' THEN
    s.nome := app_private.ler_texto(p_dados->>'nome', 2, 80, 'nome', 'Dê um nome ao serviço (2 a 80 caracteres).');
  END IF;
  IF p_dados ? 'descricao' THEN
    s.descricao := nullif(btrim(coalesce(p_dados->>'descricao', '')), '');
    IF char_length(s.descricao) > 1000 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'A descrição pode ter até 1.000 caracteres.', 'descricao');
    END IF;
  END IF;
  IF p_dados ? 'categoria_id' THEN
    s.categoria_id := app_private.ler_uuid(p_dados->>'categoria_id', 'categoria_id');
    -- D8-04: categorias empresariais agora; categorias próprias de serviço (tipo 'servico', já previsto na tabela) no futuro.
    IF s.categoria_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categorias_plataforma WHERE id = s.categoria_id AND ativo AND tipo IN ('negocio', 'servico')) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha uma das categorias empresariais oficiais.', 'categoria_id');
    END IF;
  END IF;
  IF p_dados ? 'politica_preco' THEN
    s.politica_preco := p_dados->>'politica_preco';
    IF s.politica_preco IS NULL OR s.politica_preco NOT IN ('fixo', 'a_partir_de', 'sob_consulta', 'por_regras', 'pacote') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha como o preço é informado: fixo, a partir de, sob consulta, por regras ou pacote.', 'politica_preco');
    END IF;
    IF s.politica_preco = 'pacote' AND EXISTS (SELECT 1 FROM public.servico_pacote_itens WHERE servico_id = s.id) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Este serviço faz parte de um pacote e não pode virar pacote.', 'politica_preco');
    END IF;
  END IF;
  IF p_dados ? 'preco_centavos' THEN
    s.preco := app_private.centavos(p_dados->'preco_centavos', 'preco_centavos', false, 1);
  END IF;
  IF s.politica_preco = 'sob_consulta' THEN
    s.preco := NULL;
  ELSIF s.politica_preco IN ('fixo', 'a_partir_de', 'pacote') AND s.preco IS NULL THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o preço do serviço.', 'preco_centavos');
  END IF;
  IF p_dados ? 'duracao_min' THEN
    s.duracao_min := nullif(p_dados->>'duracao_min', '')::integer;
    IF s.duracao_min IS NOT NULL AND s.duracao_min NOT BETWEEN 15 AND 720 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'A duração estimada vai de 15 minutos a 12 horas.', 'duracao_min');
    END IF;
  END IF;
  IF p_dados ? 'validade_dias' THEN
    s.validade_dias := coalesce(nullif(p_dados->>'validade_dias', '')::integer, 15);
    IF s.validade_dias NOT BETWEEN 1 AND 90 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'A validade do orçamento vai de 1 a 90 dias.', 'validade_dias');
    END IF;
  END IF;
  IF p_dados ? 'modalidade' THEN
    s.modalidade := coalesce(p_dados->>'modalidade', 'analise_manual');
    IF s.modalidade NOT IN ('analise_manual', 'orcamento_automatico') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Modalidade inválida.', 'modalidade');
    END IF;
  END IF;
  IF s.modalidade = 'orcamento_automatico' AND s.politica_preco <> 'por_regras' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O orçamento automático só existe para serviços com preço calculado por regras.', 'modalidade');
  END IF;
  IF p_dados ? 'exibicao' THEN
    s.exibicao := coalesce(p_dados->>'exibicao', 'valor');
    IF s.exibicao NOT IN ('valor', 'faixa') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Mostre a estimativa como valor único ou como faixa.', 'exibicao');
    END IF;
  END IF;
  IF p_dados ? 'faixa_percentual' THEN
    s.faixa_percentual := coalesce(nullif(p_dados->>'faixa_percentual', '')::integer, 0);
  END IF;
  IF s.faixa_percentual NOT BETWEEN 0 AND 50 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A faixa vai de 0% a 50% para mais e para menos.', 'faixa_percentual');
  END IF;
  IF s.exibicao = 'faixa' AND s.faixa_percentual = 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Para mostrar faixa, informe a porcentagem (1% a 50%).', 'faixa_percentual');
  END IF;
  RETURN s;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  PERFORM app_private.erro('VALIDATION_ERROR', 'Número inválido nos dados do serviço.', 'duracao_min');
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app_private.calcular_estimativa(p_s public.servicos, p_respostas jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  r public.servico_regras;
  q public.servico_perguntas;
  v jsonb;
  soma numeric := 0;
  parcela numeric;
  minimo numeric := NULL;
  base jsonb := '[]'::jsonb;
  faltando jsonb := '[]'::jsonb;
  tem_regra boolean := false;
  valor numeric;
  aviso text := 'Estimativa, não é o valor final. O valor só vale depois do orçamento da empresa.';
BEGIN
  IF p_s.politica_preco = 'sob_consulta' THEN
    RETURN jsonb_build_object('completa', false, 'tipo', 'sob_consulta', 'faltando', '[]'::jsonb, 'base', '[]'::jsonb,
      'rotulo', 'Preço sob consulta: a empresa vai analisar e enviar o orçamento.');
  ELSIF p_s.politica_preco = 'fixo' THEN
    RETURN jsonb_build_object('completa', true, 'tipo', 'fixo', 'valor_centavos', app_private.para_centavos(p_s.preco),
      'base', jsonb_build_array(jsonb_build_object('rotulo', 'Preço informado pela empresa', 'valor_centavos', app_private.para_centavos(p_s.preco))),
      'faltando', '[]'::jsonb, 'rotulo', 'Preço informado pela empresa. ' || aviso);
  ELSIF p_s.politica_preco = 'pacote' THEN
    -- D9-22: preço fechado do pacote; os serviços incluídos aparecem sem valor próprio (nada conta em dobro).
    RETURN jsonb_build_object('completa', true, 'tipo', 'pacote', 'valor_centavos', app_private.para_centavos(p_s.preco),
      'base', jsonb_build_array(jsonb_build_object('rotulo', 'Pacote: ' || p_s.nome, 'valor_centavos', app_private.para_centavos(p_s.preco))),
      'itens_pacote', coalesce((SELECT jsonb_agg(jsonb_build_object('servico_id', x.id, 'nome', x.nome) ORDER BY i.ordem) FROM public.servico_pacote_itens i JOIN public.servicos x ON x.id = i.servico_id WHERE i.pacote_id = p_s.id), '[]'::jsonb),
      'faltando', '[]'::jsonb, 'rotulo', 'Preço fechado do pacote informado pela empresa. ' || aviso);
  ELSIF p_s.politica_preco = 'a_partir_de' THEN
    RETURN jsonb_build_object('completa', false, 'tipo', 'a_partir_de', 'minimo_centavos', app_private.para_centavos(p_s.preco),
      'base', '[]'::jsonb, 'faltando', '[]'::jsonb,
      'rotulo', 'A partir de ' || app_private.brl(p_s.preco) || '. A empresa vai analisar e enviar o orçamento.');
  END IF;
  FOR r IN SELECT * FROM public.servico_regras WHERE servico_id = p_s.id AND ativa ORDER BY ordem LOOP
    tem_regra := true;
    parcela := NULL;
    IF r.pergunta_id IS NOT NULL THEN
      SELECT * INTO q FROM public.servico_perguntas WHERE id = r.pergunta_id;
      v := p_respostas -> r.pergunta_id::text;
      IF v IS NULL OR NOT q.ativa THEN
        faltando := faltando || jsonb_build_array(jsonb_build_object('pergunta_id', r.pergunta_id, 'texto', q.texto));
        CONTINUE;
      END IF;
    END IF;
    CASE r.tipo
      WHEN 'valor_base' THEN parcela := (r.parametros->>'valor_centavos')::numeric / 100;
      WHEN 'por_quantidade' THEN parcela := round((v #>> '{}')::numeric * (r.parametros->>'valor_unitario_centavos')::numeric / 100, 2);
      WHEN 'por_opcao' THEN
        parcela := coalesce((SELECT sum((r.parametros->'valores'->>x)::numeric) FROM jsonb_array_elements_text(
          CASE jsonb_typeof(v) WHEN 'array' THEN v ELSE jsonb_build_array(v) END) x), 0) / 100;
      WHEN 'se_sim' THEN parcela := CASE WHEN (v #>> '{}')::boolean THEN (r.parametros->>'valor_centavos')::numeric / 100 ELSE 0 END;
      WHEN 'minimo' THEN minimo := (r.parametros->>'valor_centavos')::numeric / 100;
    END CASE;
    IF parcela IS NOT NULL THEN
      soma := soma + parcela;
      base := base || jsonb_build_array(jsonb_build_object('rotulo', r.rotulo, 'valor_centavos', app_private.para_centavos(parcela)));
    END IF;
  END LOOP;
  IF NOT tem_regra OR jsonb_array_length(faltando) > 0 THEN
    RETURN jsonb_build_object('completa', false, 'tipo', 'por_regras', 'base', base, 'faltando', faltando,
      'rotulo', CASE WHEN NOT tem_regra THEN 'A empresa ainda não cadastrou regras de cálculo: ela vai analisar e enviar o orçamento.'
                     ELSE 'Faltam informações para estimar: a empresa vai analisar e enviar o orçamento.' END);
  END IF;
  valor := soma;
  IF minimo IS NOT NULL AND valor < minimo THEN
    base := base || jsonb_build_array(jsonb_build_object('rotulo', 'Ajuste ao valor mínimo do serviço', 'valor_centavos', app_private.para_centavos(minimo - valor)));
    valor := minimo;
  END IF;
  IF valor <= 0 THEN
    RETURN jsonb_build_object('completa', false, 'tipo', 'por_regras', 'base', base, 'faltando', '[]'::jsonb,
      'rotulo', 'As regras não chegaram a um valor: a empresa vai analisar e enviar o orçamento.');
  END IF;
  RETURN jsonb_build_object('completa', true, 'tipo', 'por_regras', 'valor_centavos', app_private.para_centavos(valor),
    'minimo_centavos', CASE WHEN p_s.exibicao = 'faixa' THEN app_private.para_centavos(round(valor * (100 - p_s.faixa_percentual) / 100, 2)) END,
    'maximo_centavos', CASE WHEN p_s.exibicao = 'faixa' THEN app_private.para_centavos(round(valor * (100 + p_s.faixa_percentual) / 100, 2)) END,
    'exibicao', p_s.exibicao, 'faixa_percentual', p_s.faixa_percentual, 'base', base, 'faltando', '[]'::jsonb,
    'servico_versao', p_s.versao,
    'rotulo', CASE WHEN p_s.modalidade = 'orcamento_automatico'
      THEN 'Orçamento gerado pelas regras da empresa, sem análise manual.'
      ELSE aviso END);
END $$;

CREATE OR REPLACE FUNCTION app_private.servico_json(p_s public.servicos, p_privado boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', p_s.id, 'empresa_id', p_s.empresa_id, 'nome', p_s.nome, 'descricao', p_s.descricao,
    'categoria_id', p_s.categoria_id, 'categoria', (SELECT nome FROM public.categorias_plataforma WHERE id = p_s.categoria_id),
    'politica_preco', p_s.politica_preco, 'preco_centavos', app_private.para_centavos(p_s.preco), 'duracao_min', p_s.duracao_min,
    'validade_dias', p_s.validade_dias, 'modalidade', p_s.modalidade, 'exibicao', p_s.exibicao, 'faixa_percentual', p_s.faixa_percentual,
    'ativo', p_s.ativo, 'versao', p_s.versao,
    'itens_pacote', CASE WHEN p_s.politica_preco = 'pacote' THEN coalesce((SELECT jsonb_agg(jsonb_build_object('servico_id', x.id, 'nome', x.nome) ORDER BY i.ordem) FROM public.servico_pacote_itens i JOIN public.servicos x ON x.id = i.servico_id WHERE i.pacote_id = p_s.id), '[]'::jsonb) END,
    'perguntas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', q.id, 'ordem', q.ordem, 'texto', q.texto, 'ajuda', q.ajuda, 'tipo', q.tipo,
        'obrigatoria', q.obrigatoria, 'configuracao', q.configuracao) ORDER BY q.ordem)
      FROM public.servico_perguntas q WHERE q.servico_id = p_s.id AND q.ativa), '[]'::jsonb))
  || CASE WHEN p_privado THEN jsonb_build_object(
    'regras', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'ordem', r.ordem, 'tipo', r.tipo, 'pergunta_id', r.pergunta_id,
        'rotulo', r.rotulo, 'parametros', r.parametros) ORDER BY r.ordem)
      FROM public.servico_regras r WHERE r.servico_id = p_s.id AND r.ativa), '[]'::jsonb),
    'solicitacoes_abertas', (SELECT count(*) FROM public.solicitacoes_servico s WHERE s.servico_id = p_s.id
                               AND s.estado IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida')))
    ELSE '{}'::jsonb END
$$;

CREATE OR REPLACE FUNCTION app_private.criar_solicitacao_nucleo(p_s public.servicos, p_origem text, p_cliente_auth text, p_cliente_id uuid,
  p_cliente_nome text, p_dados jsonb, p_usuario text) RETURNS public.solicitacoes_servico
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  sol public.solicitacoes_servico;
  v_resp jsonb;
  v_est jsonb;
  v_num integer;
  v_relato text;
  v_form jsonb;
  v_resp_retrato jsonb;
  ver public.orcamento_versoes;
  b jsonb;
  i integer := 0;
BEGIN
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['respostas', 'relato', 'cidade', 'bairro', 'preferencia']);
  IF NOT p_s.ativo THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este serviço não está disponível no momento.');
  END IF;
  IF p_s.politica_preco = 'pacote' AND (SELECT count(*) FROM public.servico_pacote_itens WHERE pacote_id = p_s.id) < 2 THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este pacote ainda não tem os serviços incluídos.');
  END IF;
  v_relato := app_private.ler_texto(p_dados->>'relato', 10, 2000, 'relato', 'Conte o que você precisa (10 a 2.000 caracteres).');
  IF char_length(p_dados->>'cidade') > 80 OR char_length(p_dados->>'bairro') > 80 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Cidade e bairro têm até 80 caracteres.', 'cidade');
  END IF;
  v_resp := app_private.validar_respostas(p_s.id, p_dados->'respostas', true);
  v_est := app_private.calcular_estimativa(p_s, v_resp);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'ordem', q.ordem, 'texto', q.texto, 'tipo', q.tipo, 'obrigatoria', q.obrigatoria,
      'configuracao', q.configuracao) ORDER BY q.ordem), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('pergunta_id', q.id, 'texto', q.texto, 'tipo', q.tipo, 'valor', v_resp -> q.id::text,
      'unidade', q.configuracao->>'unidade') ORDER BY q.ordem) FILTER (WHERE v_resp ? q.id::text), '[]'::jsonb)
    INTO v_form, v_resp_retrato
    FROM public.servico_perguntas q WHERE q.servico_id = p_s.id AND q.ativa;
  INSERT INTO app_private.contadores_empresa (empresa_id) VALUES (p_s.empresa_id) ON CONFLICT (empresa_id) DO NOTHING;
  UPDATE app_private.contadores_empresa SET proxima_solicitacao = proxima_solicitacao + 1 WHERE empresa_id = p_s.empresa_id
    RETURNING proxima_solicitacao - 1 INTO v_num;
  INSERT INTO public.solicitacoes_servico (empresa_id, numero, servico_id, servico_versao, servico_nome, origem, cliente_auth_id, cliente_id,
    cliente_nome, relato, cidade, bairro, preferencia, formulario, respostas, estimativa, criado_por)
  VALUES (p_s.empresa_id, v_num, p_s.id, p_s.versao, p_s.nome, p_origem, p_cliente_auth, p_cliente_id, p_cliente_nome, v_relato,
    nullif(btrim(coalesce(p_dados->>'cidade', '')), ''), nullif(btrim(coalesce(p_dados->>'bairro', '')), ''),
    app_private.ler_preferencia(p_dados->'preferencia'), v_form, v_resp_retrato, v_est, p_usuario)
  RETURNING * INTO sol;
  PERFORM app_private.evento_solicitacao(sol, 'criada', CASE p_origem WHEN 'plataforma' THEN 'cliente' ELSE 'equipe' END, p_usuario,
    NULL, jsonb_build_object('estimativa', v_est), true);
  -- Orçamento automático (D8-09): só no serviço em que o gestor ligou essa modalidade e só com estimativa completa.
  IF p_s.modalidade = 'orcamento_automatico' AND (v_est->>'completa')::boolean THEN
    INSERT INTO public.orcamento_versoes (empresa_id, solicitacao_id, numero, tipo, estado, valido_ate, condicoes, criada_por, enviada_em)
    VALUES (sol.empresa_id, sol.id, 1, 'automatico', 'rascunho', app_private.hoje_sp() + p_s.validade_dias,
      'Orçamento gerado pelas regras cadastradas pela empresa, sem análise manual.', 'sistema', NULL)
    RETURNING * INTO ver;
    FOR b IN SELECT value FROM jsonb_array_elements(v_est->'base') LOOP
      i := i + 1;
      INSERT INTO public.orcamento_componentes (empresa_id, versao_id, ordem, tipo, descricao, quantidade, valor_unitario, desconto, total)
      VALUES (sol.empresa_id, ver.id, i, 'outro', left(b->>'rotulo', 120), 1, (b->>'valor_centavos')::numeric / 100, 0, (b->>'valor_centavos')::numeric / 100);
    END LOOP;
    UPDATE public.orcamento_versoes SET subtotal = (SELECT sum(total) FROM public.orcamento_componentes WHERE versao_id = ver.id),
      total = (SELECT sum(total) FROM public.orcamento_componentes WHERE versao_id = ver.id), estado = 'enviada', enviada_em = now()
     WHERE id = ver.id RETURNING * INTO ver;
    UPDATE public.solicitacoes_servico SET estado = 'orcamento_enviado', versao_vigente_id = ver.id, versao = versao + 1, atualizado_em = now()
     WHERE id = sol.id RETURNING * INTO sol;
    PERFORM app_private.evento_solicitacao(sol, 'orcamento_automatico', 'sistema', NULL, NULL,
      jsonb_build_object('versao', 1, 'total_centavos', app_private.para_centavos(ver.total), 'valido_ate', ver.valido_ate), true);
  END IF;
  RETURN sol;
END $$;

CREATE OR REPLACE FUNCTION app_private.resumo_periodo(p_empresa uuid, p_de date, p_ate date, p_ver_custo boolean) RETURNS jsonb
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
  v_cat_insumos uuid := (SELECT id FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND codigo_sistema = 'insumos');
  v_insumos_compra numeric;
  v_insumos_total numeric;
  v_servicos numeric;
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
    coalesce(sum(CASE WHEN sentido = 'entrada' THEN valor ELSE -valor END) FILTER (WHERE natureza = 'ajuste'), 0) AS ajustes,
    coalesce(sum(CASE WHEN sentido = 'entrada' THEN valor ELSE -valor END) FILTER (WHERE l.tipo = 'ajuste_conferencia'), 0) AS diferencas_caixa
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
  -- I7-02 (C): compra mista (categoria "Compras para revenda" com itens de uso interno): a parte dos insumos é despesa
  -- gerencial no mês da compra; a parte de revenda vira CMV quando vendida. Cada centavo entra uma vez só.
  SELECT coalesce(sum(least(app_private.valor_insumos_compra(t.origem_id), t.total)) FILTER (WHERE t.competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(least(app_private.valor_insumos_compra(t.origem_id), t.total))
           FILTER (WHERE t.estado = 'cancelado' AND (t.cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_insumos_compra FROM public.titulos_financeiros t
   WHERE t.empresa_id = p_empresa AND t.tipo = 'pagar' AND t.origem_tipo = 'compra' AND t.categoria_id = v_compras;
  v_despesas := v_despesas + v_insumos_compra;
  -- Total de insumos reconhecidos no período (informativo; já está dentro das despesas).
  SELECT v_insumos_compra
       + coalesce(sum(total) FILTER (WHERE competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(total) FILTER (WHERE estado = 'cancelado' AND (cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_insumos_total FROM public.titulos_financeiros
   WHERE empresa_id = p_empresa AND tipo = 'pagar' AND categoria_id = v_cat_insumos;
  v_insumos_total := v_insumos_total + coalesce((SELECT sum(CASE WHEN l.sentido = 'saida' THEN l.valor ELSE -l.valor END)
    FROM public.lancamentos_financeiros l LEFT JOIN public.lancamentos_financeiros o ON o.id = l.estorno_de
   WHERE l.empresa_id = p_empresa AND l.data BETWEEN p_de AND p_ate AND l.categoria_id = v_cat_insumos
     AND (l.tipo = 'despesa_avulsa' OR o.tipo = 'despesa_avulsa')), 0);
  SELECT coalesce(sum(total) FILTER (WHERE competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(total) FILTER (WHERE estado = 'cancelado' AND (cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_compras_valor FROM public.titulos_financeiros WHERE empresa_id = p_empresa AND tipo = 'pagar' AND categoria_id = v_compras;
  v_compras_valor := v_compras_valor - v_insumos_compra;   -- só a parte de revenda (a de insumos já está nas despesas)
  -- M09 (D9-10): serviços prestados (sinal, saldo e custos de cancelamento aceitos) pela competência, menos os cancelados no período.
  SELECT coalesce(sum(total) FILTER (WHERE competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(total) FILTER (WHERE estado = 'cancelado' AND (cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_servicos FROM public.titulos_financeiros
   WHERE empresa_id = p_empresa AND tipo = 'receber' AND origem_tipo IN ('servico', 'cancelamento_servico');
  v_receita := v_vendas - v_canceladas + v_outras + v_servicos;

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
      'receita_servicos_centavos', app_private.para_centavos(v_servicos),
      'custo_mercadorias_vendidas_centavos', app_private.para_centavos(v_cmv),
      'margem_bruta_centavos', app_private.para_centavos(v_vendas - v_canceladas - v_cmv),
      'despesas_centavos', app_private.para_centavos(v_despesas),
      'resultado_estimado_centavos', app_private.para_centavos(v_receita - v_cmv - v_despesas),
      'compras_mercadorias_centavos', app_private.para_centavos(v_compras_valor),
      'compras_revenda_centavos', app_private.para_centavos(v_compras_valor), 'insumos_centavos', app_private.para_centavos(v_insumos_total),
      'reconhecimento_insumos', 'compra',
      'cobertura_custo_percentual', CASE WHEN v_cob_total = 0 THEN NULL ELSE round(100 * v_cob_valor / v_cob_total, 1) END,
      'parcial', v_cob_total > 0 AND v_cob_valor < v_cob_total);
  ELSE
    v_resultado := jsonb_build_object('disponivel', false,
      'motivo', 'O resultado usa o custo das mercadorias vendidas, e seu acesso não permite ver custos.',
      'receita_vendas_centavos', app_private.para_centavos(v_vendas),
      'vendas_canceladas_centavos', app_private.para_centavos(v_canceladas),
      'outras_receitas_centavos', app_private.para_centavos(v_outras),
      'receita_servicos_centavos', app_private.para_centavos(v_servicos),
      'despesas_centavos', app_private.para_centavos(v_despesas),
      'compras_mercadorias_centavos', app_private.para_centavos(v_compras_valor),
      'compras_revenda_centavos', app_private.para_centavos(v_compras_valor), 'insumos_centavos', app_private.para_centavos(v_insumos_total),
      'reconhecimento_insumos', 'compra');
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
      'diferencas_caixa_centavos', app_private.para_centavos(f.diferencas_caixa),
      'saldos_iniciais_centavos', app_private.para_centavos(f.ajustes - f.diferencas_caixa),
      'variacao_operacional_centavos', app_private.para_centavos(f.receitas_entradas - f.receitas_saidas - f.despesas_saidas + f.despesas_entradas),
      'saldo_final_centavos', app_private.para_centavos(v_inicial + f.receitas_entradas - f.receitas_saidas - f.despesas_saidas
        + f.despesas_entradas + f.transferido_entrada - f.transferido + f.aportes - f.retiradas + f.ajustes),
      'metodo', 'Regime de caixa: soma do que entrou e saiu das contas, pela data de cada lançamento. Transferências entre contas '
        || 'não mudam o total; aportes e retiradas do proprietário aparecem separados e não são receita nem despesa.'),
    'resultado', v_resultado || jsonb_build_object(
      'metodo', 'Competência simplificada: vendas confirmadas no período (canceladas saem no mês do cancelamento), mais outras '
        || 'receitas, menos o custo das mercadorias vendidas (custo informado no momento da venda) e as despesas do mês de '
        || 'referência. Mercadorias para revenda viram custo quando vendidas; insumos de uso interno são despesa gerencial no mês '
        || 'da compra (reconhecimento na compra, adotado no MVP); o mesmo custo nunca entra duas vezes. Diferenças de conferência '
        || 'de caixa aparecem no fluxo de caixa e no relatório de conferências, não no resultado. Transferências, aportes e retiradas '
        || 'não entram. Custos indiretos não são rateados.',
      'aviso', 'Estimativa gerencial. Não é contabilidade oficial nem substitui um contador.'));
END $$;

CREATE OR REPLACE FUNCTION public.registrar_devolucao_valor(p_titulo_id uuid, p_valor_centavos bigint, p_forma text, p_motivo text,
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
  IF t.estado <> 'cancelado' OR t.origem_tipo NOT IN ('venda', 'servico') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só há devolução de valor em venda ou ordem de serviço cancelada.');
  END IF;
  -- D9-11/D9-12: devolução do valor recebido de uma OS cancelada exige aprovar no financeiro.
  IF t.origem_tipo = 'servico' AND NOT app_private.tem(t.empresa_id, usuario, 'financeiro.aprovar') THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'A devolução de valor de ordem de serviço exige a permissão de aprovar no financeiro.');
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
  PERFORM app_private.auditar(t.empresa_id, usuario, CASE t.origem_tipo WHEN 'venda' THEN 'venda.valor_devolvido' ELSE 'servicos.valor_devolvido' END, 'recebimentos', v_id,
    jsonb_build_object('valor_centavos', p_valor_centavos, 'conta_id', c.id));
  RETURN app_private.idem_fim(usuario, 'registrar_devolucao_valor', p_operation_key, assinatura,
    jsonb_build_object('id', v_id, 'a_devolver_centavos', app_private.para_centavos(t.a_devolver - v_valor)));
END $$;

CREATE OR REPLACE FUNCTION public.cancelar_titulo(p_titulo_id uuid, p_motivo text, p_expected_version integer, p_operation_key text)
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
  IF t.origem_tipo = 'servico' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A conta de uma ordem de serviço muda pela própria OS (cancelamento ou reparcelamento).');
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

-- ===========================================================================
-- 16. Carga: aceites do M08 ganham a sua OS (D9-01), sem título, sem reserva e sem mudar o horário.
-- ===========================================================================
DO $$
DECLARE
  s public.solicitacoes_servico;
  v public.orcamento_versoes;
BEGIN
  FOR s IN SELECT * FROM public.solicitacoes_servico WHERE estado = 'aceita' ORDER BY empresa_id, numero LOOP
    SELECT * INTO v FROM public.orcamento_versoes WHERE solicitacao_id = s.id AND estado = 'aceita';
    IF v.id IS NOT NULL THEN
      PERFORM app_private.criar_os(s, v, NULL, 'm08');
    END IF;
  END LOOP;
END $$;

-- ===========================================================================
-- 17. Privilégios e RLS: nenhuma tabela nova é lida ou gravada direto pela Data API.
-- ===========================================================================
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app_private' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY['adicionar_material_os', 'agenda_operacional', 'atualizar_dados_os', 'cancelar_horario_os', 'cancelar_os', 'confirmar_recebimento_servico', 'decidir_uso_material', 'devolver_material_os', 'gerar_antecipacao_os', 'gerar_proxima_os', 'gerar_titulo_custos', 'minha_os', 'minhas_os', 'mudar_estado_os', 'ordens_da_empresa', 'os_detalhe', 'pedir_reagendamento_os', 'pedir_revisao_os', 'politica_cancelamento', 'propor_custos_cancelamento', 'propor_horario_os', 'publicar_atualizacao_os', 'reconciliar_os', 'registrar_acordo_custos', 'registrar_garantia_os', 'registrar_uso_material', 'reparcelar_titulo_os', 'reservar_material_os', 'responder_custos', 'responder_reagendamento', 'retirar_custos', 'retirar_reagendamento', 'revisar_custos', 'salvar_itens_pacote', 'salvar_politica_cancelamento']) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

ALTER TABLE public.servico_pacote_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.politicas_cancelamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_servico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_materiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_material_usos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancelamentos_os ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.propostas_custo_cancelamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reagendamentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.servico_pacote_itens, public.politicas_cancelamento, public.ordens_servico, public.os_eventos, public.os_materiais,
  public.os_material_usos, public.cancelamentos_os, public.propostas_custo_cancelamento, public.reagendamentos
  FROM PUBLIC, anonymous, authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611130001', 'M09: ordens de serviço criadas no aceite, execução, materiais e baixa de estoque, sinal e saldo a receber, cancelamento com custos e contestação, política de cancelamento, garantia, pacotes, recorrência, agenda operacional e reagendamento por acordo; sem permissão nova (55)');

COMMIT;
