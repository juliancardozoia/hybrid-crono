-- Datos de cabecera del evento para las pantallas publicas.
--
-- Existe aparte de public_leaderboard() por dos razones: el nombre y la sede no
-- tienen por que repetirse en cada fila del ranking, y la pagina publica tiene
-- que poder mostrar algo util aunque todavia no haya ni un resultado cargado.
--
-- Expone unicamente lo que va en un cartel: nada de org_id, ni de ids internos,
-- ni de configuracion.

create or replace function public.public_event_info(p_public_slug text)
returns table (
  name text,
  venue text,
  event_date date,
  status public.event_status,
  official boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    e.name,
    e.venue,
    e.event_date,
    e.status,
    (e.status = 'published') as official
  from public.events e
  where e.public_slug = p_public_slug
    -- Un evento en borrador o solo "listo" todavia no es publico: mostrarlo
    -- filtraria la grilla antes de que la organizacion la quiera anunciar.
    and e.status in ('live', 'verifying', 'published');
$$;

grant execute on function public.public_event_info(text) to anon, authenticated;
