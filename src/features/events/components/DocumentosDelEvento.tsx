"use client";

import { useState, useTransition } from "react";
import { ZonaDeArchivo } from "@/shared/components/ZonaDeArchivo";
import { Icono } from "@/shared/components/Icono";
import { useCarga } from "@/shared/components/Carga";
import { useNotificaciones } from "@/shared/components/Notificaciones";
import { agregarDocumento, borrarDocumento } from "../actions.documentos";
import type { EventDocumentKind } from "@/lib/supabase/types";

const TIPOS = ["application/pdf", "image/jpeg", "image/png"];

export interface DocumentoDelEvento {
  id: string;
  name: string;
  url: string;
  kind: EventDocumentKind;
  requiresAcceptance: boolean;
}

/**
 * Los documentos de la competencia, en DOS grupos.
 *
 * No es una separacion cosmetica: cambian lo que le pasa al atleta.
 *
 *   Informativos   se muestran en la ficha publica para que los lea quien
 *                  quiera. Reglamento, plano del recinto, guia de movimientos.
 *   Terminos       hay que ACEPTARLOS para poder inscribirse. Si esta seccion
 *                  esta vacia, el formulario no pide aceptar nada.
 *
 * Por dentro es la misma tabla con la bandera `requires_acceptance`, y no dos
 * tablas: un reglamento puede volverse obligatorio de un dia para el otro sin
 * mover el archivo de lugar.
 *
 * NO VA DENTRO DEL `<form>` de la ficha. Subir un documento tiene que guardarse
 * en el acto —el archivo ya esta en Storage— y no esperar a que el organizador
 * apriete "Guardar" al final de una pantalla larga. Ademas es el caso del bug de
 * `HeatCard`: al terminar una accion, React 19 llama al `form.reset()` nativo.
 */
export function DocumentosDelEvento({
  eventId,
  documentos,
}: {
  eventId: string;
  documentos: DocumentoDelEvento[];
}) {
  const informativos = documentos.filter((d) => !d.requiresAcceptance);
  const terminos = documentos.filter((d) => d.requiresAcceptance);

  return (
    <div className="flex flex-col gap-8">
      <Grupo
        eventId={eventId}
        titulo="Documentos informativos"
        descripcion="Estos documentos se compartirán a los atletas en la página de información general del evento."
        documentos={informativos}
        kind="reglamento"
        requiereAceptacion={false}
      />

      <Grupo
        eventId={eventId}
        titulo="Términos y condiciones"
        descripcion="Sube los documentos de términos y condiciones. Si hay documentos en esta sección, los atletas deberán aceptar los términos para registrarse."
        documentos={terminos}
        kind="terminos"
        requiereAceptacion
      />
    </div>
  );
}

function Grupo({
  eventId,
  titulo,
  descripcion,
  documentos,
  kind,
  requiereAceptacion,
}: {
  eventId: string;
  titulo: string;
  descripcion: string;
  documentos: DocumentoDelEvento[];
  kind: EventDocumentKind;
  requiereAceptacion: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { activar, desactivar } = useCarga();
  const { error: avisarError } = useNotificaciones();

  function quitar(id: string) {
    startTransition(async () => {
      activar("Quitando el documento…");
      try {
        const r = await borrarDocumento(eventId, id);
        if (r.error) avisarError(r.error);
      } finally {
        desactivar();
      }
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex gap-3">
        <span
          aria-hidden
          className={`mt-1 w-1 shrink-0 rounded-full ${
            requiereAceptacion ? "bg-amber-400/70" : "bg-lime-400/70"
          }`}
        />
        <div>
          <h3 className="text-base font-semibold text-neutral-100">{titulo}</h3>
          <p className="mt-0.5 max-w-2xl text-sm text-neutral-500">
            {descripcion}
          </p>
        </div>
      </div>

      {documentos.length > 0 && (
        <ul className="divide-y divide-neutral-800 overflow-hidden rounded-2xl border border-neutral-800">
          {documentos.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-3">
              <Icono
                nombre="documento"
                className="h-4 w-4 shrink-0 text-neutral-500"
              />
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer noopener"
                className="min-w-0 flex-1 truncate text-sm hover:text-lime-300"
              >
                {d.name}
              </a>
              <button
                type="button"
                onClick={() => quitar(d.id)}
                className="px-2 text-sm text-neutral-600 hover:text-red-400"
                title="Quitar documento"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <ZonaDeArchivo
        carpeta={`${eventId}/documentos`}
        tipos={TIPOS}
        maximoMb={10}
        etiqueta="Arrastra el documento o haz clic"
        ayuda="PDF, JPG o PNG · hasta 10 MB"
        onSubido={async (url, nombre) => {
          setError(null);
          const res = await agregarDocumento(eventId, {
            // El nombre del archivo, sin la extension: es lo que el atleta va a
            // ver en la ficha, y "reglamento.pdf" se lee peor que "Reglamento".
            nombre: nombre.replace(/\.[a-z0-9]+$/i, ""),
            url,
            kind,
            requiereAceptacion,
          });
          if (res.error) setError(res.error);
        }}
      />

      {error && <p className="text-xs text-red-400">{error}</p>}

      {requiereAceptacion && documentos.length === 0 && (
        <p className="text-xs text-neutral-600">
          Sin documentos aquí, el formulario de inscripción no pide aceptar
          nada.
        </p>
      )}
    </section>
  );
}
