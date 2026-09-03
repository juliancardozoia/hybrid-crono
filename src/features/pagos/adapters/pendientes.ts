import type { Adaptador } from "./tipos";
import { montoLegible } from "./tipos";

/**
 * Pasarelas cuya integracion todavia no esta terminada.
 *
 * POR QUE EXISTEN IGUAL
 *
 * El organizador puede guardar sus credenciales desde ya —eso funciona y esta
 * cifrado— pero el cobro automatico no. Antes que dejar la pantalla vacia, se
 * dice lo que hay: se puede cargar la cuenta, y el cobro se confirma a mano
 * hasta que la integracion este.
 *
 * LO IMPORTANTE: su webhook FALLA CERRADO. Una integracion a medias que
 * aceptara webhooks sin verificar seria peor que no tenerla, porque cualquiera
 * que supiera la URL inscribiria equipos gratis.
 */

function pendiente(nombre: string, campos: Adaptador["camposPublicos"], secreto?: Adaptador["campoSecreto"]): Adaptador {
  return {
    nombre,
    requiereSecreto: Boolean(secreto),
    camposPublicos: campos,
    campoSecreto: secreto,

    instrucciones({ totalCents, currency }) {
      return {
        titulo: nombre,
        detalle: [
          `Monto: ${montoLegible(totalCents, currency)}`,
          `El cobro automático con ${nombre} todavía no está disponible.`,
          "La organización te va a confirmar el pago a mano.",
        ],
        requiereConfirmacionManual: true,
      };
    },

  };
}

export const paypal = pendiente(
  "PayPal",
  [
    { key: "clientId", label: "Client ID", ayuda: "El de la app de PayPal. No es secreto." },
    { key: "webhookId", label: "Webhook ID", ayuda: "Hace falta para verificar las notificaciones." },
  ],
  { label: "Client secret", ayuda: "En PayPal: Apps & Credentials → tu app." },
);

export const addi = pendiente(
  "Addi",
  [{ key: "allyId", label: "Ally ID" }],
  { label: "Client secret" },
);
