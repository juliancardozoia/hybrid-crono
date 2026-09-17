"use client";

import { Fragment, useEffect, useState } from "react";
import { Bandera } from "@/shared/components/Bandera";
import { Icono } from "@/shared/components/Icono";
import { Selector } from "@/shared/components/Selector";
import { getTablaGeneral, type TablaGeneral as Datos } from "../queries";
import { DetalleDelAtleta } from "./DetalleDeAtleta";
import { numerarWorkouts, tablaDeDivision } from "../lib/tabla";
import { EstadoOficial } from "./LeaderboardLive";

/**
 * Tabla general por puntos.
 *
 * Se esconde SOLO cuando es redundante con el leaderboard de tiempos
 * (`LeaderboardLive`, que lee `results`): una carrera hibrida con una sola
 * prueba de circuito muestra el mismo ranking en los dos lados. Un WOD de
 * CrossFit no tiene fila en `results` —se puntua por `workout_scores`—, asi
 * que con una sola prueba esta tabla sigue siendo la UNICA que muestra algo;
 * esconderla ahi dejaba el leaderboard completamente vacio aunque el juez ya
 * hubiera cargado el resultado. `soloCircuito` es la senal que distingue los
 * dos casos (ver queries.ts).
 *
 * Refresca por polling, igual que el resto de las pantallas publicas y por la
 * misma razon: el rol anonimo no tiene permisos sobre ninguna tabla y
 * postgres_changes exige SELECT para suscribirse.
 */
const REFRESCO_MS = 8_000;

export function TablaGeneral({
  slug,
  inicial,
  categoria,
}: {
  slug: string;
  inicial: Datos;
  /**
   * Categoria CONTROLADA desde afuera, por nombre (mismo criterio que
   * `LeaderboardLive`). Con esta prop presente no se dibuja el selector
   * propio: lo maneja quien incrusta el componente.
   */
  categoria?: string;
}) {
  const [data, setData] = useState(inicial);
  const [division, setDivision] = useState<string | null>(null);
  const controlado = categoria !== undefined;
  // El detalle se despliega EN EL LUGAR, no en un modal -- mismo patron que
  // `GrillaDeAtletas` en /atletas. Un solo id abierto a la vez.
  const [expandido, setExpandido] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelado) return;
      try {
        const fresco = await getTablaGeneral(slug);
        // No se vacia la pantalla si una consulta falla: se sigue mostrando lo
        // ultimo que llego.
        if (!cancelado && fresco.divisiones.length > 0) setData(fresco);
      } catch {
        // Sin red.
      }
      if (!cancelado) timer = setTimeout(poll, REFRESCO_MS);
    };

    timer = setTimeout(poll, REFRESCO_MS);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [slug]);

  if (data.divisiones.length === 0) return null;
  if (data.cantidadDePruebas <= 1 && data.soloCircuito) return null;

  // Una categoria con un corte confirmado tiene una fila en `divisiones` POR
  // ETAPA (Stage 1, Stage 2...), pero para quien mira la pantalla es SIEMPRE
  // una sola categoria y una sola tabla -- separarla en una pestaña por etapa
  // hacia que los eliminados desaparecieran de la vista apenas se confirmaba
  // el corte, en vez de quedar marcados como tales en el mismo lugar.
  const gruposPorDivision = new Map<string, Datos["divisiones"]>();
  for (const d of data.divisiones) {
    const lista = gruposPorDivision.get(d.division.id) ?? [];
    lista.push(d);
    gruposPorDivision.set(d.division.id, lista);
  }
  const divisionesUnicas = [...gruposPorDivision.values()].map((lista) => lista[0].division);

  const divisionElegidaId = controlado
    ? (divisionesUnicas.find((d) => d.name === categoria)?.id ?? divisionesUnicas[0]?.id ?? "")
    : (divisionesUnicas.find((d) => d.id === division)?.id ?? divisionesUnicas[0]?.id ?? "");

  // Arma la tabla de la categoria elegida: filas fusionadas por equipo
  // (activo o eliminado), la union de partes acumuladas y el field vigente --
  // misma funcion que usa la pagina de resultado personal del atleta, para
  // que las dos vistas nunca puedan divergir en como deciden estas cosas.
  const tabla = tablaDeDivision(data, divisionElegidaId);
  if (!tabla) return null;
  const { division: divisionElegida, filas, partes: todasLasPartes } = tabla;

  // Numera por WORKOUT, no por parte: dos partes del mismo WOD (A/B) comparten
  // numero y se distinguen por su `label`, en vez de contar "WOD 3" y "WOD 4"
  // para lo que en la pizarra es un solo WOD.
  const numeroDeWorkout = numerarWorkouts(todasLasPartes);

  return (
    <section className="mt-10">
      {/* Sin titulo propio: la pantalla que la incrusta (panel o publica) ya
          puso "Leaderboard" arriba -- un segundo titulo "Tabla general" era el
          mismo concepto repetido dos veces en la misma pantalla.

          El indicador de oficial/no oficial es el MISMO componente que usa
          LeaderboardLive (`EstadoOficial`), reusado en vez de reescrito:
          tenia su propia pastilla con "OFICIAL"/"NO OFICIAL" en mayusculas
          literales, un texto y un estilo distintos para decir lo mismo en la
          misma pestaña. */}
      <div className="flex flex-wrap items-baseline justify-end gap-3">
        <EstadoOficial official={data.official} />
      </div>

      {/* UN COMBO, NO PESTAÑAS -- mismo criterio y mismo componente que ya
          usan LeaderboardLive y ListaDeLargada para filtrar por categoria.
          Antes esto era una fila de botones-pestaña: con seis categorias o
          mas se desborda o se vuelve horizontal-scroll, y ademas era un
          tercer widget distinto para el mismo filtro que las otras dos
          pantallas de la misma pestaña ya resuelven con un `<select>`. */}
      {!controlado && divisionesUnicas.length > 1 && (
        <label className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-neutral-500">Categoría</span>
          <Selector
            value={divisionElegida.id}
            onChange={(e) => setDivision(e.target.value)}
            className="min-w-0 flex-1 py-2 text-sm sm:flex-none"
          >
            {divisionesUnicas.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Selector>
        </label>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-neutral-500">
              <th className="w-10 py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Atleta</th>
              <th className="py-2 pr-3 font-medium">Estado</th>
              {todasLasPartes.map((p) => (
                <th
                  key={p.id}
                  title={`${p.workoutName}${p.label ? ` ${p.label}` : ""}`}
                  className="py-2 pr-3 text-right font-medium whitespace-nowrap"
                >
                  {`WOD ${numeroDeWorkout.get(p.workoutId)}`}
                  {p.label && ` ${p.label}`}
                </th>
              ))}
              <th className="py-2 pr-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, i) => {
              const abierto = expandido === fila.teamId;
              const eliminado = fila.estado === "eliminado";
              const equipo = fila.entry.team;
              return (
                <Fragment key={fila.teamId}>
                  <tr
                    className={`border-b border-neutral-900 ${
                      // Un eliminado se distingue con su propio color, por
                      // encima del rayado tenue que ya usan las filas impares
                      // -- no se puede confundir con un simple cambio de
                      // rayado, tiene que leerse como "esto ya no compite".
                      eliminado
                        ? "bg-red-500/[0.05]"
                        : i % 2 === 1
                          ? "bg-amber-500/[0.035]"
                          : ""
                    }`}
                  >
                    <td
                      className={`w-10 py-2 pr-3 font-mono tabular-nums ${
                        eliminado ? "text-neutral-600" : "text-neutral-400"
                      }`}
                    >
                      {fila.entry.position}
                      {/* Compartir posicion no es un error: el reglamento no rompe
                          los empates de la tabla general si los puestos por prueba
                          tambien empatan. Antes era un "=" gris casi invisible;
                          ahora es un color de apoyo (ambar) mas un titulo, para
                          que el organizador o el locutor sepan que no es un
                          error de la pantalla. */}
                      {fila.entry.tiedWith > 1 && (
                        <span
                          className="ml-0.5 font-semibold text-amber-400"
                          title={`Empatado con ${fila.entry.tiedWith - 1} equipo${fila.entry.tiedWith - 1 === 1 ? "" : "s"} mas`}
                        >
                          =
                        </span>
                      )}
                    </td>
                    <td className={`py-2 pr-3 ${eliminado ? "text-neutral-500" : ""}`}>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandido((actual) => (actual === fila.teamId ? null : fila.teamId))
                        }
                        className="flex w-full items-center gap-2 text-left"
                        aria-expanded={abierto}
                        title={abierto ? "Ocultar detalle" : "Ver detalle del atleta"}
                      >
                        <Icono
                          nombre="flecha"
                          className={`h-3 w-3 shrink-0 text-neutral-500 transition-transform ${
                            abierto ? "rotate-90" : ""
                          }`}
                        />
                        {/* Una bandera por integrante, en el mismo orden que
                            `athletes` -- un equipo mixto no puede mentir con
                            una sola bandera para los dos. Si no hay pais
                            cargado, no se rompe: Bandera no pinta nada. */}
                        <span className="flex shrink-0 items-center gap-1">
                          {equipo.countries.map((pais, idx) => (
                            <Bandera key={idx} codigo={pais} className="h-3 w-4 shrink-0" />
                          ))}
                        </span>
                        <span className="truncate">{equipo.name ?? equipo.athletes ?? ""}</span>
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                          eliminado
                            ? "bg-red-500/15 text-red-300"
                            : "bg-lime-400/15 text-lime-300"
                        }`}
                      >
                        {eliminado ? "Eliminado" : "Activo"}
                      </span>
                    </td>
                    {todasLasPartes.map((p) => {
                      // El resultado de un WOD sale de la entrada de la etapa
                      // A LA QUE PERTENECE ESE WOD, no de la etapa vigente del
                      // equipo: un finalista sigue mostrando lo que hizo en el
                      // WOD 1 de la clasificatoria, aunque su entrada vigente
                      // ya sea la de la final.
                      const entryDeEsaEtapa = fila.porEtapa.get(p.stage);
                      const puesto = entryDeEsaEtapa?.placements.find((x) => x.partId === p.id);
                      // "pendiente" es un equipo del padron que todavia no corrio
                      // esta prueba (ver rankPart en place.ts): mostrarle una
                      // posicion -- aunque sea la 1, empatado con todos los demas
                      // que tampoco corrieron- se lee como que ya esta ganando
                      // algo que ni empezo.
                      const sinCorrer = !puesto || puesto.status === "pendiente";
                      return (
                        <td
                          key={p.id}
                          className="py-2 pr-3 text-right font-mono tabular-nums text-neutral-400"
                        >
                          {/* Puntos redondeados SOLO para mostrar, igual que
                              `displayPoints`: `puesto.points` sigue intacto en el
                              motor. */}
                          {sinCorrer ? "—" : `${puesto.position}º/${Math.round(puesto.points)}`}
                        </td>
                      );
                    })}
                    <td className="py-2 pr-3 text-right font-mono tabular-nums font-semibold">
                      {/* Redondeado SOLO para mostrar: `totalPoints` (3 decimales)
                          sigue siendo lo que ordena y desempata. Para un
                          eliminado es el total de la etapa en la que quedo
                          afuera -- su ultimo resultado oficial. */}
                      {fila.entry.displayPoints}
                    </td>
                  </tr>

                  {/* El detalle se despliega EN EL LUGAR, no en un modal --
                      mismo patron que GrillaDeAtletas en /atletas. */}
                  {abierto && (
                    <tr className="border-b border-neutral-900">
                      <td colSpan={4 + todasLasPartes.length} className="bg-neutral-900/40 p-4">
                        <DetalleDelAtleta
                          fila={fila}
                          parts={todasLasPartes}
                          fieldSize={tabla.camposPorEtapa.get(fila.etapaVigente) ?? filas.length}
                          division={divisionElegida}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
