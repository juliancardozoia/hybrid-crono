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
  divisions: Array<{ id: string; name: string; scoringTable: string }>;
  parts: Array<{ id: string; workoutName: string; scoreUnit: string; scoreDir: string }>;
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

    expect(doc.version).toBe(2);
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

  it("una categoria sin tabla propia cae en tiempo total", async () => {
    const doc = await documento();
    expect(doc.divisions[0].scoringTable).toBe("tiempo_total");
  });

  it("respeta la tabla de puntos que eligio la categoria", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        `update divisions set scoring_table_id = (
           select id from scoring_tables where builtin_key = 'cf_games_40'
         ) where id = $1`,
        [s.divisionId],
      );
    });
    const doc = await documento();
    expect(doc.divisions[0].scoringTable).toBe("cf_games_40");
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
    // Solo la funcion public_* esta abierta: la interna aplicaria el gate del
    // plan por su cuenta, o sea que no lo aplicaria.
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

  it("el documento publico no filtra emails ni ids de organizacion", async () => {
    await setPlan("pro");
    await setStatus("live");
    const doc = await publico();
    const texto = JSON.stringify(doc);
    expect(texto).not.toContain("@box.com");
    expect(texto).not.toContain(s.orgId);
  });
});
