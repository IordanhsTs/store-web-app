import LoginForm from '../../LoginForm';

export default function LoginPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      {/* Ambient background blobs */}
      <div
        className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-20 pointer-events-none"
        style={{
          background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />
      <div
        className="absolute bottom-[-15%] left-[-10%] w-[400px] h-[400px] rounded-full opacity-10 pointer-events-none"
        style={{
          background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />

      {/* Card */}
      <div
        className="w-full max-w-md relative animate-scale-in"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-2xl)',
          boxShadow: 'var(--shadow-xl)',
          overflow: 'hidden',
        }}
      >
        {/* Top accent line */}
        <div
          className="h-1 w-full"
          style={{ background: 'linear-gradient(90deg, var(--accent-hover), var(--accent), var(--accent-hover))' }}
        />

        <div className="p-8 pt-10">
          {/* Logo & Brand */}
          <div className="text-center mb-10">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-2xl mx-auto mb-5 shadow-lg"
              style={{
                background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                boxShadow: '0 8px 24px var(--accent-muted)',
              }}
            >
              V
            </div>
            <h1
              className="text-2xl font-bold tracking-widest mb-2"
              style={{ color: 'var(--text-primary)', letterSpacing: '0.2em' }}
            >
              VERTEX
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Σύστημα Διαχείρισης Καταστήματος
            </p>
          </div>

          <LoginForm />
        </div>

        {/* Footer */}
        <div
          className="px-8 py-4 text-center text-xs"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            borderTop: '1px solid var(--border-subtle)',
            color: 'var(--text-muted)',
          }}
        >
          © {new Date().getFullYear()} VERTEX. Όλα τα δικαιώματα διατηρούνται.
        </div>
      </div>
    </div>
  );
}
