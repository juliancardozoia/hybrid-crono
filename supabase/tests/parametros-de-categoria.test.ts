/**
 * Los parametros de una categoria: que se levanta y cuanto.
 *
 * `division_movements` existe desde 20260901102300 y no tenia NINGUN test. Su
 * proposito declarado es que un atleta que navega el catalogo compare
 * categorias y decida en cual anotarse — y hasta 20260905200000 la tabla no
 * llegaba a ninguna funcion `public_*`, asi que ese proposito no se cumplia.
 *
 * Lo que mas importa de este archivo: los parametros salen a la ficha publica
 * SIN depender de que ninguna prueba este liberada. Son dos cosas distintas y
 * confundirlas invierte el motivo por el que la tabla existe.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAnon, asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
});

/**
 * Deja el evento en condiciones de salir al catalogo.
 *
 * `publish_event()` exige fecha, pais y ciudad, y aparecer en el catalogo es
 * del plan Pro — nada de eso es lo que este archivo prueba.
 */
async function publicar(): Promise<void> {
  await asUser(s.db, s.users.owner, () =>
    s.db.query(
      `update events set starts_at = now() + interval '30 days',
         country = 'CO', city = 'Medellín', organizer_name = 'Box Test'
       where id = $1`,
      [s.eventId],
    ),
  );
  await asAdmin(s.db, () =>
    s.db.query("update organizations set plan = 'pro' where id = $1", [s.orgId]),
  );
  await asUser(s.db, s.users.owner, () =>
    s.db.query("select publish_event($1)", [s.eventId]),
  );
}

/** Un movimiento del catalogo global, por nombre exacto. */
async function delCatalogo(nombre: string): Promise<string> {
  const res = await asUser(s.db, s.users.owner, () =>
    s.db.query<{ id: string }>("select id from movements where name = $1", [nombre]),
  );
  return res.rows[0].id;
}

async function cargarThruster(loadKg: number, unidad: "kg" | "lb" = "kg"): Promise<string> {
  const movementId = await delCatalogo("Thruster");
  let id = "";
  await asUser(s.db, s.users.owner, async () => {
    const res = await s.db.query<{ id: string }>(
      `insert into division_movements
         (division_id, event_id, order_index, movement_id, load_kg, load_unit)
       values ($1, $2, 0, $3, $4, $5) returning id`,
      [s.divisionId, s.eventId, movementId, loadKg, unidad],
    );
    id = res.rows[0].id;
  });
  return id;
}

describe("quien puede tocarlos", () => {
  it("la organización del evento los carga y los lee", async () => {
    const id = await cargarThruster(43);

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ load_kg: string; load_unit: string }>(
        "select load_kg, load_unit from division_movements where id = $1",
        [id],
      );
      expect(Number(res.rows[0].load_kg)).toBe(43);
      expect(res.rows[0].load_unit).toBe("kg");
    });
  });

  /**
   * RLS devuelve CERO FILAS, sin error: es lo que frena a un usuario logueado
   * ajeno al evento. `expectDenied` NO sirve para esto.
   */
  it("un forastero logueado no ve ninguna fila", async () => {
    await cargarThruster(43);

    await asUser(s.db, s.users.forastero, async () => {
      const res = await s.db.query("select * from division_movements where event_id = $1", [
        s.eventId,
      ]);
      expect(res.rows).toHaveLength(0);
    });
  });

  /** La ausencia de GRANT SI es un error: es lo que frena al rol anon. */
  it("el anónimo ni siquiera llega a la tabla", async () => {
    await cargarThruster(43);

    await asAnon(s.db, async () => {
      await expectDenied(() => s.db.query("select * from division_movements"));
    });
  });
});

describe("lo que la base no deja cargar mal", () => {
  it("o es del catálogo o se escribe a mano, nunca los dos", async () => {
    const movementId = await delCatalogo("Thruster");

    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query(
          `insert into division_movements (division_id, event_id, movement_id, custom_name)
           values ($1, $2, $3, 'Thruster raro')`,
          [s.divisionId, s.eventId, movementId],
        ),
      );
      expect(msg).toContain("division_movement_tiene_nombre");
    });
  });

  it("tampoco sin ninguno de los dos", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query(
          "insert into division_movements (division_id, event_id) values ($1, $2)",
          [s.divisionId, s.eventId],
        ),
      );
      expect(msg).toContain("division_movement_tiene_nombre");
    });
  });

  it("el mismo movimiento dos veces en la categoría es un error de carga", async () => {
    await cargarThruster(43);
    const movementId = await delCatalogo("Thruster");

    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query(
          `insert into division_movements (division_id, event_id, movement_id, load_kg)
           values ($1, $2, $3, 60)`,
          [s.divisionId, s.eventId, movementId],
        ),
      );
      expect(msg).toContain("division_movements_division_id_movement_id_key");
    });
  });
});

describe("en la ficha pública", () => {
  interface Categoria {
    name: string;
    movimientos: Array<{
      nombre: string;
      cargaKg: string | number | null;
      cargaUnidad: string;
      spec: string | null;
    }>;
  }

  interface Detalle {
    divisions: Categoria[];
    workouts: Array<{ name: string; liberado: boolean }>;
  }

  async function detalle(): Promise<Detalle | null> {
    let doc: Detalle | null = null;
    await asAnon(s.db, async () => {
      const res = await s.db.query<{ public_event_detail: Detalle | null }>(
        "select public_event_detail($1)",
        ["copa-test"],
      );
      doc = res.rows[0].public_event_detail;
    });
    return doc;
  }

  it("salen aunque NINGUNA prueba esté liberada", async () => {
    await cargarThruster(43);
    await publicar();

    const doc = await detalle();

    // El fixture tiene la prueba del circuito, y sin `released_at` su
    // contenido no se muestra. Los parámetros de la categoría sí: es
    // exactamente la separación que la migración vino a hacer.
    expect(doc!.workouts.every((w) => w.liberado === false)).toBe(true);

    const cat = doc!.divisions[0];
    expect(cat.movimientos).toHaveLength(1);
    expect(cat.movimientos[0].nombre).toBe("Thruster");
    expect(Number(cat.movimientos[0].cargaKg)).toBe(43);
  });

  it("devuelve la unidad en la que se escribió, no solo los kilos", async () => {
    // 95 lb son 43,09 kg. El atleta tiene que leer "95 lb": es el número del
    // reglamento, y el kilo con decimales no significa nada para él.
    await cargarThruster(43.09, "lb");
    await publicar();

    const doc = await detalle();
    expect(doc!.divisions[0].movimientos[0].cargaUnidad).toBe("lb");
  });

  it("una categoría sin parámetros trae la lista vacía, no null", async () => {
    await publicar();

    const doc = await detalle();
    expect(doc!.divisions[0].movimientos).toEqual([]);
  });

  it("respetan el orden en que los cargó el organizador", async () => {
    const burpee = await delCatalogo("Burpee");
    await cargarThruster(43);

    await asUser(s.db, s.users.owner, async () => {
      // El burpee se inserta DESPUÉS pero con un `order_index` mayor, y el
      // thruster se corre al final: el orden que sale a la ficha es el que
      // decidió el organizador, no el de carga.
      await s.db.query(
        `insert into division_movements (division_id, event_id, order_index, movement_id)
         values ($1, $2, 1, $3)`,
        [s.divisionId, s.eventId, burpee],
      );
      await s.db.query(
        "update division_movements set order_index = 2 where division_id = $1 and movement_id is distinct from $2",
        [s.divisionId, burpee],
      );
    });
    await publicar();

    const doc = await detalle();
    expect(doc!.divisions[0].movimientos.map((m) => m.nombre)).toEqual([
      "Burpee",
      "Thruster",
    ]);
  });

  it("un movimiento fuera del catálogo sale con el nombre escrito a mano", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        `insert into division_movements (division_id, event_id, custom_name, spec)
         values ($1, $2, 'Worm Carry', '3 personas')`,
        [s.divisionId, s.eventId],
      );
    });
    await publicar();

    const doc = await detalle();
    expect(doc!.divisions[0].movimientos[0]).toMatchObject({
      nombre: "Worm Carry",
      cargaKg: null,
      spec: "3 personas",
    });
  });
});
