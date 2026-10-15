export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const icon = (name, label) =>
  `<svg class="icon" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}><use href="#i-${name}"/></svg>`;
export const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Tipos de reserva: nombre y color (el color también lo usa el CSS). */
export const KINDS = {
  partido: { label: "Partido", color: "#007a46" },
  clase: { label: "Clase", color: "#1f6fd6" },
  escuela: { label: "Escuela", color: "#b07d00" },
  snp: { label: "SNP", color: "#703080" },
  americana: { label: "Americana", color: "#d1580f" },
  torneo: { label: "Torneo", color: "#b42318" },
  mantenimiento: { label: "Mantenimiento", color: "#5d6862" },
};

/* Aviso abajo, con un botón opcional (Deshacer, WhatsApp…). */
export function toast(msg, { kind = "ok", action, onAction, href, ms } = {}) {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast${kind === "error" ? " toast-error" : ""}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.innerHTML = `${icon(kind === "error" ? "close" : "check")}<span>${esc(msg)}</span>${
    action ? (href ? `<a class="toast-btn" href="${esc(href)}" target="_blank" rel="noopener">${esc(action)}</a>` : `<button type="button" class="toast-btn">${esc(action)}</button>`) : ""
  }`;
  box.appendChild(el);
  const close = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 350);
  };
  el.querySelector(".toast-btn")?.addEventListener("click", () => {
    onAction?.();
    close();
  });
  setTimeout(close, ms ?? (action ? 7000 : kind === "error" ? 6000 : 2600));
}

/* Teléfono español → número para wa.me (34 + 9 cifras). */
export function waNumber(phone) {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 9) d = "34" + d;
  return d.length >= 11 ? d : null;
}
export const waLink = (phone, text) => {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
};

export async function busy(btn, fn) {
  const label = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Guardando…";
  }
  try {
    return await fn();
  } catch (e) {
    toast(e.message || "No se ha podido guardar. Inténtalo otra vez.", { kind: "error" });
  } finally {
    if (btn?.isConnected) {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }
}
