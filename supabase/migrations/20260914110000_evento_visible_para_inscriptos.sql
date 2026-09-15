-- Mismo hueco que `divisions_read` (ver 20260914100000): `events_read` solo
-- dejaba pasar a quien tiene rol de organizacion o de staff del evento
-- (user_org_role / event_staff_role). `getInscripcion()`
-- (src/features/inscripciones/queries.ts) tambien consulta `events` con el
-- cliente del usuario para traer nombre, huso horario y tallas -- y para
-- cualquier atleta sin rol de staff esa consulta devolvia cero filas por RLS,
-- asi que arreglar `divisions` solo no alcanzaba: la misma pagina fallaba
-- igual por este segundo lado.
--
-- Reusa `es_integrante_de`, igual que el fix de `divisions_read`.
drop policy events_read on public.events;

create policy events_read on public.events
  for select using (
    public.user_org_role(org_id) is not null
    or public.event_staff_role(id) is not null
    or exists (
      select 1 from public.registrations r
      where r.event_id = events.id
        and (r.created_by = auth.uid() or public.es_integrante_de(r.id))
    )
  );
