-- 202611010007: catálogo OFICIAL de categorias de negócio (decisão do idealizador de 01/11/2026, opção B).
-- As 12 categorias iniciais passam a ser oficiais e entram 5 novas (total 17).
-- A categoria diz o ramo; a modalidade (comercio, servicos, ambos) continua um campo separado da empresa.
-- Orientação regulatória: só INFORMATIVA (não bloqueia cadastro). Atividades regulamentadas seguem a lei aplicável;
-- a exigência de comprovação, se houver, será decidida pela CK em marco próprio.
-- Rollback: 202611010007_categorias_oficiais.down.sql
BEGIN;

ALTER TABLE public.categorias_plataforma
  ADD COLUMN descricao text CHECK (char_length(descricao) <= 300),
  ADD COLUMN orientacao_regulatoria text CHECK (char_length(orientacao_regulatoria) <= 400);

COMMENT ON TABLE public.categorias_plataforma IS
  'Categorias oficiais (17 de negócio aprovadas em 01/11/2026). A CK poderá administrar e expandir o catálogo em marco próprio.';
COMMENT ON COLUMN public.categorias_plataforma.orientacao_regulatoria IS
  'Texto informativo sobre atividades do ramo que podem exigir registro, licença ou habilitação. Não bloqueia cadastro.';

INSERT INTO public.categorias_plataforma (tipo, slug, nome, ordem) VALUES
  ('negocio', 'servicos-profissionais', 'Serviços profissionais', 120),
  ('negocio', 'tecnologia-informatica', 'Tecnologia e informática', 130),
  ('negocio', 'animais-estimacao', 'Animais de estimação', 140),
  ('negocio', 'transporte-entregas', 'Transporte e entregas', 150),
  ('negocio', 'artesanato-presentes', 'Artesanato e presentes', 160);

UPDATE public.categorias_plataforma c SET descricao = d.descricao, orientacao_regulatoria = d.orientacao
FROM (VALUES
  ('alimentacao', 'Comida e bebida preparada ou vendida: doces, marmitas, salgados, bebidas, buffet e encomendas.',
   'Produção e venda de alimentos seguem as normas sanitárias aplicáveis (por exemplo, licença ou cadastro na vigilância sanitária do município).'),
  ('beleza-estetica', 'Cuidados pessoais e aparência: salão, barbearia, manicure, estética e cosméticos.',
   'Alguns procedimentos estéticos exigem habilitação profissional ou licença sanitária.'),
  ('costura-moda', 'Roupas, acessórios e ajustes: confecção, costura sob medida, bordado e aviamentos.', NULL),
  ('assistencia-tecnica', 'Conserto e manutenção de aparelhos: celulares, eletrodomésticos e informática, com venda de peças.', NULL),
  ('construcao-reformas', 'Obras, reparos e instalações: pedreiro, eletricista, encanador, pintor e materiais.',
   'Alguns serviços exigem responsável técnico habilitado ou cumprimento de normas de segurança (por exemplo, instalações elétricas e de gás).'),
  ('servicos-domesticos', 'Cuidados com a casa: diarista, jardinagem, lavanderia e controle de pragas.',
   'Controle de pragas (dedetização) exige licença e responsável técnico conforme a norma aplicável.'),
  ('saude-bem-estar', 'Cuidados com corpo e mente fora da saúde regulamentada: massoterapia, atividade física, práticas integrativas e produtos naturais.',
   'Profissões de saúde regulamentadas (por exemplo, medicina, odontologia, fisioterapia, nutrição, psicologia) exigem registro no conselho profissional e seguem regras próprias de publicidade.'),
  ('educacao-aulas', 'Ensino e capacitação: reforço escolar, idiomas, música, cursos livres e materiais.',
   'Cursos que conferem diploma ou certificação oficial dependem de autorização do órgão de educação competente.'),
  ('eventos-festas', 'Organização e fornecimento para eventos: decoração, fotografia, música, recreação e locação de itens.', NULL),
  ('automotivo', 'Veículos e mobilidade: mecânica, funilaria, lavagem, peças e acessórios.',
   'Alguns serviços seguem normas ambientais (por exemplo, descarte de óleo) e de segurança veicular.'),
  ('comercio-varejo', 'Lojas de produtos variados sem ramo específico: mercadinho, papelaria e variedades.', NULL),
  ('servicos-profissionais', 'Serviços de escritório e especializados: contabilidade, consultoria, design, marketing, tradução e assessoria.',
   'Algumas profissões (por exemplo, contabilidade, advocacia, engenharia, arquitetura) exigem registro no conselho profissional.'),
  ('tecnologia-informatica', 'Serviços e produtos digitais: criação de sites, suporte de TI, aplicativos, aulas de informática e equipamentos.', NULL),
  ('animais-estimacao', 'Produtos e cuidados para animais: pet shop, banho e tosa, adestramento e hospedagem.',
   'Atendimento veterinário exige médico-veterinário registrado no conselho; venda de medicamentos veterinários segue norma própria.'),
  ('transporte-entregas', 'Deslocamento de pessoas e cargas: fretes, mudanças, motoboy e entregas locais.',
   'Transporte remunerado de pessoas ou cargas pode exigir licença, registro ou autorização do poder público competente.'),
  ('artesanato-presentes', 'Peças artesanais e presentes: artesanato, lembranças, personalizados e itens decorativos.', NULL),
  ('outros', 'Negócios que ainda não têm categoria própria. A CK acompanha o uso para criar novas categorias.', NULL)
) AS d(slug, descricao, orientacao)
WHERE c.tipo = 'negocio' AND c.slug = d.slug;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.categorias_plataforma WHERE tipo = 'negocio' AND ativo AND descricao IS NOT NULL) <> 17 THEN
    RAISE EXCEPTION 'Catálogo oficial deveria ter 17 categorias de negócio com descrição.';
  END IF;
END $$;


INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611010007', 'Catálogo oficial de 17 categorias de negócio, com descrição e orientação regulatória informativa');

COMMIT;
