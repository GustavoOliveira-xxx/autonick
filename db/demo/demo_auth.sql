-- DEMONSTRAÇÃO (local ou pública) do AutoniCK pela API Java. NUNCA aplicar no branch Neon de desenvolvimento nem em
-- production: só em banco exclusivo de demonstração, depois de db/tests/emulacao-neon.sql e das migrations.
--
-- Contas FICTÍCIAS de entrada (e-mail @autonick-teste.example, senha só com hash BCrypt) e as poucas operações
-- administrativas que a montagem do cenário precisa. As funções são SECURITY DEFINER e só o papel da API recebe
-- EXECUTE (ver o fim do arquivo, com o nome do papel em :papel_api).
--
-- Configuração: demo_auth.config.permite_ck = false na demonstração pública (nenhuma conta vira CK por aqui).

CREATE SCHEMA IF NOT EXISTS demo_auth;
REVOKE ALL ON SCHEMA demo_auth FROM PUBLIC;

CREATE TABLE IF NOT EXISTS demo_auth.config (
  unica boolean PRIMARY KEY DEFAULT true CHECK (unica),
  permite_ck boolean NOT NULL,
  publica boolean NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_auth.contas (
  id          uuid PRIMARY KEY,
  email       text NOT NULL UNIQUE CHECK (email LIKE '%@autonick-teste.example'),
  nome        text NOT NULL,
  senha_hash  text NOT NULL,
  pessoa      text,             -- chave da pessoa do cenário (cliente, gestor, funcionario, ck, ...)
  area        text NOT NULL CHECK (area IN ('cliente', 'business', 'ck')),
  descricao   text,
  ordem       integer NOT NULL DEFAULT 100,
  cenario     uuid,             -- demonstração pública: cenário do visitante (NULL = cenário fixo)
  criado_em   timestamptz NOT NULL DEFAULT now(),
  expira_em   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS contas_pessoa_fixa ON demo_auth.contas (pessoa) WHERE cenario IS NULL AND pessoa IS NOT NULL;
CREATE INDEX IF NOT EXISTS contas_cenario ON demo_auth.contas (cenario);

CREATE TABLE IF NOT EXISTS demo_auth.cenarios (
  id         uuid PRIMARY KEY,
  origem     text NOT NULL,      -- resumo (hash) da origem do visitante, para o limite de criação
  criado_em  timestamptz NOT NULL DEFAULT now(),
  expira_em  timestamptz NOT NULL,
  dados      jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Cria (ou devolve) a identidade fictícia, já com e-mail confirmado, e a conta de entrada.
CREATE OR REPLACE FUNCTION demo_auth.criar_conta(p_id uuid, p_email text, p_nome text, p_senha_hash text, p_pessoa text,
  p_area text, p_descricao text, p_ordem integer, p_cenario uuid, p_expira_em timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF lower(p_email) NOT LIKE '%@autonick-teste.example' THEN
    RAISE EXCEPTION 'Só contas fictícias do domínio autonick-teste.example.' USING HINT = 'VALIDATION_ERROR';
  END IF;
  INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (p_id, lower(p_email), p_nome, true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO demo_auth.contas (id, email, nome, senha_hash, pessoa, area, descricao, ordem, cenario, expira_em)
  VALUES (p_id, lower(p_email), p_nome, p_senha_hash, p_pessoa, p_area, p_descricao, coalesce(p_ordem, 100), p_cenario, p_expira_em)
  ON CONFLICT (id) DO NOTHING;
  RETURN p_id;
END $$;

-- Marca a empresa como dado de teste (mesma função administrativa do app, com motivo fixo).
CREATE OR REPLACE FUNCTION demo_auth.marcar_empresa(p_empresa_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.marcar_empresa_de_teste(p_empresa_id, 'demonstração AutoniCK: empresa fictícia');
END $$;

-- Concede CK à conta fictícia: só quando a configuração permite (demonstração local).
CREATE OR REPLACE FUNCTION demo_auth.conceder_ck(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce((SELECT permite_ck FROM demo_auth.config), false) THEN
    RAISE EXCEPTION 'CK fictícia não é permitida nesta demonstração.' USING HINT = 'FORBIDDEN_ACTION';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM demo_auth.contas c WHERE c.id = p_id) THEN
    RAISE EXCEPTION 'Conta fictícia inexistente.' USING HINT = 'NOT_FOUND';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_private.administradores_ck a WHERE a.auth_user_id = p_id::text AND a.ativo) THEN
    PERFORM app_private.conceder_ck_admin(p_id::text, 'demonstração AutoniCK: administração CK fictícia');
  END IF;
END $$;

-- Autoriza (ou renova) a conta fictícia de cliente a pedir pela vitrine (regra M11), por até 30 dias.
CREATE OR REPLACE FUNCTION demo_auth.autorizar_cliente(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM demo_auth.contas c WHERE c.id = p_id) THEN
    RAISE EXCEPTION 'Conta fictícia inexistente.' USING HINT = 'NOT_FOUND';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_private.autorizacoes_demonstracao a
                 WHERE a.auth_user_id = p_id::text AND a.revogada_em IS NULL AND a.expira_em > now() + interval '7 days') THEN
    PERFORM app_private.autorizar_demonstracao(p_id::text, 'demonstração AutoniCK: cliente fictício', 'API Java da demonstração', 30);
  END IF;
END $$;

-- Renova as autorizações dos clientes fictícios do cenário fixo (chamada no início da API).
CREATE OR REPLACE FUNCTION demo_auth.renovar_autorizacoes()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_conta record;
  v_total integer := 0;
BEGIN
  FOR v_conta IN SELECT c.id FROM demo_auth.contas c WHERE c.area = 'cliente' AND (c.expira_em IS NULL OR c.expira_em > now()) LOOP
    PERFORM demo_auth.autorizar_cliente(v_conta.id);
    v_total := v_total + 1;
  END LOOP;
  RETURN v_total;
END $$;

-- Demonstração PÚBLICA: empresas de cada cenário de visitante (a API restringe o visitante às do próprio cenário).
CREATE TABLE IF NOT EXISTS demo_auth.empresas_cenario (
  empresa_id uuid PRIMARY KEY,
  cenario    uuid NOT NULL REFERENCES demo_auth.cenarios (id)
);
CREATE INDEX IF NOT EXISTS empresas_cenario_cenario ON demo_auth.empresas_cenario (cenario);

CREATE OR REPLACE FUNCTION demo_auth.criar_cenario(p_id uuid, p_origem text, p_expira_em timestamptz)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO demo_auth.cenarios (id, origem, expira_em) VALUES (p_id, p_origem, p_expira_em) RETURNING id
$$;

CREATE OR REPLACE FUNCTION demo_auth.registrar_empresa_cenario(p_empresa_id uuid, p_cenario uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO demo_auth.empresas_cenario (empresa_id, cenario) VALUES (p_empresa_id, p_cenario) ON CONFLICT DO NOTHING
$$;

-- Empresa dona de um serviço (para conferir que a solicitação do visitante vai a uma empresa do cenário dele).
CREATE OR REPLACE FUNCTION demo_auth.empresa_do_servico(p_servico_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.empresa_id FROM public.servicos s WHERE s.id = p_servico_id
$$;

-- CK INTERNA da montagem: aprova os cartões das empresas fictícias do cenário (caminho real de publicação). Não tem
-- senha nem pessoa: ninguém entra nela; só o código de montagem da API a usa.
CREATE OR REPLACE FUNCTION demo_auth.garantir_ck_interna()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id constant uuid := '00000000-0000-4000-8000-00000000c0c0';
BEGIN
  INSERT INTO neon_auth."user" (id, email, name, "emailVerified")
  VALUES (v_id, 'ck-interna@autonick-teste.example', 'CK interna da demonstração', true) ON CONFLICT (id) DO NOTHING;
  INSERT INTO demo_auth.contas (id, email, nome, senha_hash, pessoa, area, descricao, ordem)
  VALUES (v_id, 'ck-interna@autonick-teste.example', 'CK interna da demonstração', '!sem-senha', NULL, 'ck', 'Uso interno da montagem', 999)
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM app_private.administradores_ck a WHERE a.auth_user_id = v_id::text AND a.ativo) THEN
    PERFORM app_private.conceder_ck_admin(v_id::text, 'demonstração AutoniCK: CK interna da montagem do cenário');
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA demo_auth FROM PUBLIC;
