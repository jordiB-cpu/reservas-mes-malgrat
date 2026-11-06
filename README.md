# Reservas Padel Mes Malgrat

Agenda de pistas del club (sustituye a Playtomic). Uso interno: solo entran
las cuentas con rol `admin` (Mily y Jordi), con la misma cuenta que la tienda.

- Vite + JS sin framework + Supabase (mismo proyecto que la tienda).
- `npm run dev:demo` → modo demo con reservas de ejemplo (sin Supabase).
- `npm run dev` → con Supabase (lee `.env`, copia de `.env.example`).
- `npm run test:db` → prueba el esquema y la seguridad en un Postgres local.
- `npm run test:msg` → prueba los textos de WhatsApp (hoy, mañana, pistas, titular).

## Puesta en marcha (una vez)

1. **Supabase** → SQL Editor → New query → pega `supabase/schema.sql` → Run.
   No toca nada de la tienda (todas las tablas empiezan por `court_`).
   Después, igual, `supabase/jugadores-reserva.sql` (quién juega en cada reserva).
2. **GitHub**: crea el repositorio privado `reservas-mes-malgrat` y sube esta carpeta.
3. **Cloudflare** → Workers → crear desde el repositorio, con el nombre
   `reservas-mes-malgrat` (tiene que coincidir con `wrangler.jsonc`).
4. Supabase → Authentication → URL Configuration: añade la URL publicada a
   las Redirect URLs (para el enlace de "he olvidado la contraseña").

## Pantallas

- **Día**: las pistas en columnas; tocar un hueco = reservar, tocar una reserva = editarla.
  Si en la reserva juegan más personas que el titular, sale "+3".
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
- **Pistas a elegir** (al crear): se marcan 1, 2 o las 3, en cualquier
  combinación, con el atajo "Todas". Por defecto, la del hueco pulsado. Crea la
  misma reserva en cada pista marcada, también con "Repetir cada semana" (una
  serie por pista). Va por `court_book_many`: todo o nada, y dice qué pista
  choca y con qué. Las pistas desactivadas en Ajustes no salen y la ficha lo avisa.
- **Quién juega**: en cualquier reserva se añaden los jugadores (hasta 4 por
  pista: 8 con 2 pistas, 12 con 3). Al escribir salen los de Jugadores; si
  coincide uno solo, se rellena su teléfono. Si no está, basta el nombre (el
  teléfono es opcional) y, con teléfono, se puede guardar también en Jugadores.
  Se guarda en `court_bookings.players`; las pistas reservadas a la vez
  comparten la lista (`group_id`). Ver `supabase/jugadores-reserva.sql`.
  **Sin ese SQL aplicado la app sigue funcionando**: guarda la reserva sin
  jugadores y lo avisa.
- **WhatsApp a cada jugador**: al guardar una reserva con jugadores, la hoja
  enseña a cada uno con su botón de WhatsApp (mensaje ya escrito con el día,
  la hora, las pistas y el titular) y "Enviar a todos", que abre uno detrás de
  otro (un toque por jugador). Al editar, cada jugador tiene su botón. El envío
  lo hace siempre la persona: la app solo abre `wa.me` con el texto.
  Para probar en la demo como si faltara el SQL:
  `localStorage.setItem("reservas-demo-sin-jugadores", "1")` y recargar.
- Cancelar no borra: marca `cancelled_at` (por eso se puede deshacer).
- Para dar acceso a monitores más adelante: cambiar `court_staff()` en el esquema.
