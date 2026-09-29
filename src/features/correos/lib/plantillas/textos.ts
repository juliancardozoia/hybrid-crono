import type { Idioma } from "@/shared/i18n/idiomas";

/**
 * Los textos de los correos, en los tres idiomas.
 *
 * Viven APARTE del diccionario de la pantalla (`src/shared/i18n`) por una razon
 * practica: ese se carga en el navegador de cada visitante, y estos textos solo
 * los usa el servidor. Meterlos ahi engorda el bundle de todo el mundo para un
 * uso que nunca ocurre en el cliente.
 *
 * Mismo criterio de tono que el resto de la app: tuteo neutro, ni voseo ni
 * "usted". Las variables se interpolan con `{nombre}` — nunca se concatenan
 * trozos, porque en ingles y portugues el orden de la frase cambia.
 */

export interface Bloque {
  asunto: string;
  titulo: string;
  cuerpo: string;
  boton: string;
}

export interface Textos {
  comun: {
    saludo: string;
    alguien: string;
    ignorar: string;
    enlaceAlternativo: string;
    pie: string;
    evento: string;
    categoria: string;
    equipo: string;
    monto: string;
  };
  invitacion_equipo: Bloque;
  inscripcion_confirmada: Bloque;
  pago_recibido: Bloque;
  invitacion_staff: Bloque & { cuerpoColaborador: string; botonColaborador: string; sinCuenta: string };
  juez_aprobado: Bloque;
}

const es: Textos = {
  comun: {
    saludo: "Hola,",
    alguien: "Un atleta",
    ignorar: "Si no esperabas este correo, puedes ignorarlo: no se hará nada en tu nombre.",
    enlaceAlternativo: "Si el botón no funciona, copia este enlace en tu navegador:",
    pie: "Este mensaje se envió automáticamente. No respondas a este correo.",
    evento: "Competencia",
    categoria: "Categoría",
    equipo: "Equipo",
    monto: "Monto",
  },
  invitacion_equipo: {
    asunto: "{quien} te invitó a competir en {evento}",
    titulo: "Te invitaron a un equipo",
    cuerpo:
      "{quien} te sumó a su equipo en {evento}. Para completar la inscripción, entra con este mismo correo, revisa tus datos y acepta los términos.",
    boton: "Completar mi inscripción",
  },
  inscripcion_confirmada: {
    asunto: "Inscripción confirmada: {evento}",
    titulo: "¡Estás inscrito!",
    cuerpo:
      "Tu inscripción en {evento} quedó confirmada. Desde el enlace de abajo puedes ver el detalle cuando quieras.",
    boton: "Ver mi inscripción",
  },
  pago_recibido: {
    asunto: "Recibimos tu pago: {evento}",
    titulo: "Pago recibido",
    cuerpo: "Registramos tu pago de {monto} para {evento}. ¡Gracias!",
    boton: "Ver mi inscripción",
  },
  invitacion_staff: {
    asunto: "Te invitaron a {evento}",
    titulo: "Te invitaron a colaborar",
    cuerpo:
      "{quien} te agregó como juez de {evento}. El día de la competencia, entra con este correo y elige tu carril desde la sección Juzgar.",
    boton: "Ir a Juzgar",
    cuerpoColaborador:
      "{quien} te agregó como colaborador de {evento}. Entra con este correo para ver el panel de la competencia.",
    botonColaborador: "Abrir el panel",
    sinCuenta: "Si todavía no tienes cuenta, crea una con este mismo correo.",
  },
  juez_aprobado: {
    asunto: "Tu postulación como juez fue aprobada: {evento}",
    titulo: "Postulación aprobada",
    cuerpo:
      "La organización de {evento} aprobó tu postulación como juez. Ya puedes tomar un carril desde la sección Juzgar.",
    boton: "Ir a Juzgar",
  },
};

const pt: Textos = {
  comun: {
    saludo: "Olá,",
    alguien: "Um atleta",
    ignorar: "Se você não esperava este e-mail, pode ignorá-lo: nada será feito em seu nome.",
    enlaceAlternativo: "Se o botão não funcionar, copie este link no seu navegador:",
    pie: "Esta mensagem foi enviada automaticamente. Não responda a este e-mail.",
    evento: "Competição",
    categoria: "Categoria",
    equipo: "Equipe",
    monto: "Valor",
  },
  invitacion_equipo: {
    asunto: "{quien} convidou você para competir em {evento}",
    titulo: "Você foi convidado para uma equipe",
    cuerpo:
      "{quien} adicionou você à equipe em {evento}. Para concluir a inscrição, entre com este mesmo e-mail, confira seus dados e aceite os termos.",
    boton: "Concluir minha inscrição",
  },
  inscripcion_confirmada: {
    asunto: "Inscrição confirmada: {evento}",
    titulo: "Você está inscrito!",
    cuerpo:
      "Sua inscrição em {evento} foi confirmada. Pelo link abaixo você pode ver os detalhes quando quiser.",
    boton: "Ver minha inscrição",
  },
  pago_recibido: {
    asunto: "Recebemos seu pagamento: {evento}",
    titulo: "Pagamento recebido",
    cuerpo: "Registramos seu pagamento de {monto} para {evento}. Obrigado!",
    boton: "Ver minha inscrição",
  },
  invitacion_staff: {
    asunto: "Você foi convidado para {evento}",
    titulo: "Você foi convidado para colaborar",
    cuerpo:
      "{quien} adicionou você como juiz de {evento}. No dia da competição, entre com este e-mail e escolha sua raia na seção Julgar.",
    boton: "Ir para Julgar",
    cuerpoColaborador:
      "{quien} adicionou você como colaborador de {evento}. Entre com este e-mail para ver o painel da competição.",
    botonColaborador: "Abrir o painel",
    sinCuenta: "Se você ainda não tem conta, crie uma com este mesmo e-mail.",
  },
  juez_aprobado: {
    asunto: "Sua candidatura a juiz foi aprovada: {evento}",
    titulo: "Candidatura aprovada",
    cuerpo:
      "A organização de {evento} aprovou sua candidatura a juiz. Agora você já pode assumir uma raia na seção Julgar.",
    boton: "Ir para Julgar",
  },
};

const en: Textos = {
  comun: {
    saludo: "Hi,",
    alguien: "An athlete",
    ignorar: "If you weren't expecting this email, you can ignore it: nothing will be done on your behalf.",
    enlaceAlternativo: "If the button doesn't work, copy this link into your browser:",
    pie: "This message was sent automatically. Please don't reply to this email.",
    evento: "Event",
    categoria: "Division",
    equipo: "Team",
    monto: "Amount",
  },
  invitacion_equipo: {
    asunto: "{quien} invited you to compete in {evento}",
    titulo: "You've been invited to a team",
    cuerpo:
      "{quien} added you to their team for {evento}. To finish the registration, sign in with this same email, review your details and accept the terms.",
    boton: "Complete my registration",
  },
  inscripcion_confirmada: {
    asunto: "Registration confirmed: {evento}",
    titulo: "You're in!",
    cuerpo: "Your registration for {evento} is confirmed. Use the link below to see the details any time.",
    boton: "View my registration",
  },
  pago_recibido: {
    asunto: "We received your payment: {evento}",
    titulo: "Payment received",
    cuerpo: "We recorded your payment of {monto} for {evento}. Thank you!",
    boton: "View my registration",
  },
  invitacion_staff: {
    asunto: "You've been invited to {evento}",
    titulo: "You've been invited to help out",
    cuerpo:
      "{quien} added you as a judge for {evento}. On competition day, sign in with this email and pick your lane from the Judge section.",
    boton: "Go to Judge",
    cuerpoColaborador:
      "{quien} added you as a collaborator for {evento}. Sign in with this email to see the event dashboard.",
    botonColaborador: "Open the dashboard",
    sinCuenta: "If you don't have an account yet, create one with this same email.",
  },
  juez_aprobado: {
    asunto: "Your judge application was approved: {evento}",
    titulo: "Application approved",
    cuerpo:
      "The organizers of {evento} approved your application as a judge. You can now take a lane from the Judge section.",
    boton: "Go to Judge",
  },
};

export const TEXTOS: Record<Idioma, Textos> = { es, pt, en };

/** `{nombre}` -> valor. Lo que falta queda tal cual: se nota en el correo de prueba. */
export function interpolar(plantilla: string, vars: Record<string, string>): string {
  return plantilla.replace(/\{(\w+)\}/g, (crudo, nombre: string) =>
    nombre in vars ? vars[nombre] : crudo,
  );
}
