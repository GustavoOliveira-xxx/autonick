-- MIG-05 (M03, decisão do idealizador de 01/11/2026: manter as empresas [TESTE]).
--
-- Empresas fictícias criadas por testes ficam no branch de desenvolvimento, com o
-- histórico imutável preservado. Esta migration cria uma marcação que:
--  - só pode ser feita por SQL operacional (nenhuma RPC ou papel da API altera);
--  - não depende do nome "[TESTE]", que o gestor pode editar;
--  - é copiada para a projeção pública, para que a busca pública (M10) exclua
--    essas empresas por regra do banco: a política de leitura pública da
--    projeção DEVE filtrar `NOT dado_de_teste` (registrado no BDD-001 §5.2).
--
-- Rollback: 202611010005_marcacao_dados_de_teste.down.sql

BEGIN;

ALTER TABLE public.empresas ADD COLUMN dado_de_teste boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.empresas.dado_de_teste IS
  'Empresa fictícia para testes e demonstração. Marcada só por SQL operacional; nunca aparece na busca pública.';

ALTER TABLE public.public_empresa_cards ADD COLUMN dado_de_teste boolean NOT NULL DEFAULT false;

-- A projeção sempre copia a marcação da empresa (não confia no valor recebido).
CREATE FUNCTION app_private.copiar_marcacao_teste() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.dado_de_teste := coalesce((SELECT e.dado_de_teste FROM public.empresas e WHERE e.id = NEW.empresa_id), false);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.copiar_marcacao_teste() FROM PUBLIC;
CREATE TRIGGER cards_copiar_marcacao_teste BEFORE INSERT OR UPDATE ON public.public_empresa_cards
  FOR EACH ROW EXECUTE FUNCTION app_private.copiar_marcacao_teste();

CREATE FUNCTION app_private.propagar_marcacao_teste() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  UPDATE public.public_empresa_cards SET dado_de_teste = NEW.dado_de_teste WHERE empresa_id = NEW.id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.propagar_marcacao_teste() FROM PUBLIC;
CREATE TRIGGER empresas_propagar_marcacao_teste AFTER UPDATE OF dado_de_teste ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION app_private.propagar_marcacao_teste();

-- Uso operacional (dono do banco), com auditoria. Sem GRANT para os papéis da API.
CREATE FUNCTION app_private.marcar_empresa_de_teste(p_empresa_id uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  UPDATE public.empresas SET dado_de_teste = true WHERE id = p_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;
  PERFORM app_private.auditar(p_empresa_id, 'operacional', 'empresa.marcada_como_teste', 'empresas', p_empresa_id,
    jsonb_build_object('motivo', p_motivo));
END $$;
REVOKE ALL ON FUNCTION app_private.marcar_empresa_de_teste(uuid, text) FROM PUBLIC;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611010005', 'Marcação de empresas fictícias (dado_de_teste), fora da busca pública (M03)');

COMMIT;
