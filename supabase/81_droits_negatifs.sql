-- =====================================================================
-- 81 · Droits RH négatifs autorisés
-- Le service RH peut donner un solde de CP (ou de RTT) négatif : congés pris
-- par anticipation. La saisie des soldes (Suivi RH) recale alors les droits
-- de l'exercice en négatif. Les contrôles « >= 0 » sont remplacés par une
-- borne large (-100 jours), qui n'arrête que les fautes de frappe.
-- =====================================================================

alter table public.rh_droits drop constraint if exists rh_droits_cp_acquis_check;
alter table public.rh_droits drop constraint if exists rh_droits_cp_reportes_check;
alter table public.rh_droits drop constraint if exists rh_droits_rtt_acquis_check;

alter table public.rh_droits add constraint rh_droits_cp_acquis_check check (cp_acquis >= -100);
alter table public.rh_droits add constraint rh_droits_cp_reportes_check check (cp_reportes >= -100);
alter table public.rh_droits add constraint rh_droits_rtt_acquis_check check (rtt_acquis >= -100);
