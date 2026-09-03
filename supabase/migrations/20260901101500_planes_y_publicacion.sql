-- Planes: que separa el gratuito del pago, y donde se hace cumplir.
--
-- EL CORTE NO ES POR FORMATO NI POR CAPTURA: ES POR VISIBILIDAD
--
-- En el plan gratuito el juez de Hyrox cronometra IGUAL, con la misma app
-- offline, y los resultados se consolidan igual. Lo que no se puede es
-- exhibirlos: nada de leaderboard en vivo, nada de parciales, nada de catalogo
-- publico. Y en CrossFit los resultados se cargan a mano en vez de juzgarse en
-- vivo.
--
-- Dicho al reves: lo que se compra es MOSTRAR, y JUZGAR CROSSFIT EN VIVO. No se
-- le quita a nadie la capacidad de cronometrar su competencia.
--
-- POR QUE TRIGGERS Y NO CHECKS
--
-- Un CHECK no puede consultar otra tabla: Postgres deja escribirlo dentro de una
-- funcion, pero no lo revalida cuando cambia la fila de la que depende, y un
-- volcado restaurado en otro orden falla sin explicacion. La regla "esta parte
-- necesita plan pro" mira `organizations.plan`, que vive tres tablas mas alla.
-- Va en un trigger, que corre justo cuando la decision importa: al escribir.
--
-- Y va en Postgres y no en la server action porque una server action se saltea
-- con una llamada directa a PostgREST usando la misma sesion del organizador.

-- PL001: EL CODIGO DE ERROR DE LOS LIMITES DEL PLAN
--
-- Todo lo que rebota por el plan levanta el SQLSTATE `PL001` en vez del
-- `check_violation` generico. No es capricho: la app traduce `23514` a "algun
-- valor esta fuera de rango", que es correcto para un CHECK roto y pesimo para
-- "esto es del plan Pro". Con un codigo propio, el mensaje del servidor se
-- muestra tal cual y al lado va el enlace para cambiar de plan.
--
-- Postgres acepta cualquier SQLSTATE de cinco caracteres alfanumericos; los que
-- empiezan con letras fuera del rango estandar son para el usuario.

-- ---------------------------------------------------------------------------
-- El medio de cobro del organizador
-- ---------------------------------------------------------------------------
--
-- OJO: esto NO es `payment_providers`. Son dos cosas opuestas y confundirlas
-- seria caro:
--
--   payment_providers  con que le cobra el ORGANIZADOR a sus atletas. La plata
--                      va directo a el; nosotros no la tocamos.
--   billing_accounts   con que le cobramos NOSOTROS al organizador el plan.
--
-- Nunca guardamos un numero de tarjeta. Se guarda el TOKEN que devuelve la
-- pasarela al tokenizar: sirve para cobrar aca y no sirve para nada mas. Un
-- volcado completo de esta base no le permite a nadie usar esa tarjeta en otro
-- comercio, que es exactamente el motivo por el que la tokenizacion existe.

create table public.billing_accounts (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- Quien tokenizo. Todavia no cobramos: la facturacion se define despues.
  provider text not null check (length(trim(provider)) > 0),
  card_token text not null check (length(trim(card_token)) > 0),
  -- Lo unico que se le muestra al organizador, para que reconozca su tarjeta.
  card_brand text,
  card_last4 text check (card_last4 ~ '^[0-9]{4}$'),
  card_exp_month int check (card_exp_month between 1 and 12),
  card_exp_year int check (card_exp_year between 2024 and 2100),
  holder_name text,
  -- Datos de facturacion. Cambian por pais, y por eso son texto libre.
  tax_id text,
  billing_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Un evento activo por organizacion en el plan gratuito
-- ---------------------------------------------------------------------------
--
-- "Activo" es el que se esta corriendo: `ready`, `live` o `verifying`. Los
-- borradores no cuentan —preparar cinco competencias en paralelo no le cuesta
-- nada a nadie— y los `published` tampoco, porque ya terminaron.
--
-- El limite es "una competencia a la vez", no "una competencia en la vida". Un
-- box que hace una fecha por mes vive entero en el plan gratuito, y eso es a
-- proposito: el que necesita pagar es el que corre dos cosas el mismo dia o el
-- que quiere aparecer en el catalogo.

create or replace function public.limitar_eventos_activos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.org_plan;
  v_otro text;
begin
  if new.status not in ('ready', 'live', 'verifying') then
    return new;
  end if;

  -- Salir temprano cuando el estado no cambio evita pagar la consulta en cada
  -- update de un evento que ya estaba activo.
  if tg_op = 'UPDATE' and old.status = new.status then
    return new;
  end if;

  select plan into v_plan from public.organizations where id = new.org_id;
  if v_plan <> 'free' then
    return new;
  end if;

  select e.name into v_otro
  from public.events e
  where e.org_id = new.org_id
    and e.id <> new.id
    and e.status in ('ready', 'live', 'verifying')
  limit 1;

  if v_otro is not null then
    raise exception
      'El plan gratuito corre una competencia a la vez, y "%" todavia esta activa', v_otro
      using errcode = 'PL001';
  end if;

  return new;
end;
$$;

create trigger events_limitar_activos
  before insert or update of status on public.events
  for each row execute function public.limitar_eventos_activos();

-- ---------------------------------------------------------------------------
-- Juzgar un WOD en vivo es del plan pro
-- ---------------------------------------------------------------------------
--
-- El circuito queda AFUERA de la restriccion, y ese es el punto entero del
-- modelo: `time_scheme = 'circuito'` se juzga en vivo en los dos planes. Es la
-- promesa que le hicimos a quien ya usaba la app para cronometrar su Hyrox.

create or replace function public.capture_en_vivo_requiere_pro()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.org_plan;
begin
  if new.capture_mode <> 'en_vivo' or new.time_scheme = 'circuito' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.capture_mode = new.capture_mode
     and old.time_scheme = new.time_scheme then
    return new;
  end if;

  select o.plan into v_plan
  from public.events e
  join public.organizations o on o.id = e.org_id
  where e.id = new.event_id;

  if coalesce(v_plan, 'free') = 'free' then
    raise exception
      'Juzgar un WOD en vivo es del plan Pro. En el gratuito los resultados se cargan a mano.'
      using errcode = 'PL001';
  end if;

  return new;
end;
$$;

create trigger workout_parts_en_vivo_requiere_pro
  before insert or update of capture_mode, time_scheme on public.workout_parts
  for each row execute function public.capture_en_vivo_requiere_pro();

-- ---------------------------------------------------------------------------
-- Aparecer en el catalogo es del plan pro
-- ---------------------------------------------------------------------------
--
-- `publish_event` se redefine entera en vez de agregarle un trigger a `events`:
-- el chequeo tiene que dar un mensaje que diga que hacer, y un trigger sobre
-- `published_at` tambien se dispararia al despublicar.

create or replace function public.publish_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_evento public.events;
  v_plan public.org_plan;
begin
  if not coalesce(public.can_manage_event(p_event_id), false) then
    raise exception 'Solo la organizacion puede publicar una competencia'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_evento from public.events where id = p_event_id;

  -- Una competencia sin fecha o sin categorias en el catalogo es peor que no
  -- estar: el atleta la abre y no puede hacer nada.
  if v_evento.starts_at is null then
    raise exception 'Falta la fecha de la competencia';
  end if;

  if not exists (select 1 from public.divisions where event_id = p_event_id) then
    raise exception 'Falta crear al menos una categoria';
  end if;

  select plan into v_plan from public.organizations where id = v_evento.org_id;
  if v_plan = 'free' then
    raise exception
      'El catalogo publico es del plan Pro. Tu competencia funciona igual, pero no aparece listada.'
      using errcode = 'PL001';
  end if;

  update public.events
  set published_at = coalesce(published_at, now())
  where id = p_event_id
  returning * into v_evento;

  return v_evento;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cambiar de plan
-- ---------------------------------------------------------------------------

create or replace function public.guardar_medio_de_cobro(
  p_org_id uuid,
  p_provider text,
  p_card_token text,
  p_card_brand text default null,
  p_card_last4 text default null,
  p_card_exp_month int default null,
  p_card_exp_year int default null,
  p_holder_name text default null,
  p_tax_id text default null,
  p_billing_email text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(public.user_org_role(p_org_id) in ('owner', 'admin'), false) is not true then
    raise exception 'Solo el dueno de la organizacion configura el medio de cobro'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.billing_accounts as b (
    org_id, provider, card_token, card_brand, card_last4,
    card_exp_month, card_exp_year, holder_name, tax_id, billing_email
  ) values (
    p_org_id, p_provider, p_card_token, p_card_brand, p_card_last4,
    p_card_exp_month, p_card_exp_year, p_holder_name, p_tax_id, p_billing_email
  )
  on conflict (org_id) do update set
    provider = excluded.provider,
    card_token = excluded.card_token,
    card_brand = excluded.card_brand,
    card_last4 = excluded.card_last4,
    card_exp_month = excluded.card_exp_month,
    card_exp_year = excluded.card_exp_year,
    -- Los datos de facturacion se conservan si vienen vacios: cambiar la
    -- tarjeta no deberia borrar el NIT.
    holder_name = coalesce(excluded.holder_name, b.holder_name),
    tax_id = coalesce(excluded.tax_id, b.tax_id),
    billing_email = coalesce(excluded.billing_email, b.billing_email),
    updated_at = now();
end;
$$;

create or replace function public.activar_plan_pro(p_org_id uuid)
returns public.org_plan
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(public.user_org_role(p_org_id) in ('owner', 'admin'), false) is not true then
    raise exception 'Solo el dueno de la organizacion cambia el plan'
      using errcode = 'insufficient_privilege';
  end if;

  -- Sin medio de cobro no hay plan pago. Es lo unico que separa "quiero" de
  -- "puedo": el cobro en si se define despues.
  if not exists (select 1 from public.billing_accounts where org_id = p_org_id) then
    raise exception 'Falta registrar una tarjeta antes de activar el plan Pro'
      using errcode = 'PL001';
  end if;

  update public.organizations set plan = 'pro' where id = p_org_id;
  return 'pro';
end;
$$;

-- Volver a gratuito NO se puede a mitad de una competencia.
--
-- Si se pudiera, un evento en vivo perderia su leaderboard publico en el peor
-- momento posible, con el proyector encendido. Es la unica restriccion del
-- downgrade: terminada la competencia se cancela sin drama.
create or replace function public.cancelar_plan_pro(p_org_id uuid)
returns public.org_plan
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_corriendo text;
begin
  if coalesce(public.user_org_role(p_org_id) in ('owner', 'admin'), false) is not true then
    raise exception 'Solo el dueno de la organizacion cambia el plan'
      using errcode = 'insufficient_privilege';
  end if;

  select name into v_corriendo
  from public.events
  where org_id = p_org_id and status in ('live', 'verifying')
  limit 1;

  if v_corriendo is not null then
    raise exception 'No se puede volver al plan gratuito con "%" en curso', v_corriendo
      using errcode = 'PL001';
  end if;

  update public.organizations set plan = 'free' where id = p_org_id;
  return 'free';
end;
$$;

-- ---------------------------------------------------------------------------
-- Que le falta a este evento por el plan
-- ---------------------------------------------------------------------------
--
-- Una sola llamada que responde las preguntas del panel: si puede publicarse,
-- si puede juzgar WODs en vivo, y si el cupo gratuito esta ocupado.
--
-- No se agrego a `event_config_issues` a proposito. Aquella responde "¿esta bien
-- configurada esta competencia?" y sus filas son cosas para arreglar. El plan no
-- es un error de configuracion: es una decision comercial, y mezclarlas haria
-- que un evento gratuito perfectamente valido apareciera con errores.
create or replace function public.event_plan_status(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_plan public.org_plan;
begin
  select e.org_id, o.plan
  into v_org_id, v_plan
  from public.events e
  join public.organizations o on o.id = e.org_id
  where e.id = p_event_id;

  if v_org_id is null or public.event_role(p_event_id) is null then
    return null;
  end if;

  return jsonb_build_object(
    'plan', v_plan,
    'puedePublicar', v_plan = 'pro',
    'puedeJuzgarEnVivo', v_plan = 'pro',
    'muestraEnVivo', v_plan = 'pro',
    -- Cuantas competencias de la organizacion ocupan el cupo, sin contar esta.
    'otrasActivas', (
      select count(*)
      from public.events e2
      where e2.org_id = v_org_id
        and e2.id <> p_event_id
        and e2.status in ('ready', 'live', 'verifying')
    ),
    -- Pruebas que el plan gratuito obliga a cargar a mano.
    'pruebasManualesForzadas', case when v_plan = 'free' then (
      select count(*)
      from public.workout_parts p
      where p.event_id = p_event_id and p.time_scheme <> 'circuito'
    ) else 0 end,
    'tieneTarjeta', exists (select 1 from public.billing_accounts where org_id = v_org_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------------

alter table public.billing_accounts enable row level security;

create policy billing_accounts_read on public.billing_accounts
  for select using (coalesce(public.user_org_role(org_id) in ('owner', 'admin'), false));

revoke all on public.billing_accounts from anon, authenticated;
-- `card_token` queda FUERA del grant, igual que `payment_providers.secret_ciphertext`.
-- Un `grant select on billing_accounts` a secas lo incluiria, y el token saldria
-- por PostgREST a cualquiera que pueda leer la fila entera.
grant select (
  org_id, provider, card_brand, card_last4, card_exp_month, card_exp_year,
  holder_name, tax_id, billing_email, created_at, updated_at
) on public.billing_accounts to authenticated;

select public.apply_function_lockdown();
