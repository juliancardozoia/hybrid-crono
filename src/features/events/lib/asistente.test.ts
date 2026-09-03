import { describe, expect, it } from "vitest";
import { PASOS, indiceDelPaso, pasoAnterior, pasoSiguiente } from "./asistente";

describe("los pasos del asistente", () => {
  it("empieza por la ficha y termina por el resumen", () => {
    expect(PASOS[0].slug).toBe("general");
    expect(PASOS.at(-1)!.slug).toBe("resumen");
  });

  it("todos los pasos tienen ayuda: un paso sin explicar es un paso que se saltea", () => {
    expect(PASOS.every((p) => p.ayuda.length > 20)).toBe(true);
  });

  it("no hay slugs repetidos", () => {
    expect(new Set(PASOS.map((p) => p.slug)).size).toBe(PASOS.length);
  });

  it("encadena hacia adelante hasta el final", () => {
    let paso = PASOS[0];
    const recorrido = [paso.slug];
    let siguiente = pasoSiguiente(paso.slug);
    while (siguiente) {
      recorrido.push(siguiente.slug);
      paso = siguiente;
      siguiente = pasoSiguiente(paso.slug);
    }
    expect(recorrido).toEqual(PASOS.map((p) => p.slug));
  });

  it("el primero no tiene anterior y el último no tiene siguiente", () => {
    expect(pasoAnterior(PASOS[0].slug)).toBeNull();
    expect(pasoSiguiente(PASOS.at(-1)!.slug)).toBeNull();
  });

  it("ir y volver deja donde estaba", () => {
    const medio = PASOS[1];
    expect(pasoAnterior(pasoSiguiente(medio.slug)!.slug)?.slug).toBe(medio.slug);
  });

  it("un slug desconocido cae en el primer paso en vez de romper", () => {
    // La ruta es dinamica: alguien puede escribir cualquier cosa en la barra.
    expect(indiceDelPaso("no-existe")).toBe(0);
  });
});
