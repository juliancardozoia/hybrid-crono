import { describe, expect, it } from "vitest";
import { normalizeHeader, parseCsv, parseCsvToRecords } from "./csv";
import { buildImportPlan, parseBirthDate, parseGender, type DivisionInfo } from "./import";

const DIVISIONES: DivisionInfo[] = [
  { id: "d-ind-m", name: "Individual Masculino", teamSize: 1, genderRule: "male" },
  { id: "d-ind-f", name: "Individual Femenino", teamSize: 1, genderRule: "female" },
  { id: "d-par-mx", name: "Parejas Mixtas", teamSize: 2, genderRule: "mixed" },
  { id: "d-par-m", name: "Parejas Masculino", teamSize: 2, genderRule: "male" },
];

describe("parseCsv", () => {
  it("parsea un csv simple", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("respeta comas dentro de comillas", () => {
    expect(parseCsv('nombre,nota\n"Perez, Juan",ok')).toEqual([
      ["nombre", "nota"],
      ["Perez, Juan", "ok"],
    ]);
  });

  it("entiende comillas escapadas", () => {
    expect(parseCsv('a\n"dice ""hola"""')).toEqual([["a"], ['dice "hola"']]);
  });

  it("soporta saltos de linea dentro de una celda", () => {
    expect(parseCsv('a,b\n"linea1\nlinea2",x')).toEqual([
      ["a", "b"],
      ["linea1\nlinea2", "x"],
    ]);
  });

  it("detecta punto y coma como separador", () => {
    expect(parseCsv("a;b;c\n1;2;3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("saca el BOM que agrega Excel", () => {
    const conBom = "\u{FEFF}nombre,apellido\nAna,Perez";
    expect(parseCsv(conBom)[0][0]).toBe("nombre");
  });

  it("soporta finales de linea de Windows", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("descarta filas vacias", () => {
    expect(parseCsv("a,b\n1,2\n\n,\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("normalizeHeader", () => {
  it("normaliza tildes, mayusculas y espacios", () => {
    expect(normalizeHeader("  Fecha de Nacimiento ")).toBe("fecha_de_nacimiento");
    expect(normalizeHeader("Categoría")).toBe("categoria");
  });
});

describe("parseCsvToRecords", () => {
  it("usa la primera fila como encabezado normalizado", () => {
    const rows = parseCsvToRecords("Nombre,Apellido\nAna,Pérez");
    expect(rows).toEqual([{ nombre: "Ana", apellido: "Pérez" }]);
  });
});

describe("parseGender", () => {
  it("acepta las formas que la gente realmente escribe", () => {
    expect(parseGender("M")).toBe("male");
    expect(parseGender("masculino")).toBe("male");
    expect(parseGender("Hombre")).toBe("male");
    expect(parseGender("F")).toBe("female");
    expect(parseGender("Femenino")).toBe("female");
    expect(parseGender("mujer")).toBe("female");
  });

  it("devuelve null si no se entiende", () => {
    expect(parseGender("varon?")).toBeNull();
    expect(parseGender("")).toBeNull();
  });
});

describe("parseBirthDate", () => {
  it("acepta ISO", () => {
    expect(parseBirthDate("1990-05-04")).toBe("1990-05-04");
  });

  it("acepta formatos con dia primero", () => {
    expect(parseBirthDate("04/05/1990")).toBe("1990-05-04");
    expect(parseBirthDate("4-5-1990")).toBe("1990-05-04");
  });

  it("rechaza fechas imposibles", () => {
    expect(parseBirthDate("31/02/1990")).toBeNull();
    expect(parseBirthDate("2020-13-01")).toBeNull();
  });

  it("rechaza basura y vacio", () => {
    expect(parseBirthDate("ayer")).toBeNull();
    expect(parseBirthDate("")).toBeNull();
  });
});

describe("buildImportPlan - individuales", () => {
  const csv = [
    "nombre,apellido,sexo,division,fecha_nacimiento",
    "Ana,Gomez,F,Individual Femenino,1992-03-01",
    "Luis,Perez,M,Individual Masculino,15/07/1988",
  ].join("\n");

  it("arma un equipo por atleta y asigna dorsales", () => {
    const plan = buildImportPlan(csv, DIVISIONES);
    expect(plan.issues).toEqual([]);
    expect(plan.teams).toHaveLength(2);
    expect(plan.totalAthletes).toBe(2);
    expect(plan.teams.map((t) => t.bibNumber)).toEqual([1, 2]);
  });

  it("normaliza la fecha al formato de la base", () => {
    const plan = buildImportPlan(csv, DIVISIONES);
    const luis = plan.teams.flatMap((t) => t.members).find((m) => m.firstName === "Luis");
    expect(luis?.birthDate).toBe("1988-07-15");
  });

  it("no reutiliza dorsales que ya existen", () => {
    const plan = buildImportPlan(csv, DIVISIONES, { existingBibs: [1, 2, 3] });
    expect(plan.teams.map((t) => t.bibNumber)).toEqual([4, 5]);
  });

  it("respeta el dorsal declarado en la planilla", () => {
    const conDorsal = "nombre,apellido,sexo,division,dorsal\nAna,Gomez,F,Individual Femenino,77";
    const plan = buildImportPlan(conDorsal, DIVISIONES);
    expect(plan.teams[0].bibNumber).toBe(77);
  });

  it("rechaza un dorsal que choca con uno existente", () => {
    const conDorsal = "nombre,apellido,sexo,division,dorsal\nAna,Gomez,F,Individual Femenino,5";
    const plan = buildImportPlan(conDorsal, DIVISIONES, { existingBibs: [5] });
    expect(plan.teams).toHaveLength(0);
    expect(plan.issues[0].message).toContain("ya está usado");
  });
});

describe("buildImportPlan - parejas", () => {
  it("agrupa por nombre de equipo", () => {
    const csv = [
      "nombre,apellido,sexo,division,equipo",
      "Ana,Gomez,F,Parejas Mixtas,Los Rapidos",
      "Luis,Perez,M,Parejas Mixtas,Los Rapidos",
    ].join("\n");

    const plan = buildImportPlan(csv, DIVISIONES);
    expect(plan.issues).toEqual([]);
    expect(plan.teams).toHaveLength(1);
    expect(plan.teams[0].members).toHaveLength(2);
    expect(plan.teams[0].name).toBe("Los Rapidos");
  });

  it("agrupa por dorsal compartido cuando no hay nombre de equipo", () => {
    const csv = [
      "nombre,apellido,sexo,division,dorsal",
      "Ana,Gomez,F,Parejas Mixtas,10",
      "Luis,Perez,M,Parejas Mixtas,10",
    ].join("\n");

    const plan = buildImportPlan(csv, DIVISIONES);
    expect(plan.teams).toHaveLength(1);
    expect(plan.teams[0].bibNumber).toBe(10);
  });

  it("rechaza una pareja incompleta", () => {
    const csv = [
      "nombre,apellido,sexo,division,equipo",
      "Ana,Gomez,F,Parejas Mixtas,Solos",
    ].join("\n");

    const plan = buildImportPlan(csv, DIVISIONES);
    expect(plan.teams).toHaveLength(0);
    expect(plan.issues[0].message).toContain("2 integrante(s)");
  });

  it("rechaza una mixta que no tiene un integrante de cada sexo", () => {
    const csv = [
      "nombre,apellido,sexo,division,equipo",
      "Ana,Gomez,F,Parejas Mixtas,Solo Ellas",
      "Rita,Lopez,F,Parejas Mixtas,Solo Ellas",
    ].join("\n");

    const plan = buildImportPlan(csv, DIVISIONES);
    expect(plan.teams).toHaveLength(0);
    expect(plan.issues[0].message).toContain("un integrante de cada sexo");
  });

  it("rechaza a quien no corresponde a una division de un solo sexo", () => {
    const csv = [
      "nombre,apellido,sexo,division,equipo",
      "Ana,Gomez,F,Parejas Masculino,Mixto Colado",
      "Luis,Perez,M,Parejas Masculino,Mixto Colado",
    ].join("\n");

    const plan = buildImportPlan(csv, DIVISIONES);
    expect(plan.teams).toHaveLength(0);
    expect(plan.issues[0].message).toContain("Ana Gomez");
  });
});

describe("buildImportPlan - errores por fila", () => {
  it("señala la linea del archivo, como la muestra Excel", () => {
    const csv = [
      "nombre,apellido,sexo,division",
      "Ana,Gomez,F,Individual Femenino",
      ",Perez,M,Individual Masculino",
    ].join("\n");

    const plan = buildImportPlan(csv, DIVISIONES);
    expect(plan.issues[0].line).toBe(3);
    expect(plan.issues[0].message).toContain("Falta el nombre");
  });

  it("avisa cuando la division no existe", () => {
    const csv = "nombre,apellido,sexo,division\nAna,Gomez,F,Elite Femenino";
    const plan = buildImportPlan(csv, DIVISIONES);
    expect(plan.issues[0].message).toContain('"Elite Femenino" no existe');
  });

  it("compara divisiones sin importar tildes ni mayusculas", () => {
    const csv = "nombre,apellido,sexo,division\nAna,Gomez,F,individual femenino";
    const plan = buildImportPlan(csv, DIVISIONES);
    expect(plan.issues).toEqual([]);
    expect(plan.teams[0].divisionId).toBe("d-ind-f");
  });

  it("importa las filas buenas aunque otras tengan error", () => {
    const csv = [
      "nombre,apellido,sexo,division",
      "Ana,Gomez,F,Individual Femenino",
      "Sin,Division,M,",
      "Luis,Perez,M,Individual Masculino",
    ].join("\n");

    const plan = buildImportPlan(csv, DIVISIONES);
    expect(plan.teams).toHaveLength(2);
    expect(plan.issues).toHaveLength(1);
  });

  it("acepta nombre completo en una sola columna", () => {
    const csv = "nombre_completo,sexo,division\nAna Maria Gomez Lopez,F,Individual Femenino";
    const plan = buildImportPlan(csv, DIVISIONES);
    expect(plan.teams[0].members[0]).toMatchObject({
      firstName: "Ana Maria",
      lastName: "Gomez Lopez",
    });
  });

  it("avisa si el archivo esta vacio", () => {
    const plan = buildImportPlan("", DIVISIONES);
    expect(plan.teams).toHaveLength(0);
    expect(plan.issues[0].message).toContain("vacío");
  });
});
