-- Colaboradores con permisos finos y alcance por categoria.
--
-- POR QUE NO ALCANZABA EL ROL SOLO
--
-- `event_staff.role` es un nivel: manager > verifier > scorekeeper > registrar >
-- judge. Sirve mientras la gente entre en cinco casilleros, y deja de servir en
-- cuanto aparece el sexto — "puede cargar scores pero no borrar registros", que
-- es el reparto real de una competencia con quince voluntarios.
--
-- El rol NO se elimina: es lo que lee `event_role()` y de ahi cuelga toda la
-- cadena de RLS. Lo que se agrega son PERMISOS EXPLICITOS que suman sobre el
-- rol, y un alcance por categoria.
--
-- ADMINISTRADOR ES UN CORTOCIRCUITO, NO UN PERMISO MAS
--
-- Marcar "administrador" da acceso total y APAGA los permisos individuales y el
-- alcance por division. Es lo que espera cualquiera: un administrador con una
-- casilla desmarcada seria un administrador que no puede hacer algo, y eso no es
-- un administrador.

alter table public.event_staff
  -- Acceso total en ESTE evento. Equivale a `role = 'manager'` y se guarda
  -- ademas como bandera para que la pantalla no tenga que deducirlo del enum.
  add column is_admin boolean not null default false,
  add column can_edit_registrations boolean not null default false,
  add column can_delete_registrations boolean not null default false,
  add column can_edit_scores boolean not null default false,
  add column can_manage_workouts boolean not null default false;

-- ---------------------------------------------------------------------------
-- El alcance por categoria
-- ---------------------------------------------------------------------------
--
-- VACIO SIGNIFICA TODAS, y por eso es una tabla de excepciones y no una columna
-- con la lista completa. Un colaborador sin filas aqui ve todo el evento; en
-- cuanto aparece una, ve solo esas. Guardar "todas" como N filas obligaria a
-- agregar una cada vez que se crea una categoria nueva, y el dia que alguien
-- olvide hacerlo el juez se queda sin ver su division sin que nadie entienda
-- por que.

create table public.event_staff_divisions (
  staff_id uuid not null references public.event_staff (id) on delete cascade,
  division_id uuid not null,
  event_id uuid not null,
  primary key (staff_id, division_id),
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete cascade
);

create index event_staff_divisions_staff_idx on public.event_staff_divisions (staff_id);

alter table public.event_staff_divisions enable row level security;

create policy event_staff_divisions_read on public.event_staff_divisions
  for select using (public.event_role(event_id) is not null);

revoke all on public.event_staff_divisions from anon, authenticated;
-- Sin insert ni update: el alcance se escribe con `invite_event_staff`, que
-- valida el permiso y reemplaza la lista entera de una.
grant select on public.event_staff_divisions to authenticated;

-- ---------------------------------------------------------------------------
-- Los helpers, ahora mirando tambien las banderas
-- ---------------------------------------------------------------------------

create or replace function public.can_score_event(p_event_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.can_verify_event(p_event_id)
    or public.event_staff_role(p_event_id) = 'scorekeeper'
    -- El permiso explicito SUMA sobre el rol: alguien invitado como juez puede
    -- ademas cargar scores sin tener que ascenderlo a scorekeeper y darle de
    -- paso todo lo que ese rol arrastra.
    or exists (
      select 1 from public.event_staff s
      where s.event_id = p_event_id
        and s.user_id = auth.uid()
        and (s.is_admin or s.can_edit_scores)
    ),
    false
  );
$$;

create or replace function public.can_register_event(p_event_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.can_verify_event(p_event_id)
    or public.event_staff_role(p_event_id) = 'registrar'
    or exists (
      select 1 from public.event_staff s
      where s.event_id = p_event_id
        and s.user_id = auth.uid()
        and (s.is_admin or s.can_edit_registrations)
    ),
    false
  );
$$;

-- Borrar es un permiso APARTE de editar, y no una consecuencia.
--
-- Quien corrige el dorsal mal escrito de un atleta no tiene por que poder
-- eliminarlo de la competencia. Es la distincion que la pantalla hace explicita
-- ("puede editar, aprobar y rechazar registros — no borrar") y que un solo
-- permiso de "gestionar registros" borraria.
create or replace function public.can_delete_registrations(p_event_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.can_manage_event(p_event_id)
    or exists (
      select 1 from public.event_staff s
      where s.event_id = p_event_id
        and s.user_id = auth.uid()
        and (s.is_admin or s.can_delete_registrations)
    ),
    false
  );
$$;

create or replace function public.can_manage_workouts(p_event_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.can_manage_event(p_event_id)
    or exists (
      select 1 from public.event_staff s
      where s.event_id = p_event_id
        and s.user_id = auth.uid()
        and (s.is_admin or s.can_manage_workouts)
    ),
    false
  );
$$;

/**
 * Si el usuario puede tocar ESTA categoria.
 *
 * Sin filas de alcance, puede con todas. Es la regla que hace que el caso comun
 * —un colaborador que ve el evento entero— no necesite configuracion.
 */
create or replace function public.puede_en_division(p_event_id uuid, p_division_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    -- Quien administra la organizacion nunca esta acotado por division.
    public.can_manage_event(p_event_id)
    or not exists (
      select 1
      from public.event_staff s
      join public.event_staff_divisions d on d.staff_id = s.id
      where s.event_id = p_event_id and s.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.event_staff s
      join public.event_staff_divisions d on d.staff_id = s.id
      where s.event_id = p_event_id
        and s.user_id = auth.uid()
        and d.division_id = p_division_id
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Invitar, con permisos y alcance
-- ---------------------------------------------------------------------------

drop function if exists public.invite_event_staff(uuid, text, public.event_staff_role);

create or replace function public.invite_event_staff(
  p_event_id uuid,
  p_email text,
  p_role public.event_staff_role default 'judge',
  p_is_admin boolean default false,
  p_can_edit_registrations boolean default false,
  p_can_delete_registrations boolean default false,
  p_can_edit_scores boolean default false,
  p_can_manage_workouts boolean default false,
  -- Vacio o null = todas las categorias.
  p_divisions uuid[] default null
)
returns public.event_staff
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_fila public.event_staff;
  v_role public.event_staff_role := p_role;
begin
  if not coalesce(public.can_manage_event(p_event_id), false) then
    raise exception 'Solo la organización puede invitar colaboradores'
      using errcode = 'insufficient_privilege';
  end if;

  if position('@' in v_email) < 2 then
    raise exception 'El correo no es válido';
  end if;

  -- Administrador manda sobre todo lo demas: el rol pasa a `manager` y las
  -- banderas individuales dejan de importar.
  if p_is_admin then
    v_role := 'manager';
  end if;

  insert into public.event_staff (
    event_id, invited_email, role, invited_by, user_id, accepted_at,
    is_admin, can_edit_registrations, can_delete_registrations,
    can_edit_scores, can_manage_workouts
  )
  values (
    p_event_id, v_email, v_role, auth.uid(),
    -- Si ya tiene cuenta queda enlazado de una: entra y ve el evento.
    (select id from public.profiles where lower(email) = v_email),
    case when exists (select 1 from public.profiles where lower(email) = v_email)
         then now() else null end,
    p_is_admin,
    p_is_admin or coalesce(p_can_edit_registrations, false),
    p_is_admin or coalesce(p_can_delete_registrations, false),
    p_is_admin or coalesce(p_can_edit_scores, false),
    p_is_admin or coalesce(p_can_manage_workouts, false)
  )
  on conflict (event_id, lower(invited_email)) do update set
    role = excluded.role,
    is_admin = excluded.is_admin,
    can_edit_registrations = excluded.can_edit_registrations,
    can_delete_registrations = excluded.can_delete_registrations,
    can_edit_scores = excluded.can_edit_scores,
    can_manage_workouts = excluded.can_manage_workouts
  returning * into v_fila;

  -- El alcance se REEMPLAZA entero, no se acumula: editar un colaborador para
  -- quitarle una categoria tiene que quitarsela de verdad.
  delete from public.event_staff_divisions where staff_id = v_fila.id;

  -- Un administrador nunca queda acotado por division.
  if not p_is_admin and p_divisions is not null and array_length(p_divisions, 1) > 0 then
    insert into public.event_staff_divisions (staff_id, division_id, event_id)
    select v_fila.id, d.id, p_event_id
    from public.divisions d
    where d.event_id = p_event_id and d.id = any (p_divisions);
  end if;

  return v_fila;
end;
$$;

select public.apply_function_lockdown();
