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

console.log(failed ? `\n${failed} FALLO(S)` : "\nTodo OK");
process.exit(failed ? 1 : 0);
