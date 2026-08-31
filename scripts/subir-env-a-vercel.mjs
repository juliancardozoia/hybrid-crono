/**
 * Copia las variables de .env.local al proyecto de Vercel.
 *
 * Lee los valores del archivo y los pasa por stdin al CLI: no los imprime ni los
 * deja en el historial del shell.
 *
 *   node scripts/subir-env-a-vercel.mjs
 */

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}

// NEXT_PUBLIC_APP_URL no se copia a proposito: en local apunta a localhost, y
// en Vercel appUrl() lo deduce solo del dominio del deploy.
const VARIABLES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const ENTORNOS = ["production", "preview", "development"];

/**
 * Las NEXT_PUBLIC_* van como no sensibles a la fuerza.
 *
 * Vercel las marca como secretas por defecto y despues rechaza esa combinacion
 * en produccion, con razon: una NEXT_PUBLIC se inlinea en el bundle del cliente,
 * asi que tratarla como secreto seria mentirse. La anon key es publica por
 * diseño; lo que protege los datos es RLS.
 */
function agregar(nombre, valor, entorno) {
  const extra = nombre.startsWith("NEXT_PUBLIC_") ? ["--no-sensitive"] : [];
  return new Promise((resolve) => {
    const p = spawn("npx", ["vercel", "env", "add", nombre, entorno, ...extra], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });
    let salida = "";
    p.stdout.on("data", (d) => (salida += d));
    p.stderr.on("data", (d) => (salida += d));
    p.stdin.write(valor + "\n");
    p.stdin.end();
    p.on("close", (code) => resolve({ code, salida }));
  });
}

for (const nombre of VARIABLES) {
  const valor = env[nombre];
  if (!valor) {
    console.log(`  FALTA  ${nombre} no está en .env.local`);
    continue;
  }
  for (const entorno of ENTORNOS) {
    const { code, salida } = await agregar(nombre, valor, entorno);
    const yaExiste = /already exists/i.test(salida);
    console.log(
      `  ${code === 0 ? "ok" : yaExiste ? "ya estaba" : "FALLA"}  ${nombre} (${entorno})`,
    );
  }
}

console.log("\nListo. Las claves nunca se imprimieron.\n");
