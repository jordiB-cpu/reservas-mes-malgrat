-- ============================================================
-- Reservas Padel Mes Malgrat — quién juega en cada reserva
-- Pegar DESPUÉS de schema.sql en Supabase → SQL Editor → New query → Run.
-- Es re-ejecutable (se puede pegar otra vez sin romper nada).
--
-- Qué hace: añade dos columnas a las reservas (court_bookings):
--   · players: la lista de quién juega, [{ "name", "phone", "player_id" }],
--     hasta 4 por pista (la app lo controla; aquí, como mucho 12 = 3 pistas).
--   · group_id: une las pistas de una misma reserva de un día (p. ej.
--     Pista 1 y Pista 2 para un entreno), para que compartan la lista. Cada
--     semana de una reserva repetida lleva su propio grupo.
-- No borra ni cambia nada de lo que ya hay: las reservas antiguas quedan con
-- la lista vacía y court_book_many sigue igual.
--
-- Seguridad: son columnas de court_bookings, así que valen sus mismas reglas
-- (RLS court_bookings_staff: solo el personal del club, hoy los admins).
--
-- Mientras no se aplique, la app guarda las reservas sin jugadores y lo avisa.
-- ============================================================

alter table public.court_bookings add column if not exists players jsonb not null default '[]'::jsonb;
alter table public.court_bookings add column if not exists group_id uuid;

-- La lista siempre es una lista, y como mucho de 12 (4 por pista × 3 pistas).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'court_bookings_players_list') then
    alter table public.court_bookings add constraint court_bookings_players_list
      check (jsonb_typeof(players) = 'array' and jsonb_array_length(players) <= 12);
  end if;
end $$;

create index if not exists court_bookings_group on public.court_bookings (group_id) where group_id is not null;

-- Que la web vea las columnas nuevas al momento.
notify pgrst, 'reload schema';
