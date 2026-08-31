"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  confirmImport,
  previewImport,
  type FormState,
  type PreviewState,
} from "../actions";

const inicialPreview: PreviewState = { error: null, plan: null, csv: null };
const inicialConfirm: FormState = { error: null };

function Submit({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "primary" }) {
  const { pending } = useFormStatus();
  const clase =
    tone === "primary"
      ? "bg-lime-400 text-lime-950 hover:bg-lime-300"
      : "border border-neutral-700 hover:bg-neutral-900";

  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-xl px-5 py-3 text-sm font-bold disabled:opacity-60 ${clase}`}
    >
      {pending ? "Procesando…" : label}
    </button>
  );
}

/**
 * Import en dos pasos: primero vista previa, despues confirmacion.
 *
 * El paso intermedio no es ceremonia. Importar mal 300 atletas la noche antes
 * de la competencia y tener que limpiarlo a mano es exactamente el problema que
 * esta app viene a eliminar.
 */
export function ImportWizard({ eventId, divisiones }: { eventId: string; divisiones: string[] }) {
  const [preview, previewAction] = useActionState(previewImport, inicialPreview);
  const [confirm, confirmAction] = useActionState(confirmImport, inicialConfirm);

  const plan = preview.plan;
  const importado = confirm.error === null && plan === null;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-neutral-800 p-5">
        <h2 className="font-semibold">1 · Sube la planilla</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Columnas reconocidas: <strong>nombre</strong>, <strong>apellido</strong>,{" "}
          <strong>sexo</strong>, <strong>division</strong>, y opcionales{" "}
          <code className="text-neutral-400">fecha_nacimiento</code>,{" "}
          <code className="text-neutral-400">email</code>,{" "}
          <code className="text-neutral-400">dorsal</code>,{" "}
          <code className="text-neutral-400">equipo</code>. Los nombres de división tienen que
          coincidir con las que ya creaste: {divisiones.join(", ")}.
        </p>

        <form action={previewAction} className="mt-4 flex flex-col gap-4">
          <input type="hidden" name="eventId" value={eventId} />

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Archivo CSV</span>
            <input
              type="file"
              name="archivo"
              accept=".csv,text/csv"
              className="rounded-xl border border-neutral-700 px-4 py-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-neutral-200"
            />
          </label>

          <details>
            <summary className="cursor-pointer text-sm text-neutral-500">
              O pega el contenido a mano
            </summary>
            <textarea
              name="csv"
              rows={6}
              placeholder="nombre,apellido,sexo,division&#10;Ana,Gomez,F,Individual Femenino"
              className="mt-2 w-full rounded-xl border border-neutral-700 bg-transparent px-4 py-3 font-mono text-sm outline-none focus:border-lime-400"
            />
          </details>

          {preview.error && (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {preview.error}
            </p>
          )}

          <div>
            <Submit label="Ver qué se va a importar" />
          </div>
        </form>
      </section>

      {plan && (
        <section className="rounded-2xl border border-neutral-800 p-5">
          <h2 className="font-semibold">2 · Revisa</h2>

          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span className="text-lime-400">
              {plan.teams.length} equipo(s) · {plan.totalAthletes} atleta(s) listos
            </span>
            {plan.issues.length > 0 && (
              <span className="text-amber-400">{plan.issues.length} fila(s) con problemas</span>
            )}
          </div>

          {plan.issues.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1.5">
              {plan.issues.map((issue, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-200"
                >
                  {issue.line !== null && (
                    <span className="mr-2 font-mono text-xs text-amber-500">
                      línea {issue.line}
                    </span>
                  )}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}

          {plan.teams.length > 0 && (
            <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-neutral-800">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-neutral-900 text-xs tracking-widest text-neutral-500 uppercase">
                  <tr>
                    <th className="px-3 py-2">Dorsal</th>
                    <th className="px-3 py-2">Atleta(s)</th>
                    <th className="px-3 py-2">División</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {plan.teams.map((t) => (
                    <tr key={t.bibNumber}>
                      <td className="px-3 py-2 font-mono tabular-nums">{t.bibNumber}</td>
                      <td className="px-3 py-2">
                        {t.members.map((m) => `${m.firstName} ${m.lastName}`).join(" / ")}
                      </td>
                      <td className="px-3 py-2 text-neutral-500">{t.divisionName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {plan.teams.length > 0 && (
            <form action={confirmAction} className="mt-5 flex flex-col gap-3">
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="csv" value={preview.csv ?? ""} />

              <p className="text-sm text-neutral-500">
                Las filas con problemas se saltean. Se importa todo o nada: si algo falla al
                escribir, no queda nada a medias.
              </p>

              {confirm.error && (
                <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                  {confirm.error}
                </p>
              )}

              <div>
                <Submit label={`Importar ${plan.teams.length} equipo(s)`} tone="primary" />
              </div>
            </form>
          )}
        </section>
      )}

      {importado && (
        <p className="rounded-xl border border-lime-500/40 bg-lime-500/10 p-4 text-sm text-lime-300">
          Importación lista. Vuelve a Atletas para verlos.
        </p>
      )}
    </div>
  );
}
