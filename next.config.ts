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

export default withSerwist(nextConfig);
