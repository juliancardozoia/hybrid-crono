import Link from "next/link";
import { requireEventAccess } from "@/features/events/lib/access";
import { createClient } from "@/lib/supabase/server";
import {
  quitarColaborador,
  type FormState,
} from "@/features/cronograma/actions";
import { AgregarColaborador } from "@/features/cronograma/components/AgregarColaborador";
import { ReusarContactos } from "@/features/cronograma/components/ReusarContactos";
import {
  getContactosDeLaOrganizacion,
  getDivisions,
} from "@/features/events/config/queries";
import { Icono } from "@/shared/components/Icono";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";

export const dynamic = "force-dynamic";

/**
 * Los colaboradores del evento: quienes ayudan con LOGISTICA, PLATAFORMA Y
 * DATOS.
 *
 * No es lo mismo que un juez, y confundirlos fue el error del modelo anterior:
 *
 *   colaborador  trabaja las semanas previas, desde una computadora. Sus
 *                permisos son sobre registros, scores y workouts.
 *   juez         existe el DIA del evento. Toma un carril y califica. No
 *                administra nada, y tiene su propia pantalla.
 *
 * Por dentro los dos son `event_staff` —misma tabla, mismas politicas— y lo que
 * los separa es tener o no banderas de permiso. Esta pantalla lista SOLO a los
 * que tienen alguna.
 *
 * ABSORBIO "JUECES Y EQUIPO", que ya no existe. Aquella pantalla daba membresia
 * de ORGANIZACION, que abre TODOS los eventos presentes y futuros: un juez
 * contratado para una fecha no puede tener eso, y tener dos puertas abiertas
 * garantizaba que alguien usara la equivocada.
 *
 * Hoy TODO el acceso se da por evento, en esta pantalla y en la de jueces. El
 * unico miembro de la organizacion es quien la creo, y se agrega solo.
 */

const PERMISOS: Array<{ campo: string; etiqueta: string }> = [
  { campo: "can_edit_registrations", etiqueta: "Edita registros" },
  { campo: "can_edit_scores", etiqueta: "Edita scores" },
  { campo: "can_delete_registrations", etiqueta: "Elimina registros" },
  { campo: "can_manage_workouts", etiqueta: "Carga workouts" },
];

export default async function ColaboradoresPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { canManage } = await requireEventAccess(id);

  const supabase = await createClient();
  const [{ data: staff }, divisiones] = await Promise.all([
    supabase
      .from("event_staff")
      .select(
        "id, invited_email, role, user_id, is_admin, can_edit_registrations, can_delete_registrations, can_edit_scores, can_manage_workouts",
      )
      .eq("event_id", id)
      .order("created_at"),
    getDivisions(id),
  ]);

  const contactos = await getContactosDeLaOrganizacion(id);

  // Los jueces viven en su propia pantalla: son otra cosa —existen el día del
  // evento y solo califican— y mezclar veinte jueces con cuatro administradores
  // hace imposible encontrar a alguien. Un juez es el que no tiene ninguna
  // bandera de permiso.
  const colaboradores = (staff ?? []).filter(
    (s) =>
      s.is_admin ||
      s.can_edit_registrations ||
      s.can_delete_registrations ||
      s.can_edit_scores ||
      s.can_manage_workouts,
  );

  // Los nombres salen aparte: `event_staff` no tiene FK a profiles, y meterla
  // sería una relación más para que PostgREST resuelva mal.
  const ids = colaboradores
    .map((s) => s.user_id)
    .filter((u): u is string => Boolean(u));
  const { data: perfiles } = ids.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids)
    : { data: [] };

  const nombre = new Map(
    (perfiles ?? []).map((p) => [p.id, p.full_name || p.email]),
  );

  // El alcance por categoría: sin filas, el colaborador ve todas.
  const { data: alcances } = await supabase
    .from("event_staff_divisions")
    .select("staff_id, division_id")
    .eq("event_id", id);

  const nombreDivision = new Map(divisiones.map((d) => [d.id, d.name]));
  const porStaff = new Map<string, string[]>();
  for (const a of alcances ?? []) {
    porStaff.set(a.staff_id, [
      ...(porStaff.get(a.staff_id) ?? []),
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

  if (!canManage) {
    return (
      <p className="rounded-2xl border border-neutral-800 p-6 text-sm text-neutral-400">
        Solo quien administra la competencia gestiona colaboradores.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold">Colaboradores</h2>
        <p className="mt-1 max-w-2xl text-sm text-neutral-400">
          Quienes ayudan con la logística, la plataforma y los datos:
          inscripciones, scores y workouts. Los que califican el día del evento
          son los{" "}
          <Link
            href={`/panel/eventos/${id}/jueces`}
            className="text-lime-400 hover:underline"
          >
            jueces
          </Link>
          .
        </p>
      </div>

      {colaboradores.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
          Todavía no hay colaboradores. ¿Buscas a los jueces? Están en su propia
          sección.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-800 overflow-hidden rounded-2xl border border-neutral-800">
          {colaboradores.map((s) => {
            const permisos = PERMISOS.filter(
              (p) => s[p.campo as keyof typeof s],
            );
            const suyas = porStaff.get(s.id) ?? [];

            return (
              <li key={s.id} className="flex items-start gap-4 px-4 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {s.user_id
                      ? (nombre.get(s.user_id) ?? s.invited_email)
                      : s.invited_email}
                  </p>
                  {s.user_id && (
                    <p className="truncate text-sm text-neutral-500">
                      {s.invited_email}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.is_admin ? (
                      <Chip color="lime">Administrador</Chip>
                    ) : (
                      permisos.map((p) => (
                        <Chip key={p.campo}>{p.etiqueta}</Chip>
                      ))
                    )}

                    {!s.is_admin && suyas.length > 0 && (
                      <Chip color="neutral">
                        {suyas.length === 1
                          ? (nombreDivision.get(suyas[0]) ?? "1 categoría")
                          : `${suyas.length} categorías`}
                      </Chip>
                    )}
                  </div>

                  {!s.user_id && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-400/80">
                      <Icono nombre="reloj" className="h-3.5 w-3.5" />
                      Pendiente de que se registre
                    </p>
                  )}
                </div>

                <FormularioDeEstado
                  accion={quitar.bind(null, s.id)}
                  estadoInicial={{ error: null }}
                  etiqueta="✕"
                  pendienteTexto="…"
                  mensajeDeCarga="Quitando al colaborador…"
                  title="Quitar colaborador"
                  className="px-2 py-1 text-sm text-neutral-600 hover:text-red-400"
                />
              </li>
            );
          })}
        </ul>
      )}

      <ReusarContactos
        eventId={id}
        contactos={contactos.filter((c) => !c.fueJuez)}
        comoJuez={false}
      />

      <section className="rounded-2xl border border-neutral-800 p-6">
        <h3 className="mb-6 text-lg font-semibold">
          Agregar colaborador nuevo
        </h3>
        <AgregarColaborador
          eventId={id}
          divisiones={divisiones.map((d) => ({ id: d.id, name: d.name }))}
        />
      </section>
    </div>
  );
}

function Chip({
  children,
  color = "neutral",
}: {
  children: React.ReactNode;
  color?: "lime" | "neutral";
}) {
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-medium ${
        color === "lime"
          ? "bg-lime-400/15 text-lime-300"
          : "bg-neutral-800 text-neutral-400"
      }`}
    >
      {children}
    </span>
  );
}
