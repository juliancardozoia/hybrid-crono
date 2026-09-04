# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es esto

App de cronometraje para competencias de fitness por tiempo (tipo Hyrox): un juez marca los
parciales de un atleta con el celular, y el tiempo total se **deriva** de esos marcajes en vez de
escribirse a mano. Reemplaza la planilla de papel y la transcripción manual a Excel.

Estado actual: **fases 1 a 6 completas, mas las fases 8 a 16 del plan de plataforma.**

> **Todas las migraciones estan aplicadas en Supabase** y `database.types.ts` es el archivo
> generado de verdad. `npm run seed:dev` deja la base con datos para recorrer el producto entero;
> imprime los usuarios y que probar.

Cronómetro offline (falta validarlo en un celular real), configuración de competencia completa,
y la PWA del juez conectada a la base: toma de carril, sincronización real y largada del heat
servida por el servidor, y los resultados en vivo: leaderboard público, vista de proyector y
vista de atleta por dorsal, y la verificación: torre de control, cola de anomalías, publicación
oficial congelada, export a CSV y QR imprimibles. Encima de eso: el motor de puntuacion (`src/shared/scoring/`), el modelo de pruebas con
catalogo de movimientos, la carga manual de resultados y la tabla general publica. El **juez de CrossFit**: reductor de WODs, pantalla propia y recalculo en vivo. La **ficha
completa del evento** con su asistente de creacion. El **portal publico**: catalogo con
buscador y filtros, y ficha publica de cada competencia. Las **inscripciones**: flujo de equipo
con invitacion por correo, cupos, tallas y campos configurables. Y los **pagos**: credenciales
cifradas del organizador, ordenes, descuentos y webhooks con firma verificada. Y el **cronograma
multi-arena** con deteccion de solapes, mas los **colaboradores** con permisos por evento. Y los
**planes**: el corte gratuito/pago aplicado en Postgres, con su pantalla y el medio de cobro. Falta
el envio de correos, el panel de super admin, el tour de onboarding y el ensayo general con jueces
reales. El plan completo por fases está en
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
npm run seed:dev                   # datos de prueba: usuarios, un Hyrox y un CrossFit
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
src/shared/i18n/       los tres idiomas, el traductor y la cookie de idioma
src/shared/timing/     motor puro de tiempos: tipos, ancla del reloj, reductor de circuitos
                       y reductor de WODs.
src/shared/scoring/    motor puro de puntuación: unidades, tablas, posiciones físicas,
                       desempate por vector. Los dos sin DOM y sin React: es donde vive la
                       corrección del producto y donde la cobertura tiene que ser alta.
src/features/judge/    PWA del juez: db (Dexie), sync (outbox), store, componentes
src/features/auth/     entrar, crear cuenta, Google, recuperar contraseña
src/features/org/       organizaciones (se crean solas) y membresías
src/features/cuenta/   perfil de competidor: datos, foto e inscripciones
src/features/panel/    el marco del panel de organizador
src/features/events/   config de competencia (queries/actions), acceso por rol, plantillas
src/features/athletes/ import CSV (lógica pura + tests) y alta manual
src/features/heats/    armado de heats, carriles y jueces
src/features/cronograma/  arenas, horarios de heats y colaboradores del evento
src/features/workouts/ pruebas: constructor de WODs, catálogo de movimientos, carga manual
src/lib/supabase/      clientes (browser/server/service), middleware de sesión, tipos
src/app/panel/         shell del organizador
src/app/juez/          selección de carril (server) y cronómetro (estático, offline)
src/app/en-vivo/       leaderboard público, proyector y vista de atleta
src/app/eventos/       ficha pública de una competencia
src/features/catalogo/ catálogo público: consultas, filtros, tarjetas y encabezado
src/features/inscripciones/ trámite de inscripción: equipos, invitaciones y cupos
src/features/pagos/    cobros: cifrado de credenciales, órdenes, descuentos y adaptadores
src/features/planes/   el plan de la organización: qué habilita, y el medio de cobro
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

## Pagos: la plataforma no custodia plata

Cada organizador pone SUS credenciales y el dinero le llega directo. Nosotros guardamos la
configuracion, armamos la orden, escuchamos al proveedor y marcamos la inscripcion como paga. Esa
decision saca del alcance toda la regulacion de custodia de fondos de doce paises, que es la razon
por la que se tomo.

### Donde estan los secretos, y por que ahi

`payment_providers.secret_ciphertext` guarda AES-256-GCM cifrado por la APLICACION
(`src/features/pagos/lib/cifrado.ts`). La llave vive en `PAYMENTS_ENCRYPTION_KEY`, en el entorno
del servidor.

La opcion "natural" —pgsodium o Supabase Vault— deja la llave dentro de la misma base que guarda
el dato: un volcado (un backup mal guardado, un acceso de soporte, una restauracion en pruebas) se
lleva las dos cosas. Cifrando en la app, un volcado completo no alcanza para cobrar en nombre de
nadie. (Y de paso: ninguna de las dos existe en PGlite, asi que la alternativa habria dejado esta
parte sin tests.)

Detalles que valen:

- **GCM autentica ademas de cifrar.** Un byte cambiado a mano en la base hace fallar el descifrado,
  en vez de devolver basura que despues se le manda a una pasarela.
- **Sin llave configurada, la accion FALLA.** La alternativa seria guardar en claro, y eso no puede
  pasar nunca en silencio.
- **`secret_ciphertext` quedo FUERA del grant de select.** Ni el texto cifrado sale por PostgREST,
  ni para el dueno de la organizacion. Un `grant select on payment_providers` a secas lo habria
  incluido — es exactamente el descuido que la migracion de lockdown existe para evitar.
- **El campo del secreto en la UI se muestra siempre vacio, y vacio significa "no lo toques".** Si
  significara "borralo", editar el numero de cuenta borraria la credencial sin avisar.

### La regla que no se negocia en un webhook

**Un webhook cuya firma no se pudo verificar NUNCA marca una orden como pagada.** La URL es publica
por definicion —la pasarela llega sin credenciales— asi que la firma es la unica barrera.

Esta hecho estructural, no por disciplina: `verificarWebhook` devuelve un tipo DISCRIMINADO, y los
datos del pago solo existen en la rama `verificado: true`. El codigo que cobra no compila si no
chequeo la firma primero.

Y el orden de la ruta no se puede invertir: cuerpo crudo → a que orden se refiere → secreto DE ESE
organizador → verificar → recien ahi registrar. Ante cualquier duda responde 200 sin cobrar (un 4xx
haria que la pasarela reintente durante horas un mensaje que nunca vamos a aceptar).

### Descriptores en el cliente, verificadores en el servidor

`adapters/*.ts` son DESCRIPTORES: nombre, campos, instrucciones. Van al navegador.
`adapters/verificadores/*` es solo servidor: usa node:crypto y el secreto.

Estaban juntos y el build fallo — un componente de cliente arrastraba `server-only` al bundle. La
separacion es lo correcto igual: la verificacion de firmas no tiene nada que hacer en un navegador.
**Una pasarela sin verificador implementado falla cerrado por defecto.**

### El cobro se configura DENTRO de la competencia

`/panel/organizacion/pagos` ya no existe. Las credenciales siguen siendo de la organizacion —son
del organizador y la plata le llega directo— pero la pregunta "¿como cobro esto?" aparece cuando se
le pone precio a una categoria, no en un menu de cuenta que nadie visita. Se configuran en
`/panel/eventos/[id]/inscripciones`, y `MediosDeCobro` sigue guardando en `payment_providers` por
`org_id`: valen para todas las competencias, se cargan una vez.

- **El `org_id` de la pantalla de cobro es el DUEÑO DEL EVENTO
  (`events.org_id`), nunca `getMyOrganizations()[0]`.** Un organizador con
  MAS DE UNA organizacion configuraba transferencia en una competencia y la
  veia aparecer en TODAS las demas, incluidas las de otra organizacion:
  `PasoInscripcionAsistente`, `ConfiguracionDeInscripciones` y el resumen del
  asistente pedian "mi primera organizacion" en vez de "la organizacion de
  ESTE evento", asi que sin importar que competencia abriera, siempre leian y
  escribian `payment_providers` de la misma organizacion — la que
  `getMyOrganizations()` devolviera primero, sin relacion con el evento
  abierto. El fix es leer `org_id` de la misma fila de `events` que ya se
  consulta ahi (`select("currency, org_id")`), nunca una consulta aparte a
  `getMyOrganizations()`. RLS (`can_admin_org(org_id)`) nunca dejo escribir en
  una organizacion ajena — el bug no era de seguridad, era de a CUAL de las
  organizaciones propias apuntaba cada pantalla.
- **Se muestra UN medio a la vez, no los cuatro.** Estaban los cuatro formularios completos, uno
  debajo de otro: veinte campos de los que se llenan cinco. Arriba van las fichas con un punto que
  dice si ese medio ya esta activo; abajo, el formulario del elegido.
- **`MEDIOS_OFRECIDOS` es lo que ve el organizador, y no incluye `efectivo`.** El valor del enum se
  queda porque hay ordenes que lo referencian, y sacar un valor de un enum de Postgres obliga a
  recrear la columna.
- **La moneda es de la COMPETENCIA** (`events.currency`), no de cada categoria. Seis categorias eran
  seis desplegables con una sola respuesta posible, y la unica novedad era que uno quedara en COP
  cuando los otros cinco decian CLP. Ademas los medios de cobro son uno por organizador: no se puede
  tener una pasarela en dolares y otra en pesos para la misma competencia, asi que preguntarla por
  categoria prometia una flexibilidad que no existe.
- **`division_registration.currency` sobrevive como ESPEJO**, mantenido por dos triggers
  (`categoria_hereda_moneda` al insertar, `bajar_moneda_a_categorias` al cambiar la del evento). Lo
  lee el motor de ordenes y hay filas cargadas; sin el espejo, cambiar la moneda del evento dejaria
  los precios viejos etiquetados en la moneda nueva.
- **El cupo y el cambio de integrantes se configuran en la CATEGORIA**, no en la pantalla de cobro.
  Pedir el cupo en dos lugares es pedir que difieran, y "permitir cambiar integrantes" no tiene nada
  que ver con cobrar: se muestra solo si `team_size > 1`, porque en individual no hay integrante que
  cambiar. `guardarCupoYPuntuacion` manda un `esEquipo` oculto y **solo escribe
  `allows_member_swap` cuando el campo se pinto** — sin eso, guardar una categoria individual
  apagaria el permiso de una de equipo.
- **Los precios de TODAS las categorias se guardan en un solo envio.** Tenian un formulario y un
  boton "Guardar" por categoria: con diez categorias eran diez botones identicos, y nada distinguia
  cual ya estaba guardado. `PreciosDeCategorias` es una lista de campos con un unico "Guardar
  precios" al final, y `guardarPreciosDeCategorias` manda un solo `upsert` con un arreglo de filas
  — supabase-js lo resuelve en un viaje de red, asi que N categorias siguen siendo una sola
  escritura. La seccion entera se esconde si el evento todavia no tiene categorias: mostrarla vacia
  invita a crearlas ahi, que no es donde se crean.

### Otras reglas ya codificadas

- **`total_cents` es una columna GENERADA** (`amount - discount`): no se escribe a mano, asi que no
  puede quedar desalineada.
- **El cupon se gasta cuando el pago entra de verdad**, no cuando alguien lo escribe. Contarlo antes
  deja codigos agotados por gente que nunca pago.
- **`registrar_intento_de_pago` es idempotente por `external_id`.** Un webhook que llega tres veces
  deja un intento y cobra una vez. Las pasarelas reintentan: es lo normal, no la excepcion.
- **Un `on conflict` sobre un indice PARCIAL tiene que repetir su `where`.** Sin eso Postgres
  responde "no unique constraint matching the ON CONFLICT" y no es obvio por que.
- **`payment_attempts` es append-only**, como timing_events: cuando alguien dice "yo pagué" hay que
  poder mostrar que llego, cuando y con que identificador.

## Una inscripcion NO es un equipo

Son dos cosas con vidas distintas, y confundirlas rompe el producto:

| | Que es |
|---|---|
| `registrations` | El **tramite**: quien lo empezo, a quien invito, que falta, si se pago. Puede quedar a medias para siempre. |
| `teams` | La unidad que **compite y rankea**. Existe solo si el tramite llego a buen puerto. |

`confirm_registration()` MATERIALIZA el equipo: crea `athletes`, `teams` y `team_members`, y le
asigna dorsal. Por eso heats, lanes, results y la PWA del juez **no se enteran de que existen las
inscripciones** — siguen viendo equipos, exactamente como antes. El alta manual del organizador
entra por el mismo camino con el tramite ya confirmado: un solo lugar donde nace un equipo.

El camino completo:

```
start_registration    el capitan elige categoria
invite_member         pone el correo REAL de cada integrante
claim_membership      cada uno entra con su cuenta y reclama su lugar
save_member_data      completa sus datos y acepta los terminos
submit_registration   el capitan la envia
    sin precio -> se confirma sola (competencia interna o de cortesia)
    con precio -> queda esperando_pago
confirm_registration  materializa el equipo
```

### Reglas que ya estan codificadas

- **Sin precio, la inscripcion se confirma sola.** Es lo que hace que el plan gratuito sirva de
  punta a punta sin ninguna pasarela de pago.
- **El precio se congela al empezar el tramite.** Si el organizador lo sube despues, quien ya se
  anoto paga lo que le dijeron.
- **El dorsal se toma al confirmar, no antes.** Un tramite a medias no puede quedarse con un numero.
- **Los cupos cuentan las confirmadas Y las que esperan pago.** Sin eso, dos personas pagan por el
  ultimo lugar.
- **`confirm_registration` es idempotente.** Un webhook de pago que llega repetido es lo normal, no
  la excepcion; confirmar dos veces no crea dos equipos.
- **Cancelar retira el equipo (`withdrawn`), no lo borra**, para que sus tiempos —si llego a
  correr— no desaparezcan.
- **Cambiar de integrante borra los datos del anterior.** No son suyos.
- **La talla tiene que ser una de `events.shirt_sizes`.** Sin ese chequeo el organizador termina
  con "L", "l" y "Large".
- **Los campos extra del formulario son DATOS** (`registration_fields`), no columnas. Cada
  competencia pide cosas distintas y agregar una columna por idea no escala.

### Dos barreras distintas, y conviene no confundirlas

Al escribir tests de acceso aparecen las dos y se comportan al reves de lo que uno espera:

- **RLS devuelve CERO FILAS, sin error.** Es lo que frena a un usuario logueado que no tiene nada
  que ver con el recurso. `expectDenied` NO sirve para esto: hay que asertar `rows` vacio.
- **La ausencia de GRANT SI es un error.** Es lo que frena al rol `anon`. Ahi `expectDenied` es lo
  correcto.

Las politicas de `registrations` y `registration_members` se preguntan mutuamente, asi que los
helpers (`es_integrante_de`, `puede_ver_inscripcion`) son SECURITY DEFINER — sin eso es recursion
de RLS, el mismo motivo por el que existe `event_role`.

## Un colaborador tiene rol en el EVENTO, no en la organizacion

Hasta la fase 14 el permiso venia solo de `org_members`: quien podia tocar un evento podia tocar
**todos** los de esa organizacion. Un juez contratado para una fecha no puede tener eso.

`event_staff` da un rol acotado a un solo evento. `event_role(event_id)` ahora devuelve **el mayor
de los dos** —el de la organizacion y el del evento— asi que todo lo que ya consultaba `event_role`
empezo a respetar a los colaboradores sin tocarse.

| Rol de `event_staff` | Puede |
|---|---|
| `manager` | Todo, pero solo en ese evento |
| `verifier` | Largar heats, verificar y publicar |
| `scorekeeper` | Cargar scores a mano (`can_score_event`), nada mas |
| `registrar` | Inscripciones y confirmar pagos (`can_register_event`) |
| `judge` | Tomar un carril y cronometrar |

**Los dos helpers nuevos existen para no repartir `can_verify_event` de mas.** Quien carga
resultados no deberia poder publicarlos, y quien atiende la mesa de inscripciones no deberia poder
tocar un tiempo. `upsert_workout_score` pide `can_score_event`; `confirm_registration` y
`confirmar_pago_manual` piden `can_register_event`.

**La invitacion se resuelve por correo, y puede quedar pendiente.** `invite_event_staff` busca el
`profiles.id` de ese correo: si existe, el colaborador queda activo (`user_id` cargado); si no, la
fila queda con `user_id` nulo y se activa sola cuando esa persona se registre. Es el mismo patron
que `claim_membership` en inscripciones, y por eso el juez **tiene que estar registrado** para
poder tomar un carril: sin `user_id`, `event_staff_role` no lo encuentra.

**`events_read` se redefinio y es facil romperla de nuevo.** Chequeaba solo `user_org_role(org_id)`,
asi que un colaborador no podia leer el evento en el que colabora —y sin leer el evento no carga
ninguna pantalla del panel. Ahora chequea las dos vias. Si agregas una politica sobre `events`,
acordate de las dos.

## El cronograma: arenas, y por que el solape se calcula y no se prohibe

Un CrossFit corre varias pruebas a la vez en escenarios distintos; una carrera hibrida usa uno solo.
`arenas` modela el escenario y `heats.arena_id` + `heats.scheduled_end_at` lo ubican en el tiempo.

**Los solapes se reportan, no se bloquean.** `event_schedule_issues(event_id)` devuelve `error`
cuando dos heats de la misma arena se pisan y `warning` cuando falta programar algo. Un CHECK o un
constraint de exclusion obligaria al organizador a armar el cronograma en un orden valido de punta
a punta, y en la practica se arma desordenado: primero todos los heats, despues las horas. La
pantalla muestra el conflicto y deja guardar.

**Cuando el heat no tiene hora de fin, el solape se estima** con `arenas.default_heat_minutes`. Un
heat de Hyrox son ~90 minutos y uno de un WOD ~15, y ese numero es lo unico que evita que un
cronograma a medio cargar reporte cero conflictos falsamente tranquilizadores.

**Las horas del cronograma son hora de PARED del evento.** El formulario muestra y recibe
`datetime-local` en el huso de la competencia, y `programarHeat` convierte con `instanteEnZona()`
antes de guardar. Guardar el string como si fuera UTC corre el cronograma varias horas — es el
mismo error que ya mordio en la torre de control.

## El panel: la barra lateral cambia segun donde se este

Fuera de una competencia muestra lo de la cuenta. DENTRO de una competencia se
abre un bloque con esa competencia y sus secciones:

```
Mis competencias / Plan
┌─ Copa Hibrida de Prueba          En vivo ─┐
│ EVENTO                                    │
│   Informacion general                     │
│   Configuracion competencia               │
│   Registro atletas                        │
│   Leaderboard                             │
│   Verificacion                            │
│   Inscripciones                           │
│   Cronograma                              │
│ ADMINISTRACION                            │
│   Control                                 │
│   Colaboradores                           │
│   Jueces                                  │
└───────────────────────────────────────────┘
```

**"Informacion general" abre el ASISTENTE**, no una pantalla propia — ver
[El asistente es una lista de datos](#el-asistente-es-una-lista-de-datos-no-un-componente-con-ramas).

**Que problema resuelve.** La ficha del evento tenia QUINCE pestañas en una fila
horizontal —de "Resumen" a "QR"—, en dos grupos con un selector para cambiar
entre ellos. Encontrar "Control" el dia de la competencia era leerlas todas.

**Que quedo en las pestañas: solo PRODUCCION.** Resumen, Heats y Cargar — lo que
alguien abre con la competencia corriendo y el celular en la mano.

- **Control se mudo a ADMINISTRACION.** Ahi se monitorea la competencia —torre
  de control, cola de anomalias, publicacion oficial— y eso es trabajo de
  organizacion, no algo que compita por espacio con "Heats" o "Cargar" el dia
  del evento con el celular en la mano. La ruta sigue siendo
  `/panel/eventos/[id]/control`, solo cambio DESDE DONDE se llega.
- **QR esta OCULTO, no eliminado.** La pantalla y la ruta siguen intactas;
  `EventTabs` simplemente no la lista mas en `SECCIONES`. Volver a mostrarla es
  agregar la linea de vuelta.

**La caja alrededor del bloque no es decoracion.** Sin ella, las secciones del
evento y las de la cuenta se leen como una sola lista de diez destinos y no se
entiende que unas son "de esta competencia" y otras "de mi organizacion".

**El nombre del evento sale de `listEvents()`, que el layout ya trae**, y el id
de la URL. Consultar el evento desde la barra seria una consulta mas en cada
pagina del panel para un dato ya cargado.

### "Config Competencia" y "Resumen" son la MISMA pantalla

No hay una ruta `/configuracion` separada — se borro. `/panel/eventos/[id]`
(sin sufijo) es a la vez la pestaña "Resumen" de produccion Y el destino de
"Config Competencia" en la barra lateral: las dos flechas apuntan al mismo
lugar, con las pestañas Resumen/Heats/Cargar visibles arriba.

Hubo una version intermedia con DOS pantallas —`/configuracion` con el listado,
`/panel/eventos/[id]` con el estado— y esa separacion no duro: la misma
competencia se le explicaba al organizador en dos lugares distintos segun por
donde entrara, actualizandose cada uno por su cuenta. Ahora es una sola.

**Sigue siendo unica y exclusivamente sobre ESTA competencia.** Nunca va a
mostrar Inscripciones, Colaboradores ni Informacion General — esas tienen su
propio lugar en el menu, y mezclarlas aca las duplicaria.

**El orden del listado es fijo: Divisiones, Circuito o Workouts segun el
formato, Atletas, Heats, Penalizaciones.** Circuito y Workouts son
EXCLUYENTES, nunca los dos: una carrera hibrida no corre workouts sueltos y un
CrossFit no arma un circuito, y mostrar los dos a la vez hace dudar de si la
herramienta entendio que competencia se esta armando.

**El listado es una LISTA CON CHECK, no una grilla de tarjetas.** Se probo con
tarjetas —icono, titulo, descripcion, cuenta, una junto a la otra— y esa
version se descarto: la que sirve es un circulo lleno con tilde cuando esta cargado
(gris con un punto cuando no), el nombre, y la cuenta a la derecha — cada FILA
ENTERA es un link a la seccion que lo configura. Con un vistazo se ve que falta
Y se puede entrar a cargarlo, las dos cosas en el mismo elemento. `secciones`
es UN solo arreglo que hace las dos cosas a la vez: lo que se pinta (el check,
el link, la cuenta) y lo que decide si "Marcar como lista" se habilita
(`hecho`/`opcional` alimentan `faltantes` directo) — antes eran dos arreglos
paralelos y nada garantizaba que dijeran lo mismo.

**Abajo del listado sigue "Revisar antes de iniciar"**, con los errores y
avisos de `getConfigIssues` SIN separar por severidad (ambos colores, uno abajo
del otro). Complementa al listado, no lo repite: el check dice SI hay
divisiones cargadas: esto dice que una division concreta no tiene equipos
inscriptos, un detalle que ningun check resume.

**El bug real que se arreglo al fusionar las dos pantallas se mantiene
arreglado**: el calculo de `secciones` —el que decide si el boton "Marcar como
lista" esta habilitado via `faltantes`— marcaba "Circuito" como obligatorio
para CUALQUIER formato antes de esta fusion, asi que una competencia de
CrossFit —que nunca va a tener una plantilla de circuito— jamas podia
marcarse como lista. Ahora Circuito (hibrida) es obligatorio y Workouts
(crossfit) es `opcional`: ninguno de los dos formatos se queda bloqueado por
algo que no le corresponde.

### Una sola barra de pestañas: Resumen, Divisiones, Circuito, Atletas, Heats, Penalizaciones

Hubo una version con DOS barras —`EventTabs` para produccion (Resumen/Heats/Cargar) y `ConfigTabs`
al lado con Circuito/Divisiones/Atletas/Penalizaciones— y se volvio para atras. La separacion
agregaba una fila mas a la pantalla y una regla extra para acordarse ("¿esta pantalla esta arriba o
abajo?"), y las seis entradas caben perfectamente en una sola fila. `ConfigTabs.tsx` se borro.

**"Cargar" se saco de la barra.** La carga manual de resultados es un concepto de CrossFit —scores
que alguien tipea a mano—, y una carrera hibrida no tiene nada que cargar: el tiempo sale de
cronometrar. Ofrecerla en una carrera hibrida invitaba a un alta manual que este formato no usa.

**Circuito y Workouts son EXCLUYENTES segun el formato**, igual que en el listado del resumen: una
carrera hibrida nunca ve "Workouts" y un CrossFit nunca ve "Circuito".

**Fuera de `canManage` la barra se reduce a "Heats".** Divisiones, Circuito, Atletas y
Penalizaciones son configuracion de la competencia — un juez o un verificador sin permiso de
gestion no tiene nada que hacer ahi, y mostrarselas es superficie de mas en una pantalla que van a
usar apurados el dia del evento. Antes un verificador (`canVerify`) veia Heats y Cargar; con Cargar
afuera y las pantallas de configuracion adentro, la regla se simplifico a una sola condicion.

**Divisiones, Circuito, Atletas y Penalizaciones salieron de `SIN_PESTANAS`** (`EventTabs.tsx`): ya
no son pantallas "solo barra lateral", tienen su pestaña como el resto. Lo que sigue en
`SIN_PESTANAS` —jueces, colaboradores, control, inscripciones, cronograma, leaderboard,
verificacion— son ajustes especificos a los que se llega solo por la barra lateral.

### Se puede borrar un circuito completo, si nada lo usa

`course_templates` no tenia ninguna accion de borrado — se podian crear circuitos (con preset
Hyrox o vacios) y agregar/quitar/mover segmentos, pero nunca borrar el circuito entero. Ahora
`deleteCourseTemplate` (`config/actions.ts`) lo permite, con el mismo patron que ya usa el resto
del proyecto para esto: **el boton ni siquiera aparece si va a fallar**. `divisions.course_template_id`
es `on delete restrict` —Postgres ya lo bloquearia solo— pero un boton que falla sin decir por que
es peor que no ofrecerlo. `/circuito` cuenta cuantas categorias usan cada plantilla y solo muestra
"Eliminar circuito" cuando esa cuenta da cero; si no, muestra cuantas categorias lo estan usando.

**Un evento puede tener MAS DE UN circuito.** El modelo ya lo soportaba de punta a punta (creacion,
asignacion por division, listado) — lo unico que faltaba era poder borrar uno.

### Divisiones es una GRILLA con modal, no un acordeon

Con diez categorias o mas —nada raro en un Hyrox grande— el acordeon (una `<li>` por categoria,
todas cerradas) obligaba a abrir una por una para saber que le faltaba a cada una. La grilla
(`<table>`, una fila por categoria) responde eso de un vistazo: nombre, tipo, sexo, cupo, y
Circuito o Movimientos segun el formato. Tocar "Editar" abre un `Modal`.

**"Nueva categoría" tambien es un modal**, no un formulario fijo al pie de la grilla. Antes
`NuevaDivision` era una `<section>` siempre visible al fondo de la pantalla; ahora es un boton "+
Nueva categoría" que abre el mismo formulario adentro de un `Modal`.

**Un SOLO Guardar y un SOLO Cancelar por modal — nunca mas.** El modal de editar categoria tenia
DOS formularios con DOS botones "Guardar" (uno para datos basicos, otro para cupo y puntuacion).
`guardarCategoria` (`config/categorias.ts`) los reemplaza a los dos: hace las DOS escrituras
(`divisions.update` + `division_registration.upsert`) en una sola accion, y el modal tiene un solo
boton de cada uno al pie (`BotonesDeModal`, en `Modal.tsx`). "Agregar" (movimientos, para CrossFit)
NO cuenta como un segundo Guardar: es una lista a la que se suma un item a la vez —la misma logica
que "Nueva categoría" o los codigos de descuento— no un campo que este paso tenga que confirmar.

**`BotonesDeModal` asocia el Guardar al `<form>` por `form={id}`**, para poder vivir FUERA de el:
en el modal de categoria, "Movimientos y pesos" (con su propio formulario de "Agregar") esta entre
el `<form>` principal y los botones, y el atributo HTML `form=` deja que el boton de afuera siga
disparando el formulario de adentro sin anidar dos `<form>`.

**`useCerrarAlGuardar`** (tambien en `Modal.tsx`) cierra el modal solo cuando una accion en curso
termina SIN error: crear o guardar algo y ver como el modal se cierra solo es mejor que quedarse
mirando el mismo formulario. Si hubo error, se queda abierto con el mensaje a la vista.

**`key={abierto ? "abierto" : "cerrado"}` en el `<form>`** remonta el formulario cada vez que se
abre el modal: sin esto, un intento a medias que se cancelo dejaba los campos con lo ultimo escrito
la proxima vez que se abriera.

**`Modal` es generico y reutilizable**, no especifico de categorias. Usa `dialog.showModal()`/
`close()` IMPERATIVOS —`<dialog open>` declarativo no pinta el backdrop ni atrapa el foco— asi que
el `abierto` del componente se sincroniza con un efecto. Clickear el backdrop cierra: el click en
el `<dialog>` mismo (nunca en su contenido, que esta en un div hijo) solo puede venir del area que
el navegador pinta afuera del contenido.

**`m-auto` es obligatorio en la clase del `<dialog>`, o el modal sale pegado a una esquina.** Un
`<dialog>` nativo se centra con `margin: auto` dentro de la caja `position: fixed; inset: 0` que el
navegador le da al abrirse modal — pero el preflight de Tailwind resetea TODOS los margenes a 0 por
defecto, y sin `m-auto` de vuelta el dialogo queda en la esquina superior izquierda en vez de
centrado. Es un detalle facil de perder si se toca la clase del `<dialog>` sin saber por que esta.

**jsdom no implementa `<dialog>.showModal()`.** Cualquier test que abra un `Modal` revienta con
`TypeError: dialog.showModal is not a function` sin relacion con lo que se este probando. Se
resuelve UNA vez, no por archivo de test: `test/setup-dom.ts` (cargado via `setupFiles` en
`vitest.config.mts`) polyfillea `showModal`/`close` con lo minimo que React necesita —poner/sacar
el atributo `open` y disparar el evento `close`— sin simular backdrop ni foco, que eso se prueba a
ojo en un navegador de verdad.

**Para CARRERA HIBRIDA no hay "Parametros del circuito" en el modal de categoria.** Existia una
seccion para ajustar distancia/reps/peso por segmento PARA ESA categoria (`division_segment_specs`,
via `SegmentoAjustable`) — es lo que permitia que Elite corriera 1 km y Amateur 500 m en el mismo
circuito. Se saco a proposito: el circuito se crea con una configuracion (estaciones, distancias) y
esa es — no se vuelve a tocar por categoria desde este modal. La tabla `division_segment_specs`
sigue en el esquema (no se borro, por si se necesita mas adelante), pero ya no tiene ninguna UI que
escriba en ella: `guardarParametroDeSegmento` se elimino por quedar sin ningun llamador.

**Se agrego `updateDivision` originalmente como accion separada y despues se fusiono en
`guardarCategoria`.** El nombre/integrantes/sexo/edad/circuito de una categoria se podian cargar al
crearla, pero no corregir despues sin borrarla y crearla de nuevo — ese hueco ya esta cerrado, y
ahora vive en la misma accion que cupo y puntuacion.

**Eliminar categoria sigue el mismo patron que eliminar circuito: el boton no aparece si va a
fallar.** `teams.division_id` es `on delete restrict` — Postgres ya lo bloquearia — asi que
`getCategoriasConfiguradas` trae `equiposInscritos` por categoria, y la fila solo ofrece
"Eliminar" cuando ese numero es cero; si no, muestra cuantos equipos tiene. Cuando se puede borrar,
un segundo `Modal` pide confirmacion antes de enviar el formulario — no hay ningun borrado de un
solo click en toda esta pantalla.

**El mensaje de "sin circuito" distingue DOS casos que antes se leian igual.** "Esta categoria
todavia no tiene circuito asignado" (el campo esta vacio, hay que elegirle uno arriba en "Datos
basicos") es un problema DE LA CATEGORIA. "El circuito no tiene segmentos cargados" (el campo SI
tiene un circuito, pero ese circuito se creo vacio y nadie cargo segmentos) es un problema DEL
CIRCUITO — y el mensaje viejo decia "no tiene circuito asignado" en los dos casos, lo cual es
literalmente falso en el segundo. `event_config_issues` ya distinguia estos dos casos con codigos
distintos (`sin_circuito` / `division_sin_segmentos`); la UI los mezclaba en un solo texto.

### El alta manual de atletas entra por el mismo camino que la inscripcion publica

Hasta ahora `createAthleteTeam` escribia un atleta llamando a `import_teams` —el mismo RPC de la
importacion CSV, pero para uno solo—, un SEGUNDO camino por el que podia nacer un equipo, distinto
del que usa el portal publico (`start_registration` → `invite_member`/`save_member_data` →
`confirm_registration`). Contradecia la regla que el propio proyecto ya tenia escrita: "un solo
lugar donde nace un equipo".

**`admin_create_registration(p_division_id, p_team_name, p_integrantes)`** es la funcion nueva
(`supabase/migrations/20260902100000_atletas_manual.sql`) que cierra esa brecha: arma la
`registration` y sus `registration_members` con los datos que el organizador ya tiene —todos de
una, sin invitar a nadie por correo— y llama a `confirm_registration()` para materializar el
equipo. Es la MISMA funcion que usa el portal publico: no hay una segunda copia de esa logica.

- **`p_estado` decide si el equipo queda aprobado o no, pero SIEMPRE se crea.** El primer intento
  hizo que `'pendiente'` saltara `confirm_registration()` por completo —el equipo no nacia hasta
  que alguien lo aprobara desde Inscripciones—, y eso rompio la premisa real: un atleta recien
  cargado desaparecia de `/atletas` en vez de mostrarse ahi. La version que quedo llama a
  `confirm_registration()` en los DOS casos (el equipo, sus atletas y su dorsal existen de una,
  sea cual sea el estado) y despues, si `p_estado = 'pendiente'`, hace
  `update teams set approved = false`. `teams.approved` (default `true`) es una bandera puramente
  OPERATIVA, separada de `registrations.status` a proposito: "aprobado para competir" no es un paso
  mas del tramite de inscripcion, es una decision que la organizacion puede tomar y deshacer en
  cualquier momento sin que eso implique cancelar ni reabrir la inscripcion.
- **El toggle vive en la propia grilla.** La columna "Estado" de `/atletas` (`GrillaDeAtletas`,
  boton lima "Aprobado" / ambar "Pendiente") llama a `set_team_approval(team_id, approved)` —
  permiso `can_register_event`, igual que `admin_create_registration`— y flipea la bandera sin
  tocar ningun otro dato del equipo ni de la inscripcion.
- **La garantia "solo un equipo aprobado va a un heat" se exige DOS VECES en Postgres, no una.**
  `auto_distribuir_heats` suma `and t.approved` al filtro de equipos elegibles (junto al de
  `status <> 'withdrawn'` que ya tenia). `assign_heat_lanes` —la asignacion MANUAL desde
  `/heats`— agrega un guard explicito que rechaza cualquier equipo sin aprobar en el arreglo que
  recibe, con los nombres de los equipos en el mensaje. El selector del cliente
  (`heats/page.tsx`) ya saca los equipos no aprobados de la lista para que el organizador no
  llegue a intentarlo, pero esa es comodidad de UI — la garantia real esta en las dos funciones.
- **`create or replace function` no reemplaza una funcion si cambia la ARIDAD.** Agregarle
  `p_estado` con default a una funcion que ya tenia 3 parametros dejo DOS funciones con el mismo
  nombre (3 y 4 argumentos) hasta que una migracion aparte hizo `drop function` de la firma vieja.
  Sin ese drop, cualquier llamada con 3 argumentos revienta con "is not unique". Vale para
  cualquier funcion existente a la que se le agregue un parametro nuevo, tenga o no default.
- **El cobro real sigue pasando por la inscripcion publica.** `approved` no tiene nada que ver con
  plata: un alta manual nunca genera orden ni cobra, este atado o no.
- **`created_by` es quien llama la funcion (el organizador), NUNCA el atleta.** Reusar
  `start_registration` tal cual hubiera sido un error real: esa funcion pone al CALLER como
  integrante #1 con su propio correo y `profile_id`, asi que el organizador hubiera quedado
  vinculado como si el hubiera competido en cada alta manual que procesa. `admin_create_registration`
  es una funcion nueva justamente para no arrastrar esa semántica.
- **Permiso: `can_register_event`, no `can_manage_event`.** Es el mismo permiso que ya usa
  `confirmar_pago_manual`, y es mas amplio que "manage": lo tiene tambien el colaborador con rol
  `registrar`. La accion del lado de la app no repite el chequeo — la funcion SQL es el unico
  lugar que decide, igual que el resto de las acciones de inscripcion.
- **La importacion CSV (`confirmImport` → `import_teams`) NO se toco.** Es una carga MASIVA de un
  padron ya armado, no una persona completando su propio tramite: no tiene el mismo problema que
  resolvia unificar el alta de a uno, y unificarla tambien hubiera sido mucho mas riesgo por
  ningun beneficio pedido.

**Pais, documento (DNI) y provincia/estado son columnas nuevas** en `registration_members` Y en
`athletes` (`country` en ISO de dos letras con el mismo CHECK que usa el resto del esquema,
`document_id`, `state_province`), no entradas en `answers`: son datos de IDENTIDAD del atleta, al
mismo nivel que el nombre o la fecha de nacimiento, no algo que cada competencia define distinto
—eso ya existe, es `registration_fields`. `confirm_registration()` se redefinio para copiarlos al
materializar el atleta.

**`box` y `shirt_size` siguen la misma logica, agregados despues.** `shirt_size` ya existia en
`registration_members` desde la inscripcion publica (`save_member_data` la valida contra
`events.shirt_sizes`) pero `confirm_registration()` no la copiaba a `athletes` — se pedia y se
perdia. `box` (el gimnasio del atleta) no existia en ningun lado. Las dos son columnas fijas en
`athletes` Y `registration_members`, igual que pais/documento/provincia, y el modal de alta manual
las pide en la seccion de **campos opcionales** — `box` siempre, `shirt_size` solo si
`events.shirt_sizes` no esta vacio. `admin_create_registration` valida la talla contra esa misma
lista, igual que `save_member_data`. `box` no se agrego a `GrillaDeAtletas` a proposito: se guarda,
pero no hay todavia ningun lugar de la app que lo muestre.

**`/atletas` es una GRILLA con buscador y filtro, no una lista con un formulario fijo al pie.**
`GrillaDeAtletas` filtra del lado del cliente —el padron completo de un evento (cientos de filas,
no miles) ya viaja en la carga de la pagina— por nombre, correo, DNI o dorsal, mas un filtro de
division. El alta pasa a un modal (`AltaDeAtleta`) que arma tantos bloques de integrante como pida
el `team_size` de la division elegida — una categoria de a dos pide dos bloques completos, sin un
paso de "invitar y esperar" como en la inscripcion publica: el organizador ya tiene los datos de
la persona que tiene en frente. Usa `BotonesDeModal`/`useCerrarAlGuardar` de `Modal.tsx`, igual que
el modal de categoria: un solo Guardar ("Registrar") y un solo Cancelar, y se cierra solo al crear
con exito.

**No hay "estado del registro" visible en esta pantalla.** Todo lo que aparece en la grilla sale
de `teams`, que por definicion son inscripciones ya confirmadas. Los tramites a medias —esperando
pago, esperando integrantes— se ven en "Inscripciones", que es la pantalla que ya responde esa
pregunta; duplicarla aca hubiera sido la misma informacion en dos lugares.

**Funciona igual para los dos formatos**, sin ninguna rama por `event.format`: un atleta es un
atleta, corra un circuito o un WOD.

### Colaboradores: permisos finos, no solo un rol

`event_staff.role` es un NIVEL: manager > verifier > scorekeeper > registrar >
judge. Sirve mientras la gente entre en cinco casilleros y deja de servir en
cuanto aparece el sexto — "puede cargar scores pero no borrar registros", que es
el reparto real de una competencia con quince voluntarios.

**El rol NO se elimino**: es lo que lee `event_role()` y de ahi cuelga toda la
cadena de RLS. Lo que se agrego son BANDERAS que SUMAN sobre el rol
(`can_edit_registrations`, `can_delete_registrations`, `can_edit_scores`,
`can_manage_workouts`, `is_admin`) y un alcance por categoria.

**El rol se DEDUCE de los permisos**, no se elige aparte. La pantalla pregunta
que puede hacer la persona; pedir las dos cosas garantiza que un dia no
coincidan —un "juez" con permiso de scores— y nadie sepa cual manda.

- **Un juez es un colaborador SIN permisos marcados.** No es un tipo aparte: es
  el caso por defecto y el mas comun con diferencia. Se escribe el correo y
  listo.
- **Administrador es un cortocircuito, no un permiso mas.** Da acceso total y
  APAGA los permisos individuales y el alcance por categoria — en la base y en
  la pantalla, donde quedan deshabilitados y atenuados. Un administrador con una
  casilla desmarcada no seria un administrador. **No se esconden**: si no se ven,
  el organizador no sabe que existen.
- **Borrar registros va APARTE de editarlos.** Quien corrige el dorsal mal
  escrito de un atleta no tiene por que poder eliminarlo de la competencia.
- **`event_staff_divisions` es una tabla de EXCEPCIONES: vacio = todas.**
  Guardar "todas" como N filas obligaria a agregar una cada vez que se crea una
  categoria, y el dia que alguien lo olvide el juez se queda sin ver su division
  sin que nadie entienda por que.
- **El alcance se REEMPLAZA entero al editar, no se acumula.** Quitarle una
  categoria tiene que quitarsela de verdad.
- **`event_staff_divisions` no tiene GRANT de insert.** Se escribe solo desde
  `invite_event_staff`, que valida el permiso — la misma jugada que hace
  inmutable a `timing_events`.

### Colaborador y juez NO son lo mismo

| | Cuando trabaja | Que hace |
|---|---|---|
| **Colaborador** | las semanas previas, desde una computadora | logistica, plataforma y datos: registros, scores, workouts |
| **Juez** | el DIA del evento, desde el celular | califica: el cronometro en una carrera hibrida, la pantalla de WOD en un CrossFit |

Por dentro los dos son `event_staff` —misma tabla, mismas politicas— y lo que
los separa es tener o no banderas de permiso: **un juez es el que tiene CERO**.

**Estan en pantallas separadas** (`/colaboradores` y `/jueces`, esta ultima
debajo en el menu). No es cosmetico: mezclar los cuatro administradores con los
veinte jueces de un evento grande hace imposible encontrar a alguien, y el
formulario de alta termina preguntando cosas que no aplican a la mitad. El alta
de juez pide correo y —opcional— que categorias, y nada mas.

**La pantalla de jueces muestra el CARRIL que tomo cada uno.** Es LA pregunta
del dia del evento —"¿quien esta cubriendo el heat 3?"— y no habia forma de
contestarla sin ir carril por carril.

**El alta de colaborador exige al menos un permiso.** Sin ninguno seria un juez,
y crearlo en silencio desde ahi haria que el organizador no lo viera en la lista
y lo agregara de nuevo.

### TODO el acceso es por evento: `/organizacion/miembros` se borro

Habia una TERCERA puerta: los miembros de la ORGANIZACION, que abren todos los
eventos presentes y futuros. Un juez contratado para una fecha no puede tener
eso, y tener tres puertas garantizaba que alguien usara la equivocada.

Se elimino la pantalla, `InvitarForm`, `org/members.ts` y `org/memberActions.ts`.
`org_members` SIGUE siendo la base de `user_org_role()` y de toda la cadena de
RLS: lo que se fue es la UI para agregar miembros. El unico miembro es quien creo
la organizacion, y lo agrega el trigger `add_creator_as_owner`.

**Lo que se pierde y hay que resolver:** ya no hay forma de agregar un segundo
dueño o admin a una organizacion. Cuando haga falta —dos socios de un box— va en
una pantalla propia de la organizacion, no de vuelta en el menu.

**`getJudges()` ahora lee `event_staff`, no `org_members`.** Ofrecia los miembros
de la organizacion, que es lo que existia cuando un juez valia para todos los
eventos: con jueces por competencia eso ofrecia gente ajena a la fecha y dejaba
fuera a quien fue invitado solo a ella.

### Por que jueces POR EVENTO, y como se paga su costo

Por evento es lo correcto, y por dos razones concretas:

1. Se contrata a alguien para una fecha sin darle el historial completo de la
   organizacion.
2. **Dos competencias en simultaneo no se ven entre si.** Con jueces globales,
   el juez de la fecha A veria los carriles de la B en su pantalla de seleccion.

Su unico costo real es administrativo: un box que hace una fecha por mes con los
mismos doce jueces tendria que escribir doce correos cada vez. **Eso lo resuelve
`org_staff_directory()`**, que devuelve a quien ya trabajo en OTRAS competencias
de la organizacion, ordenado por cuantas veces, sin incluir a quien ya esta en
esta. El modelo de permisos no cambia —cada invitacion sigue siendo a un evento—
solo se evita volver a tipear.

- **Ordenado por veces trabajadas**: en una lista de cuarenta contactos, los doce
  habituales son los unicos que se van a marcar y tienen que estar sin
  scrollear.
- **Separa jueces de colaboradores** por `fue_juez` (no tener ninguna bandera),
  asi cada pantalla ofrece solo los suyos.
- **Solo lo ve quien administra el evento**: es el historial de contactos de la
  organizacion, no una lista publica.

### Jueces verificados: postulacion publica, aprobacion y un carril por heat

Hasta aca la UNICA puerta de entrada de un juez era la invitacion del
organizador. Un juez que encuentra la competencia en el catalogo no tenia
forma de ofrecerse, y nada impedia que UN juez tomara diez carriles de heats
distintos a la vez.

**`event_staff.approved_at` es la pieza que hace funcionar todo lo demas.**
Una invitacion del organizador se aprueba SOLA —el organizador ya eligio a esa
persona escribiendo su correo, no hace falta un segundo click— pero una
postulacion publica (`apply_as_judge`, llamada desde la ficha publica del
evento) nace con `approved_at` nulo. `event_staff_role()` —de la que cuelga
`event_role()` y con el toda la cadena de RLS que ya existia— ahora exige
`approved_at is not null`. No hizo falta tocar las treinta politicas que ya
confiaban en `event_role()`: todas heredan la garantia en el mismo lugar donde
ya la resolvian. Sin aprobar, un postulante no tiene rol de ningun tipo: no ve
el evento, no aparece en ninguna pantalla del panel, y `claim_lane` lo
rechaza con un mensaje que dice exactamente eso.

- **Se postula por correo, resuelto por SLUG.** `apply_as_judge(p_public_slug)`
  recibe el slug publico, no el uuid interno: `EventoPublico` nunca cargo el id
  del evento en su payload —el resto del portal publico tampoco lo necesita— y
  agregarlo solo para esto hubiera expuesto un dato interno sin necesidad.
- **`approve_event_staff` / `remove_event_staff`** son aprobar y rechazar. La
  pantalla de jueces muestra las postulaciones pendientes ARRIBA de la lista,
  en su propia seccion ambar: son lo primero que un organizador tiene que
  revisar al entrar.
- **Un mismo correo no se postula dos veces**, ni puede postularse si ya lo
  invito el organizador: `apply_as_judge` revisa `event_staff` por correo antes
  de insertar.

**La autoasignacion es un toggle por evento, no una decision fija en el
codigo.** `events.allow_judge_self_claim` (default true) se apaga desde
`/panel/eventos/[id]/jueces`. Apagado, `claim_lane` rechaza a CUALQUIERA sin
`can_verify_event`: la unica forma de asignar un carril pasa a ser
`transfer_lane` desde Heats, con anticipacion, por la organizacion. Prendido
o apagado, quien verifica el evento siempre puede autoasignarse: el toggle
restringe a los JUECES, no a quien ya administra la competencia.

**Un juez, un HEAT a la vez — no un carril.** `claim_lane` rechaza un carril
nuevo si el juez ya tiene un carril con lease activo en OTRO heat, pero
permite cubrir varios carriles del MISMO heat: son atletas corriendo delante
suyo al mismo tiempo, y es como trabaja hoy una competencia chica con pocos
jueces. El limite es el heat porque es lo unico que tiene sentido fisico
—estar en dos heats a la vez es estar en dos lugares a la vez— y porque es
exactamente lo que ya detectaba, sin bloquear, el codigo `juez_solapado` de
`event_schedule_issues()`. Un lease vencido cuenta como heat abandonado, no
como "en curso": el mismo mecanismo que ya usaba `claim_lane` para carriles
huerfanos.

**"Terminar este heat para estar en otro" necesitaba que un juez pudiera
soltar SU PROPIO carril**, y no podia: `transfer_lane` exigia
`can_verify_event` incluso para liberar el carril de uno mismo, y un juez
comun nunca tiene ese rol. `src/features/judge/actions.ts` ya tenia una
funcion `releaseLane` que llamaba a `transfer_lane(lane, null, motivo)`
esperando que esto funcionara —con un comentario que decia literalmente "si no
tiene permiso no pasa nada"— y nunca funciono para nadie. Ahora
`transfer_lane` deja pasar la AUTOliberacion (`p_to_judge is null` y quien
llama es el juez actual) sin pedir rol de verificacion; seguir REASIGNANDO a
un tercero sigue siendo trabajo exclusivo de quien verifica. El boton
"Terminé — liberar este carril" en `/juez` es lo que por fin usa esa funcion.

**El destino de `transfer_lane` se validaba solo contra `org_members`.** Un
colaborador invitado SOLO a este evento —que es justo a quien mas se le
asignan carriles, ver
["Un colaborador tiene rol en el EVENTO"](#un-colaborador-tiene-rol-en-el-evento-no-en-la-organizacion)—
no pasaba esa validacion, y el organizador no podia transferirle un carril
desde Heats aunque lo tuviera invitado y aprobado. Ahora tambien acepta un
`event_staff` aprobado de ese evento.

### Un juez de EVENTO no ve la competencia: ve su carril

Reportado al probar lo de arriba: invitar a alguien como juez, entrar con esa
cuenta, y ver la ficha ENTERA de la competencia —categorias, atletas,
circuito— navegando el panel a mano, no solo el cronometro.

La causa: `event_role()` traducia `event_staff_role = 'judge'` al MISMO
`org_role = 'judge'` que ya usaban los miembros de ORGANIZACION con rol de
juez. Y `event_role(event_id) is not null` es el predicado que repiten
**unas veinticinco politicas RLS** (documentado como "un solo helper, no
reescribas treinta politicas" en la seccion de colaboradores) ademas de ser lo
que usa `requireEventAccess()` para decidir si mostrar el panel. Un miembro de
organizacion es alguien de confianza del box; un juez de evento puede ser un
desconocido contratado para una sola fecha, y la traduccion le daba a ese
desconocido el mismo acceso de lectura que a un miembro de la organizacion
sobre divisiones, atletas, equipos, resultados, tablas y documentos de TODA
la competencia.

**La regla nueva: `event_staff_role = 'judge'` no se traduce a NINGUN
`org_role`.** Sin `org_role`, `event_role(event_id)` es null para ese usuario
en ese evento — y con eso, `requireEventAccess()` lo rebota del panel entero
(la misma redireccion que ya usa para un desconocido total), y las ~25
politicas dejan de dejarlo pasar. Los otros roles de `event_staff`
—`manager`, `verifier`, `scorekeeper`, `registrar`— NO cambian: son roles que
la organizacion elige a proposito para alguien que SI necesita configurar o
revisar la competencia. "Juez" es el default de quien solo llega a tomar un
carril, y es sobre ese caso puntual que se reporto el problema. **Un miembro
de organizacion con rol de juez (`org_members`) sigue viendo lo mismo que
veia antes** — es una decision ya tomada y documentada, y esta migracion no
la toca.

**Lo que SI necesita seguir viendo un juez de evento** —que carriles hay, el
heat, el circuito, las penalizaciones, los movimientos del WOD— se resuelve
en dos niveles:

1. Las tablas de ESTRUCTURA, sin dato personal de nadie —`lanes`, `heats`,
   `workout_parts`, `part_divisions`, `segments`, `penalty_types`,
   `part_blocks`, `part_movements`, `division_movement_specs`— se abren con
   un helper nuevo, `puede_leer_evento()` = `event_role() is not null OR
   event_staff_role() is not null`: un juez de evento pasa por la segunda
   mitad, todo lo demas por la primera. `lanes` y `heats` importan ademas
   porque `recomputeLanes()` (el recalculo que dispara el celular del juez al
   sincronizar) resuelve el carril con el cliente del USUARIO a proposito —
   "ya verificamos que el carril es suyo" es RLS, no una funcion aparte.
2. Lo que SI tiene datos personales —el nombre de un atleta, que sale de
   `athletes` + `teams` + `team_members`— **no se abre por RLS de tabla en
   absoluto**. RLS es por FILA, no por COLUMNA: si `athletes` se abriera para
   poder mostrar "Juan Perez" en la tarjeta del carril, un juez de evento con
   `select=*` por la API (no por la app) leeria tambien la fecha de
   nacimiento, el documento, el telefono y el pais de CUALQUIER atleta de la
   competencia, no solo los de su carril. `judge_visible_lanes()` y
   `judge_lane_bundle()` son `security definer`: hacen el join adentro —donde
   si pueden leer esas tablas— y devuelven el nombre ya concatenado.
   Reemplazan los `.from("lanes").select("... teams (... athletes (...))")`
   que hacian `getJudgeLanes()` y `fetchLaneBundle()`: mismo dato final en la
   pantalla, cero acceso de un juez de evento a la tabla de atletas.

**`puede_en_division()` necesito `security definer` para sostener esto.**
Miraba `event_staff_divisions` con los privilegios del que llama, y esa tabla
se lee via una politica gateada por `event_role(event_id) is not null`.
Mientras esa funcion le devolvia `'judge'` a CUALQUIER `event_staff` con
`role = 'judge'`, la funcion podia ver sus propias filas de alcance por
casualidad, no porque estuviera bien escrita. Apenas dejo de devolverselo,
`not exists (select ... from event_staff_divisions ...)` paso de "no tiene
alcance configurado" a "no puedo ver si tiene alcance configurado" —que la
funcion interpretaba igual: sin filas visibles, dejaba pasar CUALQUIER
categoria. Un colaborador acotado a una sola categoria quedaba viendo todas.
Se le agrego la misma garantia que ya tienen `event_role()`/
`event_staff_role()`/`can_score_event()` y el resto de este archivo.

### La torre de control: un heat "termina", y por qué eso faltaba

Probando el flujo real de una carrera híbrida aparecieron cinco huecos, todos
alrededor de la misma pregunta que el proyecto nunca había tenido que
contestar: **¿cuándo termina un heat?**

`heats.status` nunca llega a `'finished'` en ningún lado del código — solo
`'idle'`/`'running'` se escriben alguna vez (ver el historial de
`start_heat`/`cancel_heat_start`). Sin esa señal, nada podía saber si un heat
seguía en curso, y de ahí colgaban los cinco problemas reportados.

**`heats.ended_at`** es la columna que faltaba. La llena `recomputeLanes()`
—el mismo recálculo que ya corre en cada sincronización de un juez y cada vez
que el organizador aprieta "Recalcular"— cuando **todos** los carriles con
atleta de ese heat llegan a un estado terminal (`finished`/`dnf`/`dq`) en
`results`. Si un recálculo posterior (anular un marcaje, por ejemplo) hace
que deje de estar completo, se destranca sola: no hay un tercer lugar donde
alguien tenga que acordarse de tocarla a mano.

- **`start_heat` ahora exige que ningún juez de este heat esté YA en otro
  heat en curso** (`started_at is not null and ended_at is null`). Antes solo
  `claim_lane` —la AUTOasignación del juez— tenía el límite de un heat a la
  vez; `transfer_lane` (la asignación del organizador desde Heats) no lo
  tenía, y con eso se podía pre-asignar al mismo juez a dos heats que
  terminan largándose en simultáneo. El mensaje nombra a los jueces en
  conflicto.
- **Marcar DNF desde el panel** (`marcarDnf`, en `heats/actions.ts`, botón en
  Control) es para el atleta que no se presentó: sin esto el reloj de ese
  carril seguía corriendo indefinidamente y nada permitía cerrar el heat.
  Pasa por **el mismo camino que el botón DNF del juez** —`ingest_timing_events`
  con un evento `dnf` más en el log— para que no exista una segunda forma de
  llegar al mismo estado. El `elapsedMs` se deriva de `heat.started_at`, no
  se acumula, misma doctrina que el resto del cronómetro.
- **La torre de control se dividió**: `page.tsx` sigue siendo el servidor
  (consultas, RLS), pero la lista de heats se resuelve en un arreglo plano
  —sin `Map`, que no cruza bien la frontera servidor→cliente— y se renderiza
  en `TorreDeHeats` (cliente), que agrega el filtro por categoría, el reloj
  en vivo del heat en curso (`RelojDeHeat`, mismo patrón que `LiveClock` del
  juez: al DOM directo, sin pasar por React) y el botón de DNF por carril.
- **`cancel_heat_start` no cambió sus reglas** —sigue exigiendo cero
  marcajes— pero el JUEZ ahora vuelve a preguntar si sigue vigente. Antes
  `EsperandoLargada` solo consultaba la largada ANTES de anclar el reloj; una
  vez anclado —que pasa solo, sin que el juez toque nada, en cuanto llega
  `heatStartEpochMs`— nada volvía a preguntar. Una salida en falso deshecha
  por la organización dejaba el reloj de cada juez corriendo sobre un heat
  que ya no existía en la base. `useDetectarLargadaDeshecha` (en
  `judge/lib/`, usado por `JudgeScreen` y `WodJudgeScreen`) vuelve a
  preguntar cada 5s mientras el carril siga sin terminar, y reinicia el
  carril solo si la respuesta es "no arrancó" **tres veces seguidas** — no
  una: `onCheckStart` ya devuelve `null` también cuando falla la red (para no
  cortar el polling de espera), así que una sola respuesta no alcanza para
  distinguir "la organización deshizo la largada" de "hubo un bache de
  señal".

### Distribución automática de heats

Con 80 atletas o más, armar heats de a uno y asignar cada juez a mano es
tedioso — y elegir a mano quién juzga a quién es justo el lugar donde alguien
podría acomodar el resultado. `auto_distribuir_heats(p_event_id,
p_lanes_por_heat)` arma de una TODOS los heats de TODAS las categorías con
equipos confirmados, numerados desde 1, con la cantidad de carriles que pida
el organizador, y reparte los jueces ya cargados en el evento **al azar**
entre los carriles — es el "evitamos fraude" del pedido original.

- **El nombre del heat pasó a ser único por CATEGORÍA, no por evento**
  (`unique (event_id, division_id, name)`, no `unique (event_id, name)`).
  Sin este cambio, "Individual Masculino" y "Individual Femenino" no podían
  tener las dos su propio "Heat 1" — chocaban entre sí. `division_id` sigue
  siendo nullable a nivel de base (heats viejos sin categoría no se tocan),
  pero desde ahora es **obligatorio en la app**: el modal de alta ya no
  ofrece la opción "Mixto — varias divisiones" que había antes, que no era
  ninguna categoría real, solo `division_id = null` con otro nombre.
- **`createHeat` ya no pide nombre ni hora de largada.** El nombre se genera
  solo — `"Heat " || (mayor consecutivo existente en esa categoría + 1)`,
  nunca por cantidad de filas, porque borrar un heat de en medio y volver a
  crear uno con "cantidad + 1" chocaría con el que ya existe. La hora de
  largada real se sigue cargando en `/cronograma`; pedirla al crear no
  aportaba nada.
- **Correr la distribución dos veces RECALCULA, no duplica.** Por categoría:
  se borran los heats que **todavía no largaron** (con su cascada de
  carriles) y se arma la lista fresca de equipos confirmados que no están ya
  corriendo en un heat en marcha. Los heats que **ya largaron** —tengan o no
  marcajes— no se tocan, y sus equipos quedan excluidos del reparto nuevo.
  Es lo que permite sumar categorías o atletas después de la primera corrida
  y volver a apretar el botón sin perder nada. La numeración de la tanda
  nueva esquiva los "Heat N" que ya usa un heat en marcha de esa categoría.
- **El pool de jueces es el mismo `event_staff` aprobado que ya lista la
  pantalla de Jueces** — no `org_members`. Se mezcla una sola vez por corrida
  (`order by random()`). `getJudges()` (el selector manual de "asignar juez"
  en `HeatCard`) también exige `approved_at is not null`, por la misma razón:
  antes un juez que se había postulado y todavía no estaba aprobado podía
  aparecer como elegible en ese selector.
- **Sin ningún juez cargado, la distribución NO falla — arma los heats
  igual, con los carriles libres.** La primera versión bloqueaba la funcion
  entera si `event_staff` estaba vacío, y eso le impedía al organizador armar
  los heats primero e invitar jueces después, que es el flujo real. La
  garantía de "no se larga un heat sin juez" ya la exige `start_heat()` (mira
  `judge_id is null` en los carriles con equipo) — bloquear otra vez acá no
  sumaba seguridad, solo quitaba flexibilidad. Correr la distribución de
  nuevo después de invitar jueces (o asignar a mano desde `/heats`) es el
  ajuste esperado.
- **El reparto evita repetir un juez dentro del mismo heat y en heats
  seguidos de la misma categoría.** Antes era un round-robin plano sobre
  todos los carriles de todas las categorías sin memoria de heat: con pocos
  jueces terminaba fácil el mismo juez en dos carriles del mismo heat —
  físicamente imposible— o en el Heat 1 y el Heat 2 sin margen para
  moverse entre uno y el otro. Ahora, por categoría, cada carril busca el
  primer juez de la rotación que no haya quedado ni en el heat actual ni en
  el inmediatamente anterior — nunca busca más atrás que eso, así que el
  Heat 1 y el Heat 3 sí pueden repetir el mismo juez a propósito. **Es mejor
  esfuerzo, no una garantía dura**: con muy pocos jueces puede ser imposible
  evitarlo del todo, y ahí cae al round-robin plano de siempre en vez de
  fallar — igual que con la falta de jueces, el organizador ajusta después.
- **Solo equipos confirmados y no retirados.** Por construcción, toda fila de
  `teams` ya es una inscripción confirmada o pagada (`teams` nace únicamente
  desde `confirm_registration()` o `import_teams()` — nunca de una
  inscripción a medias, ver "Una inscripcion NO es un equipo"), así que no
  hace falta un segundo chequeo de "aprobado". El único filtro que faltaba
  era `status <> 'withdrawn'`, ahora aplicado tanto en la distribución
  automática como en el selector manual de `/heats`.
- **Sin gate de plan por ahora, a propósito.** Es candidato a plan Pro más
  adelante — ver [El plan corta por VISIBILIDAD](#el-plan-corta-por-visibilidad-no-por-captura)
  y `src/features/planes/lib/errores.ts` — pero queda habilitado para
  cualquier organización hasta que se decida el corte.
- **Después de correr la distribución, el organizador ajusta a mano igual
  que siempre**: `HeatCard` (reasignar equipos, cambiar el juez de un
  carril) no cambió — los heats que arma la distribución automática son
  filas comunes de `heats`/`lanes`, indistinguibles de las que se crean a
  mano.
- **`/heats` agrupa la lista por categoría.** Con quince heats o más, una
  lista plana obliga a leerla entera para encontrar la de una categoría —
  mismo motivo que ya llevó a la torre de control a un filtro por división.

### Cinco pantallas de alta, un solo patrón

Divisiones, Circuito, Atletas, Heats y Penalizaciones son la misma forma:
descripción + botón de alta a la derecha, arriba de la pantalla, que abre un
modal. Se armonizaron después de que las cinco hubieran crecido cada una a su
manera —formularios fijos al pie en unas, botones de otro color y otro
tamaño en otras—, y quedaron reglas concretas que conviene sostener si se
agrega una sexta:

- **`BotonAbrirModal`** (`shared/components/`) es el ÚNICO estilo de botón de
  alta: mismo relleno lima, mismo `px-5 py-3`, misma posición. Los seis
  disparadores actuales —Crear categoría, Crear circuito, Crear atleta, Crear
  heat, Crear penalización, Distribuir automáticamente— lo usan. Un séptimo
  botón de alta que no lo use es el primer lugar donde la inconsistencia
  vuelve a aparecer.
- **El texto es "Crear {cosa}"**, en minúscula salvo la primera palabra —la
  convención tipográfica que ya usaba el resto de la app ("Nueva categoría",
  no "Nueva Categoría")— y se repite igual en el botón que abre el modal, en
  el título del modal, y en el botón de guardar adentro. Las tres instancias
  dicen lo mismo a propósito: es la misma acción vista tres veces, no tres
  acciones distintas.
- **`CircuitoDeHyrox` es la excepción, y lo sigue siendo.** No es un modal —
  son dos botones sin ningún campo, porque el circuito de Hyrox son siempre
  las mismas 16 estaciones y no hay nada que escribir. Convertirlo a modal
  agregaría un paso sin ninguna pregunta que hacer.
- **El backdrop de `Modal` ya NO cierra al clickear afuera.** Antes lo hacía,
  y era la forma más fácil de perder un formulario a medio llenar: un click
  apenas afuera del contenido —nada raro con un modal ancho en una pantalla
  chica— disparaba el cierre sin avisar, y como el formulario se REMONTA en
  cada apertura (`key={abierto ? ... : ...}`, a propósito, para no arrastrar
  un intento cancelado a la próxima vez que se abre) lo escrito desaparecía
  para siempre. Sigue cerrando por la X, por Cancelar, y por Escape —una
  tecla es una acción deliberada, un click cerca no—. Es un cambio en el
  componente compartido: alcanza a los seis modales de una sola vez.
- **"Categoría" es el término, no "División".** `divisionId`, `division_id`,
  `divisiones` como nombre de variable y `NuevaDivision` como nombre de
  componente se quedan igual —son identificadores de código, no texto que
  lee el organizador—, pero cualquier `<label>`, encabezado de columna,
  mensaje de error o placeholder que diga "división" está mal. Se corrigió
  en más de una docena de lugares la primera vez —incluida la pestaña de
  arriba, que decía "Divisiones"— porque el término se había colado de a
  poco en mensajes de error y ejemplos de CSV.

### Atletas: qué se ve y qué no

- **DNI y correo, únicos DENTRO de la misma competencia.** Nada lo impedía:
  se podía cargar el mismo documento dos veces sin que la app dijera nada,
  a mano o por CSV. `athletes_document_unico` / `athletes_email_unico` son
  índices únicos parciales sobre `athletes (event_id, upper(trim(...)))` —
  en la tabla, no en cada camino de escritura por separado, así que valen
  igual para el alta manual (`admin_create_registration`), la importación
  CSV (`import_teams`) y la inscripción pública (`confirm_registration`) sin
  repetir la validación tres veces.
- **El correo es único POR EVENTO, no global, a propósito.** La misma
  persona corre competencias de organizadores distintos con el mismo correo
  todo el tiempo — bloquear esa reutilización habría sido el bug, no la
  corrección. Lo que no puede pasar es que dos inscriptos de la MISMA
  competencia compartan correo o documento.
- **El campo Documento se sacó de la grilla, junto con Email y Teléfono en
  texto plano.** Mostrar el DNI, el correo y el teléfono de cientos de
  personas en una tabla es exponer datos personales sin necesidad — quien
  administra la competencia casi siempre lo que quiere es COPIARLOS a otro
  lado (un mensaje, un mail masivo), no leerlos ahí. La columna "Contacto"
  ofrece un ícono de copiar por cada dato (`BotonCopiar`, en
  `shared/components/`) y un ícono de WhatsApp que abre `wa.me/<número>` —
  sin librería, con el ícono genérico de "mensaje" y no el logo de la marca,
  mismo criterio que ya usa el ícono de Instagram del pie del sitio. El
  buscador de la grilla SÍ sigue indexando DNI y correo — que no se
  MUESTREN no significa que no se puedan encontrar escribiéndolos.
- **La bandera del país va al lado del nombre de cada integrante**, no una
  sola por equipo: en una pareja mixta de países distintos, una sola bandera
  mentiría sobre la otra mitad del equipo.

### Inscripciones responde TRES preguntas, en orden

1. **Como se cobra** — los medios de pago del organizador.
2. **Cuanto sale cada categoria** — precio y cupo.
3. **Que descuentos hay** — codigos, de una categoria o de toda la competencia.

**Como se cobra va PRIMERO** porque sin un medio activo, poner precio no sirve
de nada: el atleta llega al final del tramite y no tiene por donde pagar. La
pantalla lo dice explicitamente cuando no hay ninguno.

Los medios de cobro son de la ORGANIZACION (`payment_providers.org_id`) y valen
para todas sus competencias — son sus credenciales y la plata le llega directo.
Se configuran aqui porque es DONDE IMPORTAN, no porque sean del evento.

**Un descuento con `division_id` nulo aplica a toda la competencia.** La columna
ya era nullable con ese significado desde la fase 14; lo unico que faltaba era
ofrecerlo en la pantalla.

### Leaderboard y Verificacion son dos cosas

Estaban en una sola pantalla llamada "Resultados" y se entraba buscando la tabla
para encontrar una cola de anomalias.

| | Que es |
|---|---|
| `/leaderboard` | el RESULTADO: la clasificacion, igual que la ve el publico |
| `/verificacion` | el TRABAJO sobre los datos: recalcular, revisar anomalias, publicar |

**El leaderboard del panel usa las MISMAS consultas que `/en-vivo/[slug]`.** Una
segunda implementacion del ranking para el organizador es lo que el proyecto
evita en todos lados —hay UN reductor y UN motor de puntuacion— y garantizaria
que un dia el organizador vea un podio distinto del que ve el atleta.

### Las pantallas de configuracion no llevan pestañas

Jueces, colaboradores, inscripciones, categorias, circuito, pruebas,
penalizaciones, cronograma y leaderboard son ajustes especificos a los que se
llega por la barra lateral. Ofrecer ahi arriba un atajo a "Control" es invitar
a abandonar lo que se estaba configurando.

`EventTabs` se esconde solo segun la ruta (`SIN_PESTANAS`), no por una prop:
asi agregar una pantalla de configuracion es agregar una linea y nada mas.

**"Config Competencia" es la UNICA excepcion, a proposito.** No tiene ruta
propia: es la misma pantalla que "Resumen" (`/panel/eventos/[id]`), asi que las
pestañas se ven ahi — ver
[Config Competencia y Resumen son la MISMA pantalla](#config-competencia-y-resumen-son-la-misma-pantalla).
Abre con el RESUMEN de configuracion: entrar y que lo primero sea "te faltan
dos cosas" ahorra recorrer las tarjetas para averiguarlo. Cuando no falta nada
se dice tambien: un silencio no distingue entre "todo listo" y "todavia no
revise".

### Un `Pick<>` en un prop NO quita nada en runtime

`ConfigurarProveedor` declaraba
`adaptador: Pick<Adaptador, "nombre" | "camposPublicos" | ...>` —sin el metodo
`instrucciones`— y el llamador le pasaba `ADAPTADORES[provider]` entero. El tipo
compilaba; el objeto seguia teniendo el metodo, y Next rechazaba la pagina
completa con *"Functions cannot be passed directly to Client Components"*.

La pagina de cobros estuvo rota desde la fase 14 por esto. **La solucion no es
recortar el tipo sino no pasar el objeto**: el componente importa `ADAPTADORES`
y busca el suyo por `provider`, que es lo que ya hacia `BloqueDePago`.

## Un correo, dos perfiles

La misma cuenta compite y organiza. **No hay dos registros ni un "tipo de
usuario" que elegir en la puerta**: quien se anota a una competencia y despues
arma la suya no vuelve a registrarse, y un organizador que quiere competir
tampoco.

Por eso `profiles` NO tiene una columna `rol`: el rol no es del usuario, es del
CONTEXTO. Se es organizador de las competencias propias y competidor de aquellas
en las que uno se inscribio, al mismo tiempo.

| | Donde | Que hay |
|---|---|---|
| Competidor | `/cuenta` | sus datos, su foto, sus inscripciones |
| Organizador | `/panel` | sus competencias, con menu lateral |

Cada pantalla lleva un enlace a la otra, presentado como lo que es —entrar al
otro espacio— y no como otra seccion de la misma.

### La organizacion se crea sola, y por eso se borro una pantalla

Antes, quien se registraba para organizar caia en un "crea tu organizacion"
antes de poder hacer nada. La organizacion es un concepto INTERNO —el espacio
donde viven los eventos, los atletas y los carriles, y el sujeto de casi todas
las politicas de RLS— que no le importa a nadie el primer dia. Pedirla por
adelantado es cobrar una decision que el usuario todavia no puede tomar.

`ensure_my_organization()` la crea la primera vez que alguien entra al panel,
con su nombre y un slug derivado del CORREO (no del nombre: "Ana Pérez" da
"ana-perez", que choca en cuanto haya dos). Es idempotente. La llama el layout
de `/panel`, asi que el usuario entra directo a su tablero.

Sigue existiendo y sigue siendo la base de la seguridad; lo unico que cambio es
quien la crea. **El usuario no ve la palabra "organizacion" hasta que quiera
invitar a alguien.**

### El panel es un espacio de trabajo, y por eso lleva barra lateral

Alguien configurando una competencia salta veinte veces entre categorias,
pruebas, atletas y heats. Con los destinos en el encabezado, cada salto obliga a
volver arriba; en una barra lateral estan siempre en el mismo sitio. En celular
se convierte en un cajon: una barra fija se comeria media pantalla.

### La foto de perfil

- **El archivo va DIRECTO del navegador a Storage**, no a una server action.
  Reenviarlo desde el servidor significa cargar la imagen entera en memoria,
  pagar el doble de trafico y chocar contra un limite de payload que no
  controlamos.
- **La ruta lleva marca de tiempo.** Con un nombre fijo el CDN sigue sirviendo
  la foto vieja: el usuario sube una nueva, ve la anterior, y vuelve a subirla.
- **La accion que guarda la URL valida que apunte al bucket de avatares.** Sin
  eso, cualquiera podria dejar en su perfil la URL de un dominio ajeno y usar el
  leaderboard publico para rastrear quien lo mira.
- **El bucket se crea dentro de un guard que comprueba que exista el schema
  `storage`.** PGlite es Postgres de verdad pero no trae la extension de Storage
  de Supabase: sin el guard, la migracion revienta y con ella los 695 tests.

### El asistente de creacion

- **`max-w-4xl`, no `2xl`.** Una competencia se configura en un escritorio, y la
  franja angosta del medio dejaba media pantalla vacia a cada lado. Ancho
  suficiente para dos columnas de campos sin que una linea de texto se vuelva
  ilegible de tan larga.
- **El indicador se ve como un ASISTENTE, no como cuatro botones.** La
  diferencia es la LINEA QUE UNE los circulos: cuatro cajas sueltas son cuatro
  destinos independientes; unidas por una linea que se pinta a medida que se
  avanza son un camino, y contestan "¿cuanto me falta?" sin que nadie lo
  pregunte. Encima va "Paso N de M", que lo dice sin ambiguedad.
- **La etiqueta va AL LADO del circulo, no debajo.** Debajo, cada paso necesita
  un ancho fijo para que los titulos no se pisen y el conector hay que empujarlo
  a mano hasta el centro del circulo con un margen magico — que se rompe en
  cuanto un titulo es mas largo que los otros, o sea con "Informacion general"
  al lado de "Pruebas". Al lado, `items-center` centra el conector solo y no hay
  ni un pixel puesto a ojo.
- **El boton dice "Continuar", no el nombre del paso siguiente.** El indicador
  ya dice cual viene, y repetirlo hace que el boton crezca y encoja de paso en
  paso.
- **Los pasos opcionales lo dicen.** Sin la etiqueta, alguien se traba buscando
  que le falta en un paso que puede saltear.
- **El titulo del paso va DEBAJO del indicador.** Primero se ve donde se esta en
  el camino, y despues que hay que hacer aqui.
- **Los titulos de seccion se leen como titulos** —barra de color y tamaño de
  titulo— y van SOLOS. Antes eran versalitas grises del mismo tamaño que las
  etiquetas de los campos, y el formulario se leia como una lista plana de
  veinte controles. Pero tampoco llevan subtitulo: "Donde — donde se corre" no
  agrega nada que el titulo no diga, y una linea explicando cada una de las
  cinco secciones alarga la pantalla en cada visita.
- **El asistente no escribe a mano el nombre del paso siguiente.** `createEvent`
  redirigia a `categorias` con el slug literal; cuando entro `documentos` entre
  medio, el salto quedo y esa pantalla no la veia nadie. Ahora usa
  `pasoSiguiente()`. **Un paso opcional se puede saltear, pero eso lo decide
  quien lo usa, no el codigo.**
- **La categoria NO exige circuito.** Era lo ultimo que quedaba del modelo
  viejo: cuando la plataforma solo entendia de carreras hibridas, cada categoria
  corria UN circuito y sin circuito no se podia crear ninguna.
  `divisions.course_template_id` se volvio nullable en la fase 9 justo para
  esto, pero `createDivision` lo seguia pidiendo. El selector aparece segun el
  formato: en un CrossFit ni se menciona, porque preguntar por un circuito ahi
  hace dudar de si la herramienta entendio que competencia se esta armando.
- **Una carrera hibrida sin circuito lo resuelve DENTRO del asistente.** Antes
  un cartel mandaba a `/panel/eventos/[id]/circuito`, otra pantalla con otra
  navegacion y sin vuelta obvia al paso donde uno estaba. Sacar a alguien de un
  asistente a mitad de camino es la forma mas segura de que no lo termine. Ahora
  hay dos botones: el preset de Hyrox o uno vacio.
- **Los documentos son un PASO PROPIO.** Estuvieron un rato al final del paso
  "general" y no se veian nunca: `createEvent` redirige directo a categorias,
  asi que nadie volvia a ese paso. Un paso propio los hace inevitables y ademas
  necesita que el evento ya exista — sin id no hay carpeta donde subir.

### Los archivos del evento

- **El logo se SUBE, no se pega una URL.** El campo de texto pidiendo un enlace
  directo funciona para quien ya tiene su afiche subido a algun lado y sabe
  sacar la URL cruda, o sea casi nadie: lo normal es tener el JPG en el celular.
- **La vista previa es CUADRADA** porque es el recorte exacto que sufre en la
  tarjeta del catalogo. Mostrarla apaisada aqui y cuadrada alla deja que el
  organizador descubra despues que su afiche perdio el nombre del evento.
- **`ZonaDeArchivo` acepta arrastrar Y hacer click.** Solo arrastrar deja afuera
  a quien esta en un celular y a quien navega con teclado.
- **Los limites se dicen antes y se validan antes.** El bucket tambien los
  aplica —esa es la barrera— pero enterarse de que la foto pesa demasiado
  DESPUES de subir ocho megas es una espera regalada.
- **La ruta lleva marca de tiempo y el nombre se sanea.** Con nombre fijo el CDN
  sigue sirviendo el archivo viejo; y "Reglamento (v2).pdf" rompe la ruta.
- **Un solo bucket `eventos` para logo, portada y documentos.** Tres buckets
  tendrian la misma politica —manda quien puede administrar el evento— y serian
  tres lugares donde equivocarse al cambiarla. La primera carpeta es el id del
  evento, y la politica lo valida como uuid ANTES de castear: un nombre
  cualquiera haria fallar el cast y con el toda la subida.
- **La accion que registra un documento valida que la URL apunte a NUESTRO
  bucket.** Sin eso, un organizador podria dejar en la ficha publica un enlace a
  cualquier dominio y los atletas descargarian de ahi confiando en la
  plataforma.
- **Borrar un documento borra la FILA, no el archivo.** Lo primero es reversible
  en un minuto; lo segundo no.

### Los dos grupos de documentos

No es una separacion cosmetica: cambian lo que le pasa al atleta.

| Grupo | Que hace |
|---|---|
| Informativos | se muestran en la ficha publica y punto |
| Terminos | hay que ACEPTARLOS para poder inscribirse |

Por dentro es la misma tabla con `requires_acceptance`, y no dos tablas: un
reglamento puede volverse obligatorio de un dia para el otro sin mover el
archivo de lugar. Si el grupo de terminos esta vacio, el formulario de
inscripcion no pide aceptar nada.

**La seccion NO va dentro del `<form>` de la ficha.** Subir un documento tiene
que guardarse en el acto —el archivo ya esta en Storage— y no esperar a que el
organizador apriete "Guardar" al final de una pantalla larga. Ademas es el caso
del bug de `HeatCard`: React 19 llama al `form.reset()` nativo al terminar una
accion.

**El selector de idioma vive en TODA la app**, no solo en el portal publico. Un
organizador brasileño que cambia a portugues en la portada y entra al panel no
espera encontrarlo de vuelta en español: esta en la barra lateral, junto al
usuario.

## Los parametros de una categoria

`division_movements` guarda el ESTANDAR DECLARADO de una categoria: que
movimientos lleva y con cuanto peso.

**Por que no es `division_movement_specs`.** Aquella responde "en ESTA prueba,
esta categoria levanta tanto": cuelga de un `part_movement_id`, o sea de un
movimiento dentro de un WOD concreto, y es lo que necesita el juez. Esto es otra
cosa: "Elite Masculino: Thruster 43 kg" existe meses ANTES de que haya una sola
prueba cargada, y sigue existiendo aunque las pruebas cambien. Meterlo en la
otra tabla obligaria a inventar un WOD falso para poder guardarlo.

### Kilos o libras

Se guarda SIEMPRE en kilos —es la unidad canonica, la del resto del esquema y la
que compara el motor— **mas la unidad en la que el organizador lo escribio**. Sin
lo segundo, quien programo "95 lb" —el numero redondo del reglamento— lo veria
de vuelta como "43,09 kg" y creeria que la pantalla se equivoco.

El factor es el exacto de la libra (`0.45359237`), no 2,2: con la aproximacion,
un round-trip de 95 lb devuelve 94,6 y el numero deja de ser el del reglamento.
Hay un test que recorre los pesos tipicos (65, 95, 135, 155, 185, 225) y verifica
que vuelven iguales.

### Lo que se pide depende del formato

| | CrossFit | Carrera hibrida |
|---|---|---|
| Limite de registros | si | si |
| Sistema de puntuacion | se elige | **no se ofrece**: es por tiempo |
| Movimientos con peso | si | no |
| Parametros del circuito | no | si |

**Preguntar por un circuito en un CrossFit —o por una tabla de puntos en una
carrera— hace dudar de si la herramienta entendio que competencia se esta
armando.** Hay un test de componente que falla si las dos ramas se cruzan.

`division_segment_specs` es lo que hace que **Elite corra 1 km y Amateur 500 m en
la misma carrera**: el circuito es uno solo y cada categoria lo recorre con sus
propias distancias, pesos y repeticiones. Sin eso, la unica forma de tener dos
distancias seria duplicar el circuito entero — y entonces ya no seria la misma
carrera. Un campo vacio BORRA el ajuste y vuelve al valor del circuito; guardarlo
como cero diria "cero metros", que es otra cosa.

### Otras reglas

- **El cupo vacio es NULL, no cero.** Cero es un cupo real —una categoria
  cerrada— y confundirlos dejaria fuera a todo el mundo sin que nadie entienda
  por que. La pantalla lo dice: "Sin limite" en el placeholder, "Cupo ilimitado"
  en el resumen.
- **El cupo vive en `division_registration`, no en `divisions`.** Es un dato del
  TRAMITE: la categoria sigue existiendo cuando las inscripciones cierran.
- **Se quito el campo "Nivel".** Lo que decia —RX, Scaled, Elite— ya esta en el
  nombre de la categoria, y tenerlo en dos lados garantiza que un dia digan
  cosas distintas. La columna sigue en la base para no perder lo ya cargado.
- **El cupo y la tabla de puntos se preguntan AL CREAR, no solo al editar.** Son
  lo primero que un organizador decide sobre una categoria, y dejarlos para
  despues obliga a volver a abrirlas una por una — y a descubrir primero que se
  abren.
- **El acordeon dice "Configurar", no solo una flecha.** Una flecha sola se lee
  como adorno: el organizador no descubre que ahi adentro estan el cupo, la
  puntuacion y los movimientos, y se queda creyendo que la categoria ya esta
  completa.
- **El catalogo tiene 148 movimientos y aun asi falta alguno**: cada box inventa
  el suyo. Por eso hay salida a texto libre (`custom_name`), con el mismo CHECK
  que en `part_movements` — uno de los dos, nunca los dos.
- **Las categorias van en un acordeon.** Una competencia tipica tiene entre
  cuatro y diez, y cada una con sus movimientos ocupa media pantalla: abiertas
  todas, encontrar la suya es hacer scroll por dos mil pixeles.

## La ficha publica: cuatro pestañas, cuatro preguntas

`src/features/catalogo/components/` — `MarcoDelEvento` arma cabecera y pestañas,
y cada `PanelDe*` es el contenido de una. Cada pestaña contesta una pregunta del
atleta:

| Pestaña | Contesta |
|---|---|
| Informacion | ¿que es, cuando, en que categoria entro y cuanto sale? |
| Leaderboards | ¿como va? |
| Cronograma | ¿a que hora y en que escenario me presento? |
| Workouts / Circuito | ¿que voy a tener que hacer, y con cuanto peso? |

**La cuarta se llama "Circuito" en una carrera hibrida y "Workouts" en un
CrossFit.** Las dos palabras existen en el deporte, y usar la del formato
equivocado hace dudar de si la pagina entendio de que competencia se trata.

### Las pestañas son RUTAS, no estado

`/eventos/[slug]/cronograma` es una URL propia: se comparte, el boton de atras
funciona, cada pestaña se renderiza entera en el servidor y es indexable. Con
estado en el cliente no pasa nada de eso, y ademas habria que bajar los cuatro
contenidos para mirar uno. Lo unico que hace el cliente es saber cual esta
activa (`usePathname`).

**`MarcoDelEvento` NO es un `layout.tsx`**, y no por comodidad: un layout en
`eventos/[slug]/` envolveria tambien a `/inscripcion`, que es un tramite y no
una pestaña — apareceria con la barra sin ninguna activa, invitando a abandonar
el formulario a medias. El costo aparente de que cada pestaña vuelva a pedir el
evento no existe: Next deduplica dentro del mismo render.

### Cuando se muestra cada pestaña

| Pestaña | Aparece |
|---|---|
| Informacion | siempre |
| Leaderboards | **siempre** |
| Cronograma | hay heats con hora **y la competencia no paso todavia** |
| Workouts / Circuito | hay pruebas cargadas |

**Leaderboards SIEMPRE, y tiene dos vidas.** Antes solo aparecia con la
competencia en vivo, y eso la escondia durante los meses de inscripcion —
justamente cuando el atleta quiere ver quien mas se anoto. Sin resultados
muestra la LISTA DE LARGADA (`public_participants`); con resultados, la tabla.
Son la misma pregunta en dos momentos, y separarlas en dos pestañas dejaria una
vacia la mitad del tiempo.

**El cronograma desaparece cuando la competencia paso.** Los horarios de algo
que ya ocurrio no ubican a nadie: son un archivo, y le sacan el lugar a los
resultados, que es lo que se busca despues. Con un dia de gracia, para que una
competencia que corre hoy siga mostrandolo hasta que termine el dia.

**`public_participants` no expone correo, telefono, nacimiento ni estado de
pago.** Solo nombre, dorsal y categoria: es la lista que cualquier competencia
pega en la pared, y el leaderboard ya mostraba los nombres apenas arranca.

### Que hay que saber de cada panel

- **El cronograma se agrupa por DIA y despues por ARENA**, y el agrupamiento por
  arena desaparece cuando hay una sola. Una lista plana de horas no sirve el dia
  del evento: con tres escenarios en paralelo hace falta saber a donde caminar.
  El dia se calcula en el HUSO DEL EVENTO — por fecha UTC, un heat de las 20:00
  en Bogota cae en el dia siguiente.
- **Los workouts muestran el WOD, no el esquema interno.** Antes decia
  "ventana · rondas_reps · 720000ms", que son los campos de la base; ahora dice
  "AMRAP 20 min" y debajo los movimientos, como esta escrito en la pizarra del
  box. `target_per_round` se pinta como "21-15-9" cuando trae varios valores y
  como "10" cuando trae uno: repetirlo tres veces seria ruido.
- **Los pesos POR CATEGORIA son el dato.** Estaban en
  `division_movement_specs` y no salian por ningun lado; el peso es lo que
  decide en que categoria se anota alguien.
- **Una prueba sin `released_at` se LISTA pero no se abre.** El organizador
  carga los WODs con semanas de anticipacion para configurar al juez.
- **El precio se formatea con `idioma-PAIS_DEL_EVENTO`.** `es-CO` da
  "$ 180.000" y `en-CO` da "COP 180,000": el local lee su moneda como la
  escribe, y al extranjero el "$" solo lo confundiria con dolares.
- **`capacity` null se dice ("Cupo ilimitado").** Tranquiliza tanto como
  "quedan 3" apura; un hueco no dice ninguna de las dos.
- **El cupo sale de `cupos_disponibles()`, que ya existia.** Reimplementar el
  conteo en la funcion publica seria una segunda definicion de "cupo ocupado".
- **`LeaderboardLive` tiene modo `compacto`** para no pintar un segundo titulo
  del evento dentro de la pestaña.
- **Las pestañas se marcan con SUBRAYADO, no con pastilla.** Una pastilla
  rellena es un boton —invita a "hacer" algo— y cuatro juntas compiten entre si.
  El subrayado sobre una linea compartida dice "esto es un grupo, y este es el
  que estas viendo". La linea de guia llega solo hasta donde llegan las
  pestañas, no de borde a borde: una regla a todo el ancho parte la pagina en
  dos.
- **La pestaña de informacion NO repite los datos de la cabecera.** Tenia una
  tarjeta a la derecha con fecha, lugar e inscripciones — los mismos tres datos
  que estan dos dedos mas arriba, con los mismos iconos. Se quito, y las tallas
  de remera (lo unico que no estaba arriba) se mudaron a la cabecera.
- **La lista de largada usa la MISMA grilla que el leaderboard**: POS ·
  ATLETA/EQUIPO · PTS. No es una lista distinta que despues se reemplaza: es la
  misma tabla antes de tener con que llenarla.
- **Todos los inscritos van en POSICION 1**, no numerados del 1 al 40. Con cero
  puntos estan empatados, y el motor ya usa posiciones FISICAS en todo el
  scoring. Numerarlos por orden de inscripcion inventaria un ranking y el
  primero de la lista creeria que va ganando.

### La cabecera

**El `aspect-square` va en el contenedor QUE TIENE EL BORDE.** Estaba en un div
interno, y entonces la imagen era cuadrada pero el marco visible no: el flex
padre estiraba la caja externa a la altura de la fila. Y la fila se centra con
`sm:items-center`, porque con `items-start` el borde superior del cuadrado
quedaba unos pixeles por encima de la primera linea —el chip tiene su propio
relleno— y se leia como un descuadre.

Afiche CUADRADO de tamaño fijo a la izquierda —asi se diseñan, es lo que va a
Instagram— y a su derecha una sola columna: chips, titulo, y una rejilla de tres
datos con icono (calendario, lugar, inscripciones). Los iconos no son adorno:
son lo que deja leer los tres datos sin una etiqueta por renglon.

Los iconos viven en `src/shared/components/Icono.tsx`, inline y con
`currentColor`. Una libreria traeria mil quinientos para usar ocho.

## El pie del sitio

`src/shared/components/PieDelSitio.tsx`.

- **Una sola red, y es Instagram.** Es donde vive el deporte. Una fila de seis
  iconos que nadie atiende dice lo contrario de lo que pretende.
- **Los enlaces legales sin pagina van como `<span>`, no como `href="#"`.** Un
  enlace que no lleva a ningun lado se ve igual que uno roto, y en el pie —donde
  alguien busca los terminos justo antes de pagar— eso es peor que no ofrecerlo.
  Cuando existan las paginas se cambia el `<span>` por un `<Link>`.

## Tres idiomas, y un tono que no es de ningun pais

`src/shared/i18n/`. Español, portugues de Brasil e ingles. `es.ts` es la FUENTE
de las claves: los otros dos se tipan contra su `Diccionario`, asi que olvidarse
de traducir algo es un error de compilacion y no un texto en español apareciendo
en medio del ingles.

**La marca es Scora.** El wordmark lleva un punto en el color de acento
(`Scora.`) porque "Scora" no se parte en dos como se partia "Hybrid|Crono". Los
identificadores `hybrid-crono-judge` (base de Dexie), `hybrid-crono.device-id` y
`hybrid-crono.vistos` NO se renombraron: son claves de almacenamiento, nadie las
ve, y cambiarlas deja huerfana la IndexedDB de cada juez con los marcajes que no
sincronizaron.

**Neutro significa TUTEO, nunca voseo ni "usted".** "Inscribite" y "segui"
suenan a Buenos Aires; "inscribase" suena a formulario de banco. "Inscribete" y
"sigue" se leen igual de naturales en Bogota, Ciudad de Mexico, Lima y Santiago.
Vale para los tres idiomas: mismo registro, ni formal ni coloquial de un solo
pais.

**Las variables se interpolan con `{nombre}`, nunca concatenando trozos.** Un
`"Cierran en " + n + " dias"` obliga a los tres idiomas a poner el numero en el
mismo lugar, y en ingles la frase se arma al reves.

### Google: el codigo esta, falta habilitarlo en Supabase

`signInWithOAuth` esta implementado y el boton funciona. Lo que falta es
configuracion del proyecto: **Authentication → Providers → Google**, con el
client id y el secreto de Google Cloud, y `<origen>/auth/callback` entre las
URIs de redireccion autorizadas.

Se comprueba sin adivinar, pidiendo `/auth/v1/settings` con la anon key: la
respuesta trae `external` con los proveedores habilitados. Hoy dice solo
`email`.

### El idioma va en una cookie, y hay una razon para no ponerlo en la URL

Lo correcto para SEO es `/es/`, `/pt/`, `/en/`. Pero eso mete toda la app bajo
un segmento dinamico, y **`/juez/carril` tiene que seguir siendo estatica**: es
lo que permite que el service worker la sirva del cache cuando el juez reinicia
el celular sin señal. Se cambiaria posicionamiento por la garantia central del
producto. Cuando el portal lo justifique, la mudanza va con `/juez` FUERA del
segmento.

Orden de resolucion: cookie (lo que la persona eligio) → `Accept-Language` →
español. Al reves, cambiar de idioma no duraria mas que un click en un navegador
configurado en otra lengua.

### Un componente de cliente recibe el IDIOMA, no el traductor

`t` es una funcion, y Next rechaza pasarle funciones a un componente de cliente.
La salida NO es serializar el diccionario y mandarlo por props —eso lo mete
entero en el HTML de cada pagina— sino pasar el codigo de dos letras y que el
componente arme su traductor importando los diccionarios.

**`TarjetaDeEvento` es de servidor pero `VistosRecientemente` la importa desde el
cliente**, asi que en ese arbol se comporta como componente de cliente. Por eso
tambien recibe `idioma` y no `t`.

### Las fechas las arma `Intl`, no nosotros

`formatRange` sabe contraer un rango en cada idioma: "14–16 de marzo de 2026",
"March 14 – 16, 2026". Antes se componia a mano contrayendo lo repetido, lo que
funcionaba en español y en ningun otro idioma.

**`Intl` separa el guion con U+2009 THIN SPACE**, que se ve igual que un espacio
normal pero es INVISIBLE en el codigo: una expectativa de test escrita a mano
nunca coincide, y el error dice "esperado X, recibido X" con las dos cadenas
identicas a la vista. `espaciosNormales()` los cambia por espacios comunes.

### Un reemplazo de texto sobre codigo va anclado en `` o no va

El barrido de voseo uso `"sos "` sin anclar y se comio el final de **esos,
pasos, avisos, pesos, permisos y husos**, en veintidos archivos. Compilaba: son
strings y comentarios. Es la misma familia que las colisiones de cadenas guia
que ya mordieron antes.

## La tarjeta del catalogo

- **Imagen CUADRADA.** Los afiches se diseñan cuadrados —es lo que se publica en
  Instagram— y el 16:9 los recortaba arriba y abajo, justo donde estan el nombre
  y la edicion.
- **El hover AGREGA, no revela.** Es la diferencia con las ticketeras que
  muestran las fechas solo al pasar el mouse: en un celular no hay mouse y ahi la
  informacion no existe. Lo esencial esta SIEMPRE visible debajo de la imagen; el
  panel que sube es un atajo. Sube tambien con `focus-within`, para quien navega
  con Tab.
- **El panel sube sobre fondo OPACO**, no sobre un velo translucido encima del
  afiche: texto blanco sobre un logo blanco no se lee, por mucha sombra que se le
  ponga.
- **No hay etiqueta de "destacado".** Ya viven bajo un titulo que lo dice. La
  esquina se usa para la BANDERA, que responde algo que la etiqueta no: si la
  competencia queda cerca.
- **La bandera NO es emoji.** Windows no trae la fuente: en Chrome y Edge sobre
  Windows `🇨🇴` se dibuja como las letras "CO" en una cajita. Se sirven de
  flagcdn con respaldo al codigo ISO si la imagen no carga.
- **La cuenta atras aparece solo cuando aprieta** (una semana o menos) y en
  ambar. "Inscripciones abiertas" es cierto los seis meses previos y no mueve a
  nadie; "cierran en 3 dias", si.

## El plan corta por VISIBILIDAD, no por captura

Es la decision comercial mas facil de romper sin querer, porque la intuicion dice al reves.

| | Gratuito | Pro |
|---|---|---|
| Crear evento, categorias, pruebas, inscripciones, cobro a atletas, cronograma, staff | Si | Si |
| **Cronometrar un circuito con la app del juez** | **Si, igual** | Si |
| Competencias corriendo a la vez | Una | Las que quiera |
| Juzgar un WOD de CrossFit en vivo | Se carga a mano | Si |
| Leaderboard en vivo, proyector, parciales, ficha del atleta | No | Si |
| Aparecer en el catalogo publico | No | Si |

**Al que ya cronometraba su Hyrox con la app no se le quita nada.** Lo que se compra es MOSTRAR y
JUZGAR CROSSFIT EN VIVO. Si alguna vez una restriccion nueva toca el camino del cronometro, esta
mal planteada.

### Los cuatro gates, y donde vive cada uno

Todos en Postgres. Una server action se saltea llamando a PostgREST con la misma sesion del
organizador; un trigger y una funcion `security definer`, no.

| Que | Donde |
|---|---|
| El leaderboard publico no muestra nada en gratuito hasta publicar, y sin parciales | `public_scoreboard()` (fase 9) |
| Una parte que no es circuito no puede pasar a `capture_mode = 'en_vivo'` | trigger `workout_parts_en_vivo_requiere_pro` |
| Una organizacion gratuita corre una competencia a la vez | trigger `events_limitar_activos` |
| El evento no entra al catalogo | `publish_event()` |

**Por que triggers y no CHECKs.** Un CHECK no puede consultar otra tabla: Postgres lo deja escribir
dentro de una funcion, pero no lo revalida cuando cambia la fila de la que depende, y un volcado
restaurado en otro orden falla sin explicacion. La regla mira `organizations.plan`, que vive tres
tablas mas alla.

**Los dos triggers salen temprano cuando lo suyo no cambio.** Sin eso, editarle el nombre a un
evento en vivo dispararia la validacion del cupo contra si mismo, y una prueba que ya corrio
quedaria congelada para siempre el dia que la organizacion vuelva al plan gratuito.

**El circuito queda AFUERA del gate de `en_vivo`.** `time_scheme = 'circuito'` se juzga en vivo en
los dos planes, y hay un test que lo afirma en mayusculas para que nadie lo "arregle".

### PL001: el codigo de error de los limites del plan

Todo lo que rebota por el plan levanta el SQLSTATE `PL001` en vez de `check_violation`. El
traductor de errores de cada feature convierte `23514` en "algun valor esta fuera de rango", que es
correcto para un CHECK roto y pesimo para "esto es del plan Pro". Con un codigo propio el mensaje
del servidor se muestra tal cual, y al lado va el enlace para cambiar de plan
(`src/features/planes/lib/errores.ts`).

**Si agregas un limite de plan, usa `errcode = 'PL001'`** y deja que el mensaje lo escriba la
funcion: es lo unico que va a leer el organizador.

### Cosas del plan que conviene saber

- **"Activo" es `ready`, `live` o `verifying`.** Los borradores no cuentan y los `published`
  tampoco, porque ya terminaron. El limite gratuito es "una competencia a la vez", no "una en la
  vida": un box que hace una fecha por mes vive entero en el plan gratuito, a proposito.
- **No se puede volver al plan gratuito con una competencia en curso.** El leaderboard publico se
  apagaria con el proyector encendido.
- **`billing_accounts` NO es `payment_providers`.** Aquella es con que le cobra el organizador a
  sus atletas —la plata va directo a el—; esta es con que le cobramos nosotros el plan. Guarda el
  TOKEN de la pasarela, nunca un numero de tarjeta, y `card_token` quedo fuera del grant de select,
  igual que `payment_providers.secret_ciphertext`.
- **El aviso de plan es informativo, no la barrera.** `AvisoDePlan` existe para que el "no" llegue
  antes de intentarlo y con la salida al lado, no para impedir nada.

## Publicar no es lo mismo que poner en vivo

Son dos ejes independientes y confundirlos rompe el producto:

| | Que dice |
|---|---|
| `events.status` | En que momento de su vida esta la competencia: `draft`, `ready`, `live`, `verifying`, `published` |
| `events.published_at` | Si el organizador decidio mostrarla en el catalogo publico |

Una competencia **interna** corre entera —se configura, se cronometra, se verifica— sin aparecer
nunca en el catalogo. Y una publicada aparece desde que se anuncia, semanas antes de largar.

`public_events_catalog()` y `public_event_detail()` filtran por `published_at`; `public_scoreboard()`
y `public_leaderboard()` filtran por `status`. Cada una mira el eje que le corresponde.

### El catalogo publico

- **El rol `anon` sigue sin GRANT sobre ninguna tabla.** Todo lo que ve el publico sale de
  funciones `public_*` que son SECURITY DEFINER. Si aparece un `.from("events")` en
  `src/features/catalogo/`, esta mal.
- **`/eventos` esta en `PUBLIC_PREFIXES` del middleware.** Sin eso, un atleta que abre el link de
  una competencia termina en la pantalla de login. Hay un test que lo verifica leyendo el archivo.
- **El total de la busqueda viaja en cada fila** (`count(*) over ()`), para poder paginar sin una
  segunda consulta que tendria que repetir todos los filtros y correr el riesgo de no coincidir.
- **Los filtros ofrecen solo los paises y meses que existen** (`public_catalog_filters()`). Una
  lista de veintidos paises cuando hay eventos en dos es prometer resultados que no estan.
- **Los filtros escriben en la URL, no en estado local.** Asi un enlace a "CrossFit en Colombia en
  marzo" se comparte, el boton de atras funciona y la pagina se sigue renderizando en el servidor.
- **`workouts.released_at` decide cuando se hace publico un WOD.** El organizador carga las pruebas
  semanas antes para configurar la pantalla del juez, y casi nunca quiere que se vean con esa
  anticipacion. Sin esta columna habria que elegir entre configurar tarde o revelar temprano.
- **Los "vistos recientemente" viven en localStorage**, no en la base: la mayoria navega sin
  cuenta, y "que miraste" es un dato que no hace falta guardar en ningun servidor para prestar
  este servicio.

### La portada y la cuenta

- **Los cinco filtros se ven SIEMPRE** (pais, ciudad, mes, año, formato), aunque no haya nada que
  ofrecer. Antes se escondia el que no tenia opciones, y en una plataforma que recien arranca eso
  deja la portada con un solo campo de busqueda: parece que la busqueda no existe. Un selector
  vacio que dice "sin competencias aun" es informacion; uno ausente no dice nada.
- **Mes y año son independientes.** Antes viajaban juntos como `2026-03`, lo que obliga a elegir
  los dos. "Todos los marzos" y "toda la temporada 2027" son busquedas que la gente hace.
- **Mes ofrece los doce; pais y ciudad, solo los que existen.** No es incoherencia: el mes es un
  vocabulario cerrado que todos conocen de memoria y al que le faltan nueve se lee como una pagina
  rota. La lista de paises de la plataforma no la conoce nadie.
- **Mes y año se filtran contra `event_date`, nunca contra `starts_at`.** Aquella la deriva un
  trigger en el huso del evento; un `extract(month from starts_at)` lee UTC, y una largada a las
  20:55 del 31 de marzo en Bogota cae en abril.
- **La ciudad se encadena al pais** y cambiar de pais la borra: quedarse con "Medellin" despues de
  pasar a Mexico devuelve cero resultados y parece un error de la pagina.
- **El encabezado publico tiene UN solo boton.** Quien llega viene a buscar competencias, no a
  administrar nada. Sin sesion, "Mi cuenta" lleva al login; con sesion abre el menu con las tres
  cosas que hace la misma cuenta (panel, inscripciones, juzgar) y el cierre de sesion.

### Las pantallas de cuenta

Cuatro —entrar, crear cuenta, recuperar, elegir clave nueva— sobre una sola carcasa
(`PantallaDeCuenta`), a dos columnas. La izquierda no es decoracion: es la primera pantalla que ve
alguien que llego por el link de una competencia, y para el la marca no significa nada todavia. En
pantalla chica desaparece, porque ahi el que llega ya venia decidido.

- **Google va ARRIBA del formulario**, no abajo como un "ademas". Es un click contra doce
  caracteres en un teclado de celular, y una cuenta creada con Google nunca queda sin confirmar
  esperando un correo que cayo en spam. Hay que habilitar el proveedor en Supabase
  (Authentication -> Providers -> Google); si no esta, el boton falla con un mensaje que lo dice.
- **`signInWithOAuth` no redirige solo desde el servidor**: devuelve la URL y hay que mandar ahi al
  navegador. Es una accion de servidor para que el `redirect` tambien lo sea y el boton funcione
  con el JavaScript a medio cargar.
- **Recuperar contraseña responde SIEMPRE lo mismo**, exista o no la cuenta. Distinguir convierte
  la pantalla en un enumerador de usuarios, por el mismo motivo por el que el login no separa "no
  existe" de "clave incorrecta".
- **`/recuperar` y `/nueva-clave` estan en `PUBLIC_PREFIXES`.** El enlace del correo llega a
  alguien SIN sesion: sin eso el middleware lo manda al login, que es justo lo que no puede pasar.
- **El campo de clave lleva su `autoComplete` correcto** (`current-password` / `new-password`).
  Ponerle `off` "por seguridad" impide que el navegador ofrezca la guardada o genere una fuerte, y
  empeora las contraseñas de todo el mundo.

### Una FK compuesta con SET NULL anula TODAS sus columnas

El patron `(algo_id, event_id) references padre (id, event_id)` esta en todo el esquema porque RLS
necesita llegar al evento sin joins. Cuando esa FK es `on delete set null` **a secas**, borrar el
padre intenta poner `event_id = null` en la hija y falla con un mensaje que no menciona ni la tabla
ni la accion que lo provoco:

```
null value in column "event_id" of relation "heats" violates not-null
```

Habia tres asi, y las tres rompian algo que la app ofrece: borrar un equipo con carril asignado,
borrar una categoria con heat, y quitar un segmento del circuito ya cronometrado. Desde Postgres 15
se acota con `on delete set null (columna)`. **Si agregas una FK compuesta con SET NULL, nombra la
columna.**

### RESTRICT no tolera la cascada, y NO ACTION tampoco

Hoy **no se puede borrar un evento ni una organizacion** con un `delete` a secas, y no esta
expuesto en el panel por eso.

Siete FKs son `on delete restrict` con el padre y la hija muriendo en la MISMA cascada:
`part_divisions -> course_templates`, `divisions -> course_templates`, `teams -> divisions`,
`heats/lanes -> workouts`, `registrations -> divisions`, y `timing_events -> timing_events` por
`supersedes_id`. RESTRICT se comprueba INMEDIATAMENTE: cuando mira, la hija todavia esta ahi.

Lo que parece el arreglo no lo es. **`no action` tampoco alcanza** —se probo, cambiando las siete y
corriendo el borrado— porque la cola de triggers del statement dispara la comprobacion de
`course_templates` antes de que la cascada llegue a `part_divisions`. Haria falta
`deferrable initially deferred`, que mueve TODOS los errores de FK al commit y empeora la
atribucion en el resto de la app.

`scripts/seed-dev.mjs` lo resuelve borrando en orden de dependencia. **Cuando el panel ofrezca
"eliminar competencia", eso tiene que ser una funcion de Postgres**, no un `delete from events`.

Es hermano del bug de las FK compuestas con SET NULL: la accion de la FK se eligio pensando en
borrar UNA fila, y se paga al borrar el arbol.

## El asistente es una lista de datos, no un componente con ramas

`src/features/events/lib/asistente.ts` define los pasos como un arreglo. La navegacion, el
indicador de progreso y los botones de siguiente se pintan desde ahi. Ya se cobro dos veces —
cuando entro `documentos` en el medio, y cuando salieron `categorias` y `pruebas`— y las dos veces
fue tocar el arreglo y nada mas.

### Los cuatro pasos, y por que categorias y pruebas NO estan

```
Informacion general  →  Documentos  →  Inscripcion  →  Resumen
```

El asistente arma la **ficha** de la competencia: como se llama, que papeles pide y como se cobra.
Es un tramite de una sentada, con principio y fin.

**Categorias y pruebas viven en "Configuracion competencia"** (`/divisiones` y `/pruebas`) porque
NO son un tramite: se cargan, se corrigen y se vuelven a abrir durante semanas — una categoria
nueva en marzo, un peso que cambia la vispera. Tenerlas como paso 3 y 4 obligaba a entrar a un
asistente y recorrerlo para tocar un kilaje.

**El paso de inscripcion tiene su PROPIO componente**, distinto del que usa la pantalla standalone
del panel — ver [Un solo "Continuar", sin botones de guardar sueltos](#un-solo-continuar-sin-botones-de-guardar-sueltos-en-el-asistente)
mas abajo. Antes eran el mismo (`ConfiguracionDeInscripciones`), pero ese componente tiene un
"Guardar" por seccion y el asistente ya no puede tenerlos: el paso del asistente es
`PasoInscripcionAsistente` / `FormularioInscripcionAsistente`, que hace las mismas tres preguntas
—como se cobra, cuanto sale, que descuentos hay— con las mismas consultas y los mismos textos, pero
en un formulario que guarda con el boton "Continuar".

**El resumen habla SOLO de los tres pasos del asistente**, no de categorias ni pruebas: esas viven
en "Configuracion competencia", que ya tiene su propio indice con cuanto hay cargado. Repetirlas en
el resumen era la misma informacion en dos pantallas, actualizandose por separado. **Tampoco
muestra los errores y avisos de `getConfigIssues`** — eso vive SOLO en el resumen de la
competencia (`/panel/eventos/[id]`, la pestaña "Resumen"), que ya los mostraba. El resumen del
asistente es una lista de lo que se cargo, sin ningun tono de advertencia; el de la competencia es
el que dice que falta para largar.

**`ParametrosDeCategoria` se mudo del asistente a `/divisiones`** con el acordeon entero: cupo,
puntuacion, movimientos con peso o parametros del circuito, y el "Quitar categoria" DENTRO del
desplegable — una ✕ al lado del nombre se aprieta sin querer.

### Un solo "Continuar", sin botones de guardar sueltos en el asistente

En el asistente **ningun paso tiene su propio boton "Guardar"**. El boton "Continuar" de abajo
guarda de verdad lo que se cargo en ese paso y recien despues avanza — no hay forma de "avanzar sin
guardar" ni de "guardar sin avanzar".

- **`general`**: `updateEvent` ahora termina con `redirect()` al paso siguiente en vez de
  revalidar y quedarse. Es el UNICO llamador de `updateEvent` (la pantalla vieja de edicion
  redirige al asistente, ver mas abajo), asi que hardcodear el destino como
  `pasoSiguiente("general")` es seguro. `FichaDelEvento` no cambio nada por dentro: ya renderizaba
  su propio boton al final del formulario, y ahora ese boton dice "Continuar →" en vez de
  "Guardar" — es el mismo patron que ya usaba `/panel/eventos/nuevo`, que nunca tuvo un boton
  separado.
- **`inscripcion`**: es el caso dificil, porque antes eran CUATRO formularios con CUATRO botones
  —moneda, medio de cobro, precios, codigos—. `FormularioInscripcionAsistente` junta moneda, medio
  de cobro y precios en un solo `<form id="paso-inscripcion">`, y `guardarPasoInscripcion` hace las
  tres escrituras (evento, `payment_providers`, `division_registration`) en una sola accion antes
  de redirigir. El boton "Continuar" vive FUERA de ese formulario —despues de los codigos de
  descuento, al final de la pantalla— y se asocia con el atributo HTML `form="paso-inscripcion"`:
  es exactamente para esto que el atributo existe, y evita tener que anidar los codigos de
  descuento dentro de un `<form>` que ya tiene el suyo. El `pending` que deshabilita el boton sale
  del tercer valor de `useActionState` (React 19), no de `useFormStatus`, porque ese hook solo lee
  el `<form>` ancestro y el boton no es descendiente del formulario que envia.
- **Los codigos de descuento quedan AFUERA de "Continuar" a proposito.** Crear un codigo es
  agregar un item a una lista que sigue creciendo despues —igual que "Nueva categoria" o subir un
  documento—, no un campo del paso que haya que confirmar para avanzar. Meterlo en el formulario
  grande obligaria a elegir entre crear el codigo o pasar de paso.
- **Un medio de cobro sin tocar no se guarda como fila vacia.** `guardarPasoInscripcion` solo hace
  upsert de `payment_providers` si ya existia una fila para ese proveedor O si el organizador
  escribio algo (activo, algun campo publico o el secreto). Sin ese chequeo, "Continuar" crearia una
  fila vacia por cada medio que el organizador ni siquiera abrio.
- **`documentos` y `resumen` no necesitan nada de esto.** `documentos` ya guardaba solo al soltar
  el archivo (ver mas abajo), y `resumen` no tiene ningun campo: los dos siguen con un "Continuar"
  que es un simple `<Link>`, sin formulario.
- **La pantalla standalone (`/panel/eventos/[id]/inscripciones`) SIGUE con sus botones
  individuales.** No tiene un "Continuar" del que colgarse, asi que `ConfiguracionDeInscripciones`
  —el componente original, con "Guardar" por seccion— sigue siendo el correcto ahi. El asistente
  usa un componente DISTINTO (`PasoInscripcionAsistente`), no el mismo con una bandera.

### El indicador de pasos ocupa TODO el ancho, no solo lo que sus pastillas pesan

Con cinco pasos y titulos largos ("Informacion general" junto a "Pruebas") la fila se pasaba del
`max-w-4xl` del asistente y hacia falta desplazamiento horizontal. Con los CUATRO pasos actuales
eso ya no pasa, y el diseño se invirtio: `PasosDelAsistente` ya no es `min-w-max` con tramos de
ancho fijo, es `w-full` con cada paso y cada tramo en `flex-1` — la barra se estira para llenar lo
que haya, angosta en un celular y ancha en un escritorio, en vez de quedar pegada a la izquierda
con un resto de espacio sin usar del otro lado.

### "Informacion general" del menu abre el ASISTENTE

`/panel/eventos/[id]/informacion` tenia su propio formulario, identico al del paso `general`: dos
pantallas con las mismas preguntas y ninguna garantia de que siguieran iguales. La barra lateral
ahora apunta a `/panel/asistente/[id]/general` y la ruta vieja **redirige** en vez de borrarse: el
enlace ya esta en marcadores, y un 404 no explica a donde se fue.

**El borrador vive en la base, no en memoria.** El evento se crea en `draft` al terminar el primer
paso y cada paso siguiente escribe de verdad. Un asistente que acumula estado en el cliente pierde
todo con un refresh, y configurar una competencia lleva mas de una sentada.

El asistente cuelga de `/panel/asistente/[id]/[paso]` y no de `/panel/eventos/[id]/asistente/`
porque aquel layout ya pinta titulo y pestañas del evento: anidarlo daba dos encabezados.

### Cosas del evento que conviene saber

- **`events.event_date` ya no se carga a mano: se deriva de `starts_at` en el HUSO DEL EVENTO**
  (trigger `events_derivar_fecha`). Sin el huso, una largada a las 20:55 en Bogota es el dia
  siguiente en UTC y la competencia aparece un dia corrida en el catalogo.
- **Un `<input type="datetime-local">` da hora de pared, sin zona.** Guardarla directo como
  timestamptz la interpreta en UTC y corre la largada varias horas. La conversion va por
  `instanteEnZona()` / `paraInputLocal()` de `src/shared/utils/fecha.ts`, que resuelven el offset
  preguntandole a `Intl` e iteran una segunda vez para caer del lado correcto de un cambio de
  horario de verano.
- **`country` se guarda en ISO de dos letras**, con un CHECK que lo exige. Es lo que hace que el
  catalogo publico pueda filtrar por pais sin depender de como lo escribio cada organizador.
- **`shirt_sizes` vacio significa que el evento no entrega remera** y no le pide la talla a nadie.
- **Un archivo `"use server"` solo puede exportar funciones async.** Ya paso dos veces: con
  `tiempoAMs` y con la constante `TALLAS`. Compila, y el build falla al recolectar la pagina con
  un error que no menciona el archivo culpable. Las constantes y las funciones puras van a `lib/`.

## Una prueba se describe, no se elige de una lista

`src/shared/scoring/` es el segundo motor puro del proyecto, hermano de
`src/shared/timing/` y con el mismo estatuto: sin DOM, sin React, sin Supabase, corre identico en
cliente y servidor, y es donde vive la correccion del producto.

La decision que lo sostiene: **una prueba no se elige de un enum de formatos, se describe con dos
datos independientes.**

- **Estructura** — que hace el atleta: `part_blocks` (bloques que se repiten) y `part_movements`
  (movimientos con `target_per_round int[]`). Es lo que maneja la pantalla del juez.
- **Puntuacion** — como se vuelve comparable: una `score_unit` y una `score_dir`. Es lo que come
  el motor.

Ocho unidades por dos direcciones cubren todo lo que existe. Fran es `cap` + `tiempo` +
`menor_gana` con `target_per_round = {21,15,9}`; un AMRAP es `ventana` + `rondas_reps` +
`mayor_gana`; Tabata es `intervalos` con bloques de 20s/10s; Death By es el mismo arreglo con
objetivo ascendente. **Si aparece un formato que no entra, se agrega una configuracion, no un
`case`.** Enumerar formatos es una carrera perdida: hay mas de veinticinco en uso y cada temporada
aparecen mas.

Un circuito tipo Hyrox es `time_scheme = 'circuito'` y sigue apoyandose en
`course_templates`/`segments` sin tocarlas. No se unifico con `part_movements` a proposito: es la
estructura sobre la que corre el unico codigo probado en competencia real.

### La cadena de derivacion

```
timing_events ──▶ reduceLaneEvents ──▶ results ──┐
                                                 ├──▶ workout_scores ──▶ computeOverall ──▶ standings
carga manual ────────────────────────────────────┘
```

Cada flecha es una funcion pura de TypeScript. **No hay una linea de scoring en SQL**, por la
misma razon por la que no hay una segunda implementacion del calculo de tiempos. Ademas de
doctrina hay una razon tecnica: el desempate del reglamento compara los puestos de cada equipo
ordenados de mejor a peor, elemento por elemento, y eso no es una window function.

`scoreboard_document()` proyecta filas crudas y no rankea. `buildScoreboard()` arma la tabla en el
navegador con las mismas funciones que usa `recomputeStandings()` en el servidor.

### Reglas del reglamento que estan codificadas

Verificadas contra el rulebook de los CrossFit Games, no inferidas:

- **Los empates dentro de una prueba no se rompen** y los empatados cobran los mismos puntos, sin
  promediar. Las posiciones son **fisicas**: con un triple empate en el tercero, el siguiente es
  sexto (`assignPhysicalPositions`).
- **El desempate general es el vector de puestos** ordenado ascendente, comparado elemento a
  elemento (`compareTiebreakVectors`).
- **Quien capea va siempre detras de quien termino**, sin importar cuantas reps hizo. Lo resuelve
  `statusRank`, no una constante magica que reconcilie dos escalas.
- **Los kilos y los metros se comparan como enteros escalados ×100.** Un empate mal detectado por
  aritmetica de punto flotante no afecta a dos filas: corre TODAS las posiciones de abajo.
- **Los equipos retirados no entran al padron.** Con posiciones fisicas, un retirado al fondo le
  corre la posicion a todos los que estan detras.

### Lo que hay que saber antes de tocar el modelo de pruebas

- **`heats.workout_id` y `lanes.workout_id` los llenan triggers, no la app.** `createHeat` y los
  fixtures no saben que existen las pruebas y no tienen por que aprenderlo: un evento con una sola
  prueba no deberia obligar a elegirla.
- **`lanes.workout_id` NO puede tener una FK compuesta hacia `heats`.** Seria una segunda relacion
  `lanes → heats` y PostgREST devolveria `PGRST201` en el embed `heats (...)` de `getJudgeLanes` y
  `fetchLaneBundle`. Como el codigo hace `data ?? []`, la pantalla del juez diria "no hay carriles"
  sin error visible, y PGlite no lo atraparia. Lo mismo vale para `workout_scores → workout_parts`.
- **`workout_scores` no tiene GRANT de insert ni update.** Todo pasa por `upsert_workout_score()`
  o por el service role del recalculo — la misma jugada que hace inmutable a `timing_events`.
- **Un score manual SI se edita**, a diferencia de un `timing_event`. Por eso hay
  `workout_score_audit`, escrita por trigger: sin rastro de quien cambio las 142 reps por 152, un
  leaderboard reclamado no se puede defender.
- **La grilla de carga de scores no va dentro de un `<form action={...}>`.** Es el caso exacto del
  bug de `HeatCard.tsx`: tiene que conservar lo recien guardado. Va con
  `startTransition(() => accion(formData))`.
- **Las tablas de puntos estandar no se copian a la base.** `scoring_tables` guarda una
  `builtin_key` y los valores viven en `src/shared/scoring/points.ts`. Si estuvieran en los dos
  lados, tarde o temprano difieren y el podio dependeria de cual leyo cada pantalla.
- **El gate del plan vive en `public_scoreboard()`, no en un componente.** Plan gratuito: nada
  hasta que el evento se publica, y sin parciales. Plan pro: en vivo y con detalle. En la UI se
  saltearia leyendo la respuesta de la red. Es uno de los cuatro gates — ver
  [El plan corta por VISIBILIDAD](#el-plan-corta-por-visibilidad-no-por-captura).

## El juez de CrossFit comparte todo menos la pantalla

`src/shared/timing/wod.ts` es el hermano de `reducer.ts`, no su reemplazo. Vive al lado porque
aquel es el unico codigo probado en competencia real y no se toca.

Lo que **comparten**: el log `timing_events`, la idempotencia por uuid del cliente, el ancla del
reloj, el outbox de IndexedDB, el store del juez, la ruta estatica `/juez/carril` y el mismo
bundle precacheado. **Un `rep` y un `segment_split` son la misma fila**: solo cambian `type` y
`payload`. Por eso la fase no agrego ni una columna ni un privilegio a `timing_events`, solo
valores al enum.

A que movimiento apunta una marca va en `payload.partMovementId`, no en una columna con FK:
agregarle una columna a `timing_events` es tocar la tabla mas sensible del producto, y el
reductor ya tolera referencias huerfanas reportandolas como anomalia.

Lo que **no** comparten es la pantalla. `WodJudgeScreen` es nueva: contar repeticiones, saltar
movimientos y registrar intentos de levantamiento no se parece a marcar parciales, y meter las
dos en un componente lo volveria ilegible justo donde no se puede fallar. `CarrilClient` decide
cual montar segun lo que trae el bundle — el juez no elige nada.

### Como se despliega un WOD

`planDelWod()` convierte bloques × rondas × movimientos en una lista plana de pasos. Es lo que
hace que la pantalla no razone sobre esquemas de repeticiones: le pide el paso actual y pinta su
objetivo. Fran son seis pasos con objetivos 21·21·15·15·9·9; un chipper es un bloque de una ronda
con diez movimientos; un Death By es el mismo arreglo con objetivo ascendente.

### Reglas del reductor de WODs

- **El cap se DERIVA, no lo decide un evento.** Si la app quedo en segundo plano cuando sono el
  cap, nadie emite nada. Por eso `reduceWodEvents` recibe un `nowElapsedMs` opcional: la pantalla
  le pasa su reloj vivo y el servidor le pasa `ahora - heat.started_at`. Misma doctrina que el
  ancla: se deriva, no se acumula. El evento `time_cap` es informativo.
- **Agotar la ventana de un AMRAP ES terminar**, no capear: el score son las rondas que hizo. En
  un For Time con cap, no terminar es `capeado` y rankea siempre detras de quien completo.
- **Un movimiento `max_reps` no se cierra solo**: lo cierra el juez o el reloj del intervalo.
- **Un `no_rep` queda registrado y no suma.** Es lo que hace auditable un reclamo.
- **Las unidades que no son reps se escriben, no se tapean.** Nadie marca quinientos metros de a
  uno: metros, calorias y segundos abren un teclado numerico.

### Cada prueba tiene UN solo camino de escritura, y lo garantiza la base

- `upsert_workout_score()` rechaza las pruebas con `capture_mode = 'en_vivo'`.
- El trigger `completar_datos_de_score` rechaza un score con `source` distinto del
  `capture_mode` de su prueba.

Las dos juntas cierran el circulo. Sin la segunda, un recalculo que tomara una prueba de carga
manual la reduciria a "pendiente" y **borraria el score que el staff ya habia cargado a mano** —
sin error visible, porque para el reductor una prueba sin marcajes simplemente no arranco.

## El backfill es lo unico que PGlite no puede probar

`supabase/tests/` aplica las migraciones a una base **vacia**. Todo backfill actualiza cero filas,
y ningun trigger que dependa de datos preexistentes llega a dispararse. El primer `db push` real
fallo justo ahi:

```
ERROR: El heat ya tiene carriles: no se puede cambiar la prueba
At statement: 19  update public.heats set workout_id = ...
```

El guard `heat_prueba_inmutable` leia `new.workout_id is distinct from old.workout_id` — y para un
heat que ya existia, `old.workout_id` es null, asi que rellenarlo por primera vez contaba como
"cambiar la prueba". Ahora exige `old.workout_id is not null`: asignar no es cambiar.

**Si escribis un backfill, asumi que no esta probado.** Los 690 tests no lo cubren y no pueden. Lo
unico que lo verifica es aplicarlo contra una base con datos.

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

## Los `<select>` son UN componente, no treinta estilos sueltos

`src/shared/components/Selector.tsx` es el único `<select>` de la app. Antes once archivos
definian su propia constante local `selector` (variando el padding sin ninguna razón), nueve más
hardcodeaban la clase inline, y uno (`CodigosDeDescuento`) directamente reusaba la clase de un
`<input>` de texto — ese select se veía idéntico a un campo de texto, sin ninguna señal de que era
desplegable. La mitad de la app además usaba `appearance-none` sin agregar una flecha de
reemplazo, así que perdía la del navegador y no quedaba ninguna.

- **La flecha es el icono `flecha` (una `>`) rotado 90°**, no un icono nuevo — mismo criterio que
  el resto de `Icono.tsx`: reusar los pocos trazos que ya existen.
- **`className` se aplica a los DOS elementos: el `<div>` que envuelve (por el icono, que necesita
  `position: relative`) y el `<select>` de adentro.** El select vive DENTRO del div, así que un
  `flex-1`/`w-64`/`w-20` pasado por `className` tiene que llegarle al div —el que en verdad ocupa
  un lugar en el `flex`/`grid` del llamador— o nunca estira nada; el select ya tiene `w-full` fijo
  en la base, así que siempre llena a su contenedor. Las clases de texto/padding (`py-3`,
  `text-sm`) que también viajan ahí no le hacen nada visible a un div vacío, así que aplicarlas dos
  veces es inofensivo.
- **`src/shared/components/SimpleForm.tsx`'s `Select`** (el que usan `NuevoHeat`, `NuevaDivision`,
  `NuevaPenalizacion`, `NuevoCircuito`, el selector de pasarela y el de tipo de segmento) ahora
  renderiza `Selector` por dentro — mismo look, sin tocar ninguno de esos call sites.

### Un `<select>` obligatorio no puede arrancar con la primera opción ya elegida

Bug real, reportado dos veces: "Crear atleta" arrancaba con la primera categoría ya seleccionada
(`useState(divisiones[0]?.id ?? "")`) y "Formato" del evento arrancaba en "Carrera híbrida"
(`defaultValue={evento?.format ?? "carrera_hibrida"}`) — las dos veces sin que el organizador
tocara nada. Con una lista de opciones donde NINGUNA es neutral (elegir mal la categoría inscribe
al atleta en la equivocada; elegir mal el formato define qué motor de puntuación corre toda la
competencia), un `<select>` sin placeholder hace exactamente eso: "elige" por la persona.

Se auditaron los ~55 `<select>` de la app. La regla que separa un bug de un default legítimo:

- **Sin placeholder, obligatorio, sin opción neutral real** → bug. Corregidos: categoría en
  `AltaDeAtleta`, formato del evento en `FichaDelEvento` (el placeholder solo aparece al CREAR —
  `!evento` — nunca al editar uno que ya tiene formato real), pasarela de cobro en
  `/organizacion/plan`, tipo de segmento en `/circuito`, tipo de penalización en
  `NuevaPenalizacion`. Los cuatro últimos ya validaban el campo vacío del lado del servidor (o se
  les agregó la validación en el mismo cambio) — el bug era pura UI.
- **Con una opción neutral real** (`"Sin especificar"`, `"Todas las categorías"`, `"Ninguno"`,
  `"La del evento"`) → no es un bug, es un default explícito y documentado. No se tocó.
- **Ligado a un preset elegido a mano un paso antes** (los campos de `NuevaPrueba` cambian con los
  botones de preset de arriba) → tampoco es el bug: el usuario ya decidió, el select solo refleja
  esa decisión.
- **`FichaDelEvento`'s `format` es el único caso donde el placeholder depende de si el evento ya
  existe.** Al editar, `evento.format` siempre tiene un valor real (se exigió al crear), así que
  ofrecer el placeholder ahí solo agregaría una opción que nunca hace falta.
- `src/features/events/actions.ts`: el fallback silencioso `texto(formData, "format") ??
  "carrera_hibrida"` se sacó por la misma razón — sin él, un envío sin formato quedaba indefinido
  en vez de rechazado, y `validar()` ahora exige `campos.format` antes de llegar a la base.

## El toast de error no reaparecía si el mismo mensaje se repetía

`useToastDeEstado` (`Notificaciones.tsx`) mostraba un error correctamente la primera vez, pero si
la MISMA acción fallaba de nuevo con el mismo texto, el segundo toast no aparecía — había que
refrescar la página para volver a verlo. La causa: el efecto dependía de `estado.error` (el
STRING), y React compara las dependencias de un efecto por valor con `Object.is` — un segundo
error idéntico al primero no cambia ese valor, así que el efecto directamente no vuelve a correr
(ni siquiera llega a evaluar el guard interno pensado para deduplicar).

El fix depende del OBJETO `estado`, no de `estado.error`: `useActionState` devuelve una referencia
nueva en cada submit, se repita o no el texto, así que comparar `estado !== anterior.current`
dispara el efecto en cada intento real. Mismo bug, copiado a mano con `useRef` para el toast de
éxito de `DistribuirHeats.tsx` (`state.resumen`) — mismo fix ahí también.

**Si agregás un patrón "avisar cuando cambia un campo de un `FormState`", andá por acá.** El
sistema base (`useNotificaciones()`, un array de toasts con `id: crypto.randomUUID()`) nunca tuvo
este bug — es específico de "efecto que reacciona al VALOR de un campo devuelto por
`useActionState`", no del sistema de notificaciones en sí.

## "Deshacer Inicio" pide confirmación, y limpia `ended_at` por las dudas

Dos ajustes a `cancel_heat_start` y su botón en `TorreDeHeats.tsx` (la pantalla de Control):

- **El botón abre un `Modal` de confirmación antes de ejecutar** — mismo patrón que "Eliminar
  categoría" en `ParametrosDeCategoria.tsx`. Antes disparaba la acción directo al click, sin nada
  de por medio; un click accidental reiniciaba el heat sin aviso. Sigue sin poder usarse si ya hay
  marcajes (`heat.marcajesTotales === 0` en el llamador, `v_marcajes = 0` en la función), así que
  la confirmación es sobre "¿de verdad querés reiniciar el heat?", no sobre perder tiempos.
- **`cancel_heat_start` ahora pone `ended_at = null` explícitamente.** No había ningún caso real en
  que esto importara —`ended_at` solo se llena cuando TODOS los carriles con atleta llegan a un
  estado terminal, y eso siempre implica al menos un `timing_event`, que es justo lo que la función
  exige en cero para dejar deshacer— pero es un acoplamiento frágil, no una garantía explícita.
  Se agregó como defensa: si el día de mañana un estado terminal deja de depender de un
  `timing_event`, deshacer el inicio no puede dejar pegada una fecha de cierre en un heat que
  volvió a "sin iniciar". Después de deshacer, `start_heat()` puede volver a correr sin ningún
  residuo: no lee `ended_at` del heat que arranca, solo de OTROS heats del mismo juez.

## Un heat cerrado tiene que seguir mostrando cuándo arrancó

`TarjetaDeHeat` (`TorreDeHeats.tsx`) tenía un `if/else if` de tres ramas mutuamente excluyentes
para la fecha: sin iniciar / iniciado (con el reloj en vivo) / finalizado. La rama de "finalizado"
mostraba SOLO la hora de cierre, y la de inicio desaparecía de la pantalla en cuanto el heat
cerraba — aunque el dato siguiera en `heat.startedAt`. Ahora esa rama muestra las dos: "Inició
14:32 · Finalizó 14:58".

## Un error que no reconoce el traductor no puede tirarse a la basura

`src/features/events/config/actions.ts`'s `traducir()` terminaba en `return "No se pudo
guardar.";` a secas — cualquier error de Postgres que no fuera 23505/23503/23514/42501 salía como
ese string fijo, **descartando `error.message` por completo**. Es lo que pasó al intentar "Marcar
como lista" con otra competencia ya activa en el plan gratuito: el trigger `events_limitar_activos`
rechaza el cambio con un mensaje perfectamente legible ("El plan gratuito corre una competencia a
la vez, y 'X' todavía está activa", código `PL001`), y esta función lo tiraba antes de que llegara
a la pantalla. Confirmado contra la base real: la organización de "HYROX SESSION #02" está en plan
gratuito y ya tenía otra competencia (`SESSION 2`) en `live`.

Mismo fix que ya usa `workouts/actions.ts`: `esLimiteDePlan(error)` primero (devuelve el mensaje
del servidor tal cual, escrito para el organizador), y el fallback final pasa a `error.message ??
"No se pudo guardar."` en vez de descartarlo. **Si un `traducir()` propio termina en un string fijo
sin mirar `error.message`, tiene este mismo bug** — es la única forma de perder un mensaje que
Postgres sí mandó bien.

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
