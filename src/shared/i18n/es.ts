/**
 * Español neutro.
 *
 * NEUTRO SIGNIFICA TUTEO, NUNCA VOSEO NI "USTED".
 *
 * "Inscribite" y "seguí" suenan a Buenos Aires; "inscríbase" suena a formulario
 * de banco. "Inscríbete" y "sigue" se leen igual de naturales en Bogotá, Ciudad
 * de México, Lima y Santiago, que es donde esta la gente. Es la misma decision
 * que toma cualquier producto que cruza la region.
 *
 * Vale tambien para el portugues y el ingles: mismo registro, ni formal ni
 * coloquial de un solo pais.
 *
 * Este archivo es la FUENTE de las claves: los otros dos idiomas se tipan
 * contra el, asi que olvidarse de traducir algo es un error de compilacion y no
 * un texto en español apareciendo en medio del ingles.
 */

export const es = {
  // --- Encabezado y cuenta --------------------------------------------------
  "cuenta.mi": "Mi cuenta",
  "cuenta.panel": "Panel Organizador",
  "cuenta.inscripciones": "Mi Perfil",
  "cuenta.juzgar": "Juzgar",
  "cuenta.salir": "Cerrar sesión",
  "cuenta.idioma": "Idioma",

  // --- Portada --------------------------------------------------------------
  "inicio.titulo": "Competencias Fitness",
  "inicio.subtitulo": "CrossFit y carreras híbridas en Latinoamérica.",
  "inicio.destacadas": "Destacadas",
  "inicio.proximas": "Próximas competencias",
  "inicio.resultados": "Resultados",
  "inicio.contador.una": "1 competencia",
  "inicio.contador.varias": "{n} competencias",
  "inicio.vacio.sinFiltros": "Todavía no hay competencias publicadas.",
  "inicio.vacio.conFiltros": "No encontramos competencias con esos filtros.",
  "inicio.vacio.invitacion": "¿Organizas una? Crearla y publicarla es gratis.",
  "inicio.vistos": "Vistos recientemente",
  "inicio.pie.juez": "¿Eres juez?",
  "inicio.pie.juezLink": "Entra a tu carril",

  // --- Filtros --------------------------------------------------------------
  "filtros.buscar": "Buscar por nombre, ciudad, sede u organizador",
  "filtros.buscarBoton": "Buscar",
  "filtros.pais": "País",
  "filtros.mes": "Mes",
  "filtros.anio": "Año",
  "filtros.formato": "Formato",
  "filtros.todos": "Todos",
  "filtros.sinPaises": "Sin competencias aún",
  "filtros.limpiar": "Limpiar filtros",

  // --- Tarjeta de evento ----------------------------------------------------
  "evento.ver": "Ver competencia",
  "evento.abiertas": "Inscripciones abiertas",
  "evento.cerradas": "Inscripciones cerradas",
  "evento.cierran": "Cierran en {n} días",
  "evento.cierranHoy": "Último día para inscribirse",
  "evento.cierranManiana": "Cierran mañana",
  "evento.abren": "Abren en {n} días",
  "evento.fecha": "Fecha",
  "evento.lugar": "Lugar",
  "evento.inscripcion": "Inscripción",
  "evento.hasta": "hasta el {fecha}",
  "evento.virtual": "Virtual",
  "evento.faltan": "Faltan {n} días",
  "evento.esHoy": "Es hoy",
  "evento.esManiana": "Es mañana",
  "evento.termino": "Terminó",

  // --- Formatos -------------------------------------------------------------
  "formato.crossfit": "CrossFit",
  "formato.carrera_hibrida": "Carrera Híbrida",
  "formato.mixto": "Mixto",

  // --- Meses ----------------------------------------------------------------
  "mes.1": "Enero",
  "mes.2": "Febrero",
  "mes.3": "Marzo",
  "mes.4": "Abril",
  "mes.5": "Mayo",
  "mes.6": "Junio",
  "mes.7": "Julio",
  "mes.8": "Agosto",
  "mes.9": "Septiembre",
  "mes.10": "Octubre",
  "mes.11": "Noviembre",
  "mes.12": "Diciembre",

  // --- Pantallas de cuenta --------------------------------------------------
  "auth.entrar.titulo": "Entrar",
  "auth.entrar.subtitulo": "Tu cuenta sirve para competir, juzgar y organizar.",
  "auth.registro.titulo": "Crea tu cuenta",
  "auth.registro.subtitulo":
    "Con datos mínimos. El resto del perfil se completa después, cuando haga falta.",
  "auth.google": "Continuar con Google",
  "auth.googleAbriendo": "Abriendo Google…",
  "auth.googleError": "No se pudo abrir el ingreso con Google. Prueba con tu email y contraseña.",
  "auth.separador": "o con tu email",
  "auth.email": "Email",
  "auth.emailEjemplo": "tu@correo.com",
  "auth.clave": "Contraseña",
  "auth.claveNueva": "Contraseña nueva",
  "auth.claveRepetir": "Repítela",
  "auth.clavePista": "Al menos 8 caracteres.",
  "auth.claveVer": "Ver",
  "auth.claveOcultar": "Ocultar",
  "auth.olvide": "Olvidé mi contraseña",
  "auth.botonEntrar": "Entrar",
  "auth.botonRegistro": "Crear cuenta",
  "auth.espera": "Un momento…",
  "auth.sinCuenta": "¿Todavía no tienes cuenta?",
  "auth.sinCuentaLink": "Crea una gratis",
  "auth.conCuenta": "¿Ya tienes cuenta?",
  "auth.conCuentaLink": "Entra",
  "auth.terminos":
    "Al crear la cuenta aceptas los términos del servicio. Puedes competir, juzgar u organizar con la misma cuenta.",
  "auth.recuperar.titulo": "Recuperar contraseña",
  "auth.recuperar.subtitulo": "Te enviamos un enlace al correo para elegir una nueva.",
  "auth.recuperar.boton": "Enviar el enlace",
  "auth.recuperar.volver": "Volver a entrar",
  "auth.nueva.titulo": "Elige tu contraseña",
  "auth.nueva.subtitulo": "La anterior deja de funcionar apenas guardes esta.",
  "auth.nueva.boton": "Guardar y entrar",

  // --- Argumentos de la pantalla de cuenta ----------------------------------
  "marca.lema": "La plataforma de competencias de fitness de Latinoamérica.",
  "marca.gratis": "Crear tu competencia es gratis. Se paga solo si quieres mostrarla al mundo.",
  "marca.p1.titulo": "Cronómetro que no pierde tiempos",
  "marca.p1.detalle":
    "El juez marca desde el celular. Si se cae el internet, si cierra la app o si se reinicia el teléfono, la marca sigue ahí.",
  "marca.p2.titulo": "Resultados que se derivan solos",
  "marca.p2.detalle":
    "El tiempo total sale de los parciales, no de una planilla que alguien transcribe a Excel a las once de la noche.",
  "marca.p3.titulo": "CrossFit y carreras híbridas",
  "marca.p3.detalle":
    "Un AMRAP, un For Time con cap, una carga máxima o un circuito de ocho estaciones. La misma app.",
} as const;

export type ClaveDeTexto = keyof typeof es;
export type Diccionario = Record<ClaveDeTexto, string>;
