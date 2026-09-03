import { MarcoDelEvento, Vacio } from "@/features/catalogo/components/MarcoDelEvento";
import { PanelDeWorkouts } from "@/features/catalogo/components/PanelDeWorkouts";
import { getEventoPublico } from "@/features/catalogo/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const evento = await getEventoPublico(slug);
  if (!evento) return { title: "Pruebas — Scora" };
  const que = evento.format === "carrera_hibrida" ? "Circuito" : "Workouts";
  return { title: `${que} — ${evento.name}` };
}

export default async function WorkoutsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return (
    <MarcoDelEvento slug={slug} activa="workouts">
      {(evento) =>
        evento.workouts.length === 0 ? (
          <Vacio
            titulo="Todavía no hay pruebas publicadas"
            detalle="La organización decide cuándo revelarlas. Suele ser en los días previos a la competencia."
          />
        ) : (
          <PanelDeWorkouts evento={evento} />
        )
      }
    </MarcoDelEvento>
  );
}
