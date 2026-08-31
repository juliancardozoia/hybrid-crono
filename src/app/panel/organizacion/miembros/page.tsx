import Link from "next/link";
import { redirect } from "next/navigation";
import { InvitarForm } from "@/features/org/components/InvitarForm";
import { getInvitacionesPendientes, getMiembros } from "@/features/org/members";
import { cancelInvitation, removeMember } from "@/features/org/memberActions";
import { getMyOrganizations } from "@/features/org/queries";
import type { OrgRole } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Miembros — Hybrid Crono" };

const ROLES: Record<OrgRole, { texto: string; detalle: string; clase: string }> = {
  owner: { texto: "Dueño", detalle: "Manda en todo", clase: "bg-lime-500/15 text-lime-300" },
  admin: {
    texto: "Admin",
    detalle: "Configura competencias y publica",
    clase: "bg-sky-500/15 text-sky-300",
  },
  head_judge: {
    texto: "Juez principal",
    detalle: "Larga heats, anula marcajes, verifica",
    clase: "bg-amber-500/15 text-amber-300",
  },
  judge: {
    texto: "Juez",
    detalle: "Toma carriles y cronometra",
    clase: "bg-neutral-800 text-neutral-400",
  },
};

export default async function MiembrosPage() {
  const orgs = await getMyOrganizations();
  const org = orgs[0];

  if (!org) redirect("/panel");

  const puedeAdministrar = org.role === "owner" || org.role === "admin";
  if (!puedeAdministrar) redirect("/panel");

  const [miembros, invitaciones] = await Promise.all([
    getMiembros(org.id),
    getInvitacionesPendientes(org.id),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6">
      <div>
        <Link href="/panel" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Panel
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Miembros de {org.name}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Los jueces tienen que estar acá para poder tomar carriles. Se los suma por email, aunque
          todavía no se hayan registrado.
        </p>
      </div>

      <section className="rounded-2xl border border-neutral-800 p-5">
        <h2 className="mb-1 font-semibold">Sumar a alguien</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Si ya tiene cuenta entra de inmediato. Si no, queda invitado y entra solo cuando se registre
          con ese mismo email.
        </p>
        <InvitarForm orgId={org.id} puedeNombrarDuenos={org.role === "owner"} />
      </section>

      {/*
        Sumar a alguien no le manda ningun aviso: solo escribe una fila. Esta
        seccion existe para que el organizador sepa que el paso de avisarle es
        suyo, y no se quede esperando que la app lo haga.
      */}
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
        <h2 className="font-semibold">Cómo se suma un juez</h2>
        <ol className="mt-3 flex flex-col gap-2.5 text-sm text-neutral-400">
          <li>
            <strong className="text-neutral-200">1.</strong> Lo sumas acá con su email.
          </li>
          <li>
            <strong className="text-neutral-200">2.</strong> Le mves el mensaje que aparece
            después de sumarlo. <span className="text-neutral-500">La app no le avisa sola.</span>
          </li>
          <li>
            <strong className="text-neutral-200">3.</strong> Se registra con{" "}
            <strong className="text-neutral-200">ese mismo email</strong> y entra directo a sus
            carriles. No tiene que crear ninguna organización.
          </li>
          <li>
            <strong className="text-neutral-200">4.</strong> El día del evento toma su carril desde{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs">/juez</code>, o se lo
            asignas vos desde la pestaña Heats.
          </li>
        </ol>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
          Miembros ({miembros.length})
        </h2>
        <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
          {miembros.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {m.nombre}
                  {m.esYo && <span className="ml-2 text-xs text-neutral-600">(tú)</span>}
                </p>
                {m.email && m.email !== m.nombre && (
                  <p className="truncate text-xs text-neutral-500">{m.email}</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={`rounded-lg px-2 py-1 text-xs font-medium ${ROLES[m.role].clase}`}
                  title={ROLES[m.role].detalle}
                >
                  {ROLES[m.role].texto}
                </span>
                {!m.esYo && (
                  <form action={quitar.bind(null, org.id, m.userId)}>
                    <button
                      type="submit"
                      className="text-sm text-neutral-600 hover:text-red-400"
                      title="Quitar de la organización"
                    >
                      ✕
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {invitaciones.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
            Invitaciones pendientes ({invitaciones.length})
          </h2>
          <ul className="divide-y divide-neutral-800 rounded-2xl border border-dashed border-neutral-700">
            {invitaciones.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{i.email}</p>
                  <p className="text-xs text-neutral-600">
                    todavía no se registró · entrará como {ROLES[i.role].texto.toLowerCase()}
                  </p>
                </div>
                <form action={cancelar.bind(null, i.id)}>
                  <button
                    type="submit"
                    className="shrink-0 text-sm text-neutral-600 hover:text-red-400"
                    title="Cancelar invitación"
                  >
                    ✕
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 text-xs text-neutral-500">
        <strong className="text-neutral-400">Atención con el email exacto.</strong> Gmail ignora los
        puntos, pero acá no: <code>juan.perez@gmail.com</code> y <code>juanperez@gmail.com</code>{" "}
        son cuentas distintas. Invitá con el mismo email con el que la persona se va a registrar.
      </p>
    </main>
  );
}

async function quitar(orgId: string, userId: string) {
  "use server";
  await removeMember(orgId, userId);
}

async function cancelar(invitationId: string) {
  "use server";
  await cancelInvitation(invitationId);
}
