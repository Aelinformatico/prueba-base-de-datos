-- Migracion PostgreSQL para Supabase. Ejecutar con Supabase CLI o SQL Editor.

create table if not exists public.mediciones_meteorologicas (
  id bigint generated always as identity,
  ciudad text not null,
  fecha_hora timestamptz not null,
  temperatura_c double precision not null,
  humedad_pct double precision not null,
  precipitacion_mm double precision not null,
  importado_en timestamptz not null default now(),

  constraint mediciones_meteorologicas_pkey primary key (id),
  constraint mediciones_meteorologicas_ciudad_no_vacia
    check (btrim(ciudad) <> ''),
  constraint mediciones_meteorologicas_temperatura_finita
    check (
      temperatura_c > '-Infinity'::double precision
      and temperatura_c < 'Infinity'::double precision
    ),
  constraint mediciones_meteorologicas_humedad_valida
    check (humedad_pct >= 0 and humedad_pct <= 100),
  constraint mediciones_meteorologicas_precipitacion_valida
    check (
      precipitacion_mm >= 0
      and precipitacion_mm < 'Infinity'::double precision
    ),
  constraint mediciones_meteorologicas_ciudad_fecha_hora_key
    unique (ciudad, fecha_hora)
);

alter table public.mediciones_meteorologicas enable row level security;

revoke all on table public.mediciones_meteorologicas from anon, authenticated;
revoke all on sequence public.mediciones_meteorologicas_id_seq
  from anon, authenticated;

-- El acceso de lectura y escritura se realiza solo desde rutas de servidor.
-- No se crean politicas publicas; service_role conserva sus permisos de servicio.
