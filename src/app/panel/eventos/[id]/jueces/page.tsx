import Link from "next/link";
import { requireEventAccess } from "@/features/events/lib/access";
import { createClient } from "@/lib/supabase/server";
import {
  aprobarJuez,
  quitarColaborador,
  rechazarJuez,
  actualizarAutoasignacion,
  type FormState,
} from "@/features/cronograma/actions";
import { AgregarJuez } from "@/features/cronograma/components/AgregarJuez";
import { ToggleAutoasignacion } from "@/features/cronograma/components/ToggleAutoasignacion";
import { ReusarContactos } from "@/features/cronograma/components/ReusarContactos";
import {
  getContactosDeLaOrganizacion,
  getDivisions,
} from "@/features/events/config/queries";
import { Icono } from "@/shared/components/Icono";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";

export const dynamic = "force-dynamic";

/**
 * Los jueces de la competencia.
 *
 * UN JUEZ NO ES UN COLABORADOR CHICO: es otra cosa.
 *
 *   colaborador  ayuda con logistica, plataforma y datos. Trabaja las semanas
 *                previas, desde una computadora, y sus permisos son sobre
 *                REGISTROS, SCORES y WORKOUTS.
 *   juez         existe el DIA del evento. Toma un carril y califica: el
 *                cronometro para una carrera hibrida, la pantalla de WOD para un
 *                CrossFit. No administra nada.
 *
 * Por dentro los dos son `event_staff` —misma tabla, mismas politicas— y la
 * diferencia es que un juez tiene CERO banderas de permiso. Separarlos en dos
 * pantallas no es cosmetico: mezclar los cuatro administradores con los veinte
 * jueces de un evento grande hace imposible encontrar a alguien, y el formulario
 * de alta termina preguntando cosas que no aplican a la mitad.
 *
 * SE MUESTRA EL CARRIL QUE TOMO CADA UNO. Es LA pregunta del dia del evento
 * —"¿quien esta cubriendo el heat 3?"— y no habia forma de contestarla sin ir
 * carril por carril.
 */
export default async function JuecesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { canManage, event } = await requireEventAccess(id);

  const supabase = await createClient();
  const [{ data: staff }, divisiones] = await Promise.all([
    supabase
      .from("event_staff")
      .select(
        "id, invited_email, role, user_id, approved_at, is_admin, can_edit_registrations, can_delete_registrations, can_edit_scores, can_manage_workouts",
      )
      .eq("event_id", id)
      .order("created_at"),
    getDivisions(id),
  ]);

  const contactos = await getContactosDeLaOrganizacion(id);

  // Un juez es el que NO tiene ninguna bandera. Quien tiene alguna es
  // colaborador y vive en la otra pantalla.
  const todosLosJueces = (staff ?? []).filter(
    (s) =>
      !s.is_admin &&
      !s.can_edit_registrations &&
      !s.can_delete_registrations &&
      !s.can_edit_scores &&
      !s.can_manage_workouts,
  );

  // Una postulacion publica (se postulo solo, via /eventos/[slug]) queda sin
  // aprobar hasta que la organizacion la revisa. Una invitacion del
  // organizador se aprueba sola al invitar: nunca aparece aca.
  const postulaciones = todosLosJueces.filter(
    (j) => j.user_id && !j.approved_at,
  );
  const jueces = todosLosJueces.filter((j) => !(j.user_id && !j.approved_at));

  const ids = [...jueces, ...postulaciones]
    .map((s) => s.user_id)
    .filter((u): u is string => Boolean(u));

  const [{ data: perfiles }, { data: carriles }, { data: alcances }] =
    await Promise.all([
      ids.length
        ? supabase.from("profiles").select("id, full_name, email").in("id", ids)
        : Promise.resolve({
            data: [] as Array<{
              id: string;
              full_name: string | null;
              email: string | null;
            }>,
          }),
      // El carril que tomó cada uno: es lo que se pregunta el día del evento.
      supabase
        .from("lanes")
        .select("judge_id, lane_number")
        .eq("event_id", id)
        .not("judge_id", "is", null),
      supabase
        .from("event_staff_divisions")
        .select("staff_id, division_id")
        .eq("event_id", id),
    ]);

  const nombre = new Map(
    (perfiles ?? []).map((p) => [p.id, p.full_name || p.email]),
  );
  const nombreDivision = new Map(divisiones.map((d) => [d.id, d.name]));

  const carrilesPorJuez = new Map<string, number[]>();
  for (const c of carriles ?? []) {
    if (!c.judge_id) continue;
    carrilesPorJuez.set(c.judge_id, [
      ...(carrilesPorJuez.get(c.judge_id) ?? []),
      c.lane_number,
    ]);
  }

  const divisionesPorStaff = new Map<string, string[]>();
  for (const a of alcances ?? []) {
    divisionesPorStaff.set(a.staff_id, [
      ...(divisionesPorStaff.get(a.staff_id) ?? []),
      a.division_id,
    ]);
  }

  async function quitar(
    staffId: string,
    _prev: FormState,
    _formData: FormData,
  ) {
    "use server";
    return quitarColaborador(id, staffId);
  }

  async function aprobar(
    staffId: string,
    _prev: FormState,
    _formData: FormData,
  ) {
    "use server";
    return aprobarJuez(id, staffId);
  }

  async function rechazar(
    staffId: string,
    _prev: FormState,
    _formData: FormData,
  ) {
    "use server";
    return rechazarJuez(id, staffId);
  }

  async function cambiarAutoasignacion(permitir: boolean) {
    "use server";
    return actualizarAutoasignacion(id, permitir);
  }

  if (!canManage) {
    return (
      <p className="rounded-2xl border border-neutral-800 p-6 text-sm text-neutral-400">
        Solo quien administra la competencia gestiona los jueces.
      </p>
    );
  }

  const esCrossfit = event.format !== "carrera_hibrida";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold">Jueces</h2>
        <p className="mt-1 max-w-2xl text-sm text-neutral-400">
          Quienes califican el día de la competencia.{" "}
          {esCrossfit
            ? "Cuentan repeticiones y cierran movimientos desde el celular."
            : "Marcan los parciales del circuito desde el celular, incluso sin señal."}{" "}
          No administran nada más: para eso están los{" "}
          <Link
            href={`/panel/eventos/${id}/colaboradores`}
            className="text-lime-400 hover:underline"
          >
            colaboradores
          </Link>
          .
        </p>
      </div>

      {postulaciones.length > 0 && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
          <h3 className="flex items-center gap-2 font-semibold text-amber-300">
            <Icono nombre="reloj" className="h-4 w-4" />
            Postulaciones pendientes
          </h3>
          <p className="mt-1 text-sm text-neutral-400">
            Se ofrecieron como jueces desde la ficha pública de la competencia.
            Hasta que apruebes a alguien, no puede tomar ningún carril.
          </p>

          <ul className="mt-4 divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800">
            {postulaciones.map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {p.user_id
                      ? (nombre.get(p.user_id) ?? p.invited_email)
                      : p.invited_email}
                  </p>
                  <p className="truncate text-sm text-neutral-500">
                    {p.invited_email}
                  </p>
                </div>
                <FormularioDeEstado
                  accion={aprobar.bind(null, p.id)}
                  estadoInicial={{ error: null }}
                  etiqueta="Aprobar"
                  mensajeDeCarga="Aprobando la postulación…"
                  className="rounded-lg bg-lime-400 px-3 py-1.5 text-sm font-semibold text-lime-950 hover:bg-lime-300"
                />
                <FormularioDeEstado
                  accion={rechazar.bind(null, p.id)}
                  estadoInicial={{ error: null }}
                  etiqueta="Rechazar"
                  mensajeDeCarga="Rechazando la postulación…"
                  className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-900"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <ToggleAutoasignacion
        permitido={event.allow_judge_self_claim}
        cambiar={cambiarAutoasignacion}
      />

      {jueces.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
          Todavía no hay jueces. Sin al menos uno por carril, el heat no larga.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-800 overflow-hidden rounded-2xl border border-neutral-800">
          {jueces.map((j) => {
            const suyos = j.user_id
              ? (carrilesPorJuez.get(j.user_id) ?? [])
              : [];
            const suyas = divisionesPorStaff.get(j.id) ?? [];

            return (
              <li key={j.id} className="flex items-start gap-4 px-4 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {j.user_id
                      ? (nombre.get(j.user_id) ?? j.invited_email)
                      : j.invited_email}
                  </p>
                  {j.user_id && (
                    <p className="truncate text-sm text-neutral-500">
                      {j.invited_email}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {suyos.length > 0 ? (
                      <span className="rounded-md bg-lime-400/15 px-2 py-0.5 text-xs font-medium text-lime-300">
                        {suyos.length === 1
                          ? `Carril ${suyos[0]}`
                          : `${suyos.length} carriles tomados`}
                      </span>
                    ) : (
                      <span className="rounded-md bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                        Sin carril
                      </span>
                    )}

                    {suyas.length > 0 && (
                      <span className="rounded-md bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                        {suyas.length === 1
                          ? (nombreDivision.get(suyas[0]) ?? "1 categoría")
                          : `${suyas.length} categorías`}
                      </span>
                    )}
                  </div>

                  {!j.user_id && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-400/80">
                      <Icono nombre="reloj" className="h-3.5 w-3.5" />
                      Pendiente de que se registre — hasta entonces no puede
                      tomar carril
                    </p>
                  )}
                </div>

                <FormularioDeEstado
                  accion={quitar.bind(null, j.id)}
                  estadoInicial={{ error: null }}
                  etiqueta="✕"
                  pendienteTexto="…"
                  mensajeDeCarga="Quitando al juez…"
                  title="Quitar juez"
                  className="px-2 py-1 text-sm text-neutral-600 hover:text-red-400"
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* Primero los conocidos: en una fecha nueva, el equipo suele ser el
          mismo de la anterior y escribir doce correos otra vez es el costo que
          hace insoportable invitar por evento. */}
      <ReusarContactos
        eventId={id}
        contactos={contactos.filter((c) => c.fueJuez)}
        comoJuez
      />

      <section className="rounded-2xl border border-neutral-800 p-6">
        <h3 className="mb-6 text-lg font-semibold">Agregar juez nuevo</h3>
        <AgregarJuez
          eventId={id}
          divisiones={divisiones.map((d) => ({ id: d.id, name: d.name }))}
        />
      </section>

      <p className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-400">
        El juez entra por{" "}
        <Link href="/juez" className="text-lime-400 hover:underline">
          Juzgar
        </Link>
        .{" "}
        {event.allow_judge_self_claim
          ? "Puede tomar su carril él mismo con señal, antes de que largue el heat, o esperar a que se lo asignes desde Heats."
          : "La autoasignación está apagada: solo se conecta al carril que le hayas asignado desde Heats."}{" "}
        Desde ahí el cronómetro funciona aunque se caiga el internet, y un juez
        que ya tiene un carril activo en otro heat no puede tomar uno nuevo
        hasta liberarlo.
      </p>
    </div>
  );
}
