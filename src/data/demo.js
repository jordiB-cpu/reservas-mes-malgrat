// MODO DEMO: sin Supabase. Misma interfaz que supabase.js, datos solo en
// este navegador (localStorage), con unas reservas de ejemplo para ver la
// agenda llena. Imita las reglas de la base de datos (sin solapes, series
// todo o nada) para que la app se comporte igual.
import { addDays, at, today } from "../time.js";

const KEY = "reservas-demo-v1";
const overlap = (a, b) => a.court_id === b.court_id && new Date(a.starts_at) < new Date(b.ends_at) && new Date(b.starts_at) < new Date(a.ends_at);

function seed() {
  const t = today();
  const b = (day, court, h, dur, kind, name, phone, extra = {}) => ({
    id: crypto.randomUUID(), court_id: court, starts_at: at(day, h * 60), ends_at: at(day, h * 60 + dur), kind, name, phone: phone ?? null,
    notes: null, paid: false, series_id: null, player_id: null, cancelled_at: null, ...extra,
  });
  const serie = crypto.randomUUID();
  const bookings = [
    b(t, 1, 9, 90, "partido", "Juan Pérez", "600111222", { paid: true }),
    b(t, 2, 10, 60, "clase", "Clase de Laura (iniciación)", "611222333"),
    b(t, 1, 17, 60, "escuela", "Escuela infantil", null, { series_id: serie }),
    b(t, 2, 17, 60, "escuela", "Escuela infantil", null, { series_id: serie }),
    b(t, 3, 18, 90, "snp", "SNP 2ª Masculino", null),
    b(t, 1, 19.5, 90, "partido", "Marta Soler", "622333444"),
    b(t, 3, 20, 120, "americana", "Americana de los jueves", null),
    b(addDays(t, 1), 2, 8, 60, "mantenimiento", "Limpieza de cristales", null),
    b(addDays(t, 1), 1, 19, 90, "partido", "Juan Pérez", "600111222"),
  ];
  const players = [
    { id: crypto.randomUUID(), name: "Juan Pérez", phone: "600111222" },
    { id: crypto.randomUUID(), name: "Marta Soler", phone: "622333444" },
    { id: crypto.randomUUID(), name: "Laura Gil", phone: "611222333" },
  ];
  return { bookings, players };
}

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) return s; } catch {}
  const s = seed();
  save(s);
  return s;
}
function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}
const wait = (v) => new Promise((r) => setTimeout(() => r(v), 120));

export function createDemoBackend() {
  return {
    mode: "demo",
    async session() {
      return { user: { id: "demo", email: "mily@demo" }, profile: { id: "demo", email: "mily@demo", full_name: "Mily (demo)", role: "admin" } };
    },
    onAuthChange() {},
    async signIn() {},
    async signOut() {
      localStorage.removeItem(KEY);
      location.reload();
    },
    async resetPassword() {},

    async loadConfig() {
      const s = config();
      return wait({ courts: s.courts.filter((c) => c.active).sort((a, b) => a.sort - b.sort), settings: s.settings });
    },
    async allCourts() {
      return wait(config().courts.sort((a, b) => a.sort - b.sort));
    },
    async saveCourt(id, patch) {
      const s = load();
      config(s);
      Object.assign(s.courts.find((c) => c.id === id), patch);
      save(s);
      return wait();
    },
    async saveSettings(map) {
      const s = load();
      config(s);
      Object.assign(s.settings, map);
      save(s);
      return wait();
    },
    async bookings(fromIso, toIso) {
      const s = load();
      return wait(s.bookings.filter((b) => !b.cancelled_at && b.starts_at < toIso && b.ends_at > fromIso).sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
    },
    async bookMany(items) {
      const s = load();
      const live = s.bookings.filter((b) => !b.cancelled_at);
      const conflicts = [];
      for (const it of items) {
        const other = live.find((b) => overlap(b, it));
        if (other) conflicts.push({ starts_at: it.starts_at, court_id: it.court_id, with: { id: other.id, name: other.name, kind: other.kind, starts_at: other.starts_at, ends_at: other.ends_at } });
      }
      if (conflicts.length) return wait({ ok: false, ids: [], conflicts });
      const ids = items.map((it) => {
        const id = crypto.randomUUID();
        s.bookings.push({ id, notes: null, paid: false, series_id: null, player_id: null, phone: null, ...it, cancelled_at: null });
        return id;
      });
      save(s);
      return wait({ ok: true, ids, conflicts: [] });
    },
    async updateBooking(id, patch) {
      const s = load();
      const b = s.bookings.find((x) => x.id === id);
      const next = { ...b, ...patch };
      if (!next.cancelled_at && s.bookings.some((x) => x.id !== id && !x.cancelled_at && overlap(x, next))) throw new Error("Ese hueco ya está ocupado en esa pista.");
      Object.assign(b, patch);
      save(s);
      return wait();
    },
    async cancel(ids) {
      const s = load();
      s.bookings.forEach((b) => ids.includes(b.id) && (b.cancelled_at = new Date().toISOString()));
      save(s);
      return wait();
    },
    async restore(ids) {
      const s = load();
      for (const b of s.bookings.filter((x) => ids.includes(x.id))) {
        if (s.bookings.some((x) => x.id !== b.id && !x.cancelled_at && overlap(x, b))) throw new Error("No se puede deshacer: ese hueco ya se ha ocupado.");
        b.cancelled_at = null;
      }
      save(s);
      return wait();
    },
    async seriesFrom(seriesId, fromIso) {
      return load().bookings.filter((b) => b.series_id === seriesId && !b.cancelled_at && b.starts_at >= fromIso).map((b) => b.id);
    },
    async searchPlayers(q) {
      const t = q.trim().toLowerCase();
      if (t.length < 2) return [];
      return load().players.filter((p) => p.name.toLowerCase().includes(t) || (p.phone ?? "").includes(t)).slice(0, 6);
    },
    async ensurePlayer({ name, phone }) {
      const s = load();
      const found = phone && s.players.find((p) => p.phone === phone);
      if (found) return found.id;
      const p = { id: crypto.randomUUID(), name, phone: phone || null };
      s.players.push(p);
      save(s);
      return p.id;
    },
    async players() {
      return wait([...load().players].sort((a, b) => a.name.localeCompare(b.name, "es")));
    },
    async savePlayer(id, patch) {
      const s = load();
      if (patch.phone && s.players.some((p) => p.id !== id && p.phone === patch.phone)) throw new Error("Ya hay un jugador con ese teléfono.");
      if (id) Object.assign(s.players.find((p) => p.id === id), patch);
      else s.players.push({ id: (id = crypto.randomUUID()), ...patch });
      save(s);
      return wait(id);
    },
    async deletePlayer(id) {
      const s = load();
      s.players = s.players.filter((p) => p.id !== id);
      s.bookings.forEach((b) => b.player_id === id && (b.player_id = null));
      save(s);
      return wait();
    },
    async playerBookings(player) {
      return wait(load().bookings.filter((b) => !b.cancelled_at && (b.player_id === player.id || (player.phone && b.phone === player.phone))).sort((a, b) => b.starts_at.localeCompare(a.starts_at)));
    },
  };
}

/* Pistas y ajustes de la demo (se guardan junto a las reservas). */
const DEFAULTS = () => ({
  courts: [1, 2, 3].map((id) => ({ id, name: `Pista ${id}`, sort: id, active: true })),
  settings: { open: "07:00", close: "22:30", slot_minutes: 30, club_name: "Padel Mes Malgrat", durations: { partido: 90, clase: 60, escuela: 60, snp: 90, americana: 120, torneo: 120, mantenimiento: 60 } },
});
function config(s = load()) {
  if (!s.courts || !s.settings) Object.assign(s, DEFAULTS());
  return s;
}
