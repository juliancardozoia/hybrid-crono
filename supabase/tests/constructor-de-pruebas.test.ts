/**
 * El constructor de pruebas: reordenar y los pesos por categoria.
 *
 * Hasta aca una prueba se podia crear y borrar y nada mas.
 * `division_movement_specs` —la tabla que hace Rx contra Scaled, que leen el
 * juez y el recalculo— no tenia NINGUN camino de escritura en la app, asi que
 * todas las categorias juzgaban con el mismo peso.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

interface Prueba {
  workoutId: string;
  partId: string;
  blockId: string;
  movimientos: string[];
}

let p: Prueba;

beforeEach(async () => {
  s = await seedScenario();
  p = await crearPrueba();
});

/** Una prueba con un bloque y tres movimientos, en orden. */
async function crearPrueba(nombre = "WOD 1"): Promise<Prueba> {
  const prueba: Prueba = { workoutId: "", partId: "", blockId: "", movimientos: [] };

  await asUser(s.db, s.users.owner, async () => {
    const orden = await s.db.query<{ n: number }>(
      "select coalesce(max(order_index) + 1, 0) as n from workouts where event_id = $1",
      [s.eventId],
    );

    const w = await s.db.query<{ id: string }>(
      "insert into workouts (event_id, order_index, name) values ($1, $2, $3) returning id",
      [s.eventId, orden.rows[0].n, nombre],
    );
    prueba.workoutId = w.rows[0].id;

    const parte = await s.db.query<{ id: string }>(
      `insert into workout_parts (workout_id, event_id, order_index, time_scheme, score_unit, score_dir, time_cap_ms, cap_unit)
       values ($1, $2, 0, 'cap', 'tiempo', 'menor_gana', 600000, 'reps') returning id`,
      [prueba.workoutId, s.eventId],
    );
    prueba.partId = parte.rows[0].id;

    await s.db.query(
      "insert into part_divisions (part_id, division_id, event_id) values ($1, $2, $3)",
      [prueba.partId, s.divisionId, s.eventId],
    );

    const bloque = await s.db.query<{ id: string }>(
      `insert into part_blocks (part_id, event_id, order_index, kind, repeticiones)
       values ($1, $2, 0, 'trabajo', 3) returning id`,
      [prueba.partId, s.eventId],
    );
    prueba.blockId = bloque.rows[0].id;

    for (const [i, nombreMov] of ["Thruster", "Pull-up", "Burpee"].entries()) {
      const mov = await s.db.query<{ id: string }>(
        "select id from movements where name = $1",
        [nombreMov],
      );
      const pm = await s.db.query<{ id: string }>(
        `insert into part_movements (block_id, part_id, event_id, order_index, movement_id, target_per_round)
         values ($1, $2, $3, $4, $5, '{21,15,9}') returning id`,
        [prueba.blockId, prueba.partId, s.eventId, i, mov.rows[0].id],
      );
      prueba.movimientos.push(pm.rows[0].id);
    }
  });

  return prueba;
}

async function ordenDeMovimientos(): Promise<string[]> {
  const res = await asUser(s.db, s.users.owner, () =>
    s.db.query<{ id: string }>(
      "select id from part_movements where block_id = $1 order by order_index",
      [p.blockId],
    ),
  );
  return res.rows.map((r) => r.id);
}

describe("la unidad en la que se escribió el peso", () => {
  it("un movimiento nace en kilos: es lo único que había antes", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ load_unit: string; capture_style: string | null }>(
        "select load_unit, capture_style from part_movements where id = $1",
        [p.movimientos[0]],
      );
      expect(res.rows[0].load_unit).toBe("kg");
      // Null = "el derivado", no "tap". Con un default congelado en el insert,
      // mejorar la regla después no alcanzaría a ninguna fila ya creada.
      expect(res.rows[0].capture_style).toBeNull();
    });
  });
});

describe("reordenar", () => {
  it("mueve el del medio al principio sin violar el unique", async () => {
    const [a, b, c] = p.movimientos;

    await asUser(s.db, s.users.owner, () =>
      s.db.query("select reorder_part_movements($1, $2)", [p.blockId, [b, a, c]]),
    );

    expect(await ordenDeMovimientos()).toEqual([b, a, c]);
  });

  it("una lista incompleta se rechaza entera", async () => {
    // Aplicar un reordenamiento a medias dejaría movimientos con índices
    // basura: mejor no tocar nada.
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select reorder_part_movements($1, $2)", [
          p.blockId,
          [p.movimientos[0]],
        ]),
      );
      expect(msg).toContain("La lista tiene 1 movimientos y el bloque tiene 3");
    });

    expect(await ordenDeMovimientos()).toEqual(p.movimientos);
  });

  it("una lista con un id ajeno tampoco pasa", async () => {
    const otra = await crearPrueba("WOD ajeno");

    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select reorder_part_movements($1, $2)", [
          p.blockId,
          [p.movimientos[0], p.movimientos[1], otra.movimientos[0]],
        ]),
      );
      expect(msg).toContain("no corresponde a los movimientos");
    });
  });

  it("las pruebas del evento se reordenan igual", async () => {
    const otra = await crearPrueba("WOD 2");

    await asUser(s.db, s.users.owner, async () => {
      // El fixture ya dejó la prueba del circuito, así que son tres.
      const todas = await s.db.query<{ id: string }>(
        "select id from workouts where event_id = $1 order by order_index",
        [s.eventId],
      );
      const ids = todas.rows.map((r) => r.id);
      const invertidas = [...ids].reverse();

      await s.db.query("select reorder_workouts($1, $2)", [s.eventId, invertidas]);

      const despues = await s.db.query<{ id: string }>(
        "select id from workouts where event_id = $1 order by order_index",
        [s.eventId],
      );
      expect(despues.rows.map((r) => r.id)).toEqual(invertidas);
      expect(invertidas[0]).toBe(otra.workoutId);
    });
  });

  it("los bloques de una parte también", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const segundo = await s.db.query<{ id: string }>(
        `insert into part_blocks (part_id, event_id, order_index, kind, repeticiones)
         values ($1, $2, 1, 'cash_out', 1) returning id`,
        [p.partId, s.eventId],
      );

      await s.db.query("select reorder_part_blocks($1, $2)", [
        p.partId,
        [segundo.rows[0].id, p.blockId],
      ]);

      const res = await s.db.query<{ id: string }>(
        "select id from part_blocks where part_id = $1 order by order_index",
        [p.partId],
      );
      expect(res.rows.map((r) => r.id)).toEqual([segundo.rows[0].id, p.blockId]);
    });
  });

  it("quien no administra el evento no reordena nada", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select reorder_part_movements($1, $2)", [
          p.blockId,
          p.movimientos,
        ]),
      );
      expect(msg).toContain("No tienes permiso");
    });
  });
});

describe("los pesos y cantidades por categoría", () => {
  interface Spec {
    part_movement_id: string;
    load_kg: string | null;
    load_unit: string;
    target_per_round: number[] | null;
  }

  async function specs(): Promise<Spec[]> {
    const res = await asUser(s.db, s.users.owner, () =>
      s.db.query<Spec>(
        `select part_movement_id, load_kg, load_unit, target_per_round
         from division_movement_specs where event_id = $1
         order by part_movement_id`,
        [s.eventId],
      ),
    );
    return res.rows;
  }

  it("guarda el peso y las reps de una categoría en una sola llamada", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select guardar_specs_de_parte($1, $2::jsonb)", [
        p.partId,
        JSON.stringify([
          {
            divisionId: s.divisionId,
            partMovementId: p.movimientos[0],
            objetivo: [15, 12, 9],
            cargaKg: 30,
            cargaUnidad: "kg",
          },
        ]),
      ]),
    );

    const filas = await specs();
    expect(filas).toHaveLength(1);
    expect(Number(filas[0].load_kg)).toBe(30);
    expect(filas[0].target_per_round).toEqual([15, 12, 9]);
  });

  it("recuerda la unidad en la que se escribió", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select guardar_specs_de_parte($1, $2::jsonb)", [
        p.partId,
        JSON.stringify([
          {
            divisionId: s.divisionId,
            partMovementId: p.movimientos[0],
            objetivo: null,
            cargaKg: 43.09,
            cargaUnidad: "lb",
          },
        ]),
      ]),
    );

    expect((await specs())[0].load_unit).toBe("lb");
  });

  it("una celda vacía BORRA el ajuste y vuelve al valor base", async () => {
    // Vacío no es cero: guardar cero diría "cero kilos", que es otra cosa.
    const guardar = (cargaKg: number | null) =>
      asUser(s.db, s.users.owner, () =>
        s.db.query("select guardar_specs_de_parte($1, $2::jsonb)", [
          p.partId,
          JSON.stringify([
            {
              divisionId: s.divisionId,
              partMovementId: p.movimientos[0],
              objetivo: null,
              cargaKg,
              cargaUnidad: "kg",
            },
          ]),
        ]),
      );

    await guardar(30);
    expect(await specs()).toHaveLength(1);

    await guardar(null);
    expect(await specs()).toHaveLength(0);
  });

  it("REEMPLAZA la grilla entera, no hace merge", async () => {
    // La pantalla manda todas las celdas: lo que no viene es lo que el
    // organizador borró.
    const mandar = (movimientoId: string) =>
      asUser(s.db, s.users.owner, () =>
        s.db.query("select guardar_specs_de_parte($1, $2::jsonb)", [
          p.partId,
          JSON.stringify([
            {
              divisionId: s.divisionId,
              partMovementId: movimientoId,
              objetivo: null,
              cargaKg: 30,
              cargaUnidad: "kg",
            },
          ]),
        ]),
      );

    await mandar(p.movimientos[0]);
    await mandar(p.movimientos[1]);

    const filas = await specs();
    expect(filas).toHaveLength(1);
    expect(filas[0].part_movement_id).toBe(p.movimientos[1]);
  });

  it("ignora un movimiento que no es de esta parte", async () => {
    const otra = await crearPrueba("WOD 2");

    await asUser(s.db, s.users.owner, () =>
      s.db.query("select guardar_specs_de_parte($1, $2::jsonb)", [
        p.partId,
        JSON.stringify([
          {
            divisionId: s.divisionId,
            partMovementId: otra.movimientos[0],
            objetivo: null,
            cargaKg: 30,
            cargaUnidad: "kg",
          },
        ]),
      ]),
    );

    expect(await specs()).toHaveLength(0);
  });

  it("quien no administra el evento no los toca", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select guardar_specs_de_parte($1, '[]'::jsonb)", [p.partId]),
      );
      expect(msg).toContain("No tienes permiso");
    });
  });
});

describe("la parte B", () => {
  it("convive con la A en la misma prueba", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        `insert into workout_parts (workout_id, event_id, order_index, label, time_scheme, score_unit, score_dir)
         values ($1, $2, 1, 'B', 'sin_reloj', 'carga', 'mayor_gana')`,
        [p.workoutId, s.eventId],
      );
      await s.db.query("update workout_parts set label = 'A' where id = $1", [p.partId]);

      const res = await s.db.query<{ label: string; time_scheme: string }>(
        "select label, time_scheme from workout_parts where workout_id = $1 order by order_index",
        [p.workoutId],
      );
      // Cada parte tiene su propio esquema: un AMRAP y después una carga máxima.
      expect(res.rows.map((r) => r.label)).toEqual(["A", "B"]);
      expect(res.rows.map((r) => r.time_scheme)).toEqual(["cap", "sin_reloj"]);
    });
  });

  it("dos partes no pueden compartir el mismo orden", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query(
          `insert into workout_parts (workout_id, event_id, order_index, time_scheme, score_unit, score_dir)
           values ($1, $2, 0, 'libre', 'tiempo', 'menor_gana')`,
          [p.workoutId, s.eventId],
        ),
      );
      expect(msg).toContain("workout_parts_workout_id_order_index_key");
    });
  });
});

describe("el desempate de una parte", () => {
  it("se puede fijar en la propia prueba", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        `update workout_parts
           set tiebreak_source = 'hito', tiebreak_unit = 'tiempo', tiebreak_dir = 'menor_gana'
         where id = $1`,
        [p.partId],
      );
      const res = await s.db.query<{ tiebreak_source: string }>(
        "select tiebreak_source from workout_parts where id = $1",
        [p.partId],
      );
      expect(res.rows[0].tiebreak_source).toBe("hito");
    });
  });

  it("no puede declarar una unidad sin una direccion", async () => {
    // `parts_tiebreak_completo`: si hay tiebreak_source, unit y dir son las
    // dos obligatorias — no alcanza con una sola.
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query(
          `update workout_parts set tiebreak_source = 'manual', tiebreak_unit = 'tiempo' where id = $1`,
          [p.partId],
        ),
      );
      expect(msg).toContain("parts_tiebreak_completo");
    });
  });

  it("'otra_prueba' exige decir de cual", async () => {
    // `parts_tiebreak_otra_prueba`: sin tiebreak_part_id no hay de donde
    // sacar el valor.
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query(
          `update workout_parts
             set tiebreak_source = 'otra_prueba', tiebreak_unit = 'tiempo', tiebreak_dir = 'menor_gana'
           where id = $1`,
          [p.partId],
        ),
      );
      expect(msg).toContain("parts_tiebreak_otra_prueba");
    });
  });

  it("puede apuntar a una parte de OTRO workout del mismo evento", async () => {
    const otra = await crearPrueba("Clasificatoria");

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        `update workout_parts
           set tiebreak_source = 'otra_prueba', tiebreak_unit = 'tiempo', tiebreak_dir = 'menor_gana',
               tiebreak_part_id = $2
         where id = $1`,
        [p.partId, otra.partId],
      );
      const res = await s.db.query<{ tiebreak_part_id: string }>(
        "select tiebreak_part_id from workout_parts where id = $1",
        [p.partId],
      );
      expect(res.rows[0].tiebreak_part_id).toBe(otra.partId);
    });
  });

  it("quien no administra el evento no lo toca", async () => {
    // RLS aca devuelve CERO FILAS, sin error: `expectDenied` no aplica. La
    // fila sigue exactamente como estaba.
    await asUser(s.db, s.users.judgeA, () =>
      s.db.query(
        `update workout_parts set tiebreak_source = 'manual', tiebreak_unit = 'tiempo', tiebreak_dir = 'menor_gana' where id = $1`,
        [p.partId],
      ),
    );

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ tiebreak_source: string | null }>(
        "select tiebreak_source from workout_parts where id = $1",
        [p.partId],
      );
      expect(res.rows[0].tiebreak_source).toBeNull();
    });
  });
});
