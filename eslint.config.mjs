import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `_prev`/`_formData` con guion bajo es la convencion que ya usaba el
      // proyecto para "esto lo pide la firma de `useActionState`, no un
      // parametro que se me olvido usar" — por ejemplo en `createEvent` de
      // `features/events/actions.ts`. Sin este ignore, cada accion de
      // servidor SIN campos (un boton suelto que solo cambia un estado)
      // marca los dos como no usados; con campos que si usan `formData`
      // nunca lo disparaba, asi que recien se noto al escribir la primera.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generado por Serwist a partir de src/app/sw.ts. Se edita aquel.
    "public/sw.js",
    "public/sw.js.map",
  ]),
]);

export default eslintConfig;
