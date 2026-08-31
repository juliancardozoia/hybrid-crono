import QRCode from "qrcode";


/**
 * Genera el QR como SVG en el servidor.
 *
 * SVG y no canvas ni PNG porque estas hojas se imprimen: un vectorial sale
 * nitido a cualquier tamaño, y ademas no hace falta enviar ninguna libreria de
 * QR al navegador.
 */
export async function qrSvg(url: string, size = 160): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: size,
    // Nivel medio de correccion de errores: aguanta que la etiqueta se manche o
    // se doble sin dejar de leerse, sin agrandar demasiado el codigo.
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
}

export { absoluteUrl as publicUrl } from "@/shared/utils/appUrl";
