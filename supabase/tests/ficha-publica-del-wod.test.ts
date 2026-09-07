/**
 * Lo que la ficha publica dice de un WOD: el peso en la unidad del reglamento y
 * el cap de cada categoria.
 *
 * El GATING de `released_at` —una prueba sin liberar se lista pero no se abre—
 * ya esta cubierto entero en catalogo.test.ts y no se repite aca. Lo que se
 * prueba es lo que 20260905400000 agrego:
 *
 *   - `cargaUnidad`, porque devolver solo kilos hacia que un WOD programado en
 *     libras se leyera "43.09 kg", un numero que no esta en ningun reglamento.
 *   - `capPorCategoria`, desde `part_divisions.time_cap_ms`: una columna que
 *     existia desde el dia uno y no leia nadie.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAnon, asUser } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

interface MovimientoPublico {
  nombre: string;
  cargaKg: string | number | null;
  cargaUnidad: string;
  porCategoria: Array<{
    division: string;
    cargaKg: string | number | null;
    cargaUnidad: string;
  }>;
}

interface PartePublica {
  timeCapMs: number | null;
  capPorCategoria: Array<{ division: string; timeCapMs: number }>;
  blocks: Array<{ movimientos: MovimientoPublico[] }>;
}

interface Detalle {
  workouts: Array<{ name: string; liberado: boolean; parts: PartePublica[] }>;
}

let partId = "";
let movimientoId = "";

beforeEach(async () => {
  s = await seedScenario();

  await asUser(s.db, s.users.owner, async () => {
    const w = await s.db.query<{ id: string }>(
      "insert into workouts (event_id, order_index, name) values ($1, 1, 'Fran') returning id",
      [s.eventId],
    );

    const parte = await s.db.query<{ id: string }>(
      `insert into workout_parts (workout_id, event_id, order_index, time_scheme, score_unit, score_dir, time_cap_ms, cap_unit)
       values ($1, $2, 0, 'cap', 'tiempo', 'menor_gana', 600000, 'reps') returning id`,
      [w.rows[0].id, s.eventId],
    );
    partId = parte.rows[0].id;

    await s.db.query(
      "insert into part_divisions (part_id, division_id, event_id) values ($1, $2, $3)",
      [partId, s.divisionId, s.eventId],
    );

    const bloque = await s.db.query<{ id: string }>(
      `insert into part_blocks (part_id, event_id, order_index, kind, repeticiones)
       values ($1, $2, 0, 'trabajo', 3) returning id`,
      [partId, s.eventId],
    );

    const mov = await s.db.query<{ id: string }>(
      "select id from movements where name = 'Thruster'",
    );

    // 43,09 kg son 95 lb, el numero del reglamento.
    const pm = await s.db.query<{ id: string }>(
      `insert into part_movements (block_id, part_id, event_id, order_index, movement_id, target_per_round, load_kg, load_unit)
       values ($1, $2, $3, 0, $4, '{21,15,9}', 43.09, 'lb') returning id`,
      [bloque.rows[0].id, partId, s.eventId, mov.rows[0].id],
    );
    movimientoId = pm.rows[0].id;

    // Liberada: su contenido tiene que salir.
    await s.db.query("update workouts set released_at = now() where id = $1", [w.rows[0].id]);
  });

  await publicar();
});

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

async function fran(): Promise<PartePublica> {
  let doc: Detalle | null = null;
  await asAnon(s.db, async () => {
    const res = await s.db.query<{ public_event_detail: Detalle | null }>(
      "select public_event_detail($1)",
      ["copa-test"],
    );
    doc = res.rows[0].public_event_detail;
  });
  const prueba = doc!.workouts.find((w) => w.name === "Fran")!;
  expect(prueba.liberado).toBe(true);
  return prueba.parts[0];
}

describe("el peso sale en la unidad en la que se escribió", () => {
  it("el peso base del movimiento trae su unidad", async () => {
    const mov = (await fran()).blocks[0].movimientos[0];
    expect(mov.cargaUnidad).toBe("lb");
    expect(Number(mov.cargaKg)).toBeCloseTo(43.09, 2);
  });

  it("el peso de cada categoría también", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select guardar_specs_de_parte($1, $2::jsonb)", [
        partId,
        JSON.stringify([
          {
            divisionId: s.divisionId,
            partMovementId: movimientoId,
            objetivo: [15, 12, 9],
            cargaKg: 29.48,
            cargaUnidad: "lb",
          },
        ]),
      ]),
    );

    const [categoria] = (await fran()).blocks[0].movimientos[0].porCategoria;
    expect(categoria.cargaUnidad).toBe("lb");
    expect(Number(categoria.cargaKg)).toBeCloseTo(29.48, 2);
  });
});

describe("el cap por categoría", () => {
  it("no aparece si ninguna categoría lo cambia", async () => {
    // Es el caso normal: todas comparten el cap de la parte, y una lista con la
    // misma cifra repetida para cada categoría sería ruido.
    const parte = await fran();
    expect(parte.timeCapMs).toBe(600_000);
    expect(parte.capPorCategoria).toEqual([]);
  });

  it("aparece cuando una categoría tiene el suyo", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        "update part_divisions set time_cap_ms = 900000 where part_id = $1 and division_id = $2",
        [partId, s.divisionId],
      ),
    );

    const parte = await fran();
    expect(parte.capPorCategoria).toHaveLength(1);
    expect(parte.capPorCategoria[0].timeCapMs).toBe(900_000);
    // El de la parte sigue viajando: es el que vale para las que no lo cambian.
    expect(parte.timeCapMs).toBe(600_000);
  });
});
