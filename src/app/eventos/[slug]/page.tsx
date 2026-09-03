import { MarcoDelEvento } from "@/features/catalogo/components/MarcoDelEvento";
import { PanelDeInformacion } from "@/features/catalogo/components/PanelDeInformacion";
import { getEventoPublico } from "@/features/catalogo/queries";
import { traduccion } from "@/shared/i18n/servidor";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const evento = await getEventoPublico(slug);
  if (!evento) return { title: "Competencia — Scora" };

  return {
    title: `${evento.name} — Scora`,
    description: evento.description?.slice(0, 160) ?? undefined,
    openGraph: {
      title: evento.name,
      description: evento.description?.slice(0, 200) ?? undefined,
      images: evento.coverUrl ? [evento.coverUrl] : undefined,
    },
  };
}

export default async function EventoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { idioma } = await traduccion();

  return (
    <MarcoDelEvento slug={slug} activa="info">
      {(evento) => <PanelDeInformacion evento={evento} idioma={idioma} />}
    </MarcoDelEvento>
  );
}
