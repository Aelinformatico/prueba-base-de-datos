# MeteoLab · práctica de pipeline ETL

Aplicación didáctica para extraer el histórico horario de Open-Meteo, transformar y limpiar arrays paralelos, filtrar y seleccionar filas, y cargarlas en Supabase.

## Puesta en marcha

1. Copia `.env.example` a `.env.local` y completa las credenciales del proyecto Supabase. La clave `SUPABASE_SERVICE_ROLE_KEY` es secreta y solo se usa en rutas de servidor; nunca debe llevar el prefijo `NEXT_PUBLIC_`.
2. Ejecuta la migración `supabase/migrations/20261027000000_mediciones_meteorologicas.sql` en el SQL Editor de Supabase o con Supabase CLI.
3. Ejecuta `npm run dev` y abre [http://localhost:3001](http://localhost:3001). El servidor de producción (`npm start`) también utiliza el puerto 3001.

La migración activa RLS, revoca permisos directos de `anon` y `authenticated` y no añade políticas públicas. La lectura y escritura se hacen en servidor con la clave de servicio. El proyecto no tiene autenticación: el flujo se habilita para desarrollo local; antes de publicar, protege los endpoints con autenticación y controles de acceso.

## Flujo y reglas

- Open-Meteo Archive API: datos horarios en GMT/UTC, temperatura en °C y precipitación en mm; máximo de 31 días por petición.
- Cada respuesta original se conserva durante la sesión y puede descargarse. Una ciudad fallida se puede reintentar sin duplicar sus filas normalizadas.
- Los arrays deben tener longitudes coherentes. Valores ausentes, nulos y no numéricos se rechazan; humedad debe estar entre 0 y 100 y precipitación ser no negativa. No se aplican límites arbitrarios a la temperatura.
- Para duplicados por ciudad y fecha/hora se conserva la primera fila. Las filas rechazadas incluyen motivo y valores originales.
- El orden es válidos → filtros → ordenación → selección → carga. Al cambiar filtros, una fila ya seleccionada solo se carga si sigue cumpliéndolos. Los filtros nuevos no seleccionan filas automáticamente.
- Cada lote contiene como máximo 500 filas, usa upsert por `(ciudad, fecha_hora)` y verifica en destino las claves remitidas. Se conserva el resultado de cada lote para reintentar fallidos. Upsert no permite distinguir de forma fiable insertados de actualizados.
- La vista de Supabase es una consulta real paginada. La base de datos no promete conservar el orden de inserción; las consultas deben usar `ORDER BY`.

## Verificación

Comandos disponibles: `npm run typecheck`, `npm run lint` y `npm run build`. Para una extracción de un día por ciudad se esperan 24 horas UTC, sujeto a disponibilidad de Open-Meteo. Las comprobaciones de nulos y duplicados se pueden hacer aislando fixtures en pruebas locales; no se mezclan con extracciones reales. La integración de carga y lectura requiere las variables de entorno y la migración aplicadas. No se debe considerar una respuesta local de extracción como confirmación de persistencia.
