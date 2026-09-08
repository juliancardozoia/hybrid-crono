"use client";

import { useState } from "react";
import { Modal } from "@/shared/components/Modal";
import type { WodStructure } from "@/shared/timing/wod";
import { VistaPreviaInteractivaWod } from "./VistaPreviaInteractivaWod";

/**
 * Boton que abre la simulacion de la pantalla del juez para esta prueba.
 *
 * Separado de `VistaPreviaDelWod` (la lista estatica de pasos) a proposito:
 * esa responde "que va a marcar el juez, en orden"; esta responde "como se
 * SIENTE marcarlo" — mismo dato, otra pregunta.
 */
export function SimuladorDeJuez({ estructura }: { estructura: WodStructure }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-xl border border-neutral-700 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-900"
      >
        ▶ Simular pantalla del juez
      </button>

      <Modal abierto={abierto} alCerrar={() => setAbierto(false)} titulo="Simulación del juez">
        {/* Remonta en cada apertura: sin esto un intento a medias (un WOD ya
            "largado" en la simulacion) quedaria pegado la proxima vez. */}
        {abierto && <VistaPreviaInteractivaWod key="abierto" estructura={estructura} />}
      </Modal>
    </>
  );
}
