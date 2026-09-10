/**
 * El snapshot de puntuacion: por que existe y que garantiza.
 *
 * La curva se calcula en TypeScript (`src/shared/scoring/points.ts`, con sus
 * propios tests). Lo que se prueba ACA es lo que solo puede fallar en la base:
 * quien puede escribirla, que un bloqueo no se pueda deshacer por accidente, y
 * que retirar atletas no la mueva.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAnon, asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
});

/** Una curva cualquiera: lo que importa aca es el guardado, no los valores. */
const CURVA_DE_4 = "{100,66.667,33.333,0}";

async function generar(
  userId: string,
  opciones: { fieldSize?: number; puntos?: string; bloquear?: boolean } = {},
) {
  const { fieldSize = 4, puntos = CURVA_DE_4, bloquear = false } = opciones;
  return asUser(s.db, userId, () =>
    s.db.query("select id from guardar_snapshot_de_puntuacion($1, $2, $3::numeric[], 1, $4)", [
      s.divisionId,
      fieldSize,
      puntos,
      bloquear,
    ]),
  );
}

async function leerSnapshot() {
  return asAdmin(s.db, () =>
    s.db.query<{ field_size: number; points: string[]; locked_at: string | null }>(
      "select field_size, points, locked_at from scoring_snapshots where division_id = $1 and stage = 1",
      [s.divisionId],
    ),
  );
}

describe("quien puede congelar la tabla", () => {
  it("la organizacion si", async () => {
    await generar(s.users.owner);
    const { rows } = await leerSnapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0].field_size).toBe(4);
  });

  it("un juez no", async () => {
    const msg = await expectDenied(() => generar(s.users.judgeA));
    expect(msg).toContain("permiso");
  });

  it("alguien de otra organizacion tampoco", async () => {
    const msg = await expectDenied(() => generar(s.users.forastero));
    expect(msg).toContain("permiso");
  });

  it("el anonimo no puede ni leer la tabla", async () => {
    await generar(s.users.owner);
    await expectDenied(() =>
      asAnon(s.db, () => s.db.query("select * from scoring_snapshots")),
    );
  });

  it("nadie escribe la tabla directo: no hay GRANT de insert", async () => {
    // Misma jugada que `timing_events` y `workout_scores`: la unica via es la
    // funcion, que valida permiso y respeta el bloqueo.
    await expectDenied(() =>
      asUser(s.db, s.users.owner, () =>
        s.db.query(
          `insert into scoring_snapshots (event_id, division_id, field_size, points)
           values ($1, $2, 2, '{100,0}')`,
          [s.eventId, s.divisionId],
        ),
      ),
    );
  });
});

describe("el bloqueo", () => {
  it("mientras no este bloqueada se puede regenerar", async () => {
    await generar(s.users.owner, { fieldSize: 4 });
    await generar(s.users.owner, { fieldSize: 2, puntos: "{100,0}" });

    const { rows } = await leerSnapshot();
    expect(rows[0].field_size).toBe(2);
    expect(rows[0].locked_at).toBeNull();
  });

  it("una vez bloqueada NO se puede regenerar", async () => {
    // Es la garantia entera: regenerarla cambiaria retroactivamente los puntos
    // de las pruebas ya corridas.
    await generar(s.users.owner, { fieldSize: 4, bloquear: true });

    const msg = await expectDenied(() =>
      generar(s.users.owner, { fieldSize: 2, puntos: "{100,0}" }),
    );
    expect(msg).toContain("bloqueada");

    const { rows } = await leerSnapshot();
    expect(rows[0].field_size).toBe(4);
  });

  it("bloquear dos veces no rompe ni mueve la fecha", async () => {
    await generar(s.users.owner);
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select bloquear_snapshot_de_puntuacion($1, 1)", [s.divisionId]),
    );
    const primera = (await leerSnapshot()).rows[0].locked_at;

    await asUser(s.db, s.users.owner, () =>
      s.db.query("select bloquear_snapshot_de_puntuacion($1, 1)", [s.divisionId]),
    );
    expect((await leerSnapshot()).rows[0].locked_at).toStrictEqual(primera);
  });

  it("no se puede bloquear una tabla que no se genero", async () => {
    const msg = await expectDenied(() =>
      asUser(s.db, s.users.owner, () =>
        s.db.query("select bloquear_snapshot_de_puntuacion($1, 1)", [s.divisionId]),
      ),
    );
    expect(msg).toContain("todavía no tiene tabla");
  });
});

describe("retirar atletas no mueve la tabla", () => {
  it("el field congelado sobrevive a las bajas", async () => {
    // El caso de §9: se congela con 4 y despues se retiran dos. La tabla
    // sigue siendo la de 4 — si se recalculara, los que quedan verian cambiar
    // los puntos que ya sacaron.
    await generar(s.users.owner, { fieldSize: 4, bloquear: true });

    await asUser(s.db, s.users.owner, () =>
      s.db.query("update teams set status = 'withdrawn' where id = any($1)", [
        [s.teamIds[0], s.teamIds[1]],
      ]),
    );

    const { rows } = await leerSnapshot();
    expect(rows[0].field_size).toBe(4);
    expect(rows[0].points).toHaveLength(4);
  });
});

describe("etapas", () => {
  it("cada etapa tiene su propia tabla, independiente", async () => {
    // El modelo de los cuts: Stage 1 con 4, Stage 2 con 2. Hoy la app usa
    // siempre la etapa 1, pero la tabla ya soporta las dos sin migrar nada.
    await generar(s.users.owner, { fieldSize: 4, bloquear: true });

    await asUser(s.db, s.users.owner, () =>
      s.db.query("select guardar_snapshot_de_puntuacion($1, 2, $2::numeric[], 2, true)", [
        s.divisionId,
        "{100,0}",
      ]),
    );

    const { rows } = await asAdmin(s.db, () =>
      s.db.query<{ stage: number; field_size: number }>(
        "select stage, field_size from scoring_snapshots where division_id = $1 order by stage",
        [s.divisionId],
      ),
    );

    expect(rows).toEqual([
      { stage: 1, field_size: 4 },
      { stage: 2, field_size: 2 },
    ]);
  });
});

describe("tie_point_policy: default oficial, y se congela con el snapshot", () => {
  it("un evento nuevo nace en same_position_points, el reglamento oficial", async () => {
    const { rows } = await asAdmin(s.db, () =>
      s.db.query<{ tie_point_policy: string }>("select tie_point_policy from events where id = $1", [
        s.eventId,
      ]),
    );
    expect(rows[0].tie_point_policy).toBe("same_position_points");
  });

  it("guardar_snapshot_de_puntuacion copia la politica del evento", async () => {
    await asAdmin(s.db, () =>
      s.db.query("update events set tie_point_policy = 'average_occupied_positions' where id = $1", [
        s.eventId,
      ]),
    );
    await generar(s.users.owner, { fieldSize: 4 });

    const { rows } = await asAdmin(s.db, () =>
      s.db.query<{ tie_point_policy: string }>(
        "select tie_point_policy from scoring_snapshots where division_id = $1 and stage = 1",
        [s.divisionId],
      ),
    );
    expect(rows[0].tie_point_policy).toBe("average_occupied_positions");
  });

  it("cambiar la politica del evento NO altera un snapshot ya bloqueado", async () => {
    await generar(s.users.owner, { fieldSize: 4, bloquear: true });

    await asAdmin(s.db, () =>
      s.db.query("update events set tie_point_policy = 'average_occupied_positions' where id = $1", [
        s.eventId,
      ]),
    );

    const { rows } = await asAdmin(s.db, () =>
      s.db.query<{ tie_point_policy: string }>(
        "select tie_point_policy from scoring_snapshots where division_id = $1 and stage = 1",
        [s.divisionId],
      ),
    );
    // El snapshot sigue con la que tenia al congelarse (el default oficial),
    // aunque el evento haya cambiado de idea despues.
    expect(rows[0].tie_point_policy).toBe("same_position_points");
  });

  it("mientras NO esta bloqueado, regenerar vuelve a copiar la politica vigente del evento", async () => {
    await generar(s.users.owner, { fieldSize: 4 });
    await asAdmin(s.db, () =>
      s.db.query("update events set tie_point_policy = 'average_occupied_positions' where id = $1", [
        s.eventId,
      ]),
    );
    await generar(s.users.owner, { fieldSize: 4 });

    const { rows } = await asAdmin(s.db, () =>
      s.db.query<{ tie_point_policy: string }>(
        "select tie_point_policy from scoring_snapshots where division_id = $1 and stage = 1",
        [s.divisionId],
      ),
    );
    expect(rows[0].tie_point_policy).toBe("average_occupied_positions");
  });
});

describe("el peso de cada prueba", () => {
  it("por defecto vale 100", async () => {
    const { rows } = await asAdmin(s.db, () =>
      s.db.query<{ max_points: string }>(
        "select max_points from workout_parts where event_id = $1 limit 1",
        [s.eventId],
      ),
    );
    expect(Number(rows[0].max_points)).toBe(100);
  });

  it("no puede ser cero ni negativo: una prueba que no reparte nada no es una prueba", async () => {
    await expectDenied(() =>
      asAdmin(s.db, () =>
        s.db.query("update workout_parts set max_points = 0 where event_id = $1", [s.eventId]),
      ),
    );
  });
});
