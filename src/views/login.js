import { api } from "../data/index.js";
import { $, busy, esc, toast } from "../ui.js";

export function renderLogin(view) {
  document.title = "Entrar · Reservas Mes Malgrat";
  view.innerHTML = `
  <section class="gate">
    <img src="/logo.webp" alt="" width="88" height="88" />
    <h1 class="gate-title">Reservas</h1>
    <p class="muted">La agenda de pistas de Padel Mes Malgrat. Entra con la misma cuenta que usas en la tienda.</p>
    <form class="form" id="login">
      <label class="field">Email<input name="email" type="email" required autocomplete="email" spellcheck="false" /></label>
      <label class="field">Contraseña<input name="password" type="password" required autocomplete="current-password" /></label>
      <button class="btn btn-primary btn-block" type="submit">Entrar</button>
      <button class="link-btn" type="button" id="forgot">He olvidado la contraseña</button>
    </form>
  </section>`;
  const f = $("#login", view);
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!f.reportValidity()) return;
    busy(e.submitter, () => api.signIn(Object.fromEntries(new FormData(f))));
  });
  $("#forgot", view).addEventListener("click", (e) => {
    if (!f.email.reportValidity()) return;
    busy(e.target, async () => {
      await api.resetPassword(f.email.value);
      toast("Si hay una cuenta con ese email, te hemos enviado un enlace para cambiar la contraseña.");
    });
  });
}

export function renderNoAccess(view, session) {
  view.innerHTML = `
  <section class="gate">
    <img src="/logo.webp" alt="" width="88" height="88" />
    <h1 class="gate-title">Solo para el club</h1>
    <p class="muted">La cuenta <strong>${esc(session.profile?.email ?? session.user.email)}</strong> no tiene acceso a la agenda de pistas. Pide al club que te dé permiso.</p>
    <button class="btn btn-block" type="button" id="out">Salir</button>
  </section>`;
  $("#out", view).addEventListener("click", () => api.signOut());
}
