import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cifrado de los secretos de las pasarelas.
 *
 * POR QUE EL CIFRADO VIVE EN LA APP Y NO EN POSTGRES
 *
 * Las llaves de las pasarelas son el dato mas sensible del sistema: con ellas
 * se cobra en nombre del organizador. La opcion "natural" seria pgsodium o
 * Supabase Vault, pero las dos dejan la LLAVE dentro de la misma base que
 * guarda el dato. Un volcado de la base —un backup mal guardado, un acceso de
 * soporte, una restauracion en un entorno de pruebas— se lleva las dos cosas.
 *
 * Cifrando en la app, Postgres guarda un texto que no significa nada sin la
 * llave, y la llave vive en el entorno del servidor. Un volcado completo de la
 * base no alcanza para cobrar en nombre de nadie.
 *
 * (Y de paso: pgsodium y Vault no existen en PGlite, asi que la alternativa
 * habria dejado esta parte sin tests.)
 *
 * AES-256-GCM: cifra y ademas AUTENTICA. Si alguien edita un byte del texto
 * cifrado directamente en la base, el descifrado falla en vez de devolver
 * basura que despues se manda a una pasarela.
 */

const ALGORITMO = "aes-256-gcm";
const VERSION = "v1";

/** La llave se deriva de la variable de entorno, no se usa cruda. */
function llave(): Buffer {
  const bruta = process.env.PAYMENTS_ENCRYPTION_KEY;

  if (!bruta || bruta.length < 32) {
    // Falla ruidosamente y a proposito: sin llave, la alternativa seria guardar
    // los secretos en claro, y eso no puede pasar nunca en silencio.
    throw new Error(
      "Falta PAYMENTS_ENCRYPTION_KEY (mínimo 32 caracteres). Sin esa clave no se pueden guardar credenciales de pasarela.",
    );
  }

  return createHash("sha256").update(bruta).digest();
}

export function hayLlaveDeCifrado(): boolean {
  const bruta = process.env.PAYMENTS_ENCRYPTION_KEY;
  return Boolean(bruta && bruta.length >= 32);
}

/**
 * Devuelve un sobre `v1.iv.tag.datos`, todo en base64url.
 *
 * Lleva version para poder rotar el algoritmo sin tener que adivinar despues
 * con que se cifro cada fila.
 */
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITMO, llave(), iv);

  const datos = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), datos.toString("base64url")].join(
    ".",
  );
}

export function descifrar(sobre: string): string {
  const partes = sobre.split(".");
  if (partes.length !== 4 || partes[0] !== VERSION) {
    throw new Error("El secreto guardado no tiene un formato que sepamos leer.");
  }

  const [, ivB64, tagB64, datosB64] = partes;
  const decipher = createDecipheriv(ALGORITMO, llave(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));

  // Si el texto fue alterado, esto lanza en vez de devolver basura.
  return Buffer.concat([
    decipher.update(Buffer.from(datosB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Compara dos firmas sin filtrar por cuanto tardo la comparacion.
 *
 * Un `===` sale en el primer byte distinto, y esa diferencia de tiempo —medida
 * muchas veces— deja adivinar la firma correcta byte a byte. Es la unica forma
 * correcta de comparar un secreto.
 */
export function firmasIguales(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual exige la misma longitud, y esa comparacion previa si puede
  // hacerse directo: la longitud de una firma no es secreta.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Lo que se le muestra al organizador de una credencial ya guardada.
 *
 * Nunca se devuelve el secreto entero a una pantalla: alcanza con que reconozca
 * cual cargo.
 */
export function pista(secreto: string): string {
  const limpio = secreto.trim();
  if (limpio.length <= 8) return "••••";
  return `${limpio.slice(0, 4)}••••${limpio.slice(-4)}`;
}
