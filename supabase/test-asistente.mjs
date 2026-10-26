// Prueba de asistente.sql en un Postgres local (PGlite), igual que test-rls.mjs.
//   →   node supabase/test-asistente.mjs
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import fs from "node:fs";

const schema = fs.readFileSync(new URL("schema.sql", import.meta.url), "utf8");
const asistente = fs.readFileSync(new URL("asistente.sql", import.meta.url), "utf8");
const db = new PGlite({ extensions: { btree_gist } });
let failed = 0;
const ok = (m) => console.log("OK  ", m);
const bad = (m) => { console.log("FAIL", m); failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
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
await db.exec(schema);
await db.exec(asistente);
await db.exec(asistente); // re-ejecutable
ok("schema.sql + asistente.sql cargan (asistente dos veces)");

const CLAVE = "clave-de-prueba-0123456789abcdef";
await db.query(`insert into public.court_assistant_keys (key_hash, label) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'), 'Prueba')`, [CLAVE]);
const ADMIN = "00000000-0000-0000-0000-00000000000a";
await db.exec(`insert into auth.users values ('${ADMIN}', 'mily@club.es', '{}');
  insert into public.profiles (id, email, role) values ('${ADMIN}', 'mily@club.es', 'admin');`);

const t = (h) => `2026-10-29T${h}:00+01:00`;
const book = (key, h1, h2, name = "Thais y Moy") => one(`select public.court_asst_book($1, $2, $3, $4, 'clase-1') r`, [key, t(h1), t(h2), name]).then((x) => x.r);

// Un partido normal hecho por Mily desde la web (no es del asistente).
await as("authenticated", ADMIN);
const partido = await one(`select * from court_book_many($1)`, [JSON.stringify([{ court_id: 1, starts_at: t("21:00"), ends_at: t("22:30"), kind: "partido", name: "Juan", phone: "600111222" }])]);
partido.ok ? ok("Mily reserva un partido en Pista 1 a las 21:00") : bad(JSON.stringify(partido));
const partidoId = partido.ids[0];

// ---- Todo lo que sigue, como visitante anónimo (así llamará el segundo cerebro) ----
await as("anon");
await expectFail("sin clave no reserva", `select public.court_asst_book(null, $1, $2, 'X')`, [t("17:00"), t("18:00")]);
await expectFail("clave incorrecta no reserva", `select public.court_asst_book('clave-falsa-0123456789abcdef', $1, $2, 'X')`, [t("17:00"), t("18:00")]);
await expectFail("clave corta no reserva", `select public.court_asst_book('corta', $1, $2, 'X')`, [t("17:00"), t("18:00")]);

const r1 = await book(CLAVE, "19:00", "20:00");
r1.ok && r1.court_id === 1 ? ok("reserva la clase en Pista 1") : bad(JSON.stringify(r1));
const r2 = await book(CLAVE, "19:00", "20:00", "SO");
r2.ok && r2.court_id === 2 ? ok("misma hora: salta sola a Pista 2") : bad(JSON.stringify(r2));
const r3 = await book(CLAVE, "19:00", "20:00", "Javi");
r3.ok && r3.court_id === 3 ? ok("misma hora: Pista 3") : bad(JSON.stringify(r3));
const r4 = await book(CLAVE, "19:30", "20:30", "Otro");
!r4.ok && r4.error === "ocupado" ? ok("las 3 pistas ocupadas: devuelve 'ocupado' sin crear nada") : bad(JSON.stringify(r4));
const r5 = await book(CLAVE, "21:30", "22:30", "Tarde");
r5.ok && r5.court_id === 2 ? ok("respeta el partido de Mily: a las 21:30 usa Pista 2") : bad(JSON.stringify(r5));
await expectFail("no reserva clases de más de 3 horas", `select public.court_asst_book($1, $2, $3, 'X')`, [CLAVE, t("09:00"), t("13:00")]);

const tipo = await (async () => { await as("authenticated", ADMIN); const x = await one(`select kind, name, notes from court_bookings where id = $1`, [r1.id]); await as("anon"); return x; })();
tipo.kind === "clase" && tipo.name === "Thais y Moy" ? ok("se ve en la web como 'clase' con los alumnos") : bad(JSON.stringify(tipo));

// Mover
const m1 = await one(`select public.court_asst_move($1, $2, $3, $4) r`, [CLAVE, r1.id, t("17:00"), t("18:00")]).then((x) => x.r);
m1.ok && m1.court_id === 1 ? ok("mueve la clase a las 17:00 manteniendo su pista") : bad(JSON.stringify(m1));
const m2 = await one(`select public.court_asst_move($1, $2, $3, $4) r`, [CLAVE, r1.id, t("21:00"), t("22:00")]).then((x) => x.r);
m2.ok && m2.court_id !== 1 ? ok("si su pista está ocupada (partido), la mueve a otra (" + m2.court_id + ")") : bad(JSON.stringify(m2));
await expectFail("no puede mover el partido de Mily", `select public.court_asst_move($1, $2, $3, $4)`, [CLAVE, partidoId, t("10:00"), t("11:30")]);

// Cancelar
await expectFail("no puede cancelar el partido de Mily", `select public.court_asst_cancel($1, $2)`, [CLAVE, partidoId]);
const c1 = await one(`select public.court_asst_cancel($1, $2) r`, [CLAVE, r3.id]).then((x) => x.r);
c1.ok ? ok("cancela su clase") : bad(JSON.stringify(c1));
const r6 = await book(CLAVE, "19:00", "20:00", "Hueco liberado");
// A las 19:00 solo quedaba SO en Pista 2 (la de Thais y Moy se movió y la de Javi se canceló): hay sitio.
r6.ok ? ok("al mover y cancelar, los huecos vuelven a quedar libres (Pista " + r6.court_id + ")") : bad(JSON.stringify(r6));
const r7 = await book(CLAVE, "19:00", "20:00", "Otro más");
r7.ok && r7.court_id !== r6.court_id && r7.court_id !== 2 ? ok("y el siguiente usa la otra pista libre (Pista " + r7.court_id + ")") : bad(JSON.stringify(r7));

// Ocupación
const busy = await one(`select public.court_asst_busy($1, $2, $3) r`, [CLAVE, t("00:00"), "2026-10-30T00:00:00+01:00"]).then((x) => x.r);
const sinNombres = busy.every((b) => !("name" in b) && !("phone" in b));
busy.length >= 5 && sinNombres ? ok("ocupación: " + busy.length + " reservas, sin nombres ni teléfonos") : bad(JSON.stringify(busy));
busy.some((b) => b.mia === false) && busy.some((b) => b.mia === true) ? ok("distingue las clases suyas del resto") : bad("mia mal");
await expectFail("ocupación sin clave", `select public.court_asst_busy('clave-falsa-0123456789abcdef', $1, $2)`, [t("00:00"), t("23:00")]);
await expectFail("ocupación de más de 31 días", `select public.court_asst_busy($1, $2, $3)`, [CLAVE, t("00:00"), "2026-12-30T00:00:00+01:00"]);

// Lo de antes sigue cerrado
const vis = await db.query("select * from court_bookings").then((r) => r.rows.length, () => "denied");
vis === "denied" || vis === 0 ? ok("el visitante sigue sin ver la agenda") : bad("ve " + vis);
await expectFail("el visitante no lee las claves", "select * from court_assistant_keys");
await expectFail("el visitante no llama a la comprobación interna", `select public.court_asst_check($1)`, [CLAVE]);
await expectFail("el visitante sigue sin poder usar court_book_many", `select * from court_book_many($1)`, [JSON.stringify([{ court_id: 3, starts_at: t("10:00"), ends_at: t("11:00") }])]);

console.log(failed ? `\n${failed} FALLO(S)` : "\nTodo OK");
process.exit(failed ? 1 : 0);
