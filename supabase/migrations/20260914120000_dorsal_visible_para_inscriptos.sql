-- Tercer caso de la misma familia de bugs que 20260914100000 y 20260914110000:
-- `teams_read` tambien era staff-only (event_role), y hace falta leer el
-- `bib_number` del propio equipo para poder enlazar, desde `/cuenta`, a los
-- resultados publicos de ESE atleta (`/en-vivo/[slug]/atleta/[bib]`).
--
-- El agregado es una fila, no una tabla: solo deja ver el equipo que esta
-- referenciado por una inscripcion propia (creada por el usuario o de la que
-- es integrante), nunca los equipos de otros atletas de la competencia.
drop policy teams_read on public.teams;

create policy teams_read on public.teams
  for select using (
    public.event_role(event_id) is not null
    or exists (
      select 1 from public.registrations r
      where r.team_id = teams.id
        and (r.created_by = auth.uid() or public.es_integrante_de(r.id))
    )
  );
