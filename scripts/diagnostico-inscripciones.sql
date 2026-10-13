-- Diagnostico de inscripciones de UNA competencia.
--
-- Uso: SQL Editor de Supabase. Cambia el id del evento en el CTE `ev` de la
-- consulta que vayas a correr (todas lo repiten para poder copiar una sola).
-- Para buscar el id:
--   select id, name, status from public.events order by created_at desc;
--
-- Todas son de SOLO LECTURA.


-- 1. Resumen: cuantas inscripciones hay en cada estado y por que camino entraron
with ev as (select '803e016d-c2a0-4b54-b6a0-c1cbd23b44bd'::uuid as id)
select r.status, r.source, count(*) as inscripciones
from public.registrations r, ev
where r.event_id = ev.id
group by 1, 2
order by 1, 2;


-- 2. Padron completo: una fila por integrante, con pago, waiver y dorsal
with ev as (select '803e016d-c2a0-4b54-b6a0-c1cbd23b44bd'::uuid as id)
select
  d.name                                        as categoria,
  r.status                                      as estado,
  r.source                                      as origen,
  t.bib_number                                  as dorsal,
  trim(coalesce(m.first_name,'') || ' ' || coalesce(m.last_name,'')) as atleta,
  m.invited_email                               as correo,
  m.document_id                                 as documento,
  m.phone                                       as telefono,
  m.profile_id is not null                      as tiene_cuenta,
  case when m.accepted_terms_at is null then 'PENDIENTE'
       when m.accepted_terms_offline_by is not null then 'offline (organizador)'
       else 'aceptado' end                      as waiver,
  r.price_cents / 100                           as precio,
  o.status                                      as orden,
  o.provider                                    as medio,
  r.created_at                                  as creada,
  r.confirmed_at                                as confirmada
from public.registrations r
cross join ev
join public.divisions d on d.id = r.division_id
join public.registration_members m on m.registration_id = r.id
left join public.teams t on t.id = r.team_id
left join public.orders o on o.registration_id = r.id
where r.event_id = ev.id
order by d.name, r.status, r.created_at;


-- 3. Waiver pendiente: confirmados que todavia no aceptaron los terminos.
-- Casi siempre son altas manuales del organizador sin la casilla "firmo
-- offline": la persona tiene que entrar con ESE correo y aceptar.
with ev as (select '803e016d-c2a0-4b54-b6a0-c1cbd23b44bd'::uuid as id)
select r.id as inscripcion, r.source as origen, r.status as estado,
       m.first_name, m.last_name, m.invited_email,
       m.profile_id is not null as tiene_cuenta
from public.registrations r
cross join ev
join public.registration_members m on m.registration_id = r.id
where r.event_id = ev.id
  and r.status <> 'cancelada'
  and m.accepted_terms_at is null;


-- 4. ERROR: confirmadas SIN equipo. Pasa cuando se borra el atleta desde
-- /atletas: el equipo se va pero el tramite queda "confirmado", sigue
-- ocupando cupo y aparece en Inscripciones.
with ev as (select '803e016d-c2a0-4b54-b6a0-c1cbd23b44bd'::uuid as id)
select r.id as inscripcion, r.source as origen, d.name as categoria,
       m.first_name, m.last_name, m.invited_email, m.document_id,
       r.confirmed_at
from public.registrations r
cross join ev
join public.divisions d on d.id = r.division_id
join public.registration_members m on m.registration_id = r.id
where r.event_id = ev.id
  and r.status = 'confirmada'
  and r.team_id is null;


-- 5. ERROR: con equipo pero NO confirmadas (el bug de "Ese lugar ya esta
-- ocupado", corregido el 2026-10-08). Deberia dar cero filas.
with ev as (select '803e016d-c2a0-4b54-b6a0-c1cbd23b44bd'::uuid as id)
select r.id, r.status, r.team_id
from public.registrations r, ev
where r.event_id = ev.id
  and r.team_id is not null
  and r.status not in ('confirmada', 'cancelada');


-- 6. Confirmadas CON precio pero sin orden pagada: se marcaron pagadas a mano
-- sin orden, o son altas manuales. Quedan en "incompleto" en vez de "listo".
with ev as (select '803e016d-c2a0-4b54-b6a0-c1cbd23b44bd'::uuid as id)
select r.id as inscripcion, r.source as origen,
       m.first_name, m.last_name, r.price_cents / 100 as precio,
       o.status as orden
from public.registrations r
cross join ev
join public.registration_members m on m.registration_id = r.id and m.position = 1
left join public.orders o on o.registration_id = r.id
where r.event_id = ev.id
  and r.status = 'confirmada'
  and coalesce(r.price_cents, 0) > 0
  and (o.id is null or o.status <> 'pagada');


-- 7. Esperando pago: quien falta cobrar, si ya eligio medio, si subio
-- comprobante, y si su reserva de cupo (15 min) ya vencio.
with ev as (select '803e016d-c2a0-4b54-b6a0-c1cbd23b44bd'::uuid as id)
select r.id as inscripcion, d.name as categoria,
       m.first_name, m.last_name, m.invited_email,
       r.created_at,
       o.status   as orden,
       o.provider as medio,
       (select count(*) from public.payment_attempts pa
         where pa.order_id = o.id and pa.receipt_url is not null) as comprobantes,
       r.hold_expires_at < now() as reserva_vencida
from public.registrations r
cross join ev
join public.divisions d on d.id = r.division_id
join public.registration_members m on m.registration_id = r.id and m.position = 1
left join public.orders o on o.registration_id = r.id
where r.event_id = ev.id
  and r.status = 'esperando_pago'
order by r.created_at;


-- 8. La misma persona en mas de un tramite activo (por documento o correo).
with ev as (select '803e016d-c2a0-4b54-b6a0-c1cbd23b44bd'::uuid as id),
personas as (
  select r.id as inscripcion, r.status, r.source, d.name as categoria,
         lower(trim(m.invited_email)) as correo,
         upper(trim(m.document_id))  as documento,
         trim(coalesce(m.first_name,'') || ' ' || coalesce(m.last_name,'')) as atleta
  from public.registrations r
  cross join ev
  join public.divisions d on d.id = r.division_id
  join public.registration_members m on m.registration_id = r.id
  where r.event_id = ev.id and r.status <> 'cancelada'
)
select a.atleta, a.correo, a.documento, a.categoria, a.status, a.source, a.inscripcion
from personas a
where exists (
  select 1 from personas b
  where b.inscripcion <> a.inscripcion
    and (b.correo = a.correo or (a.documento is not null and b.documento = a.documento))
)
order by a.documento, a.correo;


-- 9. Cupos por categoria: precio, cupo, confirmadas, esperando pago.
with ev as (select '803e016d-c2a0-4b54-b6a0-c1cbd23b44bd'::uuid as id)
select d.name as categoria,
       dr.price_cents / 100 as precio,
       dr.capacity as cupo,
       count(*) filter (where r.status = 'confirmada')        as confirmadas,
       count(*) filter (where r.status = 'confirmada' and r.team_id is null) as confirmadas_sin_equipo,
       count(*) filter (where r.status = 'esperando_pago')    as esperando_pago,
       public.cupos_disponibles(d.id) as cupos_libres
from public.divisions d
cross join ev
left join public.division_registration dr on dr.division_id = d.id
left join public.registrations r on r.division_id = d.id
where d.event_id = ev.id
group by d.id, d.name, dr.price_cents, dr.capacity
order by d.name;


-- 10. Equipos sin tramite y atletas sin equipo (CSV o restos de borrados).
with ev as (select '803e016d-c2a0-4b54-b6a0-c1cbd23b44bd'::uuid as id)
select 'equipo sin inscripcion' as caso, t.id::text, t.bib_number::text as detalle
from public.teams t, ev
where t.event_id = ev.id
  and not exists (select 1 from public.registrations r where r.team_id = t.id)
union all
select 'atleta sin equipo', a.id::text, a.email
from public.athletes a, ev
where a.event_id = ev.id
  and not exists (select 1 from public.team_members tm where tm.athlete_id = a.id);
