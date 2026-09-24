export default function Splash({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="mm-splash" role="status" aria-live="polite">
      <div className="mm-splash-inner">
        <div className="mm-splash-logo">
          <span className="mm-splash-ring" />
          <img src="/logo-icon.png" alt="MealMate" width={72} height={72} />
        </div>
        <p className="mm-splash-label">{label}</p>
        <div className="mm-splash-bar"><span /></div>
      </div>
    </div>
  );
}
