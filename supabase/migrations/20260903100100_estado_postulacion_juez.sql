-- Estado de la postulacion de juez, visible desde la ficha publica.
--
-- La ficha publica (`getEventoPublico`) usa el cliente anonimo y `EventoPublico`
-- nunca cargo el uuid interno del evento -- solo el slug. Sin el id, el boton
-- de "postularme" no puede saber si YA se postulo sin una funcion propia: el
-- resto de las consultas del portal publico pasan por `public_*`, y esta seria
-- la primera que ademas depende de quien esta logueado.
--
-- Devuelve null para anonimos y para quien nunca se postulo -- el boton
-- entonces ofrece postularse. 'pendiente' o 'aprobada' en cualquier otro caso.

create or replace function public.public_judge_application_status(p_public_slug text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when s.approved_at is not null then 'aprobada' else 'pendiente' end
  from public.event_staff s
  join public.events e on e.id = s.event_id
  where e.public_slug = p_public_slug
    and auth.uid() is not null
    and s.user_id = auth.uid();
$$;

select public.apply_function_lockdown();
