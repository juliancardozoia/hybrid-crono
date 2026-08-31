"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ClaimState } from "../actions";

const inicial: ClaimState = { error: null };

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-3 w-full rounded-xl bg-lime-400 py-3 font-bold text-lime-950 disabled:opacity-60"
    >
      {pending ? "Tomando…" : "TOMAR ESTE CARRIL"}
    </button>
  );
}

export function ClaimButton({
  laneId,
  action,
}: {
  laneId: string;
  action: (prev: ClaimState, formData: FormData) => Promise<ClaimState>;
}) {
  const [state, formAction] = useActionState(action, inicial);

  return (
    <form action={formAction}>
      <input type="hidden" name="laneId" value={laneId} />
      <Boton />
      {state.error && (
        <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}
