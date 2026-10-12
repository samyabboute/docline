-- ============================================================
-- Catalogue des médicaments algériens (2026-10-12)
-- Source : nomenclature nationale des produits pharmaceutiques à usage
-- humain, Ministère de l'Industrie Pharmaceutique (miph.gov.dz),
-- version d'août 2026 : médicaments en vigueur, non renouvelés, retirés.
-- Données publiques, en lecture seule pour les utilisateurs connectés ;
-- seul l'import (service) écrit dans ces tables.
-- ============================================================
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create table if not exists public.drug_catalog_versions (
  id                serial primary key,
  label             text not null,
  source_url        text not null,
  imported_at       timestamptz not null default now(),
  active_count      int,
  not_renewed_count int,
  withdrawn_count   int
);

create table if not exists public.drugs (
  id                bigint generated always as identity primary key,
  reg_number        text not null,                    -- numéro d'enregistrement officiel (partagé par certaines variantes)
  dci_code          text,                             -- code molécule + forme (ex. 01 A 003)
  class_code        text generated always as (left(dci_code, 2)) stored,  -- classe thérapeutique
  dci               text not null,                    -- dénomination commune internationale
  brand             text not null,                    -- nom de marque
  form              text,
  dosage            text,
  packaging         text,
  list              text check (list in ('I', 'II', 'STUPEFIANT')),
  hospital          boolean not null default false,   -- disponible à l'hôpital
  pharmacy          boolean not null default false,   -- disponible en officine
  observation       text,
  lab               text,
  lab_country       text,
  registered_at     date,
  renewed_at        date,
  product_type      text check (product_type in ('GE', 'RE', 'BIO')),   -- générique, référence, biologique
  origin            text check (origin in ('F', 'I')),                  -- fabriqué en Algérie, importé
  status            text not null check (status in ('active', 'not_renewed', 'withdrawn')),
  withdrawn_at      date,
  withdrawal_reason text,
  search_text       text not null,                    -- minuscules sans accents, pour la recherche
  version_id        int references public.drug_catalog_versions(id)
);
create unique index if not exists drugs_variant_uq on public.drugs (reg_number, brand, coalesce(packaging, ''), status);
create index if not exists drugs_search_trgm on public.drugs using gin (search_text extensions.gin_trgm_ops);
create index if not exists drugs_dci_code_idx on public.drugs (dci_code);
create index if not exists drugs_class_idx on public.drugs (class_code);
create index if not exists drugs_status_idx on public.drugs (status);

alter table public.drugs enable row level security;
alter table public.drug_catalog_versions enable row level security;
drop policy if exists drugs_read on public.drugs;
create policy drugs_read on public.drugs for select to authenticated using (true);
drop policy if exists drug_versions_read on public.drug_catalog_versions;
create policy drug_versions_read on public.drug_catalog_versions for select to authenticated using (true);

-- Recherche instantanée : nom de marque d'abord, puis molécule, puis ressemblance (fautes de frappe)
create or replace function public.drug_search(p_q text, p_limit int default 20, p_include_inactive boolean default false)
returns table (id bigint, brand text, dci text, form text, dosage text, packaging text, list text,
               pharmacy boolean, hospital boolean, product_type text, origin text, lab text, status text, dci_code text, class_code text)
language sql stable security definer set search_path = public, extensions as $$
  with q as (select trim(regexp_replace(lower(unaccent(coalesce(p_q, ''))), '\s+', ' ', 'g')) as t)
  select d.id, d.brand, d.dci, d.form, d.dosage, d.packaging, d.list, d.pharmacy, d.hospital,
         d.product_type, d.origin, d.lab, d.status, d.dci_code, d.class_code
    from drugs d, q
   where length(q.t) >= 2
     and (p_include_inactive or d.status = 'active')
     and (d.search_text like '%' || q.t || '%' or word_similarity(q.t, d.search_text) >= 0.45)
   order by (lower(unaccent(d.brand)) like q.t || '%') desc,
            (lower(unaccent(d.dci)) like q.t || '%') desc,
            word_similarity(q.t, d.search_text) desc,
            d.brand, d.dosage
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;
revoke all on function public.drug_search(text, int, boolean) from public, anon;
grant execute on function public.drug_search(text, int, boolean) to authenticated;
alter function public.drug_search(text, int, boolean) owner to postgres;
