-- `events.auto_tiebreak` era un checkbox en "Informacion general" ("Desempate
-- automatico") que nunca leyo nadie: el motor de puntuacion siempre aplica el
-- vector de puestos como desempate general, sin toggle que lo prenda o
-- apague -- ver "El desempate general es el vector de puestos" en CLAUDE.md.
-- Se escribia desde `updateEvent`/`createEvent` y ninguna consulta lo volvia
-- a leer: un campo puramente decorativo que sugeria un comportamiento
-- configurable que en realidad es fijo.
alter table public.events
  drop column auto_tiebreak;
