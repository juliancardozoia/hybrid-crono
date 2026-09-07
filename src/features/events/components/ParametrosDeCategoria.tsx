"use client";

import { useActionState, useState, useTransition } from "react";
import {
  agregarMovimientoDeCategoria,
  editarMovimientoDeCategoria,
  guardarCategoria,
  moverMovimientoDeCategoria,
  quitarMovimientoDeCategoria,
  type FormState,
} from "@/features/events/config/categorias";
import { desdeKilos } from "@/shared/unidades/carga";
import { Modal, BotonesDeModal } from "@/shared/components/Modal";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import { useNotificaciones } from "@/shared/components/Notificaciones";
import { Selector } from "@/shared/components/Selector";
import type { CategoriaConfigurada } from "@/features/events/config/queries";
import type {
  CourseTemplate,
  EventFormat,
  GenderRule,
} from "@/lib/supabase/types";

const inicial: FormState = { error: null };

const campo =
  "w-full rounded-xl border border-neutral-700 bg-transparent px-3 py-2.5 text-sm outline-none transition-colors focus:border-lime-400";
const selector = "w-full py-2.5 text-sm";

const SEXO: Record<string, string> = {
  male: "Masculino",
  female: "Femenino",
  mixed: "Mixta",
  any: "Abierta",
};

export interface Segmento {
  id: string;
  name: string;
  kind: string;
  order_index: number;
}

export interface MovimientoDelCatalogo {
  id: string;
  name: string;
  category: string;
  allows_load: boolean;
}

/**
 * Una FILA de la grilla de categorias, con un modal para editar todo.
 *
 * ANTES ERA UN ACORDEON. Con cuatro o cinco categorias andaba bien, pero una
 * competencia con diez o mas —nada raro en un Hyrox grande— convertia la
 * pantalla en una lista de diez acordeones donde encontrar "Elite Femenino"
 * era hacer scroll. La fila resuelve "¿cuales tengo y que les falta?" de un
 * vistazo, y el modal resuelve "quiero tocar esta" sin que abrir una empuje a
 * las demas fuera de la pantalla.
 *
 * UN SOLO Guardar/Cancelar, no uno por seccion: `guardarCategoria` hace las
 * DOS escrituras (datos basicos y cupo/puntuacion) en una sola accion —
 * ver `BotonesDeModal`.
 *
 * PARA CARRERA HIBRIDA NO HAY "Parametros del circuito". El circuito se crea
 * con una configuracion —estaciones, distancias— y esa es: no se ajusta por
 * categoria desde aca. Solo CrossFit ofrece una seccion mas, "Movimientos y
 * pesos", porque ahi si hace falta declarar el peso por categoria.
 *
 * ELIMINAR SOLO SE OFRECE CON `equiposInscritos === 0`. `teams.division_id` es
 * `on delete restrict` — Postgres ya lo bloquearia — pero ofrecer un boton que
 * va a fallar sin decir por que es peor que no ofrecerlo: se ve la razon
 * (cuantos equipos hay) en vez de un error generico.
 */
export function FilaDeCategoria({
  eventId,
  categoria,
  formato,
  segmentos,
  catalogo,
  templates,
  alQuitar,
}: {
  eventId: string;
  categoria: CategoriaConfigurada;
  formato: EventFormat;
  segmentos: Segmento[];
  catalogo: MovimientoDelCatalogo[];
  templates: CourseTemplate[];
  alQuitar?: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [editar, setEditar] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const esCrossfit = formato !== "carrera_hibrida";
  const esHibrida = !esCrossfit;
  const formId = `categoria-${categoria.id}`;

  const [state, formAction, pending] = useActionState(
    guardarCategoria,
    inicial,
  );

  return (
    <tr className="border-b border-neutral-900 last:border-0">
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={() => setEditar(true)}
          className="text-left font-medium hover:text-lime-300"
        >
          {categoria.name}
        </button>
      </td>
      <td className="px-3 py-3 text-neutral-400">
        {categoria.teamSize === 1
          ? "Individual"
          : `Equipos de ${categoria.teamSize}`}
      </td>
      <td className="px-3 py-3 text-neutral-400">
        {SEXO[categoria.genderRule] ?? categoria.genderRule}
      </td>
      <td className="px-3 py-3 text-neutral-400">
        {categoria.capacity === null ? "Ilimitado" : categoria.capacity}
      </td>
      <td className="px-3 py-3 text-neutral-400">
        {esHibrida ? (
          categoria.courseTemplateId ? (
            segmentos.length > 0 ? (
              (templates.find((t) => t.id === categoria.courseTemplateId)
                ?.name ?? "Circuito")
            ) : (
              <span className="text-amber-400">Circuito sin segmentos</span>
            )
          ) : (
            <span className="text-amber-400">Sin circuito</span>
          )
        ) : categoria.movimientos.length > 0 ? (
          `${categoria.movimientos.length} movimiento${categoria.movimientos.length === 1 ? "" : "s"}`
        ) : (
          <span className="text-neutral-600">Sin movimientos</span>
        )}
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={() => setEditar(true)}
          className="rounded-lg px-2 py-1 text-sm text-lime-400 hover:bg-neutral-900"
        >
          Editar
        </button>
        {alQuitar &&
          (categoria.equiposInscritos > 0 ? (
            <span
              className="ml-1 px-2 py-1 text-xs text-neutral-600"
              title="No se puede eliminar: ya tiene equipos inscritos"
            >
              {categoria.equiposInscritos} equipo(s)
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmar(true)}
              className="ml-1 rounded-lg px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-900 hover:text-red-400"
            >
              Eliminar
            </button>
          ))}

        <Modal
          abierto={editar}
          alCerrar={() => setEditar(false)}
          titulo={categoria.name}
          ancho="max-w-2xl"
        >
          {/* `key` remonta el formulario cada vez que se abre: sin esto, un
              intento a medias que se cancelo dejaba los campos con lo ultimo
              escrito la proxima vez que se abriera el modal. */}
          <form
            key={editar ? "abierto" : "cerrado"}
            id={formId}
            action={formAction}
            className="flex flex-col gap-7 text-left"
          >
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="divisionId" value={categoria.id} />
            <input
              type="hidden"
              name="esEquipo"
              value={categoria.teamSize > 1 ? "1" : "0"}
            />

            <CamposBasicos
              categoria={categoria}
              templates={templates}
              esHibrida={esHibrida}
            />

            <div className="border-t border-neutral-800 pt-6">
              <CamposCupoYPuntuacion
                categoria={categoria}
                mostrarTabla={esCrossfit}
              />
            </div>

            {state.error && (
              <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                {state.error}
              </p>
            )}
          </form>

          {/* Los movimientos quedan FUERA del formulario grande: agregar uno
              es una accion propia ("Agregar", no "Guardar") — la misma logica
              que ya usan los codigos de descuento o "Nueva categoría": una
              lista que sigue creciendo despues, no un campo que este paso
              tenga que confirmar. */}
          {esCrossfit && (
            <div className="mt-7 border-t border-neutral-800 pt-6 text-left">
              <Movimientos
                eventId={eventId}
                categoria={categoria}
                catalogo={catalogo}
              />
            </div>
          )}

          <BotonesDeModal
            cancelar={() => setEditar(false)}
            guardando={pending}
            error={state.error}
            guardarId={formId}
            mensajeDeCarga="Guardando la categoría…"
          />
        </Modal>

        {alQuitar && (
          <Modal
            abierto={confirmar}
            alCerrar={() => setConfirmar(false)}
            titulo="Eliminar categoría"
            ancho="max-w-sm"
          >
            <div className="text-left">
              <p className="text-sm text-neutral-300">
                ¿Eliminar <span className="font-medium">{categoria.name}</span>?
                Esta acción no se puede deshacer.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmar(false)}
                  className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900"
                >
                  Cancelar
                </button>
                <FormularioDeEstado
                  accion={alQuitar}
                  estadoInicial={{ error: null }}
                  etiqueta="Eliminar"
                  mensajeDeCarga="Eliminando la categoría…"
                  className="rounded-xl bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20"
                />
              </div>
            </div>
          </Modal>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------

/**
 * Nombre, integrantes, sexo, edad y circuito. Campos puros: viven ADENTRO del
 * `<form>` de `FilaDeCategoria`, sin `useActionState` propio — el envio es
 * unico para todo el modal.
 */
function CamposBasicos({
  categoria,
  templates,
  esHibrida,
}: {
  categoria: CategoriaConfigurada;
  templates: CourseTemplate[];
  esHibrida: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Nombre</span>
        <input
          name="name"
          required
          minLength={2}
          defaultValue={categoria.name}
          className={campo}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Integrantes</span>
          <Selector
            name="teamSize"
            defaultValue={String(categoria.teamSize)}
            className={selector}
          >
            <option value="1">1 — individual</option>
            <option value="2">2 — parejas</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </Selector>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Sexo</span>
          <Selector
            name="genderRule"
            defaultValue={categoria.genderRule as GenderRule}
            className={selector}
          >
            <option value="any">Abierta</option>
            <option value="male">Masculino</option>
            <option value="female">Femenino</option>
            <option value="mixed">Mixta (uno de cada sexo)</option>
          </Selector>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Edad mínima</span>
          <input
            name="ageMin"
            type="number"
            defaultValue={categoria.ageMin ?? ""}
            placeholder="Sin mínimo"
            className={campo}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Edad máxima</span>
          <input
            name="ageMax"
            type="number"
            defaultValue={categoria.ageMax ?? ""}
            placeholder="Sin máximo"
            className={campo}
          />
        </label>
      </div>

      {esHibrida && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Circuito</span>
          <Selector
            name="courseTemplateId"
            defaultValue={categoria.courseTemplateId ?? ""}
            className={selector}
          >
            <option value="">Ninguno</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Selector>
          <span className="text-xs text-neutral-600">
            Las estaciones y distancias se configuran en Circuito, no por
            categoría.
          </span>
        </label>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CamposCupoYPuntuacion({
  categoria,
  mostrarTabla,
}: {
  categoria: CategoriaConfigurada;
  mostrarTabla: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Límite de registros</span>
          <input
            name="capacity"
            type="number"
            min={1}
            defaultValue={categoria.capacity ?? ""}
            placeholder="Sin límite"
            className={campo}
          />
          <span className="text-xs text-neutral-600">
            Vacío = ilimitado. Cuenta las inscripciones confirmadas y las que
            esperan pago.
          </span>
        </label>

        {/* Ya no hay sistema de puntuación que elegir: hay UNO y se adapta
            solo al tamaño de la categoría. Se muestra igual —en vez de no
            decir nada— porque el organizador necesita saber con qué se van a
            repartir los puntos, y la tabla concreta se previsualiza en
            Puntuación. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Puntuación</span>
          <p className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-3 py-2.5 text-sm text-neutral-400">
            {mostrarTabla ? "Games 2026 Dynamic" : "Por tiempo, menor gana"}
          </p>
          <span className="text-xs text-neutral-600">
            {mostrarTabla
              ? "El 1.º saca 100 y el último 0, con la curva ajustada a los atletas de esta categoría."
              : "Es una carrera: el resultado es el tiempo del circuito."}
          </span>
        </div>
      </div>

      {/* Solo si compite mas de una persona: en individual no hay integrante
          que cambiar, y el campo pedia una decision inexistente. Estaba en la
          pantalla de cobros, donde no tenia nada que ver con cobrar. */}
      {categoria.teamSize > 1 && (
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="permiteCambios"
            defaultChecked={categoria.permiteCambios}
            className="mt-0.5 accent-lime-400"
          />
          <span>
            Permitir cambiar integrantes después de confirmar
            <span className="block text-xs text-neutral-600">
              Los datos del integrante que sale se borran: no son suyos.
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Los movimientos de la categoria, con su peso.
 *
 * ES EL ESTANDAR DECLARADO, no lo que se hace en una prueba concreta. Es lo que
 * el organizador publica meses antes —"Elite Masculino: Thruster 43 kg"— y lo
 * que un atleta mira para decidir en cual anotarse. Existe antes de que haya una
 * sola prueba cargada.
 *
 * KILOS O LIBRAS a eleccion: se guarda en kilos y se recuerda la unidad, asi
 * quien programo "95 lb" lo ve de vuelta como 95 y no como 43,09.
 *
 * Tiene su PROPIO formulario y su propio "Agregar": es una lista a la que se
 * suma un item a la vez, no un campo que el Guardar general del modal tenga
 * que confirmar.
 */
function Movimientos({
  eventId,
  categoria,
  catalogo,
}: {
  eventId: string;
  categoria: CategoriaConfigurada;
  catalogo: MovimientoDelCatalogo[];
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h4 className="font-semibold">Movimientos y pesos</h4>
        <p className="mt-0.5 text-sm text-neutral-500">
          Los estándares de esta categoría. Es lo que un atleta mira para
          decidir si se anota, y se publica en la ficha de la competencia
          aunque todavía no haya ninguna prueba cargada.
        </p>
      </div>

      {categoria.movimientos.length > 0 && (
        <ul className="flex flex-col gap-2">
          {categoria.movimientos.map((m, i) => (
            <FilaDeMovimiento
              key={m.id}
              eventId={eventId}
              movimiento={m}
              primero={i === 0}
              ultimo={i === categoria.movimientos.length - 1}
            />
          ))}
        </ul>
      )}

      {/* `key` por cantidad de movimientos: cuando un alta sale bien, el
          servidor revalida, la lista crece y el formulario se REMONTA limpio
          —selector incluido— sin que haga falta sincronizar estado con el
          reset nativo de React 19. Si el alta falla, la cantidad no cambia y
          lo escrito sigue ahí. */}
      <AltaDeMovimiento
        key={categoria.movimientos.length}
        eventId={eventId}
        divisionId={categoria.id}
        catalogo={catalogo}
      />
    </section>
  );
}

function AltaDeMovimiento({
  eventId,
  divisionId,
  catalogo,
}: {
  eventId: string;
  divisionId: string;
  catalogo: MovimientoDelCatalogo[];
}) {
  const [state, formAction] = useActionState(
    agregarMovimientoDeCategoria,
    inicial,
  );
  const [otro, setOtro] = useState(false);
  const [elegido, setElegido] = useState("");

  // El campo de peso solo aparece si el movimiento LO ADMITE. `allows_load`
  // viene del catálogo y hasta ahora se recibía y se descartaba: pedirle un
  // peso a un burpee o a un double-under es ofrecer un dato que no existe.
  // Uno escrito a mano sí lo ofrece: de ese no sabemos nada.
  const permiteCarga =
    otro || catalogo.find((m) => m.id === elegido)?.allows_load === true;

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="divisionId" value={divisionId} />

        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
          {otro ? (
            <input
              name="customName"
              placeholder="Nombre del movimiento"
              className={campo}
              autoFocus
            />
          ) : (
            <Selector
              name="movementId"
              value={elegido}
              onChange={(e) => setElegido(e.target.value)}
              className={selector}
            >
              <option value="">Elige un movimiento…</option>
              {catalogo.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Selector>
          )}

          {permiteCarga ? (
            <div className="flex gap-2">
              <input
                name="load"
                type="text"
                inputMode="decimal"
                placeholder="Peso"
                className={campo}
              />
              <Selector
                name="loadUnit"
                defaultValue="kg"
                className={`${selector} w-20`}
              >
                <option value="kg">kg</option>
                <option value="lb">lb</option>
              </Selector>
            </div>
          ) : (
            <span className="self-center text-sm text-neutral-600">
              {elegido ? "Sin peso" : ""}
            </span>
          )}

          <AgregarMovimiento />
        </div>

        <input
          name="spec"
          placeholder="Detalle opcional: altura del cajón, tipo de agarre…"
          className={campo}
        />

        {state.error && (
          <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {state.error}
          </p>
        )}
      </form>

      {/* El catálogo tiene 148 movimientos y aun así falta alguno: cada box
          inventa el suyo. Sin esta salida, el organizador escribe el peso en
          otro lado y la categoría queda incompleta. */}
      <button
        type="button"
        onClick={() => setOtro((o) => !o)}
        className="w-fit text-xs text-neutral-500 hover:text-neutral-300"
      >
        {otro ? "← Elegir del catálogo" : "¿No está en la lista? Escríbelo"}
      </button>
    </div>
  );
}

/**
 * Un movimiento ya cargado: se corrige en el lugar y se mueve de posición.
 *
 * ANTES ERA UN CHIP CON UNA ✕. Cambiar "43 kg" por "45 kg" obligaba a borrar la
 * fila y volver a buscar el movimiento entre los 148 del catálogo, y el orden
 * en que se publicaban era el de carga y no había forma de tocarlo.
 *
 * NO VA DENTRO DE UN `<form action={...}>`, y no es un detalle: React 19 llama
 * al `form.reset()` nativo al terminar una acción, y estos campos tienen que
 * CONSERVAR lo que se acaba de guardar. Es exactamente el caso de `HeatCard`:
 * la acción se invoca a mano dentro de `startTransition`.
 *
 * El botón aparece solo si algo cambió: tres campos por movimiento con un
 * botón siempre encendido al lado convierten la lista en una pared de botones
 * idénticos donde no se distingue cuál está pendiente.
 *
 * SE LLAMA "Actualizar", NO "Guardar". El modal ya tiene su Guardar —uno solo,
 * el de la categoría— y un segundo botón con el mismo nombre haría dudar de
 * cuál confirma qué. Es la misma distinción que ya vale para "Agregar":
 * corregir un ítem de una lista no es confirmar el formulario.
 */
function FilaDeMovimiento({
  eventId,
  movimiento,
  primero,
  ultimo,
}: {
  eventId: string;
  movimiento: CategoriaConfigurada["movimientos"][number];
  primero: boolean;
  ultimo: boolean;
}) {
  const original =
    movimiento.loadKg === null
      ? ""
      : String(desdeKilos(movimiento.loadKg, movimiento.loadUnit));

  const [carga, setCarga] = useState(original);
  const [unidad, setUnidad] = useState<"kg" | "lb">(movimiento.loadUnit);
  const [spec, setSpec] = useState(movimiento.spec ?? "");
  const [pendiente, startTransition] = useTransition();
  const { error: avisarError } = useNotificaciones();

  const sucio =
    carga !== original ||
    unidad !== movimiento.loadUnit ||
    spec !== (movimiento.spec ?? "");

  const correr = (accion: () => Promise<FormState>) =>
    startTransition(async () => {
      const r = await accion();
      if (r.error) avisarError(r.error);
    });

  const guardar = () => {
    const datos = new FormData();
    datos.set("eventId", eventId);
    datos.set("movimientoId", movimiento.id);
    datos.set("load", carga);
    datos.set("loadUnit", unidad);
    datos.set("spec", spec);
    correr(() => editarMovimientoDeCategoria(inicial, datos));
  };

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm">
      <span className="min-w-32 flex-1 font-medium">{movimiento.nombre}</span>

      <input
        value={carga}
        onChange={(e) => setCarga(e.target.value)}
        type="text"
        inputMode="decimal"
        placeholder="Sin peso"
        className={`${campo} w-24`}
      />
      <Selector
        value={unidad}
        onChange={(e) => setUnidad(e.target.value as "kg" | "lb")}
        className="w-20 py-2 text-sm"
      >
        <option value="kg">kg</option>
        <option value="lb">lb</option>
      </Selector>
      <input
        value={spec}
        onChange={(e) => setSpec(e.target.value)}
        placeholder="Detalle"
        className={`${campo} w-40`}
      />

      {sucio && (
        <button
          type="button"
          onClick={guardar}
          disabled={pendiente}
          className="rounded-xl bg-lime-400 px-3 py-2 text-xs font-semibold text-lime-950 disabled:opacity-60"
        >
          {pendiente ? "Guardando…" : "Actualizar"}
        </button>
      )}

      <div className="flex items-center">
        <button
          type="button"
          disabled={primero || pendiente}
          onClick={() =>
            correr(() =>
              moverMovimientoDeCategoria(eventId, movimiento.id, "arriba"),
            )
          }
          className="px-1.5 text-neutral-600 hover:text-neutral-300 disabled:opacity-30"
          title="Subir"
        >
          ▲
        </button>
        <button
          type="button"
          disabled={ultimo || pendiente}
          onClick={() =>
            correr(() =>
              moverMovimientoDeCategoria(eventId, movimiento.id, "abajo"),
            )
          }
          className="px-1.5 text-neutral-600 hover:text-neutral-300 disabled:opacity-30"
          title="Bajar"
        >
          ▼
        </button>
        <button
          type="button"
          disabled={pendiente}
          onClick={() =>
            correr(() => quitarMovimientoDeCategoria(eventId, movimiento.id))
          }
          className="px-1.5 text-neutral-600 hover:text-red-400 disabled:opacity-30"
          title="Quitar"
        >
          ✕
        </button>
      </div>
    </li>
  );
}

function AgregarMovimiento() {
  return (
    <BotonDeEnvio
      pendienteTexto="Agregando…"
      mensajeDeCarga="Agregando el movimiento…"
      className="w-fit rounded-xl border border-neutral-700 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-900 disabled:opacity-60"
    >
      Agregar
    </BotonDeEnvio>
  );
}
