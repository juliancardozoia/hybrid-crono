import type { Adaptador } from "./tipos";
import { montoLegible } from "./tipos";

/**
 * Descriptor de MercadoPago: como se llama, que credenciales pide y que ve
 * quien va a pagar.
 *
 * La verificacion de la firma NO esta aca: vive en
 * `verificadores/mercadopago.ts`, que es solo de servidor. Este archivo lo
 * importa un componente de cliente, y ni node:crypto ni el secreto del
 * organizador tienen por que terminar en un bundle de navegador.
 */
export const mercadopago: Adaptador = {
  nombre: "MercadoPago",
  requiereSecreto: true,
  camposPublicos: [
    { key: "publicKey", label: "Public key", ayuda: "Empieza con APP_USR-. No es secreta." },
    { key: "accessTokenPista", label: "Referencia de la cuenta", ayuda: "Para reconocerla." },
  ],
  campoSecreto: {
    label: "Clave secreta del webhook",
    ayuda: "En MercadoPago: Tus integraciones → Webhooks → Firma secreta.",
  },

  instrucciones({ totalCents, currency }) {
    return {
      titulo: "MercadoPago",
      detalle: [`Monto: ${montoLegible(totalCents, currency)}`],
      requiereConfirmacionManual: false,
    };
  }
};
