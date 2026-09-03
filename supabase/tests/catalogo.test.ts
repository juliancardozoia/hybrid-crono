/**
 * El catálogo público.
 *
 * Es la primera superficie que se sirve a gente sin cuenta, así que lo que más
 * importa acá es lo que NO se ve: un evento sin publicar, los datos de los
 * atletas, y un WOD que el organizador todavía no liberó.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAnon, asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
  // El fixture crea el evento sin fecha; el catálogo la exige para publicar.
  await asAdmin(s.db, () =>
    s.db.query(
      `update events set starts_at = now() + interval '30 days', country = 'CO',
         city = 'Medellín', organizer_name = 'Box Test', format = 'carrera_hibrida'
       where id = $1`,
      [s.eventId],
    ),
  );
  // Aparecer en el catálogo es del plan Pro. El resto del test mira el
  // catálogo, no el gate: eso se prueba aparte, en planes.test.ts.
  await asAdmin(s.db, () =>
    s.db.query("update organizations set plan = 'pro' where id = $1", [s.orgId]),
  );
});

async function publicar(): Promise<void> {
  await asUser(s.db, s.users.owner, () =>
    s.db.query("select publish_event($1)", [s.eventId]),
  );
}

interface FilaDeCatalogo {
  public_slug: string;
  name: string;
  destacado: boolean;
  inscripciones_abiertas: boolean;
  total: string;
}

async function catalogo(params: Record<string, unknown> = {}): Promise<FilaDeCatalogo[]> {
  const claves = [
    "p_busqueda",
    "p_pais",
    "p_formato",
    "p_desde",
    "p_hasta",
    "p_destacados",
    "p_slugs",
  ];
  const valores = claves.map((k) => params[k] ?? null);
  let filas: FilaDeCatalogo[] = [];

  await asAnon(s.db, async () => {
    const res = await s.db.query<FilaDeCatalogo>(
      `select * from public_events_catalog($1, $2, $3::public.event_format, $4::date, $5::date, coalesce($6::boolean, false), $7::text[])`,
      valores,
    );
    filas = res.rows;
  });

  return filas;
}

describe("publicar", () => {
  it("un evento sin publicar no está en el catálogo", async () => {
    expect(await catalogo()).toEqual([]);
  });

  it("publicado, aparece", async () => {
    await publicar();
    const filas = await catalogo();
    expect(filas).toHaveLength(1);
    expect(filas[0].name).toBe("Copa Test");
  });

  it("despublicar lo saca sin borrar nada", async () => {
    await publicar();
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select unpublish_event($1)", [s.eventId]),
    );
    expect(await catalogo()).toEqual([]);

    // El evento sigue existiendo: despublicar no es borrar.
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query("select id from events where id = $1", [s.eventId]);
      expect(res.rows).toHaveLength(1);
    });
  });

  it("no se publica sin fecha", async () => {
    await asAdmin(s.db, () =>
      s.db.query("update events set starts_at = null, event_date = null where id = $1", [
        s.eventId,
      ]),
    );
    const mensaje = await asUser(s.db, s.users.owner, () =>
      expectDenied(() => s.db.query("select publish_event($1)", [s.eventId])),
    );
    expect(mensaje).toMatch(/fecha/i);
  });

  it("no se publica sin categorías", async () => {
    await asAdmin(s.db, async () => {
      await s.db.query("delete from lanes where event_id = $1", [s.eventId]);
      await s.db.query("delete from teams where event_id = $1", [s.eventId]);
      await s.db.query("delete from part_divisions where event_id = $1", [s.eventId]);
      await s.db.query("delete from divisions where event_id = $1", [s.eventId]);
    });
    const mensaje = await asUser(s.db, s.users.owner, () =>
      expectDenied(() => s.db.query("select publish_event($1)", [s.eventId])),
    );
    expect(mensaje).toMatch(/categor/i);
  });

  it("un juez no publica", async () => {
    await asUser(s.db, s.users.judgeA, () =>
      expectDenied(() => s.db.query("select publish_event($1)", [s.eventId])),
    );
  });

  it("publicar dos veces no mueve la fecha de publicación", async () => {
    await publicar();
    let primera = "";
    await asUser(s.db, s.users.owner, async () => {
      primera = (
        await s.db.query<{ published_at: string }>(
          "select published_at from events where id = $1",
          [s.eventId],
        )
      ).rows[0].published_at;
      await s.db.query("select publish_event($1)", [s.eventId]);
      const segunda = (
        await s.db.query<{ published_at: string }>(
          "select published_at from events where id = $1",
          [s.eventId],
        )
      ).rows[0].published_at;
      expect(segunda).toEqual(primera);
    });
  });
});

describe("filtros del catálogo", () => {
  beforeEach(publicar);

  it("filtra por país", async () => {
    expect(await catalogo({ p_pais: "CO" })).toHaveLength(1);
    expect(await catalogo({ p_pais: "AR" })).toEqual([]);
  });

  it("filtra por formato", async () => {
    expect(await catalogo({ p_formato: "carrera_hibrida" })).toHaveLength(1);
    expect(await catalogo({ p_formato: "crossfit" })).toEqual([]);
  });

  it("busca por nombre, ciudad, sede u organizador", async () => {
    for (const termino of ["Copa", "medellín", "Box Test"]) {
      expect(await catalogo({ p_busqueda: termino })).toHaveLength(1);
    }
    expect(await catalogo({ p_busqueda: "Rosario" })).toEqual([]);
  });

  it("la búsqueda no distingue mayúsculas", async () => {
    expect(await catalogo({ p_busqueda: "COPA" })).toHaveLength(1);
  });

  it("filtra por rango de fechas, con el día final incluido", async () => {
    let fecha = "";
    await asAdmin(s.db, async () => {
      fecha = (
        await s.db.query<{ d: string }>(
          "select (starts_at at time zone timezone)::date::text as d from events where id = $1",
          [s.eventId],
        )
      ).rows[0].d;
    });

    // Un mes que empieza y termina el mismo dia del evento tiene que
    // encontrarlo: si el limite superior fuera exclusivo, un evento el ultimo
    // dia del mes desapareceria del filtro de ese mes.
    expect(await catalogo({ p_desde: fecha, p_hasta: fecha })).toHaveLength(1);
    expect(await catalogo({ p_desde: "2020-01-01", p_hasta: "2020-12-31" })).toEqual([]);
  });

  it("devuelve el total para poder paginar sin repetir la consulta", async () => {
    const filas = await catalogo();
    expect(Number(filas[0].total)).toBe(1);
  });

  it("los destacados se pueden pedir solos", async () => {
    expect(await catalogo({ p_destacados: true })).toEqual([]);

    await asAdmin(s.db, () =>
      s.db.query("update events set featured_at = now() where id = $1", [s.eventId]),
    );
    const filas = await catalogo({ p_destacados: true });
    expect(filas).toHaveLength(1);
    expect(filas[0].destacado).toBe(true);
  });

  it("los vistos recientemente se piden por slug", async () => {
    expect(await catalogo({ p_slugs: ["copa-test"] })).toHaveLength(1);
    expect(await catalogo({ p_slugs: ["no-existe"] })).toEqual([]);
  });

  it("informa si las inscripciones están abiertas", async () => {
    await asAdmin(s.db, () =>
      s.db.query(
        `update events set registration_opens_at = now() - interval '1 day',
           registration_closes_at = now() + interval '10 days' where id = $1`,
        [s.eventId],
      ),
    );
    expect((await catalogo())[0].inscripciones_abiertas).toBe(true);

    await asAdmin(s.db, () =>
      s.db.query(
        "update events set registration_closes_at = now() - interval '1 hour' where id = $1",
        [s.eventId],
      ),
    );
    expect((await catalogo())[0].inscripciones_abiertas).toBe(false);
  });

  it("ofrece los países y meses que realmente tienen competencias", async () => {
    await asAnon(s.db, async () => {
      const res = await s.db.query<{
        public_catalog_filters: { paises: Array<{ codigo: string }>; meses: unknown[] };
      }>("select public_catalog_filters()");
      const filtros = res.rows[0].public_catalog_filters;
      expect(filtros.paises.map((p) => p.codigo)).toEqual(["CO"]);
      expect(filtros.meses.length).toBeGreaterThan(0);
    });
  });
});

describe("la ficha pública", () => {
  interface Detalle {
    name: string;
    divisions: Array<{ name: string }>;
    workouts: Array<{ name: string; liberado: boolean; description: string | null; parts: unknown[] }>;
    schedule: unknown[];
    inscripcionesAbiertas: boolean;
  }

  async function detalle(slug = "copa-test"): Promise<Detalle | null> {
    let doc: Detalle | null = null;
    await asAnon(s.db, async () => {
      const res = await s.db.query<{ public_event_detail: Detalle | null }>(
        "select public_event_detail($1)",
        [slug],
      );
      doc = res.rows[0].public_event_detail;
    });
    return doc;
  }

  it("un evento sin publicar no tiene ficha", async () => {
    expect(await detalle()).toBeNull();
  });

  it("publicado, trae info y categorías", async () => {
    await publicar();
    const doc = await detalle();
    expect(doc?.name).toBe("Copa Test");
    expect(doc?.divisions.map((d) => d.name)).toEqual(["Individual Masculino RX"]);
  });

  it("las pruebas se listan pero su contenido no se revela hasta liberarlas", async () => {
    // Un WOD cargado con semanas de anticipación para configurar al juez no
    // tiene por qué ser público desde ese momento.
    await publicar();
    await asAdmin(s.db, () =>
      s.db.query("update workouts set description = 'Secreto' where event_id = $1", [s.eventId]),
    );

    let doc = await detalle();
    expect(doc?.workouts).toHaveLength(1);
    expect(doc?.workouts[0].liberado).toBe(false);
    expect(doc?.workouts[0].description).toBeNull();
    expect(doc?.workouts[0].parts).toEqual([]);

    await asAdmin(s.db, () =>
      s.db.query("update workouts set released_at = now() where event_id = $1", [s.eventId]),
    );

    doc = await detalle();
    expect(doc?.workouts[0].liberado).toBe(true);
    expect(doc?.workouts[0].description).toBe("Secreto");
    expect(doc?.workouts[0].parts).toHaveLength(1);
  });

  it("una liberación programada a futuro todavía no revela nada", async () => {
    await publicar();
    await asAdmin(s.db, () =>
      s.db.query(
        "update workouts set released_at = now() + interval '3 days', description = 'Secreto' where event_id = $1",
        [s.eventId],
      ),
    );
    const doc = await detalle();
    expect(doc?.workouts[0].liberado).toBe(false);
    expect(doc?.workouts[0].description).toBeNull();
  });

  it("el cronograma trae horas, no dorsales ni jueces", async () => {
    await publicar();
    await asAdmin(s.db, () =>
      s.db.query("update heats set scheduled_at = now() + interval '30 days' where event_id = $1", [
        s.eventId,
      ]),
    );
    const doc = await detalle();
    expect(doc?.schedule).toHaveLength(1);
    expect(JSON.stringify(doc)).not.toContain("Perez");
  });

  it("no filtra emails, teléfonos ni ids internos", async () => {
    await publicar();
    const texto = JSON.stringify(await detalle());
    expect(texto).not.toContain("@box.com");
    expect(texto).not.toContain(s.orgId);
    expect(texto).not.toContain(s.eventId);
  });

  it("un slug que no existe devuelve null en vez de reventar", async () => {
    await publicar();
    expect(await detalle("no-existe")).toBeNull();
  });
});

describe("la superficie del anónimo", () => {
  it("sigue sin poder tocar ninguna tabla", async () => {
    await publicar();
    await asAnon(s.db, async () => {
      for (const tabla of ["events", "divisions", "workouts", "teams", "athletes"]) {
        await expectDenied(() => s.db.query(`select * from ${tabla} limit 1`));
      }
    });
  });

  it("no puede publicar ni despublicar", async () => {
    await asAnon(s.db, async () => {
      await expectDenied(() => s.db.query("select publish_event($1)", [s.eventId]));
      await expectDenied(() => s.db.query("select unpublish_event($1)", [s.eventId]));
    });
  });
});
