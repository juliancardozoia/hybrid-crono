/**
 * El documento del scoreboard y su puerta publica.
 *
 * Lo que se verifica aca no es el ranking —eso vive en src/shared/scoring/ y
 * tiene sus propios tests— sino que la funcion proyecte los datos correctos y
 * que el gate del plan se aplique en Postgres, donde no se puede saltear.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAnon, asAdmin, asUser } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
});

interface Documento {
  version: number;
  detalle: boolean;
  event: { name: string; status: string; official: boolean };
  divisions: Array<{ id: string; name: string }>;
  snapshots: Array<{ divisionId: string; stage: number; points: number[]; locked: boolean }>;
  stageAdvancements: Array<{ divisionId: string; stage: number; teamId: string }>;
  parts: Array<{
    id: string;
    workoutName: string;
    stage: number;
    scoreUnit: string;
    scoreDir: string;
    maxPoints: string;
  }>;
  assignments: Array<{ partId: string; divisionId: string }>;
  teams: Array<{ id: string; bib: number; athletes: string }>;
  scores: Array<{ partId: string; teamId: string; status: string; value: string | null }>;
  splits: unknown[];
}

async function documento(): Promise<Documento> {
  let doc: Documento = null as unknown as Documento;
  await asUser(s.db, s.users.owner, async () => {
    const res = await s.db.query<{ scoreboard_document: Documento }>(
      "select scoreboard_document($1, true)",
      [s.eventId],
    );
    doc = res.rows[0].scoreboard_document;
  });
  return doc;
}

async function publico(): Promise<Documento | null> {
  let doc: Documento | null = null;
  await asAnon(s.db, async () => {
    const res = await s.db.query<{ public_scoreboard: Documento | null }>(
      "select public_scoreboard($1)",
      ["copa-test"],
    );
    doc = res.rows[0].public_scoreboard;
  });
  return doc;
}

async function setPlan(plan: "free" | "pro"): Promise<void> {
  await asAdmin(s.db, () =>
    s.db.query("update organizations set plan = $1 where id = $2", [plan, s.orgId]),
  );
}

async function setStatus(status: string): Promise<void> {
  await asAdmin(s.db, () =>
    s.db.query("update events set status = $1 where id = $2", [status, s.eventId]),
  );
}

describe("scoreboard_document", () => {
  it("proyecta el evento, sus categorias, pruebas y padron", async () => {
    const doc = await documento();

    expect(doc.version).toBe(5);
    expect(doc.event.name).toBe("Copa Test");
    expect(doc.divisions).toHaveLength(1);
    expect(doc.parts).toHaveLength(1);
    expect(doc.parts[0].workoutName).toBe("Circuito");
    expect(doc.parts[0].scoreUnit).toBe("tiempo");
    expect(doc.parts[0].scoreDir).toBe("menor_gana");
    expect(doc.teams).toHaveLength(3);
  });

  it("liga cada categoria con las pruebas que corre", async () => {
    const doc = await documento();
    expect(doc.assignments).toHaveLength(1);
    expect(doc.assignments[0].divisionId).toBe(s.divisionId);
  });

  it("trae el nombre del atleta armado, no ids", async () => {
    const doc = await documento();
    expect(doc.teams[0].athletes).toMatch(/Atleta\d Perez/);
  });

  it("una categoria sin snapshot no tiene fila en snapshots", async () => {
    // Sin fila no es un hueco: significa "todavia no se genero", y ahi el
    // cliente calcula la curva al vuelo con los atletas que hay. Es lo
    // correcto ANTES de competir, cuando el padron todavia se mueve.
    const doc = await documento();
    expect(doc.snapshots).toEqual([]);
  });

  it("con snapshot generado, viaja la curva congelada", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select guardar_snapshot_de_puntuacion($1, 3, $2::numeric[], 1, true)", [
        s.divisionId,
        "{100,50,0}",
      ]),
    );

    const doc = await documento();
    // Viaja como numeros dentro del jsonb, no como strings: es lo que el
    // cliente necesita para sumar sin convertir nada.
    const snap = doc.snapshots.find((sn) => sn.divisionId === s.divisionId && sn.stage === 1);
    expect(snap?.points).toEqual([100, 50, 0]);
    expect(snap?.locked).toBe(true);
  });

  it("cada prueba lleva su peso", async () => {
    const doc = await documento();
    expect(Number(doc.parts[0].maxPoints)).toBe(100);
  });

  it("los equipos retirados no entran al padron", async () => {
    // Con posiciones fisicas, un retirado al fondo le corre la posicion a todos
    // los que estan detras y les cambia los puntos.
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("update teams set status = 'withdrawn' where id = $1", [s.teamIds[0]]);
    });
    const doc = await documento();
    expect(doc.teams).toHaveLength(2);
    expect(doc.teams.map((t) => t.id)).not.toContain(s.teamIds[0]);
  });

  it("sin detalle no viajan los parciales", async () => {
    let doc: Documento = null as unknown as Documento;
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ scoreboard_document: Documento }>(
        "select scoreboard_document($1, false)",
        [s.eventId],
      );
      doc = res.rows[0].scoreboard_document;
    });
    expect(doc.detalle).toBe(false);
    expect(doc.splits).toEqual([]);
  });

  it("un evento sin nadie inscripto devuelve listas vacias, no null", async () => {
    // El consumidor arma la tabla con lo que venga; un null lo obligaria a
    // defenderse en cada campo.
    await asAdmin(s.db, () => s.db.query("delete from teams where event_id = $1", [s.eventId]));
    const doc = await documento();
    expect(doc.teams).toEqual([]);
    expect(doc.scores).toEqual([]);
  });

  it("borrar un equipo con carril asignado deja el carril vacio, no revienta", async () => {
    // Regresion de un bug real: la FK compuesta (team_id, event_id) con
    // ON DELETE SET NULL anulaba TAMBIEN event_id, que es NOT NULL, asi que
    // deleteTeam() fallaba siempre que el atleta ya estuviera en un heat.
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("delete from teams where id = $1", [s.teamIds[0]]);

      const carril = await s.db.query<{ team_id: string | null; event_id: string }>(
        "select team_id, event_id from lanes where id = $1",
        [s.laneIds[0]],
      );
      // El carril sigue existiendo y sigue siendo del evento: es del heat, no
      // del atleta.
      expect(carril.rows).toHaveLength(1);
      expect(carril.rows[0].team_id).toBeNull();
      expect(carril.rows[0].event_id).toBe(s.eventId);
    });
  });
});

describe("etapas y cortes", () => {
  /** Un segundo workout, en la etapa 2, asignado a la categoria del fixture. */
  async function crearPruebaDeEtapa2(): Promise<{ workoutId: string; partId: string }> {
    let workoutId = "";
    let partId = "";
    await asAdmin(s.db, async () => {
      workoutId = (
        await s.db.query<{ id: string }>(
          "insert into workouts (event_id, name, order_index, stage) values ($1, 'Final', 1, 2) returning id",
          [s.eventId],
        )
      ).rows[0].id;

      partId = (
        await s.db.query<{ id: string }>(
          `insert into workout_parts (workout_id, event_id, order_index, time_scheme, score_unit, score_dir)
           values ($1, $2, 0, 'libre', 'reps', 'mayor_gana') returning id`,
          [workoutId, s.eventId],
        )
      ).rows[0].id;

      await s.db.query(
        "insert into part_divisions (part_id, division_id, event_id) values ($1, $2, $3)",
        [partId, s.divisionId, s.eventId],
      );
    });
    return { workoutId, partId };
  }

  it("el workout lleva su etapa, y viaja en el documento", async () => {
    await crearPruebaDeEtapa2();
    const doc = await documento();
    const final = doc.parts.find((p) => p.workoutName === "Final");
    expect(final?.stage).toBe(2);
    // La prueba original del circuito sigue en la etapa 1, por default.
    expect(doc.parts.find((p) => p.workoutName === "Circuito")?.stage).toBe(1);
  });

  it("sin corte confirmado, nadie viaja en stageAdvancements para esa etapa", async () => {
    await crearPruebaDeEtapa2();
    const doc = await documento();
    expect(doc.stageAdvancements).toEqual([]);
  });

  it("confirmar_corte_de_etapa avanza a los equipos elegidos y congela su tabla", async () => {
    await crearPruebaDeEtapa2();
    const avanzan = [s.teamIds[0], s.teamIds[1]];

    await asUser(s.db, s.users.owner, () =>
      s.db.query("select confirmar_corte_de_etapa($1, 2, $2::uuid[], $3::numeric[])", [
        s.divisionId,
        avanzan,
        "{100,0}",
      ]),
    );

    const doc = await documento();
    expect(doc.stageAdvancements.filter((a) => a.stage === 2).map((a) => a.teamId).sort()).toEqual(
      [...avanzan].sort(),
    );

    const snap = doc.snapshots.find((sn) => sn.divisionId === s.divisionId && sn.stage === 2);
    expect(snap?.points).toEqual([100, 0]);
    expect(snap?.locked).toBe(true);
  });

  it("un corte confirmado no se puede rehacer", async () => {
    await crearPruebaDeEtapa2();
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select confirmar_corte_de_etapa($1, 2, $2::uuid[], $3::numeric[])", [
        s.divisionId,
        [s.teamIds[0]],
        "{100}",
      ]),
    );

    await asUser(s.db, s.users.owner, async () => {
      let fallo = false;
      try {
        await s.db.query("select confirmar_corte_de_etapa($1, 2, $2::uuid[], $3::numeric[])", [
          s.divisionId,
          [s.teamIds[1]],
          "{100}",
        ]);
      } catch {
        fallo = true;
      }
      expect(fallo).toBe(true);
    });
  });

  it("quien no gestiona el evento no puede confirmar un corte", async () => {
    await crearPruebaDeEtapa2();
    await asUser(s.db, s.users.forastero, async () => {
      let fallo = false;
      try {
        await s.db.query("select confirmar_corte_de_etapa($1, 2, $2::uuid[], $3::numeric[])", [
          s.divisionId,
          [s.teamIds[0]],
          "{100}",
        ]);
      } catch {
        fallo = true;
      }
      expect(fallo).toBe(true);
    });
  });
});

describe("el gate del plan, aplicado en Postgres", () => {
  it("plan pro: el anonimo ve el leaderboard en vivo con detalle", async () => {
    await setPlan("pro");
    await setStatus("live");
    const doc = await publico();
    expect(doc).not.toBeNull();
    expect(doc!.detalle).toBe(true);
  });

  it("plan gratuito: en vivo no muestra nada", async () => {
    // Lo que se restringe no es cronometrar, es exhibir.
    await setPlan("free");
    await setStatus("live");
    expect(await publico()).toBeNull();
  });

  it("plan gratuito: con el evento publicado muestra el resultado, sin parciales", async () => {
    await setPlan("free");
    await setStatus("published");
    const doc = await publico();
    expect(doc).not.toBeNull();
    expect(doc!.detalle).toBe(false);
    expect(doc!.splits).toEqual([]);
    expect(doc!.event.official).toBe(true);
  });

  it("un evento en borrador no expone nada, ni siquiera en plan pro", async () => {
    await setPlan("pro");
    await setStatus("draft");
    expect(await publico()).toBeNull();
  });

  it("un slug que no existe devuelve null en vez de reventar", async () => {
    await asAnon(s.db, async () => {
      const res = await s.db.query<{ public_scoreboard: unknown }>(
        "select public_scoreboard('no-existe')",
      );
      expect(res.rows[0].public_scoreboard).toBeNull();
    });
  });

  it("el anonimo no puede llamar a scoreboard_document directamente", async () => {
    // No es `public_*`: el rol anonimo no tiene EXECUTE en absoluto, sin
    // importar el plan ni el estado del evento.
    await setPlan("free");
    await asAnon(s.db, async () => {
      let fallo = false;
      try {
        await s.db.query("select scoreboard_document($1, true)", [s.eventId]);
      } catch {
        fallo = true;
      }
      expect(fallo).toBe(true);
    });
  });

  it("un autenticado SIN relacion con el evento no puede llamar a scoreboard_document directamente para saltear el gate", async () => {
    // El hueco real: `scoreboard_document` no es `public_*`, asi que
    // `apply_function_lockdown()` le da EXECUTE a CUALQUIER usuario
    // autenticado -- no solo a quien pasa por `public_scoreboard`. Sin un
    // guard propio, un atleta con cuenta (o alguien de OTRA organizacion)
    // podia pedir el documento COMPLETO de un evento en plan gratuito
    // todavia sin publicar, con solo su uuid.
    await setPlan("free");
    await setStatus("live"); // free + live: publico() ya devuelve null aca.
    await asUser(s.db, s.users.forastero, async () => {
      const res = await s.db.query<{ scoreboard_document: unknown }>(
        "select scoreboard_document($1, true)",
        [s.eventId],
      );
      expect(res.rows[0].scoreboard_document).toBeNull();
    });
  });

  it("un evento en borrador tampoco se filtra por scoreboard_document directo", async () => {
    await setStatus("draft");
    await asUser(s.db, s.users.forastero, async () => {
      const res = await s.db.query<{ scoreboard_document: unknown }>(
        "select scoreboard_document($1, true)",
        [s.eventId],
      );
      expect(res.rows[0].scoreboard_document).toBeNull();
    });
  });

  it("quien SI tiene un rol en el evento sigue viendo el documento crudo, aunque no este publicado", async () => {
    // El organizador (y cualquier staff del evento) no queda atado al mismo
    // gate que el publico: lo necesita para trabajar (torre de control,
    // verificacion) antes de publicar nada. `puede_leer_evento` es el mismo
    // helper que ya usan ~25 politicas de lectura de estructura.
    await setPlan("free");
    await setStatus("live");
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ scoreboard_document: { teams: unknown[] } }>(
        "select scoreboard_document($1, true)",
        [s.eventId],
      );
      expect(res.rows[0].scoreboard_document).not.toBeNull();
      expect(res.rows[0].scoreboard_document.teams).toHaveLength(3);
    });
  });

  it("un evento publicado es publico de verdad: hasta un autenticado sin relacion lo ve", async () => {
    // Publicado es exactamente lo que la palabra dice: no es un hueco que
    // esto siga visible para cualquiera con cuenta, es la regla de negocio.
    await setPlan("free");
    await setStatus("published");
    await asUser(s.db, s.users.forastero, async () => {
      const res = await s.db.query<{ scoreboard_document: unknown }>(
        "select scoreboard_document($1, true)",
        [s.eventId],
      );
      expect(res.rows[0].scoreboard_document).not.toBeNull();
    });
  });

  it("el documento publico no filtra emails ni ids de organizacion", async () => {
    await setPlan("pro");
    await setStatus("live");
    const doc = await publico();
    const texto = JSON.stringify(doc);
    expect(texto).not.toContain("@box.com");
    expect(texto).not.toContain(s.orgId);
  });
});
