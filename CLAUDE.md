# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es esto

App de cronometraje para competencias de fitness por tiempo (tipo Hyrox): un juez marca los
parciales de un atleta con el celular, y el tiempo total se **deriva** de esos marcajes en vez de
escribirse a mano. Reemplaza la planilla de papel y la transcripción manual a Excel.

Estado actual: **fases 1 a 6 completas.** Supabase conectado y con el esquema aplicado.
Cronómetro offline (falta validarlo en un celular real), configuración de competencia completa,
y la PWA del juez conectada a la base: toma de carril, sincronización real y largada del heat
servida por el servidor, y los resultados en vivo: leaderboard público, vista de proyector y
vista de atleta por dorsal, y la verificación: torre de control, cola de anomalías, publicación
oficial congelada, export a CSV y QR imprimibles. Falta la **fase 7**: el ensayo general con
jueces reales, y validar el cronómetro en un celular. El plan completo por fases está en
`C:\Users\julian.cardozo\.claude\plans\quiero-desarrollar-una-aplicacion-dynamic-puddle.md`.

## Comandos

```bash
npm run dev          # desarrollo (Turbopack, sin service worker)
npm run build        # producción — OJO: usa --webpack a propósito, ver abajo
npm start            # sirve el build de producción
npm test             # Vitest, una corrida
npm run test:watch   # Vitest en watch
npm run typecheck    # tsc de la app + tsc del service worker
npm run lint         # eslint
```

```bash
# Supabase (necesita .env.local con las claves del proyecto)
npx supabase link --project-ref <ref>
npx supabase db push                    # aplica supabase/migrations
npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
npx supabase db advisors --linked --type security
npm run verify:remote              # consultas + seguridad, contra la base real
```

`database.types.ts` es **generado**: se sobrescribe entero. Los alias con nombre que usa la app
viven en `src/lib/supabase/types.ts`, y es de ahí que hay que importar.

Correr un solo test: `npx vitest run src/shared/timing/reducer.test.ts`
Solo los de base de datos: `npx vitest run supabase/tests` (tardan ~40s: cada archivo levanta
un Postgres y aplica todas las migraciones)
Un solo caso: `npx vitest run -t "las penalizaciones cambian el podio"`

**Las pruebas offline exigen build de producción** (`npm run build && npm start`): el service
worker está deshabilitado en dev a propósito, porque cachear el shell esconde los cambios.

## El requisito que gobierna todo

Una vez que un atleta arrancó, su tiempo no se pierde nunca — ni si se cae el internet, ni si el
juez cierra la app, ni si el celular se reinicia. **Cualquier cambio que toque el cronómetro, la
persistencia o la sincronización se evalúa contra ese requisito antes que contra cualquier otra
consideración.**

## Las cuatro decisiones que sostienen la arquitectura

Están implementadas y son load-bearing. No las cambies sin entender por qué existen.

### 1. Los tiempos son `elapsedMs`, nunca reloj de pared

Todo marcaje se guarda como milisegundos desde la largada del heat
(`src/shared/timing/types.ts`). El ranking solo necesita tiempo transcurrido, así que un celular
con la hora mal o un heat que arrancó sin señal siguen produciendo resultados exactos.
`clientCapturedAt` guarda el reloj de pared **solo para auditoría** — nunca lo uses para rankear.

### 2. El elapsed se deriva de un ancla, no se acumula

`src/shared/timing/clock.ts`. Se persiste el ancla y el tiempo se recalcula en cada frame:

```
elapsed = (performance.now() - capturedPerfMs) + (capturedEpochMs - heatStartEpochMs)
```

Nunca escribas un contador que se incrementa: se desincroniza cuando la pestaña se congela.
`rehydrateAnchor()` es lo que hace que refresh, reapertura y reboot devuelvan el tiempo correcto —
`performance.now()` arranca de cero en cada documento nuevo, así que hay que re-anclar.

### 3. Log append-only: nada se edita ni se borra

`src/shared/timing/reducer.ts`. Un marcaje equivocado no se borra: se agrega un evento que lo
anula vía `supersedesId`. El total no existe como campo editable en ningún lado — sale de
`reduceLaneEvents()`, que es **pura y corre igual en cliente y servidor**. Si agregás lógica de
scoring, va ahí y en ningún otro lado, o cliente y servidor van a divergir.

### 4. Escribir en IndexedDB antes de tocar la red

`src/features/judge/lib/db.ts` → `src/features/judge/lib/sync.ts`. El camino de todo tap es:

```
tap → uuid del cliente → IndexedDB → UI optimista → cola de sync
```

El UUID lo genera el cliente y es la clave de idempotencia. El servidor hace
`ON CONFLICT (id) DO NOTHING`, así que reenviar un lote N veces deja N=1 registros. **El juez
nunca espera por la red.**

## Regla de rendimiento: el reloj no pasa por React

Una carrera dura 90 minutos. Re-renderizar el árbol 60 veces por segundo todo ese rato le funde
la batería al juez, que es justo el recurso que no se puede gastar.

`LiveClock` y `Countdown` (en `src/features/judge/components/`) escriben `textContent` directo al
nodo del DOM con `requestAnimationFrame` / `setInterval`. El store de Zustand
(`src/features/judge/lib/store.ts`) guarda **solo estado durable** — lo que cambia cuando el juez
toca algo. Si agregás un valor que cambia continuamente, seguí este patrón, no lo metas al store.

## La autorización vive en Postgres, no en la app

Ninguna garantía de seguridad depende de que el cliente se porte bien. Si agregás una tabla,
agregale RLS y GRANTs explícitos en la misma migración.

- **Helpers**: `event_role(event_id)`, `can_manage_event()`, `can_verify_event()` en
  `20260822100000_foundation.sql`. Son `SECURITY DEFINER` a propósito: las políticas de
  `org_members` la consultan a ella misma y sin definer entrarían en recursión.
- **La inmutabilidad del log es un GRANT, no una política.** `timing_events` le da `select` e
  `insert` a `authenticated` y **no** le da `update` ni `delete`. Ni el organizador puede editar
  un tiempo a mano. Anular pasa por `void_timing_event()`, que exige motivo y rol.
- **Los privilegios se cierran explícitamente** en `20260822100800` y `20260822100900`. Leelas
  antes de agregar una tabla o una función: sin ellas, Supabase y Postgres las dejan abiertas.
- **El bloqueo de carril es un UPDATE condicional** (`claim_lane`), no un check-then-act. No hay
  ventana entre verificar y tomar.
- **El público no toca ninguna tabla.** `anon` no tiene GRANTs; el leaderboard sale por
  `public_leaderboard(slug)`, que es `SECURITY DEFINER` y expone solo lo que el atleta necesita.

## Los privilegios NO se otorgan solos: se cierran

Dos defaults que trabajan en contra, y que costaron dos huecos reales detectados recién al
probar contra el proyecto de verdad:

1. **Supabase aplica `alter default privileges in schema public grant all on tables to anon,
   authenticated`.** Toda tabla nueva nace con SELECT/INSERT/UPDATE/DELETE para los dos roles.
   Un `grant select, insert` en tu migración es **aditivo**: no le quita nada a nadie. Así fue
   como `authenticated` terminó con UPDATE y DELETE sobre `timing_events` en producción.
2. **Postgres crea las funciones con `EXECUTE` otorgado a `PUBLIC`.** Revocar `from anon` no
   sirve, porque el privilegio le llega heredado: hay que revocar `from public`. Y Supabase
   expone toda función del schema public como endpoint REST, así que sin eso cualquiera con la
   anon key podía hacer POST a `/rest/v1/rpc/import_teams`.

   Y esto pasa en **cada** `create function`, no una sola vez: un revoke puntual solo cierra lo
   que existía en ese momento. Por eso existe `apply_function_lockdown()`
   (`20260822101200`), que aplica la política de forma repetible según el nombre:

   | Función | Quién puede ejecutarla |
   |---|---|
   | devuelve `trigger` | nadie (los triggers no necesitan EXECUTE) |
   | `public_*` | `anon` y `authenticated` |
   | cualquier otra | solo `authenticated` |

   **Toda migración que agregue funciones tiene que terminar con
   `select public.apply_function_lockdown();`**, y las funciones públicas se nombran `public_*`.

**Si agregás una tabla o una función, agregá su GRANT explícito en la misma migración y corré
`node scripts/verify-security.mjs`**, que comprueba contra la base real que el anónimo no llega
a ninguna tabla ni a ninguna RPC interna.

## Los tests de base NO cubren los embeds de PostgREST

Esta fue la brecha más cara del proyecto. Conviene entenderla antes de escribir una consulta.

`supabase/tests/` corre sobre PGlite, que es Postgres real pero **no tiene PostgREST**. Los
embeds de supabase-js (`teams (...)`, `heats (...)`) los resuelve PostgREST leyendo las claves
foráneas. Un embed inválido **pasa los 219 tests** y devuelve `PGRST200` en producción — y como
el código hace `data ?? []`, la pantalla queda vacía **sin mostrar ningún error**.

Así estuvo rota la pantalla del juez desde que se escribió: `lanes` no tiene FK directa a
`events` (solo compuestas hacia `heats` y `teams`), el embed `events (...)` fallaba, y la
pantalla decía "no hay carriles". Otras cuatro consultas tenían el mismo problema.

**Si agregás o cambiás una consulta con embeds, agregala a
[scripts/verify-queries.mjs](scripts/verify-queries.mjs) y corré `npm run verify:remote`.** Es la
única red que lo atrapa antes de que lo vea un juez.

La regla de fondo: **PostgREST solo conoce las relaciones que el esquema declara.** Si un embed
falla, casi siempre falta una FK — y esa FK probablemente también hacía falta para la integridad
de los datos. Fue el caso de `results.team_id` y `results.division_id`, que no tenían ninguna.

## Tests de base de datos

`supabase/tests/` levanta un **Postgres real en proceso** (PGlite) y le aplica las migraciones.
No hace falta Supabase ni Docker.

El detalle que hace que sirvan: PGlite corre como superusuario, y **los superusuarios saltean
RLS**. `harness.ts` replica los roles de Supabase y ejecuta como `authenticated`. Usá siempre
`asUser` / `asAnon` / `asAdmin` — una query suelta corre como superusuario y pasa sin probar nada.

`asUser(db, null)``asUser(db, null)` **no** es un anónimo: es `authenticated` sin usuario, que sí tiene GRANTs.
Para el camino público real usá `asAnon`.

El harness replica los **default privileges de Supabase** a propósito (ver `SUPABASE_STUB`). Sin
esa parte era más restrictivo que producción, y los tests pasaban afirmando garantías que en el
proyecto real no existían. Si lo tocás, que sea para acercarlo a producción, nunca para alejarlo.

El harness replica los **default privileges de Supabase** a propósito. Sin esa línea era más
restrictivo que producción, y los tests pasaban afirmando garantías que en el proyecto real no
existían. Si tocás `SUPABASE_STUB`, que sea para acercarlo a producción, nunca para alejarlo.

## Estructura

```
src/shared/timing/     motor puro: tipos, ancla del reloj, reductor. Sin DOM, sin React.
                       Es lo que más tests tiene y donde vive la corrección del producto.
src/features/judge/    PWA del juez: db (Dexie), sync (outbox), store, componentes
src/features/auth/     login, registro, cierre de sesión
src/features/org/       organizaciones y membresías
src/features/events/   config de competencia (queries/actions), acceso por rol, plantillas
src/features/athletes/ import CSV (lógica pura + tests) y alta manual
src/features/heats/    armado de heats, carriles y jueces
src/lib/supabase/      clientes (browser/server/service), middleware de sesión, tipos
src/app/panel/         shell del organizador
src/app/juez/          selección de carril (server) y cronómetro (estático, offline)
src/app/en-vivo/       leaderboard público, proyector y vista de atleta
src/features/leaderboard/  consultas públicas, sus pantallas y los QR
src/features/verification/ torre de control, cola de anomalías, publicación y recálculo
src/app/spike/         pantalla del juez + inspector del servidor
src/app/api/spike/     ingesta en memoria — SOLO SPIKE, reemplazada por ingest_timing_events
supabase/migrations/   esquema completo
supabase/tests/        tests de RLS y funciones contra Postgres real
```

## La ruta del cronómetro es estática a propósito

`/juez/carril` recibe el carril por **query string** (`?id=`), no por segmento de ruta. No es
capricho: una ruta dinámica se renderiza en el servidor y no se puede precachear, así que un
juez que reinicia el celular sin señal y vuelve a abrir la app no vería nada.

La página es estática, el service worker la sirve del caché, y todo lo que necesita —circuito,
penalizaciones, dorsal, largada del heat— sale de IndexedDB (`lib/bundle.ts`), que se llenó la
primera vez que se abrió con conexión. **Si convertís esa ruta a dinámica, rompés el offline.**

La selección de carril (`/juez`) sí es dinámica, y está bien: se elige el carril con señal,
antes de que largue el heat.

## Los resultados son caché, el log es la verdad

`results` se puede borrar entera y reconstruirse desde `timing_events`. La reconstrucción vive
en [/api/resultados/recalcular](src/app/api/resultados/recalcular/route.ts) y corre
`reduceLaneEvents`, **la misma función pura que usa el celular del juez**. No hay una segunda
implementación del cálculo en SQL ni en la ruta: si el tiempo en vivo y el oficial pudieran
diferir, el producto entero pierde sentido.

El recálculo lo dispara el juez al sincronizar (fire-and-forget: si falla, el marcaje ya está
guardado igual). La ruta usa el service role para escribir `results`, pero **solo después de
verificar con el cliente del usuario que el carril es suyo** — RLS decide, el service role
ejecuta.

**El leaderboard público refresca por polling, no por Realtime.** El rol anónimo no tiene
permisos sobre ninguna tabla y `postgres_changes` exige SELECT para suscribirse. Abrirle
`results` al público para ganar unos segundos sería cambiar superficie de seguridad por una
latencia que a nadie le importa: un atleta cruza la meta cada varios minutos.

## Cosas que te van a morder

- **`npm run build` usa `--webpack` a propósito.** Serwist 9 emite el service worker vía webpack
  y Next 16 va con Turbopack por defecto; con Turbopack el build falla. `@serwist/turbopack`
  existe pero es experimental, y la base offline del producto no se apoya en algo experimental.
  Dev sigue en Turbopack (ahí el SW está deshabilitado igual).
- **El service worker tiene su propio tsconfig** (`tsconfig.sw.json`): necesita las libs de
  WebWorker, que chocan con las del DOM. `npm run typecheck` corre los dos.
- **`public/sw.js` es generado** y está en `.gitignore`. No lo edites; editá `src/app/sw.ts`.
- **Dexie no puede instanciarse en el servidor.** Por eso `getDb()` es un singleton perezoso que
  tira error fuera del navegador. No muevas la instancia a scope de módulo.
- **`toLocaleTimeString` en una página de servidor usa el huso de Vercel, que es UTC.** Un heat
  largado a las 20:55 en Bogotá se mostraba como `1:55` —del día siguiente— en la torre de control,
  justo la pantalla donde alguien mira el reloj para decidir. El evento ya guarda su huso
  (`events.timezone`, default `America/Bogota`) porque una competencia pasa en un lugar concreto:
  toda hora de reloj va por `horaEnEvento()` / `fechaHoraEnEvento()` de
  [src/shared/utils/fecha.ts](src/shared/utils/fecha.ts). Nunca `toLocale*` suelto.

  Esto es solo para horas de **reloj**. El tiempo de carrera no tiene huso: es `elapsedMs` y se
  formatea con `formatElapsed`, que es justamente por qué el ranking sobrevive a un celular con la
  hora mal.

- **React 19 resetea el `<form>` cuando termina una acción, y eso borra selectores
  controlados.** Al completarse una acción de formulario, React llama al `form.reset()` **nativo**
  (`recursivelyResetForms` en react-dom). React fija el valor de un `<select>` por *propiedad*, no
  por atributo, así que el reset lo manda a la primera opción. Y como el estado de React no cambió,
  el render siguiente no encuentra ninguna diferencia que aplicar y **nunca vuelve a escribir el
  DOM**: el estado dice "equipo A" y la pantalla muestra "vacío".

  Costó tres intentos porque el síntoma —"se guarda pero desaparece hasta que refresco"— apunta al
  guardado o a la consulta, y las dos estaban bien. Lo que se perdía era el DOM, no el dato.

  Si un control tiene que **conservar** lo que el usuario acaba de guardar, no lo pongas dentro de
  un `<form action={...}>`: invocá la acción a mano con `startTransition(() => accion(formData))`
  (ver `HeatCard.tsx`). En formularios donde limpiar sí es lo deseado —login, alta, invitación— el
  reset es un beneficio y el `<form>` está bien.

- **El linter de React 19 rechaza `setState` síncrono dentro de un `useEffect`.** Si te lo marca,
  el arreglo correcto suele ser `useSyncExternalStore` (ver `useOnlineStatus.ts`) o mover el
  `setState` a un callback, no un `eslint-disable`.
- **El middleware va en `src/middleware.ts`, no en la raíz.** Con directorio `src/`, Next.js
  ignora un `middleware.ts` raíz **sin avisar**: no hay error ni warning, simplemente no corre.
  Costó descubrirlo porque las páginas protegidas igual redirigían por su propio guard — lo que
  no corría era el **refresco de sesión**, así que los tokens vencían a la hora y el usuario se
  caía sin motivo aparente. Si el build no imprime `ƒ Proxy (Middleware)`, no se está aplicando.
- **`/api/spike/ingest` guarda en memoria** y se vacía al reiniciar el server de dev. En Vercel
  además es poco confiable: las funciones serverless son efímeras.

### Trampas de SQL y tipos que ya nos mordieron

Cada una de estas costó un bug real. Están documentadas en el código donde aplican.

- **`x in ('a','b')` con `x` NULL devuelve NULL, no false.** En una política RLS eso se trata como
  false y no hay drama, pero en plpgsql `if not NULL then` **no entra al bloque**: un guard
  escrito así deja pasar justo a quien no es miembro. Los helpers usan `coalesce(..., false)`.
- **Una política RLS nunca debe re-consultar su propia tabla.** Durante un `insert ... returning`
  la fila nueva todavía no es visible para esa consulta y la inserción falla. Usá las columnas de
  la propia fila (`events` chequea `org_id`, no `event_role(id)`).
- **`insert().select()` exige que la fila pase también la política de SELECT.** Si la lectura
  depende de algo que crea un trigger `after insert`, hace falta una alternativa en la política
  (ver `organizations_read`).
- **`database.types.ts` se declara con `type`, nunca con `interface`.** Las interfaces no reciben
  index signature implícita, así que no son asignables al `Record<string, GenericTable>` que
  exige supabase-js. Compila igual, pero el cliente queda sin tipar y todo se infiere `never`.
- **`position` es palabra reservada** en la lista de columnas de un `returns table`.
- **Las operaciones multi-fila van en una función de Postgres, no en varios `.insert()`.**
  supabase-js no tiene transacciones: `import_teams` y `assign_heat_lanes` existen para que un
  fallo a mitad de camino no deje medio padrón cargado ni un heat a medio armar.
- **Reordenar filas con `unique(padre, orden)` choca a mitad de camino.** `reorder_segments`
  corre todos los índices fuera de rango primero (sumando, no restando: hay un
  `check (order_index >= 0)`) y después asigna los definitivos.

## Convenciones

- Todo el código, comentarios y UI en **español** (sin tildes en comentarios de código, por
  consistencia con lo que ya está escrito).
- Los comentarios explican **por qué**, no qué. La mayoría de los que hay documentan una decisión
  que parece rara hasta que sabés qué falla sin ella.
- Tests: Vitest para lógica pura en `src/shared/timing/`. Ahí la cobertura tiene que ser alta —
  es donde un bug se traduce en un podio equivocado.
- **Tests de componente**: los `.test.tsx` corren con Testing Library y piden jsdom con
  `// @vitest-environment jsdom` en la primera línea; el entorno por defecto sigue siendo `node`
  para no pagar el DOM en la lógica pura ni en los tests de base. Se usan para lo que solo se rompe
  en el navegador —el ciclo de vida de un formulario, por ejemplo—, no para pintar markup: hay que
  mockear la acción de servidor (`vi.mock("../actions")`) porque un `"use server"` no corre acá.
