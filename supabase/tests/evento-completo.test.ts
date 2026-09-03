/**
 * La ficha del evento: campos nuevos, fecha derivada y documentos.
 *
 * Lo que mas importa aca es la derivacion de `event_date`: se calcula en el
 * HUSO DEL EVENTO, no en UTC. Sin eso, una competencia que larga de noche en
 * Bogota aparece un dia corrida en el catalogo.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAnon, asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
});

async function leerEvento<T extends Record<string, unknown>>(columnas: string): Promise<T> {
  let fila = {} as T;
  await asUser(s.db, s.users.owner, async () => {
    const res = await s.db.query<T>(`select ${columnas} from events where id = $1`, [s.eventId]);
    fila = res.rows[0];
  });
  return fila;
}

describe("los campos nuevos", () => {
  it("un evento nace presencial y como carrera híbrida", async () => {
    const fila = await leerEvento<{ event_type: string; format: string }>(
      "event_type, format",
    );
    // Los defaults describen lo que el producto ya hacia: eventos presenciales
    // de circuito cronometrado.
    expect(fila.event_type).toBe("presencial");
    expect(fila.format).toBe("carrera_hibrida");
  });

  it("guarda ubicación, redes y contacto", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        `update events set
           country = 'CO', state = 'Antioquia', city = 'Medellín',
           address = 'Calle 10 #43-20',
           organizer_name = 'Box Test', organizer_phone_country = '+57',
           organizer_phone = '3001234567', instagram = 'boxtest', website = 'https://boxtest.co'
         where id = $1`,
        [s.eventId],
      );
    });

    const fila = await leerEvento<{ city: string; organizer_phone_country: string }>(
      "city, organizer_phone_country",
    );
    expect(fila.city).toBe("Medellín");
    expect(fila.organizer_phone_country).toBe("+57");
  });

  it("el país se guarda como código ISO de dos letras", async () => {
    await asUser(s.db, s.users.owner, () =>
      expectDenied(() =>
        s.db.query("update events set country = 'Colombia' where id = $1", [s.eventId]),
      ),
    );
  });

  it("las tallas vacías significan que el evento no entrega remera", async () => {
    const fila = await leerEvento<{ shirt_sizes: string[] }>("shirt_sizes");
    expect(fila.shirt_sizes).toEqual([]);
  });

  it("rechaza un evento que termina antes de empezar", async () => {
    await asUser(s.db, s.users.owner, () =>
      expectDenied(() =>
        s.db.query(
          "update events set starts_at = now(), ends_at = now() - interval '1 day' where id = $1",
          [s.eventId],
        ),
      ),
    );
  });

  it("rechaza una inscripción que cierra antes de abrir", async () => {
    await asUser(s.db, s.users.owner, () =>
      expectDenied(() =>
        s.db.query(
          `update events set registration_opens_at = now(),
             registration_closes_at = now() - interval '1 day' where id = $1`,
          [s.eventId],
        ),
      ),
    );
  });
});

describe("la fecha se deriva en el huso del evento", () => {
  it("una largada de noche en Bogotá no corre al día siguiente", async () => {
    // 20:55 en Bogotá es 01:55 UTC del dia siguiente. Calculada sin huso, la
    // competencia aparecia un dia corrida en el catalogo.
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        `update events set timezone = 'America/Bogota',
           starts_at = '2026-03-14 20:55:00-05' where id = $1`,
        [s.eventId],
      );
    });

    const fila = await leerEvento<{ event_date: string }>("event_date::text as event_date");
    expect(fila.event_date).toBe("2026-03-14");
  });

  it("el mismo instante en otro huso da otra fecha", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        `update events set timezone = 'Europe/Madrid',
           starts_at = '2026-03-14 20:55:00-05' where id = $1`,
        [s.eventId],
      );
    });

    const fila = await leerEvento<{ event_date: string }>("event_date::text as event_date");
    expect(fila.event_date).toBe("2026-03-15");
  });

  it("cambiar el huso recalcula la fecha", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        "update events set starts_at = '2026-03-14 23:30:00-05' where id = $1",
        [s.eventId],
      );
      await s.db.query("update events set timezone = 'America/Sao_Paulo' where id = $1", [
        s.eventId,
      ]);
    });

    const fila = await leerEvento<{ event_date: string }>("event_date::text as event_date");
    expect(fila.event_date).toBe("2026-03-15");
  });

  it("los eventos que ya existían quedaron con starts_at", async () => {
    // El backfill los rellena al mediodia del huso, para no correr de dia por
    // redondeo en ninguna direccion.
    await asAdmin(s.db, async () => {
      const res = await s.db.query<{ n: number }>(
        "select count(*)::int as n from events where event_date is not null and starts_at is null",
      );
      expect(res.rows[0].n).toBe(0);
    });
  });
});

describe("documentos del evento", () => {
  it("el organizador los carga y quedan ordenados", async () => {
    await asUser(s.db, s.users.owner, async () => {
      for (const [i, [kind, name]] of [
        ["terminos", "Términos y condiciones"],
        ["waiver", "Descargo de responsabilidad"],
      ].entries()) {
        await s.db.query(
          `insert into event_documents (event_id, kind, name, url, requires_acceptance, order_index)
           values ($1, $2, $3, $4, true, $5)`,
          [s.eventId, kind, name, `https://ejemplo.com/${kind}.pdf`, i],
        );
      }

      const res = await s.db.query<{ name: string }>(
        "select name from event_documents where event_id = $1 order by order_index",
        [s.eventId],
      );
      expect(res.rows.map((r) => r.name)).toEqual([
        "Términos y condiciones",
        "Descargo de responsabilidad",
      ]);
    });
  });

  it("un juez los lee pero no los edita", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        "insert into event_documents (event_id, name, url) values ($1, 'Reglamento', 'https://x.co/r.pdf')",
        [s.eventId],
      ),
    );

    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query("select * from event_documents where event_id = $1", [
        s.eventId,
      ]);
      expect(res.rows).toHaveLength(1);

      await expectDenied(() =>
        s.db.query(
          "insert into event_documents (event_id, name, url) values ($1, 'Mío', 'https://x.co/m.pdf')",
          [s.eventId],
        ),
      );
    });
  });

  it("un miembro de otra organización no ve nada, y el anónimo ni siquiera puede preguntar", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        "insert into event_documents (event_id, name, url) values ($1, 'Reglamento', 'https://x.co/r.pdf')",
        [s.eventId],
      ),
    );

    // Son dos barreras distintas y conviene no confundirlas: al forastero lo
    // frena RLS, que le devuelve cero filas sin error. Al anonimo lo frena la
    // ausencia de GRANT, que si es un error.
    await asUser(s.db, s.users.forastero, async () => {
      const res = await s.db.query("select * from event_documents");
      expect(res.rows).toEqual([]);
    });

    await asAnon(s.db, () => expectDenied(() => s.db.query("select * from event_documents")));
  });
});

/**
 * Regresiones de una misma clase de bug: una FK compuesta con ON DELETE SET
 * NULL anula TODAS sus columnas, incluida event_id, que es NOT NULL. El
 * sintoma es un error que no menciona ni la tabla ni la accion que lo provoco.
 */
describe("borrados que antes reventaban", () => {
  it("se puede borrar una categoría que ya tiene un heat asignado", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("update heats set division_id = $1 where event_id = $2", [
        s.divisionId,
        s.eventId,
      ]);
      // El heat referencia la categoría; borrarla tiene que dejarlo sin
      // categoría, no fallar.
      await s.db.query("delete from lanes where event_id = $1", [s.eventId]);
      await s.db.query("delete from teams where event_id = $1", [s.eventId]);
      await s.db.query("delete from part_divisions where division_id = $1", [s.divisionId]);
      await s.db.query("delete from divisions where id = $1", [s.divisionId]);

      const res = await s.db.query<{ division_id: string | null; event_id: string }>(
        "select division_id, event_id from heats where event_id = $1",
        [s.eventId],
      );
      expect(res.rows[0].division_id).toBeNull();
      expect(res.rows[0].event_id).toBe(s.eventId);
    });
  });

  it("se puede quitar un segmento del circuito después de cronometrarlo", async () => {
    await asAdmin(s.db, async () => {
      // Un marcaje que apunta al segmento que se va a borrar.
      await s.db.query(
        `insert into timing_events (id, lane_id, heat_id, event_id, seq, type, segment_id, elapsed_ms, recorded_by)
         values (gen_random_uuid(), $1, $2, $3, 1, 'segment_split', $4, 120000, $5)`,
        [s.laneIds[0], s.heatId, s.eventId, s.segmentIds[0], s.users.judgeA],
      );

      await s.db.query("delete from segments where id = $1", [s.segmentIds[0]]);

      // El marcaje sobrevive: el reductor resuelve los parciales por posición,
      // así que un marcaje huérfano sigue contando. Perderlo seria perder un
      // tiempo, que es lo único que el producto no puede permitirse.
      const res = await s.db.query<{ segment_id: string | null; elapsed_ms: number }>(
        "select segment_id, elapsed_ms from timing_events where lane_id = $1",
        [s.laneIds[0]],
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].segment_id).toBeNull();
      expect(res.rows[0].elapsed_ms).toBe(120000);
    });
  });
});
