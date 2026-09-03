-- Arregla el borrado de un equipo que ya tiene carril asignado.
--
-- EL BUG
--
-- `lanes` referencia a `teams` con una FK COMPUESTA (team_id, event_id) y
-- ON DELETE SET NULL. Postgres, ante un SET NULL sobre una FK compuesta, anula
-- TODAS las columnas de la referencia — incluida event_id, que es NOT NULL.
--
-- Resultado: deleteTeam() en la app fallaba SIEMPRE que el atleta ya estuviera
-- asignado a un carril, con el mensaje ilegible
--
--   null value in column "event_id" of relation "lanes" violates not-null
--
-- que no dice nada de equipos ni de carriles. La intencion original era la
-- correcta: si se borra un equipo, su carril queda vacio pero sigue existiendo,
-- porque el carril es del heat y no del atleta.
--
-- Desde Postgres 15 se puede acotar el SET NULL a las columnas que uno quiere,
-- que es exactamente lo que hacia falta.

alter table public.lanes drop constraint lanes_team_id_event_id_fkey;

alter table public.lanes
  add constraint lanes_team_id_event_id_fkey
  foreign key (team_id, event_id)
  references public.teams (id, event_id)
  on delete set null (team_id);
