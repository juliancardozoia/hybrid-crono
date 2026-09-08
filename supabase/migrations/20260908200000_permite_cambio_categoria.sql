-- Permite marcar una categoria como "se puede cambiar la categoria de un
-- equipo ya inscripto en ella", el mismo patron que `allows_member_swap` mas
-- arriba en esta tabla.
--
-- A DIFERENCIA de `allows_member_swap` (que solo aplica a equipos, team_size >
-- 1), esto aplica igual a categorias individuales: mover a un atleta de
-- categoria no depende de cuantos integrantes tenga.
--
-- Default false a proposito: cambiar la categoria de un equipo ya asignado a
-- un heat puede dejar carriles y resultados apuntando a una categoria que ya
-- no es la suya, asi que es una puerta que el organizador abre a proposito
-- para esta categoria, no un comportamiento activado solo.
alter table public.division_registration
  add column allows_division_change boolean not null default false;
