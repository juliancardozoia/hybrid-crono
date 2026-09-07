-- Limpieza total de datos, pedida explicitamente por el organizador antes de
-- pasar a produccion real: borra TODAS las competencias de TODAS las
-- organizaciones y todo lo que entro por la aplicacion (atletas, equipos,
-- inscripciones, pagos, tiempos, resultados). Las cuentas de usuario
-- (auth.users) se borran aparte, con la Admin API de Supabase -- no por SQL
-- directo -- para que GoTrue limpie tambien sesiones e identidades.
--
-- QUE NO SE TOCA, Y POR QUE: `movements` (catalogo global de movimientos de
-- CrossFit) y las filas de `scoring_tables` con `org_id is null` (las tablas
-- de puntos de fabrica: CF-Games 40, CF-Games 80, CF-Open, Tiempo total) no
-- son datos de ninguna organizacion -- son catalogo de la plataforma, del
-- mismo tipo que un enum. `scoring_tables` no se puede truncar entera porque
-- mezcla filas globales (org_id null) con filas propias de una organizacion
-- en la MISMA tabla: se borran solo estas ultimas con un DELETE filtrado, en
-- vez de una tabla que arrastraria tambien las de fabrica.
--
-- Es intencionalmente una operacion de UNA SOLA VEZ, no un patron a repetir.
-- TRUNCATE sobre tablas vacias es un no-op seguro, asi que esta migracion no
-- rompe nada si se vuelve a aplicar contra una base nueva (un clon, los tests
-- de PGlite): ahi no hay nada que borrar.

truncate table
  public.timing_events,
  public.lane_audit,
  public.lanes,
  public.heats,
  public.workout_score_audit,
  public.workout_scores,
  public.standings,
  public.part_movements,
  public.part_divisions,
  public.part_blocks,
  public.workout_parts,
  public.workouts,
  public.division_movement_specs,
  public.division_movements,
  public.division_segment_specs,
  public.result_publications,
  public.results,
  public.registration_fields,
  public.registration_members,
  public.registrations,
  public.division_registration,
  public.discount_codes,
  public.orders,
  public.payment_attempts,
  public.payment_providers,
  public.billing_accounts,
  public.team_members,
  public.teams,
  public.athletes,
  public.segments,
  public.course_templates,
  public.divisions,
  public.event_documents,
  public.event_staff_divisions,
  public.event_staff,
  public.arenas,
  public.penalty_types,
  public.events,
  public.org_invitations,
  public.org_members,
  public.organizations,
  public.profiles
cascade;

-- Las 3-4 tablas de puntos de fabrica tienen org_id null: no se tocan. Si
-- alguna organizacion llego a crear una tabla propia, esta es la unica que
-- se borra (nunca existio ninguna al momento de escribir esto).
delete from public.scoring_tables where org_id is not null;
