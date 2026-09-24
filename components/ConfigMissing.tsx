export default function ConfigMissing() {
  return (
    <div className="mm-fullscreen-msg">
      <div className="mm-auth-card mm-auth-card--narrow">
        <img src="/logo-icon.png" alt="" className="mm-auth-logo" />
        <h1 className="mm-auth-title">Almost there</h1>
        <p className="mm-auth-sub">
          Supabase isn&apos;t connected yet. Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to
          your environment (<code>.env.local</code> locally, or Vercel → Settings → Environment Variables) and redeploy.
        </p>
      </div>
    </div>
  );
}
