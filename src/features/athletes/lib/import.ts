/**
 * Import de atletas desde CSV.
 *
 * Toma la planilla que el organizador ya tiene y la convierte en equipos con
 * dorsal. Es pura a proposito: no toca la base. Primero se arma un PLAN, el
 * organizador lo revisa en pantalla, y recien despues se escribe.
 *
 * Ese paso intermedio existe porque importar mal 300 atletas la noche antes de
 * la competencia es mucho mas caro que revisar una tabla.
 */

import type { AthleteGender, GenderRule } from "@/lib/supabase/types";
import { normalizeValue, parseCsvToRecords } from "./csv";

export type DivisionInfo = {
  id: string;
  name: string;
  teamSize: number;
  genderRule: GenderRule;
}

// Alias de tipo y no interface: estos objetos viajan como jsonb al RPC
// import_teams, y el tipo Json de supabase-js exige una index signature
// implicita que las interfaces de TypeScript no tienen.
export type ImportedAthlete = {
  firstName: string;
  lastName: string;
  birthDate: string | null;
  gender: AthleteGender | null;
  email: string | null;
  phone: string | null;
  externalRef: string | null;
}

export type PlannedTeam = {
  divisionId: string;
  divisionName: string;
  bibNumber: number;
  /** Nombre del equipo. null en individuales: la UI muestra el del atleta. */
  name: string | null;
  members: ImportedAthlete[];
  /** Lineas del CSV de las que salio, para poder señalar el error. */
  lines: number[];
}

export type ImportIssue = {
  /** Linea del archivo contando el encabezado, como la muestra Excel. */
  line: number | null;
  message: string;
}

export type ImportPlan = {
  teams: PlannedTeam[];
  issues: ImportIssue[];
  totalAthletes: number;
}

/**
 * Cada campo acepta varios encabezados porque nadie exporta la planilla igual.
 * El primero que aparezca gana.
 */
const ALIAS = {
  firstName: ["nombre", "nombres", "first_name", "firstname", "primer_nombre"],
  lastName: ["apellido", "apellidos", "last_name", "lastname"],
  fullName: ["nombre_completo", "nombre_y_apellido", "full_name", "atleta"],
  email: ["email", "correo", "mail", "e_mail", "correo_electronico"],
  phone: ["telefono", "celular", "phone", "movil"],
  birthDate: ["fecha_nacimiento", "nacimiento", "fecha_de_nacimiento", "birth_date", "birthdate"],
  gender: ["sexo", "genero", "gender"],
  division: ["division", "categoria", "category", "cat"],
  bib: ["dorsal", "bib", "numero", "nro", "bib_number"],
  team: ["equipo", "team", "pareja", "nombre_equipo"],
  externalRef: ["id", "ref", "external_ref", "id_inscripcion"],
} as const;

function pick(record: Record<string, string>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return "";
}

const GENEROS: Record<string, AthleteGender> = {
  m: "male",
  masculino: "male",
  male: "male",
  hombre: "male",
  h: "male",
  varon: "male",
  f: "female",
  femenino: "female",
  female: "female",
  mujer: "female",
  otro: "other",
  other: "other",
  x: "other",
};

export function parseGender(raw: string): AthleteGender | null {
  return GENEROS[normalizeValue(raw)] ?? null;
}

/**
 * Acepta ISO y los formatos con dia primero que usa la region.
 * Devuelve ISO (YYYY-MM-DD) o null si no se entiende.
 */
export function parseBirthDate(raw: string): string | null {
  const valor = raw.trim();
  if (!valor) return null;

  const iso = valor.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return armarFecha(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const conDiaPrimero = valor.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (conDiaPrimero) {
    return armarFecha(
      Number(conDiaPrimero[3]),
      Number(conDiaPrimero[2]),
      Number(conDiaPrimero[1]),
    );
  }

  return null;
}

function armarFecha(anio: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  if (anio < 1900 || anio > new Date().getFullYear()) return null;

  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  // Rebota el 31 de febrero y compania: Date lo corre al mes siguiente.
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;

  return fecha.toISOString().slice(0, 10);
}

function splitFullName(full: string): { firstName: string; lastName: string } {
  const partes = full.split(/\s+/).filter(Boolean);
  if (partes.length === 1) return { firstName: partes[0], lastName: "" };
  // Con dos nombres y dos apellidos, partir al medio acierta mas seguido que
  // asumir un solo apellido.
  const corte = partes.length >= 4 ? 2 : partes.length - 1;
  return {
    firstName: partes.slice(0, corte).join(" "),
    lastName: partes.slice(corte).join(" "),
  };
}

export function buildImportPlan(
  csvText: string,
  divisions: DivisionInfo[],
  options: { existingBibs?: number[] } = {},
): ImportPlan {
  const issues: ImportIssue[] = [];
  const records = parseCsvToRecords(csvText);

  if (records.length === 0) {
    return { teams: [], issues: [{ line: null, message: "El archivo está vacío o sin datos." }], totalAthletes: 0 };
  }

  const porNombre = new Map(divisions.map((d) => [normalizeValue(d.name), d]));

  interface Fila {
    line: number;
    athlete: ImportedAthlete;
    division: DivisionInfo;
    bib: number | null;
    teamKey: string;
    teamName: string | null;
  }

  const filas: Fila[] = [];

  records.forEach((record, index) => {
    const line = index + 2; // +1 por el encabezado, +1 porque Excel cuenta desde 1

    let firstName = pick(record, ALIAS.firstName);
    let lastName = pick(record, ALIAS.lastName);

    if (!firstName && !lastName) {
      const full = pick(record, ALIAS.fullName);
      if (full) ({ firstName, lastName } = splitFullName(full));
    }

    if (!firstName) {
      issues.push({ line, message: "Falta el nombre del atleta." });
      return;
    }
    if (!lastName) {
      issues.push({ line, message: `Falta el apellido de "${firstName}".` });
      return;
    }

    const nombreDivision = pick(record, ALIAS.division);
    if (!nombreDivision) {
      issues.push({ line, message: `${firstName} ${lastName} no tiene división.` });
      return;
    }

    const division = porNombre.get(normalizeValue(nombreDivision));
    if (!division) {
      issues.push({
        line,
        message: `La división "${nombreDivision}" no existe. Creala primero o corregí la planilla.`,
      });
      return;
    }

    const generoCrudo = pick(record, ALIAS.gender);
    const gender = parseGender(generoCrudo);
    if (generoCrudo && !gender) {
      issues.push({ line, message: `No se entiende el sexo "${generoCrudo}".` });
    }

    const fechaCruda = pick(record, ALIAS.birthDate);
    const birthDate = parseBirthDate(fechaCruda);
    if (fechaCruda && !birthDate) {
      issues.push({
        line,
        message: `No se entiende la fecha "${fechaCruda}". Usá AAAA-MM-DD o DD/MM/AAAA.`,
      });
    }

    const bibCrudo = pick(record, ALIAS.bib);
    let bib: number | null = null;
    if (bibCrudo) {
      const n = Number(bibCrudo);
      if (!Number.isInteger(n) || n <= 0) {
        issues.push({ line, message: `El dorsal "${bibCrudo}" no es un número válido.` });
      } else {
        bib = n;
      }
    }

    const teamName = pick(record, ALIAS.team) || null;
    // Agrupa por nombre de equipo; si no hay, por dorsal compartido; si tampoco,
    // cada fila es su propio equipo.
    const teamKey = teamName
      ? `nombre:${division.id}:${normalizeValue(teamName)}`
      : bib !== null
        ? `dorsal:${division.id}:${bib}`
        : `fila:${line}`;

    filas.push({
      line,
      division,
      bib,
      teamKey,
      teamName,
      athlete: {
        firstName,
        lastName,
        birthDate,
        gender,
        email: pick(record, ALIAS.email) || null,
        phone: pick(record, ALIAS.phone) || null,
        externalRef: pick(record, ALIAS.externalRef) || null,
      },
    });
  });

  // --- Armado de equipos -----------------------------------------------------

  const agrupados = new Map<string, Fila[]>();
  for (const fila of filas) {
    const actual = agrupados.get(fila.teamKey);
    if (actual) actual.push(fila);
    else agrupados.set(fila.teamKey, [fila]);
  }

  const usados = new Set(options.existingBibs ?? []);
  let proximoLibre = Math.max(0, ...usados) + 1;

  function siguienteDorsal(): number {
    while (usados.has(proximoLibre)) proximoLibre += 1;
    return proximoLibre;
  }

  const teams: PlannedTeam[] = [];

  for (const grupo of agrupados.values()) {
    const division = grupo[0].division;
    const lines = grupo.map((f) => f.line);

    if (grupo.length !== division.teamSize) {
      issues.push({
        line: lines[0],
        message: `"${division.name}" es de ${division.teamSize} integrante(s) y este equipo tiene ${grupo.length}. Revisa la columna equipo.`,
      });
      continue;
    }

    const generos = grupo.map((f) => f.athlete.gender);

    if (division.genderRule === "mixed") {
      if (!generos.includes("male") || !generos.includes("female")) {
        issues.push({
          line: lines[0],
          message: `"${division.name}" es mixta y este equipo no tiene un integrante de cada sexo.`,
        });
        continue;
      }
    } else if (division.genderRule === "male" || division.genderRule === "female") {
      const fueraDeLugar = grupo.find((f) => f.athlete.gender !== division.genderRule);
      if (fueraDeLugar) {
        issues.push({
          line: fueraDeLugar.line,
          message: `${fueraDeLugar.athlete.firstName} ${fueraDeLugar.athlete.lastName} no corresponde a "${division.name}".`,
        });
        continue;
      }
    }

    const declarado = grupo.find((f) => f.bib !== null)?.bib ?? null;
    let bibNumber: number;

    if (declarado !== null) {
      if (usados.has(declarado)) {
        issues.push({
          line: lines[0],
          message: `El dorsal ${declarado} ya está usado. Deja la columna vacía para que se asigne solo.`,
        });
        continue;
      }
      bibNumber = declarado;
    } else {
      bibNumber = siguienteDorsal();
    }

    usados.add(bibNumber);

    teams.push({
      divisionId: division.id,
      divisionName: division.name,
      bibNumber,
      name: grupo[0].teamName,
      members: grupo.map((f) => f.athlete),
      lines,
    });
  }

  teams.sort((a, b) => a.bibNumber - b.bibNumber);

  return {
    teams,
    issues,
    totalAthletes: teams.reduce((n, t) => n + t.members.length, 0),
  };
}
