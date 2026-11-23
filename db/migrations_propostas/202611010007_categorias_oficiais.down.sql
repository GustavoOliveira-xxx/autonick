-- Rollback da 202611010007: volta à lista provisória de 12 categorias.
-- As 5 categorias novas só são removidas se nenhuma empresa as usar (falha explícita caso contrário).
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.empresas e JOIN public.categorias_plataforma c ON c.id = e.categoria_id
              WHERE c.tipo = 'negocio' AND c.slug IN ('servicos-profissionais', 'tecnologia-informatica', 'animais-estimacao',
                                                      'transporte-entregas', 'artesanato-presentes')) THEN
    RAISE EXCEPTION 'Há empresas usando as categorias novas; troque a categoria delas antes do rollback.';
  END IF;
END $$;

DELETE FROM public.categorias_plataforma
 WHERE tipo = 'negocio' AND slug IN ('servicos-profissionais', 'tecnologia-informatica', 'animais-estimacao',
                                     'transporte-entregas', 'artesanato-presentes');
ALTER TABLE public.categorias_plataforma DROP COLUMN orientacao_regulatoria, DROP COLUMN descricao;
COMMENT ON TABLE public.categorias_plataforma IS
  'Categorias oficiais. Lista inicial PROVISÓRIA (seed de desenvolvimento), sujeita à aprovação da CK.';
DELETE FROM app_private.historico_migracoes WHERE id = '202611010007';

COMMIT;
