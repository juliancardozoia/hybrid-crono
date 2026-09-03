import { requireEventAccess } from "@/features/events/lib/access";
import { createClient } from "@/lib/supabase/server";
import {
  crearArena,
  borrarArena,
  type FormState,
} from "@/features/cronograma/actions";
import { ProgramarHeat } from "@/features/cronograma/components/ProgramarHeat";
import { SimpleForm, Field, FieldRow } from "@/shared/components/SimpleForm";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import { horaEnEvento, paraInputLocal } from "@/shared/utils/fecha";
import type { ConfigIssue } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function CronogramaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { event, canManage } = await requireEventAccess(id);

  const supabase = await createClient();
  const [{ data: arenas }, { data: heats }, { data: issues }] =
    await Promise.all([
      supabase
        .from("arenas")
        .select("*")
        .eq("event_id", id)
        .order("order_index"),
      supabase
        .from("heats")
        .select("id, name, arena_id, scheduled_at, scheduled_end_at")
        .eq("event_id", id)
        .order("scheduled_at", { nullsFirst: false }),
      supabase.rpc("event_schedule_issues", { p_event_id: id }),
    ]);

  const problemas = (issues ?? []) as unknown as ConfigIssue[];
  const errores = problemas.filter((p) => p.severity === "error");
  const avisos = problemas.filter((p) => p.severity === "warning");

  const columnas = arenas ?? [];
  const sinArena = (heats ?? []).filter((h) => h.arena_id === null);

  async function quitarArena(
    arenaId: string,
    _prev: FormState,
    _formData: FormData,
  ) {
    "use server";
    return borrarArena(id, arenaId);
  }

  return (
    <div className="mt-6 flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold">Cronograma</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Un CrossFit corre varias pruebas en simultáneo en escenarios
          distintos. Una carrera híbrida usa uno solo y alcanza con las horas.
        </p>
      </div>

      {errores.length > 0 && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
          <p className="text-sm font-semibold text-red-300">
            {errores.length === 1
              ? "Hay un conflicto"
              : `Hay ${errores.length} conflictos`}
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-red-200">
            {errores.map((p, i) => (
              <li key={i}>· {p.detail}</li>
            ))}
          </ul>
        </div>
      )}

      {avisos.length > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-200">
            Falta programar
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-amber-100/80">
            {avisos.slice(0, 8).map((p, i) => (
              <li key={i}>· {p.detail}</li>
            ))}
            {avisos.length > 8 && (
              <li className="text-amber-100/60">y {avisos.length - 8} más</li>
            )}
          </ul>
        </div>
      )}

      {/* Una columna por arena: es como se mira un cronograma de verdad, con
          lo simultáneo al lado y no mezclado en una lista. */}
      {columnas.length > 0 && (
        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-neutral-400 uppercase">
            Por escenario
          </h3>
          <div className="overflow-x-auto">
            <div
              className="grid min-w-min gap-4"
              style={{
                gridTemplateColumns: `repeat(${columnas.length}, minmax(14rem, 1fr))`,
              }}
            >
              {columnas.map((arena) => {
                const suyos = (heats ?? []).filter(
                  (h) => h.arena_id === arena.id,
                );
                return (
                  <div key={arena.id} className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="font-semibold">{arena.name}</h4>
                      {canManage && (
                        <FormularioDeEstado
                          accion={quitarArena.bind(null, arena.id)}
                          estadoInicial={{ error: null }}
                          etiqueta="✕"
                          pendienteTexto="…"
                          mensajeDeCarga="Quitando la arena…"
                          title="Quitar arena"
                          className="px-1 text-sm text-neutral-600 hover:text-red-400"
                        />
                      )}
                    </div>
                    <p className="text-xs text-neutral-600">
                      {arena.default_heat_minutes} min por heat
                    </p>

                    {suyos.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-neutral-800 p-3 text-center text-xs text-neutral-600">
                        Sin heats
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {suyos.map((h) => (
                          <li
                            key={h.id}
                            className="rounded-xl border border-neutral-800 px-3 py-2 text-sm"
                          >
                            <span className="block font-mono tabular-nums text-neutral-400">
                              {h.scheduled_at
                                ? horaEnEvento(
                                    h.scheduled_at,
                                    event.timezone,
                                  ).slice(0, 5)
                                : "—"}
                              {h.scheduled_end_at &&
                                ` – ${horaEnEvento(h.scheduled_end_at, event.timezone).slice(0, 5)}`}
                            </span>
                            <span className="block">{h.name}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-xs text-neutral-600">
            Horas en el huso de la competencia ({event.timezone}).
          </p>
        </section>
      )}

      {canManage && (
        <>
          <section className="rounded-2xl border border-neutral-800 p-5">
            <h3 className="mb-4 font-semibold">Nueva arena</h3>
            <SimpleForm
              action={crearArena}
              submitLabel="Crear arena"
              hidden={{ eventId: id }}
            >
              <FieldRow>
                <Field
                  label="Nombre"
                  name="name"
                  required
                  placeholder="Pista principal"
                />
                <Field
                  label="Duración de un heat (min)"
                  name="duracion"
                  type="number"
                  placeholder="15"
                />
              </FieldRow>
            </SimpleForm>
            <p className="mt-3 text-xs text-neutral-500">
              La duración se usa para detectar solapes cuando no cargas la hora
              de fin. Un heat de Hyrox son unos 90 minutos; uno de un WOD, 15.
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-neutral-400 uppercase">
              Programar heats
            </h3>
            {(heats ?? []).length === 0 ? (
              <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
                Todavía no hay heats. Se crean en la pestaña Heats.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(heats ?? []).map((h) => (
                  <li key={h.id}>
                    <ProgramarHeat
                      eventId={id}
                      heatId={h.id}
                      nombre={h.name}
                      arenas={columnas.map((a) => ({ id: a.id, name: a.name }))}
                      arenaId={h.arena_id}
                      inicio={paraInputLocal(h.scheduled_at, event.timezone)}
                      fin={paraInputLocal(h.scheduled_end_at, event.timezone)}
                    />
                  </li>
                ))}
              </ul>
            )}
            {sinArena.length > 0 && columnas.length > 1 && (
              <p className="text-sm text-amber-400/80">
                {sinArena.length} heat{sinArena.length === 1 ? "" : "s"} sin
                arena asignada.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
