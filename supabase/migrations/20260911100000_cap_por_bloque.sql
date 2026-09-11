-- Tope de tiempo POR BLOQUE de trabajo, medido desde que ese bloque arranca
-- -no desde la largada del heat-.
--
-- Resuelve el caso real: "30 clean and jerk, cap 8 min, descanso 1 min,
-- thruster por tiempo sin cap" como UNA sola prueba (un solo score, un solo
-- puesto en el leaderboard), en vez de partirla en Parte A / Parte B. Partida
-- en dos partes, el cap de la Parte B se median contra el reloj GLOBAL del
-- heat (la largada), no contra cuando arrancaba esa parte: si la Parte A
-- usaba el cap completo mas el descanso, el cap de la Parte B ya estaba
-- vencido antes de que el atleta la empezara. Ver `reduceWodEventsConDescanso`
-- en src/shared/timing/wod.ts.
--
-- Solo tiene efecto en bloques que no son 'descanso' -ahi el tiempo fijo es
-- `duracion_ms`, que ya existe- y solo lo lee el reductor cuando la parte
-- tiene AL MENOS un bloque `descanso`: una prueba de un solo bloque de
-- trabajo (la enorme mayoria de las ya cargadas) sigue exactamente igual,
-- porque esta columna nace en null para todas.
alter table public.part_blocks
  add column cap_ms int check (cap_ms > 0);

alter table public.part_blocks
  add constraint cap_ms_no_en_descanso
    check (kind <> 'descanso' or cap_ms is null);
