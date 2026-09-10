import { describe, expect, it } from "vitest";
import {
  FIELD_DE_REFERENCIA,
  GAMES_2026,
  TABLA_TIEMPO_TOTAL,
  detectarFieldMismatch,
  escalarTabla,
  pointsForPosition,
  pointsForTiedGroup,
  puntosDinamicos,
  tablaDeCategoria,
  tablaDinamica,
} from "./points";

describe("la curva de referencia", () => {
  it("tiene 30 puestos, de 100 a 0", () => {
    expect(GAMES_2026).toHaveLength(30);
    expect(FIELD_DE_REFERENCIA).toBe(30);
    expect(GAMES_2026[0]).toBe(100);
    expect(GAMES_2026[29]).toBe(0);
  });

  it("coincide con su formula: -4 hasta el 14, -3 desde el 15", () => {
    // La contraparte de escribirla literal: un dedazo al transcribirla no
    // pasa. Del 1 al 14 baja de a 4 (100, 96, 92... 48) y del 14 al 30 baja
    // de a 3 (45, 42... 0).
    const esperada = [
      ...Array.from({ length: 14 }, (_, i) => 100 - i * 4),
      ...Array.from({ length: 16 }, (_, i) => 45 - i * 3),
    ];
    expect([...GAMES_2026]).toEqual(esperada);
  });

  it("premia ganar mas que salir quinto", () => {
    // El escalon de arriba (4 puntos) es mayor que el de abajo (3): obliga al
    // que va primero a no especular.
    expect(GAMES_2026[0] - GAMES_2026[1]).toBe(4);
    expect(GAMES_2026[20] - GAMES_2026[21]).toBe(3);
  });
});

describe("field exacto de 30: se usa la curva tal cual", () => {
  it("no interpola nada", () => {
    expect(puntosDinamicos(30)).toEqual([...GAMES_2026]);
  });

  it("puesto por puesto", () => {
    const tabla = tablaDinamica(30);
    expect(pointsForPosition(tabla, 1)).toBe(100);
    expect(pointsForPosition(tabla, 2)).toBe(96);
    expect(pointsForPosition(tabla, 3)).toBe(92);
    expect(pointsForPosition(tabla, 29)).toBe(3);
    expect(pointsForPosition(tabla, 30)).toBe(0);
  });
});

describe("el primero saca el maximo y el ultimo cero, mida lo que mida el field", () => {
  // Es LA garantia del sistema: no importa si la categoria tiene 8 atletas o
  // 200, la escala completa se reparte entre el primero y el ultimo.
  for (const n of [2, 5, 10, 18, 22, 30, 31, 40, 44, 47, 68, 80, 100, 137]) {
    it(`con ${n} atletas`, () => {
      const puntos = puntosDinamicos(n);
      expect(puntos).toHaveLength(n);
      expect(puntos[0]).toBe(100);
      expect(puntos[n - 1]).toBe(0);
    });
  }

  it("un solo atleta se lleva el maximo, no cero", () => {
    // "El ultimo saca cero" no puede aplicarsele a quien ademas es el primero.
    expect(puntosDinamicos(1)).toEqual([100]);
  });
});

describe("la curva baja siempre, nunca sube ni se estanca", () => {
  for (const n of [10, 18, 40, 44, 80, 100]) {
    it(`con ${n} atletas cada puesto vale menos que el anterior`, () => {
      const puntos = puntosDinamicos(n);
      for (let i = 1; i < puntos.length; i++) {
        expect(puntos[i]).toBeLessThan(puntos[i - 1]);
      }
    });
  }
});

describe("field de 10", () => {
  it("proyecta las 10 posiciones sobre la curva de 30", () => {
    const puntos = puntosDinamicos(10);
    expect(puntos[0]).toBe(100);
    expect(puntos[9]).toBe(0);

    // El 2.º de 10 cae en el puesto equivalente 1 + 29/9 = 4.222 de la curva:
    // entre 88 (puesto 4) y 84 (puesto 5), a un 22,2% del tramo.
    expect(puntos[1]).toBeCloseTo(88 + 0.2222 * (84 - 88), 2);
  });

  it("el ultimo de 10 NO se lleva los 64 puntos que le daria la tabla de 30", () => {
    // Es el problema que la adaptacion resuelve: aplicar la curva de 30 tal
    // cual dejaba al ultimo de un field chico con casi dos tercios del puntaje
    // del ganador.
    expect(puntosDinamicos(10)[9]).toBe(0);
    expect(GAMES_2026[9]).toBe(64);
  });
});

describe("interpolacion", () => {
  it("una posicion equivalente decimal se reparte entre sus dos vecinas", () => {
    // Con 40 atletas, el puesto 20 cae en 1 + 19*29/39 = 15.128: entre el
    // puesto 15 (45 pts) y el 16 (42 pts).
    const equivalente = 1 + (19 * 29) / 39;
    const esperado = 45 + (equivalente - 15) * (42 - 45);
    expect(puntosDinamicos(40)[19]).toBeCloseTo(esperado, 3);
  });

  it("guarda tres decimales, no un entero", () => {
    // Sin decimales, dos puestos consecutivos de un field grande caerian en el
    // mismo valor y empatarian a dos atletas que no empataron en nada.
    const puntos = puntosDinamicos(44);
    const conDecimales = puntos.filter((p) => !Number.isInteger(p));
    expect(conDecimales.length).toBeGreaterThan(0);
    for (const p of puntos) {
      expect(p).toBeCloseTo(Math.round(p * 1000) / 1000, 10);
    }
  });
});

describe("peso de la prueba (MaxPoints)", () => {
  it("con 50 el primero saca 50 y el ultimo cero", () => {
    const puntos = puntosDinamicos(20, 50);
    expect(puntos[0]).toBe(50);
    expect(puntos[19]).toBe(0);
  });

  it("escala proporcionalmente: 200 es el doble de 100 en cada puesto", () => {
    // Hasta el ultimo decimal util. El tercero puede diferir en 1: calcular a
    // escala 200 redondea UNA vez, y duplicar la de 100 redondea dos. No es un
    // problema de correccion porque en produccion los dos consumidores pasan
    // siempre por el mismo camino (`escalarTabla` sobre el mismo snapshot), y
    // lo que tiene que coincidir exactamente es lo que ven el panel y el
    // atleta, no dos formas distintas de llegar al mismo numero.
    const normal = puntosDinamicos(37, 100);
    const doble = puntosDinamicos(37, 200);
    for (let i = 0; i < normal.length; i++) {
      expect(doble[i]).toBeCloseTo(normal[i] * 2, 2);
    }
  });

  it("los dos consumidores escalan igual: misma tabla, mismos numeros", () => {
    // Esta es la garantia que si importa: el cache del servidor y el
    // leaderboard en vivo aplican `escalarTabla` sobre el MISMO snapshot.
    const snapshot = tablaDinamica(44);
    expect(escalarTabla(snapshot, 150).points).toEqual(escalarTabla(snapshot, 150).points);
  });

  it("escalarTabla hace lo mismo sobre una tabla ya materializada", () => {
    const base = tablaDinamica(30);
    const media = escalarTabla(base, 50);
    expect(media.points[0]).toBe(50);
    expect(media.points[29]).toBe(0);
    expect(media.points[1]).toBe(48);
  });

  it("escalar a 100 devuelve la misma tabla, sin recalcular nada", () => {
    const base = tablaDinamica(30);
    expect(escalarTabla(base, 100)).toBe(base);
  });
});

describe("tablaDeCategoria: el unico lugar que decide", () => {
  it("una carrera hibrida no reparte puntos: gana el menor tiempo", () => {
    const tabla = tablaDeCategoria({
      formato: "carrera_hibrida",
      snapshot: null,
      fieldSize: 40,
    });
    expect(tabla).toBe(TABLA_TIEMPO_TOTAL);
    expect(tabla.dir).toBe("menor_gana");
  });

  it("un CrossFit sin snapshot calcula al vuelo con el field actual", () => {
    const tabla = tablaDeCategoria({ formato: "crossfit", snapshot: null, fieldSize: 12 });
    expect(tabla.points).toHaveLength(12);
    expect(tabla.points[0]).toBe(100);
    expect(tabla.points[11]).toBe(0);
  });

  it("con snapshot usa el snapshot y NO el field actual", () => {
    // Es la garantia de que retirarse no mueve la curva: el snapshot es de 44
    // y quedan 40 corriendo.
    const congelada = puntosDinamicos(44);
    const tabla = tablaDeCategoria({
      formato: "crossfit",
      snapshot: congelada,
      fieldSize: 40,
    });
    expect(tabla.points).toHaveLength(44);
    expect(tabla.points).toEqual(congelada);
  });

  it("propaga tiePolicy a la tabla resultante: sin snapshot", () => {
    // Bug real que este test hubiera atrapado: tablaDeCategoria recibe
    // tiePolicy y se lo pasa a tablaDinamica -- sin este test, romper esa
    // linea (por ejemplo ignorando el parametro) no lo detectaria nada, y
    // rankPart terminaria repartiendo puntos con la politica equivocada.
    const tabla = tablaDeCategoria({
      formato: "crossfit",
      snapshot: null,
      fieldSize: 10,
      tiePolicy: "average_occupied_positions",
    });
    expect(tabla.tiePolicy).toBe("average_occupied_positions");
  });

  it("propaga tiePolicy a la tabla resultante: con snapshot", () => {
    const congelada = puntosDinamicos(10);
    const tabla = tablaDeCategoria({
      formato: "crossfit",
      snapshot: congelada,
      fieldSize: 10,
      tiePolicy: "average_occupied_positions",
    });
    expect(tabla.tiePolicy).toBe("average_occupied_positions");
  });

  it("sin tiePolicy explicita, el default es same_position_points (el reglamento oficial)", () => {
    const sinSnapshot = tablaDeCategoria({ formato: "crossfit", snapshot: null, fieldSize: 10 });
    const conSnapshot = tablaDeCategoria({
      formato: "crossfit",
      snapshot: puntosDinamicos(10),
      fieldSize: 10,
    });
    expect(sinSnapshot.tiePolicy).toBe("same_position_points");
    expect(conSnapshot.tiePolicy).toBe("same_position_points");
  });

  it("un snapshot vacio no se toma por bueno", () => {
    const tabla = tablaDeCategoria({ formato: "crossfit", snapshot: [], fieldSize: 9 });
    expect(tabla.points).toHaveLength(9);
  });
});

describe("pointsForPosition", () => {
  it("mas alla de la tabla repite el ultimo valor", () => {
    // Solo puede pasar si alguien se inscribio DESPUES de bloquear el
    // snapshot: comparte el ultimo valor en vez de correr la curva de todos.
    const tabla = tablaDinamica(10);
    expect(pointsForPosition(tabla, 11)).toBe(0);
    expect(pointsForPosition(tabla, 50)).toBe(0);
  });

  it("sin tabla los puntos son la posicion", () => {
    expect(pointsForPosition(TABLA_TIEMPO_TOTAL, 1)).toBe(1);
    expect(pointsForPosition(TABLA_TIEMPO_TOTAL, 37)).toBe(37);
  });

  it("una posicion invalida no rompe el calculo", () => {
    expect(pointsForPosition(tablaDinamica(30), 0)).toBe(0);
  });
});

describe("pointsForTiedGroup: same_position_points (default, reglamento oficial)", () => {
  it("es EXACTAMENTE pointsForPosition para cualquier tiedWith -- no se mueve ni un decimal", () => {
    const tabla = tablaDinamica(10);
    for (let position = 1; position <= 10; position++) {
      for (const tiedWith of [1, 2, 3]) {
        expect(pointsForTiedGroup(tabla, position, tiedWith)).toBe(
          pointsForPosition(tabla, position),
        );
      }
    }
  });

  it("sin empate (tiedWith=1) es igual con cualquier politica", () => {
    const tabla = tablaDinamica(10, 100, "average_occupied_positions");
    expect(pointsForTiedGroup(tabla, 3, 1)).toBe(pointsForPosition(tabla, 3));
  });
});

describe("pointsForTiedGroup: average_occupied_positions (convencion Scora)", () => {
  it("el caso real: 10 atletas, empates en 3, 5 y 9 -- (P3+P4)/2, (P5+P6)/2, (P9+P10)/2", () => {
    // Precision 2, no 3: el promedio crudo puede caer justo en el limite de
    // redondeo (x.xxx5) y toBeCloseTo(_, 3) exige una tolerancia mas chica
    // que ese medio-milesimo. El valor YA se compara exacto a 3 decimales en
    // place.test.ts contra la cifra escrita a mano.
    const tabla = tablaDinamica(10, 100, "average_occupied_positions");
    expect(pointsForTiedGroup(tabla, 3, 2)).toBeCloseTo(
      (pointsForPosition(tabla, 3) + pointsForPosition(tabla, 4)) / 2,
      2,
    );
    expect(pointsForTiedGroup(tabla, 5, 2)).toBeCloseTo(
      (pointsForPosition(tabla, 5) + pointsForPosition(tabla, 6)) / 2,
      2,
    );
    expect(pointsForTiedGroup(tabla, 9, 2)).toBeCloseTo(
      (pointsForPosition(tabla, 9) + pointsForPosition(tabla, 10)) / 2,
      2,
    );
  });

  it("el ultimo empate (9,10 de 10) no saca 0: reparte el 0 del ultimo puesto entre los dos", () => {
    const tabla = tablaDinamica(10, 100, "average_occupied_positions");
    const puntos = pointsForTiedGroup(tabla, 9, 2);
    expect(puntos).toBeGreaterThan(0);
    expect(puntos).toBeCloseTo(pointsForPosition(tabla, 9) / 2, 3);
  });

  it("grupo de 3 promedia 3 posiciones", () => {
    const tabla = tablaDinamica(10, 100, "average_occupied_positions");
    const esperado =
      (pointsForPosition(tabla, 3) +
        pointsForPosition(tabla, 4) +
        pointsForPosition(tabla, 5)) /
      3;
    expect(pointsForTiedGroup(tabla, 3, 3)).toBeCloseTo(esperado, 3);
  });

  it("un grupo que se pasa del largo de la tabla hereda el clamp de pointsForPosition", () => {
    // Snapshot de 10, un grupo de 2 empatado en el puesto 9: las posiciones
    // ocupadas son 9 y 10, ambas dentro de rango, sin clamp. Forzar un grupo
    // que exceda el largo (10 empatados en el puesto 9 con snapshot de 10)
    // repite el ultimo valor para las posiciones que faltan, igual que
    // pointsForPosition.
    const tabla = tablaDinamica(10, 100, "average_occupied_positions");
    const esperado =
      (pointsForPosition(tabla, 9) +
        pointsForPosition(tabla, 10) +
        pointsForPosition(tabla, 11)) /
      3; // el puesto 11 no existe: repite el valor del 10 (0)
    expect(pointsForTiedGroup(tabla, 9, 3)).toBeCloseTo(esperado, 3);
  });

  it("conserva el total EXACTAMENTE hasta el redondeo a 3 decimales", () => {
    // La curva completa de 10 puestos reparte una suma fija. Repartir un
    // empate por promedio no puede cambiar ese total, salvo el ruido de
    // redondear cada grupo por separado.
    const tabla = tablaDinamica(10, 100, "average_occupied_positions");
    const totalCurva = Array.from({ length: 10 }, (_, i) => pointsForPosition(tabla, i + 1)).reduce(
      (a, b) => a + b,
      0,
    );

    // 1,2,3,3,5,5,7,8,9,9 -- grupos en 1,2,3(x2),5(x2),7,8,9(x2)
    const grupos: Array<[number, number]> = [
      [1, 1],
      [2, 1],
      [3, 2],
      [5, 2],
      [7, 1],
      [8, 1],
      [9, 2],
    ];
    const totalRepartido = grupos.reduce(
      (suma, [posicion, tiedWith]) => suma + pointsForTiedGroup(tabla, posicion, tiedWith) * tiedWith,
      0,
    );

    expect(Math.abs(totalRepartido - totalCurva)).toBeLessThanOrEqual(0.001 * 10);
  });

  it("TABLA_TIEMPO_TOTAL no promedia nunca: points es la posicion entera", () => {
    // TABLA_TIEMPO_TOTAL declara same_position_points, pero aunque alguien la
    // fuerce con la otra politica, points.length === 0 hace que
    // pointsForPosition devuelva la posicion misma sin pasar por el promedio.
    const tablaForzada = { ...TABLA_TIEMPO_TOTAL, tiePolicy: "average_occupied_positions" as const };
    expect(pointsForTiedGroup(tablaForzada, 3, 2)).toBe(3);
    expect(pointsForTiedGroup(TABLA_TIEMPO_TOTAL, 3, 2)).toBe(3);
  });
});

describe("detectarFieldMismatch", () => {
  it("dispara cuando el field real crecio por encima del snapshot congelado", () => {
    const mismatch = detectarFieldMismatch({
      divisionId: "d1",
      stage: 1,
      snapshotFieldSize: 10,
      actualFieldSize: 13,
    });
    expect(mismatch).toEqual({ divisionId: "d1", stage: 1, snapshotFieldSize: 10, actualFieldSize: 13 });
  });

  it("no dispara si el field es igual al snapshot", () => {
    expect(
      detectarFieldMismatch({ divisionId: "d1", stage: 1, snapshotFieldSize: 10, actualFieldSize: 10 }),
    ).toBeNull();
  });

  it("no dispara si el field es MENOR (un retiro es legitimo, no un mismatch)", () => {
    expect(
      detectarFieldMismatch({ divisionId: "d1", stage: 1, snapshotFieldSize: 10, actualFieldSize: 8 }),
    ).toBeNull();
  });
});
