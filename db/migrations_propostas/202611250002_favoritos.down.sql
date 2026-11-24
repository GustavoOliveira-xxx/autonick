BEGIN;
DROP FUNCTION IF EXISTS public.alternar_favorito(text, text, uuid, text);
DROP FUNCTION IF EXISTS public.meus_favoritos(uuid);
DROP TABLE IF EXISTS public.favoritos;
COMMIT;
