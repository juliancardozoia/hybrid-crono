/**
 * La carcasa comun de todos los correos.
 *
 * HTML de tabla con estilos en linea, a proposito: los clientes de correo
 * (Outlook sobre todo) ignoran hojas de estilo, flexbox y grid. Sin imagenes
 * ni fuentes externas: un correo que depende de cargar recursos aparece con
 * huecos cuando el cliente los bloquea, que es lo normal.
 */

export interface Carcasa {
  titulo: string;
  saludo: string;
  cuerpo: string;
  detalles: Array<[string, string]>;
  boton: { texto: string; url: string };
  nota?: string;
  enlaceAlternativo: string;
  ignorar: string;
  pie: string;
}

/** Escapa lo que viene de la base (nombres que escribio una persona). */
export function esc(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TINTA = "#111827";
const APAGADO = "#6b7280";
const ACENTO = "#a3e635";

export function renderHtml(c: Carcasa): string {
  const detalles = c.detalles
    .map(
      ([etiqueta, valor]) =>
        `<tr><td style="padding:6px 0;color:${APAGADO};font-size:13px;width:110px;vertical-align:top">${esc(etiqueta)}</td>` +
        `<td style="padding:6px 0;color:${TINTA};font-size:14px;font-weight:600">${esc(valor)}</td></tr>`,
    )
    .join("");

  const nota = c.nota
    ? `<p style="margin:16px 0 0;color:${APAGADO};font-size:13px;line-height:1.5">${esc(c.nota)}</p>`
    : "";

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0b0b0c;padding:18px 28px;color:#ffffff;font-size:20px;font-weight:700">Scora<span style="color:${ACENTO}">.</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 14px;color:${TINTA};font-size:22px;line-height:1.25">${esc(c.titulo)}</h1>
<p style="margin:0 0 6px;color:${TINTA};font-size:15px;line-height:1.55">${esc(c.saludo)}</p>
<p style="margin:0 0 18px;color:${TINTA};font-size:15px;line-height:1.55">${esc(c.cuerpo)}</p>
${detalles ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;width:100%">${detalles}</table>` : ""}
<a href="${esc(c.boton.url)}" style="display:inline-block;background:${ACENTO};color:#111827;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:8px">${esc(c.boton.texto)}</a>
${nota}
<p style="margin:22px 0 0;color:${APAGADO};font-size:12px;line-height:1.5">${esc(c.enlaceAlternativo)}<br><a href="${esc(c.boton.url)}" style="color:${APAGADO};word-break:break-all">${esc(c.boton.url)}</a></p>
</td></tr>
<tr><td style="padding:16px 28px;background:#f9fafb;color:${APAGADO};font-size:12px;line-height:1.5">${esc(c.ignorar)}<br>${esc(c.pie)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** La version en texto plano: hay clientes y filtros de spam que la piden. */
export function renderTexto(c: Carcasa): string {
  const detalles = c.detalles.map(([e, v]) => `${e}: ${v}`).join("\n");
  return [
    c.titulo,
    "",
    c.saludo,
    c.cuerpo,
    detalles ? `\n${detalles}` : "",
    c.nota ? `\n${c.nota}` : "",
    `\n${c.boton.texto}: ${c.boton.url}`,
    "",
    c.ignorar,
    c.pie,
  ]
    .filter((l, i, todas) => !(l === "" && todas[i - 1] === ""))
    .join("\n");
}
