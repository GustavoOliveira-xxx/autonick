-- 202611020001: taxonomia inicial OFICIAL de categorias de PRODUTO (decisão do idealizador de 02/11/2026:
-- as 11 propostas mais "Infantil e bebês" e "Esporte e lazer", total 13).
-- Separada das 17 categorias de negócio (tipo 'negocio') e da finalidade do produto (comercializável ou uso interno).
-- Regras: categoria opcional no produto; estrutura pronta para subcategorias (parent_id, até dois níveis, mesmo tipo);
-- administração futura pela CK; categoria em uso nunca é apagada (FK), só desativada; produto com categoria
-- desativada mantém o vínculo (a validação só vale ao escolher a categoria).
-- Rollback: 202611020001_categorias_produto.down.sql
BEGIN;

-- Subcategorias futuras: o pai precisa ser do mesmo tipo, ativo na criação e de primeiro nível (no máximo 2 níveis).
CREATE FUNCTION app_private.validar_categoria_pai() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  pai public.categorias_plataforma;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Uma categoria não pode ser subcategoria dela mesma.' USING HINT = 'VALIDATION_ERROR';
  END IF;
  SELECT * INTO pai FROM public.categorias_plataforma WHERE id = NEW.parent_id;
  IF pai.tipo <> NEW.tipo THEN
    RAISE EXCEPTION 'A categoria-pai precisa ser do mesmo tipo.' USING HINT = 'VALIDATION_ERROR';
  END IF;
  IF pai.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Use no máximo dois níveis (categoria e subcategoria).' USING HINT = 'VALIDATION_ERROR';
  END IF;
  IF EXISTS (SELECT 1 FROM public.categorias_plataforma WHERE parent_id = NEW.id) THEN
    RAISE EXCEPTION 'Uma categoria com subcategorias não pode virar subcategoria.' USING HINT = 'VALIDATION_ERROR';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.validar_categoria_pai() FROM PUBLIC;
CREATE TRIGGER categorias_pai_valido BEFORE INSERT OR UPDATE OF parent_id, tipo ON public.categorias_plataforma
  FOR EACH ROW EXECUTE FUNCTION app_private.validar_categoria_pai();

INSERT INTO public.categorias_plataforma (tipo, slug, nome, ordem, descricao, orientacao_regulatoria) VALUES
  ('produto', 'alimentos-bebidas', 'Alimentos e bebidas', 10,
   'Comida e bebida prontas para consumo ou preparo: bolos, doces, salgados, marmitas, pães, geleias, bebidas e temperos.',
   'Alimentos seguem as normas sanitárias aplicáveis; produtos industrializados podem exigir rotulagem própria.'),
  ('produto', 'roupas-acessorios', 'Roupas e acessórios', 20,
   'Vestuário, calçados e itens de uso pessoal: camisetas, vestidos, bolsas, bijuterias, bonés e calçados.', NULL),
  ('produto', 'beleza-cuidados', 'Beleza e cuidados pessoais', 30,
   'Higiene, cosméticos e perfumaria: cosméticos, perfumes, sabonetes, cremes, esmaltes e itens de barbearia.',
   'Cosméticos e produtos de higiene podem estar sujeitos a regras da Anvisa.'),
  ('produto', 'casa-decoracao', 'Casa e decoração', 40,
   'Itens para casa, cozinha e decoração: utensílios, cama, mesa e banho, vasos, quadros e organizadores.', NULL),
  ('produto', 'materiais-insumos', 'Materiais e insumos', 50,
   'Matéria-prima e material de consumo para produzir ou prestar serviço: aviamentos, tecidos, embalagens e materiais de limpeza profissional. A exposição pública depende da finalidade do produto, não desta categoria.', NULL),
  ('produto', 'pecas-componentes', 'Peças e componentes', 60,
   'Peças de reposição e componentes para conserto: telas de celular, baterias, cabos e peças automotivas.', NULL),
  ('produto', 'ferramentas-construcao', 'Ferramentas e construção', 70,
   'Ferramentas e materiais de obra e manutenção: ferramentas manuais, parafusos, tintas, material elétrico e hidráulico.', NULL),
  ('produto', 'papelaria-presentes', 'Papelaria e presentes', 80,
   'Material escolar e de escritório, lembranças e personalizados: cadernos, canetas, cartões e lembrancinhas.', NULL),
  ('produto', 'eletronicos-informatica', 'Eletrônicos e informática', 90,
   'Aparelhos e acessórios eletrônicos: fones, carregadores, capinhas, mouses e caixas de som.',
   'Alguns aparelhos exigem homologação da Anatel para venda.'),
  ('produto', 'pet', 'Pet', 100,
   'Produtos para animais de estimação: ração, petiscos, brinquedos, coleiras e camas.',
   'Medicamentos e produtos veterinários seguem regras próprias do Ministério da Agricultura.'),
  ('produto', 'infantil-bebes', 'Infantil e bebês', 110,
   'Roupas infantis, brinquedos, acessórios e produtos de cuidado para crianças.',
   'Brinquedos e alguns artigos infantis exigem certificação do Inmetro.'),
  ('produto', 'esporte-lazer', 'Esporte e lazer', 120,
   'Artigos esportivos, equipamentos recreativos e acessórios para atividades físicas.', NULL),
  ('produto', 'outros-produtos', 'Outros produtos', 999,
   'Itens que ainda não têm categoria própria. A CK acompanha o uso para criar categorias novas.', NULL);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.categorias_plataforma WHERE tipo = 'produto') <> 13 THEN
    RAISE EXCEPTION 'Esperadas 13 categorias de produto.';
  END IF;
END $$;

COMMENT ON TABLE public.categorias_plataforma IS
  'Categorias oficiais: 17 de negócio (01/11/2026) e 13 de produto (02/11/2026). A CK administrará o catálogo em marco próprio; categoria em uso é desativada, nunca apagada.';

INSERT INTO app_private.historico_migracoes (id, descricao) VALUES
  ('202611020001', 'Taxonomia inicial oficial de 13 categorias de produto e validação de subcategorias');

COMMIT;
