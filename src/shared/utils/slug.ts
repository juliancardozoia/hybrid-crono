/**
 * Slugs para URLs publicas.
 *
 * Tiene que coincidir con el check de la base: ^[a-z0-9-]{2,48}$ para
 * organizaciones y ^[a-z0-9-]{4,64}$ para eventos. Si esto genera algo que la
 * base rechaza, el usuario ve un error de constraint sin sentido.
 */
export function slugify(input: string, opts?: { maxLength?: number }): string {
  const maxLength = opts?.maxLength ?? 48;

  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // saca tildes: "Bogotá" -> "Bogota"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/** Agrega un sufijo corto para desempatar slugs repetidos. */
export function slugWithSuffix(input: string, maxLength = 64): string {
  const suffix = Math.random().toString(36).slice(2, 6);
  const base = slugify(input, { maxLength: maxLength - suffix.length - 1 });
  return base ? `${base}-${suffix}` : suffix;
}
