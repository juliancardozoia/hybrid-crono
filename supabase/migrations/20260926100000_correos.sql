-- Correos transaccionales: outbox, supresiones y disparadores.
--
-- POR QUE EN POSTGRES Y NO EN LAS ACCIONES DE NEXT
--
-- Una inscripcion se confirma por TRES caminos (webhook de pago, confirmacion
-- manual del organizador, alta sin precio) y el staff se toca desde varias
-- acciones. Enganchar el envio a cada accion garantiza que un dia se olvide una.
-- Encolar desde un trigger cubre todos los caminos, presentes y futuros, y lo
-- hace dentro de la MISMA transaccion: si la operacion falla no queda un correo
-- fantasma, y si un webhook llega tres veces sale un solo correo (dedupe_key).
--
-- POR QUE TRIGGERS SOBRE LAS TABLAS Y NO REDEFINIR invite_member & compania
--
-- Redefinir esas funciones obliga a copiar cuerpos largos que ya tienen varias
-- versiones, y un error de copia rompe la inscripcion. Un trigger no toca su
-- logica: solo mira el dato que quedo escrito.
--
-- El payload se arma AL ENCOLAR (nombre del evento, categoria...) y no al
-- enviar: el correo dice lo que era cierto cuando ocurrio, y el procesador no
-- necesita consultas con embeds de PostgREST (la brecha que los tests de base no
-- cubren).

-- ---------------------------------------------------------------------------
-- Idioma del destinatario
-- ---------------------------------------------------------------------------
--
-- `idiomaActual()` de la app refleja a quien EJECUTA la accion, no a quien
-- recibe el correo. Sin este campo el capitan que invita en español le manda a
-- su companero brasileño un correo en español.

alter table public.profiles
  add column locale text check (locale in ('es', 'pt', 'en'));

-- Copia FIEL de la version vigente (20260822100600_profiles.sql) con UN agregado:
-- lee `locale` del metadata al crear la cuenta. En el conflicto NO se pisa: si la
-- persona ya lo eligio, un cambio de correo no lo borra.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_locale text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'locale', '')), '');
begin
  insert into public.profiles (id, email, full_name, locale)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    case when v_locale in ('es', 'pt', 'en') then v_locale else null end
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Politica de privilegios: funciones `interno_*`
-- ---------------------------------------------------------------------------
--
-- `apply_function_lockdown()` le da EXECUTE a `authenticated` a TODA funcion que
-- no devuelve trigger. Para `interno_encolar_correo` eso seria un endpoint REST
-- desde el que cualquier usuario logueado manda correo a cualquier direccion con
-- nuestro dominio. Y como cada migracion vuelve a correr la politica, un revoke
-- puntual se desharia solo. Por eso es una regla de nombre, como `public_*`:
--
--   - se llama interno_*  -> nadie. Solo el dueño (triggers y funciones definer)
--                            y service_role, que conserva su grant por defecto.

create or replace function public.apply_function_lockdown()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in
    select
      p.oid::regprocedure as firma,
      p.proname as nombre,
      t.typname as retorno
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.firma);

    -- Esta misma funcion no se expone: la llaman las migraciones, no la app.
    if r.nombre = 'apply_function_lockdown' then
      continue;
    end if;

    -- Una funcion de trigger se dispara con los privilegios del dueño de la
    -- tabla. Otorgarle EXECUTE solo la convertiria en un endpoint REST.
    if r.retorno = 'trigger' then
      continue;
    end if;

    -- Las internas no las llama ningun cliente: ni anon ni authenticated.
    if r.nombre like 'interno\_%' then
      continue;
    end if;

    execute format('grant execute on function %s to authenticated', r.firma);

    if r.nombre like 'public\_%' then
      execute format('grant execute on function %s to anon', r.firma);
    end if;
  end loop;
end;
$$;

revoke all on function public.apply_function_lockdown() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Las tablas
-- ---------------------------------------------------------------------------

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  -- 'invitacion_equipo', 'inscripcion_confirmada', 'pago_recibido', ...
  -- Sin CHECK a proposito: agregar un tipo no deberia exigir una migracion, y
  -- la app valida el conjunto.
  kind text not null,
  -- Hoy solo 'email'. Existe para sumar WhatsApp sin rehacer la cola.
  channel text not null default 'email',
  to_email text not null,
  payload jsonb not null default '{}'::jsonb,
  -- Idempotencia: el mismo hecho encolado dos veces deja UNA fila.
  dedupe_key text not null unique,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'procesando', 'enviado', 'fallido')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text,
  -- Quien lo desencadeno, y si cuenta contra los limites anti-abuso. Los correos
  -- de sistema (pago, confirmacion) NO cuentan: los dispara un hecho verificado.
  origen_uid uuid,
  limitado boolean not null default false,
  created_at timestamptz not null default now()
);

create index email_outbox_pendientes_idx
  on public.email_outbox (next_attempt_at)
  where status in ('pendiente', 'procesando');
create index email_outbox_limite_usuario_idx
  on public.email_outbox (origen_uid, created_at) where limitado;
create index email_outbox_limite_destino_idx
  on public.email_outbox (to_email, created_at) where limitado;

-- Direcciones a las que no se le vuelve a escribir: rebotaron o marcaron spam.
-- Seguir enviandoles quema la reputacion del dominio y con ella la entrega de
-- TODO, incluida la verificacion de cuenta.
create table public.email_suppressions (
  email text primary key check (email = lower(email)),
  reason text not null check (reason in ('bounce_permanente', 'queja', 'manual')),
  created_at timestamptz not null default now()
);

-- Ninguna de las dos la toca un cliente. RLS activo SIN politicas + sin GRANT:
-- solo service_role (que saltea RLS) y las funciones definer llegan.
alter table public.email_outbox enable row level security;
alter table public.email_suppressions enable row level security;

-- Supabase da SELECT/INSERT/UPDATE/DELETE a anon y authenticated a toda tabla
-- nueva (default privileges): hay que CERRARLO, un `grant` no quita nada.
revoke all on public.email_outbox from anon, authenticated;
revoke all on public.email_suppressions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Encolar
-- ---------------------------------------------------------------------------
--
-- SQLSTATE 'EM001': limite de envio. Mismo criterio que 'PL001' de los planes:
-- con un codigo propio el traductor de errores de la app muestra el mensaje del
-- servidor tal cual, en vez del generico de un CHECK.

create or replace function public.interno_encolar_correo(
  p_kind text,
  p_to_email text,
  p_payload jsonb,
  p_dedupe_key text,
  -- Null = correo de sistema, sin limite. Un numero = maximo de correos
  -- "desencadenados por una persona" por hora para quien hace la accion.
  p_limite_hora int default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_to_email, '')));
  v_uid uuid := auth.uid();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_hint text;
  v_id uuid;
begin
  -- Un correo invalido no es un error de quien opera: el dato ya se guardo y el
  -- flujo sigue (el capitan siempre puede compartir el link a mano).
  if position('@' in v_email) < 2 or v_email like '%@local' then
    return null;
  end if;

  if exists (select 1 from public.email_suppressions where email = v_email) then
    return null;
  end if;

  -- Antes de los limites: un duplicado no cuenta ni rebota.
  if exists (select 1 from public.email_outbox where dedupe_key = p_dedupe_key) then
    return null;
  end if;

  if p_limite_hora is not null then
    if v_uid is not null and (
      select count(*) from public.email_outbox
      where origen_uid = v_uid and limitado and created_at > now() - interval '1 hour'
    ) >= p_limite_hora then
      raise exception 'Enviaste muchas invitaciones en poco tiempo. Intenta de nuevo en una hora.'
        using errcode = 'EM001';
    end if;

    -- El mismo destinatario no recibe una lluvia de invitaciones, venga de quien
    -- venga: es la defensa contra usar la plataforma para molestar a un tercero.
    if (
      select count(*) from public.email_outbox
      where to_email = v_email and limitado and created_at > now() - interval '1 day'
    ) >= 5 then
      raise exception 'Esa direccion ya recibio varias invitaciones hoy. Compartele el enlace por otro medio.'
        using errcode = 'EM001';
    end if;
  end if;

  -- Pista de idioma para quien todavia no tiene cuenta: el de quien lo invita.
  if not (v_payload ? 'locale_hint') and v_uid is not null then
    select locale into v_hint from public.profiles where id = v_uid;
    if v_hint is not null then
      v_payload := v_payload || jsonb_build_object('locale_hint', v_hint);
    end if;
  end if;

  insert into public.email_outbox (kind, to_email, payload, dedupe_key, origen_uid, limitado)
  values (p_kind, v_email, v_payload, p_dedupe_key, v_uid, p_limite_hora is not null)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Procesar la cola (lo llama el servidor con service_role)
-- ---------------------------------------------------------------------------

create or replace function public.interno_reclamar_correos(p_limite int default 20)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Un worker que murio a mitad de envio deja la fila en 'procesando' para
  -- siempre. Sin intentos restantes, se da por fallida; con intentos, se
  -- reclama de nuevo mas abajo.
  update public.email_outbox
  set status = 'fallido', last_error = coalesce(last_error, 'El envio quedo sin terminar')
  where status = 'procesando'
    and locked_at < now() - interval '5 minutes'
    and attempts >= 5;

  return query
  update public.email_outbox o
  set status = 'procesando',
      locked_at = now(),
      attempts = o.attempts + 1
  where o.id in (
    select id from public.email_outbox
    where (status = 'pendiente' and next_attempt_at <= now())
       or (status = 'procesando' and locked_at < now() - interval '5 minutes')
    order by next_attempt_at
    limit greatest(1, p_limite)
    -- Dos barridos en paralelo (el inmediato y el de reintentos) no se pisan.
    for update skip locked
  )
  returning o.*;
end;
$$;

-- Resultado de un intento. La logica de reintento vive aca y no en la app para
-- que la pruebe la suite de base.
create or replace function public.interno_marcar_correo(
  p_id uuid,
  p_ok boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intentos int;
  -- Espera antes del intento siguiente, en minutos, indexada por intentos hechos.
  v_espera int[] := array[1, 5, 30, 120, 720];
begin
  select attempts into v_intentos from public.email_outbox where id = p_id;
  if not found then
    return;
  end if;

  if p_ok then
    update public.email_outbox
    set status = 'enviado', sent_at = now(), locked_at = null, last_error = null
    where id = p_id;
  elsif v_intentos >= array_length(v_espera, 1) then
    update public.email_outbox
    set status = 'fallido', locked_at = null, last_error = left(p_error, 500)
    where id = p_id;
  else
    update public.email_outbox
    set status = 'pendiente',
        locked_at = null,
        last_error = left(p_error, 500),
        next_attempt_at = now() + make_interval(mins => v_espera[least(v_intentos, array_length(v_espera, 1))])
    where id = p_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Datos comunes de una inscripcion para las plantillas
-- ---------------------------------------------------------------------------

create or replace function public.interno_datos_de_inscripcion_para_correo(p_registration_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'registration_id', r.id,
    'event_name', e.name,
    'event_slug', e.public_slug,
    'event_starts_at', e.starts_at,
    'event_timezone', e.timezone,
    'division_name', d.name,
    'team_name', r.team_name,
    'captain_name', (select p.full_name from public.profiles p where p.id = r.created_by)
  )
  from public.registrations r
  join public.events e on e.id = r.event_id
  join public.divisions d on d.id = r.division_id
  where r.id = p_registration_id;
$$;

-- ---------------------------------------------------------------------------
-- Disparadores
-- ---------------------------------------------------------------------------

-- Invitacion a un integrante: hoy solo guardaba el correo y el capitan tenia que
-- copiar el link por su cuenta.
create or replace function public.correo_al_invitar_integrante()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registro public.registrations;
begin
  -- Un upsert con el mismo correo (re-invitar) no es una invitacion nueva.
  if tg_op = 'UPDATE' and old.invited_email is not distinct from new.invited_email then
    return new;
  end if;

  select * into v_registro from public.registrations where id = new.registration_id;

  -- Una alta del organizador ya trae los datos completos y "no hay a quien
  -- invitar" (admin_create_registration): mandarle un correo a cada atleta
  -- cargado a mano seria spam y agotaria el cupo diario del proveedor.
  if v_registro.source <> 'self_service' or v_registro.status = 'cancelada' then
    return new;
  end if;

  -- El capitan ocupa el primer lugar con su propio correo: no se invita a si mismo.
  if new.profile_id is not null and new.profile_id = v_registro.created_by then
    return new;
  end if;

  perform public.interno_encolar_correo(
    'invitacion_equipo',
    new.invited_email,
    public.interno_datos_de_inscripcion_para_correo(new.registration_id)
      || jsonb_build_object(
        'position', new.position,
        'path', '/inscripcion/' || new.registration_id
      ),
    -- Incluye el correo: cambiar de persona en el mismo lugar SI es otra invitacion.
    'invitacion_equipo:' || new.registration_id || ':' || new.position || ':' || lower(new.invited_email),
    30
  );
  return new;
end;
$$;

create trigger registration_members_correo_invitacion
  after insert or update of invited_email on public.registration_members
  for each row execute function public.correo_al_invitar_integrante();

-- Inscripcion confirmada: a cada integrante con correo.
create or replace function public.correo_al_confirmar_inscripcion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_miembro record;
  v_datos jsonb;
begin
  if new.status <> 'confirmada' or old.status = 'confirmada' then
    return new;
  end if;

  -- Ver correo_al_invitar_integrante: las altas del organizador no notifican.
  if new.source <> 'self_service' then
    return new;
  end if;

  v_datos := public.interno_datos_de_inscripcion_para_correo(new.id);

  for v_miembro in
    select position, invited_email from public.registration_members
    where registration_id = new.id
  loop
    perform public.interno_encolar_correo(
      'inscripcion_confirmada',
      v_miembro.invited_email,
      v_datos || jsonb_build_object('position', v_miembro.position, 'path', '/inscripcion/' || new.id),
      'inscripcion_confirmada:' || new.id || ':' || lower(v_miembro.invited_email)
    );
  end loop;
  return new;
end;
$$;

create trigger registrations_correo_confirmada
  after update of status on public.registrations
  for each row execute function public.correo_al_confirmar_inscripcion();

-- Pago recibido: a quien inicio el tramite (el capitan), no al organizador que
-- confirmo la transferencia.
create or replace function public.correo_al_pagar_orden()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registro public.registrations;
  v_email text;
begin
  if new.status <> 'pagada' or old.status = 'pagada' then
    return new;
  end if;

  -- Una orden en $0 pasa a 'pagada' sin que nadie pague nada.
  if new.total_cents <= 0 then
    return new;
  end if;

  select * into v_registro from public.registrations where id = new.registration_id;
  if v_registro.source <> 'self_service' then
    return new;
  end if;

  select email into v_email from public.profiles where id = v_registro.created_by;

  perform public.interno_encolar_correo(
    'pago_recibido',
    v_email,
    public.interno_datos_de_inscripcion_para_correo(new.registration_id)
      || jsonb_build_object(
        'total_cents', new.total_cents,
        'currency', new.currency,
        'provider', new.provider,
        'path', '/inscripcion/' || new.registration_id
      ),
    'pago_recibido:' || new.id
  );
  return new;
end;
$$;

create trigger orders_correo_pagada
  after update of status on public.orders
  for each row execute function public.correo_al_pagar_orden();

-- Invitacion a colaborador o juez: la organizacion ya lo aprobo al invitar.
-- Una postulacion propia (apply_as_judge) nace sin aprobar y NO dispara esto.
create or replace function public.correo_al_invitar_staff()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_evento public.events;
  v_invita text;
begin
  if new.approved_at is null then
    return new;
  end if;

  select * into v_evento from public.events where id = new.event_id;
  select full_name into v_invita from public.profiles where id = new.invited_by;

  perform public.interno_encolar_correo(
    'invitacion_staff',
    new.invited_email,
    jsonb_build_object(
      'event_name', v_evento.name,
      'event_slug', v_evento.public_slug,
      'staff_role', new.role,
      'has_account', new.user_id is not null,
      'inviter_name', v_invita,
      'path', case when new.role = 'judge' then '/juez' else '/panel' end
    ),
    'invitacion_staff:' || new.id,
    -- Un evento grande invita a decenas de jueces de una sola vez.
    100
  );
  return new;
end;
$$;

create trigger event_staff_correo_invitacion
  after insert on public.event_staff
  for each row execute function public.correo_al_invitar_staff();

-- Postulacion aprobada.
create or replace function public.correo_al_aprobar_staff()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_evento public.events;
begin
  if old.approved_at is not null or new.approved_at is null then
    return new;
  end if;

  select * into v_evento from public.events where id = new.event_id;

  perform public.interno_encolar_correo(
    'juez_aprobado',
    new.invited_email,
    jsonb_build_object(
      'event_name', v_evento.name,
      'event_slug', v_evento.public_slug,
      'staff_role', new.role,
      'path', case when new.role = 'judge' then '/juez' else '/panel' end
    ),
    'juez_aprobado:' || new.id
  );
  return new;
end;
$$;

create trigger event_staff_correo_aprobacion
  after update of approved_at on public.event_staff
  for each row execute function public.correo_al_aprobar_staff();

-- ---------------------------------------------------------------------------
-- Lo que la pantalla del capitan necesita saber
-- ---------------------------------------------------------------------------

-- Que lugares tienen un correo al que la plataforma ya no escribe. Devuelve solo
-- posiciones, y solo para quien maneja el tramite: si no, seria una forma de
-- averiguar si un correo ajeno rebota.
create or replace function public.integrantes_con_correo_suprimido(p_registration_id uuid)
returns table (member_position int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.position
  from public.registration_members m
  join public.registrations r on r.id = m.registration_id
  where m.registration_id = p_registration_id
    and (r.created_by = auth.uid() or coalesce(public.can_manage_event(r.event_id), false))
    and exists (
      select 1 from public.email_suppressions s where s.email = lower(m.invited_email)
    );
$$;

-- ---------------------------------------------------------------------------
-- El barrido de reintentos
-- ---------------------------------------------------------------------------
--
-- El envio inmediato sale de la app (after()); esto es la red de seguridad para
-- lo que fallo o quedo a medias. NO se agenda aca: necesita la URL de la app y
-- el CRON_SECRET, que no viven en el repo. Se corre una vez a mano:
--
--   select public.interno_agendar_barrido_de_correos('https://<dominio>', '<CRON_SECRET>');
--
-- Corre con pg_cron + pg_net (gratis en Supabase y sin depender del plan de
-- Vercel). Ojo: el secreto queda en el comando del job, legible solo por roles
-- privilegiados. Si el proyecto esta en Vercel Pro, Vercel Cron llama a la misma
-- ruta y esto no hace falta.

create or replace function public.interno_agendar_barrido_de_correos(
  p_base_url text,
  p_secret text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'Faltan las extensiones pg_cron y pg_net: activalas en Database > Extensions';
  end if;

  execute format(
    $cmd$select cron.schedule('barrido-de-correos', '* * * * *',
      $job$select net.http_post(
        url := %L,
        headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'),
        body := '{}'::jsonb
      )$job$)$cmd$,
    rtrim(p_base_url, '/') || '/api/correos/procesar',
    'Bearer ' || p_secret
  );
end;
$$;

select public.apply_function_lockdown();
