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

const ENTORNOS = ["production", "preview", "development"];

/**
 * Que variable va a que entorno. Por defecto, a los tres (`ENTORNOS`) — eso
 * cubre las claves de Supabase, que son las mismas en todos lados.
 *
 * Las de correo NO: mandar de verdad solo tiene sentido en produccion. Un
 * deploy de preview con EMAIL_DRIVER=resend le escribiria a gente real desde
 * una rama a medio probar; sin la variable ahi, `driverConfigurado()` FALLA en
 * vez de adivinar (Vercel corre los previews con NODE_ENV=production, asi que
 * "sin nada" no cae en 'log' solo). Por eso preview y development quedan en
 * 'log' explicito: la prueba se ve en la consola del deploy, nunca sale.
 */
const SOLO_PRODUCCION = ["production"];

const VARIABLES = [
  { nombre: "NEXT_PUBLIC_SUPABASE_URL" },
  { nombre: "NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  { nombre: "SUPABASE_SERVICE_ROLE_KEY" },
  // NEXT_PUBLIC_APP_URL de PRODUCCION no vive en .env.local (ahi apunta a
  // localhost, para el desarrollo) -- se carga una sola vez a mano con
  // `vercel env add NEXT_PUBLIC_APP_URL production --no-sensitive` y el
  // dominio propio, la unica vez que se define. Preview y development siguen
  // sin ella a proposito: ahi conviene que cada deploy use SU URL, que es lo
  // que appUrl() deduce sola sin la variable.
  // Correos. Los que no esten en .env.local se saltean con un aviso.
  { nombre: "EMAIL_DRIVER", entornos: SOLO_PRODUCCION, valor: "resend" },
  { nombre: "EMAIL_DRIVER", entornos: ["preview", "development"], valor: "log" },
  { nombre: "EMAIL_FROM", entornos: SOLO_PRODUCCION },
  { nombre: "EMAIL_REPLY_TO", entornos: SOLO_PRODUCCION },
  { nombre: "RESEND_API_KEY", entornos: SOLO_PRODUCCION },
  { nombre: "RESEND_WEBHOOK_SECRET", entornos: SOLO_PRODUCCION },
  { nombre: "CRON_SECRET", entornos: SOLO_PRODUCCION },
];

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

for (const { nombre, entornos = ENTORNOS, valor: fijo } of VARIABLES) {
  // `valor` fijo (los EMAIL_DRIVER por entorno) no depende de .env.local; el
  // resto si, y se saltea con un aviso si todavia no esta cargado ahi.
  const valor = fijo ?? env[nombre];
  if (!valor) {
    console.log(`  FALTA  ${nombre} no está en .env.local`);
    continue;
  }
  for (const entorno of entornos) {
    const { code, salida } = await agregar(nombre, valor, entorno);
    const yaExiste = /already (exists|been added)/i.test(salida);
    console.log(
      `  ${code === 0 ? "ok" : yaExiste ? "ya estaba" : "FALLA"}  ${nombre} (${entorno})`,
    );
  }
}

console.log("\nListo. Las claves nunca se imprimieron.\n");
