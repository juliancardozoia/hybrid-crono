import { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/lib/supabase/types";

export interface MyOrg {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

/**
 * Organizaciones del usuario actual.
 *
 * No hace falta filtrar por usuario: RLS ya limita org_members a las
 * organizaciones donde el usuario es miembro. Agregar un `.eq("user_id", ...)`
 * seria redundante y daria la falsa impresion de que la seguridad vive aca.
 */
export async function getMyOrganizations(): Promise<MyOrg[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data, error } = await supabase
    .from("org_members")
    .select("role, organizations (id, name, slug)")
    .eq("user_id", user.id);

  if (error || !data) return [];

  return data.flatMap((row) => {
    const org = row.organizations as unknown as {
      id: string;
      name: string;
      slug: string;
    } | null;
    if (!org) return [];
    return [{ id: org.id, name: org.name, slug: org.slug, role: row.role as OrgRole }];
  });
}
