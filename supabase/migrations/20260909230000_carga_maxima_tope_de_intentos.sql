-- Carga maxima (esquema `sin_reloj`) no tenia ningun tope de intentos: el
-- reductor solo cierra un carril avanzando `stepIndex` con eventos `rep` /
-- `movement_done` / `round_done`, y un intento de carga maxima se registra
-- con `lift`, que nunca toca ese contador. Resultado: la pantalla del juez
-- dejaba registrar intentos para siempre, sin ningun estado terminal.
--
-- El estandar de halterofilia (y de las pruebas de carga maxima de CrossFit)
-- es 3 intentos por movimiento, el mejor valido cuenta. `max_attempts` lo hace
-- configurable por movimiento en vez de fijarlo a 3 en el codigo: default 3,
-- pero un organizador puede cargar 1 o 5 si asi lo decide su reglamento.
alter table public.part_movements
  add column max_attempts int not null default 3 check (max_attempts >= 1);
