/**
 * Paises donde la plataforma opera, con su prefijo telefonico.
 *
 * La lista arranca por Latinoamerica porque es a donde apunta el producto, y el
 * codigo se guarda en ISO de dos letras: es lo que hace que el catalogo publico
 * pueda filtrar por pais sin depender de como lo escribio cada organizador.
 *
 * El prefijo va junto al pais y no suelto porque un telefono sin prefijo, en una
 * plataforma que cruza doce paises, no se puede marcar.
 */

export interface Pais {
  codigo: string;
  nombre: string;
  prefijo: string;
}

export const PAISES: readonly Pais[] = [
  { codigo: "AR", nombre: "Argentina", prefijo: "+54" },
  { codigo: "BO", nombre: "Bolivia", prefijo: "+591" },
  { codigo: "BR", nombre: "Brasil", prefijo: "+55" },
  { codigo: "CL", nombre: "Chile", prefijo: "+56" },
  { codigo: "CO", nombre: "Colombia", prefijo: "+57" },
  { codigo: "CR", nombre: "Costa Rica", prefijo: "+506" },
  { codigo: "CU", nombre: "Cuba", prefijo: "+53" },
  { codigo: "DO", nombre: "República Dominicana", prefijo: "+1" },
  { codigo: "EC", nombre: "Ecuador", prefijo: "+593" },
  { codigo: "SV", nombre: "El Salvador", prefijo: "+503" },
  { codigo: "GT", nombre: "Guatemala", prefijo: "+502" },
  { codigo: "HN", nombre: "Honduras", prefijo: "+504" },
  { codigo: "MX", nombre: "México", prefijo: "+52" },
  { codigo: "NI", nombre: "Nicaragua", prefijo: "+505" },
  { codigo: "PA", nombre: "Panamá", prefijo: "+507" },
  { codigo: "PY", nombre: "Paraguay", prefijo: "+595" },
  { codigo: "PE", nombre: "Perú", prefijo: "+51" },
  { codigo: "PR", nombre: "Puerto Rico", prefijo: "+1" },
  { codigo: "UY", nombre: "Uruguay", prefijo: "+598" },
  { codigo: "VE", nombre: "Venezuela", prefijo: "+58" },
  { codigo: "ES", nombre: "España", prefijo: "+34" },
  { codigo: "US", nombre: "Estados Unidos", prefijo: "+1" },
];

const POR_CODIGO = new Map(PAISES.map((p) => [p.codigo, p]));

export function pais(codigo: string | null): Pais | null {
  return codigo ? (POR_CODIGO.get(codigo) ?? null) : null;
}

export function nombreDePais(codigo: string | null): string {
  return pais(codigo)?.nombre ?? "";
}

/**
 * Huso horario por defecto de cada pais.
 *
 * Es solo una sugerencia para no hacerle elegir el huso a alguien que ya dijo en
 * que pais compite. Los paises con varios husos quedan en el mas poblado y el
 * organizador lo corrige si hace falta: equivocarse aquí corre la hora de largada
 * en la torre de control, que es justo donde alguien mira el reloj para decidir.
 */
const HUSO_POR_PAIS: Record<string, string> = {
  AR: "America/Argentina/Buenos_Aires",
  BO: "America/La_Paz",
  BR: "America/Sao_Paulo",
  CL: "America/Santiago",
  CO: "America/Bogota",
  CR: "America/Costa_Rica",
  CU: "America/Havana",
  DO: "America/Santo_Domingo",
  EC: "America/Guayaquil",
  SV: "America/El_Salvador",
  GT: "America/Guatemala",
  HN: "America/Tegucigalpa",
  MX: "America/Mexico_City",
  NI: "America/Managua",
  PA: "America/Panama",
  PY: "America/Asuncion",
  PE: "America/Lima",
  PR: "America/Puerto_Rico",
  UY: "America/Montevideo",
  VE: "America/Caracas",
  ES: "Europe/Madrid",
  US: "America/New_York",
};

export function husoSugerido(codigo: string | null): string {
  return (codigo && HUSO_POR_PAIS[codigo]) || "America/Bogota";
}
