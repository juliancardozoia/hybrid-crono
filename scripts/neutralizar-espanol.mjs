/**
 * Pasa el texto de la app de voseo rioplatense a español neutro.
 *
 * Herramienta de una sola vez, versionada por si hace falta repetirla o para
 * ver exactamente que criterio se aplico.
 *
 * Criterio:
 *   - Imperativos de "vos" a imperativos de "tú": creá -> crea, poné -> pon.
 *   - Conjugaciones: tenés -> tienes, podés -> puedes.
 *   - Pronombre: vos -> ti/tú.
 *   - Regionalismos del Cono Sur por terminos panhispanicos:
 *       largada -> salida, largar -> iniciar, acá -> aquí, prolijo -> ordenado.
 *   - Los mensajes que ve el usuario llevan tildes; los comentarios de codigo
 *     siguen sin tildes, como el resto del proyecto.
 *
 *   node scripts/neutralizar-espanol.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

/** Orden importante: las frases largas van antes que las palabras sueltas. */
const REEMPLAZOS = [
  // --- Frases completas -----------------------------------------------------
  ["Marcala como lista y ponela en vivo antes de largar.", "Márcala como lista y ponla en vivo antes de iniciar."],
  ["La competencia esta en borrador.", "La competencia está en borrador."],
  ["La competencia ya termino: no se pueden largar heats nuevos.", "La competencia ya terminó: no se pueden iniciar heats nuevos."],
  ["No tenes permiso para largar este heat", "No tienes permiso para iniciar este heat"],
  ["No tenes permiso sobre este heat", "No tienes permiso sobre este heat"],
  ["No tenes permiso para editar este circuito", "No tienes permiso para editar este circuito"],
  ["No tenes permiso para cargar atletas en este evento", "No tienes permiso para cargar atletas en este evento"],
  ["No tenes permiso para armar este heat", "No tienes permiso para armar este heat"],
  ["No pertenecés a este evento", "No perteneces a este evento"],
  ["Solo el dueno o un admin pueden invitar", "Solo el dueño o un administrador pueden invitar"],
  ["Solo el dueno puede nombrar a otro dueno", "Solo el dueño puede nombrar a otro dueño"],
  ["Solo el dueno o un admin pueden quitar miembros", "Solo el dueño o un administrador pueden quitar miembros"],
  ["Es el unico dueno de la organizacion: nombra otro antes de quitarlo", "Es el único dueño de la organización: nombra a otro antes de quitarlo"],
  ["Solo el head judge o la organizacion pueden anular un marcaje", "Solo el juez principal o la organización pueden anular un marcaje"],
  ["Solo el head judge o la organizacion pueden transferir un carril", "Solo el juez principal o la organización pueden transferir un carril"],
  ["Solo el head judge o la organizacion pueden verificar resultados", "Solo el juez principal o la organización pueden verificar resultados"],
  ["Solo la organizacion puede publicar resultados", "Solo la organización puede publicar resultados"],
  ["El heat ya largo: no se pueden reasignar los carriles", "El heat ya inició: no se pueden reasignar los carriles"],
  ["Este heat ya tiene % marcaje(s): no se puede deshacer la largada.", "Este heat ya tiene % marcaje(s): no se puede deshacer el inicio."],
  ["El carril ya lo tomo otro juez", "El carril ya lo tomó otro juez"],
  ["El carril esta asignado a otro juez", "El carril está asignado a otro juez"],
  ["Anular un marcaje exige un motivo", "Anular un marcaje exige un motivo"],
  ["El heat no tiene ningun atleta asignado a sus carriles.", "El heat no tiene ningún atleta asignado a sus carriles."],
  ["Faltan jueces: % de % carriles con atleta no tienen juez asignado.", "Faltan jueces: % de % carriles con atleta no tienen juez asignado."],

  // --- Texto de interfaz ----------------------------------------------------
  ["Este carril ya no está asignado a vos.", "Este carril ya no está asignado a ti."],
  ["avisá a la organización", "avisa a la organización"],
  ["Tus marcajes siguen guardados en este dispositivo", "Tus marcajes siguen guardados en este dispositivo"],
  ["Los marcajes están guardados acá y se reintenta solo.", "Los marcajes están guardados aquí y se reintentan solos."],
  ["Si el heat ya largó y no hay señal, podés arrancar el reloj acá. Queda marcado como largada provisoria y se corrige sola al sincronizar.", "Si el heat ya inició y no hay señal, puedes arrancar el reloj aquí. Queda marcado como salida provisional y se corrige sola al sincronizar."],
  ["Arrancá el reloj para probar el cronómetro.", "Inicia el reloj para probar el cronómetro."],
  ["Modo laboratorio: largá vos el reloj.", "Modo laboratorio: inicia tú el reloj."],
  ["El reloj arranca solo cuando la organización larga el heat.", "El reloj arranca solo cuando la organización inicia el heat."],
  ["Sin señal. Cuando vuelva la conexión, el reloj se ajusta a la largada oficial.", "Sin señal. Cuando vuelva la conexión, el reloj se ajusta a la salida oficial."],
  ["Esperando la largada", "Esperando la salida"],
  ["LARGAR SIN SEÑAL", "INICIAR SIN SEÑAL"],
  ["LARGAR CARRIL", "INICIAR CARRIL"],
  ["LARGAR HEAT", "INICIAR HEAT"],
  ["Deshacer largada", "Deshacer inicio"],
  ["largada oficial del heat", "salida oficial del heat"],
  ["largada provisoria", "salida provisional"],
  ["Sin largar", "Sin iniciar"],
  ["antes de largar", "antes de iniciar"],
  ["El heat ya largó: los carriles quedaron fijos.", "El heat ya inició: los carriles quedaron fijos."],
  ["El heat ya largó: no se pueden reasignar los carriles.", "El heat ya inició: no se pueden reasignar los carriles."],
  ["cada atleta necesita el suyo antes de largar.", "cada atleta necesita el suyo antes de iniciar."],
  ["El heat largó sin señal: la largada es provisoria.", "El heat inició sin señal: la salida es provisional."],
  ["Lista para largar. Pasala a En vivo el día del evento.", "Lista para iniciar. Pásala a En vivo el día del evento."],
  ["Revisar antes de largar", "Revisar antes de iniciar"],
  ["Está todo cargado. Pasala a Lista y después a En vivo para que los jueces vean sus carriles.", "Está todo cargado. Pásala a Lista y después a En vivo para que los jueces vean sus carriles."],

  // --- Conjugaciones y pronombres ------------------------------------------
  ["tenés", "tienes"],
  ["Tenés", "Tienes"],
  ["podés", "puedes"],
  ["Podés", "Puedes"],
  ["pertenecés", "perteneces"],
  ["Pertenecés", "Perteneces"],
  ["venís", "vienes"],
  ["Venís", "Vienes"],
  ["organizás", "organizas"],
  ["Organizás", "Organizas"],
  ["querés", "quieres"],
  ["Querés", "Quieres"],
  ["vas a tener que", "tendrás que"],

  // --- Imperativos ----------------------------------------------------------
  ["Creá", "Crea"], ["creá", "crea"],
  ["Andá", "Ve"], ["andá", "ve"],
  ["Pasale", "Envíale"], ["pasale", "envíale"],
  ["Pásale", "Envíale"], ["pásale", "envíale"],
  ["Mandale", "Envíale"], ["mandale", "envíale"],
  ["Avisame", "Avísame"], ["avisame", "avísame"],
  ["Fijate", "Fíjate"], ["fijate", "fíjate"],
  ["Sumá", "Suma"], ["sumá", "suma"],
  ["Pedile", "Pídele"], ["pedile", "pídele"],
  ["Escribí", "Escribe"], ["escribí", "escribe"],
  ["Elegí", "Elige"], ["elegí", "elige"],
  ["Marcá", "Marca"], ["marcá", "marca"],
  ["Poné", "Escribe"], ["poné", "escribe"],
  ["Ponela", "Ponla"], ["ponela", "ponla"],
  ["Pasala", "Pásala"], ["pasala", "pásala"],
  ["Revisá", "Revisa"], ["revisá", "revisa"],
  ["Cargá", "Carga"], ["cargá", "carga"],
  ["Dejá", "Deja"], ["dejá", "deja"],
  ["Mirá", "Mira"], ["mirá", "mira"],
  ["Corré", "Ejecuta"], ["corré", "ejecuta"],
  ["Entrá", "Ingresa"], ["entrá", "ingresa"],
  ["Volvé", "Vuelve"], ["volvé", "vuelve"],
  ["Probá", "Prueba"], ["probá", "prueba"],
  ["Descargá", "Descarga"], ["descargá", "descarga"],
  ["Pegá", "Pega"], ["pegá", "pega"],
  ["Subí", "Sube"], ["subí", "sube"],
  ["Agregá", "Agrega"], ["agregá", "agrega"],
  ["Copiá", "Copia"], ["copiá", "copia"],
  ["Terminá", "Termina"], ["terminá", "termina"],
  ["Registrate", "Regístrate"], ["registrate", "regístrate"],
  ["Completá", "Completa"], ["completá", "completa"],
  ["Arrancá", "Inicia"], ["arrancá", "inicia"],
  ["Esperá", "Espera"], ["esperá", "espera"],
  ["Accedé", "Ingresa"], ["accedé", "ingresa"],
  ["Verificá", "Verifica"], ["verificá", "verifica"],
  ["Aplicá", "Aplica"], ["aplicá", "aplica"],
  ["Armá", "Arma"], ["armá", "arma"],
  ["Tocá", "Toca"], ["tocá", "toca"],
  ["Abrí", "Abre"], ["abrí", "abre"],
  ["Cerrá", "Cierra"], ["cerrá", "cierra"],
  ["Reiniciá", "Reinicia"], ["reiniciá", "reinicia"],
  ["Instalá", "Instala"], ["instalá", "instala"],
  ["Conectá", "Conecta"], ["conectá", "conecta"],
  ["Buscá", "Busca"], ["buscá", "busca"],
  ["Anotá", "Anota"], ["anotá", "anota"],
  ["Imprimí", "Imprime"], ["imprimí", "imprime"],
  ["Compartí", "Comparte"], ["compartí", "comparte"],
  ["Guardá", "Guarda"], ["guardá", "guarda"],
  ["Asigná", "Asigna"], ["asigná", "asigna"],
  ["Asignátelos", "Asígnatelos"], ["asignátelos", "asígnatelos"],
  ["Asignate", "Asígnate"], ["asignate", "asígnate"],

  // --- Regionalismos --------------------------------------------------------
  ["al toque", "de inmediato"],
  ["Ojo con", "Atención con"],
  ["ojo con", "atención con"],
  ["prolija", "ordenada"],
  ["prolijo", "ordenado"],
  ["Largó ", "Inició "],
  ["a vos", "a ti"],
  ["para vos", "para ti"],
  ["de vos", "de ti"],
  ["(vos)", "(tú)"],
  ["que vos", "que tú"],
  ["vos también", "tú también"],
];

const EXTENSIONES = new Set([".ts", ".tsx", ".sql", ".md"]);
const IGNORAR = new Set(["node_modules", ".next", ".git", ".vercel", "scripts"]);

function archivos(dir) {
  const encontrados = [];
  for (const nombre of readdirSync(dir)) {
    if (IGNORAR.has(nombre)) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) encontrados.push(...archivos(ruta));
    else if (EXTENSIONES.has(extname(ruta))) encontrados.push(ruta);
  }
  return encontrados;
}

let tocados = 0;
let cambios = 0;

for (const ruta of [...archivos("src"), ...archivos("supabase")]) {
  const antes = readFileSync(ruta, "utf8");
  let despues = antes;

  for (const [de, a] of REEMPLAZOS) {
    if (despues.includes(de)) {
      cambios += despues.split(de).length - 1;
      despues = despues.split(de).join(a);
    }
  }

  if (despues !== antes) {
    writeFileSync(ruta, despues);
    tocados += 1;
    console.log("  " + ruta);
  }
}

console.log(`\n${tocados} archivo(s), ${cambios} reemplazo(s).\n`);
