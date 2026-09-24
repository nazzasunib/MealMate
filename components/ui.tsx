"use client";

import Link from "next/link";
import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";

/* ---------------- icons (Lucide paths, same set the app uses) ---------------- */
const PATHS: Record<string, ReactNode> = {
  mail: (<><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>),
  lock: (<><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
  user: (<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  home: (<><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>),
  eye: (<><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: (<><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path d="m2 2 20 20" /></>),
  arrowRight: (<><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>),
  arrowLeft: (<><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>),
  check: <path d="M20 6 9 17l-5-5" />,
  key: (<><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" /><path d="m21 2-9.6 9.6" /><circle cx="7.5" cy="15.5" r="5.5" /></>),
  users: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  plus: (<><path d="M5 12h14" /><path d="M12 5v14" /></>),
  shield: (<><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></>),
  alert: (<><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></>),
  utensils: (<><path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8" /><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7" /><path d="m2.1 21.8 6.4-6.3" /><path d="m19 5-7 7" /></>),
  wallet: (<><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></>),
  refresh: (<><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>),
  logout: (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></>),
  sparkles: (<><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /><path d="M20 3v4" /><path d="M22 5h-4" /></>),
};

export function Icon({ name, size = 18, className = "" }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/* ---------------- form controls ---------------- */
type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; icon?: string; hint?: ReactNode; error?: string; trailing?: ReactNode };

export function Field({ label, icon, hint, error, trailing, className = "", ...rest }: FieldProps) {
  const id = useId();
  return (
    <div className={"mm-field " + (error ? "is-invalid " : "") + className}>
      <label htmlFor={id} className="mm-label">{label}</label>
      <div className="mm-input-wrap">
        {icon && <span className="mm-input-icon"><Icon name={icon} size={16} /></span>}
        <input id={id} className={"mm-input" + (icon ? " has-icon" : "") + (trailing ? " has-trailing" : "")} aria-invalid={!!error} {...rest} />
        {trailing && <span className="mm-input-trailing">{trailing}</span>}
      </div>
      {error ? <p className="mm-field-error">{error}</p> : hint ? <p className="mm-field-hint">{hint}</p> : null}
    </div>
  );
}

export function passwordScore(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}

export function PasswordField({ showStrength, ...props }: Omit<FieldProps, "type" | "trailing"> & { showStrength?: boolean }) {
  const [visible, setVisible] = useState(false);
  const value = String(props.value ?? "");
  const score = passwordScore(value);
  const labels = ["Too weak", "Weak", "Okay", "Good", "Strong"];
  return (
    <div>
      <Field
        {...props}
        type={visible ? "text" : "password"}
        trailing={
          <button type="button" className="mm-eye" onClick={() => setVisible((v) => !v)} aria-label={visible ? "Hide password" : "Show password"} tabIndex={-1}>
            <Icon name={visible ? "eyeOff" : "eye"} size={16} />
          </button>
        }
      />
      {showStrength && value && (
        <div className="mm-strength" data-score={score}>
          <div className="mm-strength-bars">{[0, 1, 2, 3].map((i) => <span key={i} className={i < score ? "on" : ""} />)}</div>
          <span className="mm-strength-label">{labels[score]}</span>
        </div>
      )}
    </div>
  );
}

export function Button({
  children, loading, variant = "primary", block, className = "", ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: "primary" | "secondary" | "ghost"; block?: boolean }) {
  return (
    <button className={`mm-btn mm-btn--${variant}${block ? " mm-btn--block" : ""}${loading ? " is-loading" : ""} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading && <span className="mm-spinner" aria-hidden="true" />}
      <span className="mm-btn-label">{children}</span>
    </button>
  );
}

export function LinkButton({ href, children, variant = "secondary", icon }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "ghost"; icon?: string }) {
  return (
    <Link href={href} className={`mm-btn mm-btn--${variant} mm-btn--block`}>
      {icon && <Icon name={icon} size={16} />}
      <span className="mm-btn-label">{children}</span>
    </Link>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className={`mm-alert mm-alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={tone === "success" ? "check" : "alert"} size={16} className="mm-alert-icon" />
      <div>{children}</div>
    </div>
  );
}

/* ---------------- layout ---------------- */
export function AuthShell({
  title, subtitle, children, footer, badge, wide,
}: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; badge?: ReactNode; wide?: boolean }) {
  return (
    <main className="mm-auth">
      <aside className="mm-auth-brand auth-bg" aria-hidden="true">
        <div className="mm-blob mm-blob--a" />
        <div className="mm-blob mm-blob--b" />
        <div className="mm-blob mm-blob--c" />
        <div className="mm-brand-grid" />
        <div className="mm-brand-inner">
          <div className="mm-brand-logo">
            <img src="/logo-icon.png" alt="" width={44} height={44} />
            <span>MealMate</span>
          </div>
          <div className="mm-brand-copy">
            <h2>Meals, money &amp; mess —<br /><em>always in sync.</em></h2>
            <p>One shared MealMate for everyone in your mess. Every meal, deposit and bazar is updated live on every phone.</p>
          </div>
          <div className="mm-float-cards">
            <div className="mm-float-card stat-card-bg" style={{ ["--d" as string]: "0s" }}>
              <span className="mm-float-icon"><Icon name="utensils" size={16} /></span>
              <div><p className="mm-float-value">36 meals</p><p className="mm-float-label">This week</p></div>
            </div>
            <div className="mm-float-card stat-card-bg" style={{ ["--d" as string]: "1.2s" }}>
              <span className="mm-float-icon mm-float-icon--green"><Icon name="wallet" size={16} /></span>
              <div><p className="mm-float-value">৳62.40</p><p className="mm-float-label">Meal rate</p></div>
            </div>
            <div className="mm-float-card stat-card-bg" style={{ ["--d" as string]: "2.4s" }}>
              <span className="mm-float-icon mm-float-icon--amber"><Icon name="users" size={16} /></span>
              <div><p className="mm-float-value">Rahim paid ৳2,000</p><p className="mm-float-label">Just now · synced</p></div>
            </div>
          </div>
          <ul className="mm-brand-points">
            <li><Icon name="shield" size={16} /> Private to your mess — protected by row-level security</li>
            <li><Icon name="users" size={16} /> Invite by code or link, roles for everyone</li>
            <li><Icon name="refresh" size={16} /> Live updates across all devices</li>
          </ul>
        </div>
      </aside>
      <section className="mm-auth-main">
        <div className="mm-auth-mobile-head auth-bg">
          <div className="mm-blob mm-blob--a" />
          <img src="/logo-icon.png" alt="MealMate" width={52} height={52} />
        </div>
        <div className={"mm-auth-card" + (wide ? " mm-auth-card--wide" : "")}>
          <div className="mm-auth-head">
            <img src="/logo-icon.png" alt="MealMate" className="mm-auth-logo" width={56} height={56} />
            {badge}
            <h1 className="mm-auth-title">{title}</h1>
            {subtitle && <p className="mm-auth-sub">{subtitle}</p>}
          </div>
          {children}
          {footer && <div className="mm-auth-footer">{footer}</div>}
        </div>
        <p className="mm-auth-legal">© {new Date().getFullYear()} MealMate · Simple Meals. Clear Money. Better Mess.</p>
      </section>
    </main>
  );
}

export function Divider({ children }: { children: ReactNode }) {
  return <div className="mm-divider"><span>{children}</span></div>;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validatePassword(pw: string): string {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Use both letters and numbers.";
  return "";
}
