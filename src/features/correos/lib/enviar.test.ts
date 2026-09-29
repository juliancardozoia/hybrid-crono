import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driverConfigurado, enviarCorreo } from "./enviar";
import type { MensajeDeCorreo } from "./tipos";

const MENSAJE: MensajeDeCorreo = {
  para: "ana@correo.com",
  asunto: "Hola",
  html: "<p>Hola</p>",
  texto: "Hola",
};

let carpeta: string;
beforeEach(async () => {
  carpeta = await mkdtemp(join(tmpdir(), "correos-"));
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(carpeta, { recursive: true, force: true });
});

describe("driverConfigurado", () => {
  it("en desarrollo, sin variable, cae en log", () => {
    expect(driverConfigurado({ NODE_ENV: "development" })).toBe("log");
  });

  it("en PRODUCCION sin variable NO cae en log: esta mal configurado", () => {
    expect(driverConfigurado({ NODE_ENV: "production" })).toBeNull();
  });

  it("un valor invalido esta mal configurado, no se adivina", () => {
    expect(driverConfigurado({ EMAIL_DRIVER: "sendgrid", NODE_ENV: "development" })).toBeNull();
  });

  it("acepta los dos validos, sin importar mayusculas", () => {
    expect(driverConfigurado({ EMAIL_DRIVER: "RESEND" })).toBe("resend");
    expect(driverConfigurado({ EMAIL_DRIVER: " log " })).toBe("log");
  });
});

describe("enviarCorreo", () => {
  it("en produccion sin driver falla con un mensaje claro y NO escribe nada", async () => {
    const r = await enviarCorreo(MENSAJE, { env: { NODE_ENV: "production" }, carpetaDeLog: carpeta });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/EMAIL_DRIVER/);
    expect(await readdir(carpeta)).toHaveLength(0);
  });

  it("driver log: deja el html y el texto en la carpeta", async () => {
    const r = await enviarCorreo(MENSAJE, { env: { EMAIL_DRIVER: "log" }, carpetaDeLog: carpeta });
    expect(r.ok).toBe(true);

    const archivos = (await readdir(carpeta)).sort();
    expect(archivos).toHaveLength(2);
    const txt = await readFile(join(carpeta, archivos.find((a) => a.endsWith(".txt"))!), "utf8");
    expect(txt).toContain("Para: ana@correo.com");
    expect(txt).toContain("Asunto: Hola");
  });

  it("resend: manda la peticion con clave, remitente e idempotencia", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id: "re_123" }), { status: 200 }));
    const r = await enviarCorreo(MENSAJE, {
      env: { EMAIL_DRIVER: "resend", RESEND_API_KEY: "re_clave", EMAIL_FROM: "Scora <no-reply@mail.ejemplo.com>", EMAIL_REPLY_TO: "hola@ejemplo.com" },
      idempotencia: "fila-1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(r).toEqual({ ok: true, idExterno: "re_123" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_clave",
      "Idempotency-Key": "fila-1",
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      from: "Scora <no-reply@mail.ejemplo.com>",
      to: ["ana@correo.com"],
      subject: "Hola",
      reply_to: "hola@ejemplo.com",
    });
  });

  it("resend sin clave o sin remitente falla sin llamar a la red", async () => {
    const fetchFn = vi.fn();
    const r = await enviarCorreo(MENSAJE, {
      env: { EMAIL_DRIVER: "resend", RESEND_API_KEY: "re_clave" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("resend: un rechazo del proveedor devuelve el motivo", async () => {
    const fetchFn = vi.fn(async () => new Response("rate limit", { status: 429 }));
    const r = await enviarCorreo(MENSAJE, {
      env: { EMAIL_DRIVER: "resend", RESEND_API_KEY: "k", EMAIL_FROM: "a@b.com" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/429/);
  });

  it("resend: una caida de red es un fallo transitorio, no una excepcion", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const r = await enviarCorreo(MENSAJE, {
      env: { EMAIL_DRIVER: "resend", RESEND_API_KEY: "k", EMAIL_FROM: "a@b.com" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/ECONNRESET/);
  });
});
