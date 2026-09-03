"use client";

import { useActionState, useState } from "react";
import { invitarColaborador, type FormState } from "../actions";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";

const inicial: FormState = { error: null };

export interface DivisionParaAlcance {
  id: string;
  name: string;
}

/**
 * Alta de colaborador.
 *
 * SE PREGUNTA QUE PUEDE HACER, NO QUE ROL TIENE. Un desplegable con cinco roles
 * —manager, verifier, scorekeeper, registrar, judge— obliga al organizador a
 * aprender un vocabulario nuestro y a adivinar cual incluye que. Aca marca las
 * cuatro cosas concretas que va a hacer la persona y el rol lo deduce el codigo.
 *
 * ADMINISTRADOR APAGA EL RESTO, y se ve que lo apaga. Un administrador con una
 * casilla desmarcada seria un administrador que no puede hacer algo, y eso no es
 * un administrador: al marcarlo, los permisos individuales y el alcance por
 * categoria quedan deshabilitados y atenuados en pantalla. Esconderlos seria
 * peor — el organizador no sabria que existen.
 *
 * SIN NINGUN PERMISO NO ES UN COLABORADOR: es un juez, y los jueces tienen su
 * propia pantalla. Aca se avisa en vez de crearlo en silencio — si no, el
 * organizador lo agrega, no lo ve en la lista, y lo agrega de nuevo.
 *
 * EL ALCANCE VACIO SIGNIFICA TODAS. "Todas las categorias" es una casilla que
 * desmarca las demas, no una fila mas de la lista: asi el caso comun no necesita
 * tocar nada.
 */
export function AgregarColaborador({
  eventId,
  divisiones,
}: {
  eventId: string;
  divisiones: DivisionParaAlcance[];
}) {
  const [state, formAction] = useActionState(invitarColaborador, inicial);
  const [esAdmin, setEsAdmin] = useState(false);
  const [todas, setTodas] = useState(true);
  const [elegidas, setElegidas] = useState<string[]>([]);

  const bloqueado = esAdmin;

  function alternar(id: string) {
    setElegidas((antes) =>
      antes.includes(id) ? antes.filter((x) => x !== id) : [...antes, id],
    );
    setTodas(false);
  }

  return (
    <form action={formAction} className="flex flex-col gap-7">
      <input type="hidden" name="eventId" value={eventId} />
      {/* Lo distingue del alta de juez, que usa la misma acción: allá cero
          permisos es lo correcto, acá es un formulario a medio llenar. */}
      <input type="hidden" name="exigePermiso" value="si" />

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-wider text-neutral-500 uppercase">
          Email del colaborador
        </span>
        <input
          name="email"
          type="email"
          required
          placeholder="Ingresa el email del usuario"
          className="rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none transition-colors focus:border-lime-400"
        />
        <span className="text-xs text-neutral-500">
          El usuario debe estar registrado en la plataforma. Si todavía no tiene
          cuenta, la invitación queda pendiente y se activa sola cuando se
          registre con ese correo.
        </span>
      </label>

      <Interruptor
        name="isAdmin"
        titulo="Administrador"
        detalle="Acceso total, igual que el organizador del evento. No aplican los permisos individuales ni el alcance por categoría."
        activo={esAdmin}
        onChange={setEsAdmin}
        destacado
      />

      <fieldset disabled={bloqueado} className={bloqueado ? "opacity-40" : ""}>
        <legend className="mb-3 text-xs font-semibold tracking-wider text-neutral-500 uppercase">
          Permisos
        </legend>

        <div className="flex flex-col gap-3">
          <Interruptor
            name="canEditRegistrations"
            titulo="Editar registros"
            detalle="Puede editar, aprobar y rechazar registros de atletas (no borrar)"
          />
          <Interruptor
            name="canEditScores"
            titulo="Editar scores"
            detalle="Puede crear y modificar puntajes de los atletas"
          />
          {/* Borrar va aparte de editar a propósito: quien corrige un dorsal mal
              escrito no tiene por qué poder eliminar al atleta de la
              competencia. */}
          <Interruptor
            name="canDeleteRegistrations"
            titulo="Eliminar registros"
            detalle="Puede eliminar registros de atletas del evento"
          />
          <Interruptor
            name="canManageWorkouts"
            titulo="Cargar workouts"
            detalle="Puede crear y modificar los workouts de las categorías"
          />
        </div>
      </fieldset>

      {divisiones.length > 0 && (
        <fieldset
          disabled={bloqueado}
          className={bloqueado ? "opacity-40" : ""}
        >
          <legend className="text-xs font-semibold tracking-wider text-neutral-500 uppercase">
            Acceso a categorías
          </legend>
          <p className="mt-2 mb-3 text-sm text-neutral-500">
            Selecciona a cuáles puede acceder. Déjalo vacío para acceso a todas.
          </p>

          <div className="flex flex-col gap-1">
            <Casilla
              marcada={todas}
              onChange={() => {
                setTodas(true);
                setElegidas([]);
              }}
              etiqueta="Todas las categorías"
              destacada
            />

            {divisiones.map((d) => (
              <Casilla
                key={d.id}
                marcada={elegidas.includes(d.id)}
                onChange={() => alternar(d.id)}
                etiqueta={d.name}
                valor={d.id}
              />
            ))}
          </div>
        </fieldset>
      )}

      {state.error && (
        <p
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
        >
          {state.error}
        </p>
      )}

      <BotonDeEnvio
        pendienteTexto="Invitando…"
        mensajeDeCarga="Invitando al colaborador…"
        className="w-fit rounded-xl bg-lime-400 px-6 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
      >
        Agregar colaborador
      </BotonDeEnvio>
    </form>
  );
}

/**
 * Un permiso, con su explicacion al lado.
 *
 * El interruptor es un checkbox de verdad —no un div con `onClick`— porque asi
 * viaja en el `FormData` sin estado que sincronizar, funciona con teclado y lo
 * anuncia un lector de pantalla. Lo que se ve es un `<span>` estilado sobre el
 * checkbox oculto.
 */
function Interruptor({
  name,
  titulo,
  detalle,
  activo,
  onChange,
  destacado,
}: {
  name: string;
  titulo: string;
  detalle: string;
  activo?: boolean;
  onChange?: (v: boolean) => void;
  destacado?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start justify-between gap-4 rounded-2xl border p-4 transition-colors ${
        destacado
          ? "border-neutral-700 bg-neutral-900/60"
          : "border-neutral-800 hover:border-neutral-700"
      }`}
    >
      <span className="min-w-0">
        <span className="block font-medium">{titulo}</span>
        <span className="mt-0.5 block text-sm leading-relaxed text-neutral-500">
          {detalle}
        </span>
      </span>

      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          name={name}
          checked={activo}
          onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
          defaultChecked={activo === undefined ? false : undefined}
          className="peer sr-only"
        />
        <span className="block h-6 w-11 rounded-full bg-neutral-700 transition-colors peer-checked:bg-lime-400 peer-focus-visible:ring-2 peer-focus-visible:ring-lime-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-neutral-950" />
        <span className="absolute top-1 left-1 block h-4 w-4 rounded-full bg-neutral-950 transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function Casilla({
  marcada,
  onChange,
  etiqueta,
  valor,
  destacada,
}: {
  marcada: boolean;
  onChange: () => void;
  etiqueta: string;
  valor?: string;
  destacada?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-neutral-900">
      <input
        type="checkbox"
        name={valor ? "divisions" : undefined}
        value={valor}
        checked={marcada}
        onChange={onChange}
        className="h-4 w-4 shrink-0 accent-lime-400"
      />
      <span
        className={`text-sm ${destacada && marcada ? "font-medium text-lime-400" : ""}`}
      >
        {etiqueta}
      </span>
    </label>
  );
}
