"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { slugify, slugWithSuffix } from "@/shared/utils/slug";

export interface FormState {
  error: string | null;
}

export async function createOrganization(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) {
    return { error: "El nombre tiene que tener al menos 2 caracteres." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // created_by no es opcional: la politica de insert exige que coincida con
  // auth.uid(), y el trigger lo usa para dar de alta al creador como owner.
  const base = slugify(name);
  const { error } = await supabase
    .from("organizations")
    .insert({ name, slug: base || slugWithSuffix(name, 48), created_by: user.id });

  if (error) {
    // 23505 = unique_violation. El slug ya existe: reintentamos con sufijo.
    if (error.code === "23505") {
      const { error: retryError } = await supabase
        .from("organizations")
        .insert({ name, slug: slugWithSuffix(name, 48), created_by: user.id });
      if (retryError) return { error: "No se pudo crear la organización." };
    } else {
      return { error: "No se pudo crear la organización." };
    }
  }

  revalidatePath("/panel");
  redirect("/panel");
}
