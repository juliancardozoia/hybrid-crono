import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const filtro = process.argv[2];

const { data: perfiles } = await db.from("profiles").select("id, email");
const { data: eventos } = await db.from("events").select("*");

for (const e of eventos ?? []) {
  if (filtro && !e.name.toLowerCase().includes(filtro.toLowerCase())) continue;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`EVENTO "${e.name}"   status=${e.status}`);
  console.log(`${"=".repeat(60)}`);

  const [{ data: plantillas }, { data: divisiones }, { data: equipos }, { data: heats }] =
    await Promise.all([
      db.from("course_templates").select("id, name").eq("event_id", e.id),
      db.from("divisions").select("id, name, team_size, course_template_id").eq("event_id", e.id),
      db.from("teams").select("id, bib_number, division_id").eq("event_id", e.id),
      db.from("heats").select("*").eq("event_id", e.id),
    ]);

  for (const p of plantillas ?? []) {
    const { count } = await db
      .from("segments")
      .select("id", { count: "exact", head: true })
      .eq("course_template_id", p.id);
    console.log(`  circuito "${p.name}": ${count} segmentos`);
  }
  if ((plantillas ?? []).length === 0) console.log("  circuitos: NINGUNO");

  console.log(`  divisiones: ${(divisiones ?? []).length}`);
  for (const d of divisiones ?? []) console.log(`     - ${d.name} (equipos de ${d.team_size})`);

  console.log(`  equipos/dorsales: ${(equipos ?? []).length}`);
  for (const t of equipos ?? []) {
    const { count } = await db
      .from("team_members")
      .select("athlete_id", { count: "exact", head: true })
      .eq("team_id", t.id);
    const div = divisiones?.find((d) => d.id === t.division_id);
    console.log(`     - #${t.bib_number}  ${count} integrante(s)  division=${div?.name ?? "?"}`);
  }

  console.log(`  heats: ${(heats ?? []).length}`);
  for (const h of heats ?? []) {
    const { data: carriles } = await db.from("lanes").select("*").eq("heat_id", h.id);
    console.log(
      `     - "${h.name}"  status=${h.status}  lane_count=${h.lane_count}  largado=${h.started_at ?? "no"}`,
    );
    console.log(`       carriles creados: ${(carriles ?? []).length}`);
    for (const l of carriles ?? []) {
      const t = equipos?.find((x) => x.id === l.team_id);
      const j = perfiles?.find((p) => p.id === l.judge_id);
      console.log(
        `         carril ${l.lane_number}: equipo=${t ? "#" + t.bib_number : "VACIO"}  juez=${j?.email ?? (l.judge_id ? "otro" : "libre")}`,
      );
    }
    if ((carriles ?? []).length === 0) {
      console.log("         >>> EL HEAT NO TIENE NINGUN CARRIL CREADO <<<");
    }
  }
  if ((heats ?? []).length === 0) console.log("     >>> NO HAY HEATS <<<");

  // Lo mismo que evalua la pantalla del juez.
  const { data: visibles } = await db
    .from("lanes")
    .select("id, team_id, judge_id")
    .eq("event_id", e.id);
  const conAtleta = (visibles ?? []).filter((l) => l.team_id !== null);
  console.log(`\n  --> La pantalla del juez veria: ${conAtleta.length} carril(es) con atleta`);
  if (!["ready", "live"].includes(e.status)) {
    console.log(`      (pero el evento esta en '${e.status}', asi que no muestra nada)`);
  }
}
