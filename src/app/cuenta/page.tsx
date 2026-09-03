import Link from "next/link";
import { redirect } from "next/navigation";
import { EncabezadoPublico } from "@/features/catalogo/components/EncabezadoPublico";
import { PieDelSitio } from "@/shared/components/PieDelSitio";
import { FotoDePerfil } from "@/features/cuenta/components/FotoDePerfil";
import { FormularioDePerfil } from "@/features/cuenta/components/FormularioDePerfil";
import { getPerfil } from "@/features/cuenta/queries";
import { getMisInscripciones } from "@/features/inscripciones/queries";
import { rangoDeFechas } from "@/features/catalogo/lib/formato";
import { Icono } from "@/shared/components/Icono";
import { traduccion } from "@/shared/i18n/servidor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi Perfil — Scora" };

const ESTADO: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Sin enviar", clase: "bg-neutral-800 text-neutral-300" },
  esperando_integrantes: { texto: "Faltan integrantes", clase: "bg-amber-400/15 text-amber-300" },
  esperando_pago: { texto: "Falta pagar", clase: "bg-amber-400/15 text-amber-300" },
  confirmada: { texto: "Confirmada", clase: "bg-lime-400/15 text-lime-300" },
  cancelada: { texto: "Cancelada", clase: "bg-red-500/15 text-red-300" },
  lista_espera: { texto: "En lista de espera", clase: "bg-neutral-800 text-neutral-300" },
};

/**
 * El perfil de competidor.
 *
 * LA MISMA CUENTA COMPITE Y ORGANIZA. No hay dos registros ni un "tipo de
 * usuario" que elegir en la puerta: alguien que se anota a una competencia y
 * despues arma la suya no vuelve a registrarse. Esta pantalla es la mitad de
 * competidor —sus datos, su foto, sus competencias— y el enlace de abajo lleva
 * a la otra.
 */
export default async function CuentaPage() {
  const [perfil, { idioma }] = await Promise.all([getPerfil(), traduccion()]);
  if (!perfil) redirect("/login?volver=%2Fcuenta");

  const inscripciones = await getMisInscripciones();

  return (
    <>
      <EncabezadoPublico />

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mi perfil</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Con esta misma cuenta compites, juzgas y organizas.
          </p>
        </div>

        <section className="flex flex-col gap-6 rounded-2xl border border-neutral-800 p-6">
          <FotoDePerfil
            url={perfil.avatarUrl}
            nombre={perfil.fullName ?? perfil.email}
            userId={perfil.id}
          />
          <FormularioDePerfil perfil={perfil} />
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Mis competencias</h2>
            <Link href="/" className="text-sm text-lime-400 hover:underline">
              Buscar competencias
            </Link>
          </div>

          {inscripciones.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-800 p-10 text-center">
              <p className="text-neutral-400">Todavía no te inscribiste en ninguna.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {inscripciones.map((i) => {
                const estado = ESTADO[i.status] ?? {
                  texto: i.status,
                  clase: "bg-neutral-800 text-neutral-300",
                };
                return (
                  <li key={i.id}>
                    <Link
                      href={`/inscripcion/${i.id}`}
                      className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-800 p-4 transition-colors hover:border-neutral-700 hover:bg-neutral-900/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{i.eventName}</p>
                        <p className="truncate text-sm text-neutral-500">
                          {[
                            i.divisionName,
                            rangoDeFechas(i.startsAt, null, i.timezone, idioma, ""),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ${estado.clase}`}
                      >
                        {estado.texto}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* El puente al otro perfil. No es "otra sección de esta pantalla": es
            entrar al panel de organizador, que es un espacio distinto. */}
        <Link
          href="/panel"
          className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5 transition-colors hover:border-lime-400/40 hover:bg-neutral-900"
        >
          <div>
            <p className="font-semibold">Organizar una competencia</p>
            <p className="mt-0.5 text-sm text-neutral-500">
              Entra a tu panel de organizador. Crear una es gratis.
            </p>
          </div>
          <Icono nombre="flecha" className="h-5 w-5 shrink-0 text-neutral-500" />
        </Link>
      </main>

      <PieDelSitio />
    </>
  );
}
