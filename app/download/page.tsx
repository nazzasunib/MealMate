"use client";
/* Public download page for the Android app: https://<site>/download
   Share THIS link instead of the raw APK link. It
   - detects in-app browsers (Messenger / Facebook / Instagram …) where APK
     downloads often hang, and offers "Open in Chrome";
   - explains Chrome's "Download anyway" prompt — until it's tapped, a finished
     APK download sits at 100% looking frozen;
   - explains the one-time "Install unknown apps" permission;
   - on iPhone/iPad (which can't install APKs) shows how to add MealMate to
     the home screen from Safari instead — it then opens full screen with the
     same app layout. */
import { useEffect, useState } from "react";

const APK_URL = "https://github.com/nazzasunib/MealMate/releases/download/latest-apk/MealMate.apk";
const NAVY = "#0b1f4b";
const GRADIENT = "linear-gradient(135deg, #07142f 0%, #14306e 45%, #2a4a93 60%, #0b1f4b 100%)";

type Env = { inApp: string | null; android: boolean; ios: boolean; safari: boolean; ready: boolean };

function detect(): Env {
  const ua = navigator.userAgent || "";
  let inApp: string | null = null;
  if (/FBAN|FBAV|FB_IAB|FB4A|FBIOS|MESSENGER|Orca-Android/i.test(ua)) inApp = "Messenger / Facebook";
  else if (/Instagram/i.test(ua)) inApp = "Instagram";
  else if (/Line\//i.test(ua)) inApp = "LINE";
  else if (/MicroMessenger/i.test(ua)) inApp = "WeChat";
  else if (/; wv\)/.test(ua) && !/MealMateApp/.test(ua)) inApp = "this app";
  // iPadOS reports itself as a Mac, so also check for a touch screen
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  // Safari itself (not Chrome/Firefox/Edge for iOS, not an in-app browser)
  const safari = ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) && !inApp;
  return { inApp, android: /Android/i.test(ua), ios, safari, ready: true };
}

export default function DownloadPage() {
  const [env, setEnv] = useState<Env>({ inApp: null, android: true, ios: false, safari: false, ready: false });
  useEffect(() => setEnv(detect()), []);

  const chromeIntent =
    typeof window !== "undefined"
      ? `intent://${window.location.host}/download#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(window.location.href)};end`
      : "#";

  return (
    <main style={{ minHeight: "100vh", background: "#f4f6fb", padding: "24px 16px 40px", fontFamily: "inherit", color: "#101828" }}>
      <div style={{ maxWidth: 440, margin: "0 auto" }}>
        <div style={{ background: GRADIENT, borderRadius: 24, padding: "28px 22px", color: "#fff", textAlign: "center", boxShadow: "0 12px 30px rgba(11,31,75,.25)" }}>
          <img src="/logo-icon.png" alt="MealMate" width={72} height={72} style={{ borderRadius: 18, background: "#fff", padding: 6 }} />
          <h1 style={{ margin: "14px 0 4px", fontSize: 24, fontWeight: 700 }}>MealMate for {env.ios ? "iPhone" : "Android"}</h1>
          <p style={{ margin: 0, fontSize: 14, opacity: 0.8 }}>Meals, bazar and money for your mess{env.ios ? "" : " — about 14 MB"}</p>

          {env.ready && env.ios ? (
            <div style={{ marginTop: 20 }}>
              <p style={{ margin: 0, fontSize: 14, background: "rgba(255,255,255,.12)", borderRadius: 12, padding: "10px 12px", lineHeight: 1.45 }}>
                iPhone can’t install the Android file (APK). Add MealMate to your <b>Home Screen</b> instead — it opens full screen like an app, with the same data.
              </p>
            </div>
          ) : env.ready && env.inApp ? (
            <div style={{ marginTop: 20 }}>
              <p style={{ margin: "0 0 12px", fontSize: 14, background: "rgba(255,255,255,.12)", borderRadius: 12, padding: "10px 12px", lineHeight: 1.45 }}>
                You opened this page inside <b>{env.inApp}</b>. Downloads often get stuck here — open it in Chrome first.
              </p>
              <a href={chromeIntent} style={btn("#fff", NAVY)}>Open in Chrome</a>
              <p style={{ margin: "10px 0 0", fontSize: 12, opacity: 0.75 }}>
                Or tap the ⋮ menu at the top and choose “Open in browser”.
              </p>
            </div>
          ) : (
            <div style={{ marginTop: 20 }}>
              <a href={APK_URL} download="MealMate.apk" style={btn("#fff", NAVY)}>
                Download MealMate
              </a>
              {env.ready && !env.android && !env.ios && (
                <p style={{ margin: "10px 0 0", fontSize: 12, opacity: 0.8 }}>This app is for Android phones — open this page on your phone.</p>
              )}
            </div>
          )}
        </div>

        {env.ready && env.ios && (
          <section style={{ marginTop: 16, background: "#fff", borderRadius: 20, padding: "18px 18px 8px", boxShadow: "0 2px 10px rgba(16,24,40,.06)" }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 700, color: NAVY }}>Add to iPhone Home Screen</h2>
            {!env.safari && (
              <div style={{ margin: "0 0 8px", background: "#fff7e6", border: "1px solid #f5c26b", borderRadius: 12, padding: "10px 12px", fontSize: 14, lineHeight: 1.5 }}>
                Open this page in <b>Safari</b> first{env.inApp ? <> (tap ⋯ or the compass icon → “Open in Safari”)</> : null}. Copy the link: <b>{typeof window !== "undefined" ? window.location.host : ""}/download</b>
              </div>
            )}
            <Step n={1} title="Tap the Share button">In Safari, tap <b>Share</b> (the square with an arrow ↑) at the bottom of the screen — or at the top on iPad.</Step>
            <Step n={2} title="Add to Home Screen">Scroll down and tap <b>Add to Home Screen</b>. If you don’t see it, tap <b>Edit Actions</b> and add it.</Step>
            <Step n={3} title="Tap Add">Keep the name “MealMate” and tap <b>Add</b>. The MealMate icon appears on your Home Screen.</Step>
            <Step n={4} title="Open from the icon">Always open MealMate from that icon — it opens full screen with the bottom menu. Log in once; your data is the same as on the website and Android app.</Step>
          </section>
        )}

        {env.ready && !env.inApp && !env.ios && (
          <div style={{ marginTop: 16, background: "#fff7e6", border: "1px solid #f5c26b", borderRadius: 16, padding: "14px 16px", fontSize: 14, lineHeight: 1.5 }}>
            <b>Download looks stuck at 100%?</b> Chrome is waiting for you: look for the message
            “File might be harmful” (at the bottom of Chrome or in the notification bar) and tap <b>Download anyway</b>.
          </div>
        )}

        {!env.ios && <section style={{ marginTop: 16, background: "#fff", borderRadius: 20, padding: "18px 18px 8px", boxShadow: "0 2px 10px rgba(16,24,40,.06)" }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 700, color: NAVY }}>How to install</h2>
          <Step n={1} title="Download">Tap “Download MealMate”. Use Chrome — not the Messenger/Facebook browser.</Step>
          <Step n={2} title="Tap “Download anyway”">
            Chrome warns about every app that isn’t from the Play Store. Until you tap <b>Download anyway</b>, the file stays at 100% and looks frozen.
          </Step>
          <Step n={3} title="Open and install">
            Open the downloaded <b>MealMate.apk</b>. The first time, Android asks to allow “Install unknown apps” for Chrome — allow it, go back, and tap <b>Install</b>.
          </Step>
          <Step n={4} title="Updating later">
            Download again from this page and install over the old app — your login and data stay.
          </Step>
        </section>}

        <p style={{ textAlign: "center", fontSize: 13, color: "#667085", marginTop: 18 }}>
          Prefer the website? <a href="/" style={{ color: NAVY, fontWeight: 600 }}>Open MealMate in your browser</a>
        </p>
      </div>
    </main>
  );
}

function btn(bg: string, fg: string): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    padding: "14px 16px",
    borderRadius: 14,
    background: bg,
    color: fg,
    fontSize: 16,
    fontWeight: 700,
    textAlign: "center",
    textDecoration: "none",
    boxShadow: "0 6px 16px rgba(0,0,0,.18)",
    boxSizing: "border-box",
  };
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: n === 1 ? "none" : "1px solid #eef0f5" }}>
      <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 999, background: GRADIENT, color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>{title}</div>
        <div style={{ color: "#475467" }}>{children}</div>
      </div>
    </div>
  );
}
