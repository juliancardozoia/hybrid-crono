# Hybrid Crono

Cronometraje de competencias de fitness por tiempo (tipo Hyrox). Un juez marca los parciales de un
atleta con el celular y el tiempo total se **deriva** de esos marcajes: nunca se escribe a mano.

Reemplaza la planilla de papel, la transcripción manual a Excel y las horas de espera hasta los
resultados oficiales.

**Estado: fases 1 a 6 completas.**

- **Fase 1** — cronómetro offline del juez, construido. Falta validarlo en un celular real: el
  checklist está más abajo y es el criterio de aceptación.
- **Fase 2** — esquema completo en Postgres con RLS, auth, organizaciones y shell del panel.
- **Fase 3** — configuración de competencia: circuito, divisiones, penalizaciones, import de
  atletas por CSV y armado de heats con asignación de jueces.
- **Fase 4** — PWA del juez conectada: toma de carril con bloqueo atómico, sincronización contra
  la base real y largada del heat estampada por el servidor.
- **Fase 5** — resultados en vivo: leaderboard público, vista de proyector para el venue y vista
  de atleta por dorsal.
- **Fase 6** — verificación y publicación: torre de control, cola de anomalías, resultados
  oficiales congelados, export a CSV y QR imprimibles por dorsal.

Verificado con 207 tests: 91 de lógica pura y 116 contra un Postgres real, más una verificación
de seguridad contra el proyecto de Supabase de verdad (`node scripts/verify-security.mjs`).

Falta la **fase 7**: el ensayo general con jueces reales, y validar el cronómetro en un celular
(el checklist está más abajo).

## Arrancar

```bash
npm install
npm run dev          # http://localhost:3000
```

El cronómetro funciona sin base de datos. Para el panel del organizador hace falta Supabase:
copiá `.env.local.example` a `.env.local`, completá las claves y aplicá el esquema con
`npx supabase db push`. Sin eso, `/panel` te explica qué falta en vez de romperse.

- `/spike` — la pantalla del juez
- `/spike/servidor` — qué marcajes llegaron y verificación de idempotencia
- `/panel` — panel del organizador (requiere Supabase)
- `/panel/eventos/[id]` — configuración completa de una competencia
- `/juez` — el juez toma su carril
- `/juez/carril?id=…` — el cronómetro (estático: funciona sin conexión)
- `/en-vivo/[slug]` — leaderboard público
- `/en-vivo/[slug]/proyector` — pantalla para el venue
- `/en-vivo/[slug]/atleta/[dorsal]` — tiempo y parciales de un atleta

Para las pruebas offline hay que usar el build de producción, porque el service worker está
deshabilitado en desarrollo:

```bash
npm run build && npm start
```

## Por qué la fase 1 es solo un cronómetro

El requisito que manda sobre todos los demás es que **un tiempo, una vez arrancado, no se pierde
nunca**: ni si se cae el internet, ni si el juez cierra la app, ni si el celular se reinicia.

Si eso no se sostiene, no importa lo linda que sea la configuración de eventos ni el leaderboard.
Por eso se construye y se valida primero, aislado, antes de escribir una línea de lo demás.

## Checklist de aceptación de la fase 1

**Hay que correrlo en un celular real, contra `npm run build && npm start`.** No sirve hacerlo
solo en el navegador de escritorio: el punto es justamente el comportamiento de un teléfono con
la app en segundo plano, la pantalla apagada y la red intermitente.

Preparación: abrí `/spike` en el celular, tocá **LARGAR CARRIL** y marcá 2 o 3 parciales.

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Refrescar la página | El tiempo sigue corriendo bien y los parciales están |
| 2 | Cerrar el navegador por completo y reabrir | Igual que arriba |
| 3 | Modo avión, marcar 5 parciales, volver la red | Los 5 llegan a `/spike/servidor`, una sola vez |
| 4 | Reiniciar el celular a mitad de carrera | Al reabrir, el tiempo corriendo es el correcto |
| 5 | Dejar la app en segundo plano 20 minutos | Al volver, el tiempo no se atrasó ni se adelantó |
| 6 | Cambiar la hora del sistema a mano | El cronómetro no se altera |
| 7 | En `/spike/servidor`, tocar "Reenviar todo" tres veces | El conteo no se mueve: solo duplicados |
| 8 | Abrir `/spike` en dos dispositivos a la vez | *(pendiente: el bloqueo de carril llega en fase 4)* |

Los puntos 1, 2, 4, 5 y 6 están cubiertos por tests automatizados a nivel de la lógica de tiempos
(`npm test`), pero **eso no reemplaza probarlos en el dispositivo**: los tests validan la
aritmética del ancla, no el comportamiento real del navegador del celular.

El punto 7 ya está verificado a nivel del contrato del servidor: tres envíos del mismo lote dejan
un solo registro por evento.

Si alguno de los puntos 1 a 7 falla, hay que replantear la estrategia de plataforma antes de
seguir — posiblemente hacia una app nativa.

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 + React 19 + TypeScript |
| Estilos | Tailwind CSS 4 |
| Estado local | Dexie (IndexedDB) + Zustand |
| PWA | Serwist |
| Tests | Vitest + PGlite (Postgres real en proceso, sin Docker) |

Backend: Supabase (Auth + Postgres + RLS + Realtime), desplegado en Vercel.

## Arquitectura

Las decisiones que sostienen el producto están documentadas en [CLAUDE.md](CLAUDE.md). Las cuatro
que importan:

1. **Los tiempos son `elapsedMs` desde la largada**, nunca reloj de pared — por eso el offline
   funciona.
2. **El elapsed se deriva de un ancla persistida**, nunca de un contador acumulado.
3. **El log de marcajes es append-only**: nada se edita ni se borra, las correcciones son eventos
   nuevos.
4. **Todo tap se escribe en IndexedDB antes de tocar la red**, con un UUID de cliente que hace la
   sincronización idempotente.

El motor de tiempos (`src/shared/timing/`) es puro y sin dependencias del DOM: la misma función
que pinta el tiempo en vivo en el celular del juez es la que va a calcular el resultado oficial en
el servidor. Una sola fuente de verdad.

## Fases siguientes

7. Ensayo general con jueces reales
