// @vitest-environment jsdom

/*
 * El mismo error, dos veces seguidas, tiene que mostrar el toast las DOS
 * veces. Antes `useToastDeEstado` comparaba `estado.error` (el STRING) en el
 * array de dependencias del efecto: React compara dependencias por valor, asi
 * que un segundo error identico al primero no cambiaba el valor de la
 * dependencia y el efecto no volvia a correr — el toast solo aparecia la
 * primera vez, hasta refrescar la pantalla.
 *
 * El arnes dispara un `estado` NUEVO (objeto distinto) en cada click, con el
 * mismo mensaje las dos veces — exactamente lo que devuelve `useActionState`
 * en dos envios consecutivos de un formulario que falla igual las dos veces.
 */

import { render, screen, fireEvent, waitFor } from "../../../test/render";
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { useToastDeEstado } from "./Notificaciones";

function Arnes() {
  const [estado, setEstado] = useState<{ error: string | null }>({
    error: null,
  });
  useToastDeEstado(estado);
  return (
    <button onClick={() => setEstado({ error: "No se pudo guardar." })}>
      Disparar
    </button>
  );
}

describe("useToastDeEstado", () => {
  it("muestra el toast cada vez que llega un error, aunque el texto se repita", async () => {
    render(<Arnes />);
    const boton = screen.getByText("Disparar");

    fireEvent.click(boton);
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));

    fireEvent.click(boton);
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));

    fireEvent.click(boton);
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(3));
  });
});
