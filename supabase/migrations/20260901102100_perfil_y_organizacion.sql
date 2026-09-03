-- Un correo, dos perfiles: competidor y organizador.
--
-- LA ORGANIZACION DEJA DE SER UN PASO
--
-- Hasta ahora, quien se registraba para crear una competencia caia en una
-- pantalla que le pedia "crea tu organizacion" antes de poder hacer nada. Es un
-- concepto interno —el espacio donde viven los eventos, los atletas y los
-- carriles, y el sujeto de casi todas las politicas de RLS— que no le importa a
-- nadie el primer dia. Pedirlo antes de dejar crear la primera competencia es
-- cobrar por adelantado una decision que el usuario todavia no puede tomar.
--
-- La organizacion sigue existiendo y sigue siendo la base de la seguridad: lo
-- que cambia es QUIEN la crea. `ensure_my_organization()` la crea sola la
-- primera vez que alguien entra al panel de organizador, con su nombre y un
-- slug derivado del correo. El usuario nunca ve la palabra "organizacion" hasta
-- que quiera invitar a alguien.
--
-- Y sigue siendo idempotente: entrar diez veces al panel no crea diez espacios.

-- ---------------------------------------------------------------------------
-- El perfil, completo
-- ---------------------------------------------------------------------------
--
-- El registro pide lo minimo —correo y clave— a proposito: un formulario de
-- doce campos en la puerta espanta a la mitad. El resto se completa despues,
-- desde el perfil, y solo cuando hace falta.

alter table public.profiles
  add column avatar_url text,
  -- El telefono va partido en prefijo y numero: la plataforma cruza doce paises
  -- y un numero sin prefijo no se puede marcar desde otro.
  add column phone_country text,
  add column phone text,
  add column birth_date date,
  -- ISO de dos letras, igual que en `events`: es lo que permite agrupar sin
  -- depender de como escribio cada uno el nombre del pais.
  add column country text check (country is null or country ~ '^[A-Z]{2}$'),
  add column city text,
  add column instagram text;

-- ---------------------------------------------------------------------------
-- La organizacion se crea sola
-- ---------------------------------------------------------------------------

create or replace function public.ensure_my_organization()
returns public.organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_org public.organizations;
  v_nombre text;
  v_base text;
  v_slug text;
  v_intento int := 0;
begin
  if v_user is null then
    raise exception 'Hay que iniciar sesión' using errcode = 'insufficient_privilege';
  end if;

  -- Si ya pertenece a alguna, esa es. La mas antigua: es la suya, las demas
  -- pueden ser invitaciones de terceros.
  select o.* into v_org
  from public.organizations o
  join public.org_members m on m.org_id = o.id
  where m.user_id = v_user
  order by o.created_at
  limit 1;

  if found then
    return v_org;
  end if;

  select coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1), 'Mi organización')
  into v_nombre
  from public.profiles p where p.id = v_user;

  -- El slug sale del correo y no del nombre: "Ana Pérez" da "ana-perez", que
  -- choca en cuanto haya dos, y el correo ya es unico por definicion.
  select lower(regexp_replace(split_part(coalesce(p.email, 'org'), '@', 1), '[^a-z0-9]+', '-', 'g'))
  into v_base
  from public.profiles p where p.id = v_user;

  v_base := trim(both '-' from coalesce(nullif(v_base, ''), 'org'));
  if length(v_base) < 2 then
    v_base := 'org-' || v_base;
  end if;
  v_base := left(v_base, 40);
  v_slug := v_base;

  -- Dos personas con el mismo local-part en dominios distintos existen, asi que
  -- el choque hay que resolverlo y no suponer que no pasa.
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_intento := v_intento + 1;
    if v_intento > 50 then
      v_slug := v_base || '-' || replace(gen_random_uuid()::text, '-', '');
      exit;
    end if;
    v_slug := v_base || '-' || v_intento::text;
  end loop;

  insert into public.organizations (name, slug, created_by)
  values (v_nombre, left(v_slug, 48), v_user)
  returning * into v_org;

  -- La membresía de dueño la pone el trigger `add_creator_as_owner`.
  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- La foto de perfil
-- ---------------------------------------------------------------------------
--
-- El bucket va DENTRO de un guard que comprueba que exista el schema `storage`.
--
-- No es defensa contra lo imposible: los tests de base corren sobre PGlite, que
-- es Postgres de verdad pero NO trae la extension de Storage de Supabase. Sin el
-- guard, esta migracion revienta y con ella los 695 tests, que es un precio
-- absurdo por una carpeta de imagenes.

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    return;
  end if;

  -- Publico: una foto de perfil se muestra en el leaderboard y en la lista de
  -- largada, que las ve gente sin cuenta. Firmar cada URL obligaria a pedirle al
  -- servidor una firma por atleta en cada pantalla publica.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 2097152,
          array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public = true,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Cada uno escribe SOLO en su carpeta. El nombre del archivo empieza por el
  -- uuid del usuario, asi que la politica lo compara contra `auth.uid()`: sin
  -- eso, cualquiera con sesion podria reemplazar la foto de cualquier otro.
  execute $pol$
    drop policy if exists avatars_lectura_publica on storage.objects;
    create policy avatars_lectura_publica on storage.objects
      for select using (bucket_id = 'avatars');
  $pol$;

  execute $pol$
    drop policy if exists avatars_escritura_propia on storage.objects;
    create policy avatars_escritura_propia on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  $pol$;

  execute $pol$
    drop policy if exists avatars_reemplazo_propio on storage.objects;
    create policy avatars_reemplazo_propio on storage.objects
      for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  $pol$;

  execute $pol$
    drop policy if exists avatars_borrado_propio on storage.objects;
    create policy avatars_borrado_propio on storage.objects
      for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  $pol$;
end
$$;

select public.apply_function_lockdown();
