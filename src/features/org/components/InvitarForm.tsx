"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { inviteMember, type InviteState } from "../memberActions";

const inicial: InviteState = { error: null, mensaje: null, instrucciones: null };

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-lime-400 px-5 py-3 text-sm font-bold text-lime-950 disabled:opacity-60"
    >
      {pending ? "Sumando…" : "Sumar"}
    </button>
  );
}

/**
 * Mensaje listo para mandarle a la persona.
 *
 * Sumar a alguien no le avisa nada — solo escribe una fila en la base. Sin este
 * texto, el organizador queda con un juez agregado que no sabe que existe la
 * app, con que email registrarse, ni a donde entrar. El canal real el dia de un
 * evento es WhatsApp, asi que lo que hace falta es texto para copiar y pegar.
 */
function MensajeParaCompartir({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold tracking-widest text-neutral-500 uppercase">
          Envíale esto
        </p>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(texto);
              setCopiado(true);
              setTimeout(() => setCopiado(false), 2000);
            } catch {
              // Sin permiso de portapapeles: el texto se puede seleccionar igual.
            }
          }}
          className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
        >
          {copiado ? "Copiado ✓" : "Copiar"}
        </button>
      </div>
      <pre className="mt-3 text-xs leading-relaxed whitespace-pre-wrap text-neutral-300">
        {texto}
      </pre>
    </div>
  );
}

export function InvitarForm({
  orgId,
  puedeNombrarDuenos,
}: {
  orgId: string;
  puedeNombrarDuenos: boolean;
}) {
  const [state, action] = useActionState(inviteMember, inicial);

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="orgId" value={orgId} />

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Email</span>
            <input
              name="email"
              type="email"
              required
              placeholder="juez@ejemplo.com"
              className="rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-lime-400"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Rol</span>
            <select
              name="role"
              defaultValue="judge"
              className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm outline-none focus:border-lime-400"
            >
              <option value="judge">Juez</option>
              <option value="head_judge">Juez principal</option>
              <option value="admin">Admin</option>
              {/* Solo el dueño puede nombrar a otro dueño; la base lo rechaza igual. */}
              {puedeNombrarDuenos && <option value="owner">Dueño</option>}
            </select>
          </label>

          <Boton />
        </div>

        {state.error && (
          <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {state.error}
          </p>
        )}
        {state.mensaje && (
          <p className="rounded-xl border border-lime-500/40 bg-lime-500/10 p-3 text-sm text-lime-300">
            {state.mensaje}
          </p>
        )}
      </form>

      {state.instrucciones && <MensajeParaCompartir texto={state.instrucciones} />}
    </div>
  );
}
