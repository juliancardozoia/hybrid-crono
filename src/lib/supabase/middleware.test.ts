import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * La lista blanca del middleware decide que se puede abrir sin cuenta.
 *
 * Se verifica leyendo el archivo y no importando la funcion porque `isPublic`
 * no se exporta, y exportarla solo para el test cambiaria la superficie del
 * modulo. Lo que importa es que nadie saque una ruta publica sin darse cuenta:
 * el sintoma seria un atleta que abre el link de una competencia y termina en
 * una pantalla de login.
 */
function listaBlanca(): string[] {
  const fuente = readFileSync("src/lib/supabase/middleware.ts", "utf8");
  const bloque = fuente.match(/const PUBLIC_PREFIXES = \[([\s\S]*?)\];/);
  if (!bloque) throw new Error("No se encontró PUBLIC_PREFIXES en el middleware.");
  return [...bloque[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("rutas públicas", () => {
  it("el catálogo, la ficha de un evento y el leaderboard se abren sin cuenta", () => {
    const publicas = listaBlanca();
    for (const ruta of ["/eventos", "/en-vivo", "/login", "/registro", "/auth"]) {
      expect(publicas).toContain(ruta);
    }
  });

  it("el panel y la pantalla del juez exigen sesión", () => {
    const publicas = listaBlanca();
    // Ninguna ruta privada puede quedar cubierta por un prefijo publico.
    for (const privada of ["/panel", "/juez", "/api/resultados"]) {
      expect(publicas.some((p) => privada.startsWith(p))).toBe(false);
    }
  });
});
