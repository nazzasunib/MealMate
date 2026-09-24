import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mm-fullscreen-msg">
      <div className="mm-auth-card mm-auth-card--narrow">
        <img src="/logo-icon.png" alt="" className="mm-auth-logo" />
        <h1 className="mm-auth-title">Page not found</h1>
        <p className="mm-auth-sub">That page doesn&apos;t exist. Let&apos;s get you back to your MealMate.</p>
        <Link href="/" className="mm-btn mm-btn--primary mm-btn--block"><span className="mm-btn-label">Go home</span></Link>
      </div>
    </div>
  );
}
