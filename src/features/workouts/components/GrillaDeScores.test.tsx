// @vitest-environment jsdom

/*
 * La correccion de un score capturado en vivo (modo "corregir") tiene tres
 * reglas que no puede perder:
 *
 *   Sin resultado del juez todavia, no hay nada para editar -esta pantalla es
 *   para AJUSTAR, nunca para cargar de cero una prueba en vivo.
 *
 *   El boton arranca en "Corregir", no con los campos ya editables: hay que
 *   apretarlo a proposito antes de poder tocar un resultado que ya es
 *   oficial.
 *
 *   El motivo es obligatorio: "Confirmar correccion" tiene que quedar
 *   deshabilitado hasta que se escriba algo, y lo que se manda a la accion
 *   tiene que incluirlo.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "../../../../test/render";

const guardarScore = vi.fn(async (_prev: unknown, _formData: FormData) => ({ error: null }));
const corregirScore = vi.fn(async (_prev: unknown, _formData: FormData) => ({ error: null }));

vi.mock("../actions", () => ({ guardarScore, corregirScore }));

const { GrillaDeScores } = await import("./GrillaDeScores");
import type { FilaDeScore } from "./GrillaDeScores";

afterEach(() => {
  cleanup();
  guardarScore.mockClear();
  corregirScore.mockClear();
});

const filaSinResultado: FilaDeScore = {
  teamId: "team-a",
  bib: 1,
  nombre: "Ana Diaz",
  divisionName: "RX",
  status: "pendiente",
  value: null,
  reps: null,
  capValue: null,
  tiebreak: null,
  source: null,
  corregidoEn: null,
  corregidoPorNombre: null,
  heatId: null,
  heatName: null,
};

const filaEnVivo: FilaDeScore = {
  ...filaSinResultado,
  teamId: "team-b",
  bib: 2,
  nombre: "Beto Ruiz",
  status: "valido",
  value: 115,
  source: "en_vivo",
};

describe("GrillaDeScores en modo corregir", () => {
  it("sin resultado del juez, no ofrece nada para editar", () => {
    render(
      <GrillaDeScores
        eventId="evt"
        partId="parte-1"
        scoreUnit="reps"
        tieneCap={false}
        tieneDesempate={false}
        modo="corregir"
        filas={[filaSinResultado]}
      />,
    );

    expect(screen.getByText(/todavía no hay resultado del juez/i)).toBeTruthy();
    expect(screen.queryByText("Corregir")).toBeNull();
  });

  it("con resultado, muestra el origen y arranca bloqueado hasta apretar Corregir", () => {
    render(
      <GrillaDeScores
        eventId="evt"
        partId="parte-1"
        scoreUnit="reps"
        tieneCap={false}
        tieneDesempate={false}
        modo="corregir"
        filas={[filaEnVivo]}
      />,
    );

    expect(screen.getByText("Juez")).toBeTruthy();
    const valor = screen.getByDisplayValue("115") as HTMLInputElement;
    expect(valor.disabled).toBe(true);
    expect(screen.queryByPlaceholderText(/impugnación revisada/i)).toBeNull();
  });

  it("exige motivo antes de dejar confirmar, y lo manda en la accion", async () => {
    render(
      <GrillaDeScores
        eventId="evt"
        partId="parte-1"
        scoreUnit="reps"
        tieneCap={false}
        tieneDesempate={false}
        modo="corregir"
        filas={[filaEnVivo]}
      />,
    );

    fireEvent.click(screen.getByText("Corregir"));

    const valor = screen.getByDisplayValue("115") as HTMLInputElement;
    expect(valor.disabled).toBe(false);

    const confirmar = screen.getByText("Confirmar corrección") as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);

    const motivo = screen.getByPlaceholderText(/impugnación revisada/i);
    fireEvent.change(motivo, { target: { value: "Revisado con el video del heat" } });
    expect(confirmar.disabled).toBe(false);

    fireEvent.change(valor, { target: { value: "108" } });
    fireEvent.click(confirmar);

    await Promise.resolve();

    expect(corregirScore).toHaveBeenCalledTimes(1);
    const [, formData] = corregirScore.mock.calls[0];
    expect(formData.get("teamId")).toBe("team-b");
    expect(formData.get("value")).toBe("108");
    expect(formData.get("motivo")).toBe("Revisado con el video del heat");
    expect(guardarScore).not.toHaveBeenCalled();
  });
});

describe("GrillaDeScores en modo cargar", () => {
  it("no exige motivo y llama a guardarScore", async () => {
    render(
      <GrillaDeScores
        eventId="evt"
        partId="parte-1"
        scoreUnit="reps"
        tieneCap={false}
        tieneDesempate={false}
        modo="cargar"
        filas={[filaSinResultado]}
      />,
    );

    // El valor arranca deshabilitado: la fila nace "pendiente", y solo se
    // habilita al elegir un estado que lo necesita.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "valido" } });

    const valor = screen.getByPlaceholderText("");
    expect((valor as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(valor, { target: { value: "80" } });
    fireEvent.click(screen.getByText("Guardar"));

    await Promise.resolve();

    expect(guardarScore).toHaveBeenCalledTimes(1);
    expect(corregirScore).not.toHaveBeenCalled();
  });
});
