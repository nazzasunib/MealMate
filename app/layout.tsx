import type { Metadata, Viewport } from "next";
import "./legacy.css";
import "./mealmate.css";

export const metadata: Metadata = {
  title: { default: "MealMate", template: "%s · MealMate" },
  description: "Simple Meals. Clear Money. Better Mess. — shared meal, bazar and money tracking for your mess.",
  icons: { icon: "/logo-icon.png", apple: "/logo-icon.png" },
  applicationName: "MealMate",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1f4b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preload" href="/fonts/inter-2.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="h-full bg-background">{children}</body>
    </html>
  );
}
