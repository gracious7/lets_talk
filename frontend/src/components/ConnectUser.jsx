import { useState } from 'react';
import { MessagesSquare, Loader, Sparkles, ShieldCheck, Zap } from 'lucide-react';

export default function ConnectUser({ onRegister }) {
  const [username, setUsername] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim() || isRegistering) return;
    setIsRegistering(true);
    onRegister(username.trim());
  };

  return (
    <div className="animate-scale-in" style={{ width: '100%', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', background: 'radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.1) 0%, transparent 80%)' }}>
      <div className="glass" style={{ padding: '3.5rem', width: '100%', maxWidth: '480px', borderRadius: '48px', border: '1px solid var(--border-bright)', boxShadow: '0 40px 100px rgba(0,0,0,0.4)', position: 'relative', overflow: 'hidden' }}>
        {/* Abstract Background Glow */}
        <div style={{ position: 'absolute', top: '-10%', right: '-10%', width: '200px', height: '200px', background: 'var(--primary-glow)', filter: 'blur(80px)', opacity: 0.3, zIndex: -1 }} />

        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '24px', background: 'var(--gradient-premium)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', boxShadow: '0 15px 30px var(--primary-glow)' }}>
            <MessagesSquare size={40} color="white" strokeWidth={2.5} />
          </div>
          <h1 style={{ fontSize: '2.8rem', fontWeight: 800, letterSpacing: '-0.04em', marginBottom: '0.5rem', color: 'white' }}>
            Lets Talk
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', fontWeight: 500 }}>
            Premium Communication Made Simple
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.8rem', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
              Your Display Name
            </label>
            <input
              type="text"
              className="input-premium"
              style={{ width: '100%', borderRadius: '20px', padding: '1.2rem' }}
              placeholder="e.g. Alex"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={isRegistering}
              autoFocus
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ padding: '1.2rem', borderRadius: '20px', fontSize: '1.1rem', fontWeight: 700 }} disabled={isRegistering}>
            {isRegistering ? <Loader className="spin" size={24} /> : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                Enter Space <Sparkles size={20} />
              </span>
            )}
          </button>
        </form>

        <div style={{ marginTop: '3rem', display: 'flex', justifyContent: 'center', gap: '1.5rem', opacity: 0.6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
            <ShieldCheck size={16} color="var(--success)" /> End-to-end Encrypted
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
            <Zap size={16} color="var(--primary-accent)" /> Ultra Low Latency
          </div>
        </div>
      </div>
    </div>
  );
}
