-- Rollback da 202611020001: remove as 13 categorias de produto, só se nenhum produto as usar.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.produtos p JOIN public.categorias_plataforma c ON c.id = p.categoria_id WHERE c.tipo = 'produto') THEN
    RAISE EXCEPTION 'Há produtos usando categorias de produto; tire a categoria deles antes do rollback.';
  END IF;
END $$;
DELETE FROM public.categorias_plataforma WHERE tipo = 'produto';
DROP TRIGGER categorias_pai_valido ON public.categorias_plataforma;
DROP FUNCTION app_private.validar_categoria_pai();
COMMENT ON TABLE public.categorias_plataforma IS
  'Categorias oficiais (17 de negócio aprovadas em 01/11/2026). A CK poderá administrar e expandir o catálogo em marco próprio.';
DELETE FROM app_private.historico_migracoes WHERE id = '202611020001';
COMMIT;
