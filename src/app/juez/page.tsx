import Link from "next/link";
import { claimLane } from "@/features/judge/actions";
import { getJudgeLanes, type JudgeLane, type LanesResult } from "@/features/judge/queries";
import { ClaimButton } from "@/features/judge/components/ClaimButton";

export const metadata = { title: "Carriles — Hybrid Crono" };

export default async function JuezPage() {
  const { mios, libres, motivo } = await getJudgeLanes();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 p-5">
      <header>
        <h1 className="text-2xl font-bold">Tus carriles</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Tomá tu carril con señal, antes de que largue el heat. Después la pantalla del
          cronómetro funciona sin conexión.
        </p>
      </header>

      {mios.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
            Asignados a ti
          </h2>
          <ul className="flex flex-col gap-2">
            {mios.map((lane) => (
              <li key={lane.laneId}>
                <Link
                  href={`/juez/carril?id=${lane.laneId}`}
                  className="block rounded-2xl border border-lime-500/40 bg-lime-500/5 p-4 transition-colors hover:bg-lime-500/10"
                >
                  <LaneInfo lane={lane} />
                  <p className="mt-2 text-sm font-semibold text-lime-400">
                    {lane.heatStartedAt ? "Heat en curso — abrir cronómetro" : "Abrir cronómetro"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
          Libres
        </h2>
        {libres.length === 0 ? (
          <SinCarriles motivo={motivo} hayPropios={mios.length > 0} />
        ) : (
          <ul className="flex flex-col gap-2">
            {libres.map((lane) => (
              <li key={lane.laneId} className="rounded-2xl border border-neutral-800 p-4">
                <LaneInfo lane={lane} />
                <ClaimButton laneId={lane.laneId} action={claimLane} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/**
 * Explica POR QUE no hay carriles.
 *
 * Antes decia "no hay carriles disponibles, puede que la competencia todavia no
 * este lista", que es exactamente el tipo de mensaje que deja a alguien mirando
 * la pantalla sin saber que tocar.
 */
function SinCarriles({
  motivo,
  hayPropios,
}: {
  motivo: LanesResult["motivo"];
  hayPropios: boolean;
}) {
  if (hayPropios && motivo === null) {
    return (
      <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
        No quedan carriles libres.
      </p>
    );
  }

  const copy: Record<string, { titulo: string; detalle: string; accion?: string }> = {
    "sin-organizacion": {
      titulo: "No perteneces a ninguna organizacion",
      detalle: "Pídele al organizador que te agregue como juez.",
    },
    "sin-eventos": {
      titulo: "Todavia no hay competencias",
      detalle: "El organizador tiene que crear una desde el panel.",
      accion: "/panel",
    },
    "eventos-en-borrador": {
      titulo: "La competencia esta en borrador",
      detalle:
        "Los carriles ya estan armados, pero la competencia todavia no se puso en vivo. En el panel: Resumen -> Marcar como lista -> Poner en vivo.",
      accion: "/panel",
    },
    "sin-carriles": {
      titulo: "No hay heats armados",
      detalle: "El organizador tiene que crear los heats y asignarles los equipos.",
      accion: "/panel",
    },
    "carriles-sin-atleta": {
      titulo: "Los carriles no tienen atletas",
      detalle:
        "Los heats existen pero ningun carril tiene un equipo asignado. En el panel: Heats -> elegir el equipo de cada carril -> Guardar carriles.",
      accion: "/panel",
    },
    "todos-tomados": {
      titulo: "Todos los carriles ya tienen juez",
      detalle: "Si te corresponde uno, pídele a la organizacion que te lo transfiera.",
    },
  };

  const c = copy[motivo ?? "todos-tomados"];

  return (
    <div className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center">
      <p className="font-semibold">{c.titulo}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-500">{c.detalle}</p>
      {c.accion && (
        <Link
          href={c.accion}
          className="mt-4 inline-block rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900"
        >
          Ir al panel
        </Link>
      )}
    </div>
  );
}

function LaneInfo({ lane }: { lane: JudgeLane }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="font-mono text-2xl font-bold tabular-nums">
          {lane.bib !== null ? `#${lane.bib}` : "—"}
        </p>
        <p className="text-sm">{lane.athletes}</p>
        <p className="text-xs text-neutral-500">
          {[lane.divisionName, lane.eventName].filter(Boolean).join(" · ")}
        </p>
      </div>
      <p className="text-right text-xs text-neutral-500">
        {lane.heatName}
        <br />
        carril {lane.laneNumber}
      </p>
    </div>
  );
}
