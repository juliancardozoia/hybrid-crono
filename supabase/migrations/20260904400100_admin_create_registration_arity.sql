-- `create or replace function` no reemplaza una funcion cuando cambia la
-- ARIDAD de sus parametros: la migracion anterior le agrego un cuarto
-- parametro (`p_estado`) a `admin_create_registration`, y eso no piso la
-- version vieja de 3 parametros -- quedaron dos funciones con el mismo
-- nombre, y una llamada con 3 argumentos paso a ser ambigua
-- ("function admin_create_registration(unknown, unknown, jsonb) is not
-- unique"). Se borra la firma vieja para que quede una sola.

drop function if exists public.admin_create_registration(uuid, text, jsonb);
