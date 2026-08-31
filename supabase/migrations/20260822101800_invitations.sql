-- Invitaciones a una organizacion.
--
-- POR QUE HACE FALTA
--
-- Sin esto no habia ninguna forma de que un organizador sumara a un juez: todo
-- el que se registraba quedaba sin organizacion, y la app le ofrecia lo unico
-- que sabia hacer, que era crear una. Un voluntario que llega el dia del evento
-- terminaba creando su propia organizacion vacia en vez de ver sus carriles.
--
-- La invitacion es por EMAIL y no por id de usuario, porque el organizador no
-- tiene forma de conocer el id de alguien que todavia no se registro. Se puede
-- invitar antes: cuando la persona se da de alta, el trigger convierte la
-- invitacion en membresia sola.

create table public.org_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Se guarda en minusculas para que "Juez@Box.com" y "juez@box.com" sean la
  -- misma invitacion. Ojo: NO se le sacan los puntos. Gmail los ignora, pero el
  -- resto de los proveedores no, y normalizarlos aca fusionaria cuentas que en
  -- realidad son distintas.
  email text not null check (position('@' in email) > 1),
  role public.org_role not null default 'judge',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  unique (org_id, email)
);

create index org_invitations_email_idx on public.org_invitations (lower(email))
  where accepted_at is null;

-- ---------------------------------------------------------------------------
-- Quien administra la organizacion
-- ---------------------------------------------------------------------------
--
-- El coalesce NO es cosmetico, y ya nos mordio una vez en can_manage_event:
-- para alguien sin rol, user_org_role() devuelve null y `null in (...)` es NULL,
-- no false. En plpgsql `if NULL then` NO entra al bloque, asi que un guard
-- escrito a mano deja pasar justo a quien no es miembro.
--
-- Existe como funcion para no volver a escribir la comparacion suelta.
create or replace function public.can_admin_org(p_org_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.user_org_role(p_org_id) in ('owner', 'admin'), false);
$$;

create or replace function public.is_org_owner(p_org_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.user_org_role(p_org_id) = 'owner', false);
$$;

-- ---------------------------------------------------------------------------
-- Invitar
-- ---------------------------------------------------------------------------

create or replace function public.invite_to_org(
  p_org_id uuid,
  p_email text,
  p_role public.org_role default 'judge'
)
returns table (estado text, detalle text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_user_id uuid;
begin
  if not public.can_admin_org(p_org_id) then
    raise exception 'Solo el dueño o un administrador pueden invitar'
      using errcode = 'insufficient_privilege';
  end if;

  if position('@' in v_email) < 2 then
    raise exception 'Email inválido';
  end if;

  -- Nadie se asciende a si mismo invitandose de nuevo con otro rol.
  if p_role = 'owner' and not public.is_org_owner(p_org_id) then
    raise exception 'Solo el dueño puede nombrar a otro dueño'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_user_id from auth.users where lower(email) = v_email;

  if v_user_id is not null then
    -- Ya tiene cuenta: entra directo, sin pasar por la invitacion.
    insert into public.org_members (org_id, user_id, role)
    values (p_org_id, v_user_id, p_role)
    on conflict (org_id, user_id) do update set role = excluded.role;

    estado := 'agregado';
    detalle := 'Ya tenia cuenta: quedo dentro de la organizacion.';
    return next;
    return;
  end if;

  insert into public.org_invitations (org_id, email, role, invited_by)
  values (p_org_id, v_email, p_role, auth.uid())
  on conflict (org_id, email) do update
    set role = excluded.role,
        invited_by = excluded.invited_by,
        created_at = now();

  estado := 'invitado';
  detalle := 'Todavia no tiene cuenta. Entra sola cuando se registre con ese email.';
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Aceptacion automatica al registrarse
-- ---------------------------------------------------------------------------

create or replace function public.accept_pending_invitations()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.org_members (org_id, user_id, role)
  select i.org_id, new.id, i.role
  from public.org_invitations i
  where lower(i.email) = lower(new.email)
    and i.accepted_at is null
  on conflict (org_id, user_id) do nothing;

  update public.org_invitations
  set accepted_at = now(), accepted_by = new.id
  where lower(email) = lower(new.email)
    and accepted_at is null;

  return new;
end;
$$;

-- Se dispara despues del trigger que crea el perfil: para entonces la persona
-- ya existe en profiles, que es lo que org_members necesita por la FK.
create trigger on_profile_created_accept_invitations
after insert on public.profiles
for each row execute function public.accept_pending_invitations();

-- ---------------------------------------------------------------------------
-- Quitar a alguien
-- ---------------------------------------------------------------------------

create or replace function public.remove_org_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_duenos int;
begin
  if not public.can_admin_org(p_org_id) then
    raise exception 'Solo el dueño o un administrador pueden quitar miembros'
      using errcode = 'insufficient_privilege';
  end if;

  -- Una organizacion sin dueno queda sin nadie que pueda administrarla.
  select count(*) into v_duenos
  from public.org_members
  where org_id = p_org_id and role = 'owner';

  if v_duenos = 1 and exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = p_user_id and role = 'owner'
  ) then
    raise exception 'Es el único dueño de la organización: nombra a otro antes de quitarlo';
  end if;

  delete from public.org_members where org_id = p_org_id and user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.org_invitations enable row level security;

create policy org_invitations_read on public.org_invitations
  for select using (public.can_admin_org(org_id));

create policy org_invitations_delete on public.org_invitations
  for delete using (public.can_admin_org(org_id));

grant select, delete on public.org_invitations to authenticated;

select public.apply_function_lockdown();
