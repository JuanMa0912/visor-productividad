import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// ============================================================================
// CONFIGURACI?"N DE FUENTES
// ============================================================================

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

// ============================================================================
// METADATA Y SEO
// ============================================================================

export const metadata: Metadata = {
  title: {
    default: "Portal de Inteligencia de Datos - UAID",
    template: "%s | UAID Mercamio",
  },
  description:
    "Portal de Inteligencia de Datos de la UAID para consultar productividad, margenes, horarios y ventas por item.",
  keywords: [
    "productividad",
    "analitica",
    "ventas",
    "margenes",
    "portal de inteligencia",
    "uaid",
    "mercamio",
  ],
  authors: [{ name: "Mercamio" }],
  creator: "UAID Mercamio",
  publisher: "UAID Mercamio",
  referrer: "strict-origin-when-cross-origin",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    locale: "es_CO",
    title: "Portal de Inteligencia de Datos - UAID",
    description:
      "Portal de Inteligencia de Datos para consulta operativa y analitica de Mercamio.",
    siteName: "UAID Mercamio",
  },
  twitter: {
    card: "summary_large_image",
    title: "Portal de Inteligencia de Datos - UAID",
    description:
      "Portal de Inteligencia de Datos para consulta operativa y analitica de Mercamio.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

// ============================================================================
// LAYOUT PRINCIPAL
// ============================================================================

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background text-foreground antialiased`}
      >
        <main>{children}</main>
      </body>
    </html>
  );
}
