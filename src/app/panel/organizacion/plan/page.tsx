import { redirect } from "next/navigation";
import { getMyOrganizations } from "@/features/org/queries";
import { getPlanDeOrganizacion } from "@/features/planes/queries";
import { activarPro, cancelarPro, guardarTarjeta } from "@/features/planes/actions";
import { BotonDePlan } from "@/features/planes/components/BotonDePlan";
import { SimpleForm, Field, FieldRow, Select } from "@/shared/components/SimpleForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan — Scora" };

/**
 * Que incluye cada plan, con el corte escrito como es y no como suena mejor.
 *
 * Vale la pena repetirlo en la pantalla que cobra: en el plan gratuito el juez
 * cronometra IGUAL. Lo que se compra es mostrar los resultados y juzgar WODs de
 * CrossFit en vivo.
 */
const COMPARACION: Array<{ que: string; free: string; pro: string }> = [
  { que: "Crear competencias, categorías y pruebas", free: "Sí", pro: "Sí" },
  { que: "Inscripciones, cobro a atletas y cronograma", free: "Sí", pro: "Sí" },
  { que: "Cronometrar un circuito con la app del juez", free: "Sí", pro: "Sí" },
  { que: "Competencias corriendo a la vez", free: "Una", pro: "Las que quieras" },
  { que: "Juzgar un WOD de CrossFit en vivo", free: "Se carga a mano", pro: "Sí" },
  { que: "Leaderboard en vivo y vista de proyector", free: "No", pro: "Sí" },
  { que: "Parciales y ficha del atleta", free: "No", pro: "Sí" },
  { que: "Aparecer en el catálogo público", free: "No", pro: "Sí" },
];

const PASARELAS = [
  { value: "", label: "Elige una pasarela…" },
  { value: "stripe", label: "Stripe" },
  { value: "mercadopago", label: "Mercado Pago" },
  { value: "paypal", label: "PayPal" },
];

export default async function PlanPage() {
  const orgs = await getMyOrganizations();
  const org = orgs.find((o) => o.role === "owner" || o.role === "admin");
  if (!org) redirect("/panel");

  const datos = await getPlanDeOrganizacion(org.id);
  if (!datos) redirect("/panel");

  const { plan, tarjeta, activas } = datos;
  const esPro = plan === "pro";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-2xl font-bold">Plan de {org.name}</h1>
        <p className="mt-2 text-sm text-neutral-400">
          El plan no cambia lo que puedes hacer con tus atletas: cambia lo que puedes{" "}
          <span className="text-neutral-200">mostrar</span>, y si juzgas los WODs de CrossFit en
          vivo o los cargas a mano.
        </p>
      </div>

      <section
        className={`rounded-2xl border p-5 ${
          esPro ? "border-lime-500/40 bg-lime-500/5" : "border-neutral-800"
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{esPro ? "Plan Pro" : "Plan gratuito"}</h2>
          <span className="text-sm text-neutral-500">
            {esPro
              ? "Todo habilitado"
              : `${activas.length} de 1 competencia activa`}
          </span>
        </div>

        {!esPro && activas.length > 0 && (
          <p className="mt-3 text-sm text-neutral-400">
            Ocupando el cupo: {activas.map((e) => e.name).join(", ")}. Termina esa competencia
            (publica sus resultados) para arrancar la siguiente.
          </p>
        )}

        <div className="mt-5">
          {esPro ? (
            <BotonDePlan
              accion={cancelarPro}
              orgId={org.id}
              etiqueta="Volver al plan gratuito"
              tono="discreto"
            />
          ) : tarjeta ? (
            <BotonDePlan accion={activarPro} orgId={org.id} etiqueta="Activar plan Pro" />
          ) : (
            <p className="text-sm text-neutral-500">
              Registra una tarjeta aquí abajo para activar el plan Pro.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Qué incluye cada uno</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-neutral-500">
                <th className="py-2 font-medium"> </th>
                <th className="w-32 py-2 font-medium">Gratuito</th>
                <th className="w-32 py-2 font-medium">Pro</th>
              </tr>
            </thead>
            <tbody>
              {COMPARACION.map((fila) => (
                <tr key={fila.que} className="border-b border-neutral-900">
                  <td className="py-2.5 pr-4 text-neutral-300">{fila.que}</td>
                  <td className="py-2.5 text-neutral-500">{fila.free}</td>
                  <td className="py-2.5 text-lime-300">{fila.pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-800 p-5">
        <h2 className="font-semibold">Cómo te cobramos</h2>
        <p className="mt-2 text-sm text-neutral-400">
          {tarjeta
            ? `Registrada: ${tarjeta.brand ?? tarjeta.provider}${
                tarjeta.last4 ? ` ···· ${tarjeta.last4}` : ""
              }${
                tarjeta.expMonth && tarjeta.expYear
                  ? ` · vence ${String(tarjeta.expMonth).padStart(2, "0")}/${tarjeta.expYear}`
                  : ""
              }`
            : "Todavía no registraste ningún medio de pago."}
        </p>

        <div className="mt-5">
          <SimpleForm
            action={guardarTarjeta}
            submitLabel={tarjeta ? "Cambiar tarjeta" : "Registrar tarjeta"}
            hidden={{ orgId: org.id }}
          >
            <FieldRow>
              <Select label="Pasarela" name="provider" options={PASARELAS} required />
              <Field label="Referencia de la tarjeta" name="token" required placeholder="tok_…" />
            </FieldRow>
            <FieldRow>
              <Field label="Marca" name="marca" placeholder="visa" />
              <Field label="Últimos 4 dígitos" name="last4" placeholder="4242" />
            </FieldRow>
            <FieldRow>
              <Field label="Mes de vencimiento" name="mes" type="number" placeholder="12" />
              <Field label="Año de vencimiento" name="anio" type="number" placeholder="2030" />
            </FieldRow>
            <FieldRow>
              <Field label="Titular" name="titular" placeholder="Como figura en la tarjeta" />
              <Field label="NIT / RUT / CUIT" name="nit" placeholder="900123456-7" />
            </FieldRow>
            <Field
              label="Correo de facturación"
              name="email"
              type="email"
              placeholder="pagos@tubox.com"
            />
          </SimpleForm>
        </div>

        <p className="mt-5 border-t border-neutral-800 pt-4 text-xs text-neutral-600">
          No guardamos números de tarjeta: se guarda la referencia que devuelve la pasarela, que
          sirve para cobrarte aquí y para nada más. Los datos de facturación se conservan si dejas
          esos campos vacíos al cambiar de tarjeta.
        </p>
      </section>

      <p className="text-sm text-neutral-500">
        Esto es lo que te cobramos a ti. Lo que le cobras a tus atletas se configura dentro de cada
        competencia, en <span className="text-neutral-300">Inscripciones</span>: va directo a tus
        cuentas y no pasa por aquí.
      </p>
    </main>
  );
}
