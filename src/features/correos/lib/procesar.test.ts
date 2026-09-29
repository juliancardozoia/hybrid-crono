import { describe, expect, it, vi } from "vitest";
import { procesarCola, type DependenciasDelProcesador } from "./procesar";
import type { CorreoEnCola } from "./tipos";

function fila(id: string, kind = "inscripcion_confirmada"): CorreoEnCola {
  return {
    id,
    kind,
    to_email: `${id}@correo.com`,
    attempts: 1,
    payload: { event_name: "Copa Test", path: "/inscripcion/x" },
  };
}

function deps(filas: CorreoEnCola[], sobre: Partial<DependenciasDelProcesador> = {}) {
  const marcadas: Array<{ id: string; ok: boolean; error?: string }> = [];
  const base: DependenciasDelProcesador = {
    baseUrl: "https://app.ejemplo.com",
    reclamar: async () => filas,
    marcar: async (id, ok, error) => {
      marcadas.push({ id, ok, error });
    },
    idiomaDe: async () => "es",
    enviar: async () => ({ ok: true }),
    ...sobre,
  };
  return { base, marcadas };
}

describe("procesarCola", () => {
  it("envia y marca cada correo", async () => {
    const { base, marcadas } = deps([fila("a"), fila("b")]);
    const resumen = await procesarCola(base);

    expect(resumen).toEqual({ reclamados: 2, enviados: 2, fallidos: 0 });
    expect(marcadas).toEqual([
      { id: "a", ok: true, error: undefined },
      { id: "b", ok: true, error: undefined },
    ]);
  });

  it("el idioma sale del perfil o de la pista, y llega a la plantilla", async () => {
    const enviar = vi.fn(async () => ({ ok: true as const }));
    const idiomaDe = vi.fn(async (_email: string, pista: unknown) => (pista === "pt" ? ("pt" as const) : ("es" as const)));
    const f = { ...fila("a"), payload: { event_name: "Copa Test", path: "/x", locale_hint: "pt" } };
    const { base } = deps([f], { enviar, idiomaDe });

    await procesarCola(base);

    expect(idiomaDe).toHaveBeenCalledWith("a@correo.com", "pt");
    const [mensaje] = enviar.mock.calls[0] as unknown as [{ asunto: string }];
    expect(mensaje.asunto).toMatch(/Inscrição confirmada/);
  });

  it("un rechazo del proveedor marca fallo con su motivo y no frena al resto", async () => {
    const { base, marcadas } = deps([fila("a"), fila("b")], {
      enviar: async (m) => (m.para.startsWith("a") ? { ok: false, error: "429 rate limit" } : { ok: true }),
    });
    const resumen = await procesarCola(base);

    expect(resumen).toEqual({ reclamados: 2, enviados: 1, fallidos: 1 });
    expect(marcadas[0]).toEqual({ id: "a", ok: false, error: "429 rate limit" });
    expect(marcadas[1].ok).toBe(true);
  });

  it("una excepcion en un correo no frena al resto", async () => {
    const { base, marcadas } = deps([fila("a"), fila("b")], {
      enviar: async (m) => {
        if (m.para.startsWith("a")) throw new Error("red caida");
        return { ok: true };
      },
    });
    const resumen = await procesarCola(base);

    expect(resumen.fallidos).toBe(1);
    expect(marcadas[0]).toMatchObject({ id: "a", ok: false, error: "red caida" });
    expect(marcadas[1]).toMatchObject({ id: "b", ok: true });
  });

  it("un tipo desconocido queda como fallo con el motivo, y no se envia nada", async () => {
    const enviar = vi.fn(async () => ({ ok: true as const }));
    const { base, marcadas } = deps([fila("a", "inventado")], { enviar });
    await procesarCola(base);

    expect(enviar).not.toHaveBeenCalled();
    expect(marcadas[0].ok).toBe(false);
    expect(marcadas[0].error).toMatch(/desconocido/);
  });

  it("si ni siquiera se puede marcar, sigue con el siguiente", async () => {
    const { base } = deps([fila("a"), fila("b")], {
      marcar: async (id) => {
        if (id === "a") throw new Error("base caida");
      },
    });
    const resumen = await procesarCola(base);
    expect(resumen.reclamados).toBe(2);
    expect(resumen.enviados).toBe(1);
  });

  it("pasa el id de la fila como clave de idempotencia", async () => {
    const enviar = vi.fn(async () => ({ ok: true as const }));
    const { base } = deps([fila("abc")], { enviar });
    await procesarCola(base);
    expect(enviar.mock.calls[0]).toEqual([expect.objectContaining({ para: "abc@correo.com" }), "abc"]);
  });

  it("respeta la pausa entre envios, y no espera despues del ultimo", async () => {
    const dormir = vi.fn(async () => {});
    const { base } = deps([fila("a"), fila("b"), fila("c")], { pausaMs: 500, dormir });
    await procesarCola(base);
    expect(dormir).toHaveBeenCalledTimes(2);
    expect(dormir).toHaveBeenCalledWith(500);
  });

  it("una cola vacia no hace nada", async () => {
    const { base } = deps([]);
    expect(await procesarCola(base)).toEqual({ reclamados: 0, enviados: 0, fallidos: 0 });
  });
});
