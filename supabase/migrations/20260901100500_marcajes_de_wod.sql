-- Los marcajes de un WOD de CrossFit.
--
-- POR QUE SOLO SE AGREGAN VALORES AL ENUM
--
-- Un `rep` y un `segment_split` son la MISMA fila de timing_events. Comparten
-- el id generado en el cliente (y por lo tanto la idempotencia del reenvio), el
-- elapsed relativo a la largada, el supersedes_id para corregir, el flag
-- voided para anular con motivo, y el mismo GRANT que hace la tabla
-- append-only. Lo unico que cambia es el `type` y lo que viaja en `payload`.
--
-- Por eso esta migracion no agrega ni una columna ni un privilegio: la tabla
-- mas sensible del producto se queda exactamente como estaba. `ingest_timing_events`
-- acepta los tipos nuevos sin tocarla, porque castea contra este enum.
--
-- A que movimiento apunta cada marca va en `payload.partMovementId`. Podria ser
-- una columna con su FK, pero eso significaria alterar timing_events y sumarle
-- una relacion; el reductor ya tolera referencias huerfanas y las reporta como
-- anomalia, que es el mismo trato que le da a un undo sin objetivo.

-- Una repeticion valida. payload: { partMovementId, round }
alter type public.timing_event_type add value if not exists 'rep';

-- Repeticion no valida. No suma y queda registrada, que es lo que hace
-- auditable un reclamo. payload: { partMovementId, round, motivo? }
alter type public.timing_event_type add value if not exists 'no_rep';

-- Cierre del movimiento en curso, para no marcar cien wall balls de a una.
-- payload: { partMovementId, round, cantidad? }
alter type public.timing_event_type add value if not exists 'movement_done';

-- Cierre de la ronda: saltea lo que quedo sin marcar. payload: { round }
alter type public.timing_event_type add value if not exists 'round_done';

-- Intento de levantamiento. payload: { intento, loadKg, valido }
alter type public.timing_event_type add value if not exists 'lift';

-- Hito de desempate. Lo emite la pantalla sola al cerrar el movimiento marcado
-- como tal: el juez no da un tap extra.
alter type public.timing_event_type add value if not exists 'tiebreak';

-- Se alcanzo el tope de tiempo. Es INFORMATIVO: el cap lo deriva el reductor
-- comparando el elapsed contra el tope, porque si la app quedo en segundo plano
-- cuando sono el cap no hay nadie que emita este evento.
alter type public.timing_event_type add value if not exists 'time_cap';
