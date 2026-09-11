// @vitest-environment jsdom

/*
 * La pantalla del juez de CrossFit. El primer test que tiene.
 *
 * Lo que se prueba es la ERGONOMIA, que es donde se rompe:
 *
 *   Los tres estilos de captura ofrecen lo que corresponde, y "CONTAR A MANO"
 *   baja un paso a tap SIN escribir nada — es lo que hace seguro tener un
 *   default derivado.
 *
 *   "MOVIMIENTO ✓" ya no cierra en silencio con `max(objetivo, progreso)`: si
 *   el juez se atraso contando, eso INVENTABA repeticiones. Ahora abre el
 *   teclado con lo que lleva contado.
 *
 *   El peso se muestra en la unidad del reglamento, no en kilos.
 *
 * El store es real —es el que decide que evento se emite— pero el transporte se
 * sustituye: no hay red ni IndexedDB en jsdom.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "../../../../test/render";
import { WodJudgeScreen } from "./WodJudgeScreen";
import type { WodStructure } from "@/shared/timing/wod";

/** Dexie no corre en jsdom: el outbox se sustituye entero. */
const guardados: Array<{ type: string; payload?: Record<string, unknown> }> = [];

vi.mock("../lib/db", () => ({
  getDb: () => ({}),
  requestPersistentStorage: async () => true,
  saveAnchor: async () => {},
  loadAnchor: async () => null,
  writeHeartbeat: async () => {},
  loadHeartbeat: async () => null,
  // Devuelve el evento guardado, como el de verdad: el store lo mete en su
  // lista y se lo pasa al reductor, asi que un `undefined` lo hace reventar.
  appendEvent: async (e: { type: string; payload?: Record<string, unknown> }) => {
    const guardado = { ...e, syncState: "pending", syncAttempts: 0 };
    guardados.push(guardado);
    return guardado;
  },
  loadEvents: async () => [],
  loadPending: async () => [],
  markSynced: async () => {},
  markAttemptFailed: async () => {},
  resetLane: async () => {},
  lanesWithPending: async () => [],
}));

vi.mock("../lib/sync", () => ({
  startSyncLoop: () => () => {},
  supabaseTransport: async () => ({ error: null }),
  getDeviceId: () => "dispositivo-de-prueba",
}));

beforeEach(() => {
  guardados.length = 0;
});
afterEach(cleanup);

/** El elapsed de la pantalla se ancla a esta largada. */
const LARGADA = Date.now() - 60_000;

function estructura(
  movimiento: Partial<WodStructure["blocks"][0]["movements"][0]>,
  overrides: Partial<WodStructure> = {},
): WodStructure {
  return {
    scheme: "cap",
    timeCapMs: 600_000,
    windowMs: null,
    intervalMs: null,
    blocks: [
      {
        id: "b1",
        orderIndex: 0,
        kind: "trabajo",
        rounds: 1,
        durationMs: null,
        restMs: null,
        movements: [
          {
            id: "m1",
            orderIndex: 0,
            name: "Thruster",
            unit: "reps",
            targetPerRound: [21],
            loadKg: 43.09,
            loadUnit: "lb",
            maxReps: false,
            isTiebreak: false, maxAttempts: 3,
            captureStyle: null,
            ...movimiento,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function pintar(
  movimiento: Partial<WodStructure["blocks"][0]["movements"][0]> = {},
  overrides: Partial<WodStructure> = {},
) {
  render(
    <WodJudgeScreen
      laneId="c1"
      bib="101"
      athlete="Ana Díaz"
      workoutName="Evento 2 — Fran"
      partes={[{ partId: "p1", label: "", structure: estructura(movimiento, overrides) }]}
      heatStartEpochMs={LARGADA}
      recordedBy="juez-1"
      transport={async () => ({ error: null })}
    />,
  );
  // El store hidrata en un efecto: sin esto la pantalla dice "Cargando carril…".
  return waitFor(() => expect(screen.getByText("Ana Díaz")).toBeTruthy());
}

/**
 * Los marcajes del juez, SIN el `lane_start`.
 *
 * El store inserta la largada sola al anclar el reloj —es idempotente y viene
 * del servidor, no de un toque— y contarla acá solo ensuciaría cada
 * expectativa con un evento que el juez nunca emitió.
 */
const tipos = () => guardados.filter((e) => e.type !== "lane_start").map((e) => e.type);

describe("lo que el juez ve antes de tocar nada", () => {
  it("dice qué prueba está juzgando", async () => {
    // Con tres WODs en la competencia, "Heat 2" no alcanza para saber cuál es.
    await pintar();
    expect(screen.getByText(/Evento 2 — Fran/)).toBeTruthy();
  });

  it("muestra el peso en la unidad del reglamento, no en kilos", async () => {
    // 43,09 kg son 95 lb. El juez lee el mismo número que está en la pizarra.
    await pintar();
    expect(screen.getByText("95 lb")).toBeTruthy();
    expect(screen.queryByText(/43[.,]09/)).toBeNull();
  });
});

describe("los tres estilos de captura", () => {
  it("tap (forzado por el organizador) ofrece contar de a uno", async () => {
    // "Un toque al terminar" es el default automático para cualquier
    // cantidad de reps — tap solo se ve cuando el organizador lo fuerza a
    // mano para un movimiento puntual.
    await pintar({ targetPerRound: [21], captureStyle: "tap" });

    expect(screen.getByRole("button", { name: /\+ REP/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /\+ REP/ }));
    await waitFor(() => expect(tipos()).toContain("rep"));
  });

  it("un objetivo grande ofrece un solo toque al terminar", async () => {
    await pintar({ targetPerRound: [100] });

    // Tapear cien veces le saca la vista del atleta cien veces.
    expect(screen.queryByRole("button", { name: /\+ REP/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /THRUSTER LISTO/i }));
    await waitFor(() => expect(tipos()).toEqual(["movement_done"]));
    // Sin `cantidad`: cerró con el objetivo, que es lo que el juez confirmó.
    expect(guardados.at(-1)?.payload?.cantidad).toBeUndefined();
  });

  it("lo que no son repeticiones se escribe", async () => {
    await pintar({ unit: "metros", targetPerRound: [500], loadKg: null });

    expect(screen.queryByRole("button", { name: /\+ REP/ })).toBeNull();
    expect(screen.getByRole("button", { name: "REGISTRAR" })).toBeTruthy();
    expect(screen.getByText("500 m")).toBeTruthy();
  });
});

describe("CONTAR A MANO", () => {
  it("baja ese paso a tap sin emitir ningún evento", async () => {
    // Es lo que hace seguro tener un default: si el derivado se equivoca, está
    // a un toque de estar bien. No escribe nada.
    await pintar({ targetPerRound: [100] });

    fireEvent.click(screen.getByRole("button", { name: "CONTAR A MANO" }));

    expect(screen.getByRole("button", { name: /\+ REP/ })).toBeTruthy();
    expect(tipos()).toEqual([]);
  });
});

describe("MOVIMIENTO ✓", () => {
  it("pide la cantidad en vez de saltar al objetivo en silencio", async () => {
    // Antes cerraba con `max(objetivo, progreso)`: si el juez se atrasó
    // contando, eso inventaba repeticiones que nadie hizo.
    await pintar({ targetPerRound: [21], captureStyle: "tap" });

    fireEvent.click(screen.getByRole("button", { name: /\+ REP/ }));
    await waitFor(() => expect(tipos()).toContain("rep"));

    fireEvent.click(screen.getByRole("button", { name: "MOVIMIENTO ✓" }));

    // Todavía no cerró nada: primero confirma el número.
    expect(tipos()).toEqual(["rep"]);
    expect(screen.getByRole("button", { name: "REGISTRAR" })).toBeTruthy();
  });
});

describe("el no-rep", () => {
  it("queda registrado en el acto y recién después pide el motivo", async () => {
    // El tap va primero: obligar a elegir una razón mientras el atleta sigue
    // trabajando es justo lo que esta pantalla no puede hacer.
    await pintar();

    expect(screen.queryByText("Motivo:")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "NO REP" }));

    await waitFor(() => expect(tipos()).toEqual(["no_rep"]));
    expect(screen.getByText("Motivo:")).toBeTruthy();
  });

  it("el motivo va como nota y no como un segundo no-rep", async () => {
    // El reductor ignora las notas, así que clasificar no cambia ningún número.
    await pintar();

    fireEvent.click(screen.getByRole("button", { name: "NO REP" }));
    await waitFor(() => expect(tipos()).toEqual(["no_rep"]));

    fireEvent.click(screen.getByRole("button", { name: "profundidad" }));
    await waitFor(() => expect(tipos()).toEqual(["no_rep", "note"]));
    expect(guardados.at(-1)?.payload?.motivo).toBe("profundidad");
  });

  it("se puede omitir", async () => {
    await pintar();

    fireEvent.click(screen.getByRole("button", { name: "NO REP" }));
    await waitFor(() => expect(tipos()).toEqual(["no_rep"]));

    fireEvent.click(screen.getByRole("button", { name: "omitir" }));
    expect(screen.queryByText("Motivo:")).toBeNull();
    expect(tipos()).toEqual(["no_rep"]);
  });
});

describe("carga máxima", () => {
  it("cierra sola al agotar los intentos, en vez de seguir pidiendo para siempre", async () => {
    // Reportado en producción: el juez marcó 6 intentos en un WOD de carga
    // máxima y la pantalla nunca dejó de ofrecer VÁLIDO/NULO.
    await pintar({ maxAttempts: 2 }, { scheme: "sin_reloj", timeCapMs: null });

    expect(screen.getByText("Intento 1 de 2")).toBeTruthy();

    const kilos = screen.getByPlaceholderText("kg") as HTMLInputElement;
    fireEvent.change(kilos, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "VÁLIDO" }));
    await waitFor(() => expect(tipos()).toEqual(["lift"]));

    // Segundo y último intento.
    await waitFor(() => expect(screen.getByText("Intento 2 de 2")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("kg"), { target: { value: "110" } });
    fireEvent.click(screen.getByRole("button", { name: "VÁLIDO" }));
    await waitFor(() => expect(tipos()).toEqual(["lift", "lift"]));

    // Se acabaron los intentos: cierra sola, sin más VÁLIDO/NULO que tocar.
    await waitFor(() => expect(screen.getByText("INTENTOS COMPLETOS")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "VÁLIDO" })).toBeNull();
    expect(screen.queryByRole("button", { name: "NULO" })).toBeNull();
    // El mejor de los dos (100 y 110 válidos): queda como marca.
    expect(screen.getByText((_, node) => node?.textContent === "110kg")).toBeTruthy();
  });
});

describe("terminar antes del cap oculta la cuenta regresiva", () => {
  it("deja de mostrar cuánto falta para el cap una vez que el atleta termina", async () => {
    // Reportado como confuso: el atleta ya terminó y el reloj de "cuánto
    // falta para el cap" seguía corriendo en pantalla, tanto para el juez
    // como para el atleta que lo mira de reojo.
    await pintar({ targetPerRound: [1], captureStyle: "tap" });

    expect(screen.getByText("para el cap")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /\+ REP/ }));
    await waitFor(() => expect(tipos()).toContain("rep"));

    await waitFor(() => expect(screen.getByText("TERMINÓ")).toBeTruthy());
    expect(screen.queryByText("para el cap")).toBeNull();
  });
});

describe("el tope de reps", () => {
  it("MOVIMIENTO ✓ no deja escribir más que el objetivo del paso", async () => {
    // Grave: si el juez tipea de más, el atleta se lleva reps -y puntos- que
    // no hizo. El campo se acota al escribir, no solo al registrar.
    await pintar({ targetPerRound: [21], captureStyle: "tap" });

    fireEvent.click(screen.getByRole("button", { name: /\+ REP/ }));
    await waitFor(() => expect(tipos()).toContain("rep"));
    fireEvent.click(screen.getByRole("button", { name: "MOVIMIENTO ✓" }));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "30" } });
    expect(input.value).toBe("21");

    fireEvent.click(screen.getByRole("button", { name: "REGISTRAR" }));
    await waitFor(() => expect(tipos()).toEqual(["rep", "movement_done"]));
    expect(guardados.at(-1)?.payload?.cantidad).toBe(21);
  });
});

describe("un maxReps con unidad que se escribe (calorías, metros) no se registra antes de tiempo", () => {
  it("mientras corre, no ofrece REGISTRAR: dice que hay que esperar al final", async () => {
    // Cap largo (600s) y la largada quedó fija hace solo 60s: el WOD sigue
    // corriendo, no se acabó el tiempo todavía.
    await pintar({ unit: "calorias", targetPerRound: [0], maxReps: true, loadKg: null });

    expect(screen.getByText("Hasta que suene")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "REGISTRAR" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Esperando el final")).toBeTruthy();
  });

  it("una vez que se acaba el tiempo, SÍ deja registrar (vía el cierre automático)", async () => {
    // Mismo movimiento, pero con un cap ya vencido: acá el bloqueo tiene que
    // desaparecer, porque `Marcador` ya ni se muestra -lo reemplaza
    // `CierreDelTiempo`, que es la pantalla pensada para este momento.
    await pintar(
      { unit: "calorias", targetPerRound: [0], maxReps: true, loadKg: null },
      { timeCapMs: 30_000 },
    );

    await waitFor(() => expect(screen.getByText("SE ACABÓ EL TIEMPO")).toBeTruthy());
    expect(screen.getByRole("button", { name: "REGISTRAR" })).toBeTruthy();

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "REGISTRAR" }));

    await waitFor(() => expect(tipos()).toEqual(["movement_done"]));
    expect(guardados.at(-1)?.payload?.cantidad).toBe(80);
  });

  it("un objetivo fijo (no maxReps) sigue ofreciendo REGISTRAR como siempre", async () => {
    // Control: el bloqueo es SOLO para maxReps. "500 m" con objetivo fijo no
    // se toca -mismo caso que ya cubre "los tres estilos de captura".
    await pintar({ unit: "metros", targetPerRound: [500], maxReps: false, loadKg: null });

    expect(screen.getByRole("button", { name: "REGISTRAR" })).toBeTruthy();
    expect(screen.queryByText("Esperando el final")).toBeNull();
  });
});

describe("un maxReps que se tapea (max sentadillas, max T2B) no cierra el paso antes de tiempo", () => {
  it("+ REP sigue activo -es como se cuenta en tiempo real- pero MOVIMIENTO ✓ está deshabilitado", async () => {
    await pintar({ unit: "reps", targetPerRound: [0], maxReps: true, captureStyle: null });

    // Contar sí, siempre: no hay otra forma de saber cuántas hizo el atleta.
    const masRep = screen.getByRole("button", { name: /\+ REP/ });
    expect(masRep).toBeTruthy();
    fireEvent.click(masRep);
    await waitFor(() => expect(tipos()).toContain("rep"));

    // Cerrar el paso, no: MOVIMIENTO ✓ está ahí pero deshabilitado.
    const cerrar = screen.getByRole("button", { name: "MOVIMIENTO ✓" }) as HTMLButtonElement;
    expect(cerrar.disabled).toBe(true);
    fireEvent.click(cerrar);
    expect(tipos()).toEqual(["rep"]); // sigue igual: el click no hizo nada.
    expect(screen.queryByRole("textbox")).toBeNull(); // no abrió el teclado de confirmar.
  });

  it("una vez que se acaba el tiempo, el cierre automático ya trae precargado lo tapeado", async () => {
    await pintar(
      { unit: "reps", targetPerRound: [0], maxReps: true, captureStyle: null },
      { timeCapMs: 30_000 },
    );

    await waitFor(() => expect(screen.getByText("SE ACABÓ EL TIEMPO")).toBeTruthy());
    expect(screen.getByRole("button", { name: "REGISTRAR" })).toBeTruthy();

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "37" } });
    fireEvent.click(screen.getByRole("button", { name: "REGISTRAR" }));

    await waitFor(() => expect(tipos()).toEqual(["movement_done"]));
    expect(guardados.at(-1)?.payload?.cantidad).toBe(37);
  });

  it("un tap forzado sin maxReps sigue con MOVIMIENTO ✓ habilitado, como siempre", async () => {
    // Control: mismo caso que ya cubre "los tres estilos de captura", ahora
    // afirmando explícitamente que el botón NO está deshabilitado.
    await pintar({ targetPerRound: [21], captureStyle: "tap", maxReps: false });

    const boton = screen.getByRole("button", { name: "MOVIMIENTO ✓" }) as HTMLButtonElement;
    expect(boton.disabled).toBe(false);
  });
});

describe("el cap detiene la pantalla", () => {
  it("una vez capeado, pide el cierre final y ya no acepta NO REP ni + REP", async () => {
    // La largada quedó fija hace 60s (LARGADA). Con un cap de 30s, el WOD
    // arranca YA capeado — pero con el movimiento a medias, primero tiene
    // que pedir cuánto llevaba, no bloquear la pantalla en silencio.
    await pintar({}, { timeCapMs: 30_000 });

    await waitFor(() => expect(screen.getByText("SE ACABÓ EL TIEMPO")).toBeTruthy());

    expect(screen.queryByRole("button", { name: /\+ REP/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "NO REP" })).toBeNull();
    expect(screen.getByRole("button", { name: "REGISTRAR" })).toBeTruthy();
  });

  it("al confirmar el cierre final, registra la cantidad y recién ahí pasa a CAPEADO", async () => {
    await pintar({}, { timeCapMs: 30_000 });

    await waitFor(() => expect(screen.getByText("SE ACABÓ EL TIEMPO")).toBeTruthy());

    // Precargado con lo que se alcanzó a contar (0, en hecho/numero sin tap
    // previo); el juez corrige a lo que de verdad llevaba.
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "REGISTRAR" }));

    await waitFor(() => expect(tipos()).toEqual(["movement_done"]));
    expect(guardados.at(-1)?.payload?.cantidad).toBe(12);

    await waitFor(() => expect(screen.getByText("CAPEADO")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "REGISTRAR" })).toBeNull();
  });
});

describe("marcar DNF", () => {
  it("pide confirmar y recien ahi emite el evento", async () => {
    await pintar();

    fireEvent.click(screen.getByRole("button", { name: "Marcar DNF" }));
    // Un solo toque no alcanza -es el mismo criterio que JudgeScreen-: hace
    // falta ver "Confirmar DNF" antes de que se emita nada.
    expect(tipos()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar DNF" }));

    await waitFor(() => expect(tipos()).toEqual(["dnf"]));
    await waitFor(() => expect(screen.getByText("NO TERMINÓ")).toBeTruthy());
  });
});

describe("la caja de 'Sigue' no sobrevive al cierre del WOD", () => {
  it("deja de anunciar el proximo movimiento en cuanto el WOD queda capeado a mitad de camino", async () => {
    // Bug real: un WOD de dos movimientos por dos rondas (tipo Fran) que se
    // capea durante el PRIMER movimiento seguia mostrando "Sigue: Pull-up"
    // -el movimiento de la ronda siguiente- con el reloj ya detenido.
    // `currentStepIndex` no se vuelve null cuando el estado real es
    // "running" con `capped = true`, asi que la condicion vieja (solo
    // miraba si quedaba un paso en el plan) dejaba pasar el anuncio.
    const estructuraDosMovimientos: WodStructure = {
      scheme: "cap",
      timeCapMs: 30_000,
      windowMs: null,
      intervalMs: null,
      blocks: [
        {
          id: "b1",
          orderIndex: 0,
          kind: "trabajo",
          rounds: 2,
          durationMs: null,
          restMs: null,
          movements: [
            {
              id: "m1",
              orderIndex: 0,
              name: "Thruster",
              unit: "reps",
              targetPerRound: [21, 21],
              loadKg: 43.09,
              loadUnit: "lb",
              maxReps: false,
              isTiebreak: false,
              maxAttempts: 3,
              captureStyle: null,
            },
            {
              id: "m2",
              orderIndex: 1,
              name: "Pull-up",
              unit: "reps",
              targetPerRound: [21, 21],
              loadKg: null,
              loadUnit: "kg",
              maxReps: false,
              isTiebreak: false,
              maxAttempts: 3,
              captureStyle: null,
            },
          ],
        },
      ],
    };

    render(
      <WodJudgeScreen
        laneId="c1"
        bib="101"
        athlete="Ana Díaz"
        partes={[{ partId: "p1", label: "", structure: estructuraDosMovimientos }]}
        heatStartEpochMs={LARGADA}
        recordedBy="juez-1"
        transport={async () => ({ error: null })}
      />,
    );
    await waitFor(() => expect(screen.getByText("Ana Díaz")).toBeTruthy());

    // El cap ya paso desde que la pantalla monto (LARGADA es hace 60s, cap de
    // 30s): arranca pidiendo el cierre final del primer movimiento.
    await waitFor(() => expect(screen.getByText("SE ACABÓ EL TIEMPO")).toBeTruthy());

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "REGISTRAR" }));

    await waitFor(() => expect(screen.getByText("CAPEADO")).toBeTruthy());
    // El WOD ya termino: no puede seguir anunciando un movimiento que viene.
    expect(screen.queryByText("Sigue")).toBeNull();
  });
});

describe("el descanso forzado entre dos partes del mismo WOD", () => {
  // Estructura de "3 min clean and jerk, descanso, 4 min de couplet" partida
  // en dos partes -mismo patron que "Agregar parte B"- donde la PARTE A
  // declara un bloque `descanso` con su duracion. LARGADA propia, mas cerca
  // de "ahora" que la global: el descanso tiene que seguir corriendo cuando
  // el test verifica que esta bloqueado, y con la LARGADA global (60s atras)
  // cualquier descanso corto ya habria terminado antes de que el test
  // alcanzara a mirar la pantalla.
  const LARGADA_CERCA = Date.now() - 12_000;

  function parteConDescanso(descansoMs: number | null): WodStructure {
    return {
      scheme: "cap",
      timeCapMs: 8_000, // ya vencido: LARGADA_CERCA es hace 12s.
      windowMs: null,
      intervalMs: null,
      blocks: [
        {
          id: "b1",
          orderIndex: 0,
          kind: "trabajo",
          rounds: 1,
          durationMs: null,
          restMs: null,
          movements: [
            {
              id: "m1", orderIndex: 0, name: "Clean and Jerk", unit: "reps",
              targetPerRound: [30], loadKg: null, loadUnit: "kg",
              maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3,
            },
          ],
        },
        ...(descansoMs === null
          ? []
          : [
              {
                id: "b2",
                orderIndex: 1,
                kind: "descanso" as const,
                rounds: 1,
                // "duracion_ms", no "descanso_ms": el propio formulario de
                // "Editar bloque" dice que Duración es "cuánto dura el
                // descanso" para un bloque de este tipo.
                durationMs: descansoMs,
                restMs: null,
                movements: [],
              },
            ]),
      ],
    };
  }

  const parteB: WodStructure = {
    scheme: "cap",
    timeCapMs: 300_000,
    windowMs: null,
    intervalMs: null,
    blocks: [
      {
        id: "b3",
        orderIndex: 0,
        kind: "trabajo",
        rounds: 1,
        durationMs: null,
        restMs: null,
        movements: [
          {
            id: "m2", orderIndex: 0, name: "Thruster", unit: "reps",
            targetPerRound: [15, 12, 9], loadKg: null, loadUnit: "kg",
            maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3,
          },
        ],
      },
    ],
  };

  /** Cierra la parte A (ya capeada al montar) reportando 18 de 30. */
  async function cerrarParteA() {
    await waitFor(() => expect(screen.getByText("SE ACABÓ EL TIEMPO")).toBeTruthy());
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "REGISTRAR" }));
    await waitFor(() => expect(screen.getByText("CAPEADO")).toBeTruthy());
  }

  it("con un bloque de descanso cargado, no ofrece ningún botón: solo la cuenta regresiva", async () => {
    // 30s de descanso, muy por encima de lo que tarda el test en correr: sigue
    // "en curso" cuando se verifica.
    render(
      <WodJudgeScreen
        laneId="c1"
        bib="101"
        athlete="Ana Díaz"
        partes={[
          { partId: "p1", label: "A", structure: parteConDescanso(30_000) },
          { partId: "p2", label: "B", structure: parteB },
        ]}
        heatStartEpochMs={LARGADA_CERCA}
        recordedBy="juez-1"
        transport={async () => ({ error: null })}
      />,
    );
    await waitFor(() => expect(screen.getByText("Ana Díaz")).toBeTruthy());
    await cerrarParteA();

    expect(screen.getByText("Descanso")).toBeTruthy();
    // Nada que el juez pueda tocar para SALTAR el descanso o arrancar la
    // parte B antes de tiempo. "DESHACER" queda aparte a propósito: sigue
    // disponible por si el juez se equivocó al cerrar la parte A -es la
    // ranura de deshacer de siempre, no una forma de adelantar nada-.
    expect(screen.queryByRole("button", { name: /Empezar parte/ })).toBeNull();
    const botones = screen.queryAllByRole("button").map((b) => b.textContent);
    expect(botones.every((t) => t?.includes("DESHACER"))).toBe(true);
  });

  it("sin bloque de descanso, sigue con el botón manual de siempre (compatibilidad)", async () => {
    render(
      <WodJudgeScreen
        laneId="c1"
        bib="101"
        athlete="Ana Díaz"
        partes={[
          { partId: "p1", label: "A", structure: parteConDescanso(null) },
          { partId: "p2", label: "B", structure: parteB },
        ]}
        heatStartEpochMs={LARGADA_CERCA}
        recordedBy="juez-1"
        transport={async () => ({ error: null })}
      />,
    );
    await waitFor(() => expect(screen.getByText("Ana Díaz")).toBeTruthy());
    await cerrarParteA();

    const boton = screen.getByRole("button", { name: /Empezar parte B/ });
    fireEvent.click(boton);

    // Pasó de verdad a la parte B: ahora pide Thruster (el título del
    // movimiento, arriba del marcador).
    await waitFor(() =>
      expect(screen.getByText("Thruster", { selector: "p" })).toBeTruthy(),
    );
  });
});

describe("el cierre de un AMRAP dice EN QUE MOVIMIENTO quedo, no solo un total", () => {
  it("muestra la ronda y el movimiento a medias, no '0 rondas + N reps'", async () => {
    // Bug real reportado: el cierre de un AMRAP mostraba "0 rondas + 5 reps"
    // sin decir en cual movimiento -ni si era el 1ro, 2do o 3ro de la ronda-
    // quedo esa cantidad. Con un solo movimiento (Thruster, objetivo 21) y la
    // ventana ya agotada (LARGADA es hace 60s, ventana de 30s), el cierre
    // final reporta 12 -a medias- y la pantalla tiene que decirlo asi.
    await pintar({ targetPerRound: [21] }, { scheme: "ventana", windowMs: 30_000 });

    await waitFor(() => expect(screen.getByText("SE ACABÓ EL TIEMPO")).toBeTruthy());

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "REGISTRAR" }));

    await waitFor(() => expect(screen.getByText("TERMINÓ")).toBeTruthy());
    // Nunca mas el total ambiguo "0 rondas + 12 reps".
    expect(screen.queryByText(/rondas \+/)).toBeNull();
    expect(screen.getByText(/Ronda\s*1/)).toBeTruthy();
    expect(screen.getByText(/Thruster/)).toBeTruthy();
    expect(screen.getByText("12/21")).toBeTruthy();
  });

});

describe("el descanso obligatorio DENTRO de una sola prueba (bloques, no partes)", () => {
  // Es el caso real reportado: "30 clean and jerk, cap 8 min, descanso 1 min,
  // thruster por tiempo" como UNA sola prueba -un solo score, un solo puesto
  // en el leaderboard- en vez de una Parte A y una Parte B con el reloj de la
  // Parte B midiendose desde la largada del heat.
  const LARGADA_LEJOS = Date.now() - 20 * 60_000; // 20 minutos atras: sobra para que el bloque A ya haya capeado.

  function cleanJerkDescansoThruster(): WodStructure {
    return {
      scheme: "cap",
      timeCapMs: null,
      windowMs: null,
      intervalMs: null,
      blocks: [
        {
          id: "bA", orderIndex: 0, kind: "trabajo", rounds: 1, durationMs: null, restMs: null,
          capMs: 8_000, // 8 segundos: ya vencido, LARGADA_LEJOS es hace 20 minutos.
          movements: [
            { id: "cj", orderIndex: 0, name: "Clean and Jerk", unit: "reps", targetPerRound: [30], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
          ],
        },
        {
          id: "bR", orderIndex: 1, kind: "descanso", rounds: 1, durationMs: 30_000, restMs: null,
          movements: [],
        },
        {
          id: "bB", orderIndex: 2, kind: "trabajo", rounds: 1, durationMs: null, restMs: null,
          movements: [
            { id: "th", orderIndex: 0, name: "Thruster", unit: "reps", targetPerRound: [21], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
          ],
        },
      ],
    };
  }

  it("pide el cierre final del bloque A y, al confirmarlo, bloquea la pantalla en descanso sin nada para saltarlo", async () => {
    render(
      <WodJudgeScreen
        laneId="c1"
        bib="101"
        athlete="Ana Díaz"
        partes={[{ partId: "p1", label: "", structure: cleanJerkDescansoThruster() }]}
        heatStartEpochMs={LARGADA_LEJOS}
        recordedBy="juez-1"
        transport={async () => ({ error: null })}
      />,
    );
    await waitFor(() => expect(screen.getByText("SE ACABÓ EL TIEMPO")).toBeTruthy());

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "22" } });
    fireEvent.click(screen.getByRole("button", { name: "REGISTRAR" }));

    await waitFor(() => expect(screen.getByText("Descanso obligatorio")).toBeTruthy());

    // Nada que tocar para saltar el descanso o arrancar el bloque siguiente:
    // solo la ranura de deshacer (por si el juez se equivoco al cerrar el
    // bloque A) y el DNF de siempre, que sigue disponible por si hace falta
    // abortar.
    const botones = screen.queryAllByRole("button").map((b) => b.textContent);
    expect(
      botones.every((t) => t?.includes("DESHACER") || t === "Marcar DNF"),
    ).toBe(true);

    // Dice que movimiento viene despues del descanso -ahora aparece DOS
    // veces: en la caja "Sigue" de siempre (que con el fix vuelve a
    // mostrarse durante el descanso, `terminado` ya no la tapa) y en el
    // "Despues:" del panel de descanso.
    expect(screen.getAllByText(/Thruster/).length).toBeGreaterThan(0);
  });

  it("una prueba sin ningun bloque de descanso no se ve afectada: sigue mostrando el marcador normal", async () => {
    // Fran, de siempre, sin bloques de descanso -tiene que dar exactamente lo
    // mismo que antes de este cambio.
    await pintar({ targetPerRound: [21] });
    await waitFor(() => expect(screen.getByText("Thruster", { selector: "p" })).toBeTruthy());
    expect(screen.queryByText("Descanso obligatorio")).toBeNull();
  });
});
