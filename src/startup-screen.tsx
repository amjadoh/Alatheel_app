export function StartupScreen({
  progress,
  issue,
  onRetry,
  onLogout,
}: {
  progress: number;
  issue?: string;
  onRetry?: () => void;
  onLogout?: () => void;
}) {
  return (
    <main className="startup-screen" dir="rtl" aria-label="فتح الأثيل">
      <section className="startup-content">
        <img className="startup-logo" src="/logo.jpeg" alt="شعار إسطبل الأثيل" width="132" height="132" />
        <h1>إسطبل الأثيل</h1>
        <p className="startup-english" lang="en" dir="ltr">AL ATHEEL STUD</p>
        <div className="startup-track" role="progressbar" aria-label="تقدم فتح الأثيل" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, Math.round(progress)))}>
          <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
        <p className="startup-caption" role="status">{issue ? "تعذر إكمال الفتح" : "جارٍ فتح الأثيل…"}</p>
        {issue && <div className="startup-recovery">
          <p className="notice error" role="alert">{issue}</p>
          {onRetry && <button className="button gold" onClick={onRetry}>إعادة المحاولة</button>}
          {onLogout && <button className="button" onClick={onLogout}>تسجيل الخروج</button>}
        </div>}
      </section>
    </main>
  );
}
