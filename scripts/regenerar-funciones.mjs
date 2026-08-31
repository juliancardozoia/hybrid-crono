/**
 * Arma una migracion que redefine las funciones cuyos mensajes cambiaron.
 *
 * POR QUE HACE FALTA
 *
 * Editar una migracion ya aplicada NO cambia la base: Supabase lleva registro de
 * cuales corrio y no las vuelve a correr. Asi que al pasar los mensajes a
 * espanol neutro, una base nueva quedaria con el texto corregido y la de
 * produccion seguiria con el viejo.
 *
 * Este script extrae la ULTIMA definicion de cada funcion afectada —una funcion
 * puede haberse redefinido varias veces a lo largo de las migraciones— y las
 * junta en una migracion nueva.
 *
 *   node scripts/regenerar-funciones.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";

/** Funciones que exponen mensajes al usuario y por lo tanto cambiaron. */
const AFECTADAS = [
  "reorder_segments",
  "import_teams",
  "assign_heat_lanes",
  "start_heat",
  "cancel_heat_start",
  "claim_lane",
  "transfer_lane",
  "ingest_timing_events",
  "void_timing_event",
  "verify_results",
  "publish_results",
  "invite_to_org",
  "remove_org_member",
];

/** Ultima definicion de cada funcion, recorriendo las migraciones en orden. */
const ultima = new Map();

for (const archivo of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
  const lineas = readFileSync(join(DIR, archivo), "utf8").split("\n");

  let capturando = null;
  let bloque = [];

  for (const linea of lineas) {
    if (capturando === null) {
      const m = linea.match(/^create or replace function public\.(\w+)\s*\(/);
      if (m && AFECTADAS.includes(m[1])) {
        capturando = m[1];
        bloque = [linea];
      }
      continue;
    }

    bloque.push(linea);

    // El cuerpo cierra con `$$;` solo, al principio de la linea.
    if (linea.trim() === "$$;") {
      ultima.set(capturando, bloque.join("\n"));
      capturando = null;
      bloque = [];
    }
  }
}

const faltantes = AFECTADAS.filter((f) => !ultima.has(f));
if (faltantes.length > 0) {
  console.error("No se encontro la definicion de: " + faltantes.join(", "));
  process.exit(1);
}

const encabezado = `-- Mensajes de las funciones en espanol neutro.
--
-- POR QUE ESTA MIGRACION EXISTE
--
-- Los mensajes que estas funciones le muestran al usuario pasaron de voseo
-- rioplatense a espanol neutro: "no tenes permiso" -> "no tienes permiso",
-- "el carril ya lo tomo otro juez" -> "ya lo tomo otro juez" con tilde, "dueno"
-- -> "dueno" con enie.
--
-- Editar las migraciones viejas no alcanza: Supabase no vuelve a correr una
-- migracion ya aplicada, asi que una base nueva quedaria con el texto corregido
-- y la de produccion seguiria con el viejo. Esta migracion redefine las
-- funciones para que las dos terminen iguales.
--
-- Generada por scripts/regenerar-funciones.mjs a partir de la ultima definicion
-- de cada funcion, para no re-escribirlas a mano y arriesgar divergencias.

`;

const cuerpo = AFECTADAS.map((f) => ultima.get(f)).join("\n\n");
const pie = "\n\nselect public.apply_function_lockdown();\n";

const destino = join(DIR, "20260822101900_mensajes_neutros.sql");
writeFileSync(destino, encabezado + cuerpo + pie);

console.log(`${destino}: ${AFECTADAS.length} funciones redefinidas.`);
