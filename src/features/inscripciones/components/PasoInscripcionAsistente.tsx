import { getDivisions } from "@/features/events/config/queries";
import { createClient } from "@/lib/supabase/server";
import { FormularioInscripcionAsistente } from "./FormularioInscripcionAsistente";

/**
 * El paso "Inscripcion" del asistente: las mismas tres preguntas que la
 * pantalla de inscripciones del panel (como se cobra, cuanto sale, que
 * descuentos hay), pero SIN un boton de guardar por seccion. Aca "Continuar"
 * hace las tres escrituras de una vez — ver `guardarPasoInscripcion`.
 *
 * Es un componente DISTINTO de `ConfiguracionDeInscripciones` a proposito: esa
 * la sigue usando la pantalla standalone del panel, que no tiene un "Continuar"
 * de asistente del que colgarse y necesita poder guardar cada seccion por su
 * cuenta.
 */
export async function PasoInscripcionAsistente({ eventId }: { eventId: string }) {
  const supabase = await createClient();

  // La organizacion es la DUEÑA de este evento, no "la primera que devuelva
  // getMyOrganizations()". Con `orgs[0]` cualquiera que administre mas de una
  // organizacion veia — y guardaba — los medios de cobro de la organizacion
  // equivocada en TODAS sus competencias, sin importar a cual pertenecia cada
  // una.
  const [divisiones, { data: config }, { data: evento }, { data: codigos }] = await Promise.all([
    getDivisions(eventId),
    supabase.from("division_registration").select("*").eq("event_id", eventId),
    supabase.from("events").select("currency, org_id").eq("id", eventId).single(),
    supabase.from("discount_codes").select("*").eq("event_id", eventId).order("code"),
  ]);

  const porDivision = new Map((config ?? []).map((c) => [c.division_id, c]));
  const moneda = evento?.currency ?? "COP";
  const orgId = evento?.org_id ?? null;

  const { data: proveedores } = orgId
    ? await supabase
        .from("payment_providers")
        .select("provider, label, public_config, active")
        .eq("org_id", orgId)
    : { data: [] };

  return (
    <FormularioInscripcionAsistente
      eventId={eventId}
      orgId={orgId}
      moneda={moneda}
      configurados={(proveedores ?? []).map((c) => ({
        provider: c.provider,
        label: c.label,
        publicConfig: (c.public_config ?? {}) as Record<string, string>,
        active: c.active,
      }))}
      divisiones={divisiones.map((d) => ({ id: d.id, name: d.name }))}
      config={porDivision}
      codigos={codigos ?? []}
    />
  );
}
