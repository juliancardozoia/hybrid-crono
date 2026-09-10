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
