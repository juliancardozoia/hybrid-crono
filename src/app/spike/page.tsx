"use client";

import { CIRCUITO_DEMO, PENALIZACIONES_DEMO } from "@/features/events/lib/courseTemplates";
import { JudgeScreen } from "@/features/judge/components/JudgeScreen";
import { spikeTransport } from "@/features/judge/lib/sync";

/**
 * Laboratorio offline del cronometro.
 *
 * Sigue existiendo despues de la fase 4 porque es la unica pantalla que corre
 * sin login, sin base de datos y sin heat: sirve para probar el comportamiento
 * del reloj y de la cola de sincronizacion aislado de todo lo demas, que es
 * justo lo que pide el checklist de aceptacion.
 *
 * Larga en el dispositivo y sincroniza contra el endpoint en memoria, no contra
 * Supabase.
 */
export default function SpikePage() {
  return (
    <JudgeScreen
      laneId="spike-lane-1"
      bib="042"
      athlete="Atleta de prueba"
      subtitle="Modo laboratorio · sin base de datos"
      segments={CIRCUITO_DEMO}
      penalties={PENALIZACIONES_DEMO}
      heatStartEpochMs={null}
      recordedBy="spike-judge"
      transport={spikeTransport}
      localStart="siempre"
      allowReset
    />
  );
}
