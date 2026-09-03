import { MarcoDelEvento, Vacio } from "@/features/catalogo/components/MarcoDelEvento";
import { PanelDeCronograma } from "@/features/catalogo/components/PanelDeCronograma";
import { getEventoPublico } from "@/features/catalogo/queries";
import { traduccion } from "@/shared/i18n/servidor";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const evento = await getEventoPublico(slug);
  return { title: evento ? `Cronograma — ${evento.name}` : "Cronograma — Scora" };
}

export default async function CronogramaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { idioma } = await traduccion();

  return (
    <MarcoDelEvento slug={slug} activa="cronograma">
      {(evento) =>
        evento.schedule.length === 0 ? (
          <Vacio
            titulo="Todavía no hay cronograma"
            detalle="La organización publica los horarios cuando cierra las inscripciones y arma los heats."
          />
        ) : (
          <PanelDeCronograma evento={evento} idioma={idioma} />
        )
      }
    </MarcoDelEvento>
  );
}
