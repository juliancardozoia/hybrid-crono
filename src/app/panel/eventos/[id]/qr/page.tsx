import Link from "next/link";
import { getTeams } from "@/features/events/config/queries";
import { requireEventAccess } from "@/features/events/lib/access";
import { publicUrl, qrSvg } from "@/features/leaderboard/lib/qr";

export const metadata = { title: "QR de atletas — Scora" };

export default async function QrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event } = await requireEventAccess(id);

  const teams = await getTeams(id);
  const urlEvento = publicUrl(`/en-vivo/${event.public_slug}`);

  const tarjetas = await Promise.all(
    teams.map(async (t) => ({
      bib: t.bib_number,
      nombre:
        t.name ?? t.members.map((m) => `${m.first_name} ${m.last_name}`).join(" / ") ?? "—",
      division: t.divisionName,
      svg: await qrSvg(publicUrl(`/en-vivo/${event.public_slug}/atleta/${t.bib_number}`), 150),
    })),
  );

  const svgEvento = await qrSvg(urlEvento, 220);

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <p className="text-sm text-neutral-500">
          Una tarjeta por dorsal. Cada QR lleva al atleta directo a su tiempo, sus parciales y su
          posición. Imprime esta página y pega las tarjetas en los dorsales o en la pizarra.
        </p>
        {teams.length === 0 && (
          <p className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            Todavía no hay atletas cargados.{" "}
            <Link href={`/panel/eventos/${id}/atletas`} className="underline">
              Ir a atletas
            </Link>
          </p>
        )}
      </div>

      <section className="rounded-2xl border border-neutral-800 p-5 print:border-0">
        <h2 className="mb-3 font-semibold">Leaderboard del evento</h2>
        <div className="flex flex-wrap items-center gap-5">
          <div
            className="h-[220px] w-[220px] shrink-0 rounded-lg bg-white p-2"
            dangerouslySetInnerHTML={{ __html: svgEvento }}
          />
          <div className="min-w-0">
            <p className="font-medium">{event.name}</p>
            <p className="mt-1 text-sm break-all text-neutral-500">{urlEvento}</p>
            <p className="mt-3 text-xs text-neutral-600">
              Pegalo en la entrada: cualquiera con el celular ve los resultados en vivo.
            </p>
          </div>
        </div>
      </section>

      {tarjetas.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold print:hidden">Tarjetas por dorsal</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3">
            {tarjetas.map((t) => (
              <div
                key={t.bib}
                className="flex flex-col items-center rounded-xl border border-neutral-800 p-3 text-center break-inside-avoid print:border-neutral-400"
              >
                <div
                  className="h-[150px] w-[150px] rounded bg-white p-1.5"
                  dangerouslySetInnerHTML={{ __html: t.svg }}
                />
                <p className="mt-2 font-mono text-2xl font-black tabular-nums print:text-black">
                  #{t.bib}
                </p>
                <p className="text-xs leading-tight text-neutral-400 print:text-neutral-700">
                  {t.nombre}
                </p>
                <p className="text-[10px] text-neutral-600">{t.division}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
