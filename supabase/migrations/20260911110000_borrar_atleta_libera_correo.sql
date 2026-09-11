-- Bug reportado: quitar un atleta y volver a crearlo con el mismo correo
-- decia "ese correo ya fue registrado".
--
-- Causa: "Quitar equipo" (deleteTeam, en features/athletes/actions.ts) solo
-- borraba la fila de `teams`. `athletes` NO se borra en cascada a proposito
-- --el mismo atleta puede estar en OTRO equipo-- asi que la fila de
-- `athletes` (con su email y su DNI) quedaba huerfana para siempre. Contra
-- `athletes_email_unico` / `athletes_document_unico`
-- (20260904200000_atletas_sin_duplicados.sql), esa fila huerfana sigue
-- ocupando el correo, y el alta manual siguiente choca con "23505" aunque
-- el atleta ya no aparezca en ningun lado de la pantalla.
--
-- La solucion no es borrar `athletes` en cascada desde `teams` --eso
-- rompería al atleta que sigue en otro equipo-- sino borrar, al quitar un
-- equipo, solo los atletas que se quedan SIN NINGUN equipo despues de
-- sacarlo. Va en una funcion de Postgres (no un `.delete()` desde la app)
-- por la misma razon que `assign_heat_lanes`: el chequeo de "se quedo sin
-- equipo" y el borrado tienen que ser atomicos, sin ventana entre verificar
-- y actuar.
create or replace function public.delete_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
begin
  select event_id into v_event_id from public.teams where id = p_team_id;
  if v_event_id is null then
    raise exception 'El equipo no existe';
  end if;

  if not coalesce(public.can_manage_event(v_event_id), false) then
    raise exception 'No tenés permiso para quitar equipos de esta competencia'
      using errcode = 'insufficient_privilege';
  end if;

  -- Se borran los atletas de ESTE equipo que no tienen ninguna otra fila en
  -- team_members: los que siguen en otro equipo del evento se conservan.
  -- Correr esto ANTES de borrar el equipo es lo que hace que "team_id <>
  -- p_team_id" alcance para detectar "sin equipo" -- el propio team_members
  -- de este equipo todavia existe en este punto.
  delete from public.athletes a
  where a.event_id = v_event_id
    and a.id in (
      select tm.athlete_id from public.team_members tm where tm.team_id = p_team_id
    )
    and not exists (
      select 1 from public.team_members tm2
      where tm2.athlete_id = a.id and tm2.team_id <> p_team_id
    );

  -- Borra el equipo; team_members del equipo cae en cascada (los que
  -- quedaban, de atletas que siguen en otro equipo).
  delete from public.teams where id = p_team_id;
end;
$$;

select public.apply_function_lockdown();
