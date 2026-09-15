-- El atleta puede reportar una transferencia con su comprobante.
--
-- Hasta ahora el unico camino para una transferencia era que el organizador se
-- enterara por fuera de la app (WhatsApp, mirar la cuenta) y confirmara a mano
-- con `confirmar_pago_manual`, escribiendo el una referencia el mismo. El
-- atleta no tenia ninguna accion para decir "ya pague" ni forma de dejar
-- evidencia dentro de la plataforma.
--
-- `reportar_pago_manual` es la mitad que faltaba: la llama el ATLETA (dueno de
-- la inscripcion), deja un `payment_attempts` en 'pendiente' -- nunca
-- 'aprobado' -- con el comprobante adjunto. Sigue siendo el organizador, y
-- solo el, quien aprueba via `confirmar_pago_manual`. Un gateway con tarjeta no
-- pasa por aca: ese sigue aprobando unicamente por webhook con firma
-- verificada.

alter table public.payment_attempts add column receipt_url text;

-- ---------------------------------------------------------------------------
-- El atleta ve sus propios intentos, no solo el organizador
-- ---------------------------------------------------------------------------
--
-- La politica original solo dejaba pasar a `can_manage_event`: un atleta no
-- podia ver ni su propio comprobante ya subido. Se agrega la misma via que ya
-- usa `orders_read` (dueno o integrante de la inscripcion), resuelta contra la
-- orden porque `payment_attempts` no tiene `registration_id` propia.

drop policy if exists payment_attempts_read on public.payment_attempts;
create policy payment_attempts_read on public.payment_attempts
  for select using (
    public.can_manage_event(event_id)
    or exists (
      select 1 from public.orders o
      where o.id = payment_attempts.order_id
        and public.puede_ver_inscripcion(o.registration_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Reportar el pago
-- ---------------------------------------------------------------------------

create or replace function public.reportar_pago_manual(
  p_order_id uuid,
  p_receipt_url text,
  p_referencia text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orden public.orders;
begin
  select * into v_orden from public.orders where id = p_order_id;
  if not found then
    raise exception 'La orden no existe';
  end if;

  -- Solo quien es parte de la inscripcion puede reportar su propio pago. La
  -- aprobacion sigue siendo exclusiva de `confirmar_pago_manual`, que exige
  -- `can_manage_event` -- esta funcion nunca toca `orders.status`.
  if not coalesce(public.puede_ver_inscripcion(v_orden.registration_id), false) then
    raise exception 'No puedes reportar el pago de una inscripción ajena'
      using errcode = 'insufficient_privilege';
  end if;

  -- Insercion directa, no via `registrar_intento_de_pago`: esa funcion no
  -- conoce `receipt_url` y no vale la pena agregarselo -- es el camino del
  -- WEBHOOK, que nunca trae un comprobante. Sin id externo a proposito: el
  -- atleta puede volver a subir un comprobante mas claro sin que el segundo
  -- reporte choque contra el primero.
  insert into public.payment_attempts (
    order_id, event_id, provider, status, receipt_url, amount_cents, raw
  )
  values (
    p_order_id, v_orden.event_id, 'transferencia', 'pendiente', p_receipt_url,
    v_orden.total_cents,
    jsonb_build_object('reportadoPor', auth.uid(), 'referencia', p_referencia)
  );

  return v_orden;
end;
$$;

-- ---------------------------------------------------------------------------
-- El bucket de comprobantes
-- ---------------------------------------------------------------------------
--
-- NO es el bucket `eventos`: aquel es publico y de escritura exclusiva del
-- organizador (logo, portada, documentos). Un comprobante de transferencia
-- puede mostrar un numero de cuenta o el nombre de quien pago, asi que el
-- bucket es PRIVADO -- se lee con URL firmada, nunca con URL publica -- y lo
-- sube el propio atleta, no el organizador.
--
-- La carpeta es el id de la INSCRIPCION (no del evento): es el mismo criterio
-- que ya usa `avatars` con el uuid del usuario, y es lo que la politica valida
-- antes de castear.

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    -- PGlite no trae la extension de Storage de Supabase -- ver el mismo guard
    -- en `archivos_del_evento`.
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('comprobantes', 'comprobantes', false, 10485760,
          array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute $pol$
    drop policy if exists comprobantes_lectura on storage.objects;
    create policy comprobantes_lectura on storage.objects
      for select to authenticated
      using (
        bucket_id = 'comprobantes'
        and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        and (
          public.puede_ver_inscripcion(((storage.foldername(name))[1])::uuid)
          or exists (
            select 1 from public.registrations r
            where r.id = ((storage.foldername(name))[1])::uuid
              and public.can_manage_event(r.event_id)
          )
        )
      );
  $pol$;

  execute $pol$
    drop policy if exists comprobantes_escritura on storage.objects;
    create policy comprobantes_escritura on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'comprobantes'
        and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        and coalesce(public.puede_ver_inscripcion(((storage.foldername(name))[1])::uuid), false)
      );
  $pol$;
end
$$;

select public.apply_function_lockdown();
