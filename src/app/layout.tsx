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
    default: "Visualizador de Productividad - Mercamio",
    template: "%s | Mercamio",
  },
  description:
    "Panel diario de productividad por línea. Analiza ventas por sede en tiempo real.",
  keywords: [
    "productividad",
    "análisis",
    "ventas",
    "márgenes",
    "dashboard",
    "mercamio",
  ],
  authors: [{ name: "Mercamio" }],
  creator: "Mercamio",
  publisher: "Mercamio",
  referrer: "strict-origin-when-cross-origin",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    locale: "es_CO",
    title: "Visualizador de Productividad - Mercamio",
    description:
      "Panel diario de productividad por línea. Analiza ventas por sede.",
    siteName: "Mercamio",
  },
  twitter: {
    card: "summary_large_image",
    title: "Visualizador de Productividad - Mercamio",
    description:
      "Panel diario de productividad por línea. Analiza ventas por sede.",
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

