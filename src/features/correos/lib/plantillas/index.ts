import { localeDeIntl } from "@/shared/i18n/diccionario";
import type { Idioma } from "@/shared/i18n/idiomas";
import { sanitizeReturnPath } from "@/features/auth/lib/redirect";
import type { CorreoEnCola, CorreoRenderizado, TipoDeCorreo } from "../tipos";
import { renderHtml, renderTexto, type Carcasa } from "./diseno";
import { TEXTOS, interpolar, type Bloque, type Textos } from "./textos";

/**
 * De una fila de la cola al correo listo para enviar.
 *
 * Todo lo que el correo dice sale del `payload`, que la base armo AL ENCOLAR:
 * el correo cuenta lo que era cierto cuando ocurrio y esta funcion no consulta
 * nada. Eso la hace pura y testeable en los tres idiomas sin base ni red.
 *
 * Un tipo desconocido LANZA en vez de mandar un correo vacio: el procesador lo
 * marca como fallo, queda `last_error` a la vista y nadie recibe basura.
 */

function texto(payload: Record<string, unknown>, clave: string): string | null {
  const valor = payload[clave];
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** El asunto va en una cabecera: un salto de linea ahi permite inyectar otras. */
function unaLinea(valor: string): string {
  return valor.replace(/[\r\n]+/g, " ").trim();
}

function formatearMonto(centavos: unknown, moneda: unknown, idioma: Idioma): string {
  const monto = typeof centavos === "number" ? centavos / 100 : 0;
  const codigo = typeof moneda === "string" && /^[A-Z]{3}$/.test(moneda) ? moneda : "USD";
  try {
    return new Intl.NumberFormat(localeDeIntl(idioma), {
      style: "currency",
      currency: codigo,
      maximumFractionDigits: Number.isInteger(monto) ? 0 : 2,
    }).format(monto);
  } catch {
    return `${monto} ${codigo}`;
  }
}

function detallesDeInscripcion(payload: Record<string, unknown>, t: Textos): Array<[string, string]> {
  const filas: Array<[string, string]> = [];
  const evento = texto(payload, "event_name");
  const categoria = texto(payload, "division_name");
  const equipo = texto(payload, "team_name");
  if (evento) filas.push([t.comun.evento, evento]);
  if (categoria) filas.push([t.comun.categoria, categoria]);
  if (equipo) filas.push([t.comun.equipo, equipo]);
  return filas;
}

export function renderizarCorreo(
  fila: Pick<CorreoEnCola, "kind" | "payload">,
  idioma: Idioma,
  baseUrl: string,
): CorreoRenderizado {
  const t = TEXTOS[idioma];
  const p = fila.payload ?? {};
  const tipo = fila.kind as TipoDeCorreo;

  const evento = texto(p, "event_name") ?? "Scora";
  const quien = texto(p, "captain_name") ?? texto(p, "inviter_name") ?? t.comun.alguien;
  const url = `${baseUrl.replace(/\/+$/, "")}${sanitizeReturnPath(texto(p, "path"))}`;

  let bloque: Bloque;
  let cuerpo: string;
  let botonTexto: string;
  let detalles: Array<[string, string]> = [];
  let nota: string | undefined;
  const vars: Record<string, string> = { evento, quien };

  switch (tipo) {
    case "invitacion_equipo":
      bloque = t.invitacion_equipo;
      cuerpo = bloque.cuerpo;
      botonTexto = bloque.boton;
      detalles = detallesDeInscripcion(p, t);
      break;

    case "inscripcion_confirmada":
      bloque = t.inscripcion_confirmada;
      cuerpo = bloque.cuerpo;
      botonTexto = bloque.boton;
      detalles = detallesDeInscripcion(p, t);
      break;

    case "pago_recibido": {
      bloque = t.pago_recibido;
      cuerpo = bloque.cuerpo;
      botonTexto = bloque.boton;
      vars.monto = formatearMonto(p.total_cents, p.currency, idioma);
      detalles = detallesDeInscripcion(p, t);
      break;
    }

    case "invitacion_staff": {
      const bloqueStaff = t.invitacion_staff;
      bloque = bloqueStaff;
      const esJuez = p.staff_role === "judge";
      cuerpo = esJuez ? bloqueStaff.cuerpo : bloqueStaff.cuerpoColaborador;
      botonTexto = esJuez ? bloqueStaff.boton : bloqueStaff.botonColaborador;
      if (p.has_account === false) nota = bloqueStaff.sinCuenta;
      break;
    }

    case "juez_aprobado":
      bloque = t.juez_aprobado;
      cuerpo = bloque.cuerpo;
      botonTexto = bloque.boton;
      break;

    default:
      throw new Error(`Tipo de correo desconocido: ${fila.kind}`);
  }

  const carcasa: Carcasa = {
    titulo: interpolar(bloque.titulo, vars),
    saludo: t.comun.saludo,
    cuerpo: interpolar(cuerpo, vars),
    detalles,
    boton: { texto: botonTexto, url },
    nota,
    enlaceAlternativo: t.comun.enlaceAlternativo,
    ignorar: t.comun.ignorar,
    pie: t.comun.pie,
  };

  return {
    asunto: unaLinea(interpolar(bloque.asunto, vars)),
    html: renderHtml(carcasa),
    texto: renderTexto(carcasa),
  };
}
