-- Pagos.
--
-- LA PLATAFORMA NO CUSTODIA PLATA
--
-- Cada organizador pone SUS credenciales y el dinero le llega directo a el.
-- Nosotros no somos intermediarios de fondos: guardamos la configuracion,
-- armamos la orden, escuchamos al proveedor y marcamos la inscripcion como
-- paga. Esa decision saca del alcance toda la regulacion de custodia de dinero
-- de doce paises, que es la razon por la que se tomo.
--
-- DONDE ESTAN LOS SECRETOS
--
-- `payment_providers.secret_ciphertext` guarda un texto cifrado con AES-256-GCM
-- por la APLICACION (ver src/features/pagos/lib/cifrado.ts). La llave vive en
-- el entorno del servidor, nunca en la base. Un volcado completo de la base no
-- alcanza para cobrar en nombre de nadie.
--
-- Ademas, esa columna NO tiene GRANT de select para `authenticated`: ni siquiera
-- el texto cifrado sale por PostgREST. Solo el service role la lee, dentro de
-- las funciones del servidor que arman un cobro.

create type public.payment_provider as enum (
  'transferencia',
  'efectivo',
  'paypal',
  'mercadopago',
  'addi'
);

create type public.order_status as enum (
  'pendiente',
  'pagada',
  'fallida',
  'reembolsada',
  'vencida'
);

create type public.discount_kind as enum ('porcentaje', 'monto');

-- ---------------------------------------------------------------------------
-- Las credenciales del organizador
-- ---------------------------------------------------------------------------

create table public.payment_providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  provider public.payment_provider not null,
  -- "Bancolombia ahorros", "Cuenta PayPal del club". Distingue dos configuraciones
  -- del mismo proveedor.
  label text,
  -- Lo que NO es secreto y la pantalla de pago necesita mostrar: el numero de
  -- cuenta a transferir, el titular, el client id publico.
  public_config jsonb not null default '{}'::jsonb,
  -- Cifrado por la app. La base no ve el texto plano ni la llave.
  secret_ciphertext text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index payment_providers_unico
  on public.payment_providers (org_id, provider, coalesce(label, ''));
create index payment_providers_org_idx on public.payment_providers (org_id) where active;

create trigger payment_providers_touch_updated_at
  before update on public.payment_providers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Codigos de descuento
-- ---------------------------------------------------------------------------

create table public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  code text not null check (code ~ '^[A-Za-z0-9_-]{3,32}$'),
  kind public.discount_kind not null,
  -- Porcentaje (1..100) o centavos, segun kind.
  value int not null check (value > 0),
  -- Null = aplica a todas las categorias.
  division_id uuid,
  max_uses int check (max_uses > 0),
  used_count int not null default 0 check (used_count >= 0),
  valid_from timestamptz,
  valid_to timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint descuento_porcentaje_valido
    check (kind <> 'porcentaje' or value between 1 and 100),
  constraint descuento_ventana
    check (valid_from is null or valid_to is null or valid_from <= valid_to),
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete cascade
);

-- Case-insensitive: nadie escribe un cupon respetando mayusculas.
create unique index discount_codes_unico on public.discount_codes (event_id, upper(code));

-- ---------------------------------------------------------------------------
-- La orden
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- Una inscripcion tiene UNA orden. Reintentar un pago no crea otra: agrega un
  -- intento.
  registration_id uuid not null unique,
  status public.order_status not null default 'pendiente',
  amount_cents int not null check (amount_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  discount_code_id uuid references public.discount_codes (id) on delete set null,
  discount_cents int not null default 0 check (discount_cents >= 0),
  -- Derivado: nunca se escribe a mano, asi no puede quedar desalineado del
  -- monto y el descuento.
  total_cents int generated always as (greatest(0, amount_cents - discount_cents)) stored,
  provider public.payment_provider,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (registration_id, event_id)
    references public.registrations (id, event_id) on delete cascade
);

create index orders_event_idx on public.orders (event_id, status);

create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- El rastro de todo lo que dijo el proveedor.
--
-- Append-only, como timing_events y por la misma razon: cuando un atleta dice
-- "yo pagué" hay que poder mostrar exactamente que llego, cuando y con que
-- identificador. `raw` guarda la respuesta cruda sin interpretarla.
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  provider public.payment_provider not null,
  -- Id del pago en la pasarela. Es la clave de idempotencia del webhook.
  external_id text,
  status text not null,
  amount_cents int,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index payment_attempts_order_idx on public.payment_attempts (order_id, created_at desc);
-- Un webhook que llega dos veces no se registra dos veces.
create unique index payment_attempts_externo_unico
  on public.payment_attempts (provider, external_id) where external_id is not null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.payment_providers enable row level security;
alter table public.discount_codes enable row level security;
alter table public.orders enable row level security;
alter table public.payment_attempts enable row level security;

-- La configuracion de cobro la ve y la escribe quien administra la organizacion.
create policy payment_providers_read on public.payment_providers
  for select using (public.can_admin_org(org_id));
create policy payment_providers_write on public.payment_providers
  for all using (public.can_admin_org(org_id))
  with check (public.can_admin_org(org_id));

create policy discount_codes_read on public.discount_codes
  for select using (public.event_role(event_id) is not null);
create policy discount_codes_write on public.discount_codes
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

-- La orden la ve quien se inscribio y la organizacion. La escritura no tiene
-- politica: pasa por las funciones.
create policy orders_read on public.orders
  for select using (
    public.event_role(event_id) is not null
    or public.puede_ver_inscripcion(registration_id)
  );

create policy payment_attempts_read on public.payment_attempts
  for select using (public.can_manage_event(event_id));

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------

revoke all on public.payment_providers from anon, authenticated;
revoke all on public.discount_codes from anon, authenticated;
revoke all on public.orders from anon, authenticated;
revoke all on public.payment_attempts from anon, authenticated;

-- OJO CON LA LISTA DE COLUMNAS.
--
-- `secret_ciphertext` queda FUERA del grant de select a proposito: ni siquiera
-- el texto cifrado sale por PostgREST. Un `grant select on payment_providers`
-- a secas lo incluiria, y este es exactamente el tipo de descuido que la
-- migracion de lockdown existe para evitar.
grant select (id, org_id, provider, label, public_config, active, created_at, updated_at)
  on public.payment_providers to authenticated;
grant insert, update, delete on public.payment_providers to authenticated;

grant select, insert, update, delete on public.discount_codes to authenticated;
grant select on public.orders to authenticated;
grant select on public.payment_attempts to authenticated;

select public.apply_function_lockdown();
