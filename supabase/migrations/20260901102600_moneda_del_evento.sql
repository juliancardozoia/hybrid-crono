-- La moneda es de la COMPETENCIA, no de cada categoria.
--
-- Estaba en `division_registration.currency`, una por categoria, y eso solo
-- tiene sentido si alguien cobra Elite en dolares y Amateur en pesos. Nadie hace
-- eso: se cobra en la moneda del pais donde se corre, y punto. Lo que si pasaba
-- era el error — seis categorias, seis desplegables, y uno quedaba en COP
-- cuando los otros cinco decian CLP.
--
-- Ademas la moneda gobierna a los MEDIOS DE COBRO, que son uno solo por
-- organizador: no se puede tener una pasarela cobrando en dolares y otra en
-- pesos para la misma competencia. Preguntarla por categoria prometia una
-- flexibilidad que la pasarela no tiene.
--
-- `division_registration.currency` NO se borra: la lee el motor de ordenes y
-- hay filas cargadas. Pasa a ser un espejo de la del evento, que se mantiene con
-- un trigger.

alter table public.events
  add column currency text not null default 'COP'
    check (currency ~ '^[A-Z]{3}$');

-- Las que ya existen heredan lo que tenian cargado sus categorias, para no
-- cambiarle el precio a nadie por una migracion.
update public.events e
set currency = coalesce(
  (select dr.currency
   from public.division_registration dr
   where dr.event_id = e.id
   group by dr.currency
   order by count(*) desc
   limit 1),
  'COP'
);

-- El espejo. Sin esto, una categoria creada despues de cambiar la moneda del
-- evento nace en COP y cobra en la moneda equivocada.
create or replace function public.categoria_hereda_moneda()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  select e.currency into new.currency
  from public.events e where e.id = new.event_id;
  return new;
end;
$$;

create trigger division_registration_moneda
  before insert or update of event_id on public.division_registration
  for each row execute function public.categoria_hereda_moneda();

-- Y al reves: cambiar la moneda del evento la baja a las categorias que ya
-- existen. Es lo que hace que el desplegable de la pantalla de inscripciones
-- gobierne de verdad.
create or replace function public.bajar_moneda_a_categorias()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.currency is distinct from old.currency then
    update public.division_registration
    set currency = new.currency
    where event_id = new.id;
  end if;
  return new;
end;
$$;

create trigger events_bajar_moneda
  after update of currency on public.events
  for each row execute function public.bajar_moneda_a_categorias();

select public.apply_function_lockdown();
