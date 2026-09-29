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
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=sin-codigo");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("un codigo invalido vuelve al login", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "expirado" } });
    const res = await pedir("?code=abc&volver=/panel");
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=link-invalido");
  });
});
