import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">Hybrid Crono</h1>
        <p className="mt-2 text-neutral-500">
          Cronometraje de competencias por tiempo.
        </p>
      </div>

      <nav className="flex flex-col gap-3">
        <Link
          href="/juez"
          className="rounded-2xl border border-neutral-700 p-5 transition-colors hover:bg-neutral-900"
        >
          <span className="block font-semibold">Soy juez</span>
          <span className="text-sm text-neutral-500">
            Tomá tu carril y cronometrá. Funciona sin conexión.
          </span>
        </Link>
        <Link
          href="/panel"
          className="rounded-2xl border border-neutral-700 p-5 transition-colors hover:bg-neutral-900"
        >
          <span className="block font-semibold">Soy organizador</span>
          <span className="text-sm text-neutral-500">
            Configurá la competencia, carga atletas y arma los heats.
          </span>
        </Link>
        <Link
          href="/spike"
          className="rounded-2xl border border-neutral-700 p-5 transition-colors hover:bg-neutral-900"
        >
          <span className="block font-semibold">Laboratorio del cronómetro</span>
          <span className="text-sm text-neutral-500">
            Sin login ni base de datos: para probar el reloj y la cola offline.
          </span>
        </Link>
        <Link
          href="/spike/servidor"
          className="rounded-2xl border border-neutral-700 p-5 transition-colors hover:bg-neutral-900"
        >
          <span className="block font-semibold">Estado del servidor</span>
          <span className="text-sm text-neutral-500">
            Que marcajes llegaron y verificacion de idempotencia.
          </span>
        </Link>
      </nav>
    </main>
  );
}
