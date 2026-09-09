"use client";

import { useActionState, useState, useTransition } from "react";
import {
  agregarMovimientoDeCategoria,
  guardarCategoria,
  moverMovimientoDeCategoria,
  quitarMovimientoDeCategoria,
  type FormState,
} from "@/features/events/config/categorias";
import { desdeKilos } from "@/shared/unidades/carga";
import { Modal, BotonesDeModal } from "@/shared/components/Modal";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import { MensajeDeError } from "@/shared/components/MensajeDeError";
import { Boton, claseDeBoton } from "@/shared/components/Boton";
import { useNotificaciones } from "@/shared/components/Notificaciones";
import { Selector } from "@/shared/components/Selector";
import { CampoBase, CLASE_INPUT, Field, Select } from "@/shared/components/SimpleForm";
import { Interruptor } from "@/shared/components/Interruptor";
import type { CategoriaConfigurada } from "@/features/events/config/queries";
import type {
  CourseTemplate,
  EventFormat,
  GenderRule,
  LoadUnit,
} from "@/lib/supabase/types";

const inicial: FormState = { error: null };

// SIN `py-*` de base, a proposito: la altura la pone `h-11` donde se usa
// cada uno. Sumar una utilidad de padding vertical fija (`py-3`) Y una
// altura fija en el mismo elemento las deja compitiendo por la misma
// propiedad —cual "gana" depende del orden en que Tailwind las genero, no
// del orden en el string— y fue justo lo que hizo que un campo terminara mas
// alto o mas ancho que el control de al lado.
//
// `campoAngosto` es SIN `w-full`: es para un numero de ancho fijo (el peso);
// `campoFlexible` SI lo trae, para un campo que ocupa el resto de la fila
// (el nombre de un movimiento escrito a mano).
// El foco es el mismo anillo lima que ya usan `CLASE_INPUT` (Field/Select del
// resto del modal) y `Selector`: sin `focus-visible:ring-*`, estos dos
// campos solo cambiaban el color del borde al enfocarse, un highlight mas
// discreto que el resto — la inconsistencia se notaba tabulando entre
// campos.
const FOCO =
  "focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950";
const campoAngosto = `rounded-xl border border-neutral-700 bg-transparent px-3 text-sm outline-none transition-colors ${FOCO} text-right`;
const campoFlexible = `w-full rounded-xl border border-neutral-700 bg-transparent px-3 text-sm outline-none transition-colors ${FOCO}`;

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
            className="flex flex-col gap-4 text-left"
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

            <div className="border-t border-neutral-800 pt-4">
              <CamposCupoYPuntuacion
                categoria={categoria}
                mostrarTabla={esCrossfit}
              />
            </div>

            {state.error && (
              <MensajeDeError>{state.error}</MensajeDeError>
            )}
          </form>

          {/* Los movimientos quedan FUERA del formulario grande: agregar uno
              es una accion propia ("Agregar", no "Guardar") — la misma logica
              que ya usan los codigos de descuento o "Nueva categoría": una
              lista que sigue creciendo despues, no un campo que este paso
              tenga que confirmar. */}
          {esCrossfit && (
            <div className="mt-6 border-t border-neutral-800 pt-4 text-left">
              <Movimientos
                eventId={eventId}
                categoria={categoria}
                catalogo={catalogo}
                formId={formId}
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
                <Boton variante="secondary" compacto onClick={() => setConfirmar(false)}>
                  Cancelar
                </Boton>
                <FormularioDeEstado
                  accion={alQuitar}
                  estadoInicial={{ error: null }}
                  etiqueta="Eliminar"
                  mensajeDeCarga="Eliminando la categoría…"
                  className={claseDeBoton({ variante: "destructive", compacto: true })}
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
    <div className="flex flex-col gap-4">
      <Field
        label="Nombre"
        name="name"
        required
        minLength={2}
        defaultValue={categoria.name}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Integrantes"
          name="teamSize"
          defaultValue={String(categoria.teamSize)}
          options={[
            { value: "1", label: "1 — individual" },
            { value: "2", label: "2 — parejas" },
            { value: "3", label: "3" },
            { value: "4", label: "4" },
          ]}
        />

        <Select
          label="Sexo"
          name="genderRule"
          defaultValue={categoria.genderRule as GenderRule}
          options={[
            { value: "any", label: "Abierta" },
            { value: "male", label: "Masculino" },
            { value: "female", label: "Femenino" },
            { value: "mixed", label: "Mixta (uno de cada sexo)" },
          ]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Edad mínima"
          name="ageMin"
          type="number"
          defaultValue={categoria.ageMin ?? ""}
          placeholder="Sin mínimo"
        />
        <Field
          label="Edad máxima"
          name="ageMax"
          type="number"
          defaultValue={categoria.ageMax ?? ""}
          placeholder="Sin máximo"
        />
      </div>

      {esHibrida && (
        <Select
          label="Circuito"
          name="courseTemplateId"
          defaultValue={categoria.courseTemplateId ?? ""}
          options={[
            { value: "", label: "Ninguno" },
            ...templates.map((t) => ({ value: t.id, label: t.name })),
          ]}
          ayuda="Las estaciones y distancias se configuran en Circuito, no por categoría."
        />
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
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Límite de registros"
          name="capacity"
          type="number"
          min={1}
          defaultValue={categoria.capacity ?? ""}
          placeholder="Sin límite"
          ayuda="Vacío = ilimitado."
        />

        {/* Ya no hay sistema de puntuación que elegir: hay UNO y se adapta
            solo al tamaño de la categoría. Se muestra igual —en vez de no
            decir nada— porque el organizador necesita saber con qué se van a
            repartir los puntos, y la tabla concreta se previsualiza en
            Puntuación. */}
        <CampoBase
          label="Puntuación"
          ayuda={
            mostrarTabla
              ? "El 1.º saca 100 y el último 0."
              : "Es una carrera: el resultado es el tiempo del circuito."
          }
        >
          <p
            className={`${CLASE_INPUT} border-neutral-800 bg-neutral-900/50 text-sm text-neutral-400`}
          >
            {mostrarTabla ? "Games 2026 Dynamic" : "Por tiempo, menor gana"}
          </p>
        </CampoBase>
      </div>

      {/* Solo si compite mas de una persona: en individual no hay integrante
          que cambiar, y el campo pedia una decision inexistente. Estaba en la
          pantalla de cobros, donde no tenia nada que ver con cobrar.

          Antes era un checkbox suelto sin tarjeta, al lado del `Interruptor`
          de mas abajo (mismo formulario, mismo tipo de permiso booleano, dos
          estilos distintos). `Interruptor` ya resuelve exactamente esto. */}
      {categoria.teamSize > 1 && (
        <Interruptor
          name="permiteCambios"
          titulo="Permitir cambiar integrantes después de confirmar"
          detalle="Los datos del integrante que sale se borran: no son suyos."
          defaultActivo={categoria.permiteCambios}
        />
      )}

      {/* A diferencia del anterior, esto vale igual para categorias
          individuales: mover a alguien de categoria no depende de cuantos
          integrantes tenga. Apagado por defecto porque un equipo ya asignado
          a un heat puede quedar apuntando a una categoria que ya no es la
          suya — es una puerta que el organizador abre a propósito. */}
      <Interruptor
        name="permiteCambioCategoria"
        titulo="Habilitar cambio de categoría"
        defaultActivo={categoria.permiteCambioCategoria}
      />
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
 * UNA SOLA UNIDAD PARA TODA LA CATEGORIA. Antes habia un selector de kg/lb
 * POR MOVIMIENTO —en el alta y en cada fila, hasta tres controles distintos
 * a la vista— cuando en la practica nadie mezcla "Thruster 43 kg" con
 * "Deadlift 315 lb" en el mismo estandar: los pesos de un reglamento se
 * escriben todos en la misma unidad. El selector de arriba es EL UNICO.
 *
 * NO LLAMA A NINGUNA ACCION AL CAMBIAR. Es estado local nomas —"kg"/"lb"
 * pendiente, todavia sin guardar— que decide en que unidad se MUESTRAN y se
 * EDITAN los pesos; el valor viaja al servidor recien cuando se aprieta el
 * "Guardar" del modal, como `unidadPeso` del mismo `<form>`. Antes disparaba
 * su propia accion contra la base en cada cambio (`cambiarUnidadDeMovimientos`),
 * y el select controlado por esa respuesta asincrona era justamente lo que se
 * sentia "trabado": elegir "lb" y ver el control quedarse en "kg" hasta que el
 * viaje al servidor terminara.
 *
 * Los pesos de cada fila (`carga_<id>` en `FilaDeMovimiento`) y esta misma
 * unidad (`unidadPeso`) viven FUERA del `<form>` grande pero apuntan a el con
 * el atributo HTML `form={formId}` — el mismo truco que ya usa
 * `BotonesDeModal` para vivir afuera del `<form>` y que igual se envie con
 * el. Asi el Guardar de arriba guarda TODO de una vez, sin un "Actualizar"
 * por fila.
 */
function Movimientos({
  eventId,
  categoria,
  catalogo,
  formId,
}: {
  eventId: string;
  categoria: CategoriaConfigurada;
  catalogo: MovimientoDelCatalogo[];
  formId: string;
}) {
  const [unidad, setUnidad] = useState<LoadUnit>(
    categoria.movimientos[0]?.loadUnit ?? "kg",
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold">Parámetros</h4>
          <p className="mt-0.5 text-sm text-neutral-500">
            Parámetros de esta categoría.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-400">
          Unidad de peso
          <Selector
            name="unidadPeso"
            form={formId}
            value={unidad}
            onChange={(e) => setUnidad(e.target.value as LoadUnit)}
            className="h-11 w-20"
          >
            <option value="kg">kg</option>
            <option value="lb">lb</option>
          </Selector>
        </label>
      </div>

      {categoria.movimientos.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {categoria.movimientos.map((m, i) => (
            <FilaDeMovimiento
              // La unidad va en la key: al cambiarla arriba, cada fila se
              // REMONTA con el valor ya convertido a la unidad pendiente, en
              // vez de quedarse con el numero que tenia al montarse.
              key={`${m.id}-${unidad}`}
              eventId={eventId}
              movimiento={m}
              unidad={unidad}
              formId={formId}
              primero={i === 0}
              ultimo={i === categoria.movimientos.length - 1}
            />
          ))}
        </ul>
      )}

      {/* `key` por cantidad de movimientos: cuando un alta sale bien, el
          servidor revalida, la lista crece y el formulario se REMONTA limpio
          —selector de movimiento incluido— sin que haga falta sincronizar
          estado con el reset nativo de React 19. Si el alta falla, la
          cantidad no cambia y lo escrito sigue ahí. */}
      <AltaDeMovimiento
        key={categoria.movimientos.length}
        eventId={eventId}
        divisionId={categoria.id}
        catalogo={catalogo}
        unidad={unidad}
      />
    </section>
  );
}

function AltaDeMovimiento({
  eventId,
  divisionId,
  catalogo,
  unidad,
}: {
  eventId: string;
  divisionId: string;
  catalogo: MovimientoDelCatalogo[];
  unidad: LoadUnit;
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
        <input type="hidden" name="loadUnit" value={unidad} />

        {/* Los tres controles llevan `h-11` explicito, la misma altura fija
            que ya usan los botones icon-only del resto de la app: fijar la
            altura, en vez de dejar que la ponga el padding de cada uno, es
            lo que garantiza que select/input/boton midan exactamente lo
            mismo sin depender de que sus paddings coincidan por casualidad. */}
        <div className="flex flex-wrap items-center gap-2">
          {otro ? (
            <input
              name="customName"
              placeholder="Nombre del movimiento"
              className={`${campoFlexible} h-11 min-w-40 flex-1`}
              autoFocus
            />
          ) : (
            <Selector
              name="movementId"
              value={elegido}
              onChange={(e) => setElegido(e.target.value)}
              className="h-11 min-w-40 flex-1"
            >
              <option value="">Elige un movimiento…</option>
              {catalogo.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Selector>
          )}

          {permiteCarga && (
            <div className="flex items-center gap-1.5">
              <input
                name="load"
                type="text"
                inputMode="decimal"
                placeholder="Peso"
                className={`${campoAngosto} h-11 w-24`}
              />
              {/* Mismo sufijo que ya usa cada fila ya cargada
                  (`FilaDeMovimiento`): la unidad se ve al lado del numero,
                  no escondida en un placeholder que desaparece al escribir. */}
              <span className="text-xs text-neutral-500">{unidad}</span>
            </div>
          )}

          <AgregarMovimiento />
        </div>

        {state.error && (
          <MensajeDeError>{state.error}</MensajeDeError>
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
 * Un movimiento ya cargado: su peso se corrige en el lugar y se mueve de
 * posición.
 *
 * ANTES ERA UN CHIP CON UNA ✕. Cambiar "43 kg" por "45 kg" obligaba a borrar la
 * fila y volver a buscar el movimiento entre los 148 del catálogo, y el orden
 * en que se publicaban era el de carga y no había forma de tocarlo.
 *
 * EL PESO YA NO TIENE SU PROPIO "Actualizar". Tenia su propia accion y su
 * propio boton por fila —una pared de guardados sueltos, cada uno con su
 * propio viaje al servidor—, y con varios movimientos cargados eso era mas
 * clicks que categoria completa. El campo `carga_<id>` vive fuera del
 * `<form>` grande pero le apunta con `form={formId}`, asi que entra en el
 * MISMO Guardar del modal, junto con nombre, cupo y todo lo demas.
 *
 * SUBIR/BAJAR Y QUITAR SIGUEN SIENDO INMEDIATOS: son operaciones de LISTA
 * (reordenar, eliminar), no un dato que haya que confirmar con el Guardar —
 * la misma distincion que ya vale para "Agregar" en `AltaDeMovimiento`.
 */
function FilaDeMovimiento({
  eventId,
  movimiento,
  unidad,
  formId,
  primero,
  ultimo,
}: {
  eventId: string;
  movimiento: CategoriaConfigurada["movimientos"][number];
  unidad: LoadUnit;
  formId: string;
  primero: boolean;
  ultimo: boolean;
}) {
  // Convertido a la unidad PENDIENTE (la elegida arriba, todavia sin
  // guardar), no a la que el movimiento tenia guardada: si el organizador
  // cambia el selector de "kg" a "lb", esto tiene que mostrarse ya en libras
  // para que lo que se ve sea lo que se va a guardar al apretar Guardar.
  const original =
    movimiento.loadKg === null ? "" : String(desdeKilos(movimiento.loadKg, unidad));

  const [pendiente, startTransition] = useTransition();
  const { error: avisarError } = useNotificaciones();

  const correr = (accion: () => Promise<FormState>) =>
    startTransition(async () => {
      const r = await accion();
      if (r.error) avisarError(r.error);
    });

  return (
    <li className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-sm">
      <span className="min-w-32 flex-1 truncate font-medium">
        {movimiento.nombre}
      </span>

      <div className="flex items-center gap-1.5">
        <input
          name={`carga_${movimiento.id}`}
          form={formId}
          defaultValue={original}
          type="text"
          inputMode="decimal"
          placeholder="Sin peso"
          className={`${campoAngosto} h-9 w-20`}
        />
        <span className="w-6 text-xs text-neutral-500">{unidad}</span>
      </div>

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
      className={`${claseDeBoton({ variante: "secondary", compacto: true })} h-11`}
    >
      Agregar
    </BotonDeEnvio>
  );
}
