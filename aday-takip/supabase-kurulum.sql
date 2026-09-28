-- Aday Takip Sistemi - Supabase kurulumu
-- Supabase panelinde: SQL Editor > New query > bu dosyanın tamamını yapıştır > Run
-- Tekrar çalıştırılması güvenlidir (mevcut verileri silmez).

-- ============ TABLOLAR ============

create table if not exists public.adaylar (
  id                uuid primary key default gen_random_uuid(),
  ad_soyad          text not null check (length(trim(ad_soyad)) > 0),
  telefon           text,
  email             text,
  gorusme_tarihi    date,
  gorusme_turu      text check (gorusme_turu in ('yuz_yuze', 'online', 'telefon')),
  gorusme_notlari   text,
  durum             text not null default 'beklemede'
                    check (durum in ('beklemede', 'olumlu', 'olumsuz', 'ise_alindi')),
  cv_yolu           text,
  cv_dosya_adi      text,
  ekleyen_id        uuid default auth.uid() references auth.users (id) on delete set null,
  ekleyen_email     text default (auth.jwt() ->> 'email'),
  olusturma_tarihi  timestamptz not null default now(),
  guncelleme_tarihi timestamptz not null default now()
);

create table if not exists public.referans_gorusmeleri (
  id               uuid primary key default gen_random_uuid(),
  aday_id          uuid not null references public.adaylar (id) on delete cascade,
  referans_kisi    text not null check (length(trim(referans_kisi)) > 0),
  sirket_pozisyon  text,
  telefon          text,
  gorusme_tarihi   date,
  notlar           text,
  ekleyen_id       uuid default auth.uid() references auth.users (id) on delete set null,
  ekleyen_email    text default (auth.jwt() ->> 'email'),
  olusturma_tarihi timestamptz not null default now()
);

create index if not exists referans_gorusmeleri_aday_id_idx on public.referans_gorusmeleri (aday_id);
create index if not exists adaylar_gorusme_tarihi_idx on public.adaylar (gorusme_tarihi desc);

create or replace function public.guncelleme_tarihi_ayarla()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.guncelleme_tarihi = now();
  return new;
end;
$$;

drop trigger if exists adaylar_guncelleme on public.adaylar;
create trigger adaylar_guncelleme
  before update on public.adaylar
  for each row execute function public.guncelleme_tarihi_ayarla();

-- ============ ERİŞİM KURALLARI ============
-- Sadece giriş yapmış kullanıcılar okuyup yazabilir. Giriş yapmamış biri hiçbir şey göremez.

alter table public.adaylar enable row level security;
alter table public.referans_gorusmeleri enable row level security;

revoke all on public.adaylar from anon;
revoke all on public.referans_gorusmeleri from anon;
grant select, insert, update, delete on public.adaylar to authenticated;
grant select, insert, update, delete on public.referans_gorusmeleri to authenticated;

drop policy if exists "Giris yapanlar adaylari yonetir" on public.adaylar;
create policy "Giris yapanlar adaylari yonetir" on public.adaylar
  for all to authenticated using (true) with check (true);

drop policy if exists "Giris yapanlar referanslari yonetir" on public.referans_gorusmeleri;
create policy "Giris yapanlar referanslari yonetir" on public.referans_gorusmeleri
  for all to authenticated using (true) with check (true);

-- ============ CV DOSYALARI (Storage) ============
-- Gizli klasör: dosyalara sadece giriş yapmış kullanıcılar erişebilir. Maks. 10 MB, PDF ve Word (.docx).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cvler', 'cvler', false, 10485760,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "CV okuma" on storage.objects;
create policy "CV okuma" on storage.objects
  for select to authenticated using (bucket_id = 'cvler');

drop policy if exists "CV yukleme" on storage.objects;
create policy "CV yukleme" on storage.objects
  for insert to authenticated with check (bucket_id = 'cvler');

drop policy if exists "CV guncelleme" on storage.objects;
create policy "CV guncelleme" on storage.objects
  for update to authenticated using (bucket_id = 'cvler');

drop policy if exists "CV silme" on storage.objects;
create policy "CV silme" on storage.objects
  for delete to authenticated using (bucket_id = 'cvler');
