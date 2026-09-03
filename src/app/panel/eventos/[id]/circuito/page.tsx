import {
  addSegment,
  createCourseTemplate,
  deleteCourseTemplate,
  moveSegment,
  removeSegment,
  type FormState,
} from "@/features/events/config/actions";
import {
  getCourseTemplates,
  getDivisions,
  getSegments,
} from "@/features/events/config/queries";
import { requireEventAccess } from "@/features/events/lib/access";
import {
  Field,
  FieldRow,
  Select,
  SimpleForm,
} from "@/shared/components/SimpleForm";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";

const TIPOS: Record<string, string> = {
  run: "Corrida",
  station: "Estación",
  transition: "Transición",
};

export default async function CircuitoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { canManage } = await requireEventAccess(id);

  const [templates, divisiones] = await Promise.all([
    getCourseTemplates(id),
    getDivisions(id),
  ]);
  const conSegmentos = await Promise.all(
    templates.map(async (t) => ({ ...t, segments: await getSegments(t.id) })),
  );

  // Cuantas categorias usan cada circuito: el boton de borrar solo aparece si
  // la cuenta da cero. `divisions.course_template_id` es `on delete restrict`,
  // asi que Postgres lo bloquearia igual — esto es para no ofrecer un boton
  // que va a fallar.
  const categoriasPorTemplate = new Map<string, number>();
  for (const d of divisiones) {
    if (!d.course_template_id) continue;
    categoriasPorTemplate.set(
      d.course_template_id,
      (categoriasPorTemplate.get(d.course_template_id) ?? 0) + 1,
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-neutral-500">
        El circuito es la secuencia de segmentos que el juez va marcando. Cada
        marcaje cierra un segmento, así que un Hyrox estándar son 16 taps por
        atleta.
      </p>

      {conSegmentos.map((template) => {
        const enUso = categoriasPorTemplate.get(template.id) ?? 0;
        return (
          <section key={template.id}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">{template.name}</h2>

              {canManage &&
                (enUso > 0 ? (
                  <span className="text-xs text-neutral-500">
                    {enUso === 1
                      ? "1 categoría usa este circuito"
                      : `${enUso} categorías usan este circuito`}
                  </span>
                ) : (
                  <FormularioDeEstado
                    accion={eliminarCircuito.bind(null, id, template.id)}
                    estadoInicial={{ error: null }}
                    etiqueta="Eliminar circuito"
                    mensajeDeCarga="Eliminando el circuito…"
                    title="Eliminar circuito"
                    className="text-xs text-neutral-600 hover:text-red-400"
                  />
                ))}
            </div>

            {template.segments.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
                Sin segmentos todavía.
              </p>
            ) : (
              <ol className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
                {template.segments.map((segment, index) => (
                  <li
                    key={segment.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <span className="w-6 font-mono text-sm text-neutral-600">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="flex-1">
                      <span className="font-medium">{segment.name}</span>
                      <span className="ml-2 text-xs text-neutral-500">
                        {TIPOS[segment.kind]}
                      </span>
                    </span>

                    {canManage && (
                      <span className="flex items-center gap-1">
                        <MoverBoton
                          eventId={id}
                          templateId={template.id}
                          segmentId={segment.id}
                          direction="up"
                          disabled={index === 0}
                        />
                        <MoverBoton
                          eventId={id}
                          templateId={template.id}
                          segmentId={segment.id}
                          direction="down"
                          disabled={index === template.segments.length - 1}
                        />
                        <FormularioDeEstado
                          accion={quitarSegmento.bind(null, id, segment.id)}
                          estadoInicial={{ error: null }}
                          etiqueta="✕"
                          pendienteTexto="…"
                          mensajeDeCarga="Quitando el segmento…"
                          title="Quitar segmento"
                          className="px-2 py-1 text-sm text-neutral-600 hover:text-red-400"
                        />
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {canManage && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-lime-400">
                  Agregar segmento
                </summary>
                <div className="mt-3 rounded-2xl border border-neutral-800 p-4">
                  <SimpleForm
                    action={addSegment}
                    submitLabel="Agregar"
                    hidden={{ eventId: id, templateId: template.id }}
                  >
                    <FieldRow>
                      <Field
                        label="Nombre"
                        name="name"
                        required
                        placeholder="Sled Push 50m"
                      />
                      <Select
                        label="Tipo"
                        name="kind"
                        options={[
                          { value: "station", label: "Estación" },
                          { value: "run", label: "Corrida" },
                          { value: "transition", label: "Transición" },
                        ]}
                      />
                    </FieldRow>
                  </SimpleForm>
                </div>
              </details>
            )}
          </section>
        );
      })}

      {canManage && (
        <section className="rounded-2xl border border-neutral-800 p-5">
          <h2 className="font-semibold">Nuevo circuito</h2>
          <p className="mt-1 mb-4 text-sm text-neutral-500">
            El preset de Hyrox carga las 8 estaciones con sus corridas de 1km ya
            ordenadas.
          </p>
          <SimpleForm
            action={createCourseTemplate}
            submitLabel="Crear circuito"
            hidden={{ eventId: id }}
          >
            <FieldRow>
              <Field
                label="Nombre"
                name="name"
                required
                placeholder="Hyrox Estándar"
              />
              <Select
                label="Contenido"
                name="preset"
                options={[
                  { value: "hyrox", label: "Preset Hyrox (16 segmentos)" },
                  { value: "vacio", label: "Vacío" },
                ]}
              />
            </FieldRow>
          </SimpleForm>
        </section>
      )}
    </div>
  );
}

function MoverBoton({
  eventId,
  templateId,
  segmentId,
  direction,
  disabled,
}: {
  eventId: string;
  templateId: string;
  segmentId: string;
  direction: "up" | "down";
  disabled: boolean;
}) {
  return (
    <FormularioDeEstado
      accion={moverSegmento.bind(
        null,
        eventId,
        templateId,
        segmentId,
        direction,
      )}
      estadoInicial={{ error: null }}
      etiqueta={direction === "up" ? "↑" : "↓"}
      pendienteTexto="…"
      mensajeDeCarga={
        direction === "up" ? "Subiendo el segmento…" : "Bajando el segmento…"
      }
      disabled={disabled}
      title={direction === "up" ? "Subir" : "Bajar"}
      className="px-1.5 py-1 text-sm text-neutral-500 hover:text-neutral-100 disabled:opacity-25"
    />
  );
}

async function moverSegmento(
  eventId: string,
  templateId: string,
  segmentId: string,
  direction: "up" | "down",
  _prev: FormState,
  _formData: FormData,
) {
  "use server";
  return moveSegment(eventId, templateId, segmentId, direction);
}

async function quitarSegmento(
  eventId: string,
  segmentId: string,
  _prev: FormState,
  _formData: FormData,
) {
  "use server";
  return removeSegment(eventId, segmentId);
}

async function eliminarCircuito(
  eventId: string,
  templateId: string,
  _prev: FormState,
  _formData: FormData,
) {
  "use server";
  return deleteCourseTemplate(eventId, templateId);
}
