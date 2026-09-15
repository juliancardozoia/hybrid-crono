-- ============================================================================
-- Borrado de atletas/inscripciones de UN evento desde una fecha de corte
-- ============================================================================
--
-- COMO USARLO
--   1) Completa los parametros en la seccion PARAMETROS de abajo (event_id
--      y fecha_corte).
--   2) Corre el script COMPLETO tal cual esta: termina en "rollback;", asi
--      que NO borra nada todavia. Te muestra, con SELECTs y con NOTICEs,
--      exactamente que se borraria y que cuentas se eliminarian. Revisalo
--      con calma antes de seguir.
--   3) Si todo esta bien, cambia la ULTIMA linea del archivo de "rollback;"
--      a "commit;" y corre el script de nuevo, completo. Recien ahi se
--      aplica de verdad.
--   4) Si el script aborta con un error (por ejemplo porque algun equipo ya
--      compitio), no se borro nada: la transaccion entera se descarta sola.
--      Lee el mensaje y resolvelo a mano antes de reintentar.
--
--   Hace un backup / punto de restauracion de la base antes de correrlo en
--   produccion con "commit;". Esto es irreversible una vez confirmado.
--
-- QUE HACE
--   - Busca las inscripciones (registrations) del evento indicado con
--     created_at >= fecha_corte.
--   - ABORTA sin tocar nada si algun equipo de esas inscripciones ya tiene
--     carril asignado (lanes), o ya tiene timing_events, results,
--     workout_scores, standings o stage_advancements: eso significa que ya
--     compitieron o ya estan asignados a un heat, y no es un simple borrado
--     de alta de prueba.
--   - Borra, en orden: team_members, athletes, teams, y las registrations
--     (que en cascada por FK ya definida en el esquema se llevan
--     registration_members, orders y payment_attempts).
--   - Para cada cuenta (profile) involucrada -capitan, integrantes
--     invitados, atletas materializados- borra profiles + auth.users SOLO
--     si esa persona no es dueña/miembro de ninguna organizacion, no es
--     staff de ningun evento, y no tiene ninguna otra registration,
--     integrante de inscripcion, atleta o marca de tiempo
--     (timing_events.recorded_by) fuera de lo que se acaba de borrar.
--     Si tiene otro uso, se deja la cuenta intacta y solo se le borraron
--     sus datos de ESTE atleta/inscripcion.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- PARAMETROS: completa esto antes de correr el script
-- ----------------------------------------------------------------------------
create temporary table _params on commit drop as
select
  '16cfb991-4a20-4666-8a0d-845a8afbc4ae'::uuid as event_id,
  '2026-09-01 00:00:00-05'::timestamptz        as fecha_corte;
  -- fecha_corte: se borran las registrations con created_at >= esta fecha.
  -- Escribi la hora con su zona horaria explicita (ej "-05" para Bogota) para
  -- no confundirte con UTC. Cambia tambien el event_id si hace falta.

-- ----------------------------------------------------------------------------
-- SNAPSHOT: que se va a borrar (calculado UNA sola vez, antes de tocar nada)
-- ----------------------------------------------------------------------------
create temporary table _registrations_a_borrar on commit drop as
select r.*
from registrations r
cross join _params p
where r.event_id = p.event_id
  and r.created_at >= p.fecha_corte;

create temporary table _teams_a_borrar on commit drop as
select t.*
from teams t
join _registrations_a_borrar r
  on r.team_id = t.id and r.event_id = t.event_id;

create temporary table _athletes_a_borrar on commit drop as
select distinct a.*
from athletes a
join team_members tm
  on tm.athlete_id = a.id and tm.event_id = a.event_id
join _teams_a_borrar t
  on t.id = tm.team_id and t.event_id = tm.event_id;

create temporary table _lanes_involucradas on commit drop as
select l.*
from lanes l
join _teams_a_borrar t
  on t.id = l.team_id and t.event_id = l.event_id;

create temporary table _profiles_candidatos on commit drop as
select distinct profile_id
from (
  select created_by as profile_id
  from _registrations_a_borrar
  where created_by is not null

  union

  select rm.profile_id
  from registration_members rm
  join _registrations_a_borrar r on r.id = rm.registration_id
  where rm.profile_id is not null

  union

  select profile_id
  from _athletes_a_borrar
  where profile_id is not null
) s;

-- ----------------------------------------------------------------------------
-- REPORTE: mira esto con atencion antes de decidir si commiteas
-- ----------------------------------------------------------------------------
select 'registrations a borrar' as detalle, count(*) as cantidad from _registrations_a_borrar
union all
select 'teams a borrar', count(*) from _teams_a_borrar
union all
select 'athletes a borrar', count(*) from _athletes_a_borrar
union all
select 'lanes YA asignadas a esos equipos (si hay, el script va a abortar)', count(*) from _lanes_involucradas
union all
select 'profiles candidatos a evaluar', count(*) from _profiles_candidatos;

select * from _registrations_a_borrar order by created_at;
select * from _teams_a_borrar order by created_at;
select * from _athletes_a_borrar order by created_at;

select rm.*
from registration_members rm
join _registrations_a_borrar r on r.id = rm.registration_id
order by 1;

select o.*
from orders o
join _registrations_a_borrar r on r.id = o.registration_id and r.event_id = o.event_id
order by 1;

-- ----------------------------------------------------------------------------
-- FRENO DE SEGURIDAD: aborta si ya hay actividad real de competencia
-- ----------------------------------------------------------------------------
do $$
declare
  v_lanes     int;
  v_timing    int;
  v_results   int;
  v_scores    int;
  v_standings int;
  v_avances   int;
begin
  select count(*) into v_lanes from _lanes_involucradas;

  select count(*) into v_timing
  from timing_events te
  join _lanes_involucradas l on l.id = te.lane_id and l.event_id = te.event_id;

  select count(*) into v_results
  from results r
  join _lanes_involucradas l on l.id = r.lane_id and l.event_id = r.event_id;

  select count(*) into v_scores
  from workout_scores ws
  join _teams_a_borrar t on t.id = ws.team_id and t.event_id = ws.event_id;

  select count(*) into v_standings
  from standings s
  join _teams_a_borrar t on t.id = s.team_id and t.event_id = s.event_id;

  select count(*) into v_avances
  from stage_advancements sa
  join _teams_a_borrar t on t.id = sa.team_id and t.event_id = sa.event_id;

  if v_lanes > 0 or v_timing > 0 or v_results > 0 or v_scores > 0
     or v_standings > 0 or v_avances > 0 then
    raise exception 'ABORTADO: hay actividad real de competencia en equipos del rango a borrar (lanes=%, timing_events=%, results=%, workout_scores=%, standings=%, stage_advancements=%). Revisa esos equipos a mano, este script no toca nada cuando ya corrieron o ya tienen carril asignado.',
      v_lanes, v_timing, v_results, v_scores, v_standings, v_avances;
  end if;

  raise notice 'Chequeo de actividad de competencia: OK, ningun equipo del rango tiene lanes, marcajes, resultados, scores ni avances de etapa.';
end $$;

-- ----------------------------------------------------------------------------
-- BORRADO: atletas, equipos e inscripciones
-- ----------------------------------------------------------------------------
-- team_members se borra explicito (aunque cascadea solo al borrar teams o
-- athletes) para que el log muestre cuantas filas se van.
delete from team_members tm
using _teams_a_borrar t
where tm.team_id = t.id and tm.event_id = t.event_id;

delete from athletes a
using _athletes_a_borrar x
where a.id = x.id and a.event_id = x.event_id;

delete from teams t
using _teams_a_borrar x
where t.id = x.id and t.event_id = x.event_id;

-- Esto se lleva en cascada, por las FK ya definidas en el esquema:
--   registration_members (via registration_id)
--   orders                (via registration_id + event_id)
--   payment_attempts      (via order_id -> orders)
delete from registrations r
using _registrations_a_borrar x
where r.id = x.id and r.event_id = x.event_id;

-- ----------------------------------------------------------------------------
-- CUENTAS: borra profiles + auth.users SOLO si quedaron sin ningun otro uso
-- ----------------------------------------------------------------------------
-- Las consultas de abajo corren DESPUES de borrar lo de arriba, asi que
-- automaticamente excluyen lo que se acaba de eliminar: si un profile ya no
-- aparece en ningun lado, es porque su unico rastro era justo esto.
create temporary table _profiles_seguros on commit drop as
select pc.profile_id
from _profiles_candidatos pc
where not exists (select 1 from org_members om where om.user_id = pc.profile_id)
  and not exists (select 1 from event_staff es where es.user_id = pc.profile_id)
  and not exists (select 1 from registrations r where r.created_by = pc.profile_id)
  and not exists (select 1 from registration_members rm where rm.profile_id = pc.profile_id)
  and not exists (select 1 from athletes a where a.profile_id = pc.profile_id)
  and not exists (select 1 from timing_events te where te.recorded_by = pc.profile_id);

select
  pc.profile_id,
  (ps.profile_id is not null) as se_va_a_borrar
from _profiles_candidatos pc
left join _profiles_seguros ps on ps.profile_id = pc.profile_id
order by 1;

-- Borrar de auth.users cascadea a profiles (profiles.id references
-- auth.users(id) on delete cascade). Requiere correr esto como postgres /
-- service role (el SQL Editor de Supabase alcanza).
delete from auth.users u
using _profiles_seguros ps
where u.id = ps.profile_id;

-- ----------------------------------------------------------------------------
-- RESUMEN FINAL
-- ----------------------------------------------------------------------------
do $$
declare
  v_regs  int;
  v_teams int;
  v_ath   int;
  v_profs int;
begin
  select count(*) into v_regs  from _registrations_a_borrar;
  select count(*) into v_teams from _teams_a_borrar;
  select count(*) into v_ath   from _athletes_a_borrar;
  select count(*) into v_profs from _profiles_seguros;
  raise notice 'Se borraron % registrations, % teams, % athletes y % cuenta(s) (profiles/auth.users).',
    v_regs, v_teams, v_ath, v_profs;
end $$;

-- ----------------------------------------------------------------------------
-- POR DEFECTO NO SE APLICA NADA. Revisa todo lo de arriba.
-- Cuando estes seguro/a, cambia esta linea por: commit;
-- ----------------------------------------------------------------------------
rollback;
