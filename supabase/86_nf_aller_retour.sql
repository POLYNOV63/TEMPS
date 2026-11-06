-- =====================================================================
-- 86 · Notes de frais : déplacement en aller simple ou en aller-retour
-- Le collaborateur saisit le nombre de km (un trajet) et choisit « Aller »
-- ou « A/R » ; un A/R compte les km deux fois (et retire deux fois la
-- distance domicile → Polynov au départ du domicile, une fois en aller).
-- Les déplacements déjà saisis étaient en km A/R : ils sont convertis
-- (km ÷ 2, en aller-retour), le résultat ne change pas.
-- =====================================================================

alter table public.nf_deplacements add column if not exists aller_retour boolean;

update public.nf_deplacements
   set km = case when km is null then null else round(km / 2, 2) end,
       aller_retour = true
 where aller_retour is null;

alter table public.nf_deplacements alter column aller_retour set default true;
alter table public.nf_deplacements alter column aller_retour set not null;
