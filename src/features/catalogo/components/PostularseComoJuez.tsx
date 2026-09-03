import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BotonPostularse } from "./BotonPostularse";

/**
 * "¿Querés ser juez de esta competencia?" -- la puerta de entrada pública,
 * al lado de la que ya existe: el organizador invita por correo.
 *
 * LA POSTULACIÓN QUEDA PENDIENTE DE APROBACIÓN, A DIFERENCIA DE LA INVITACIÓN.
 * Cuando el organizador invita, ya eligió a esa persona escribiendo su correo;
 * cuando alguien se postula solo, la organización no lo eligió a él primero.
 * "Siempre verificado por la organización" significa que ese paso no se puede
 * saltar, y `apply_as_judge` lo hace estructural: la fila nace sin
 * `approved_at`, y sin eso no hay `event_role` ni acceso a nada.
 *
 * SE MUESTRA SOLO SI LA COMPETENCIA TODAVÍA NO TERMINÓ. Postularse a una
 * competencia que ya pasó no tiene destino.
 */
export async function PostularseComoJuez({
  slug,
  yaPaso,
}: {
  slug: string;
  yaPaso: boolean;
}) {
  if (yaPaso) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Seccion>
        <p className="text-sm text-neutral-400">
          ¿Querés juzgar esta competencia?{" "}
          <Link
            href={`/login?volver=/eventos/${slug}`}
            className="text-lime-400 hover:underline"
          >
            Inicia sesión
          </Link>{" "}
          para postularte.
        </p>
      </Seccion>
    );
  }

  const { data: estado } = await supabase.rpc("public_judge_application_status", {
    p_public_slug: slug,
  });

  if (estado === "aprobada") {
    return (
      <Seccion>
        <p className="text-sm text-lime-400">
          Ya sos juez de esta competencia. Tomá tu carril desde{" "}
          <Link href="/juez" className="hover:underline">
            Juzgar
          </Link>
          .
        </p>
      </Seccion>
    );
  }

  if (estado === "pendiente") {
    return (
      <Seccion>
        <p className="text-sm text-amber-400">
          Ya te postulaste como juez. La organización todavía no aprobó tu postulación.
        </p>
      </Seccion>
    );
  }

  return (
    <Seccion>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">¿Querés juzgar esta competencia?</p>
          <p className="mt-0.5 text-sm text-neutral-500">
            Tu postulación queda pendiente hasta que la organización la apruebe.
          </p>
        </div>
        <BotonPostularse slug={slug} />
      </div>
    </Seccion>
  );
}

function Seccion({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5">
      {children}
    </section>
  );
}
