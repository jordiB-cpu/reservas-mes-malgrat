-- ============================================================
-- Reservas Padel Mes Malgrat — bono digital de los alumnos de Jordi
-- Pegar DESPUÉS de asistente.sql en Supabase → SQL Editor → Run. Es re-ejecutable.
--
-- Qué hace: guarda una "foto" del bono de cada alumno para que la vea en
-- /bono/?c=<código> sin cuenta. El segundo cerebro la publica con la clave
-- del asistente; el alumno solo puede leer la suya, y solo si sabe su código.
--
-- Límites a propósito:
--   · Nadie lee la tabla directamente: solo bono_ver(código), de una en una.
--   · El código tiene que ser largo (≥ 20 caracteres), así no se puede adivinar.
--   · Solo guarda nombre, tipo de bono, precio y fechas de clase. Nada de teléfonos.
-- ============================================================

create table if not exists public.student_passes (
  token text primary key check (length(token) >= 20),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.student_passes enable row level security;
-- Sin políticas: nadie la lee ni la toca desde la web; solo las funciones de abajo.
revoke all on public.student_passes from anon, authenticated;

-- El segundo cerebro publica los bonos: p_items = [{ "token": "...", "data": {...} }, ...]
-- Con p_borrar_resto = true, borra los que ya no vienen en la lista (alumnos dados de baja).
create or replace function public.pass_asst_publish(p_key text, p_items jsonb, p_borrar_resto boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  borrados int := 0;
  it jsonb;
begin
  perform public.court_asst_check(p_key);
  if jsonb_typeof(p_items) <> 'array' then raise exception 'p_items tiene que ser una lista'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.student_passes (token, data, updated_at)
    values (it->>'token', it->'data', now())
    on conflict (token) do update set data = excluded.data, updated_at = now();
    n := n + 1;
  end loop;
  if p_borrar_resto then
    delete from public.student_passes
    where token not in (select x->>'token' from jsonb_array_elements(p_items) x);
    get diagnostics borrados = row_count;
  end if;
  return jsonb_build_object('ok', true, 'publicados', n, 'borrados', borrados);
end $$;

-- Lo que llama la página del alumno (sin iniciar sesión).
create or replace function public.pass_view(p_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select data || jsonb_build_object('actualizado', updated_at)
  from public.student_passes
  where length(coalesce(p_token, '')) >= 20 and token = p_token
$$;

revoke all on function public.pass_asst_publish(text, jsonb, boolean) from public;
grant execute on function public.pass_asst_publish(text, jsonb, boolean) to anon, authenticated;
revoke all on function public.pass_view(text) from public;
grant execute on function public.pass_view(text) to anon, authenticated;
