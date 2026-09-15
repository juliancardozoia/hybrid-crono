// Como se le llama a la subdivision de un pais (provincia, estado,
// departamento...). Es cosmetico -el dato se guarda igual en
// `state_province` sea cual sea la etiqueta- pero "Provincia" en un
// formulario mexicano o "Estado" en uno argentino lee raro.
//
// Vive en `shared/` porque lo usan DOS lugares que tienen que decir lo
// mismo: el alta manual del organizador (`AltaDeAtleta`) y la inscripcion
// publica / el perfil de cuenta (`CamposDeAtleta`, `FormularioDePerfil`).
// Antes solo existia dentro de `AltaDeAtleta.tsx` -- una copia local hubiera
// sido el mismo texto mantenido en dos lados, divergiendo tarde o temprano.
const ETIQUETA_SUBDIVISION: Record<string, string> = {
  AR: "Provincia",
  MX: "Estado",
  US: "Estado",
  BR: "Estado",
  CA: "Provincia",
  CO: "Departamento",
  PE: "Departamento",
  BO: "Departamento",
  UY: "Departamento",
  CR: "Provincia",
  ES: "Provincia",
};

export function etiquetaSubdivision(codigoPais: string): string {
  return ETIQUETA_SUBDIVISION[codigoPais] ?? "Estado / Provincia";
}
