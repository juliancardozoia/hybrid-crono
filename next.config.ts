import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // En desarrollo el service worker estorba mas de lo que ayuda: cachea el shell
  // y esconde los cambios. Las pruebas offline del checklist van sobre el build
  // de produccion (`npm run build && npm start`).
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {};

// POR QUE LOS DOS SCRIPTS LLEVAN SU FLAG EXPLICITO
//
// `withSerwist` inyecta una config de WEBPACK aunque el service worker este
// deshabilitado en desarrollo. Next 16 usa Turbopack por defecto y, al ver una
// config de webpack sin una de turbopack, aborta con un error fatal — antes era
// solo un aviso, y por eso `next dev` a secas dejo de arrancar.
//
// Los dos motores estan elegidos a proposito y no son intercambiables:
//
//   dev   --turbopack  arranque rapido. El SW esta deshabilitado igual, asi que
//                      no hace falta que webpack lo emita.
//   build --webpack    Serwist 9 emite el service worker VIA WEBPACK. Con
//                      Turbopack el build falla, y la base offline del producto
//                      no se apoya en `@serwist/turbopack`, que es experimental.

export default withSerwist(nextConfig);
