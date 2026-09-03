-- Los archivos de una competencia: logo, portada y documentos.
--
-- Hasta ahora el logo y la portada se cargaban PEGANDO UNA URL. Funciona para
-- quien tiene su afiche subido a algun lado y sabe sacar el enlace directo, o
-- sea casi nadie: lo normal es tener el JPG en el celular. Y los documentos —el
-- reglamento, los terminos— no tenian por donde entrar.
--
-- UN SOLO BUCKET PARA TODO LO DEL EVENTO
--
-- Podrian ser tres (logos, portadas, documentos) pero la politica de acceso
-- seria identica en los tres: manda quien puede administrar el evento. Tres
-- buckets con la misma regla son tres lugares donde equivocarse al cambiarla.
-- La primera carpeta es el id del evento, y de ahi cuelga el resto.
--
-- PUBLICO. El logo se ve en el catalogo y el reglamento se descarga desde la
-- ficha, dos pantallas que mira gente sin cuenta. Firmar cada URL obligaria a
-- pedirle al servidor una firma por archivo en cada visita.

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    -- PGlite es Postgres de verdad pero no trae la extension de Storage de
    -- Supabase. Sin este guard, la migracion revienta y con ella todos los
    -- tests de base.
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('eventos', 'eventos', true, 10485760,
          array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do update
    set public = true,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute $pol$
    drop policy if exists eventos_lectura_publica on storage.objects;
    create policy eventos_lectura_publica on storage.objects
      for select using (bucket_id = 'eventos');
  $pol$;

  -- Escribe quien puede administrar ESE evento. La carpeta se valida como uuid
  -- antes de castear: un nombre de archivo cualquiera haria fallar el cast y,
  -- con el, toda la subida — con un error de Postgres que no menciona ni el
  -- bucket ni el permiso.
  execute $pol$
    drop policy if exists eventos_escritura_del_organizador on storage.objects;
    create policy eventos_escritura_del_organizador on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'eventos'
        and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        and coalesce(public.can_manage_event(((storage.foldername(name))[1])::uuid), false)
      );
  $pol$;

  execute $pol$
    drop policy if exists eventos_reemplazo_del_organizador on storage.objects;
    create policy eventos_reemplazo_del_organizador on storage.objects
      for update to authenticated
      using (
        bucket_id = 'eventos'
        and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        and coalesce(public.can_manage_event(((storage.foldername(name))[1])::uuid), false)
      );
  $pol$;

  execute $pol$
    drop policy if exists eventos_borrado_del_organizador on storage.objects;
    create policy eventos_borrado_del_organizador on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'eventos'
        and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        and coalesce(public.can_manage_event(((storage.foldername(name))[1])::uuid), false)
      );
  $pol$;
end
$$;

select public.apply_function_lockdown();
