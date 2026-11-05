-- =====================================================================
-- 84 · Notes de frais
-- Le collaborateur remplit sa note dans l'application (Mon espace) ; elle
-- part directement au service RH (sans validation), les administrateurs et
-- lui-même en copie, avec la note Excel (CT-NFP) remplie et les
-- justificatifs. Elle reste modifiable et peut être retransmise (version
-- suivante).
-- =====================================================================

-- barème kilométrique (prix au km selon la puissance fiscale)
create table if not exists public.nf_baremes (
  puissance text primary key,
  prix_km numeric not null,
  ordre integer not null default 0
);
insert into public.nf_baremes (puissance, prix_km, ordre) values
  ('3 CV et moins', 0.529, 1),
  ('4 CV', 0.606, 2),
  ('5 CV', 0.636, 3),
  ('6 CV', 0.665, 4),
  ('7 CV et plus', 0.697, 5)
on conflict (puissance) do nothing;

-- ce qui ne change pas d'un mois à l'autre
create table if not exists public.nf_profils (
  collaborateur_id uuid primary key references public.collaborateurs(id) on delete cascade,
  vehicule text,
  puissance text,
  km_domicile numeric,
  updated_at timestamptz not null default now()
);

create table if not exists public.nf_notes (
  id uuid primary key default gen_random_uuid(),
  collaborateur_id uuid not null references public.collaborateurs(id) on delete cascade,
  mois date not null,
  vehicule text,
  puissance text,
  prix_km numeric,
  km_domicile numeric,
  reg_depart text,
  reg_site text,
  reg_km_jour numeric,
  reg_nb_trajets numeric,
  total numeric not null default 0,
  statut text not null default 'BROUILLON' check (statut in ('BROUILLON', 'TRANSMISE')),
  version integer not null default 0,
  transmise_le timestamptz,
  transmise_a text,
  fichier_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collaborateur_id, mois)
);

create table if not exists public.nf_deplacements (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.nf_notes(id) on delete cascade,
  ordre integer not null default 0,
  jour date,
  depart text,
  site text,
  km numeric
);

create table if not exists public.nf_frais (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.nf_notes(id) on delete cascade,
  ordre integer not null default 0,
  jour date,
  nature text,
  commentaire text,
  montant numeric not null default 0,
  justificatif_path text,
  justificatif_nom text
);

-- ---------- droits : chacun ses notes ; les administrateurs voient tout ----------
alter table public.nf_baremes enable row level security;
alter table public.nf_profils enable row level security;
alter table public.nf_notes enable row level security;
alter table public.nf_deplacements enable row level security;
alter table public.nf_frais enable row level security;

drop policy if exists nf_baremes_lire on public.nf_baremes;
create policy nf_baremes_lire on public.nf_baremes for select to authenticated using (true);
drop policy if exists nf_baremes_admin on public.nf_baremes;
create policy nf_baremes_admin on public.nf_baremes for all to authenticated using (public.rh_est_admin()) with check (public.rh_est_admin());

drop policy if exists nf_profils_moi on public.nf_profils;
create policy nf_profils_moi on public.nf_profils for all to authenticated
  using (collaborateur_id = public.polynov_mon_collaborateur_id() or public.rh_est_admin())
  with check (collaborateur_id = public.polynov_mon_collaborateur_id() or public.rh_est_admin());

drop policy if exists nf_notes_moi on public.nf_notes;
create policy nf_notes_moi on public.nf_notes for all to authenticated
  using (collaborateur_id = public.polynov_mon_collaborateur_id() or public.rh_est_admin())
  with check (collaborateur_id = public.polynov_mon_collaborateur_id() or public.rh_est_admin());

drop policy if exists nf_deplacements_moi on public.nf_deplacements;
create policy nf_deplacements_moi on public.nf_deplacements for all to authenticated
  using (exists (select 1 from public.nf_notes n where n.id = note_id and (n.collaborateur_id = public.polynov_mon_collaborateur_id() or public.rh_est_admin())))
  with check (exists (select 1 from public.nf_notes n where n.id = note_id and (n.collaborateur_id = public.polynov_mon_collaborateur_id() or public.rh_est_admin())));

drop policy if exists nf_frais_moi on public.nf_frais;
create policy nf_frais_moi on public.nf_frais for all to authenticated
  using (exists (select 1 from public.nf_notes n where n.id = note_id and (n.collaborateur_id = public.polynov_mon_collaborateur_id() or public.rh_est_admin())))
  with check (exists (select 1 from public.nf_notes n where n.id = note_id and (n.collaborateur_id = public.polynov_mon_collaborateur_id() or public.rh_est_admin())));

-- ---------- justificatifs et notes Excel : un dossier par utilisateur ----------
insert into storage.buckets (id, name, public) values ('notes-frais', 'notes-frais', false)
on conflict (id) do nothing;

drop policy if exists nf_fichiers_moi on storage.objects;
create policy nf_fichiers_moi on storage.objects for all to authenticated
  using (bucket_id = 'notes-frais' and ((storage.foldername(name))[1] = auth.uid()::text or public.rh_est_admin()))
  with check (bucket_id = 'notes-frais' and (storage.foldername(name))[1] = auth.uid()::text);
