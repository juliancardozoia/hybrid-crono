import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "supabase/tests/**/*.test.ts"],
    // El entorno por defecto sigue siendo node: la logica pura y los tests de
    // base no necesitan DOM y arrancan mas rapido sin el. Los pocos tests de
    // componente piden jsdom con `// @vitest-environment jsdom` en su cabecera.
    // PGlite arranca un Postgres por archivo de test: mas lento que la logica pura.
    testTimeout: 60_000,
    // hookTimeout es SEPARADO de testTimeout y por defecto son 10s. El
    // beforeEach que siembra el escenario levanta un Postgres y aplica todas las
    // migraciones: con la maquina cargada (por ejemplo corriendo el build en
    // paralelo) se pasa de 10s, el hook falla y vitest reporta los tests como
    // "skipped" en vez de decir que fue timeout. Cuesta un rato entender por que
    // "fallan" tests que pasan solos.
    hookTimeout: 60_000,
  },
});
