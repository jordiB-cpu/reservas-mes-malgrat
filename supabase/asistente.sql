-- ============================================================
-- Reservas Padel Mes Malgrat — acceso del asistente (Claude)
-- Pegar DESPUÉS de schema.sql en Supabase → SQL Editor → Run. Es re-ejecutable.
--
-- Qué hace: abre una "puerta" estrecha para que el segundo cerebro de Jordi
-- reserve, mueva y cancele SUS CLASES sin iniciar sesión. Todo pasa por
-- funciones que piden una clave secreta; las tablas siguen cerradas igual
-- que antes (RLS de schema.sql) y la web no cambia.
--
-- Límites a propósito:
--   · Solo crea reservas de tipo "clase", de como mucho 3 horas.
--   · Solo puede mover o cancelar las reservas que creó ella misma.
--   · Para ver la ocupación devuelve pista y horas, nunca nombres ni teléfonos.
--   · La clave no se guarda: solo su huella (sha256).
--
-- Dar de alta la clave (una vez, en el SQL Editor, cambiando el texto):
--   insert into public.court_assistant_keys (key_hash, label)
--   values (encode(sha256(convert_to('PEGA-AQUI-TU-CLAVE', 'UTF8')), 'hex'), 'Segundo cerebro');
-- Quitarla:  delete from public.court_assistant_keys where label = 'Segundo cerebro';
-- ============================================================

create table if not exists public.court_assistant_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  label text,
  created_at timestamptz not null default now()
);
-- Reservas creadas por el asistente: las únicas que puede mover o cancelar.
create table if not exists public.court_assistant_bookings (
  booking_id uuid primary key references public.court_bookings on delete cascade,
  ref text,                      -- id de la clase en el segundo cerebro
  created_at timestamptz not null default now()
);
alter table public.court_assistant_keys enable row level security;
alter table public.court_assistant_bookings enable row level security;
-- Sin políticas: nadie las lee ni las toca desde la web; solo las funciones de abajo.
revoke all on public.court_assistant_keys, public.court_assistant_bookings from anon, authenticated;

create or replace function public.court_asst_check(p_key text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_key is null or length(p_key) < 24 or not exists (
    select 1 from public.court_assistant_keys
    where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
  ) then
    raise exception 'Clave del asistente incorrecta';
  end if;
end $$;

-- Reserva una clase en la primera pista activa que esté libre.
create or replace function public.court_asst_book(
  p_key text, p_starts_at timestamptz, p_ends_at timestamptz, p_name text, p_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c record;
  nid uuid;
begin
  perform public.court_asst_check(p_key);
  if p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '3 hours' then
    raise exception 'Duración de la clase no válida';
  end if;
  for c in select id from public.courts where active order by sort, id loop
    begin
      insert into public.court_bookings (court_id, starts_at, ends_at, kind, name, notes, created_by)
      values (c.id, p_starts_at, p_ends_at, 'clase', left(coalesce(p_name, 'Clase'), 120), 'Reservada desde el segundo cerebro', null)
      returning id into nid;
      insert into public.court_assistant_bookings (booking_id, ref) values (nid, p_ref);
      return jsonb_build_object('ok', true, 'id', nid, 'court_id', c.id);
    exception when exclusion_violation then
      -- esa pista está ocupada: prueba la siguiente
    end;
  end loop;
  return jsonb_build_object('ok', false, 'error', 'ocupado');
end $$;

-- Mueve una clase suya: intenta su misma pista y, si está ocupada, las demás.
create or replace function public.court_asst_move(
  p_key text, p_id uuid, p_starts_at timestamptz, p_ends_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actual smallint;
  c record;
begin
  perform public.court_asst_check(p_key);
  if not exists (select 1 from public.court_assistant_bookings where booking_id = p_id) then
    raise exception 'Esa reserva no es una clase del asistente';
  end if;
  if p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '3 hours' then
    raise exception 'Duración de la clase no válida';
  end if;
  select court_id into actual from public.court_bookings where id = p_id and cancelled_at is null;
  if actual is null then
    return jsonb_build_object('ok', false, 'error', 'no_existe');
  end if;
  for c in select id from public.courts where active order by (id <> actual), sort, id loop
    begin
      update public.court_bookings set court_id = c.id, starts_at = p_starts_at, ends_at = p_ends_at where id = p_id;
      return jsonb_build_object('ok', true, 'id', p_id, 'court_id', c.id);
    exception when exclusion_violation then
    end;
  end loop;
  return jsonb_build_object('ok', false, 'error', 'ocupado');
end $$;

-- Cancela (no borra) una clase suya; el hueco queda libre.
create or replace function public.court_asst_cancel(p_key text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.court_asst_check(p_key);
  if not exists (select 1 from public.court_assistant_bookings where booking_id = p_id) then
    raise exception 'Esa reserva no es una clase del asistente';
  end if;
  update public.court_bookings set cancelled_at = now() where id = p_id and cancelled_at is null;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- Ocupación de las pistas en un rango (máx. 31 días): solo pista y horas.
create or replace function public.court_asst_busy(p_key text, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.court_asst_check(p_key);
  if p_to <= p_from or p_to - p_from > interval '31 days' then
    raise exception 'Rango no válido';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('court_id', b.court_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
             'mia', exists (select 1 from public.court_assistant_bookings a where a.booking_id = b.id)) order by b.starts_at)
    from public.court_bookings b join public.courts ct on ct.id = b.court_id and ct.active
    where b.cancelled_at is null and b.starts_at < p_to and b.ends_at > p_from
  ), '[]'::jsonb);
end $$;

-- Solo estas funciones, y nada más, quedan abiertas a quien tenga la clave.
revoke all on function public.court_asst_check(text) from public, anon, authenticated;
revoke all on function public.court_asst_book(text, timestamptz, timestamptz, text, text) from public;
revoke all on function public.court_asst_move(text, uuid, timestamptz, timestamptz) from public;
revoke all on function public.court_asst_cancel(text, uuid) from public;
revoke all on function public.court_asst_busy(text, timestamptz, timestamptz) from public;
grant execute on function public.court_asst_book(text, timestamptz, timestamptz, text, text) to anon, authenticated;
grant execute on function public.court_asst_move(text, uuid, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.court_asst_cancel(text, uuid) to anon, authenticated;
grant execute on function public.court_asst_busy(text, timestamptz, timestamptz) to anon, authenticated;
