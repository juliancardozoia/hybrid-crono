-- Perfiles publicos.
--
-- `auth.users` no es legible por el rol `authenticated`, asi que sin esta tabla
-- la app no puede mostrar el nombre de un juez en ningun lado: ni en el selector
-- de carriles, ni en "quien registro este marcaje" cuando un resultado se
-- discute. Mostrar un UUID no es una opcion.
--
-- Se mantiene sincronizada por trigger, que es el patron estandar de Supabase.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Mantiene el email al dia si el usuario lo cambia.
create trigger on_auth_user_updated
after update of email on auth.users
for each row execute function public.handle_new_user();

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

-- SECURITY DEFINER para no anidar la evaluacion de RLS de org_members dentro de
-- la politica de profiles.
create or replace function public.shares_org_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members mios
    join public.org_members ajenos on ajenos.org_id = mios.org_id
    where mios.user_id = auth.uid()
      and ajenos.user_id = p_user_id
  );
$$;

alter table public.profiles enable row level security;

-- Se ve el perfil propio y el de quienes comparten organizacion. Un organizador
-- no tiene por que ver el padron de otra organizacion.
create policy profiles_read on public.profiles
  for select using (
    id = auth.uid() or public.shares_org_with(id)
  );

create policy profiles_update_own on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

grant select, update on public.profiles to authenticated;
grant execute on function public.shares_org_with(uuid) to authenticated;
