import { describe, expect, it } from "vitest";
import {
  FIELD_DE_REFERENCIA,
  GAMES_2026,
  TABLA_TIEMPO_TOTAL,
  escalarTabla,
  pointsForPosition,
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
