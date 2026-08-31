import { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/lib/supabase/types";

export interface Miembro {
  userId: string;
  nombre: string;
  email: string | null;
  role: OrgRole;
  esYo: boolean;
}

export interface Invitacion {
  id: string;
  email: string;
  role: OrgRole;
  createdAt: string;
}

export async function getMiembros(orgId: string): Promise<Miembro[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from("org_members")
    .select("user_id, role, profiles (full_name, email)")
    .eq("org_id", orgId);

  const orden: Record<OrgRole, number> = { owner: 0, admin: 1, head_judge: 2, judge: 3 };

  return ((data ?? []) as unknown as Array<Record<string, never>>)
    .map((m) => {
      const perfil = m.profiles as { full_name: string | null; email: string | null } | null;
      return {
        userId: String(m.user_id),
        nombre: perfil?.full_name ?? perfil?.email ?? String(m.user_id).slice(0, 8),
        email: perfil?.email ?? null,
        role: m.role as unknown as OrgRole,
        esYo: String(m.user_id) === user?.id,
      };
    })
    .sort((a, b) => orden[a.role] - orden[b.role] || a.nombre.localeCompare(b.nombre));
}

/** Invitaciones que todavia no se registraron. RLS ya las limita a admins. */
export async function getInvitacionesPendientes(orgId: string): Promise<Invitacion[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("org_invitations")
    .select("id, email, role, created_at")
    .eq("org_id", orgId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  return (data ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role as OrgRole,
    createdAt: i.created_at,
  }));
}
