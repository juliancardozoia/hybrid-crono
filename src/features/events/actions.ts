"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { slugWithSuffix } from "@/shared/utils/slug";

export interface FormState {
  error: string | null;
}

export async function createEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const orgId = String(formData.get("orgId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const venue = String(formData.get("venue") ?? "").trim() || null;
  const eventDate = String(formData.get("eventDate") ?? "").trim() || null;

  if (!orgId) return { error: "Falta la organización." };
  if (name.length < 3) return { error: "El nombre tiene que tener al menos 3 caracteres." };

  const supabase = await createClient();

  // El slug publico lleva sufijo aleatorio siempre: dos ediciones del mismo
  // evento ("Copa Verano") no pueden pisarse, y un link filtrado se corta
  // rotando el slug sin tocar el id.
  const { error } = await supabase.from("events").insert({
    org_id: orgId,
    name,
    venue,
    event_date: eventDate,
    public_slug: slugWithSuffix(name, 64),
  });

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "No tienes permiso para crear eventos en esta organización."
          : "No se pudo crear el evento.",
    };
  }

  revalidatePath("/panel");
  redirect("/panel");
}
