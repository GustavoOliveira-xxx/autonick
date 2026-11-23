-- 202611120003: M08, serviços oferecidos, formulários, estimativa por regras, solicitações, orçamentos versionados,
-- negociação, aceite e recusa, horários gerais e confirmação de horário (MINI-ESPEC_M08; ADR-G08 aprovada em 12/11/2026,
-- D8-01 a D8-25; implementação autorizada só no branch `desenvolvimento`).
-- Princípios: preço e total só no banco (nunca vindos do navegador); versão enviada é imutável; só a versão vigente,
-- enviada e dentro da validade é aceita (C-10); aceite não cria OS (M09) nem título (D8-24); nenhuma IA; tudo com
-- chave de operação, trava da solicitação e auditoria. Tabelas novas SEM acesso direto pela Data API: só funções.

BEGIN;

-- ===========================================================================
-- 1. Permissões novas (D8-22) e limites configuráveis pela CK (D8-23)
-- ===========================================================================
-- O M04 aceitava só letras no nome do módulo; o nome aprovado (D8-22) tem sublinhado. A regra é ampliada, sem perda.
ALTER TABLE public.permissoes_catalogo DROP CONSTRAINT permissoes_catalogo_codigo_check;
ALTER TABLE public.permissoes_catalogo ADD CONSTRAINT permissoes_catalogo_codigo_check CHECK (codigo ~ '^[a-z]+(_[a-z]+)*\.[a-z_]+$');
INSERT INTO public.permissoes_catalogo (codigo, modulo, modulo_nome, acao, acao_nome, descricao, sensivel, ordem) VALUES
  ('catalogo_servicos.visualizar', 'catalogo_servicos', 'Serviços oferecidos', 'visualizar', 'Ver serviços', 'Ver os serviços oferecidos, os formulários e as regras de estimativa.', false, 95),
  ('catalogo_servicos.alterar', 'catalogo_servicos', 'Serviços oferecidos', 'alterar', 'Gerenciar serviços', 'Criar e alterar serviços, preços, formulários e regras de estimativa.', false, 96),
  ('agenda.visualizar', 'agenda', 'Agenda', 'visualizar', 'Ver agenda', 'Ver os horários de atendimento da empresa e os horários confirmados.', false, 103),
  ('agenda.alterar', 'agenda', 'Agenda', 'alterar', 'Gerenciar agenda', 'Alterar os horários gerais e confirmar horários de atendimento.', false, 104);

CREATE TABLE app_private.limites_plataforma (
  chave         text PRIMARY KEY,
  valor         integer NOT NULL,
  minimo        integer NOT NULL,
  maximo        integer NOT NULL,
  descricao     text NOT NULL,
  atualizado_por text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (valor BETWEEN minimo AND maximo)
);
INSERT INTO app_private.limites_plataforma (chave, valor, minimo, maximo, descricao) VALUES
  ('solicitacoes_abertas_por_empresa', 5, 1, 20, 'Solicitações de serviço abertas por cliente em cada empresa'),
  ('solicitacoes_novas_por_dia', 20, 1, 100, 'Solicitações de serviço novas por cliente por dia (horário de São Paulo)');
ALTER TABLE app_private.limites_plataforma ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_private.contadores_empresa ADD COLUMN proxima_solicitacao integer NOT NULL DEFAULT 1;

-- ===========================================================================
-- 2. Estruturas
-- ===========================================================================
-- 2.1 Serviços oferecidos (RF-084, RF-085, RF-092, RF-093; D8-04, D8-05, D8-08, D8-09, D8-12)
-- categoria_id: categoria opcional entre as categorias empresariais (D8-04 = B com ajuste), sem obrigar a categoria da
-- empresa. A tabela de categorias já prevê o tipo 'servico': uma classificação própria de serviços entra como novas linhas,
-- sem migração destrutiva.
CREATE TABLE public.servicos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES public.empresas (id),
  nome              text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 2 AND 80),
  descricao         text CHECK (char_length(descricao) <= 1000),
  categoria_id      uuid REFERENCES public.categorias_plataforma (id),
  politica_preco    text NOT NULL CHECK (politica_preco IN ('fixo', 'a_partir_de', 'sob_consulta', 'por_regras')),
  preco             numeric(14,2) CHECK (preco > 0),
  duracao_min       integer CHECK (duracao_min BETWEEN 15 AND 720),
  validade_dias     integer NOT NULL DEFAULT 15 CHECK (validade_dias BETWEEN 1 AND 90),
  modalidade        text NOT NULL DEFAULT 'analise_manual' CHECK (modalidade IN ('analise_manual', 'orcamento_automatico')),
  exibicao          text NOT NULL DEFAULT 'valor' CHECK (exibicao IN ('valor', 'faixa')),
  faixa_percentual  integer NOT NULL DEFAULT 0 CHECK (faixa_percentual BETWEEN 0 AND 50),
  ativo             boolean NOT NULL DEFAULT true,
  versao            integer NOT NULL DEFAULT 1,
  criado_por        text NOT NULL,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  CONSTRAINT servicos_preco_politica CHECK (
       (politica_preco IN ('fixo', 'a_partir_de') AND preco IS NOT NULL)
    OR (politica_preco = 'sob_consulta' AND preco IS NULL)
    OR (politica_preco = 'por_regras')),
  CONSTRAINT servicos_automatico_por_regras CHECK (modalidade = 'analise_manual' OR politica_preco = 'por_regras')
);
CREATE UNIQUE INDEX servicos_nome_unico ON public.servicos (empresa_id, lower(btrim(nome))) WHERE ativo;
CREATE INDEX servicos_empresa ON public.servicos (empresa_id, ativo, nome);

-- 2.2 Formulário (RF-088; D8-06)
CREATE TABLE public.servico_perguntas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  servico_id    uuid NOT NULL,
  ordem         integer NOT NULL CHECK (ordem BETWEEN 1 AND 15),
  texto         text NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 3 AND 200),
  ajuda         text CHECK (char_length(ajuda) <= 200),
  tipo          text NOT NULL CHECK (tipo IN ('texto_curto', 'texto_longo', 'numero', 'escolha_unica', 'escolha_multipla', 'sim_nao')),
  obrigatoria   boolean NOT NULL DEFAULT false,
  configuracao  jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativa         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, servico_id) REFERENCES public.servicos (empresa_id, id)
);
CREATE UNIQUE INDEX perguntas_ordem_unica ON public.servico_perguntas (servico_id, ordem) WHERE ativa;

-- 2.3 Regras de estimativa (RF-087; D8-07): tipos fechados, sem fórmula livre.
CREATE TABLE public.servico_regras (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  servico_id   uuid NOT NULL,
  ordem        integer NOT NULL CHECK (ordem BETWEEN 1 AND 30),
  tipo         text NOT NULL CHECK (tipo IN ('valor_base', 'por_quantidade', 'por_opcao', 'se_sim', 'minimo')),
  pergunta_id  uuid,
  rotulo       text NOT NULL CHECK (char_length(btrim(rotulo)) BETWEEN 2 AND 80),
  parametros   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativa        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, servico_id) REFERENCES public.servicos (empresa_id, id),
  FOREIGN KEY (empresa_id, pergunta_id) REFERENCES public.servico_perguntas (empresa_id, id),
  CHECK ((tipo IN ('valor_base', 'minimo')) = (pergunta_id IS NULL))
);
CREATE INDEX regras_servico ON public.servico_regras (servico_id, ativa, ordem);

-- 2.4 Horários gerais (RF-115; D8-18): grade semanal privada, fuso de São Paulo.
CREATE TABLE public.horarios_empresa (
  empresa_id  uuid NOT NULL REFERENCES public.empresas (id),
  dia_semana  integer NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),   -- 0 = domingo
  intervalo   integer NOT NULL CHECK (intervalo IN (1, 2)),
  abre        time NOT NULL,
  fecha       time NOT NULL,
  PRIMARY KEY (empresa_id, dia_semana, intervalo),
  CHECK (abre < fecha)
);

-- 2.5 Solicitações (RF-089, RF-096, RF-097, RF-113; D8-02, D8-03, D8-17, D8-19, D8-25)
CREATE TABLE public.solicitacoes_servico (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES public.empresas (id),
  numero            integer NOT NULL,
  servico_id        uuid NOT NULL,
  servico_versao    integer NOT NULL,
  servico_nome      text NOT NULL,
  origem            text NOT NULL CHECK (origem IN ('plataforma', 'interna')),
  cliente_auth_id   text,
  cliente_id        uuid,
  cliente_nome      text NOT NULL,
  relato            text NOT NULL CHECK (char_length(btrim(relato)) BETWEEN 10 AND 2000),
  cidade            text CHECK (char_length(cidade) <= 80),
  bairro            text CHECK (char_length(bairro) <= 80),
  preferencia       jsonb,
  formulario        jsonb NOT NULL,
  respostas         jsonb NOT NULL,
  estimativa        jsonb NOT NULL,
  estado            text NOT NULL DEFAULT 'nova'
                    CHECK (estado IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida', 'aceita', 'recusada', 'cancelada')),
  versao_vigente_id uuid,
  aceite            jsonb,
  motivo_encerramento text CHECK (char_length(motivo_encerramento) <= 300),
  encerrada_em      timestamptz,
  versao            integer NOT NULL DEFAULT 1,
  criado_por        text NOT NULL,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  UNIQUE (empresa_id, numero),
  FOREIGN KEY (empresa_id, servico_id) REFERENCES public.servicos (empresa_id, id),
  FOREIGN KEY (empresa_id, cliente_id) REFERENCES public.clientes_empresa (empresa_id, id),
  CONSTRAINT solicitacoes_origem_cliente CHECK (
       (origem = 'plataforma' AND cliente_auth_id IS NOT NULL)
    OR (origem = 'interna' AND cliente_id IS NOT NULL AND cliente_auth_id IS NULL))
);
CREATE INDEX solicitacoes_empresa ON public.solicitacoes_servico (empresa_id, estado, criado_em DESC);
CREATE INDEX solicitacoes_cliente ON public.solicitacoes_servico (cliente_auth_id, criado_em DESC) WHERE cliente_auth_id IS NOT NULL;

-- 2.6 Versões do orçamento (RF-086, RF-091, RF-092, RF-098; D8-10 a D8-13, D8-17)
CREATE TABLE public.orcamento_versoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  solicitacao_id  uuid NOT NULL,
  numero          integer NOT NULL CHECK (numero >= 1),
  tipo            text NOT NULL CHECK (tipo IN ('manual', 'automatico')),
  estado          text NOT NULL DEFAULT 'rascunho'
                  CHECK (estado IN ('rascunho', 'aguardando_aprovacao', 'enviada', 'substituida', 'aceita', 'recusada', 'cancelada')),
  subtotal        numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  desconto_itens  numeric(14,2) NOT NULL DEFAULT 0 CHECK (desconto_itens >= 0),
  desconto_geral  numeric(14,2) NOT NULL DEFAULT 0 CHECK (desconto_geral >= 0),
  total           numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  valido_ate      date NOT NULL,
  prazo_execucao  text CHECK (char_length(prazo_execucao) <= 120),
  condicoes       text CHECK (char_length(condicoes) <= 1000),
  criada_por      text NOT NULL,
  aprovada_por    text,
  enviada_em      timestamptz,
  aceite          jsonb,
  recusa          jsonb,
  versao          integer NOT NULL DEFAULT 1,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  UNIQUE (solicitacao_id, numero),
  FOREIGN KEY (empresa_id, solicitacao_id) REFERENCES public.solicitacoes_servico (empresa_id, id),
  CHECK (total = subtotal - desconto_itens - desconto_geral)
);
CREATE UNIQUE INDEX versoes_uma_enviada ON public.orcamento_versoes (solicitacao_id) WHERE estado = 'enviada';
CREATE UNIQUE INDEX versoes_um_rascunho ON public.orcamento_versoes (solicitacao_id) WHERE estado IN ('rascunho', 'aguardando_aprovacao');
CREATE UNIQUE INDEX versoes_uma_aceita ON public.orcamento_versoes (solicitacao_id) WHERE estado = 'aceita';
ALTER TABLE public.solicitacoes_servico ADD FOREIGN KEY (empresa_id, versao_vigente_id) REFERENCES public.orcamento_versoes (empresa_id, id);

CREATE TABLE public.orcamento_componentes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  versao_id       uuid NOT NULL,
  ordem           integer NOT NULL CHECK (ordem BETWEEN 1 AND 50),
  tipo            text NOT NULL CHECK (tipo IN ('material', 'mao_de_obra', 'deslocamento', 'outro')),
  descricao       text NOT NULL CHECK (char_length(btrim(descricao)) BETWEEN 2 AND 120),
  quantidade      numeric(12,3) NOT NULL CHECK (quantidade > 0),
  valor_unitario  numeric(14,2) NOT NULL CHECK (valor_unitario >= 0),
  desconto        numeric(14,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
  total           numeric(14,2) NOT NULL CHECK (total >= 0),
  variacao_id     uuid,              -- ligação privada com o catálogo do M05 (D8-11); nunca vai ao cliente
  UNIQUE (versao_id, ordem),
  FOREIGN KEY (empresa_id, versao_id) REFERENCES public.orcamento_versoes (empresa_id, id),
  FOREIGN KEY (empresa_id, variacao_id) REFERENCES public.produto_variacoes (empresa_id, id),
  CHECK (total = round(quantidade * valor_unitario, 2) - desconto)
);

-- 2.7 Linha do tempo (RF-097, RF-099; D8-14): só inclusão.
CREATE TABLE public.solicitacao_eventos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  solicitacao_id  uuid NOT NULL,
  tipo            text NOT NULL,
  autor_tipo      text NOT NULL CHECK (autor_tipo IN ('cliente', 'equipe', 'sistema')),
  autor_auth_id   text,
  texto           text CHECK (char_length(texto) <= 1000),
  dados           jsonb NOT NULL DEFAULT '{}'::jsonb,
  visivel_cliente boolean NOT NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, solicitacao_id) REFERENCES public.solicitacoes_servico (empresa_id, id)
);
CREATE INDEX eventos_solicitacao ON public.solicitacao_eventos (solicitacao_id, criado_em);

-- 2.8 Horário confirmado pela empresa (RF-114; D8-20, D8-21)
CREATE TABLE public.agendamentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  solicitacao_id  uuid NOT NULL,
  inicio          timestamptz NOT NULL,
  fim             timestamptz NOT NULL,
  estado          text NOT NULL DEFAULT 'confirmado' CHECK (estado IN ('confirmado', 'substituido', 'cancelado')),
  avisos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  justificativa   text CHECK (char_length(justificativa) <= 300),
  confirmado_por  text NOT NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  encerrado_em    timestamptz,
  FOREIGN KEY (empresa_id, solicitacao_id) REFERENCES public.solicitacoes_servico (empresa_id, id),
  CHECK (fim > inicio AND fim - inicio <= interval '12 hours')
);
CREATE UNIQUE INDEX agendamentos_um_confirmado ON public.agendamentos (solicitacao_id) WHERE estado = 'confirmado';
CREATE INDEX agendamentos_periodo ON public.agendamentos (empresa_id, inicio) WHERE estado = 'confirmado';

-- 2.9 Proteções: histórico sem exclusão; versão enviada imutável (RN-037).
CREATE FUNCTION app_private.proteger_versao_orcamento() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Versões de orçamento não são excluídas.' USING ERRCODE = 'insufficient_privilege', HINT = 'FORBIDDEN_ACTION';
  END IF;
  IF OLD.estado NOT IN ('rascunho', 'aguardando_aprovacao') THEN
    IF (NEW.subtotal, NEW.desconto_itens, NEW.desconto_geral, NEW.total, NEW.valido_ate, NEW.prazo_execucao, NEW.condicoes,
        NEW.numero, NEW.tipo, NEW.solicitacao_id, NEW.empresa_id, NEW.criada_por, NEW.enviada_em)
       IS DISTINCT FROM (OLD.subtotal, OLD.desconto_itens, OLD.desconto_geral, OLD.total, OLD.valido_ate, OLD.prazo_execucao,
        OLD.condicoes, OLD.numero, OLD.tipo, OLD.solicitacao_id, OLD.empresa_id, OLD.criada_por, OLD.enviada_em) THEN
      RAISE EXCEPTION 'Versão enviada não pode ser alterada: crie uma nova versão.' USING ERRCODE = 'insufficient_privilege', HINT = 'FORBIDDEN_ACTION';
    END IF;
    IF OLD.estado <> 'enviada' AND NEW.estado <> OLD.estado THEN
      RAISE EXCEPTION 'Versão encerrada não muda de situação.' USING ERRCODE = 'insufficient_privilege', HINT = 'FORBIDDEN_ACTION';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER versoes_protegidas BEFORE UPDATE OR DELETE ON public.orcamento_versoes
  FOR EACH ROW EXECUTE FUNCTION app_private.proteger_versao_orcamento();

CREATE FUNCTION app_private.proteger_componentes() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orcamento_versoes WHERE id = coalesce(OLD.versao_id, NEW.versao_id)
              AND estado NOT IN ('rascunho', 'aguardando_aprovacao')) THEN
    RAISE EXCEPTION 'Itens de versão enviada não podem ser alterados.' USING ERRCODE = 'insufficient_privilege', HINT = 'FORBIDDEN_ACTION';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER componentes_protegidos BEFORE INSERT OR UPDATE OR DELETE ON public.orcamento_componentes
  FOR EACH ROW EXECUTE FUNCTION app_private.proteger_componentes();

CREATE TRIGGER eventos_solicitacao_imutaveis BEFORE UPDATE OR DELETE ON public.solicitacao_eventos
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
CREATE TRIGGER solicitacoes_sem_exclusao BEFORE DELETE ON public.solicitacoes_servico
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
CREATE TRIGGER agendamentos_sem_exclusao BEFORE DELETE ON public.agendamentos
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();
CREATE TRIGGER servicos_sem_exclusao BEFORE DELETE ON public.servicos
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- ===========================================================================
-- 3. Auxiliares
-- ===========================================================================
CREATE FUNCTION app_private.limite(p_chave text) RETURNS integer
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT valor FROM app_private.limites_plataforma WHERE chave = p_chave $$;

CREATE FUNCTION app_private.evento_solicitacao(p_s public.solicitacoes_servico, p_tipo text, p_autor_tipo text, p_autor text,
  p_texto text, p_dados jsonb, p_visivel boolean) RETURNS void
LANGUAGE sql SET search_path = ''
AS $$
  INSERT INTO public.solicitacao_eventos (empresa_id, solicitacao_id, tipo, autor_tipo, autor_auth_id, texto, dados, visivel_cliente)
  VALUES (p_s.empresa_id, p_s.id, p_tipo, p_autor_tipo, p_autor, p_texto, coalesce(p_dados, '{}'::jsonb), p_visivel)
$$;

-- Termos que indicam pedido de documento ou dado sensível no texto de uma pergunta (D8-06; filtro auxiliar).
CREATE FUNCTION app_private.pede_dado_sensivel(p_texto text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT p_texto ~* '(\mcpf\M|\mrg\M|\mcnh\M|\mcnpj\M|senha|cart[aã]o|\mcvv\M|c[oó]digo de seguran|n[uú]mero do documento|\mpis\M|t[ií]tulo de eleitor)' $$;

CREATE FUNCTION app_private.agora_sp() RETURNS timestamp
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT now() AT TIME ZONE 'America/Sao_Paulo' $$;

-- 3.1 Serviço
CREATE FUNCTION app_private.servico_json(p_s public.servicos, p_privado boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', p_s.id, 'empresa_id', p_s.empresa_id, 'nome', p_s.nome, 'descricao', p_s.descricao,
    'categoria_id', p_s.categoria_id, 'categoria', (SELECT nome FROM public.categorias_plataforma WHERE id = p_s.categoria_id),
    'politica_preco', p_s.politica_preco, 'preco_centavos', app_private.para_centavos(p_s.preco), 'duracao_min', p_s.duracao_min,
    'validade_dias', p_s.validade_dias, 'modalidade', p_s.modalidade, 'exibicao', p_s.exibicao, 'faixa_percentual', p_s.faixa_percentual,
    'ativo', p_s.ativo, 'versao', p_s.versao,
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

CREATE FUNCTION app_private.aplicar_dados_servico(p_atual public.servicos, p_dados jsonb) RETURNS public.servicos
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
    IF s.politica_preco IS NULL OR s.politica_preco NOT IN ('fixo', 'a_partir_de', 'sob_consulta', 'por_regras') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha como o preço é informado: fixo, a partir de, sob consulta ou por regras.', 'politica_preco');
    END IF;
  END IF;
  IF p_dados ? 'preco_centavos' THEN
    s.preco := app_private.centavos(p_dados->'preco_centavos', 'preco_centavos', false, 1);
  END IF;
  IF s.politica_preco = 'sob_consulta' THEN
    s.preco := NULL;
  ELSIF s.politica_preco IN ('fixo', 'a_partir_de') AND s.preco IS NULL THEN
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

CREATE FUNCTION app_private.servico_da_empresa_trava(p_servico uuid) RETURNS public.servicos
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  s public.servicos;
BEGIN
  SELECT * INTO s FROM public.servicos WHERE id = p_servico FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Serviço não encontrado.');
  END IF;
  RETURN s;
END $$;

-- 3.2 Respostas e estimativa (RF-087, RF-088, RN-032, RN-033, RN-053; D8-06 a D8-09)
-- Valida e normaliza as respostas contra as perguntas ativas. Devolve {pergunta_id: valor}.
CREATE FUNCTION app_private.validar_respostas(p_servico uuid, p_respostas jsonb, p_exigir_obrigatorias boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  q public.servico_perguntas;
  v jsonb;
  saida jsonb := '{}'::jsonb;
  n numeric;
  opcoes jsonb;
  k text;
BEGIN
  IF p_respostas IS NULL THEN p_respostas := '{}'::jsonb; END IF;
  IF jsonb_typeof(p_respostas) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Respostas inválidas.', 'respostas');
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_respostas) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.servico_perguntas WHERE servico_id = p_servico AND ativa AND id::text = k) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Há resposta para uma pergunta que não existe neste serviço.', 'respostas');
    END IF;
  END LOOP;
  FOR q IN SELECT * FROM public.servico_perguntas WHERE servico_id = p_servico AND ativa ORDER BY ordem LOOP
    v := p_respostas -> q.id::text;
    IF v IS NULL OR v = 'null'::jsonb OR (jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') = '')
       OR (jsonb_typeof(v) = 'array' AND jsonb_array_length(v) = 0) THEN
      IF q.obrigatoria AND p_exigir_obrigatorias THEN
        PERFORM app_private.erro('VALIDATION_ERROR', format('Responda: "%s".', q.texto), q.id::text);
      END IF;
      CONTINUE;
    END IF;
    opcoes := coalesce(q.configuracao->'opcoes', '[]'::jsonb);
    CASE q.tipo
      WHEN 'texto_curto', 'texto_longo' THEN
        n := CASE q.tipo WHEN 'texto_curto' THEN 120 ELSE 1000 END;
        IF jsonb_typeof(v) <> 'string' OR char_length(v #>> '{}') > n THEN
          PERFORM app_private.erro('VALIDATION_ERROR', format('Resposta muito longa ou inválida em "%s".', q.texto), q.id::text);
        END IF;
        saida := saida || jsonb_build_object(q.id, btrim(v #>> '{}'));
      WHEN 'numero' THEN
        BEGIN
          n := (v #>> '{}')::numeric;
        EXCEPTION WHEN others THEN
          PERFORM app_private.erro('VALIDATION_ERROR', format('Informe um número em "%s".', q.texto), q.id::text);
        END;
        IF (q.configuracao ? 'minimo' AND n < (q.configuracao->>'minimo')::numeric)
           OR (q.configuracao ? 'maximo' AND n > (q.configuracao->>'maximo')::numeric) THEN
          PERFORM app_private.erro('VALIDATION_ERROR', format('"%s" deve ficar entre %s e %s.', q.texto,
            coalesce(q.configuracao->>'minimo', '0'), coalesce(q.configuracao->>'maximo', 'o máximo')), q.id::text);
        END IF;
        IF n <> round(n, coalesce((q.configuracao->>'casas')::integer, 0)) THEN
          PERFORM app_private.erro('VALIDATION_ERROR', format('"%s" aceita até %s casa(s) decimal(is).', q.texto,
            coalesce(q.configuracao->>'casas', '0')), q.id::text);
        END IF;
        saida := saida || jsonb_build_object(q.id, n);
      WHEN 'escolha_unica' THEN
        IF jsonb_typeof(v) <> 'string' OR NOT opcoes @> jsonb_build_array(v) THEN
          PERFORM app_private.erro('VALIDATION_ERROR', format('Escolha uma das opções de "%s".', q.texto), q.id::text);
        END IF;
        saida := saida || jsonb_build_object(q.id, v);
      WHEN 'escolha_multipla' THEN
        IF jsonb_typeof(v) <> 'array' OR NOT opcoes @> v
           OR (SELECT count(DISTINCT x) <> count(*) FROM jsonb_array_elements(v) x) THEN
          PERFORM app_private.erro('VALIDATION_ERROR', format('Escolha só opções da lista em "%s", sem repetir.', q.texto), q.id::text);
        END IF;
        saida := saida || jsonb_build_object(q.id, v);
      WHEN 'sim_nao' THEN
        IF jsonb_typeof(v) <> 'boolean' THEN
          PERFORM app_private.erro('VALIDATION_ERROR', format('Responda sim ou não em "%s".', q.texto), q.id::text);
        END IF;
        saida := saida || jsonb_build_object(q.id, v);
    END CASE;
  END LOOP;
  RETURN saida;
END $$;

-- Estimativa determinística: mesmas respostas e mesma versão do serviço dão sempre o mesmo valor.
-- Devolve {completa, tipo, valor_centavos, minimo_centavos, maximo_centavos, base[], faltando[], rotulo}.
CREATE FUNCTION app_private.calcular_estimativa(p_s public.servicos, p_respostas jsonb) RETURNS jsonb
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

-- ===========================================================================
-- 4. Catálogo de serviços (RF-084, RF-085, RF-087, RF-088; D8-04 a D8-09, D8-12, D8-22)
-- ===========================================================================
CREATE FUNCTION public.servicos_da_empresa(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['catalogo_servicos.visualizar']);
  RETURN coalesce((SELECT jsonb_agg(app_private.servico_json(s, true) ORDER BY s.ativo DESC, lower(s.nome))
    FROM public.servicos s WHERE s.empresa_id = p_empresa_id), '[]'::jsonb);
END $$;

CREATE FUNCTION public.criar_servico(p_empresa_id uuid, p_dados jsonb, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text));
  anterior jsonb;
  s public.servicos;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_servico', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['catalogo_servicos.alterar']);
  IF NOT (p_dados ? 'nome') OR NOT (p_dados ? 'politica_preco') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o nome e como o preço é informado.', CASE WHEN p_dados ? 'nome' THEN 'politica_preco' ELSE 'nome' END);
  END IF;
  s.empresa_id := p_empresa_id;
  s.validade_dias := 15;
  s.modalidade := 'analise_manual';
  s.exibicao := 'valor';
  s.faixa_percentual := 0;
  s := app_private.aplicar_dados_servico(s, p_dados);
  IF EXISTS (SELECT 1 FROM public.servicos WHERE empresa_id = p_empresa_id AND ativo AND lower(btrim(nome)) = lower(btrim(s.nome))) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Já existe um serviço ativo com esse nome.', 'nome');
  END IF;
  INSERT INTO public.servicos (empresa_id, nome, descricao, categoria_id, politica_preco, preco, duracao_min, validade_dias, modalidade,
    exibicao, faixa_percentual, criado_por)
  VALUES (p_empresa_id, s.nome, s.descricao, s.categoria_id, s.politica_preco, s.preco, s.duracao_min, s.validade_dias, s.modalidade,
    s.exibicao, s.faixa_percentual, usuario) RETURNING * INTO s;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'servicos.criado', 'servicos', s.id, jsonb_build_object('politica_preco', s.politica_preco));
  RETURN app_private.idem_fim(usuario, 'criar_servico', p_operation_key, assinatura, app_private.servico_json(s, true));
END $$;

CREATE FUNCTION public.alterar_servico(p_servico_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_servico_id, p_dados::text, p_expected_version));
  anterior jsonb;
  s public.servicos;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_servico', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.servico_da_empresa_trava(p_servico_id);
  PERFORM app_private.exigir_permissoes(s.empresa_id, usuario, ARRAY['catalogo_servicos.alterar']);
  IF s.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este serviço mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  s := app_private.aplicar_dados_servico(s, p_dados);
  IF s.ativo AND EXISTS (SELECT 1 FROM public.servicos WHERE empresa_id = s.empresa_id AND ativo AND id <> s.id
                          AND lower(btrim(nome)) = lower(btrim(s.nome))) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Já existe um serviço ativo com esse nome.', 'nome');
  END IF;
  UPDATE public.servicos SET nome = s.nome, descricao = s.descricao, categoria_id = s.categoria_id, politica_preco = s.politica_preco,
    preco = s.preco, duracao_min = s.duracao_min, validade_dias = s.validade_dias, modalidade = s.modalidade, exibicao = s.exibicao,
    faixa_percentual = s.faixa_percentual, versao = versao + 1, atualizado_em = now()
   WHERE id = s.id RETURNING * INTO s;
  PERFORM app_private.auditar(s.empresa_id, usuario, 'servicos.alterado', 'servicos', s.id,
    jsonb_build_object('campos', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_dados) k)));
  RETURN app_private.idem_fim(usuario, 'alterar_servico', p_operation_key, assinatura, app_private.servico_json(s, true));
END $$;

CREATE FUNCTION public.definir_servico_ativo(p_servico_id uuid, p_ativo boolean, p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_servico_id, p_ativo, p_expected_version));
  anterior jsonb;
  s public.servicos;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_servico_ativo', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.servico_da_empresa_trava(p_servico_id);
  PERFORM app_private.exigir_permissoes(s.empresa_id, usuario, ARRAY['catalogo_servicos.alterar']);
  IF s.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este serviço mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF s.ativo = p_ativo THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN p_ativo THEN 'O serviço já está ativo.' ELSE 'O serviço já está desativado.' END);
  END IF;
  IF p_ativo AND EXISTS (SELECT 1 FROM public.servicos WHERE empresa_id = s.empresa_id AND ativo AND id <> s.id
                          AND lower(btrim(nome)) = lower(btrim(s.nome))) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Já existe um serviço ativo com esse nome.', 'nome');
  END IF;
  UPDATE public.servicos SET ativo = p_ativo, versao = versao + 1, atualizado_em = now() WHERE id = s.id RETURNING * INTO s;
  PERFORM app_private.auditar(s.empresa_id, usuario, CASE WHEN p_ativo THEN 'servicos.reativado' ELSE 'servicos.desativado' END, 'servicos', s.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'definir_servico_ativo', p_operation_key, assinatura, app_private.servico_json(s, true));
END $$;

-- Substitui as perguntas ativas (D8-06). Pergunta com "id" existente é atualizada; as ausentes são desativadas, e as
-- regras que dependiam delas também. Solicitações já enviadas guardam o retrato do formulário e não mudam.
CREATE FUNCTION public.salvar_formulario_servico(p_servico_id uuid, p_perguntas jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_servico_id, p_perguntas::text, p_expected_version));
  anterior jsonb;
  s public.servicos;
  e jsonb;
  i integer := 0;
  v_id uuid;
  v_tipo text;
  v_texto text;
  v_cfg jsonb;
  v_mantidas uuid[] := ARRAY[]::uuid[];
  v_regras integer;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'salvar_formulario_servico', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.servico_da_empresa_trava(p_servico_id);
  PERFORM app_private.exigir_permissoes(s.empresa_id, usuario, ARRAY['catalogo_servicos.alterar']);
  IF s.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este serviço mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF p_perguntas IS NULL OR jsonb_typeof(p_perguntas) <> 'array' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Perguntas inválidas.', 'perguntas');
  END IF;
  IF jsonb_array_length(p_perguntas) > 15 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O formulário tem no máximo 15 perguntas.', 'perguntas');
  END IF;
  -- Desativa todas antes; as que voltam no pedido são reativadas com os dados novos.
  UPDATE public.servico_perguntas SET ativa = false WHERE servico_id = s.id AND ativa;
  FOR e IN SELECT value FROM jsonb_array_elements(p_perguntas) LOOP
    i := i + 1;
    PERFORM app_private.exigir_chaves(e, ARRAY['id', 'texto', 'ajuda', 'tipo', 'obrigatoria', 'configuracao']);
    v_texto := app_private.ler_texto(e->>'texto', 3, 200, format('perguntas.%s.texto', i), format('A pergunta %s precisa de um texto (3 a 200 caracteres).', i));
    IF app_private.pede_dado_sensivel(v_texto) OR app_private.pede_dado_sensivel(coalesce(e->>'ajuda', '')) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', format('A pergunta %s pede documento ou dado sensível (CPF, RG, cartão, senha). Peça só o necessário para o serviço.', i),
        format('perguntas.%s.texto', i));
    END IF;
    v_tipo := e->>'tipo';
    IF v_tipo IS NULL OR v_tipo NOT IN ('texto_curto', 'texto_longo', 'numero', 'escolha_unica', 'escolha_multipla', 'sim_nao') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', format('Tipo inválido na pergunta %s.', i), format('perguntas.%s.tipo', i));
    END IF;
    v_cfg := coalesce(e->'configuracao', '{}'::jsonb);
    IF jsonb_typeof(v_cfg) <> 'object' THEN
      PERFORM app_private.erro('VALIDATION_ERROR', format('Configuração inválida na pergunta %s.', i), format('perguntas.%s.configuracao', i));
    END IF;
    IF v_tipo IN ('escolha_unica', 'escolha_multipla') THEN
      IF jsonb_typeof(v_cfg->'opcoes') IS DISTINCT FROM 'array' OR jsonb_array_length(v_cfg->'opcoes') NOT BETWEEN 2 AND 10
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_cfg->'opcoes') o WHERE jsonb_typeof(o) <> 'string' OR char_length(btrim(o #>> '{}')) NOT BETWEEN 1 AND 60)
         OR (SELECT count(DISTINCT lower(btrim(o #>> '{}'))) FROM jsonb_array_elements(v_cfg->'opcoes') o) <> jsonb_array_length(v_cfg->'opcoes') THEN
        PERFORM app_private.erro('VALIDATION_ERROR', format('A pergunta %s precisa de 2 a 10 opções diferentes, de 1 a 60 caracteres.', i), format('perguntas.%s.opcoes', i));
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_cfg->'opcoes') o WHERE app_private.pede_dado_sensivel(o #>> '{}')) THEN
        PERFORM app_private.erro('VALIDATION_ERROR', format('As opções da pergunta %s pedem dado sensível.', i), format('perguntas.%s.opcoes', i));
      END IF;
      v_cfg := jsonb_build_object('opcoes', (SELECT jsonb_agg(btrim(o #>> '{}')) FROM jsonb_array_elements(v_cfg->'opcoes') o));
    ELSIF v_tipo = 'numero' THEN
      IF (v_cfg ? 'minimo' AND jsonb_typeof(v_cfg->'minimo') <> 'number') OR (v_cfg ? 'maximo' AND jsonb_typeof(v_cfg->'maximo') <> 'number')
         OR (v_cfg ? 'casas' AND (jsonb_typeof(v_cfg->'casas') <> 'number' OR (v_cfg->>'casas')::numeric NOT IN (0, 1, 2, 3)))
         OR (v_cfg ? 'minimo' AND v_cfg ? 'maximo' AND (v_cfg->>'minimo')::numeric > (v_cfg->>'maximo')::numeric)
         OR (v_cfg ? 'unidade' AND char_length(v_cfg->>'unidade') > 20) THEN
        PERFORM app_private.erro('VALIDATION_ERROR', format('Limites inválidos na pergunta %s (mínimo, máximo, casas de 0 a 3, unidade até 20 caracteres).', i),
          format('perguntas.%s.configuracao', i));
      END IF;
      v_cfg := jsonb_strip_nulls(jsonb_build_object('unidade', nullif(btrim(coalesce(v_cfg->>'unidade', '')), ''), 'minimo', v_cfg->'minimo',
        'maximo', v_cfg->'maximo', 'casas', coalesce(v_cfg->'casas', '0'::jsonb)));
    ELSE
      v_cfg := '{}'::jsonb;
    END IF;
    v_id := app_private.ler_uuid(e->>'id', format('perguntas.%s.id', i));
    IF v_id IS NOT NULL THEN
      IF v_id = ANY (v_mantidas) THEN
        PERFORM app_private.erro('VALIDATION_ERROR', 'Pergunta repetida no formulário.', format('perguntas.%s.id', i));
      END IF;
      UPDATE public.servico_perguntas SET ordem = i, texto = v_texto, ajuda = nullif(btrim(coalesce(e->>'ajuda', '')), ''), tipo = v_tipo,
        obrigatoria = coalesce((e->>'obrigatoria')::boolean, false), configuracao = v_cfg, ativa = true
       WHERE id = v_id AND servico_id = s.id;
      IF NOT FOUND THEN
        PERFORM app_private.erro('NOT_FOUND', 'Pergunta não encontrada neste serviço.', format('perguntas.%s.id', i));
      END IF;
    ELSE
      INSERT INTO public.servico_perguntas (empresa_id, servico_id, ordem, texto, ajuda, tipo, obrigatoria, configuracao)
      VALUES (s.empresa_id, s.id, i, v_texto, nullif(btrim(coalesce(e->>'ajuda', '')), ''), v_tipo, coalesce((e->>'obrigatoria')::boolean, false), v_cfg)
      RETURNING id INTO v_id;
    END IF;
    v_mantidas := v_mantidas || v_id;
  END LOOP;
  -- Regras que dependem de pergunta removida ou que mudou para tipo incompatível deixam de valer.
  UPDATE public.servico_regras r SET ativa = false
   WHERE r.servico_id = s.id AND r.ativa AND r.pergunta_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.servico_perguntas q WHERE q.id = r.pergunta_id AND q.ativa
                      AND q.tipo = CASE r.tipo WHEN 'por_quantidade' THEN 'numero' WHEN 'se_sim' THEN 'sim_nao' ELSE q.tipo END
                      AND (r.tipo <> 'por_opcao' OR q.tipo IN ('escolha_unica', 'escolha_multipla')));
  GET DIAGNOSTICS v_regras = ROW_COUNT;
  UPDATE public.servicos SET versao = versao + 1, atualizado_em = now() WHERE id = s.id RETURNING * INTO s;
  PERFORM app_private.auditar(s.empresa_id, usuario, 'servicos.formulario_salvo', 'servicos', s.id,
    jsonb_build_object('perguntas', jsonb_array_length(p_perguntas), 'regras_desativadas', v_regras));
  RETURN app_private.idem_fim(usuario, 'salvar_formulario_servico', p_operation_key, assinatura,
    app_private.servico_json(s, true) || jsonb_build_object('regras_desativadas', v_regras));
END $$;

-- Substitui as regras ativas (D8-07). Tipos fechados; parâmetros em centavos; nada de fórmula livre.
CREATE FUNCTION public.salvar_regras_servico(p_servico_id uuid, p_regras jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_servico_id, p_regras::text, p_expected_version));
  anterior jsonb;
  s public.servicos;
  e jsonb;
  i integer := 0;
  v_tipo text;
  q public.servico_perguntas;
  v_par jsonb;
  v_pergunta uuid;
  campo text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'salvar_regras_servico', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.servico_da_empresa_trava(p_servico_id);
  PERFORM app_private.exigir_permissoes(s.empresa_id, usuario, ARRAY['catalogo_servicos.alterar']);
  IF s.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este serviço mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF s.politica_preco <> 'por_regras' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Regras de estimativa só existem em serviços com preço calculado por regras.', 'politica_preco');
  END IF;
  IF p_regras IS NULL OR jsonb_typeof(p_regras) <> 'array' OR jsonb_array_length(p_regras) > 30 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Envie de 0 a 30 regras.', 'regras');
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_regras) x WHERE x->>'tipo' = 'minimo') > 1 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Só pode haver um valor mínimo.', 'regras');
  END IF;
  UPDATE public.servico_regras SET ativa = false WHERE servico_id = s.id AND ativa;
  FOR e IN SELECT value FROM jsonb_array_elements(p_regras) LOOP
    i := i + 1;
    campo := format('regras.%s', i);
    PERFORM app_private.exigir_chaves(e, ARRAY['tipo', 'pergunta_id', 'rotulo', 'valor_centavos', 'valor_unitario_centavos', 'valores']);
    v_tipo := e->>'tipo';
    IF v_tipo IS NULL OR v_tipo NOT IN ('valor_base', 'por_quantidade', 'por_opcao', 'se_sim', 'minimo') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', format('Tipo inválido na regra %s.', i), campo);
    END IF;
    v_pergunta := NULL;
    IF v_tipo IN ('por_quantidade', 'por_opcao', 'se_sim') THEN
      v_pergunta := app_private.ler_uuid(e->>'pergunta_id', campo || '.pergunta_id');
      SELECT * INTO q FROM public.servico_perguntas WHERE id = v_pergunta AND servico_id = s.id AND ativa;
      IF NOT FOUND OR (v_tipo = 'por_quantidade' AND q.tipo <> 'numero') OR (v_tipo = 'se_sim' AND q.tipo <> 'sim_nao')
         OR (v_tipo = 'por_opcao' AND q.tipo NOT IN ('escolha_unica', 'escolha_multipla')) THEN
        PERFORM app_private.erro('VALIDATION_ERROR', format('A regra %s precisa de uma pergunta compatível deste serviço (número, escolha ou sim e não).', i),
          campo || '.pergunta_id');
      END IF;
    END IF;
    v_par := CASE v_tipo
      WHEN 'valor_base' THEN jsonb_build_object('valor_centavos', app_private.para_centavos(app_private.centavos(e->'valor_centavos', campo || '.valor_centavos', true, 0)))
      WHEN 'minimo' THEN jsonb_build_object('valor_centavos', app_private.para_centavos(app_private.centavos(e->'valor_centavos', campo || '.valor_centavos', true, 1)))
      WHEN 'se_sim' THEN jsonb_build_object('valor_centavos', app_private.para_centavos(app_private.centavos(e->'valor_centavos', campo || '.valor_centavos', true, 0)))
      WHEN 'por_quantidade' THEN jsonb_build_object('valor_unitario_centavos',
        app_private.para_centavos(app_private.centavos(e->'valor_unitario_centavos', campo || '.valor_unitario_centavos', true, 0)))
      ELSE NULL END;
    IF v_tipo = 'por_opcao' THEN
      IF jsonb_typeof(e->'valores') IS DISTINCT FROM 'object'
         OR EXISTS (SELECT 1 FROM jsonb_each(e->'valores') x WHERE NOT (q.configuracao->'opcoes') @> jsonb_build_array(x.key)
                     OR jsonb_typeof(x.value) <> 'number' OR (x.value #>> '{}')::numeric < 0 OR (x.value #>> '{}')::numeric <> trunc((x.value #>> '{}')::numeric)) THEN
        PERFORM app_private.erro('VALIDATION_ERROR', format('A regra %s precisa de um valor em centavos (inteiro, não negativo) para opções existentes da pergunta.', i), campo || '.valores');
      END IF;
      v_par := jsonb_build_object('valores', e->'valores');
    END IF;
    INSERT INTO public.servico_regras (empresa_id, servico_id, ordem, tipo, pergunta_id, rotulo, parametros)
    VALUES (s.empresa_id, s.id, i, v_tipo, v_pergunta,
      app_private.ler_texto(coalesce(e->>'rotulo', CASE v_tipo WHEN 'minimo' THEN 'Valor mínimo' WHEN 'valor_base' THEN 'Valor base' END), 2, 80,
        campo || '.rotulo', format('Dê um nome à regra %s (2 a 80 caracteres).', i)),
      v_par);
  END LOOP;
  UPDATE public.servicos SET versao = versao + 1, atualizado_em = now() WHERE id = s.id RETURNING * INTO s;
  PERFORM app_private.auditar(s.empresa_id, usuario, 'servicos.regras_salvas', 'servicos', s.id, jsonb_build_object('regras', jsonb_array_length(p_regras)));
  RETURN app_private.idem_fim(usuario, 'salvar_regras_servico', p_operation_key, assinatura, app_private.servico_json(s, true));
END $$;

-- Serviços que o cliente pode pedir (D8-02): só empresa que pode receber pedidos desta conta (vitrine publicada; empresa de
-- teste só para conta fictícia), sem regras nem dados internos.
CREATE FUNCTION public.servicos_para_cliente(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_perfil_cliente(usuario);
  IF NOT app_private.empresa_recebe_pedido(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Empresa não encontrada.');
  END IF;
  RETURN jsonb_build_object(
    'empresa', (SELECT jsonb_build_object('id', e.id, 'nome', e.nome_publico) FROM public.empresas e WHERE e.id = p_empresa_id),
    'horarios', app_private.grade_json(p_empresa_id),
    'servicos', coalesce((SELECT jsonb_agg(app_private.servico_json(s, false) - 'empresa_id' - 'versao' ORDER BY lower(s.nome))
      FROM public.servicos s WHERE s.empresa_id = p_empresa_id AND s.ativo), '[]'::jsonb),
    'aviso', 'A estimativa não é o valor final. Nenhum horário é reservado no envio: a empresa confirma depois.');
END $$;

-- Pré-visualização da estimativa (F4): equipe com acesso ao catálogo ou ao atendimento, ou cliente elegível.
CREATE FUNCTION public.estimar_servico(p_servico_id uuid, p_respostas jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  s public.servicos;
BEGIN
  SELECT * INTO s FROM public.servicos WHERE id = p_servico_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Serviço não encontrado.');
  END IF;
  IF NOT (app_private.tem(s.empresa_id, usuario, 'catalogo_servicos.visualizar') OR app_private.tem(s.empresa_id, usuario, 'orcamentos.visualizar')) THEN
    IF NOT (s.ativo AND app_private.empresa_recebe_pedido(s.empresa_id, usuario)) THEN
      PERFORM app_private.erro('NOT_FOUND', 'Serviço não encontrado.');
    END IF;
  END IF;
  RETURN app_private.calcular_estimativa(s, app_private.validar_respostas(s.id, p_respostas, false));
END $$;

-- ===========================================================================
-- 5. Horários gerais e agenda básica (RF-113 a RF-115; D8-18 a D8-21)
-- ===========================================================================
CREATE FUNCTION app_private.grade_json(p_empresa uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_agg(jsonb_build_object('dia_semana', d, 'intervalos', coalesce((SELECT jsonb_agg(jsonb_build_object('abre', to_char(h.abre, 'HH24:MI'),
      'fecha', to_char(h.fecha, 'HH24:MI')) ORDER BY h.intervalo) FROM public.horarios_empresa h WHERE h.empresa_id = p_empresa AND h.dia_semana = d), '[]'::jsonb))
    ORDER BY d)
  FROM generate_series(0, 6) d
$$;

CREATE FUNCTION public.horarios_empresa(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['agenda.visualizar']);
  RETURN jsonb_build_object('grade', app_private.grade_json(p_empresa_id), 'fuso', 'America/Sao_Paulo');
END $$;

CREATE FUNCTION public.salvar_horarios_empresa(p_empresa_id uuid, p_grade jsonb, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_grade::text));
  anterior jsonb;
  dia jsonb;
  iv jsonb;
  n integer;
  v_dia integer;
  v_abre time;
  v_fecha time;
  v_ant time;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'salvar_horarios_empresa', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['agenda.alterar']);
  IF p_grade IS NULL OR jsonb_typeof(p_grade) <> 'array' OR jsonb_array_length(p_grade) > 7 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Grade de horários inválida.', 'grade');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('horarios|' || p_empresa_id, 0));
  DELETE FROM public.horarios_empresa WHERE empresa_id = p_empresa_id;
  FOR dia IN SELECT value FROM jsonb_array_elements(p_grade) LOOP
    v_dia := (dia->>'dia_semana')::integer;
    IF v_dia IS NULL OR v_dia NOT BETWEEN 0 AND 6 OR jsonb_typeof(dia->'intervalos') IS DISTINCT FROM 'array'
       OR jsonb_array_length(dia->'intervalos') > 2 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Cada dia tem de 0 a 2 intervalos.', 'grade');
    END IF;
    IF EXISTS (SELECT 1 FROM public.horarios_empresa WHERE empresa_id = p_empresa_id AND dia_semana = v_dia) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Dia da semana repetido na grade.', format('dia.%s', v_dia));
    END IF;
    n := 0;
    v_ant := NULL;
    FOR iv IN SELECT value FROM jsonb_array_elements(dia->'intervalos') LOOP
      n := n + 1;
      BEGIN
        v_abre := (iv->>'abre')::time;
        v_fecha := (iv->>'fecha')::time;
      EXCEPTION WHEN others THEN
        PERFORM app_private.erro('VALIDATION_ERROR', 'Horário inválido: use HH:MM.', format('dia.%s', v_dia));
      END;
      IF v_abre IS NULL OR v_fecha IS NULL OR v_abre >= v_fecha OR (v_ant IS NOT NULL AND v_abre < v_ant) THEN
        PERFORM app_private.erro('VALIDATION_ERROR', 'Cada intervalo abre antes de fechar, e o segundo começa depois do primeiro.', format('dia.%s', v_dia));
      END IF;
      INSERT INTO public.horarios_empresa (empresa_id, dia_semana, intervalo, abre, fecha) VALUES (p_empresa_id, v_dia, n, v_abre, v_fecha);
      v_ant := v_fecha;
    END LOOP;
  END LOOP;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'agenda.horarios_salvos', 'empresas', p_empresa_id,
    jsonb_build_object('intervalos', (SELECT count(*) FROM public.horarios_empresa WHERE empresa_id = p_empresa_id)));
  RETURN app_private.idem_fim(usuario, 'salvar_horarios_empresa', p_operation_key, assinatura,
    jsonb_build_object('grade', app_private.grade_json(p_empresa_id)));
END $$;

-- Avisos de horário (D8-21): fora do horário geral e sobreposição com outro horário confirmado. Nunca bloqueiam sozinhos.
CREATE FUNCTION app_private.avisos_horario(p_empresa uuid, p_solicitacao uuid, p_inicio timestamptz, p_fim timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  avisos jsonb := '[]'::jsonb;
  ini timestamp := p_inicio AT TIME ZONE 'America/Sao_Paulo';
  fim timestamp := p_fim AT TIME ZONE 'America/Sao_Paulo';
  conflito record;
BEGIN
  IF ini::date <> (fim - interval '1 microsecond')::date OR NOT EXISTS (
       SELECT 1 FROM public.horarios_empresa h WHERE h.empresa_id = p_empresa AND h.dia_semana = extract(dow FROM ini)::integer
          AND ini::time >= h.abre AND (fim - interval '1 microsecond')::time < h.fecha) THEN
    avisos := avisos || jsonb_build_array(jsonb_build_object('tipo', 'fora_do_horario',
      'mensagem', 'O horário fica fora do horário de atendimento cadastrado para esse dia.'));
  END IF;
  FOR conflito IN SELECT a.inicio, a.fim, s.numero FROM public.agendamentos a JOIN public.solicitacoes_servico s ON s.id = a.solicitacao_id
                   WHERE a.empresa_id = p_empresa AND a.estado = 'confirmado' AND a.solicitacao_id <> p_solicitacao
                     AND a.inicio < p_fim AND a.fim > p_inicio ORDER BY a.inicio LIMIT 5 LOOP
    avisos := avisos || jsonb_build_array(jsonb_build_object('tipo', 'sobreposicao', 'solicitacao_numero', conflito.numero,
      'mensagem', format('Sobrepõe o horário da solicitação nº %s (%s a %s).', conflito.numero,
        to_char(conflito.inicio AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'), to_char(conflito.fim AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'))));
  END LOOP;
  RETURN avisos;
END $$;

-- ===========================================================================
-- 6. Solicitações (RF-089, RF-096, RF-097, RF-113; D8-02, D8-03, D8-19, D8-23, D8-25)
-- ===========================================================================
CREATE FUNCTION app_private.ler_preferencia(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  d jsonb;
  v_data date;
  v_hoje date := app_private.hoje_sp();
  datas jsonb := '[]'::jsonb;
BEGIN
  IF p IS NULL OR p = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Preferência de horário inválida.', 'preferencia');
  END IF;
  PERFORM app_private.exigir_chaves(p, ARRAY['datas', 'turno', 'observacao']);
  IF p ? 'datas' THEN
    IF jsonb_typeof(p->'datas') <> 'array' OR jsonb_array_length(p->'datas') > 3 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Indique até 3 datas.', 'preferencia.datas');
    END IF;
    FOR d IN SELECT value FROM jsonb_array_elements(p->'datas') LOOP
      v_data := app_private.ler_data(d #>> '{}', 'preferencia.datas');
      IF v_data < v_hoje OR v_data > v_hoje + 90 THEN
        PERFORM app_private.erro('VALIDATION_ERROR', 'As datas desejadas vão de hoje até 90 dias à frente.', 'preferencia.datas');
      END IF;
      IF NOT datas @> jsonb_build_array(v_data) THEN datas := datas || jsonb_build_array(v_data); END IF;
    END LOOP;
  END IF;
  IF coalesce(p->>'turno', 'qualquer') NOT IN ('manha', 'tarde', 'noite', 'qualquer') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Turno inválido.', 'preferencia.turno');
  END IF;
  IF char_length(p->>'observacao') > 200 OR app_private.tem_contato(coalesce(p->>'observacao', '')) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A observação tem até 200 caracteres, sem telefone, e-mail ou link.', 'preferencia.observacao');
  END IF;
  RETURN jsonb_build_object('datas', datas, 'turno', coalesce(p->>'turno', 'qualquer'),
    'observacao', nullif(btrim(coalesce(p->>'observacao', '')), ''), 'reserva', false);
END $$;

-- Núcleo comum às solicitações do cliente e da equipe. Devolve a solicitação criada.
CREATE FUNCTION app_private.criar_solicitacao_nucleo(p_s public.servicos, p_origem text, p_cliente_auth text, p_cliente_id uuid,
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

CREATE FUNCTION public.criar_solicitacao(p_servico_id uuid, p_dados jsonb, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_servico_id, p_dados::text));
  anterior jsonb;
  v_nome text;
  s public.servicos;
  sol public.solicitacoes_servico;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_solicitacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  v_nome := app_private.exigir_perfil_cliente(usuario);
  SELECT * INTO s FROM public.servicos WHERE id = p_servico_id;
  IF NOT FOUND OR NOT app_private.empresa_recebe_pedido(s.empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Serviço não encontrado.');
  END IF;
  -- Limites (D8-23), conferidos no banco e sob trava por cliente: abertas por empresa e novas por dia.
  PERFORM pg_advisory_xact_lock(hashtextextended('solicitacao|' || usuario, 0));
  IF (SELECT count(*) FROM public.solicitacoes_servico WHERE empresa_id = s.empresa_id AND cliente_auth_id = usuario
        AND estado IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida')) >= app_private.limite('solicitacoes_abertas_por_empresa') THEN
    PERFORM app_private.erro('STATE_CONFLICT', format('Você já tem %s solicitações abertas nesta empresa. Aguarde a resposta ou cancele uma delas.',
      app_private.limite('solicitacoes_abertas_por_empresa')));
  END IF;
  IF (SELECT count(*) FROM public.solicitacoes_servico WHERE cliente_auth_id = usuario
        AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = app_private.hoje_sp()) >= app_private.limite('solicitacoes_novas_por_dia') THEN
    PERFORM app_private.erro('STATE_CONFLICT', format('Limite de %s solicitações novas por dia atingido. Tente amanhã.', app_private.limite('solicitacoes_novas_por_dia')));
  END IF;
  sol := app_private.criar_solicitacao_nucleo(s, 'plataforma', usuario, NULL, v_nome, coalesce(p_dados, '{}'::jsonb), usuario);
  RETURN app_private.idem_fim(usuario, 'criar_solicitacao', p_operation_key, assinatura, app_private.solicitacao_json(sol.id, true));
END $$;

-- Solicitação registrada pela equipe para um cliente da empresa (balcão ou telefone; D8-03).
CREATE FUNCTION public.criar_solicitacao_interna(p_empresa_id uuid, p_cliente_id uuid, p_servico_id uuid, p_dados jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_cliente_id, p_servico_id, p_dados::text));
  anterior jsonb;
  s public.servicos;
  c public.clientes_empresa;
  sol public.solicitacoes_servico;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_solicitacao_interna', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['orcamentos.criar']);
  SELECT * INTO s FROM public.servicos WHERE id = p_servico_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Serviço não encontrado.', 'servico_id');
  END IF;
  SELECT * INTO c FROM public.clientes_empresa WHERE id = p_cliente_id AND empresa_id = p_empresa_id AND ativo;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Cliente não encontrado.', 'cliente_id');
  END IF;
  sol := app_private.criar_solicitacao_nucleo(s, 'interna', NULL, c.id, c.nome, coalesce(p_dados, '{}'::jsonb), usuario);
  PERFORM app_private.auditar(p_empresa_id, usuario, 'orcamentos.solicitacao_interna', 'solicitacoes_servico', sol.id,
    jsonb_build_object('numero', sol.numero, 'cliente_id', c.id));
  RETURN app_private.idem_fim(usuario, 'criar_solicitacao_interna', p_operation_key, assinatura, app_private.solicitacao_json(sol.id, false));
END $$;

CREATE FUNCTION app_private.versao_json(o public.orcamento_versoes, p_para_cliente boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', o.id, 'numero', o.numero, 'tipo', o.tipo, 'estado', o.estado,
    'estado_exibicao', CASE WHEN o.estado = 'enviada' AND o.valido_ate < app_private.hoje_sp() THEN 'vencida' ELSE o.estado END,
    'subtotal_centavos', app_private.para_centavos(o.subtotal), 'desconto_itens_centavos', app_private.para_centavos(o.desconto_itens),
    'desconto_geral_centavos', app_private.para_centavos(o.desconto_geral), 'total_centavos', app_private.para_centavos(o.total),
    'valido_ate', o.valido_ate, 'prazo_execucao', o.prazo_execucao, 'condicoes', o.condicoes, 'enviada_em', o.enviada_em,
    'aceite', o.aceite, 'recusa', o.recusa, 'versao', o.versao,
    'componentes', coalesce((SELECT jsonb_agg(jsonb_build_object('ordem', c.ordem, 'tipo', c.tipo, 'descricao', c.descricao,
        'quantidade', c.quantidade, 'valor_unitario_centavos', app_private.para_centavos(c.valor_unitario),
        'desconto_centavos', app_private.para_centavos(c.desconto), 'total_centavos', app_private.para_centavos(c.total))
        || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object('variacao_id', c.variacao_id,
             'produto', (SELECT p.nome FROM public.produto_variacoes pv JOIN public.produtos p ON p.id = pv.produto_id WHERE pv.id = c.variacao_id),
             'uso_interno', (SELECT p.finalidade = 'uso_interno' FROM public.produto_variacoes pv JOIN public.produtos p ON p.id = pv.produto_id WHERE pv.id = c.variacao_id)) END
        ORDER BY c.ordem) FROM public.orcamento_componentes c WHERE c.versao_id = o.id), '[]'::jsonb))
  || CASE WHEN p_para_cliente THEN '{}'::jsonb ELSE jsonb_build_object(
    'criada_por', CASE WHEN o.criada_por = 'sistema' THEN 'Regras da empresa' ELSE app_private.nome_da_pessoa(o.criada_por) END,
    'aprovada_por', CASE WHEN o.aprovada_por IS NOT NULL THEN app_private.nome_da_pessoa(o.aprovada_por) END,
    'desconto_percentual', CASE WHEN o.subtotal > 0 THEN round(100 * (o.desconto_itens + o.desconto_geral) / o.subtotal, 2) ELSE 0 END) END
$$;

-- Detalhe da solicitação. Para o cliente: sem notas internas, rascunhos, autores, ligação com o catálogo nem regras (D8-11, D8-14).
CREATE FUNCTION app_private.solicitacao_json(p_id uuid, p_para_cliente boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', s.id, 'empresa_id', s.empresa_id, 'numero', s.numero, 'servico_id', s.servico_id, 'servico', s.servico_nome,
    'empresa', (SELECT e.nome_publico FROM public.empresas e WHERE e.id = s.empresa_id),
    'origem', s.origem, 'cliente_nome', s.cliente_nome, 'relato', s.relato, 'cidade', s.cidade, 'bairro', s.bairro,
    'preferencia', s.preferencia, 'respostas', s.respostas, 'estimativa', s.estimativa, 'estado', s.estado,
    'estado_exibicao', CASE WHEN s.estado IN ('orcamento_enviado', 'revisao_pedida') AND v.valido_ate < app_private.hoje_sp() THEN 'vencido' ELSE s.estado END,
    'aceite', s.aceite, 'motivo_encerramento', s.motivo_encerramento, 'encerrada_em', s.encerrada_em, 'versao', s.versao,
    'criado_em', s.criado_em, 'aguarda_os', s.estado = 'aceita',
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


CREATE FUNCTION app_private.solicitacao_trava(p_id uuid) RETURNS public.solicitacoes_servico
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  s public.solicitacoes_servico;
BEGIN
  SELECT * INTO s FROM public.solicitacoes_servico WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Solicitação não encontrada.');
  END IF;
  RETURN s;
END $$;

-- Quem age sobre a solicitação: 'cliente' (titular, origem plataforma) ou 'equipe' (com a permissão pedida).
CREATE FUNCTION app_private.papel_na_solicitacao(p_s public.solicitacoes_servico, p_usuario text, p_permissao text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF p_s.origem = 'plataforma' AND p_s.cliente_auth_id = p_usuario THEN
    RETURN 'cliente';
  END IF;
  -- Quem não é titular nem da empresa recebe "não encontrada" (não revela que a solicitação existe).
  IF p_permissao IS NOT NULL AND app_private.eh_membro(p_s.empresa_id, p_usuario) THEN
    PERFORM app_private.exigir_permissoes(p_s.empresa_id, p_usuario, ARRAY[p_permissao]);
    RETURN 'equipe';
  END IF;
  PERFORM app_private.erro('NOT_FOUND', 'Solicitação não encontrada.');
  RETURN NULL;
END $$;

CREATE FUNCTION public.solicitacoes_da_empresa(p_empresa_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb, p_limite integer DEFAULT 50,
  p_deslocamento integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_estado text := nullif(p_filtros->>'estado', '');
  v_busca text := nullif(btrim(coalesce(p_filtros->>'busca', '')), '');
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['orcamentos.visualizar']);
  IF p_limite NOT BETWEEN 1 AND 100 OR p_deslocamento < 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Paginação inválida.', 'limite');
  END IF;
  RETURN jsonb_build_object(
    'contagem', (SELECT jsonb_object_agg(estado, n) FROM (SELECT estado, count(*) n FROM public.solicitacoes_servico
                  WHERE empresa_id = p_empresa_id GROUP BY estado) c),
    'total', (SELECT count(*) FROM public.solicitacoes_servico s WHERE s.empresa_id = p_empresa_id
               AND (v_estado IS NULL OR s.estado = v_estado OR (v_estado = 'abertas' AND s.estado IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida')))
               AND (v_busca IS NULL OR s.numero::text = v_busca OR s.cliente_nome ILIKE '%' || v_busca || '%' OR s.servico_nome ILIKE '%' || v_busca || '%')),
    'itens', coalesce((SELECT jsonb_agg(x ORDER BY ord DESC) FROM (
      SELECT jsonb_build_object('id', s.id, 'numero', s.numero, 'servico', s.servico_nome, 'cliente_nome', s.cliente_nome, 'origem', s.origem,
        'estado', s.estado, 'estado_exibicao', CASE WHEN s.estado IN ('orcamento_enviado', 'revisao_pedida') AND v.valido_ate < app_private.hoje_sp() THEN 'vencido' ELSE s.estado END,
        'total_vigente_centavos', app_private.para_centavos(v.total), 'valido_ate', v.valido_ate, 'estimativa', s.estimativa,
        'preferencia', s.preferencia, 'cidade', s.cidade, 'bairro', s.bairro, 'criado_em', s.criado_em,
        'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim) FROM public.agendamentos a WHERE a.solicitacao_id = s.id AND a.estado = 'confirmado'),
        'tem_rascunho', EXISTS (SELECT 1 FROM public.orcamento_versoes r WHERE r.solicitacao_id = s.id AND r.estado = 'rascunho'),
        'aguardando_aprovacao', EXISTS (SELECT 1 FROM public.orcamento_versoes r WHERE r.solicitacao_id = s.id AND r.estado = 'aguardando_aprovacao')) AS x,
        s.criado_em AS ord
        FROM public.solicitacoes_servico s LEFT JOIN public.orcamento_versoes v ON v.id = s.versao_vigente_id
       WHERE s.empresa_id = p_empresa_id
         AND (v_estado IS NULL OR s.estado = v_estado OR (v_estado = 'abertas' AND s.estado IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida')))
         AND (v_busca IS NULL OR s.numero::text = v_busca OR s.cliente_nome ILIKE '%' || v_busca || '%' OR s.servico_nome ILIKE '%' || v_busca || '%')
       ORDER BY s.criado_em DESC LIMIT p_limite OFFSET p_deslocamento) q), '[]'::jsonb));
END $$;

CREATE FUNCTION public.solicitacao_detalhe(p_solicitacao_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_empresa uuid;
BEGIN
  SELECT empresa_id INTO v_empresa FROM public.solicitacoes_servico WHERE id = p_solicitacao_id;
  IF v_empresa IS NULL THEN
    PERFORM app_private.erro('NOT_FOUND', 'Solicitação não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(v_empresa, usuario, ARRAY['orcamentos.visualizar']);
  RETURN app_private.solicitacao_json(p_solicitacao_id, false) || jsonb_build_object(
    'pode', jsonb_build_object('criar', app_private.tem(v_empresa, usuario, 'orcamentos.criar'), 'aprovar', app_private.tem(v_empresa, usuario, 'orcamentos.aprovar'),
      'cancelar', app_private.tem(v_empresa, usuario, 'orcamentos.cancelar'), 'agenda', app_private.tem(v_empresa, usuario, 'agenda.alterar')),
    'limite_desconto_percentual', app_private.limite_desconto(v_empresa, usuario));
END $$;

CREATE FUNCTION public.minhas_solicitacoes() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'numero', s.numero, 'empresa', e.nome_publico, 'empresa_id', s.empresa_id,
      'servico', s.servico_nome, 'estado', s.estado,
      'estado_exibicao', CASE WHEN s.estado IN ('orcamento_enviado', 'revisao_pedida') AND v.valido_ate < app_private.hoje_sp() THEN 'vencido' ELSE s.estado END,
      'total_vigente_centavos', CASE WHEN v.estado IN ('enviada', 'aceita') THEN app_private.para_centavos(v.total) END,
      'valido_ate', v.valido_ate, 'criado_em', s.criado_em,
      'horario', (SELECT jsonb_build_object('inicio', a.inicio, 'fim', a.fim) FROM public.agendamentos a WHERE a.solicitacao_id = s.id AND a.estado = 'confirmado'))
      ORDER BY s.criado_em DESC)
    FROM (SELECT * FROM public.solicitacoes_servico WHERE cliente_auth_id = usuario ORDER BY criado_em DESC LIMIT 100) s
    JOIN public.empresas e ON e.id = s.empresa_id
    LEFT JOIN public.orcamento_versoes v ON v.id = s.versao_vigente_id), '[]'::jsonb);
END $$;

CREATE FUNCTION public.minha_solicitacao(p_solicitacao_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.solicitacoes_servico WHERE id = p_solicitacao_id AND cliente_auth_id = usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Solicitação não encontrada.');
  END IF;
  RETURN app_private.solicitacao_json(p_solicitacao_id, true);
END $$;

CREATE FUNCTION public.assumir_solicitacao(p_solicitacao_id uuid, p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_expected_version));
  anterior jsonb;
  s public.solicitacoes_servico;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'assumir_solicitacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.solicitacao_trava(p_solicitacao_id);
  PERFORM app_private.exigir_permissoes(s.empresa_id, usuario, ARRAY['orcamentos.criar']);
  IF s.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'A solicitação mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF s.estado <> 'nova' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só solicitações novas são assumidas.');
  END IF;
  UPDATE public.solicitacoes_servico SET estado = 'em_analise', versao = versao + 1, atualizado_em = now() WHERE id = s.id RETURNING * INTO s;
  PERFORM app_private.evento_solicitacao(s, 'em_analise', 'equipe', usuario, NULL, '{}'::jsonb, true);
  RETURN app_private.idem_fim(usuario, 'assumir_solicitacao', p_operation_key, assinatura, app_private.solicitacao_json(s.id, false));
END $$;

-- ===========================================================================
-- 7. Orçamento: rascunho, envio, aprovação (RF-086, RF-091, RF-092, RF-094, RF-098; D8-10 a D8-13)
-- ===========================================================================
CREATE FUNCTION app_private.gravar_componentes(p_v public.orcamento_versoes, p_componentes jsonb, p_desconto_geral numeric)
RETURNS public.orcamento_versoes LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  e jsonb;
  i integer := 0;
  v_tipo text;
  v_qtd numeric;
  v_unit numeric;
  v_desc numeric;
  v_var uuid;
  v public.orcamento_versoes;
  campo text;
BEGIN
  IF p_componentes IS NULL OR jsonb_typeof(p_componentes) <> 'array' OR jsonb_array_length(p_componentes) NOT BETWEEN 1 AND 50 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O orçamento precisa de 1 a 50 itens.', 'componentes');
  END IF;
  DELETE FROM public.orcamento_componentes WHERE versao_id = p_v.id;
  FOR e IN SELECT value FROM jsonb_array_elements(p_componentes) LOOP
    i := i + 1;
    campo := format('componentes.%s', i);
    IF e ? 'total_centavos' OR e ? 'total' THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'O total é calculado pelo sistema.', campo);
    END IF;
    PERFORM app_private.exigir_chaves(e, ARRAY['tipo', 'descricao', 'quantidade', 'valor_unitario_centavos', 'desconto_centavos', 'variacao_id']);
    v_tipo := e->>'tipo';
    IF v_tipo IS NULL OR v_tipo NOT IN ('material', 'mao_de_obra', 'deslocamento', 'outro') THEN
      PERFORM app_private.erro('VALIDATION_ERROR', format('Tipo inválido no item %s.', i), campo || '.tipo');
    END IF;
    BEGIN
      v_qtd := (e->>'quantidade')::numeric;
    EXCEPTION WHEN others THEN v_qtd := NULL;
    END;
    IF v_qtd IS NULL OR v_qtd <= 0 OR v_qtd > 999999 OR v_qtd <> round(v_qtd, 3) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', format('Quantidade inválida no item %s (até 3 casas decimais).', i), campo || '.quantidade');
    END IF;
    v_unit := app_private.centavos(e->'valor_unitario_centavos', campo || '.valor_unitario_centavos', true, 0);
    v_desc := coalesce(app_private.centavos(e->'desconto_centavos', campo || '.desconto_centavos', false, 0), 0);
    IF v_desc > round(v_qtd * v_unit, 2) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', format('O desconto do item %s é maior que o valor do item.', i), campo || '.desconto_centavos');
    END IF;
    v_var := app_private.ler_uuid(e->>'variacao_id', campo || '.variacao_id');
    IF v_var IS NOT NULL THEN
      IF v_tipo <> 'material' THEN
        PERFORM app_private.erro('VALIDATION_ERROR', 'Só itens de material podem ser ligados ao catálogo.', campo || '.variacao_id');
      END IF;
      PERFORM app_private.variacao_da_empresa(p_v.empresa_id, v_var);
    END IF;
    INSERT INTO public.orcamento_componentes (empresa_id, versao_id, ordem, tipo, descricao, quantidade, valor_unitario, desconto, total, variacao_id)
    VALUES (p_v.empresa_id, p_v.id, i, v_tipo,
      app_private.ler_texto(e->>'descricao', 2, 120, campo || '.descricao', format('Descreva o item %s (2 a 120 caracteres).', i)),
      v_qtd, v_unit, v_desc, round(v_qtd * v_unit, 2) - v_desc, v_var);
  END LOOP;
  UPDATE public.orcamento_versoes o SET
    subtotal = (SELECT sum(round(quantidade * valor_unitario, 2)) FROM public.orcamento_componentes WHERE versao_id = o.id),
    desconto_itens = (SELECT sum(desconto) FROM public.orcamento_componentes WHERE versao_id = o.id),
    desconto_geral = 0, total = (SELECT sum(total) FROM public.orcamento_componentes WHERE versao_id = o.id),
    versao = versao + 1, atualizado_em = now()
   WHERE id = p_v.id RETURNING * INTO v;
  IF coalesce(p_desconto_geral, 0) > v.total THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O desconto geral é maior que o valor do orçamento.', 'desconto_geral_centavos');
  END IF;
  UPDATE public.orcamento_versoes SET desconto_geral = coalesce(p_desconto_geral, 0), total = total - coalesce(p_desconto_geral, 0)
   WHERE id = v.id RETURNING * INTO v;
  RETURN v;
END $$;

CREATE FUNCTION public.salvar_rascunho_orcamento(p_solicitacao_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_dados::text, p_expected_version));
  anterior jsonb;
  s public.solicitacoes_servico;
  v public.orcamento_versoes;
  v_validade date;
  v_hoje date := app_private.hoje_sp();
  v_dias integer;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'salvar_rascunho_orcamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.solicitacao_trava(p_solicitacao_id);
  PERFORM app_private.exigir_permissoes(s.empresa_id, usuario, ARRAY['orcamentos.criar']);
  IF s.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'A solicitação mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF s.estado NOT IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta solicitação está encerrada e não recebe novo orçamento.');
  END IF;
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['componentes', 'desconto_geral_centavos', 'valido_ate', 'prazo_execucao', 'condicoes']);
  SELECT validade_dias INTO v_dias FROM public.servicos WHERE id = s.servico_id;
  v_validade := coalesce(app_private.ler_data(p_dados->>'valido_ate', 'valido_ate'), v_hoje + v_dias);
  IF v_validade < v_hoje OR v_validade > v_hoje + 90 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A validade vai de hoje até 90 dias à frente.', 'valido_ate');
  END IF;
  IF char_length(p_dados->>'prazo_execucao') > 120 OR char_length(p_dados->>'condicoes') > 1000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Prazo até 120 caracteres; condições até 1.000.', 'condicoes');
  END IF;
  SELECT * INTO v FROM public.orcamento_versoes WHERE solicitacao_id = s.id AND estado IN ('rascunho', 'aguardando_aprovacao') FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.orcamento_versoes (empresa_id, solicitacao_id, numero, tipo, valido_ate, criada_por)
    VALUES (s.empresa_id, s.id, coalesce((SELECT max(numero) FROM public.orcamento_versoes WHERE solicitacao_id = s.id), 0) + 1, 'manual', v_validade, usuario)
    RETURNING * INTO v;
  END IF;
  -- Editar uma versão que aguardava aprovação devolve para rascunho: a aprovação vale para o conteúdo aprovado.
  UPDATE public.orcamento_versoes SET estado = 'rascunho', valido_ate = v_validade, prazo_execucao = nullif(btrim(coalesce(p_dados->>'prazo_execucao', '')), ''),
    condicoes = nullif(btrim(coalesce(p_dados->>'condicoes', '')), ''), criada_por = usuario, aprovada_por = NULL
   WHERE id = v.id RETURNING * INTO v;
  v := app_private.gravar_componentes(v, p_dados->'componentes', coalesce(app_private.centavos(p_dados->'desconto_geral_centavos', 'desconto_geral_centavos', false, 0), 0));
  IF s.estado = 'nova' THEN
    UPDATE public.solicitacoes_servico SET estado = 'em_analise', versao = versao + 1, atualizado_em = now() WHERE id = s.id RETURNING * INTO s;
    PERFORM app_private.evento_solicitacao(s, 'em_analise', 'equipe', usuario, NULL, '{}'::jsonb, true);
  ELSE
    UPDATE public.solicitacoes_servico SET versao = versao + 1, atualizado_em = now() WHERE id = s.id;
  END IF;
  RETURN app_private.idem_fim(usuario, 'salvar_rascunho_orcamento', p_operation_key, assinatura, app_private.versao_json(v, false));
END $$;

-- Coloca a versão como vigente: a anterior enviada vira substituída e não pode mais ser aceita (RN-037, C-10).
CREATE FUNCTION app_private.publicar_versao(p_s public.solicitacoes_servico, p_v public.orcamento_versoes, p_usuario text, p_aprovador text)
RETURNS public.orcamento_versoes LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v public.orcamento_versoes;
  s public.solicitacoes_servico;
  v_ant integer;
BEGIN
  IF p_v.valido_ate < app_private.hoje_sp() THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A validade desta versão já passou. Ajuste a data antes de enviar.', 'valido_ate');
  END IF;
  SELECT numero INTO v_ant FROM public.orcamento_versoes WHERE solicitacao_id = p_s.id AND estado = 'enviada';
  UPDATE public.orcamento_versoes SET estado = 'substituida', versao = versao + 1, atualizado_em = now()
   WHERE solicitacao_id = p_s.id AND estado = 'enviada';
  UPDATE public.orcamento_versoes SET estado = 'enviada', enviada_em = now(), aprovada_por = p_aprovador, versao = versao + 1, atualizado_em = now()
   WHERE id = p_v.id RETURNING * INTO v;
  UPDATE public.solicitacoes_servico SET estado = 'orcamento_enviado', versao_vigente_id = v.id, versao = versao + 1, atualizado_em = now()
   WHERE id = p_s.id RETURNING * INTO s;
  PERFORM app_private.evento_solicitacao(s, 'versao_enviada', 'equipe', p_usuario, NULL,
    jsonb_build_object('versao', v.numero, 'total_centavos', app_private.para_centavos(v.total), 'valido_ate', v.valido_ate, 'substituiu', v_ant), true);
  PERFORM app_private.auditar(s.empresa_id, p_usuario, 'orcamentos.enviado', 'orcamento_versoes', v.id,
    jsonb_build_object('solicitacao', s.numero, 'versao', v.numero, 'total_centavos', app_private.para_centavos(v.total), 'substituiu', v_ant,
      'aprovado_por_outra_pessoa', p_aprovador IS DISTINCT FROM p_usuario));
  RETURN v;
END $$;

CREATE FUNCTION app_private.desconto_cabe(p_v public.orcamento_versoes, p_usuario text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE WHEN p_v.desconto_itens + p_v.desconto_geral = 0 THEN true
              WHEN app_private.limite_desconto(p_v.empresa_id, p_usuario) IS NULL THEN true
              ELSE 100 * (p_v.desconto_itens + p_v.desconto_geral) / nullif(p_v.subtotal, 0) <= app_private.limite_desconto(p_v.empresa_id, p_usuario) END
$$;

-- Envio (D8-10): com orcamentos.aprovar e desconto dentro do limite do perfil, envia direto; senão, aguarda aprovação.
CREATE FUNCTION public.enviar_orcamento(p_versao_id uuid, p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_versao_id, p_expected_version));
  anterior jsonb;
  v public.orcamento_versoes;
  s public.solicitacoes_servico;
  v_direto boolean;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'enviar_orcamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO v FROM public.orcamento_versoes WHERE id = p_versao_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Versão não encontrada.');
  END IF;
  s := app_private.solicitacao_trava(v.solicitacao_id);
  SELECT * INTO v FROM public.orcamento_versoes WHERE id = p_versao_id FOR UPDATE;
  PERFORM app_private.exigir_permissoes(s.empresa_id, usuario, ARRAY['orcamentos.criar']);
  IF v.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'O rascunho mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF v.estado <> 'rascunho' THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE v.estado WHEN 'aguardando_aprovacao' THEN 'Esta versão já aguarda aprovação.' ELSE 'Esta versão já foi enviada.' END);
  END IF;
  IF s.estado NOT IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta solicitação está encerrada.');
  END IF;
  v_direto := app_private.tem(s.empresa_id, usuario, 'orcamentos.aprovar') AND app_private.desconto_cabe(v, usuario);
  IF v_direto THEN
    v := app_private.publicar_versao(s, v, usuario, usuario);
  ELSE
    UPDATE public.orcamento_versoes SET estado = 'aguardando_aprovacao', versao = versao + 1, atualizado_em = now() WHERE id = v.id RETURNING * INTO v;
    PERFORM app_private.evento_solicitacao(s, 'aguardando_aprovacao', 'equipe', usuario, NULL,
      jsonb_build_object('versao', v.numero, 'motivo', CASE WHEN app_private.desconto_cabe(v, usuario) THEN 'perfil sem aprovação' ELSE 'desconto acima do limite do perfil' END), false);
  END IF;
  RETURN app_private.idem_fim(usuario, 'enviar_orcamento', p_operation_key, assinatura, app_private.versao_json(v, false));
END $$;

CREATE FUNCTION public.aprovar_orcamento(p_versao_id uuid, p_expected_version integer, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_versao_id, p_expected_version));
  anterior jsonb;
  v public.orcamento_versoes;
  s public.solicitacoes_servico;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'aprovar_orcamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO v FROM public.orcamento_versoes WHERE id = p_versao_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Versão não encontrada.');
  END IF;
  s := app_private.solicitacao_trava(v.solicitacao_id);
  SELECT * INTO v FROM public.orcamento_versoes WHERE id = p_versao_id FOR UPDATE;
  PERFORM app_private.exigir_permissoes(s.empresa_id, usuario, ARRAY['orcamentos.aprovar']);
  IF v.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'A versão mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF v.estado <> 'aguardando_aprovacao' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta versão não está aguardando aprovação.');
  END IF;
  IF NOT app_private.desconto_cabe(v, usuario) THEN
    PERFORM app_private.erro('DISCOUNT_EXCEEDS_LIMIT', 'O desconto desta versão passa do limite do seu perfil. Peça a aprovação do proprietário.');
  END IF;
  IF s.estado NOT IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta solicitação está encerrada.');
  END IF;
  v := app_private.publicar_versao(s, v, v.criada_por, usuario);
  RETURN app_private.idem_fim(usuario, 'aprovar_orcamento', p_operation_key, assinatura, app_private.versao_json(v, false));
END $$;

-- ===========================================================================
-- 8. Negociação, aceite, recusa e cancelamento (RF-099 a RF-101; D8-13 a D8-16, D8-24)
-- ===========================================================================
CREATE FUNCTION public.registrar_mensagem(p_solicitacao_id uuid, p_texto text, p_interna boolean, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_texto, p_interna));
  anterior jsonb;
  s public.solicitacoes_servico;
  papel text;
  v_texto text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_mensagem', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.solicitacao_trava(p_solicitacao_id);
  papel := app_private.papel_na_solicitacao(s, usuario, 'orcamentos.criar');
  IF papel = 'cliente' AND coalesce(p_interna, false) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Notas internas são só da empresa.');
  END IF;
  v_texto := app_private.ler_texto(p_texto, 1, 1000, 'texto', 'Escreva a mensagem (até 1.000 caracteres).');
  IF NOT coalesce(p_interna, false) AND s.estado IN ('recusada', 'cancelada') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta solicitação está encerrada.');
  END IF;
  PERFORM app_private.evento_solicitacao(s, CASE WHEN coalesce(p_interna, false) THEN 'nota_interna' ELSE 'mensagem' END, papel, usuario, v_texto,
    '{}'::jsonb, NOT coalesce(p_interna, false));
  RETURN app_private.idem_fim(usuario, 'registrar_mensagem', p_operation_key, assinatura,
    app_private.solicitacao_json(s.id, papel = 'cliente'));
END $$;

CREATE FUNCTION public.pedir_revisao(p_solicitacao_id uuid, p_texto text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_texto));
  anterior jsonb;
  s public.solicitacoes_servico;
  papel text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'pedir_revisao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.solicitacao_trava(p_solicitacao_id);
  papel := app_private.papel_na_solicitacao(s, usuario, CASE WHEN s.origem = 'interna' THEN 'orcamentos.criar' END);
  IF s.estado NOT IN ('orcamento_enviado', 'revisao_pedida') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só é possível pedir revisão de um orçamento enviado.');
  END IF;
  UPDATE public.solicitacoes_servico SET estado = 'revisao_pedida', versao = versao + 1, atualizado_em = now() WHERE id = s.id RETURNING * INTO s;
  PERFORM app_private.evento_solicitacao(s, 'revisao_pedida', papel, usuario,
    app_private.ler_texto(p_texto, 5, 1000, 'texto', 'Explique o que precisa mudar (5 a 1.000 caracteres).'), '{}'::jsonb, true);
  RETURN app_private.idem_fim(usuario, 'pedir_revisao', p_operation_key, assinatura, app_private.solicitacao_json(s.id, papel = 'cliente'));
END $$;

-- Aceite (RF-100; D8-13, D8-15): só a versão vigente, enviada e na validade. Guarda o retrato do que foi exibido, inclusive
-- o horário confirmado naquele momento. Cria ou reaproveita o cliente da empresa (como D6-11). Nada de OS, título ou estoque.
CREATE FUNCTION public.aceitar_orcamento(p_solicitacao_id uuid, p_versao_id uuid, p_condicoes_aceitas boolean, p_operation_key text) RETURNS jsonb
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
    'servico', s.servico_nome, 'relato', s.relato);
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
  PERFORM app_private.evento_solicitacao(s, 'aceita', papel, usuario, NULL,
    jsonb_build_object('versao', v.numero, 'total_centavos', app_private.para_centavos(v.total), 'aguarda_os', true), true);
  PERFORM app_private.auditar(s.empresa_id, usuario, 'orcamentos.aceito', 'orcamento_versoes', v.id,
    jsonb_build_object('solicitacao', s.numero, 'versao', v.numero, 'total_centavos', app_private.para_centavos(v.total), 'por', papel));
  RETURN app_private.idem_fim(usuario, 'aceitar_orcamento', p_operation_key, assinatura, app_private.solicitacao_json(s.id, papel = 'cliente'));
END $$;

CREATE FUNCTION app_private.encerrar_solicitacao(p_s public.solicitacoes_servico, p_estado text, p_motivo text) RETURNS public.solicitacoes_servico
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  s public.solicitacoes_servico;
BEGIN
  UPDATE public.orcamento_versoes SET estado = 'cancelada', versao = versao + 1, atualizado_em = now()
   WHERE solicitacao_id = p_s.id AND estado IN ('rascunho', 'aguardando_aprovacao', 'enviada');
  UPDATE public.agendamentos SET estado = 'cancelado', encerrado_em = now() WHERE solicitacao_id = p_s.id AND estado = 'confirmado';
  UPDATE public.solicitacoes_servico SET estado = p_estado, motivo_encerramento = p_motivo, encerrada_em = now(), versao = versao + 1, atualizado_em = now()
   WHERE id = p_s.id RETURNING * INTO s;
  RETURN s;
END $$;

-- Recusa (RF-101; D8-16): pelo cliente (ou pela equipe, numa solicitação interna). Encerra sem nenhuma cobrança.
CREATE FUNCTION public.recusar_orcamento(p_solicitacao_id uuid, p_versao_id uuid, p_motivo jsonb, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_versao_id, p_motivo::text));
  anterior jsonb;
  s public.solicitacoes_servico;
  v public.orcamento_versoes;
  papel text;
  v_opcao text := coalesce(p_motivo->>'opcao', 'outro');
  v_texto text := nullif(btrim(coalesce(p_motivo->>'texto', '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'recusar_orcamento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  s := app_private.solicitacao_trava(p_solicitacao_id);
  papel := app_private.papel_na_solicitacao(s, usuario, CASE WHEN s.origem = 'interna' THEN 'orcamentos.aprovar' END);
  IF s.estado NOT IN ('orcamento_enviado', 'revisao_pedida') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Não há orçamento disponível para recusar.');
  END IF;
  SELECT * INTO v FROM public.orcamento_versoes WHERE id = p_versao_id AND solicitacao_id = s.id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Versão não encontrada.');
  END IF;
  IF v.id IS DISTINCT FROM s.versao_vigente_id OR v.estado <> 'enviada' THEN
    PERFORM app_private.erro('QUOTE_VERSION_STALE', 'Esta versão do orçamento foi substituída. Veja a versão atual.');
  END IF;
  IF v_opcao NOT IN ('preco', 'prazo', 'desisti', 'outra_empresa', 'outro') OR char_length(v_texto) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Motivo inválido (texto até 300 caracteres).', 'motivo');
  END IF;
  UPDATE public.orcamento_versoes SET estado = 'recusada', recusa = jsonb_build_object('opcao', v_opcao, 'texto', v_texto, 'em', now(), 'por', papel),
    versao = versao + 1, atualizado_em = now() WHERE id = v.id;
  s := app_private.encerrar_solicitacao(s, 'recusada', left(coalesce(v_texto, v_opcao), 300));
  PERFORM app_private.evento_solicitacao(s, 'recusada', papel, usuario, v_texto, jsonb_build_object('versao', v.numero, 'opcao', v_opcao), true);
  PERFORM app_private.auditar(s.empresa_id, usuario, 'orcamentos.recusado', 'orcamento_versoes', v.id, jsonb_build_object('solicitacao', s.numero, 'opcao', v_opcao));
  RETURN app_private.idem_fim(usuario, 'recusar_orcamento', p_operation_key, assinatura, app_private.solicitacao_json(s.id, papel = 'cliente'));
END $$;

-- Cancelamento antes do aceite (D8-16): o cliente cancela a própria; a empresa (orcamentos.cancelar) recusa ou cancela com
-- motivo visível ao cliente. Depois do aceite, o cancelamento é do M09 (custos justificados e contestação, sem cobrança automática).
CREATE FUNCTION public.cancelar_solicitacao(p_solicitacao_id uuid, p_motivo text, p_operation_key text) RETURNS jsonb
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
    PERFORM app_private.erro('STATE_CONFLICT', 'O orçamento já foi aceito: o cancelamento será tratado com a ordem de serviço (próxima etapa).');
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

-- ===========================================================================
-- 9. Confirmação de horário pela empresa (RF-114; D8-20, D8-21)
-- ===========================================================================
-- Sem p_aceitar_avisos, devolve os avisos e não grava nada. Com avisos aceitos, grava o horário e o registro do aviso.
-- Depois do aceite do orçamento, só é possível definir o primeiro horário; trocar é reagendamento (M09).
CREATE FUNCTION public.confirmar_horario(p_solicitacao_id uuid, p_inicio timestamptz, p_duracao_min integer, p_aceitar_avisos boolean,
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
  IF s.estado = 'aceita' AND v_ant.id IS NOT NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O orçamento já foi aceito com este horário. A troca de horário depois do aceite é o reagendamento da próxima etapa.');
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

CREATE FUNCTION public.agenda_basica(p_empresa_id uuid, p_de date DEFAULT NULL, p_ate date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  v_de date := coalesce(p_de, app_private.hoje_sp());
  v_ate date := coalesce(p_ate, coalesce(p_de, app_private.hoje_sp()) + 13);
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['agenda.visualizar']);
  IF v_ate < v_de OR v_ate - v_de > 62 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha um período de até 62 dias.', 'ate');
  END IF;
  RETURN jsonb_build_object('periodo', jsonb_build_object('de', v_de, 'ate', v_ate), 'grade', app_private.grade_json(p_empresa_id),
    'confirmados', coalesce((SELECT jsonb_agg(jsonb_build_object('solicitacao_id', s.id, 'numero', s.numero, 'servico', s.servico_nome,
        'cliente_nome', s.cliente_nome, 'estado', s.estado, 'inicio', a.inicio, 'fim', a.fim, 'avisos', a.avisos) ORDER BY a.inicio)
      FROM public.agendamentos a JOIN public.solicitacoes_servico s ON s.id = a.solicitacao_id
     WHERE a.empresa_id = p_empresa_id AND a.estado = 'confirmado'
       AND (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_de AND v_ate), '[]'::jsonb),
    'sem_horario', coalesce((SELECT jsonb_agg(jsonb_build_object('solicitacao_id', s.id, 'numero', s.numero, 'servico', s.servico_nome,
        'cliente_nome', s.cliente_nome, 'estado', s.estado, 'preferencia', s.preferencia) ORDER BY s.criado_em)
      FROM public.solicitacoes_servico s WHERE s.empresa_id = p_empresa_id
       AND s.estado IN ('nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida', 'aceita')
       AND NOT EXISTS (SELECT 1 FROM public.agendamentos a WHERE a.solicitacao_id = s.id AND a.estado = 'confirmado')), '[]'::jsonb),
    'aviso', 'Agenda geral da empresa. Agenda por funcionário, bloqueios e folgas ficam para uma etapa futura.');
END $$;

-- ===========================================================================
-- 10. Limites pela CK (D8-23) e conferência de consistência
-- ===========================================================================
CREATE FUNCTION public.ck_limites() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.exigir_usuario();
  IF NOT (SELECT authz.eh_ck_admin()) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só a administração CK vê os limites da plataforma.');
  END IF;
  RETURN (SELECT jsonb_agg(jsonb_build_object('chave', chave, 'valor', valor, 'minimo', minimo, 'maximo', maximo, 'descricao', descricao,
    'atualizado_em', atualizado_em) ORDER BY chave) FROM app_private.limites_plataforma);
END $$;

-- Alterar um limite muda só quantas solicitações cabem; não dá acesso a dado de cliente nenhum.
CREATE FUNCTION public.ck_definir_limite(p_chave text, p_valor integer, p_motivo text, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_chave, p_valor, p_motivo));
  anterior jsonb;
  l app_private.limites_plataforma;
  v_antes integer;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'ck_definir_limite', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  IF NOT (SELECT authz.eh_ck_admin()) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só a administração CK altera os limites da plataforma.');
  END IF;
  SELECT * INTO l FROM app_private.limites_plataforma WHERE chave = p_chave FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Limite desconhecido.', 'chave');
  END IF;
  IF p_valor IS NULL OR p_valor NOT BETWEEN l.minimo AND l.maximo THEN
    PERFORM app_private.erro('VALIDATION_ERROR', format('O valor vai de %s a %s.', l.minimo, l.maximo), 'valor');
  END IF;
  v_antes := l.valor;
  UPDATE app_private.limites_plataforma SET valor = p_valor, atualizado_por = usuario, atualizado_em = now() WHERE chave = p_chave RETURNING * INTO l;
  PERFORM app_private.auditar(NULL, usuario, 'ck.limite_alterado', 'limites_plataforma', NULL,
    jsonb_build_object('chave', p_chave, 'antes', v_antes, 'depois', p_valor,
      'motivo', app_private.ler_texto(p_motivo, 10, 300, 'motivo', 'Explique a mudança (10 a 300 caracteres).')));
  RETURN app_private.idem_fim(usuario, 'ck_definir_limite', p_operation_key, assinatura, jsonb_build_object('chave', l.chave, 'valor', l.valor));
END $$;

-- Consistência (critério "inconsistência entre orçamento aceito e histórico"): lista vazia = tudo certo.
CREATE FUNCTION app_private.reconciliacao_orcamentos(p_empresa uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'aceitas_sem_versao_aceita', (SELECT count(*) FROM public.solicitacoes_servico s WHERE s.empresa_id = p_empresa AND s.estado = 'aceita'
       AND NOT EXISTS (SELECT 1 FROM public.orcamento_versoes v WHERE v.id = s.versao_vigente_id AND v.estado = 'aceita')),
    'versoes_aceitas_fora_de_solicitacao_aceita', (SELECT count(*) FROM public.orcamento_versoes v JOIN public.solicitacoes_servico s ON s.id = v.solicitacao_id
       WHERE v.empresa_id = p_empresa AND v.estado = 'aceita' AND (s.estado <> 'aceita' OR s.versao_vigente_id <> v.id)),
    'retrato_diferente_da_versao', (SELECT count(*) FROM public.orcamento_versoes v WHERE v.empresa_id = p_empresa AND v.estado = 'aceita'
       AND ((v.aceite->>'total_centavos')::bigint IS DISTINCT FROM app_private.para_centavos(v.total)
         OR jsonb_array_length(v.aceite->'componentes') <> (SELECT count(*) FROM public.orcamento_componentes c WHERE c.versao_id = v.id))),
    'totais_divergentes', (SELECT count(*) FROM public.orcamento_versoes v WHERE v.empresa_id = p_empresa
       AND v.subtotal <> coalesce((SELECT sum(round(c.quantidade * c.valor_unitario, 2)) FROM public.orcamento_componentes c WHERE c.versao_id = v.id), 0)
       AND v.estado <> 'rascunho'),
    'vigente_nao_enviada', (SELECT count(*) FROM public.solicitacoes_servico s JOIN public.orcamento_versoes v ON v.id = s.versao_vigente_id
       WHERE s.empresa_id = p_empresa AND s.estado IN ('orcamento_enviado', 'revisao_pedida') AND v.estado <> 'enviada'),
    'horarios_em_encerradas', (SELECT count(*) FROM public.agendamentos a JOIN public.solicitacoes_servico s ON s.id = a.solicitacao_id
       WHERE a.empresa_id = p_empresa AND a.estado = 'confirmado' AND s.estado IN ('recusada', 'cancelada')))
$$;

CREATE FUNCTION public.reconciliar_orcamentos(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  r jsonb;
BEGIN
  PERFORM app_private.exigir_proprietario(p_empresa_id, usuario, 'Só o proprietário confere a consistência dos orçamentos.');
  r := app_private.reconciliacao_orcamentos(p_empresa_id);
  RETURN r || jsonb_build_object('ok', NOT EXISTS (SELECT 1 FROM jsonb_each(r) x WHERE (x.value #>> '{}')::bigint <> 0));
END $$;

-- ===========================================================================
-- 11. Privilégios e RLS: nenhuma tabela nova é lida ou gravada direto pela Data API.
-- ===========================================================================
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app_private' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
  FOR f IN SELECT unnest(ARRAY[
    'public.servicos_da_empresa(uuid)', 'public.criar_servico(uuid, jsonb, text)', 'public.alterar_servico(uuid, jsonb, integer, text)',
    'public.definir_servico_ativo(uuid, boolean, integer, text)', 'public.salvar_formulario_servico(uuid, jsonb, integer, text)',
    'public.salvar_regras_servico(uuid, jsonb, integer, text)', 'public.servicos_para_cliente(uuid)', 'public.estimar_servico(uuid, jsonb)',
    'public.horarios_empresa(uuid)', 'public.salvar_horarios_empresa(uuid, jsonb, text)', 'public.criar_solicitacao(uuid, jsonb, text)',
    'public.criar_solicitacao_interna(uuid, uuid, uuid, jsonb, text)', 'public.solicitacoes_da_empresa(uuid, jsonb, integer, integer)',
    'public.solicitacao_detalhe(uuid)', 'public.minhas_solicitacoes()', 'public.minha_solicitacao(uuid)',
    'public.assumir_solicitacao(uuid, integer, text)', 'public.salvar_rascunho_orcamento(uuid, jsonb, integer, text)',
    'public.enviar_orcamento(uuid, integer, text)', 'public.aprovar_orcamento(uuid, integer, text)',
    'public.registrar_mensagem(uuid, text, boolean, text)', 'public.pedir_revisao(uuid, text, text)',
    'public.aceitar_orcamento(uuid, uuid, boolean, text)', 'public.recusar_orcamento(uuid, uuid, jsonb, text)',
    'public.cancelar_solicitacao(uuid, text, text)', 'public.confirmar_horario(uuid, timestamptz, integer, boolean, text, text)',
    'public.agenda_basica(uuid, date, date)', 'public.ck_limites()', 'public.ck_definir_limite(text, integer, text, text)',
    'public.reconciliar_orcamentos(uuid)'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

ALTER TABLE public.servicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servico_perguntas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servico_regras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horarios_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacoes_servico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_componentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacao_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agendamentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.servicos, public.servico_perguntas, public.servico_regras, public.horarios_empresa, public.solicitacoes_servico,
  public.orcamento_versoes, public.orcamento_componentes, public.solicitacao_eventos, public.agendamentos FROM PUBLIC, anonymous, authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611120003', 'M08: serviços oferecidos, formulários, estimativa por regras, solicitações, orçamentos versionados, negociação, aceite e recusa, horários gerais e confirmação de horário; 4 permissões novas (55)');

COMMIT;
