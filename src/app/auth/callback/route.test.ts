import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

import { GET } from "./route";

function pedir(query: string) {
  return GET(new NextRequest(`http://localhost:3000/auth/callback${query}`));
}

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe("callback de auth", () => {
  it("un destino interno se respeta", async () => {
    const res = await pedir("?code=abc&volver=/inscripcion/123");
    expect(res.headers.get("location")).toBe("http://localhost:3000/inscripcion/123");
  });

  it("sin destino va al panel", async () => {
    const res = await pedir("?code=abc");
    expect(res.headers.get("location")).toBe("http://localhost:3000/panel");
  });

  it("un destino que sale del sitio cae al panel: el link del correo lo controla quien lo arme", async () => {
    for (const volver of ["//sitio-malicioso.com", "https://sitio-malicioso.com", "/\\sitio-malicioso.com"]) {
      const res = await pedir(`?code=abc&volver=${encodeURIComponent(volver)}`);
      expect(res.headers.get("location")).toBe("http://localhost:3000/panel");
    }
  });

  it("sin codigo no canjea nada y vuelve al login", async () => {
    const res = await pedir("?volver=/panel");
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?error=sin-codigo&volver=%2Fpanel",
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("un codigo invalido vuelve al login SIN perder el destino original", async () => {
    // Pasa seguido: el link se abrio en otro navegador/dispositivo (el
    // verificador PKCE vive en una cookie del que arranco el registro), o un
    // escaneo de seguridad del correo gasto el codigo antes del click real. La
    // cuenta queda confirmada igual -- lo unico que falla es esta sesion -- asi
    // que quien inicia sesion a mano en /login tiene que caer en la misma
    // inscripcion que queria, no en el panel por defecto.
    exchangeCodeForSession.mockResolvedValue({ error: { message: "expirado" } });
    const res = await pedir("?code=abc&volver=%2Finscripcion%2F123");
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?error=link-invalido&volver=%2Finscripcion%2F123",
    );
  });
});
