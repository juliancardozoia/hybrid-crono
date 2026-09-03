/**
 * Português do Brasil, em registro neutro.
 *
 * Nem "você" coloquial de uma regiao nem o formal de documento: o registro que
 * qualquer brasileiro le sem notar de onde vem, que e a mesma regra do espanhol
 * neutro.
 *
 * O tipo `Diccionario` obriga a ter TODAS as chaves: esquecer uma e um erro de
 * compilacao, e nao um texto em espanhol aparecendo no meio do portugues.
 */

import type { Diccionario } from "./es";

export const pt: Diccionario = {
  // --- Cabeçalho e conta ----------------------------------------------------
  "cuenta.mi": "Minha conta",
  "cuenta.panel": "Meu painel",
  "cuenta.inscripciones": "Meu perfil",
  "cuenta.juzgar": "Julgar",
  "cuenta.salir": "Sair",
  "cuenta.idioma": "Idioma",

  // --- Página inicial -------------------------------------------------------
  "inicio.titulo": "Competições de fitness",
  "inicio.subtitulo": "CrossFit e corridas híbridas na América Latina.",
  "inicio.destacadas": "Em destaque",
  "inicio.proximas": "Próximas competições",
  "inicio.resultados": "Resultados",
  "inicio.contador.una": "1 competição",
  "inicio.contador.varias": "{n} competições",
  "inicio.vacio.sinFiltros": "Ainda não há competições publicadas.",
  "inicio.vacio.conFiltros": "Não encontramos competições com esses filtros.",
  "inicio.vacio.invitacion": "Organiza uma? Criar e publicar é grátis.",
  "inicio.vistos": "Vistos recentemente",
  "inicio.pie.juez": "Você é juiz?",
  "inicio.pie.juezLink": "Entre na sua raia",

  // --- Filtros --------------------------------------------------------------
  "filtros.buscar": "Buscar por nome, cidade, local ou organizador",
  "filtros.buscarBoton": "Buscar",
  "filtros.pais": "País",
  "filtros.mes": "Mês",
  "filtros.anio": "Ano",
  "filtros.formato": "Formato",
  "filtros.todos": "Todos",
  "filtros.sinPaises": "Ainda sem competições",
  "filtros.limpiar": "Limpar filtros",

  // --- Cartão do evento -----------------------------------------------------
  "evento.ver": "Ver competição",
  "evento.abiertas": "Inscrições abertas",
  "evento.cerradas": "Inscrições encerradas",
  "evento.cierran": "Encerram em {n} dias",
  "evento.cierranHoy": "Último dia para se inscrever",
  "evento.cierranManiana": "Encerram amanhã",
  "evento.abren": "Abrem em {n} dias",
  "evento.fecha": "Data",
  "evento.lugar": "Local",
  "evento.inscripcion": "Inscrição",
  "evento.hasta": "até {fecha}",
  "evento.virtual": "Virtual",
  "evento.faltan": "Faltam {n} dias",
  "evento.esHoy": "É hoje",
  "evento.esManiana": "É amanhã",
  "evento.termino": "Encerrada",

  // --- Formatos -------------------------------------------------------------
  "formato.crossfit": "CrossFit",
  "formato.carrera_hibrida": "Corrida híbrida",
  "formato.mixto": "Misto",

  // --- Meses ----------------------------------------------------------------
  "mes.1": "Janeiro",
  "mes.2": "Fevereiro",
  "mes.3": "Março",
  "mes.4": "Abril",
  "mes.5": "Maio",
  "mes.6": "Junho",
  "mes.7": "Julho",
  "mes.8": "Agosto",
  "mes.9": "Setembro",
  "mes.10": "Outubro",
  "mes.11": "Novembro",
  "mes.12": "Dezembro",

  // --- Telas de conta -------------------------------------------------------
  "auth.entrar.titulo": "Entrar",
  "auth.entrar.subtitulo": "Sua conta serve para competir, julgar e organizar.",
  "auth.registro.titulo": "Crie sua conta",
  "auth.registro.subtitulo":
    "Com dados mínimos. O resto do perfil você completa depois, quando precisar.",
  "auth.google": "Continuar com o Google",
  "auth.googleAbriendo": "Abrindo o Google…",
  "auth.googleError": "Não foi possível abrir o acesso com o Google. Use seu e-mail e senha.",
  "auth.separador": "ou com seu e-mail",
  "auth.email": "E-mail",
  "auth.emailEjemplo": "voce@email.com",
  "auth.clave": "Senha",
  "auth.claveNueva": "Nova senha",
  "auth.claveRepetir": "Repita",
  "auth.clavePista": "Pelo menos 8 caracteres.",
  "auth.claveVer": "Mostrar",
  "auth.claveOcultar": "Ocultar",
  "auth.olvide": "Esqueci minha senha",
  "auth.botonEntrar": "Entrar",
  "auth.botonRegistro": "Criar conta",
  "auth.espera": "Um momento…",
  "auth.sinCuenta": "Ainda não tem conta?",
  "auth.sinCuentaLink": "Crie uma grátis",
  "auth.conCuenta": "Já tem conta?",
  "auth.conCuentaLink": "Entre",
  "auth.terminos":
    "Ao criar a conta você aceita os termos do serviço. Pode competir, julgar ou organizar com a mesma conta.",
  "auth.recuperar.titulo": "Recuperar senha",
  "auth.recuperar.subtitulo": "Enviamos um link ao seu e-mail para escolher uma nova.",
  "auth.recuperar.boton": "Enviar o link",
  "auth.recuperar.volver": "Voltar para entrar",
  "auth.nueva.titulo": "Escolha sua senha",
  "auth.nueva.subtitulo": "A anterior deixa de funcionar assim que você salvar esta.",
  "auth.nueva.boton": "Salvar e entrar",

  // --- Argumentos da tela de conta ------------------------------------------
  "marca.lema": "A plataforma de competições de fitness da América Latina.",
  "marca.gratis": "Criar sua competição é grátis. Você paga só se quiser mostrá-la ao mundo.",
  "marca.p1.titulo": "Cronômetro que não perde tempos",
  "marca.p1.detalle":
    "O juiz marca pelo celular. Se a internet cair, se ele fechar o app ou se o telefone reiniciar, a marca continua lá.",
  "marca.p2.titulo": "Resultados que se calculam sozinhos",
  "marca.p2.detalle":
    "O tempo total sai das parciais, não de uma planilha que alguém transcreve para o Excel às onze da noite.",
  "marca.p3.titulo": "CrossFit e corridas híbridas",
  "marca.p3.detalle":
    "Um AMRAP, um For Time com cap, uma carga máxima ou um circuito de oito estações. O mesmo app.",
};
