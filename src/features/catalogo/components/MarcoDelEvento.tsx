import { notFound } from "next/navigation";
import { EncabezadoPublico } from "./EncabezadoPublico";
import { RegistrarVisita } from "./VistosRecientemente";
import { CabeceraDelEvento } from "./CabeceraDelEvento";
import { PestanasDelEvento, type Pestana } from "./PestanasDelEvento";
import { PieDelSitio } from "@/shared/components/PieDelSitio";
import { getEventoPublico, type EventoPublico } from "../queries";
import { traduccion } from "@/shared/i18n/servidor";

/**
 * El marco comun de las cuatro pestañas de una competencia.
 *
 * POR QUE NO ES UN `layout.tsx`
 *
 * Un layout en `eventos/[slug]/` envolveria tambien a `/inscripcion`, que es un
 * tramite y no una pestaña: apareceria con la barra de pestañas sin ninguna
 * activa, invitando a abandonar el formulario a medias.
 *
 * El costo aparente —cada pestaña vuelve a pedir el evento— no existe: Next
 * deduplica las peticiones dentro del mismo render, asi que `getEventoPublico`
 * se ejecuta UNA vez por visita aunque lo llamen el marco y la pagina.
 */
export async function MarcoDelEvento({
  slug,
  activa,
  children,
}: {
  slug: string;
  /** La pestaña que se esta mostrando, para no ofrecerla vacia. */
  activa: "info" | "leaderboards" | "cronograma" | "workouts";
  children: (evento: EventoPublico) => React.ReactNode;
}) {
  const [evento, { idioma }] = await Promise.all([getEventoPublico(slug), traduccion()]);

  // Un evento que no existe y uno sin publicar dan lo mismo: no hace falta
  // confirmarle a nadie que el slug existe.
  if (!evento) notFound();

  const base = `/eventos/${slug}`;
  const pestanas: Pestana[] = [{ href: base, label: "Información", icono: "documento" }];

  // LEADERBOARDS SIEMPRE. Antes solo aparecia con la competencia en vivo, y eso
  // dejaba la pestaña escondida durante los meses de inscripcion, que es
  // justamente cuando el atleta quiere ver quien mas se anoto. Cuando no hay
  // resultados muestra la lista de largada.
  pestanas.push({ href: `${base}/leaderboards`, label: "Leaderboards", icono: "trofeo" });

  // EL CRONOGRAMA SOLO MIENTRAS SIRVE PARA IR. Los horarios de una competencia
  // que ya paso no ubican a nadie: son un archivo, y ocupan el lugar de los
  // resultados, que es lo que se busca despues.
  if (evento.schedule.length > 0 && !yaPaso(evento)) {
    pestanas.push({ href: `${base}/cronograma`, label: "Cronograma", icono: "reloj" });
  }

  if (evento.workouts.length > 0) {
    // Una carrera hibrida corre UN circuito; un CrossFit, varias pruebas. Las
    // dos palabras existen en el deporte y usar la del formato equivocado hace
    // dudar de si la pagina entendio de que competencia se trata.
    pestanas.push({
      href: `${base}/workouts`,
      label: evento.format === "carrera_hibrida" ? "Circuito" : "Workouts",
      icono: "pesa",
    });
  }

  return (
    <>
      <EncabezadoPublico />
      {activa === "info" && <RegistrarVisita slug={slug} />}

      <CabeceraDelEvento evento={evento} slug={slug} idioma={idioma} />
      <PestanasDelEvento pestanas={pestanas} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 pb-24 lg:pb-10">
        {children(evento)}
      </main>

      <PieDelSitio />
    </>
  );
}

/**
 * Si la competencia ya termino.
 *
 * Se compara contra el fin, o contra el inicio cuando no hay fin cargado, con un
 * dia de gracia: una competencia que corre hoy tiene que seguir mostrando su
 * cronograma hasta que termine el dia, no hasta la hora de largada del ultimo
 * heat.
 */
export function yaPaso(evento: EventoPublico): boolean {
  const fin = evento.endsAt ?? evento.startsAt;
  if (!fin) return false;
  return new Date(fin).getTime() + 86_400_000 < Date.now();
}

/** Lo que se muestra en una pestaña que existe pero todavia no tiene datos. */
export function Vacio({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-800 p-12 text-center">
      <p className="font-medium text-neutral-300">{titulo}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-neutral-500">{detalle}</p>
    </div>
  );
}
