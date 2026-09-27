import type { Metadata, Viewport } from "next";
import "./legacy.css";
import "./mealmate.css";
import "./fixes.css";
import "./app-mode.css";

/* Android app detection, run before first paint so the phone never flashes the
   website layout. The MealMate APK appends "MealMateApp" to its user agent
   (capacitor.config.json → appendUserAgent); older APKs are recognised by the
   Capacitor bridge; "?app=1" lets us preview app mode in a normal browser.
   Only then does <html> get the "mm-app" class — the website is unaffected. */
const APP_MODE_SCRIPT = `(function(){try{var d=document.documentElement,ua=navigator.userAgent||"",q=/[?&]app=(1|0)\\b/.exec(location.search);if(q){try{q[1]==="1"?localStorage.setItem("mm-app-mode","1"):localStorage.removeItem("mm-app-mode")}catch(e){}}var saved=false;try{saved=localStorage.getItem("mm-app-mode")==="1"}catch(e){}var cap=window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform();if(ua.indexOf("MealMateApp")>=0||cap||saved)d.classList.add("mm-app")}catch(e){}})();`;

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
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/inter-2.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: APP_MODE_SCRIPT }} />
      </head>
      <body className="h-full bg-background">{children}</body>
    </html>
  );
}
