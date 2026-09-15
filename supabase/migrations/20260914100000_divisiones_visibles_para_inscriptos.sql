-- `divisions_read` solo dejaba pasar a quien tiene rol de staff en el evento
-- (event_role). Se escribio en la fase de configuracion del organizador, antes
-- de que existiera el portal de inscripciones publicas, y nunca se actualizo
-- para el caso de un atleta comun viendo SU PROPIA inscripcion.
--
-- `getInscripcion()` (src/features/inscripciones/queries.ts) consulta
-- `divisions` con el cliente del usuario, no con el service role, para traer
-- el nombre de la categoria en /inscripcion/[id]. Para cualquier competidor sin
-- rol de staff esa consulta siempre devolvia cero filas por RLS -- sin error
-- visible -- y la pagina lo interpretaba como "no existe": un atleta nunca
-- podia ver su propio tramite de inscripcion.
--
-- El agregado reusa `es_integrante_de`, la misma funcion security definer que
-- ya protege `registration_members` y `puede_ver_inscripcion`: puede leer una
-- division quien administra el evento, o quien tiene una inscripcion (propia o
-- como integrante invitado) en esa division.
drop policy if exists divisions_read on public.divisions;

create policy divisions_read on public.divisions
  for select using (
    public.event_role(event_id) is not null
    or exists (
      select 1 from public.registrations r
      where r.division_id = divisions.id
        and (r.created_by = auth.uid() or public.es_integrante_de(r.id))
    )
  );
