-- Claves foraneas que faltaban.
--
-- Aparecieron al verificar contra PostgREST, pero el problema es anterior y mas
-- serio que un embed roto: sin estas FK, `results` podia quedar apuntando a un
-- equipo o una division borrados. Nada lo impedia.
--
-- El sintoma visible fue que tres consultas de la app devolvian PGRST200 y por
-- lo tanto CERO filas, sin mostrar ningun error: el selector de jueces mostraba
-- UUIDs, el log de un carril no cargaba, y el export de resultados salia vacio.
--
-- PostgREST resuelve los embeds leyendo las claves foraneas. Si el modelo no
-- declara la relacion, la relacion no existe — ni para PostgREST ni para
-- Postgres.

-- --------------------------------------------------------------------------
-- results: integridad real, no solo para el embed
-- --------------------------------------------------------------------------

alter table public.results
  add constraint results_team_fk
  foreign key (team_id) references public.teams (id) on delete set null;

alter table public.results
  add constraint results_division_fk
  foreign key (division_id) references public.divisions (id) on delete set null;

-- --------------------------------------------------------------------------
-- profiles: para poder mostrar nombres en vez de UUIDs
-- --------------------------------------------------------------------------
--
-- Las dos columnas ya apuntan a auth.users. Agregar la FK hacia profiles no es
-- redundante: profiles es la tabla que la app PUEDE leer (auth.users no le esta
-- otorgada a `authenticated`), y es la unica forma de que PostgREST resuelva el
-- embed. El perfil siempre existe: lo crea un trigger al darse de alta el
-- usuario, antes de que pueda ser miembro de nada.

alter table public.org_members
  add constraint org_members_profile_fk
  foreign key (user_id) references public.profiles (id) on delete cascade;

alter table public.timing_events
  add constraint timing_events_recorded_by_profile_fk
  foreign key (recorded_by) references public.profiles (id) on delete restrict;
