// @vitest-environment jsdom

/*
 * "Deshacer Inicio" en la torre de control.
 *
 * Reglas:
 *   - Se ofrece MIENTRAS EL HEAT ESTE EN CURSO, sin limite de tiempo (antes
 *     desaparecia al minuto y una largada por error descubierta tarde quedaba
 *     sin salida). Se oculta solo cuando el heat termina.
 *   - Aunque un juez ya haya entrado al cronometro (lane_start automatico) o
 *     haya taps de verdad: se anulan con un motivo (`deshacer_largada_completa`).
 *   - Si un atleta ya termino, el boton queda deshabilitado y dice por que.
 *   - El aviso dice EXACTAMENTE que va a pasar, con numeros.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "../../../../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CarrilVista, HeatVista } from "./TorreDeHeats";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../actions", () => ({}));

const { TorreDeHeats } = await import("./TorreDeHeats");

afterEach(cleanup);

const carril = (extra: Partial<CarrilVista> = {}): CarrilVista => ({
  laneId: "lane-1",
  laneNumber: 1,
  bib: 101,
  athletes: "Ana Diaz",
  teamLabel: null,
  judgeId: "juez-1",
  judgeName: "Juez Uno",
  status: "running",
  totalMs: null,
  // El lane_start automatico del juez que ya entro al cronometro.
  eventCount: 1,
  puedeMarcarDnf: true,
  puedeCargarManual: false,
  ...extra,
});

const heat = (extra: Partial<HeatVista> = {}): HeatVista => ({
  id: "heat-1",
  name: "Heat 1",
  startedAt: new Date(Date.now() - 10_000).toISOString(),
  endedAt: null,
  startSource: "server",
  divisionId: null,
  divisionName: null,
  workoutId: "w1",
  workoutName: null,
  marcajesActivos: 0,
  conAtletaCount: 1,
  sinJuezCount: 0,
  lanes: [carril()],
  ...extra,
});

function pintar(heats: HeatVista[], deshacer = vi.fn(async () => ({ error: null }))) {
  render(
    <TorreDeHeats
      eventId="evt-1"
      timezone="America/Bogota"
      formato="carrera_hibrida"
      divisiones={[]}
      pruebas={[{ id: "w1", name: "Circuito", stage: 1 }]}
      etapasConfirmadas={[]}
      heats={heats}
      segmentosPorDivision={{}}
      largar={vi.fn(async () => ({ error: null }))}
      deshacer={deshacer}
      marcarDnfAccion={vi.fn(async () => ({ error: null }))}
      cargarTiempoManualAccion={vi.fn(async () => ({ error: null }))}
    />,
  );
  return deshacer;
}

const boton = () => screen.getByRole("button", { name: "Deshacer Inicio" }) as HTMLButtonElement;

describe("visibilidad del boton", () => {
  it("se ofrece aunque un juez ya haya entrado al cronometro", () => {
    pintar([heat()]);

    expect(boton().disabled).toBe(false);
  });

  it("se ofrece aunque ya haya taps de verdad", () => {
    pintar([heat({ marcajesActivos: 7, lanes: [carril({ eventCount: 8 })] })]);

    expect(boton().disabled).toBe(false);
  });

  // Lo que se pidio: sin ventana de tiempo. Antes desaparecia al minuto.
  it.each([
    ["30 segundos", 30_000],
    ["5 minutos", 5 * 60_000],
    ["45 minutos", 45 * 60_000],
    ["3 horas", 3 * 60 * 60_000],
  ])("sigue visible a los %s de la largada", (_texto, ms) => {
    pintar([heat({ startedAt: new Date(Date.now() - ms).toISOString() })]);

    expect(boton().disabled).toBe(false);
  });

  it("se oculta cuando el heat termino", () => {
    pintar([heat({ endedAt: new Date().toISOString() })]);

    expect(screen.queryByRole("button", { name: "Deshacer Inicio" })).toBeNull();
  });

  it("un heat sin largar ofrece largar, no deshacer", () => {
    pintar([heat({ startedAt: null, lanes: [carril({ status: "idle", eventCount: 0 })] })]);

    expect(screen.queryByRole("button", { name: "Deshacer Inicio" })).toBeNull();
  });
});

// Un atleta que termino (o con DNF) tiene un tiempo real: la base tambien lo
// rechaza, y la pantalla dice por que en vez de ofrecer un boton que falla.
describe("cuando un atleta ya termino", () => {
  it.each(["finished", "dnf", "dq"])("un carril en %s deshabilita el boton y explica por que", (status) => {
    pintar([heat({ lanes: [carril(), carril({ laneId: "lane-2", laneNumber: 2, status })] })]);

    expect(boton().disabled).toBe(true);
    expect(screen.getByText(/1 carril ya terminó/)).toBeTruthy();
    expect(screen.getByText(/Corrige esos resultados desde Verificación/)).toBeTruthy();
  });

  it("dice cuantos cuando son varios", () => {
    pintar([
      heat({
        lanes: [
          carril({ status: "finished" }),
          carril({ laneId: "lane-2", laneNumber: 2, status: "dnf" }),
        ],
      }),
    ]);

    expect(screen.getByText(/2 carriles ya terminaron/)).toBeTruthy();
  });
});

describe("el aviso de confirmacion", () => {
  function abrir(extra: Partial<HeatVista> = {}, deshacer?: ReturnType<typeof vi.fn>) {
    const accion = pintar([heat(extra)], deshacer as never);
    fireEvent.click(boton());
    return accion;
  }

  it("dice que heat es y cuanto lleva corriendo", () => {
    abrir({ name: "Heat 3", startedAt: new Date(Date.now() - (4 * 60 + 12) * 1000).toISOString() });

    expect(screen.getByText(/Vas a deshacer la largada de/)).toBeTruthy();
    expect(screen.getByText(/hace 4 min 1\d s/)).toBeTruthy();
  });

  it("dice que el heat vuelve a 'Sin iniciar' y que los atletas empiezan de cero", () => {
    abrir();

    expect(screen.getByText(/Sin iniciar/)).toBeTruthy();
    expect(screen.getByText(/empiezan de cero/)).toBeTruthy();
  });

  it("cuenta los relojes que se detienen (un juez puede cubrir varios carriles)", () => {
    abrir({
      lanes: [
        carril({ laneId: "l1", judgeId: "juez-1" }),
        carril({ laneId: "l2", laneNumber: 2, judgeId: "juez-1" }),
        carril({ laneId: "l3", laneNumber: 3, judgeId: "juez-2" }),
      ],
    });

    expect(screen.getByText(/Los relojes de los 2 jueces se detienen/)).toBeTruthy();
  });

  it("con marcajes, dice CUANTOS se anulan y que quedan guardados", () => {
    abrir({ marcajesActivos: 14 });

    expect(screen.getByText("anulan los 14 marcajes")).toBeTruthy();
    expect(screen.getByText(/Quedan guardados en el registro con tu motivo/)).toBeTruthy();
    expect(screen.getByText(/no cuentan para ningún resultado/)).toBeTruthy();
  });

  it("con un solo marcaje lo dice en singular", () => {
    abrir({ marcajesActivos: 1 });

    expect(screen.getByText("anula el marcaje")).toBeTruthy();
  });

  it("sin marcajes dice que no se pierde ningun dato", () => {
    abrir({ marcajesActivos: 0 });

    expect(screen.getByText(/no se pierde ningún dato/)).toBeTruthy();
    expect(screen.queryByText(/anulan/)).toBeNull();
  });

  it("el boton de confirmar dice lo que hace", () => {
    abrir();

    expect(screen.getByRole("button", { name: "Sí, deshacer la largada" })).toBeTruthy();
  });

  it("pide un motivo, precargado, y lo manda con la accion", async () => {
    const deshacer = abrir({}, vi.fn(async () => ({ error: null })));

    const motivo = screen.getByLabelText("Motivo") as HTMLInputElement;
    expect(motivo.value.length).toBeGreaterThan(2);

    fireEvent.change(motivo, { target: { value: "Largamos antes de tiempo" } });
    fireEvent.click(screen.getByRole("button", { name: "Sí, deshacer la largada" }));

    await waitFor(() => expect(deshacer).toHaveBeenCalledTimes(1));
    const [eventId, heatId, , formData] = deshacer.mock.calls[0] as unknown as [
      string,
      string,
      unknown,
      FormData,
    ];
    expect(eventId).toBe("evt-1");
    expect(heatId).toBe("heat-1");
    expect(formData.get("motivo")).toBe("Largamos antes de tiempo");
  });
});
