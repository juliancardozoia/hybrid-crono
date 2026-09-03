// @vitest-environment jsdom

/*
 * La pantalla de heats se rompio tres veces seguidas de la misma forma: el
 * organizador asigna equipos a los carriles, guarda, y los selectores quedan
 * vacios aunque en la base quedo guardado bien. Solo aparecia recargando.
 *
 * La causa no es el guardado ni la consulta: es que React 19 llama al
 * `form.reset()` NATIVO cuando termina una accion de formulario. React fija el
 * valor de un <select> por propiedad, no por atributo, asi que el reset lo
 * manda a la primera opcion —"vacio"—. Y como el estado de React NO cambio, el
 * siguiente render no ve ninguna diferencia que aplicar y nunca vuelve a
 * escribir el DOM: el estado dice "equipo A" y la pantalla dice "vacio".
 *
 * Por eso fallaron los dos intentos anteriores, que trabajaban sobre el estado.
 * El estado siempre estuvo bien; lo que se perdia era el DOM.
 *
 * Este test corre sobre el componente real y falla si se vuelve a depender del
 * ciclo de vida de un <form action={...}> para conservar la seleccion.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";

const assignLanes = vi.fn(async () => ({ error: null }));
const setLaneJudge = vi.fn(async () => ({ error: null }));

vi.mock("../actions", () => ({ assignLanes, setLaneJudge }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { HeatCard } = await import("./HeatCard");
import type { TeamOption } from "./HeatCard";
import type { HeatWithLanes } from "@/features/events/config/queries";

afterEach(cleanup);

const equipos: TeamOption[] = [
  { id: "team-a", label: "#1 · Ana Diaz", asignadoEn: null },
  { id: "team-b", label: "#2 · Beto Ruiz", asignadoEn: null },
];

// Un heat recien creado: sin carriles asignados todavia.
const heatNuevo: HeatWithLanes = {
  id: "heat-nuevo",
  event_id: "evt",
  name: "Heat 1",
  scheduled_at: null,
  lane_count: 2,
  division_id: null,
  status: "scheduled",
  started_at: null,
  started_by: null,
  start_source: null,
  created_at: new Date().toISOString(),
  lanes: [],
} as unknown as HeatWithLanes;

// Un heat ya armado, para la parte de jueces.
const heatArmado: HeatWithLanes = {
  ...heatNuevo,
  id: "heat-armado",
  lanes: [
    {
      id: "lane-1",
      heat_id: "heat-armado",
      lane_number: 1,
      team_id: "team-a",
      judge_id: null,
      bib: 1,
      teamLabel: "Ana Diaz",
    },
  ],
} as unknown as HeatWithLanes;

const jueces = [
  { userId: "juez-1", label: "Carla Gomez", role: "judge" },
  { userId: "juez-2", label: "Diego Paz", role: "judge" },
];

function montar(heat: HeatWithLanes = heatNuevo, canVerify = false) {
  return render(
    <HeatCard
      eventId="evt"
      timezone="America/Bogota"
      heat={heat}
      teams={equipos}
      judges={jueces}
      canManage
      canVerify={canVerify}
    />,
  );
}

const selectorDeCarril = (numero: number) =>
  document.querySelector<HTMLSelectElement>(`select[name="lane-${numero}"]`)!;

describe("asignar equipos a los carriles", () => {
  it("manda al servidor lo que eligio el organizador", async () => {
    montar();

    fireEvent.change(selectorDeCarril(1), { target: { value: "team-a" } });
    fireEvent.change(selectorDeCarril(2), { target: { value: "team-b" } });
    fireEvent.click(screen.getByText("Guardar carriles"));

    await waitFor(() => expect(assignLanes).toHaveBeenCalled());

    const datos = assignLanes.mock.calls.at(-1)!.at(-1) as unknown as FormData;
    expect(datos.get("heatId")).toBe("heat-nuevo");
    expect(datos.get("lane-1")).toBe("team-a");
    expect(datos.get("lane-2")).toBe("team-b");
  });

  // EL BUG QUE REPORTO EL USUARIO TRES VECES.
  it("los equipos siguen a la vista despues de guardar, sin recargar", async () => {
    montar();

    fireEvent.change(selectorDeCarril(1), { target: { value: "team-a" } });
    fireEvent.change(selectorDeCarril(2), { target: { value: "team-b" } });
    fireEvent.click(screen.getByText("Guardar carriles"));

    await waitFor(() => expect(assignLanes).toHaveBeenCalled());

    // Lo que ve el organizador es el DOM, no el estado de React.
    await waitFor(() => {
      expect(selectorDeCarril(1).value).toBe("team-a");
      expect(selectorDeCarril(2).value).toBe("team-b");
    });
  });

  it("un carril se puede dejar vacio y los demas conservan su numero", async () => {
    montar();

    fireEvent.change(selectorDeCarril(2), { target: { value: "team-b" } });
    fireEvent.click(screen.getByText("Guardar carriles"));

    await waitFor(() => expect(assignLanes).toHaveBeenCalled());

    const datos = assignLanes.mock.calls.at(-1)!.at(-1) as unknown as FormData;
    expect(datos.get("lane-1")).toBe("");
    expect(datos.get("lane-2")).toBe("team-b");

    await waitFor(() => expect(selectorDeCarril(2).value).toBe("team-b"));
  });
});

describe("asignar juez a un carril", () => {
  // Mismo mecanismo que el de los carriles: el <form> se reseteaba solo.
  it("el juez elegido sigue a la vista despues de asignar", async () => {
    montar(heatArmado, true);

    const select = document.querySelector<HTMLSelectElement>(
      'select[name="judgeId"]',
    )!;
    fireEvent.change(select, { target: { value: "juez-2" } });
    fireEvent.click(screen.getByText("Asignar"));

    await waitFor(() => expect(setLaneJudge).toHaveBeenCalled());

    const datos = setLaneJudge.mock.calls.at(-1)!.at(-1) as unknown as FormData;
    expect(datos.get("laneId")).toBe("lane-1");
    expect(datos.get("judgeId")).toBe("juez-2");

    await waitFor(() => expect(select.value).toBe("juez-2"));
  });
});
