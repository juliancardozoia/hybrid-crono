"use client";

import { useState } from "react";
import { Modal } from "@/shared/components/Modal";
import type { SegmentRow } from "@/lib/supabase/types";
import { VistaPreviaInteractivaCircuito } from "./VistaPreviaInteractivaCircuito";

/** Boton que abre la simulacion de la pantalla del juez para un circuito. */
export function SimuladorDeJuezCircuito({ segments }: { segments: SegmentRow[] }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-xs text-neutral-500 hover:text-neutral-300"
      >
        ▶ Simular pantalla del juez
      </button>

      <Modal abierto={abierto} alCerrar={() => setAbierto(false)} titulo="Simulación del juez">
        {abierto && <VistaPreviaInteractivaCircuito key="abierto" segments={segments} />}
      </Modal>
    </>
  );
}
