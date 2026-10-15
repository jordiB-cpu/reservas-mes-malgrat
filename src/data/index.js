// Elige backend: Supabase si hay claves en .env, si no MODO DEMO.
import { createSupabaseBackend } from "./supabase.js";
import { createDemoBackend } from "./demo.js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const api = url && key ? createSupabaseBackend(url, key) : createDemoBackend();
