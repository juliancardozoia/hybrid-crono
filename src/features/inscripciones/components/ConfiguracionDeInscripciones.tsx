import { getDivisions } from "@/features/events/config/queries";
import { createClient } from "@/lib/supabase/server";
import { MediosDeCobro } from "@/features/pagos/components/MediosDeCobro";
import { CodigosDeDescuento } from "@/features/pagos/components/CodigosDeDescuento";
import { PreciosDeCategorias } from "./PreciosDeCategorias";

/**
 * Como se cobra esta competencia: las tres preguntas, en orden.
 *
 *   1. como se cobra      los medios de pago del organizador
 *   2. cuanto sale        el precio de cada categoria
 *   3. que descuentos hay codigos, de una categoria o de toda la competencia
 *
 * COMO SE COBRA VA PRIMERO porque sin un medio activo, ponerle precio a una
 * categoria no sirve de nada: el atleta llega al final del tramite y no tiene
 * por donde pagar.
 *
 * Vive aca y no en la pagina porque lo piden DOS pantallas —el paso del
 * asistente y la de inscripciones del panel— y una segunda copia garantiza que
 * un dia ofrezcan cosas distintas.
 */
export async function ConfiguracionDeInscripciones({ eventId }: { eventId: string }) {
  const supabase = await createClient();

  const [divisiones, { data: config }, { data: evento }, { data: codigos }] = await Promise.all([
    getDivisions(eventId),
    supabase.from("division_registration").select("*").eq("event_id", eventId),
    supabase.from("events").select("currency, org_id").eq("id", eventId).single(),
    supabase.from("discount_codes").select("*").eq("event_id", eventId).order("code"),
  ]);

  const porDivision = new Map((config ?? []).map((c) => [c.division_id, c]));
  const moneda = evento?.currency ?? "COP";

  // Los medios de cobro son de la ORGANIZACION —las credenciales son del
  // organizador y la plata le llega directo—, y esa organizacion es la DUEÑA
  // de este evento (`events.org_id`), NO "la primera que devuelva
  // getMyOrganizations()". Con `orgs[0]` cualquiera que administre mas de una
  // organizacion veia — y guardaba — los medios de cobro de la organizacion
  // equivocada en TODAS sus competencias, sin importar a cual pertenecia cada
  // una: es lo que reporto un organizador con varias competencias.
  const orgId = evento?.org_id ?? null;
  const { data: proveedores } = orgId
    ? await supabase
        .from("payment_providers")
        .select("provider, label, public_config, active")
        .eq("org_id", orgId)
    : { data: [] };

  return (
    <div className="flex flex-col gap-8">
      {orgId && (
        <MediosDeCobro
          eventId={eventId}
          orgId={orgId}
          moneda={moneda}
          configurados={(proveedores ?? []).map((c) => ({
            provider: c.provider,
            label: c.label,
            publicConfig: (c.public_config ?? {}) as Record<string, string>,
            active: c.active,
          }))}
        />
      )}

      {/* Sin categorias no hay nada que ponerle precio: la seccion entera se
          esconde en vez de mostrar un hueco vacio invitando a crearlas aca,
          que no es donde se crean. */}
      {divisiones.length > 0 && (
        <section className="flex flex-col gap-4 border-t border-neutral-800 pt-8">
          <h3 className="text-sm font-semibold text-neutral-400 uppercase">Precio por categoría</h3>
          <p className="text-sm text-neutral-500">
            En {moneda}, la moneda de la competencia. Una categoría sin precio se confirma sola al
            enviarse: es lo que hace que una competencia interna funcione de punta a punta sin
            cobrar nada. El cupo se configura en la categoría.
          </p>

          <PreciosDeCategorias
            eventId={eventId}
            moneda={moneda}
            divisiones={divisiones.map((d) => ({ id: d.id, name: d.name }))}
            config={porDivision}
          />
        </section>
      )}

      <div className="border-t border-neutral-800 pt-8">
        <CodigosDeDescuento
          eventId={eventId}
          codigos={codigos ?? []}
          divisiones={divisiones.map((d) => ({ id: d.id, name: d.name }))}
        />
      </div>
    </div>
  );
}
