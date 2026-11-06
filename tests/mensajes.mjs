// Prueba de los textos de WhatsApp (sin navegador).   →   npm run test:msg
// Fechas fijas: "hoy" es el viernes 6 de noviembre de 2026.
import { courtsPhrase, playerText, whenText, confirmText } from "../src/mensajes.js";
import { othersCount, samePerson } from "../src/ui.js";

let failed = 0;
const eq = (label, got, want) => {
  if (got === want) console.log("OK  ", label);
  else {
    failed++;
    console.log("FAIL", label, "\n     dio:     ", got, "\n     esperado:", want);
  }
};

const app = { courts: [1, 2, 3].map((id) => ({ id, name: `Pista ${id}` })), settings: { club_name: "Padel Mes Malgrat" } };
const HOY = "2026-11-06";
const jose = { name: "José Calero", phone: "600111222", player_id: null };
const diego = { name: "Diego Farías", phone: "611 222 333", player_id: null };
const r = { kind: "partido", day: HOY, start: 17 * 60 + 30, courts: [1], holder: jose };

eq("mensaje del ejemplo (hoy, Pista 1, a nombre del titular)",
  playerText(app, r, diego, HOY),
  "¡Hola Diego! ✅ Partido confirmado hoy, viernes 6, a las 17:30 en la Pista 1 de *Padel Mes Malgrat*, a nombre de José Calero. ¡Nos vemos!");
eq("al titular: «a tu nombre»", playerText(app, r, { ...jose, phone: "+34 600 111 222" }, HOY).endsWith(", a tu nombre. ¡Nos vemos!"), true);
eq("mañana", whenText("2026-11-07", 9 * 60, null, HOY), "mañana, sábado 7, a las 09:00");
eq("otro día, con la fecha", whenText("2026-11-15", 17 * 60 + 30, null, HOY), "el domingo 15 de noviembre a las 17:30");
eq("cada semana", whenText(HOY, 18 * 60, "2026-12-25", HOY), "todos los viernes a las 18:00, desde hoy hasta el 25 de diciembre,");
eq("2 pistas", courtsPhrase(app, [2, 1]), "las pistas 1 y 2");
eq("3 pistas", courtsPhrase(app, [1, 2, 3]), "las pistas 1, 2 y 3");
eq("pista con otro nombre", courtsPhrase({ courts: [{ id: 1, name: "Central" }, { id: 2, name: "Pista 2" }] }, [1, 2]), "Central y Pista 2");
eq("americana: el nombre va como título, sin «a nombre de»",
  playerText(app, { kind: "americana", day: "2026-11-12", start: 20 * 60, courts: [1, 2, 3], holder: { name: "Americana de los jueves" } }, diego, HOY),
  "¡Hola Diego! ✅ Americana confirmada (Americana de los jueves) el jueves 12 de noviembre a las 20:00 en las pistas 1, 2 y 3 de *Padel Mes Malgrat*. ¡Nos vemos!");
eq("jugador sin nombre de pila", playerText(app, r, { name: "", phone: "622" }, HOY).startsWith("¡Hola! ✅"), true);
eq("misma persona por teléfono con prefijo", samePerson({ name: "J", phone: "0034600111222" }, { name: "José", phone: "600 111 222" }), true);
eq("misma persona por nombre (sin tildes)", samePerson({ name: "jose calero" }, { name: "José  Calero" }), true);
eq("personas distintas", samePerson(diego, jose), false);
eq("«+3» en la parrilla: no cuenta al titular",
  othersCount({ name: "José Calero", phone: "600111222", players: [jose, diego, { name: "Mauri" }, { name: "Lucho" }] }), 3);
eq("reserva antigua sin lista", othersCount({ name: "Juan" }), 0);
const b = { court_id: 2, name: "Marta Soler", starts_at: new Date(2026, 10, 6, 19, 30).toISOString(), ends_at: new Date(2026, 10, 6, 21).toISOString() };
eq("titular: el mensaje de siempre sigue igual", confirmText(app, b),
  "Hola Marta, te confirmo la reserva en Padel Mes Malgrat: Pista 2, el viernes 6 de noviembre, de 19:30 a 21:00. ¡Nos vemos en la pista!");

console.log(failed ? `\n${failed} FALLO(S)` : "\nTodo OK");
process.exit(failed ? 1 : 0);
