-- Cierra la misma clase de bug que ya arreglo el borrado de un equipo con
-- carril: **una FK compuesta con ON DELETE SET NULL anula TODAS sus columnas**,
-- incluida la que es NOT NULL.
--
-- El patron `(algo_id, event_id) references padre (id, event_id)` se repite en
-- todo el esquema porque RLS necesita llegar al evento sin joins. Cuando esa FK
-- es SET NULL, borrar el padre intenta poner `event_id = null` en la hija y la
-- operacion falla con un mensaje que no menciona ni la tabla ni la accion que
-- la provoco:
--
--   null value in column "event_id" of relation "heats" violates not-null
--
-- Lo que se rompia en la practica:
--
--   heats          borrar una categoria que ya tiene un heat asignado.
--   timing_events  quitar un segmento del circuito despues de que alguien lo
--                  cronometro.
--
-- Desde Postgres 15 el SET NULL se puede acotar a las columnas que uno quiere,
-- que es lo que la intencion original pedia: se pierde la referencia, se
-- conserva el evento.

alter table public.heats drop constraint heats_division_id_event_id_fkey;

alter table public.heats
  add constraint heats_division_id_event_id_fkey
  foreign key (division_id, event_id)
  references public.divisions (id, event_id)
  on delete set null (division_id);

alter table public.timing_events drop constraint timing_events_segment_id_event_id_fkey;

-- El marcaje sobrevive al segmento a proposito: el reductor resuelve los
-- parciales por POSICION y no por segment_id, asi que un marcaje huerfano sigue
-- contando. Borrarlo en cascada perderia un tiempo, que es lo unico que el
-- producto no puede permitirse.
alter table public.timing_events
  add constraint timing_events_segment_id_event_id_fkey
  foreign key (segment_id, event_id)
  references public.segments (id, event_id)
  on delete set null (segment_id);
