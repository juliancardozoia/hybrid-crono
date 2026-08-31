-- Cierre de privilegios.
--
-- POR QUE EXISTE ESTA MIGRACION
--
-- Supabase aplica, al crear el proyecto:
--
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
--
-- O sea que TODA tabla creada despues nace con SELECT, INSERT, UPDATE, DELETE
-- y TRUNCATE para anon y authenticated. Los `grant select, insert` de las
-- migraciones anteriores son ADITIVOS: no le quitan nada a nadie.
--
-- Consecuencia concreta que se verifico contra el proyecto real: `authenticated`
-- tenia UPDATE y DELETE sobre timing_events. Los tiempos seguian protegidos
-- porque RLS deniega cuando no hay politica que permita la operacion, pero la
-- garantia de fondo — "un juez no puede alterar un tiempo ni aunque quiera" —
-- dependia de que nadie agregara nunca una politica de UPDATE, en vez de
-- depender de que el privilegio no exista.
--
-- Aca se revoca todo y se vuelve a otorgar exactamente lo necesario.

-- Que las tablas y funciones FUTURAS tampoco nazcan abiertas.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- anon: cero acceso a tablas.
-- ---------------------------------------------------------------------------
--
-- El publico no lee ninguna tabla. Lo unico que puede hacer es llamar a
-- public_leaderboard(), que es SECURITY DEFINER y devuelve exactamente lo que
-- el atleta necesita ver: dorsal, nombre, tiempo y parciales. Sin emails, sin
-- telefonos, sin fechas de nacimiento, sin datos de otros eventos.

grant execute on function public.public_leaderboard(text) to anon;

-- ---------------------------------------------------------------------------
-- authenticated: lo justo, tabla por tabla.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.org_members to authenticated;
grant select, insert, update, delete on public.events to authenticated;
grant select, insert, update, delete on public.course_templates to authenticated;
grant select, insert, update, delete on public.segments to authenticated;
grant select, insert, update, delete on public.divisions to authenticated;
grant select, insert, update, delete on public.division_segment_specs to authenticated;
grant select, insert, update, delete on public.penalty_types to authenticated;
grant select, insert, update, delete on public.athletes to authenticated;
grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, update, delete on public.team_members to authenticated;
grant select, insert, update, delete on public.heats to authenticated;
grant select, insert, update, delete on public.lanes to authenticated;
grant select, insert, update, delete on public.results to authenticated;
grant select, insert, update, delete on public.result_publications to authenticated;

-- Aca esta la garantia central del producto, y ahora si es un privilegio que no
-- existe y no una politica que podria agregarse por descuido: sin UPDATE y sin
-- DELETE, un tiempo registrado no se puede alterar. Ni el organizador puede.
-- Anular pasa por void_timing_event(), que exige motivo y rol.
grant select, insert on public.timing_events to authenticated;

-- Solo lectura: las escribe claim_lane / transfer_lane, que son definer.
grant select on public.lane_audit to authenticated;

-- El usuario edita su propio perfil; el resto lo maneja el trigger.
grant select, update on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Funciones que la app llama desde el cliente.
-- ---------------------------------------------------------------------------
--
-- Todas verifican permisos por dentro. La lista es explicita para que agregar
-- una funcion nueva sea una decision consciente y no algo que se otorga solo.

grant execute on function public.user_org_role(uuid) to authenticated;
grant execute on function public.event_role(uuid) to authenticated;
grant execute on function public.can_manage_event(uuid) to authenticated;
grant execute on function public.can_verify_event(uuid) to authenticated;
grant execute on function public.shares_org_with(uuid) to authenticated;
grant execute on function public.event_config_issues(uuid) to authenticated;
grant execute on function public.reorder_segments(uuid, uuid[]) to authenticated;
grant execute on function public.import_teams(uuid, jsonb) to authenticated;
grant execute on function public.assign_heat_lanes(uuid, uuid[]) to authenticated;
grant execute on function public.start_heat(uuid) to authenticated;
grant execute on function public.claim_lane(uuid, int) to authenticated;
grant execute on function public.transfer_lane(uuid, uuid, text) to authenticated;
grant execute on function public.ingest_timing_events(jsonb) to authenticated;
grant execute on function public.void_timing_event(uuid, text) to authenticated;
grant execute on function public.public_leaderboard(text) to authenticated;
