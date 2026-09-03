import type { Adaptador } from "./tipos";
import { montoLegible } from "./tipos";

/**
 * Transferencia bancaria y efectivo.
 *
 * Es la unica pasarela que funciona sin integrar nada, y en Latinoamerica es la
 * que mas se usa. No tiene webhook: la organizacion mira su cuenta y confirma a
 * mano. Por eso `requiereConfirmacionManual` va en true y el webhook siempre
 * falla cerrado — nadie deberia poder marcar una transferencia como recibida
 * desde afuera.
 */
export const transferencia: Adaptador = {
  nombre: "Transferencia bancaria",
  requiereSecreto: false,
  camposPublicos: [
    { key: "banco", label: "Banco" },
    { key: "tipoCuenta", label: "Tipo de cuenta", ayuda: "Ahorros, corriente…" },
    { key: "numeroCuenta", label: "Número de cuenta" },
    { key: "titular", label: "Titular" },
    { key: "instrucciones", label: "Instrucciones extra", ayuda: "A dónde mandar el comprobante." },
  ],

  instrucciones({ publicConfig, totalCents, currency, orderId }) {
    const dato = (k: string) => String(publicConfig[k] ?? "").trim();

    const detalle = [
      `Monto: ${montoLegible(totalCents, currency)}`,
      dato("banco") && `Banco: ${dato("banco")}`,
      dato("tipoCuenta") && `Tipo de cuenta: ${dato("tipoCuenta")}`,
      dato("numeroCuenta") && `Cuenta: ${dato("numeroCuenta")}`,
      dato("titular") && `Titular: ${dato("titular")}`,
      dato("documento") && `Documento: ${dato("documento")}`,
      // La referencia es lo que le permite a la organizacion cruzar la
      // transferencia con la inscripcion sin preguntar.
      `Referencia: ${orderId.slice(0, 8).toUpperCase()}`,
      dato("instrucciones"),
    ].filter((l): l is string => Boolean(l));

    return {
      titulo: "Transferencia bancaria",
      detalle,
      requiereConfirmacionManual: true,
    };
  },

};

/** Efectivo en el lugar. Igual que la transferencia, sin datos bancarios. */
export const efectivo: Adaptador = {
  nombre: "Efectivo",
  requiereSecreto: false,
  camposPublicos: [
    { key: "lugar", label: "Dónde pagar" },
    { key: "horarios", label: "Horarios" },
    { key: "instrucciones", label: "Instrucciones extra" },
  ],

  instrucciones({ publicConfig, totalCents, currency }) {
    const dato = (k: string) => String(publicConfig[k] ?? "").trim();
    return {
      titulo: "Efectivo",
      detalle: [
        `Monto: ${montoLegible(totalCents, currency)}`,
        dato("lugar") && `Dónde: ${dato("lugar")}`,
        dato("horarios") && `Horarios: ${dato("horarios")}`,
        dato("instrucciones"),
      ].filter((l): l is string => Boolean(l)),
      requiereConfirmacionManual: true,
    };
  },

};
