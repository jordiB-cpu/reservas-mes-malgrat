// Prueba de bonos.sql en un Postgres local (PGlite), igual que test-asistente.mjs.
//   →   node supabase/test-bonos.mjs
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import fs from "node:fs";

const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
const db = new PGlite({ extensions: { btree_gist } });
let failed = 0;
const ok = (m) => console.log("OK  ", m);
const bad = (m) => { console.log("FAIL", m); failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const expectFail = async (label, q, p) => {
  try { await db.query(q, p); bad(label + " (debería fallar)"); } catch (e) { ok(label + " -> " + e.message.split("\n")[0]); }
};
const as = (role) => db.exec(`reset role; set role ${role};`);

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
await db.exec(leer("schema.sql"));
await db.exec(leer("asistente.sql"));
await db.exec(leer("bonos.sql"));
await db.exec(leer("bonos.sql")); // re-ejecutable
ok("schema + asistente + bonos cargan (bonos dos veces)");

const CLAVE = "clave-de-prueba-0123456789abcdef";
await db.query(`insert into public.court_assistant_keys (key_hash, label) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'), 'Prueba')`, [CLAVE]);

const T1 = "tok-thais-0123456789abcdef";
const T2 = "tok-moy-0123456789abcdefgh";
const items = (nombre) => JSON.stringify([{ token: T1, data: { nombre, bonos: [] } }, { token: T2, data: { nombre: "Moy", bonos: [] } }]);

await as("anon");
await expectFail("sin clave no publica", `select public.pass_asst_publish(null, $1)`, [items("Thais")]);
await expectFail("clave falsa no publica", `select public.pass_asst_publish('clave-falsa-0123456789abcdef', $1)`, [items("Thais")]);
await expectFail("anónimo no lee la tabla", `select * from public.student_passes`);
await expectFail("anónimo no escribe la tabla", `insert into public.student_passes values ('x'||repeat('a',30), '{}')`);

const p1 = (await one(`select public.pass_asst_publish($1, $2) r`, [CLAVE, items("Thais")])).r;
p1.ok && p1.publicados === 2 ? ok("publica 2 bonos con la clave") : bad(JSON.stringify(p1));
const p2 = (await one(`select public.pass_asst_publish($1, $2) r`, [CLAVE, items("Thais L.")])).r;
p2.publicados === 2 ? ok("volver a publicar actualiza (no duplica)") : bad(JSON.stringify(p2));

const v = (await one(`select public.pass_view($1) r`, [T1])).r;
v && v.nombre === "Thais L." && v.actualizado ? ok("el alumno ve su bono con su código") : bad(JSON.stringify(v));
const nada = (await one(`select public.pass_view($1) r`, ["tok-inventado-0123456789"])).r;
nada === null ? ok("código inventado → nada") : bad(JSON.stringify(nada));
const corto = (await one(`select public.pass_view($1) r`, ["tok"])).r;
corto === null ? ok("código corto → nada") : bad(JSON.stringify(corto));

const p3 = (await one(`select public.pass_asst_publish($1, $2, true) r`, [CLAVE, JSON.stringify([{ token: T1, data: { nombre: "Thais" } }])])).r;
p3.borrados === 1 ? ok("borrar_resto quita los que ya no están") : bad(JSON.stringify(p3));
(await one(`select public.pass_view($1) r`, [T2])).r === null ? ok("el borrado ya no se ve") : bad("sigue viéndose");

await as("authenticated");
await expectFail("usuario con sesión tampoco lee la tabla", `select * from public.student_passes`);

console.log(failed ? `\n${failed} FALLOS` : "\nTodo OK");
process.exitCode = failed ? 1 : 0;
