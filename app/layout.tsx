import type { Metadata, Viewport } from "next";
import "./legacy.css";
import "./mealmate.css";
import "./fixes.css";
import "./app-mode.css";

/* Android app detection, run before first paint so the phone never flashes the
   website layout. The MealMate APK appends "MealMateApp" to its user agent
   (capacitor.config.json → appendUserAgent); older APKs are recognised by the
   Capacitor bridge; "?app=1" lets us preview app mode in a normal browser.
   iPhone: MealMate added to the home screen from Safari opens full screen
   ("standalone") and gets the same app layout; there we also let the page use
   the whole screen (viewport-fit=cover) so the bottom bar sits above the home
   indicator. Only then does <html> get the "mm-app" class — the website in a
   normal browser tab is unaffected. The same script applies the saved
   light/dark theme ("mm-theme") so dark mode never flashes white, and
   registers the offline service worker (public/sw.js), telling it which app
   files this page loaded so they are kept for offline use. */
const APP_MODE_SCRIPT = `(function(){try{var d=document.documentElement,ua=navigator.userAgent||"",q=/[?&]app=(1|0)\\b/.exec(location.search);if(q){try{q[1]==="1"?localStorage.setItem("mm-app-mode","1"):localStorage.removeItem("mm-app-mode")}catch(e){}}var saved=false;try{saved=localStorage.getItem("mm-app-mode")==="1"}catch(e){}var cap=window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform();var home=false;try{home=navigator.standalone===true||window.matchMedia("(display-mode: standalone)").matches}catch(e){}if(ua.indexOf("MealMateApp")>=0||cap||saved||home)d.classList.add("mm-app");if(home){var fit=function(){var m=document.querySelector('meta[name="viewport"]');if(m&&m.content.indexOf("viewport-fit")<0)m.content+=", viewport-fit=cover"};fit();document.addEventListener("DOMContentLoaded",fit)}}catch(e){}try{var tm=localStorage.getItem("mm-theme");if(tm==="dark"||(tm==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("mm-dark")}catch(e){}try{if("serviceWorker" in navigator&&(location.protocol==="https:"||location.hostname==="localhost")){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").then(function(){return navigator.serviceWorker.ready}).then(function(reg){var send=function(){try{var u=performance.getEntriesByType("resource").map(function(e){return e.name}).filter(function(n){return n.indexOf(location.origin+"/")===0});u.push(location.pathname);if(reg.active)reg.active.postMessage({type:"cache-urls",urls:u})}catch(e){}};setTimeout(send,3000);setTimeout(send,15000)})["catch"](function(){})})}}catch(e){}})();`;

export const metadata: Metadata = {
  title: { default: "MealMate", template: "%s · MealMate" },
  description: "Simple Meals. Clear Money. Better Mess. — shared meal, bazar and money tracking for your mess.",
  icons: { icon: "/logo-icon.png", apple: "/apple-touch-icon.png" },
  applicationName: "MealMate",
  appleWebApp: { capable: true, title: "MealMate", statusBarStyle: "default" },
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
        {/* older iPhones (iOS < 16.4) only open full screen with this tag */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="h-full bg-background">{children}</body>
    </html>
  );
}
