# Reservas Padel Mes Malgrat

Agenda de pistas del club (sustituye a Playtomic). Uso interno: solo entran
las cuentas con rol `admin` (Mily y Jordi), con la misma cuenta que la tienda.

- Vite + JS sin framework + Supabase (mismo proyecto que la tienda).
- `npm run dev:demo` → modo demo con reservas de ejemplo (sin Supabase).
- `npm run dev` → con Supabase (lee `.env`, copia de `.env.example`).
- `npm run test:db` → prueba el esquema y la seguridad en un Postgres local.

## Puesta en marcha (una vez)

1. **Supabase** → SQL Editor → New query → pega `supabase/schema.sql` → Run.
   No toca nada de la tienda (todas las tablas empiezan por `court_`).
2. **GitHub**: crea el repositorio privado `reservas-mes-malgrat` y sube esta carpeta.
3. **Cloudflare** → Workers → crear desde el repositorio, con el nombre
   `reservas-mes-malgrat` (tiene que coincidir con `wrangler.jsonc`).
4. Supabase → Authentication → URL Configuration: añade la URL publicada a
   las Redirect URLs (para el enlace de "he olvidado la contraseña").

## Pantallas

- **Día**: las pistas en columnas; tocar un hueco = reservar, tocar una reserva = editarla.
- **Semana**: parrilla de 7 días en el ordenador; en el móvil, lista por día con su ocupación.
- **Jugadores**: agenda con buscador; cada ficha tiene llamar, WhatsApp y su historial (próximas, anteriores y sin pagar).
- **Ajustes**: nombre y estado de cada pista, horario y duración habitual de cada tipo.
- Instalable en el móvil (Añadir a pantalla de inicio): `public/manifest.webmanifest` + `public/sw.js`
  (el service worker solo guarda la carcasa de la app; las reservas siempre van en directo).

## Cómo funciona

- Parrilla de 30 minutos, 3 pistas, de 7:00 a 22:30 (tabla `court_settings`).
- La base de datos impide solapar reservas en la misma pista
  (`court_bookings_no_overlap`), aunque se guarden a la vez.
- "Repetir cada semana" crea todas las fechas de golpe con `court_book_many`:
  si alguna choca, no se crea ninguna y la app enseña los choques.
- Cancelar no borra: marca `cancelled_at` (por eso se puede deshacer).
- Para dar acceso a monitores más adelante: cambiar `court_staff()` en el esquema.
