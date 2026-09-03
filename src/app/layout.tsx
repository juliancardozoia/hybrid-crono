import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ProveedorDeCarga } from "@/shared/components/Carga";
import { ProveedorDeNotificaciones } from "@/shared/components/Notificaciones";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  // La pantalla del juez se toca a ciegas: que un pinch accidental cambie el zoom
  // en medio de una carrera es un error real, no una molestia estetica.
  userScalable: false,
  initialScale: 1,
  maximumScale: 1,
  width: "device-width",
};

export const metadata: Metadata = {
  title: "Scora",
  description: "Cronometraje de competencias por tiempo.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Scora",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Montados UNA vez arriba de toda la app: el overlay de carga y los
            toasts quedan disponibles en cualquier pantalla sin que cada una
            arme los suyos. Son inertes hasta que algo los llama — la app del
            juez (offline-first a proposito) simplemente no lo hace. */}
        <ProveedorDeCarga>
          <ProveedorDeNotificaciones>{children}</ProveedorDeNotificaciones>
        </ProveedorDeCarga>
      </body>
    </html>
  );
}
