import { Suspense } from "react";
import { CarrilClient } from "@/features/judge/components/CarrilClient";

export const metadata = { title: "Cronómetro — Scora" };

/**
 * Server component sin datos, a proposito: asi Next la prerenderiza estatica y
 * el service worker la puede precachear. Todo el trabajo pasa en el cliente,
 * leyendo el carril del query string y los datos de IndexedDB.
 *
 * El Suspense es obligatorio: useSearchParams dentro de una pagina estatica lo
 * exige, y sin el Next la degrada a renderizado dinamico.
 */
export default function CarrilPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-neutral-950 text-neutral-500">
          <p>Cargando carril…</p>
        </main>
      }
    >
      <CarrilClient />
    </Suspense>
  );
}
