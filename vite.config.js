import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true, port: 5183 },
  // Dos páginas: la agenda del club (/) y el bono público de los alumnos (/bono/).
  build: { rollupOptions: { input: { main: "index.html", bono: "bono/index.html" } } },
});
