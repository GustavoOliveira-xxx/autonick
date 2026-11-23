-- Concessões do papel de LOGIN da API Java num banco de DEMONSTRAÇÃO (depois de demo_auth.sql). Marcadores trocados
-- por quem instala: __PAPEL_API__ (nome do papel), __PERMITE_CK__ e __PUBLICA__ (true/false).
-- O papel é NOINHERIT: fora de SET LOCAL ROLE, só enxerga demo_auth; os dados do app só com authenticated/anonymous.
INSERT INTO demo_auth.config (unica, permite_ck, publica) VALUES (true, __PERMITE_CK__, __PUBLICA__)
ON CONFLICT (unica) DO UPDATE SET permite_ck = excluded.permite_ck, publica = excluded.publica;
GRANT authenticated, anonymous TO __PAPEL_API__;
GRANT USAGE ON SCHEMA demo_auth TO __PAPEL_API__;
GRANT SELECT ON demo_auth.contas, demo_auth.cenarios, demo_auth.config, demo_auth.empresas_cenario TO __PAPEL_API__;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA demo_auth TO __PAPEL_API__;
