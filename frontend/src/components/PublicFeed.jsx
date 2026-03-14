import React from 'react';
import { MessageSquare } from 'lucide-react';

export default function PublicFeed({ users, onStartChat }) {
  if (!users || users.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        <p>No public users online right now.</p>
      </div>
    );
  }

  return (
    <div className="public-feed-container">
      {users.map((user) => (
        <div key={user.number} className="public-feed-item" style={{ background: user.avatarColor || 'var(--gradient-premium)' }}>
          <div className="public-feed-content">
            <div className="profile-avatar glass" style={{ width: '120px', height: '120px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem', fontWeight: 'bold', marginBottom: '1.5rem', border: '4px solid rgba(255,255,255,0.2)' }}>
              {user.username ? user.username[0].toUpperCase() : user.number[0]}
            </div>
            <h2 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '0.5rem', color: 'white', textShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
              {user.username}
            </h2>
            <p style={{ fontSize: '1.2rem', color: 'rgba(255,255,255,0.8)', marginBottom: '3rem', textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
              {user.number}
            </p>
            <button
              className="btn btn-primary"
              style={{ padding: '1.2rem 2.5rem', borderRadius: '30px', fontSize: '1.2rem', fontWeight: 700, gap: '0.8rem', boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}
              onClick={() => onStartChat({ ...user, isPublicChat: true })}
            >
              <MessageSquare size={24} /> Start Chat
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
