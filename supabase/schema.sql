-- ============================================================
-- Reservas Mes Malgrat — agenda de pistas (sustituye a Playtomic)
-- Pegar entero en Supabase → SQL Editor → New query → Run. Es re-ejecutable.
--
-- Proyecto Supabase COMPARTIDO por todo el club ("padel-mes-malgrat"):
-- `profiles` e `is_admin()` vienen del esquema de la tienda y son comunes
-- (una sola cuenta por persona). Aquí se crean solo si no existen, con la
-- misma definición, para poder instalar esta app sola. Todas las tablas de
-- reservas empiezan por court_ para no chocar con las de la tienda.
--
-- Quién entra: de momento solo administradores (Mily y Jordi). Toda la
-- seguridad pasa por court_staff(): para dar acceso a monitores más
-- adelante basta con cambiar esa función, no cada política.
-- ============================================================

create extension if not exists btree_gist;

-- ---------- Comunes con la tienda (no se tocan si ya existen) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text,
  phone text,
  address text,
  role text not null default 'customer' check (role in ('customer', 'premium', 'admin')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Quién puede ver y tocar la agenda.
create or replace function public.court_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin();
$$;

-- ---------- Pistas ----------
create table if not exists public.courts (
  id smallint primary key,
  name text not null,
  sort smallint not null default 0,
  active boolean not null default true
);
insert into public.courts (id, name, sort) values (1, 'Pista 1', 1), (2, 'Pista 2', 2), (3, 'Pista 3', 3)
  on conflict (id) do nothing;

-- ---------- Ajustes (horario, franja, duraciones por tipo) ----------
create table if not exists public.court_settings (
  key text primary key,
  value jsonb,
  label text
);
insert into public.court_settings (key, value, label) values
  ('open', '"07:00"', 'Hora de apertura'),
  ('close', '"22:30"', 'Hora de cierre'),
  ('slot_minutes', '30', 'Franja de la parrilla (minutos)'),
  ('club_name', '"Padel Mes Malgrat"', 'Nombre en los mensajes de WhatsApp'),
  ('durations', '{"partido":90,"clase":60,"escuela":60,"snp":90,"americana":120,"torneo":120,"mantenimiento":60}', 'Duración por defecto de cada tipo (minutos)')
  on conflict (key) do nothing;

-- ---------- Agenda de jugadores ----------
create table if not exists public.court_players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text,
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists court_players_phone_key on public.court_players (phone) where phone is not null and phone <> '';

-- ---------- Reservas ----------
create table if not exists public.court_bookings (
  id uuid primary key default gen_random_uuid(),
  court_id smallint not null references public.courts,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'partido'
    check (kind in ('partido', 'clase', 'escuela', 'snp', 'americana', 'torneo', 'mantenimiento')),
  player_id uuid references public.court_players on delete set null,
  name text,                     -- quién juega / título ("Escuela infantil", "SNP 2ª")
  phone text,
  notes text,
  paid boolean not null default false,
  series_id uuid,                -- reservas que se repiten cada semana comparten serie
  cancelled_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '12 hours')
);
create index if not exists court_bookings_time on public.court_bookings (starts_at);
create index if not exists court_bookings_series on public.court_bookings (series_id);

-- Imposible solapar dos reservas activas en la misma pista: lo impide la
-- propia base de datos, aunque dos personas guarden a la vez.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'court_bookings_no_overlap') then
    alter table public.court_bookings add constraint court_bookings_no_overlap
      exclude using gist (court_id with =, tstzrange(starts_at, ends_at) with &&) where (cancelled_at is null);
  end if;
end $$;

create or replace function public.court_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists court_bookings_touch on public.court_bookings;
create trigger court_bookings_touch before update on public.court_bookings
  for each row execute function public.court_touch();

-- ---------- Crear varias reservas de golpe (repetir cada semana) ----------
-- Todo o nada: si alguna fecha choca, no se crea ninguna y se devuelven
-- los choques para enseñarlos. Corre con los permisos de quien llama (RLS).
create or replace function public.court_book_many(p_items jsonb)
returns table (ok boolean, ids uuid[], conflicts jsonb)
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare
  it jsonb;
  clash jsonb := '[]'::jsonb;
  new_ids uuid[] := '{}';
  nid uuid;
  other record;
begin
  if not public.court_staff() then
    raise exception 'Solo el club puede reservar pistas';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select b.id, b.starts_at, b.ends_at, b.name, b.kind into other
      from public.court_bookings b
      where b.court_id = (it->>'court_id')::smallint and b.cancelled_at is null
        and tstzrange(b.starts_at, b.ends_at) && tstzrange((it->>'starts_at')::timestamptz, (it->>'ends_at')::timestamptz)
      limit 1;
    if found then
      clash := clash || jsonb_build_object('starts_at', it->>'starts_at', 'court_id', (it->>'court_id')::int,
        'with', jsonb_build_object('id', other.id, 'name', other.name, 'kind', other.kind, 'starts_at', other.starts_at, 'ends_at', other.ends_at));
    end if;
  end loop;
  if jsonb_array_length(clash) > 0 then
    return query select false, '{}'::uuid[], clash;
    return;
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.court_bookings (court_id, starts_at, ends_at, kind, player_id, name, phone, notes, paid, series_id)
    values ((it->>'court_id')::smallint, (it->>'starts_at')::timestamptz, (it->>'ends_at')::timestamptz,
            coalesce(it->>'kind', 'partido'), nullif(it->>'player_id', '')::uuid, it->>'name', it->>'phone', it->>'notes',
            coalesce((it->>'paid')::boolean, false), nullif(it->>'series_id', '')::uuid)
    returning id into nid;
    new_ids := new_ids || nid;
  end loop;
  return query select true, new_ids, '[]'::jsonb;
end $$;

-- ---------- Seguridad: solo el personal del club ----------
alter table public.courts enable row level security;
alter table public.court_settings enable row level security;
alter table public.court_players enable row level security;
alter table public.court_bookings enable row level security;

drop policy if exists courts_staff on public.courts;
create policy courts_staff on public.courts for all using (public.court_staff()) with check (public.court_staff());
drop policy if exists court_settings_staff on public.court_settings;
create policy court_settings_staff on public.court_settings for all using (public.court_staff()) with check (public.court_staff());
drop policy if exists court_players_staff on public.court_players;
create policy court_players_staff on public.court_players for all using (public.court_staff()) with check (public.court_staff());
drop policy if exists court_bookings_staff on public.court_bookings;
create policy court_bookings_staff on public.court_bookings for all using (public.court_staff()) with check (public.court_staff());

-- Nadie anónimo toca nada de la agenda (ni siquiera intentarlo).
revoke all on public.courts, public.court_settings, public.court_players, public.court_bookings from anon;
revoke execute on function public.court_book_many(jsonb) from anon;
grant select, insert, update, delete on public.courts, public.court_settings, public.court_players, public.court_bookings to authenticated;
grant execute on function public.court_book_many(jsonb) to authenticated;
