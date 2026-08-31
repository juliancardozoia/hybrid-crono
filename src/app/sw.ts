/**
 * Service worker.
 *
 * Sin esto, un juez que reinicia el celular en medio de la carrera y vuelve a
 * abrir la app sin senal no ve nada: el navegador no puede ir a buscar el HTML.
 * Cachear el app shell es lo que convierte "el tiempo esta guardado" en "el
 * juez puede seguir marcando".
 */

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        // Si el juez reinicia el celular sin señal y vuelve a abrir la app, esta
        // es la pagina que se sirve del cache. Es estatica y lee el carril del
        // query string, asi que sigue funcionando sin servidor.
        url: "/juez/carril",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
