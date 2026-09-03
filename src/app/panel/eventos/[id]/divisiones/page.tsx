import {
  deleteDivision,
  type FormState,
} from "@/features/events/config/actions";
import {
  getCatalogoDeMovimientos,
  getCategoriasConfiguradas,
  getCourseTemplates,
  getSegmentos,
  getTablasDePuntuacion,
} from "@/features/events/config/queries";
import { requireEventAccess } from "@/features/events/lib/access";
import { NuevaDivision } from "@/features/events/components/NuevaDivision";
import { FilaDeCategoria } from "@/features/events/components/ParametrosDeCategoria";
import { CircuitoDeHyrox } from "@/features/events/components/CircuitoDeHyrox";

export const dynamic = "force-dynamic";

/**
 * Las categorias, en una GRILLA — no un acordeon.
 *
 * Vivio un tiempo como paso del asistente y se mudo aca cuando el asistente se
 * quedo con la ficha, los documentos y el cobro. Es el lugar correcto: una
 * categoria no se carga una vez y se olvida —se agrega una en marzo, se corrige
 * un peso la vispera— y llegar a ella no puede exigir recorrer un asistente.
 *
 * ANTES CADA FILA ERA UN ACORDEON. Con diez categorias o mas —nada raro en un
 * Hyrox grande— la pantalla se volvia una lista de diez acordeones donde
 * encontrar "Elite Femenino" era hacer scroll. La grilla responde "¿cuales
 * tengo y que les falta?" de un vistazo; tocar una abre un modal
 * (`FilaDeCategoria`) con cupo, sistema de puntuacion, y —segun el formato—
 * los movimientos con su peso o los parametros del circuito.
 */
export default async function DivisionesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { canManage, event } = await requireEventAccess(id);
  const esHibrida = event.format !== "crossfit";

  const [categorias, templates, catalogo, tablas] = await Promise.all([
    getCategoriasConfiguradas(id),
    getCourseTemplates(id),
    getCatalogoDeMovimientos(),
    getTablasDePuntuacion(),
  ]);

  // Los segmentos de cada circuito, de una sola vez: una consulta por categoria
  // seria N+1 con diez categorias del mismo circuito.
  const porTemplate = new Map<
    string,
    Awaited<ReturnType<typeof getSegmentos>>
  >();
  for (const t of templates) {
    porTemplate.set(t.id, await getSegmentos(id, t.id));
  }

  async function quitar(
    divisionId: string,
    _prev: FormState,
    _formData: FormData,
  ) {
    "use server";
    return deleteDivision(id, divisionId);
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-neutral-500">
        Una categoría es lo que rankea por separado: individual, parejas del
        mismo sexo, parejas mixtas, con o sin rango de edad. Tócala para ponerle
        su cupo y sus parámetros.
      </p>

      {categorias.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          Sin categorías todavía.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-800">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-900/40 text-left text-neutral-500">
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-3 py-3 font-medium">Tipo</th>
                <th className="px-3 py-3 font-medium">Sexo</th>
                <th className="px-3 py-3 font-medium">Cupo</th>
                <th className="px-3 py-3 font-medium">
                  {esHibrida ? "Circuito" : "Movimientos"}
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {categorias.map((c) => (
                <FilaDeCategoria
                  key={c.id}
                  eventId={id}
                  categoria={c}
                  formato={event.format}
                  segmentos={
                    c.courseTemplateId
                      ? (porTemplate.get(c.courseTemplateId) ?? [])
                      : []
                  }
                  catalogo={catalogo}
                  tablas={tablas}
                  templates={templates}
                  alQuitar={canManage ? quitar.bind(null, c.id) : undefined}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Solo en una carrera híbrida: un CrossFit corre pruebas, no un
          recorrido, y ofrecerle un circuito hace dudar de si la herramienta
          entendió qué competencia se está armando. */}
      {canManage && esHibrida && templates.length === 0 && (
        <CircuitoDeHyrox eventId={id} />
      )}

      {canManage && (
        <NuevaDivision
          eventId={id}
          templates={templates}
          formato={event.format}
          tablas={tablas}
        />
      )}
    </div>
  );
}
