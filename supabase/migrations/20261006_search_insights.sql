-- Recherches des patients sur /find-doctor
-- Stocke uniquement spécialité + wilaya (+ ville quand elle est connue).
-- Aucune donnée personnelle, aucun nom de médecin, aucune IP.

-- ── Listes de référence ─────────────────────────────────────────
create or replace function public.dz_specialties()
returns text[] language sql immutable as $$
  select array[
    'Médecine générale','Cardiologie','Pédiatrie','Gynécologie-Obstétrique','Dermatologie',
    'Ophtalmologie','ORL','Orthopédie','Neurologie','Psychiatrie','Chirurgie dentaire',
    'Pneumologie','Gastro-entérologie','Endocrinologie','Urologie','Rhumatologie','Oncologie',
    'Infectiologie','Radiologie','Néphrologie','Médecine interne','Chirurgie générale',
    'Médecine du travail','Anesthésie-Réanimation'
  ]
$$;

create or replace function public.dz_wilayas()
returns text[] language sql immutable as $$
  select array[
    'Adrar','Chlef','Laghouat','Oum El Bouaghi','Batna','Béjaïa','Biskra','Béchar','Blida','Bouira',
    'Tamanrasset','Tébessa','Tlemcen','Tiaret','Tizi Ouzou','Alger','Djelfa','Jijel','Sétif','Saïda',
    'Skikda','Sidi Bel Abbès','Annaba','Guelma','Constantine','Médéa','Mostaganem','M''Sila','Mascara','Ouargla',
    'Oran','El Bayadh','Illizi','Bordj Bou Arréridj','Boumerdès','El Tarf','Tindouf','Tissemsilt','El Oued','Khenchela',
    'Souk Ahras','Tipaza','Mila','Aïn Defla','Naâma','Aïn Témouchent','Ghardaïa','Relizane','Timimoun','Bordj Badji Mokhtar',
    'Ouled Djellal','Béni Abbès','In Salah','In Guezzam','Touggourt','Djanet','El M''Ghair','El Meniaa'
  ]
$$;

-- ── Table ──────────────────────────────────────────────────────
create table if not exists public.search_events (
  id          bigserial primary key,
  specialty   text not null check (char_length(specialty) between 2 and 60),
  wilaya      text check (wilaya is null or char_length(wilaya) between 2 and 60),
  city        text check (city   is null or char_length(city)   between 2 and 60),
  created_at  timestamptz not null default now()
);
alter table public.search_events add column if not exists wilaya text;

create index if not exists idx_search_events_created on public.search_events (created_at desc);
create index if not exists idx_search_events_spec_wilaya on public.search_events (specialty, wilaya);

-- Aucun accès direct à la table : tout passe par les fonctions ci-dessous.
alter table public.search_events enable row level security;

-- ── Enregistrement d'une recherche ─────────────────────────────
-- Spécialité : doit faire partie de la liste officielle (même sans médecin inscrit,
--              pour mesurer la demande non couverte).
-- Wilaya     : doit faire partie des 58 wilayas.
-- Ville      : gardée seulement si un médecin public y exerce (sinon on garde la wilaya).
drop function if exists public.log_search(text, text);
create or replace function public.log_search(p_specialty text, p_city text default null, p_wilaya text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spec   text;
  v_wilaya text;
  v_city   text;
begin
  select s into v_spec from unnest(dz_specialties()) s where lower(s) = lower(trim(p_specialty)) limit 1;
  if v_spec is null then
    return;
  end if;

  if p_wilaya is not null then
    select w into v_wilaya from unnest(dz_wilayas()) w where lower(w) = lower(trim(p_wilaya)) limit 1;
  end if;

  if p_city is not null and char_length(trim(p_city)) between 2 and 60 then
    -- La « ville » saisie peut être une wilaya
    if v_wilaya is null then
      select w into v_wilaya from unnest(dz_wilayas()) w where lower(w) = lower(trim(p_city)) limit 1;
    end if;
    select p.city into v_city
    from profiles p
    where p.is_public = true and lower(p.city) = lower(trim(p_city))
    limit 1;
  end if;

  insert into search_events (specialty, wilaya, city) values (v_spec, v_wilaya, v_city);
end;
$$;

-- ── Suggestions affichées sur la page ──────────────────────────
-- Top 30 jours, à partir de 3 recherches (jamais la recherche d'une seule personne),
-- et uniquement si au moins un médecin public correspond : une suggestion mène toujours à des résultats.
create or replace function public.popular_searches(p_limit int default 8)
returns table (specialty text, place text, wilaya text, searches bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.specialty,
         coalesce(e.city, e.wilaya) as place,
         e.wilaya,
         count(*) as searches
  from search_events e
  where e.created_at > now() - interval '30 days'
    and exists (
      select 1 from profiles p
      where p.is_public = true
        and p.specialty = e.specialty
        and (coalesce(e.city, e.wilaya) is null
             or lower(p.city) = lower(coalesce(e.city, e.wilaya))
             or lower(p.wilaya) = lower(coalesce(e.city, e.wilaya)))
    )
  group by e.specialty, coalesce(e.city, e.wilaya), e.wilaya
  having count(*) >= 3
  order by searches desc
  limit least(greatest(coalesce(p_limit, 8), 1), 20);
$$;

-- ── Tableau de bord privé : demande vs offre ───────────────────
-- Réservé à toi (éditeur SQL Supabase / service role). Exemple :
--   select * from search_demand(30);
-- Les lignes avec doctors = 0 sont les endroits où recruter en priorité.
create or replace function public.search_demand(p_days int default 30)
returns table (specialty text, wilaya text, searches bigint, doctors bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.specialty,
         coalesce(e.wilaya, '(non précisée)') as wilaya,
         count(*) as searches,
         (select count(*) from profiles p
           where p.is_public = true and p.specialty = e.specialty
             and (e.wilaya is null or lower(p.wilaya) = lower(e.wilaya))) as doctors
  from search_events e
  where e.created_at > now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
  group by e.specialty, e.wilaya
  order by searches desc;
$$;

revoke all on function public.log_search(text, text, text) from public;
revoke all on function public.popular_searches(int) from public;
revoke all on function public.search_demand(int) from public, anon, authenticated;
grant execute on function public.log_search(text, text, text) to anon, authenticated;
grant execute on function public.popular_searches(int) to anon, authenticated;
