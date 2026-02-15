import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Inline script to set theme before hydration (prevents flash of wrong theme)
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem("theme") || "system";
    var allowed = ["dark", "light", "system"];
    if (allowed.indexOf(stored) === -1) stored = "system";
    var root = document.documentElement;
    if (stored === "system") {
      var dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.add(dark ? "dark" : "light");
    } else {
      root.classList.add(stored);
    }
  } catch (e) { /* Intentional: theme detection must never block page load */ }
})();
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export const metadata: Metadata = {
  title: "Food Logger",
  description: "AI-powered food logging for Fitbit",
  applicationName: "Food Logger",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    title: "Food Logger",
    statusBarStyle: "default",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* SECURITY: themeScript is a static string constant defined in this file.
            No user input flows into it. dangerouslySetInnerHTML is safe here. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
