// Prueba del esquema sin Supabase: lo carga en un Postgres local (PGlite)
// imitando lo mínimo de Supabase (roles anon/authenticated, auth.uid()) y
// lo ataca como visitante, cliente de la tienda y admin.   →   npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("schema.sql", import.meta.url), "utf8");
const db = new PGlite({ extensions: { btree_gist } });
let failed = 0;
const ok = (m) => console.log("OK  ", m);
const bad = (m) => { console.log("FAIL", m); failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const rows = (q, p) => db.query(q, p).then((r) => r.rows.length, (e) => "denied: " + e.message.split("\n")[0]);
const affected = (q, p) => db.query(q, p).then((r) => r.affectedRows, (e) => "denied: " + e.message.split("\n")[0]);
const blocked = (r) => r === 0 || String(r).startsWith("denied");
const expectFail = async (label, q, p) => {
  try { await db.query(q, p); bad(label + " (debería fallar)"); } catch (e) { ok(label + " -> " + e.message.split("\n")[0]); }
};
const as = (role, uid = "") => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role ${role};`);

await db.exec(`
  create role anon; create role authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create schema auth; grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
`);
await db.exec(sql);
await db.exec(sql); // re-ejecutable
ok("schema.sql carga dos veces");

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CUST = "00000000-0000-0000-0000-00000000000c";
await db.exec(`insert into auth.users values ('${ADMIN}', 'mily@club.es', '{}'), ('${CUST}', 'marc@test.es', '{}');
  insert into public.profiles (id, email, role) values ('${ADMIN}', 'mily@club.es', 'admin'), ('${CUST}', 'marc@test.es', 'customer');`);

const at = (d, h) => `2026-10-${d}T${h}:00+02:00`;
const item = (court, d, h1, h2, extra = {}) => ({ court_id: court, starts_at: at(d, h1), ends_at: at(d, h2), kind: "partido", name: "Juan", phone: "600111222", ...extra });

// ---- Visitante y cliente de la tienda: nada ----
await as("anon");
const a1 = await rows("select * from court_bookings");
blocked(a1) ? ok("visitante no ve la agenda (" + a1 + ")") : bad("visitante ve " + a1);
await expectFail("visitante no reserva", `select * from court_book_many($1)`, [JSON.stringify([item(1, 20, "10:00", "11:30")])]);
await as("authenticated", CUST);
const c1 = await rows("select * from court_bookings");
c1 === 0 ? ok("cliente de la tienda no ve reservas") : bad("cliente ve " + c1);
await expectFail("cliente no reserva", `select * from court_book_many($1)`, [JSON.stringify([item(1, 20, "10:00", "11:30")])]);
const c2 = await affected(`insert into court_bookings (court_id, starts_at, ends_at) values (1, '${at(20, "12:00")}', '${at(20, "13:00")}')`);
blocked(c2) ? ok("cliente no inserta a mano (" + c2 + ")") : bad("cliente insertó");
const c3 = await rows("select * from courts");
c3 === 0 ? ok("cliente no ve las pistas ni ajustes") : bad("cliente ve pistas");

// ---- Admin ----
await as("authenticated", ADMIN);
const n = await one("select count(*)::int c from courts");
n.c === 3 ? ok("admin ve las 3 pistas") : bad("pistas " + n.c);
const r1 = await one(`select * from court_book_many($1)`, [JSON.stringify([item(1, 20, "10:00", "11:30")])]);
r1.ok ? ok("admin reserva Pista 1, 20/10 10:00-11:30") : bad(JSON.stringify(r1));
const r2 = await one(`select * from court_book_many($1)`, [JSON.stringify([item(1, 20, "11:00", "12:00")])]);
!r2.ok && r2.conflicts.length === 1 ? ok("choque detectado (11:00 pisa 10:00-11:30), no se crea") : bad(JSON.stringify(r2));
const r3 = await one(`select * from court_book_many($1)`, [JSON.stringify([item(1, 20, "11:30", "12:30"), item(2, 20, "10:00", "11:30")])]);
r3.ok ? ok("seguida (11:30) y misma hora en otra pista: permitido") : bad(JSON.stringify(r3));
await expectFail("la base de datos impide solapar aunque se salte la función",
  `insert into court_bookings (court_id, starts_at, ends_at) values (1, '${at(20, "10:30")}', '${at(20, "11:00")}')`);
await expectFail("fin antes que inicio", `insert into court_bookings (court_id, starts_at, ends_at) values (3, '${at(20, "12:00")}', '${at(20, "11:00")}')`);
// Serie semanal con un choque: todo o nada
const series = "11111111-1111-1111-1111-111111111111";
const weekly = ["20", "27"].map((d) => item(3, d, "18:00", "19:00", { kind: "clase", series_id: series }));
await db.query(`select * from court_book_many($1)`, [JSON.stringify([item(3, 27, "18:30", "19:30")])]);
const r4 = await one(`select * from court_book_many($1)`, [JSON.stringify(weekly)]);
const cnt = await one(`select count(*)::int c from court_bookings where series_id = '${series}'`);
!r4.ok && cnt.c === 0 ? ok("serie con un choque el 27: no se crea ninguna (todo o nada)") : bad(JSON.stringify(r4) + " creadas " + cnt.c);
// "Reservar las 3 pistas" (p. ej. una americana): la misma reserva en las 3, todo o nada
const amer = (d, h1, h2, extra = {}) => [1, 2, 3].map((c) => item(c, d, h1, h2, { kind: "americana", name: "Americana masculina 500", phone: null, ...extra }));
const r6 = await one(`select * from court_book_many($1)`, [JSON.stringify(amer(22, "07:00", "08:30"))]);
const c6 = await one(`select count(distinct court_id)::int c from court_bookings where name = 'Americana masculina 500' and starts_at = '${at(22, "07:00")}'`);
r6.ok && r6.ids.length === 3 && c6.c === 3 ? ok("3 pistas de golpe (22/10 7:00-8:30): se crean las 3") : bad(JSON.stringify(r6) + " pistas " + c6.c);
await db.query(`select * from court_book_many($1)`, [JSON.stringify([item(2, 29, "07:30", "08:30")])]);
const r7 = await one(`select * from court_book_many($1)`, [JSON.stringify(amer(29, "07:00", "08:30"))]);
const c7 = await one(`select count(*)::int c from court_bookings where name = 'Americana masculina 500' and starts_at = '${at(29, "07:00")}'`);
!r7.ok && r7.conflicts.length === 1 && r7.conflicts[0].court_id === 2 && r7.conflicts[0].with.name === "Juan" && c7.c === 0
  ? ok("3 pistas con la Pista 2 ocupada: no se crea ninguna y dice qué pista choca y con qué")
  : bad(JSON.stringify(r7) + " creadas " + c7.c);
// 3 pistas + repetir cada semana: 2 semanas × 3 pistas, una serie por pista
const per = { 1: "22222222-2222-2222-2222-222222222221", 2: "22222222-2222-2222-2222-222222222222", 3: "22222222-2222-2222-2222-222222222223" };
const both = ["23", "30"].flatMap((d) => [1, 2, 3].map((c) => item(c, d, "20:00", "21:30", { kind: "americana", name: "Americana semanal", series_id: per[c] })));
const r8 = await one(`select * from court_book_many($1)`, [JSON.stringify(both)]);
const c8 = await one(`select count(*)::int n, count(distinct series_id)::int s from court_bookings where name = 'Americana semanal'`);
r8.ok && c8.n === 6 && c8.s === 3 ? ok("3 pistas cada semana (2 semanas): 6 reservas, una serie por pista") : bad(JSON.stringify(r8) + " " + JSON.stringify(c8));
// Cancelar libera el hueco
const first = await one(`select id from court_bookings where court_id = 1 and starts_at = '${at(20, "10:00")}'`);
await db.query(`update court_bookings set cancelled_at = now() where id = $1`, [first.id]);
const r5 = await one(`select * from court_book_many($1)`, [JSON.stringify([item(1, 20, "10:00", "11:00")])]);
r5.ok ? ok("al cancelar, el hueco queda libre otra vez") : bad(JSON.stringify(r5));
await expectFail("deshacer la cancelación si ya está ocupado", `update court_bookings set cancelled_at = null where id = $1`, [first.id]);
// Jugadores
await db.query(`insert into court_players (name, phone) values ('Juan Pérez', '600111222')`);
await expectFail("teléfono de jugador repetido", `insert into court_players (name, phone) values ('Otro', '600111222')`);
const pl = await one(`select count(*)::int c from court_players where name ilike '%jua%'`);
pl.c === 1 ? ok("buscar jugador por nombre") : bad("jugadores " + pl.c);
await db.query(`update court_settings set value = '"08:00"' where key = 'open'`);
ok("admin cambia el horario");

// ---- Quién juega en cada reserva (jugadores-reserva.sql) ----
const jsql = fs.readFileSync(new URL("jugadores-reserva.sql", import.meta.url), "utf8");
const sinSql = await rows("select players, group_id from court_bookings limit 1");
String(sinSql).startsWith("denied") ? ok("sin jugadores-reserva.sql la columna no existe: la app lo detecta y guarda sin jugadores (" + sinSql + ")") : bad("players ya existía");
const antes = await one("select count(*)::int c from court_bookings");
await db.exec("reset role;");
await db.exec(jsql);
await db.exec(jsql); // re-ejecutable
ok("jugadores-reserva.sql carga dos veces");
await db.exec(sql);
ok("schema.sql otra vez después: no choca con las columnas nuevas");
await as("authenticated", ADMIN);
const viejas = await one("select count(*)::int c, count(*) filter (where players = '[]'::jsonb)::int vacias from court_bookings");
viejas.c === antes.c && viejas.vacias === viejas.c ? ok(`las ${viejas.c} reservas que ya había siguen ahí, con la lista vacía`) : bad(JSON.stringify(viejas));
// Pistas 1 y 2 a la vez (p. ej. un entreno de equipo): court_book_many no cambia
const entreno = [1, 2].map((c) => item(c, 24, "17:30", "19:00", { name: "José Calero", phone: "600111222" }));
const r9 = await one(`select * from court_book_many($1)`, [JSON.stringify(entreno)]);
r9.ok && r9.ids.length === 2 ? ok("Pistas 1 y 2 de golpe (24/10 17:30): court_book_many sigue igual") : bad(JSON.stringify(r9));
// La app reparte los ids por día y pista según el orden de la lista: tiene que coincidir.
const orden = await db.query(`select id, court_id from court_bookings where id = any($1)`, [r9.ids]);
r9.ids.every((x, i) => orden.rows.find((r) => r.id === x)?.court_id === entreno[i].court_id) ? ok("court_book_many devuelve los ids en el mismo orden que la lista") : bad(JSON.stringify(orden.rows));
const jug = (n) => Array.from({ length: n }, (_, i) => ({ name: `Jugador ${i + 1}`, phone: i % 2 ? null : `61100000${i}`, player_id: null }));
const G = "33333333-3333-3333-3333-333333333333";
const set8 = await affected(`update court_bookings set players = $1, group_id = $2 where id = any($3)`, [JSON.stringify(jug(8)), G, r9.ids]);
set8 === 2 ? ok("admin guarda 8 jugadores (4 por pista) en las 2 pistas del grupo") : bad("guardadas " + set8);
// Misma consulta que groupOf() de la app: solo por grupo, sin las canceladas.
const hermanas = `select count(*)::int c, min(jsonb_array_length(players))::int n from court_bookings where group_id = $1 and cancelled_at is null`;
const grupo = await one(hermanas, [G]);
grupo.c === 2 && grupo.n === 8 ? ok("al abrir una, se encuentra la otra pista de la misma reserva (grupo) con sus 8 jugadores") : bad(JSON.stringify(grupo));
await db.query(`update court_bookings set starts_at = $1, ends_at = $2 where id = $3`, [at(24, "18:00"), at(24, "19:30"), r9.ids[1]]);
const movida = await one(hermanas, [G]);
movida.c === 2 ? ok("si se cambia la hora de una de las 2 pistas, siguen unidas y comparten la lista") : bad(JSON.stringify(movida));
const doce = await affected(`update court_bookings set players = $1 where id = $2`, [JSON.stringify(jug(12)), r9.ids[0]]);
doce === 1 ? ok("12 jugadores (3 pistas) se pueden guardar") : bad("12 -> " + doce);
await expectFail("13 jugadores: no (como mucho 12)", `update court_bookings set players = $1 where id = $2`, [JSON.stringify(jug(13)), r9.ids[0]]);
await expectFail("la lista tiene que ser una lista", `update court_bookings set players = '{"name":"Diego"}' where id = $1`, [r9.ids[0]]);
await expectFail("la lista no puede ser null", `update court_bookings set players = null where id = $1`, [r9.ids[0]]);
await db.query(`update court_bookings set players = $1 where id = $2`, [JSON.stringify(jug(8)), r9.ids[0]]);
await db.exec("reset role;");
await db.exec(jsql);
await as("authenticated", ADMIN);
const sigue = await one(`select jsonb_array_length(players)::int n from court_bookings where id = $1`, [r9.ids[0]]);
sigue.n === 8 ? ok("volver a pegar jugadores-reserva.sql no borra las listas") : bad("quedan " + sigue.n);
// Cliente de la tienda y visitante: ni ven ni tocan las listas
await as("authenticated", CUST);
const cv = await rows("select players from court_bookings");
cv === 0 ? ok("cliente de la tienda no ve quién juega") : bad("cliente ve " + cv);
const cu = await affected(`update court_bookings set players = '[]'::jsonb where id = $1`, [r9.ids[0]]);
blocked(cu) ? ok("cliente no cambia la lista (" + cu + ")") : bad("cliente cambió la lista");
await as("anon");
const av = await rows("select players from court_bookings");
blocked(av) ? ok("visitante no ve quién juega (" + av + ")") : bad("visitante ve " + av);
await as("authenticated", ADMIN);
const intacta = await one(`select jsonb_array_length(players)::int n from court_bookings where id = $1`, [r9.ids[0]]);
intacta.n === 8 ? ok("la lista sigue intacta tras los intentos de fuera") : bad("quedan " + intacta.n);

console.log(failed ? `\n${failed} FALLO(S)` : "\nTodo OK");
process.exit(failed ? 1 : 0);
