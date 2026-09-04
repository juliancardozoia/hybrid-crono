"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Selector } from "@/shared/components/Selector";
import { nombreDePais } from "@/shared/utils/paises";
import type { OpcionesDeFiltro } from "../queries";
import { crearTraductor } from "@/shared/i18n/diccionario";
import type { Idioma } from "@/shared/i18n/idiomas";
import type { ClaveDeTexto } from "@/shared/i18n/es";

/**
 * Los filtros del catalogo: pais, mes, año y formato.
 *
 * ESCRIBEN EN LA URL, no en un estado local. Asi un enlace a "CrossFit en
 * Colombia en marzo" se puede compartir, el boton de atras funciona, y la
 * pagina se sigue renderizando en el servidor.
 *
 * SE VEN LOS CUATRO, SIEMPRE. Antes se escondian los que no tenian opciones, y
 * en una plataforma que recien arranca eso deja la portada con un solo campo de
 * busqueda: parece que la busqueda no existe. Un selector vacio que dice "sin
 * competencias aun" es informacion; uno ausente no dice nada.
 *
 * NO HAY FILTRO DE CIUDAD. Con un puñado de competencias por pais, el selector
 * de ciudad casi siempre tenia una sola opcion —un filtro que no filtra— y le
 * robaba lugar a los tres que si deciden algo. La ciudad se busca escribiendola
 * en el buscador, que ya la mira.
 *
 * QUE OFRECE CADA UNO, Y POR QUE NO ES LA MISMA REGLA
 *
 *   Pais      solo los que TIENEN competencias. Nadie se sabe la lista de
 *             paises de la plataforma, asi que ofrecer veintidos cuando hay dos
 *             es prometer resultados que no estan.
 *   Mes       los doce, siempre. Es un vocabulario cerrado que todos conocen:
 *             uno al que le faltan nueve se lee como una pagina rota.
 *   Año       los que existen. Si no hay ninguno, el actual y el que viene, que
 *             es el rango en el que alguien busca.
 *   Formato   los dos que existen de verdad.
 */

const FORMATOS: Array<{ value: string; clave: ClaveDeTexto }> = [
  { value: "", clave: "filtros.todos" },
  { value: "crossfit", clave: "formato.crossfit" },
  { value: "carrera_hibrida", clave: "formato.carrera_hibrida" },
];

const MESES: ClaveDeTexto[] = [
  "mes.1",
  "mes.2",
  "mes.3",
  "mes.4",
  "mes.5",
  "mes.6",
  "mes.7",
  "mes.8",
  "mes.9",
  "mes.10",
  "mes.11",
  "mes.12",
];

const selector = "w-full";

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
        {etiqueta}
      </span>
      {children}
    </label>
  );
}

export function BarraDeFiltros({
  opciones,
  idioma,
}: {
  opciones: OpcionesDeFiltro;
  idioma: Idioma;
}) {
  const t = crearTraductor(idioma);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [busqueda, setBusqueda] = useState(searchParams.get("q") ?? "");

  function aplicar(cambios: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor) params.set(clave, valor);
      else params.delete(clave);
    }
    // Cambiar un filtro vuelve a la primera pagina: seguir en la 3 despues de
    // filtrar deja al usuario mirando un vacio que parece un error.
    params.delete("pagina");
    const query = params.toString();
    startTransition(() => router.push(query ? `/?${query}` : "/"));
  }

  // Sin nada publicado todavia, el selector de año igual ofrece algo con
  // sentido en vez de quedar vacio.
  const ahora = new Date().getFullYear();
  const anios =
    opciones.anios.length > 0
      ? opciones.anios
      : [
          { anio: ahora, cantidad: 0 },
          { anio: ahora + 1, cantidad: 0 },
        ];

  const conteoPorMes = new Map(opciones.meses.map((m) => [m.mes, m.cantidad]));
  const hayFiltros = ["q", "pais", "mes", "anio", "formato"].some((c) => searchParams.get(c));

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 sm:p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          aplicar({ q: busqueda });
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={t("filtros.buscar")}
          aria-label={t("filtros.buscar")}
          className="flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 outline-none transition-colors focus:border-lime-400"
        />
        <button
          type="submit"
          className="rounded-xl bg-lime-400 px-6 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300"
        >
          {t("filtros.buscarBoton")}
        </button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Campo etiqueta={t("filtros.pais")}>
          <Selector
            value={searchParams.get("pais") ?? ""}
            onChange={(e) => aplicar({ pais: e.target.value })}
            className={selector}
            disabled={opciones.paises.length === 0}
          >
            <option value="">
              {opciones.paises.length === 0 ? t("filtros.sinPaises") : t("filtros.todos")}
            </option>
            {opciones.paises.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {nombreDePais(p.codigo) || p.codigo} ({p.cantidad})
              </option>
            ))}
          </Selector>
        </Campo>

        <Campo etiqueta={t("filtros.mes")}>
          <Selector
            value={searchParams.get("mes") ?? ""}
            onChange={(e) => aplicar({ mes: e.target.value })}
            className={selector}
          >
            <option value="">{t("filtros.todos")}</option>
            {MESES.map((clave, i) => {
              const n = conteoPorMes.get(i + 1);
              return (
                <option key={clave} value={i + 1}>
                  {t(clave)}
                  {n ? ` (${n})` : ""}
                </option>
              );
            })}
          </Selector>
        </Campo>

        <Campo etiqueta={t("filtros.anio")}>
          <Selector
            value={searchParams.get("anio") ?? ""}
            onChange={(e) => aplicar({ anio: e.target.value })}
            className={selector}
          >
            <option value="">{t("filtros.todos")}</option>
            {anios.map((a) => (
              <option key={a.anio} value={a.anio}>
                {a.anio}
                {a.cantidad ? ` (${a.cantidad})` : ""}
              </option>
            ))}
          </Selector>
        </Campo>

        <Campo etiqueta={t("filtros.formato")}>
          <Selector
            value={searchParams.get("formato") ?? ""}
            onChange={(e) => aplicar({ formato: e.target.value })}
            className={selector}
          >
            {FORMATOS.map((f) => (
              <option key={f.value} value={f.value}>
                {t(f.clave)}
              </option>
            ))}
          </Selector>
        </Campo>
      </div>

      {hayFiltros && (
        <button
          type="button"
          onClick={() => {
            setBusqueda("");
            startTransition(() => router.push("/"));
          }}
          className="self-start text-sm text-neutral-500 hover:text-neutral-300"
        >
          {t("filtros.limpiar")}
        </button>
      )}
    </div>
  );
}
