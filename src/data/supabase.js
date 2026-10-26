// Backend real: Supabase. Quién puede ver/tocar la agenda lo decide la base
// de datos (RLS, court_staff() en supabase/schema.sql), no la web.
import { createClient } from "@supabase/supabase-js";

const COLS = "id, court_id, starts_at, ends_at, kind, player_id, name, phone, notes, paid, series_id, created_by, created_at";

function friendly(msg) {
  if (/court_bookings_no_overlap|exclusion/i.test(msg)) return "Ese hueco ya está ocupado en esa pista.";
  if (/court_players_phone_key/.test(msg)) return "Ya hay un jugador con ese teléfono.";
  if (/Invalid login credentials/i.test(msg)) return "Email o contraseña incorrectos.";
  if (/row-level security|permission denied/i.test(msg)) return "Tu cuenta no tiene permiso para la agenda del club.";
  if (/Failed to fetch|NetworkError/i.test(msg)) return "Sin conexión. Revisa internet y vuelve a intentarlo.";
  return msg;
}

export function createSupabaseBackend(url, key) {
  const sb = createClient(url, key);
  const unwrap = ({ data, error }) => {
    if (error) throw new Error(friendly(error.message));
    return data;
  };

  return {
    mode: "supabase",
    async session() {
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      if (!user) return null;
      const { data: profile } = await sb.from("profiles").select("id, email, full_name, role").eq("id", user.id).maybeSingle();
      return { user, profile: profile ?? { id: user.id, email: user.email, role: "customer" } };
    },
    onAuthChange(cb) {
      sb.auth.onAuthStateChange((event) => cb(event));
    },
    async signIn({ email, password }) {
      unwrap(await sb.auth.signInWithPassword({ email, password }));
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async resetPassword(email) {
      unwrap(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin }));
    },

    async loadConfig() {
      const [courts, settings, staff] = await Promise.all([
        sb.from("courts").select("*").eq("active", true).order("sort").then(unwrap),
        sb.from("court_settings").select("key, value, label").then(unwrap),
        // Quién puede reservar (para saber quién hizo cada reserva).
        sb.from("profiles").select("id, full_name, email").eq("role", "admin").then(unwrap),
      ]);
      return { courts, settings: Object.fromEntries(settings.map((s) => [s.key, s.value])), staff };
    },
    async bookings(fromIso, toIso) {
      return unwrap(await sb.from("court_bookings").select(COLS).is("cancelled_at", null).lt("starts_at", toIso).gt("ends_at", fromIso).order("starts_at"));
    },
    async bookMany(items) {
      const [r] = unwrap(await sb.rpc("court_book_many", { p_items: items }));
      return { ok: r.ok, ids: r.ids ?? [], conflicts: r.conflicts ?? [] };
    },
    async updateBooking(id, patch) {
      unwrap(await sb.from("court_bookings").update(patch).eq("id", id));
    },
    async cancel(ids) {
      unwrap(await sb.from("court_bookings").update({ cancelled_at: new Date().toISOString() }).in("id", ids));
    },
    async restore(ids) {
      unwrap(await sb.from("court_bookings").update({ cancelled_at: null }).in("id", ids));
    },
    async seriesFrom(seriesId, fromIso) {
      return unwrap(await sb.from("court_bookings").select("id").eq("series_id", seriesId).is("cancelled_at", null).gte("starts_at", fromIso)).map((r) => r.id);
    },
    async searchPlayers(q) {
      const t = q.trim().replace(/[%,()]/g, " ");
      if (t.length < 2) return [];
      return unwrap(await sb.from("court_players").select("id, name, phone").or(`name.ilike.%${t}%,phone.ilike.%${t}%`).order("name").limit(6));
    },
    async ensurePlayer({ name, phone }) {
      if (phone) {
        const found = unwrap(await sb.from("court_players").select("id").eq("phone", phone).maybeSingle());
        if (found) return found.id;
      }
      return unwrap(await sb.from("court_players").insert({ name, phone: phone || null }).select("id").single()).id;
    },

    // ---- Jugadores ----
    async players() {
      return unwrap(await sb.from("court_players").select("id, name, phone, notes, created_at").order("name"));
    },
    async savePlayer(id, patch) {
      if (id) return unwrap(await sb.from("court_players").update(patch).eq("id", id));
      return unwrap(await sb.from("court_players").insert(patch).select("id").single()).id;
    },
    async deletePlayer(id) {
      unwrap(await sb.from("court_players").delete().eq("id", id));
    },
    // Reservas de un jugador: las enlazadas o, en las antiguas, por teléfono.
    async playerBookings(player) {
      let q = sb.from("court_bookings").select(COLS).is("cancelled_at", null).order("starts_at", { ascending: false }).limit(200);
      q = player.phone ? q.or(`player_id.eq.${player.id},phone.eq.${player.phone}`) : q.eq("player_id", player.id);
      return unwrap(await q);
    },

    // ---- Ajustes ----
    async allCourts() {
      return unwrap(await sb.from("courts").select("*").order("sort"));
    },
    async saveCourt(id, patch) {
      unwrap(await sb.from("courts").update(patch).eq("id", id));
    },
    async saveSettings(map) {
      const rows = Object.entries(map).map(([key, value]) => ({ key, value }));
      unwrap(await sb.from("court_settings").upsert(rows, { onConflict: "key" }));
    },
  };
}
