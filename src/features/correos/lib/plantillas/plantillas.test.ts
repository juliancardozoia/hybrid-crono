import { describe, expect, it } from "vitest";
import { IDIOMAS } from "@/shared/i18n/idiomas";
import { TIPOS_DE_CORREO } from "../tipos";
import { renderizarCorreo } from ".";

const BASE = "https://app.ejemplo.com";

const PAYLOADS: Record<(typeof TIPOS_DE_CORREO)[number], Record<string, unknown>> = {
  invitacion_equipo: {
    event_name: "Copa Test",
    division_name: "Parejas Mixtas",
    team_name: "Los Fuertes",
    captain_name: "Ana Pérez",
    path: "/inscripcion/abc-123",
  },
  inscripcion_confirmada: {
    event_name: "Copa Test",
    division_name: "Individual",
    path: "/inscripcion/abc-123",
  },
  pago_recibido: {
    event_name: "Copa Test",
    division_name: "Individual",
    // Centavos, como todo el esquema: 20.000.000 centavos son 200.000 pesos.
    total_cents: 20000000,
    currency: "COP",
    path: "/inscripcion/abc-123",
  },
  invitacion_staff: {
    event_name: "Copa Test",
    staff_role: "judge",
    has_account: false,
    inviter_name: "Organizador",
    path: "/juez",
  },
  juez_aprobado: { event_name: "Copa Test", staff_role: "judge", path: "/juez" },
};

describe("plantillas de correo", () => {
  for (const idioma of IDIOMAS.map((i) => i.codigo)) {
    for (const tipo of TIPOS_DE_CORREO) {
      it(`${tipo} en ${idioma}: sin variables sin interpolar, con el link correcto`, () => {
        const c = renderizarCorreo({ kind: tipo, payload: PAYLOADS[tipo] }, idioma, BASE);

        expect(c.asunto).toContain("Copa Test");
        for (const parte of [c.asunto, c.html, c.texto]) {
          expect(parte).not.toMatch(/\{\w+\}/);
        }
        const path = PAYLOADS[tipo].path as string;
        expect(c.html).toContain(`href="${BASE}${path}"`);
        expect(c.texto).toContain(`${BASE}${path}`);
      });
    }
  }

  it("el idioma cambia el texto de verdad", () => {
    const fila = { kind: "inscripcion_confirmada", payload: PAYLOADS.inscripcion_confirmada };
    expect(renderizarCorreo(fila, "es", BASE).asunto).toMatch(/Inscripción confirmada/);
    expect(renderizarCorreo(fila, "pt", BASE).asunto).toMatch(/Inscrição confirmada/);
    expect(renderizarCorreo(fila, "en", BASE).asunto).toMatch(/Registration confirmed/);
  });

  it("un tipo desconocido lanza en vez de mandar un correo vacio", () => {
    expect(() => renderizarCorreo({ kind: "inventado", payload: {} }, "es", BASE)).toThrow(/desconocido/);
  });

  it("escapa lo que escribio una persona: un nombre con HTML no inyecta nada", () => {
    const c = renderizarCorreo(
      {
        kind: "invitacion_equipo",
        payload: { ...PAYLOADS.invitacion_equipo, team_name: '<img src=x onerror="alert(1)">' },
      },
      "es",
      BASE,
    );
    expect(c.html).not.toContain("<img");
    expect(c.html).toContain("&lt;img");
  });

  it("el asunto no puede llevar saltos de linea (inyeccion de cabeceras)", () => {
    const c = renderizarCorreo(
      {
        kind: "invitacion_equipo",
        payload: { ...PAYLOADS.invitacion_equipo, captain_name: "Ana\r\nBcc: victima@correo.com" },
      },
      "es",
      BASE,
    );
    expect(c.asunto).not.toMatch(/[\r\n]/);
  });

  it("un path que intenta salir del sitio cae al panel", () => {
    const c = renderizarCorreo(
      { kind: "juez_aprobado", payload: { event_name: "X", path: "//sitio-malicioso.com" } },
      "es",
      BASE,
    );
    expect(c.html).toContain(`href="${BASE}/panel"`);
    expect(c.html).not.toContain("sitio-malicioso");
  });

  it("el monto sale en la moneda de la orden", () => {
    const c = renderizarCorreo(
      { kind: "pago_recibido", payload: PAYLOADS.pago_recibido },
      "es",
      BASE,
    );
    expect(c.texto).toMatch(/COP\s?200[.,]000/);
  });

  it("al juez le habla de Juzgar; al colaborador, del panel; y avisa si no tiene cuenta", () => {
    const juez = renderizarCorreo({ kind: "invitacion_staff", payload: PAYLOADS.invitacion_staff }, "es", BASE);
    expect(juez.texto).toMatch(/Juzgar/);
    expect(juez.texto).toMatch(/no tienes cuenta/);

    const colaborador = renderizarCorreo(
      {
        kind: "invitacion_staff",
        payload: { ...PAYLOADS.invitacion_staff, staff_role: "registrar", has_account: true, path: "/panel" },
      },
      "es",
      BASE,
    );
    expect(colaborador.texto).toMatch(/colaborador/);
    expect(colaborador.texto).not.toMatch(/no tienes cuenta/);
  });

  it("sin nombre de quien invita, usa una forma neutra en vez de 'null'", () => {
    const c = renderizarCorreo(
      { kind: "invitacion_equipo", payload: { event_name: "Copa Test", path: "/inscripcion/x" } },
      "es",
      BASE,
    );
    expect(c.asunto).not.toMatch(/null|undefined/);
    expect(c.asunto).toMatch(/Un atleta/);
  });
});
