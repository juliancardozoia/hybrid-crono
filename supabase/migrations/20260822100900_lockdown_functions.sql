-- Cierre de la superficie de RPC.
--
-- La migracion anterior revoco privilegios `from anon, authenticated` y no
-- alcanzo. Motivo: en Postgres las funciones se crean con EXECUTE otorgado a
-- **PUBLIC**, y anon lo hereda de ahi. Revocar de un rol puntual no toca el
-- privilegio que llega por PUBLIC.
--
-- Y esto importa mas de lo que parece: Supabase publica TODA funcion del schema
-- public como endpoint REST. Sin este cierre, cualquiera con la anon key (que es
-- publica por diseño) podia hacer POST a /rest/v1/rpc/claim_lane,
-- /rest/v1/rpc/import_teams o /rest/v1/rpc/ingest_timing_events.
--
-- Las funciones igual verifican permisos por dentro y auth.uid() seria null,
-- asi que habrian fallado. Pero eso es la ultima linea de defensa, no la
-- primera: lo correcto es que ni siquiera puedan invocarse.

revoke all on all functions in schema public from public;

-- Nada de lo de abajo es opcional: son las funciones que la app llama de verdad
-- y las que usan las politicas RLS (una politica que llama a user_org_role()
-- necesita que el usuario tenga EXECUTE sobre ella).
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

-- Lo unico que el publico puede invocar.
grant execute on function public.public_leaderboard(text) to anon;

-- Las funciones de trigger (touch_updated_at, add_creator_as_owner,
-- handle_new_user) quedan a proposito sin ningun grant: los triggers se
-- disparan con los privilegios del dueño de la tabla y no necesitan EXECUTE,
-- asi que otorgarlo solo las expondria como endpoint REST.
