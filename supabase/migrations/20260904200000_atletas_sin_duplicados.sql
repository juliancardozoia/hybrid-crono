-- Un DNI o un correo no se puede repetir DENTRO de la misma competencia.
--
-- Nada lo impedia: se podia cargar el mismo documento dos veces sin que la
-- app dijera nada, manual o por CSV.
--
-- EL CORREO ES UNICO POR EVENTO, NO GLOBAL A PROPOSITO. La misma persona
-- corre competencias de organizadores distintos con el mismo correo todo el
-- tiempo -- esa reutilizacion es legitima y no hay que bloquearla. Lo que no
-- puede pasar es que DOS INSCRIPTOS DE LA MISMA COMPETENCIA compartan
-- correo o documento: ahi es casi siempre un error de tipeo duplicando a
-- alguien, o dos personas usando el DNI de una sola.
--
-- Se aplica en la tabla, no en cada camino de escritura por separado: es lo
-- que hace que valga tanto para el alta manual (`admin_create_registration`)
-- como para la importacion CSV (`import_teams`) y la inscripcion publica
-- (`confirm_registration`) sin repetir la validacion tres veces.

-- Antes de poder exigirlo, hay que resolver los duplicados que ya existen
-- (en su mayoria, datos de prueba de la siembra): se les agrega un sufijo a
-- todas las filas de un grupo repetido menos la primera, para no perder el
-- dato pero destrabar el indice.
do $$
declare
  v_fila record;
begin
  for v_fila in
    select id, row_number() over (
      partition by event_id, upper(trim(document_id)) order by created_at
    ) as posicion
    from public.athletes
    where document_id is not null and trim(document_id) <> ''
  loop
    if v_fila.posicion > 1 then
      update public.athletes
      set document_id = document_id || '-DUP' || v_fila.posicion
      where id = v_fila.id;
    end if;
  end loop;

  for v_fila in
    select id, row_number() over (
      partition by event_id, lower(trim(email)) order by created_at
    ) as posicion
    from public.athletes
    where email is not null and trim(email) <> ''
  loop
    if v_fila.posicion > 1 then
      update public.athletes
      -- "+dupN" antes de la arroba sigue siendo una direccion valida (es el
      -- mismo truco de los alias de Gmail), asi que el dato se ve corregido
      -- y no roto.
      set email = regexp_replace(email, '@', '+dup' || v_fila.posicion || '@')
      where id = v_fila.id;
    end if;
  end loop;
end $$;

create unique index athletes_document_unico
  on public.athletes (event_id, upper(trim(document_id)))
  where document_id is not null and trim(document_id) <> '';

create unique index athletes_email_unico
  on public.athletes (event_id, lower(trim(email)))
  where email is not null and trim(email) <> '';
