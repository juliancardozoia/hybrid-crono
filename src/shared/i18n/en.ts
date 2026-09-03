/**
 * US English, in the same neutral register as the other two.
 *
 * Plain and direct, no regional slang and no corporate padding. The `Diccionario`
 * type requires EVERY key, so a missing translation is a compile error instead
 * of Spanish showing up in the middle of an English page.
 */

import type { Diccionario } from "./es";

export const en: Diccionario = {
  // --- Header and account ---------------------------------------------------
  "cuenta.mi": "My account",
  "cuenta.panel": "My dashboard",
  "cuenta.inscripciones": "My profile",
  "cuenta.juzgar": "Judge",
  "cuenta.salir": "Sign out",
  "cuenta.idioma": "Language",

  // --- Home -----------------------------------------------------------------
  "inicio.titulo": "Fitness competitions",
  "inicio.subtitulo": "CrossFit and hybrid races across Latin America.",
  "inicio.destacadas": "Featured",
  "inicio.proximas": "Upcoming competitions",
  "inicio.resultados": "Results",
  "inicio.contador.una": "1 competition",
  "inicio.contador.varias": "{n} competitions",
  "inicio.vacio.sinFiltros": "No competitions published yet.",
  "inicio.vacio.conFiltros": "No competitions match those filters.",
  "inicio.vacio.invitacion": "Running one? Creating and publishing it is free.",
  "inicio.vistos": "Recently viewed",
  "inicio.pie.juez": "Judging today?",
  "inicio.pie.juezLink": "Go to your lane",

  // --- Filters --------------------------------------------------------------
  "filtros.buscar": "Search by name, city, venue or organizer",
  "filtros.buscarBoton": "Search",
  "filtros.pais": "Country",
  "filtros.mes": "Month",
  "filtros.anio": "Year",
  "filtros.formato": "Format",
  "filtros.todos": "All",
  "filtros.sinPaises": "No competitions yet",
  "filtros.limpiar": "Clear filters",

  // --- Event card -----------------------------------------------------------
  "evento.ver": "View competition",
  "evento.abiertas": "Registration open",
  "evento.cerradas": "Registration closed",
  "evento.cierran": "Closes in {n} days",
  "evento.cierranHoy": "Last day to register",
  "evento.cierranManiana": "Closes tomorrow",
  "evento.abren": "Opens in {n} days",
  "evento.fecha": "Date",
  "evento.lugar": "Location",
  "evento.inscripcion": "Registration",
  "evento.hasta": "until {fecha}",
  "evento.virtual": "Online",
  "evento.faltan": "In {n} days",
  "evento.esHoy": "Today",
  "evento.esManiana": "Tomorrow",
  "evento.termino": "Finished",

  // --- Formats --------------------------------------------------------------
  "formato.crossfit": "CrossFit",
  "formato.carrera_hibrida": "Hybrid Race",
  "formato.mixto": "Mixed",

  // --- Months ---------------------------------------------------------------
  "mes.1": "January",
  "mes.2": "February",
  "mes.3": "March",
  "mes.4": "April",
  "mes.5": "May",
  "mes.6": "June",
  "mes.7": "July",
  "mes.8": "August",
  "mes.9": "September",
  "mes.10": "October",
  "mes.11": "November",
  "mes.12": "December",

  // --- Account screens ------------------------------------------------------
  "auth.entrar.titulo": "Sign in",
  "auth.entrar.subtitulo": "One account to compete, judge and organize.",
  "auth.registro.titulo": "Create your account",
  "auth.registro.subtitulo":
    "Just the basics. You can fill in the rest of your profile later, when it matters.",
  "auth.google": "Continue with Google",
  "auth.googleAbriendo": "Opening Google…",
  "auth.googleError": "Couldn't open Google sign-in. Use your email and password instead.",
  "auth.separador": "or with your email",
  "auth.email": "Email",
  "auth.emailEjemplo": "you@email.com",
  "auth.clave": "Password",
  "auth.claveNueva": "New password",
  "auth.claveRepetir": "Repeat it",
  "auth.clavePista": "At least 8 characters.",
  "auth.claveVer": "Show",
  "auth.claveOcultar": "Hide",
  "auth.olvide": "Forgot my password",
  "auth.botonEntrar": "Sign in",
  "auth.botonRegistro": "Create account",
  "auth.espera": "One moment…",
  "auth.sinCuenta": "Don't have an account yet?",
  "auth.sinCuentaLink": "Create one free",
  "auth.conCuenta": "Already have an account?",
  "auth.conCuentaLink": "Sign in",
  "auth.terminos":
    "By creating an account you accept the terms of service. The same account lets you compete, judge or organize.",
  "auth.recuperar.titulo": "Reset your password",
  "auth.recuperar.subtitulo": "We'll email you a link to choose a new one.",
  "auth.recuperar.boton": "Send the link",
  "auth.recuperar.volver": "Back to sign in",
  "auth.nueva.titulo": "Choose your password",
  "auth.nueva.subtitulo": "The old one stops working as soon as you save this.",
  "auth.nueva.boton": "Save and sign in",

  // --- Brand column ---------------------------------------------------------
  "marca.lema": "The fitness competition platform for Latin America.",
  "marca.gratis": "Creating your competition is free. You only pay to show it to the world.",
  "marca.p1.titulo": "A clock that never loses a time",
  "marca.p1.detalle":
    "The judge taps on their phone. If the internet drops, the app closes or the phone reboots, the time is still there.",
  "marca.p2.titulo": "Results that derive themselves",
  "marca.p2.detalle":
    "Total time comes from the splits, not from a paper sheet someone retypes into Excel at eleven at night.",
  "marca.p3.titulo": "CrossFit and hybrid races",
  "marca.p3.detalle":
    "An AMRAP, a For Time with a cap, a max lift or an eight-station circuit. Same app.",
};
