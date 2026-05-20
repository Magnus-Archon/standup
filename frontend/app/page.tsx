'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()
  const [joinCode, setJoinCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [time, setTime] = useState('')

  const API = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  async function createMeeting() {
    setCreating(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/rooms`, { method: 'POST' })
      const data = await res.json()
      router.push(`/meet/${data.code}`)
    } catch {
      setError('Could not reach server. Make sure the backend is running.')
      setCreating(false)
    }
  }

  function joinMeeting() {
    const code = joinCode.trim().toLowerCase().replace(/\s+/g, '-')
    if (!code) return
    router.push(`/meet/${code}`)
  }

  return (
    <div style={{ height: '100vh', background: '#0d0d0d', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font)' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, background: 'linear-gradient(135deg, #4f8ef7 0%, #a78bfa 100%)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: '#fff' }}>
            S
          </div>
          <span style={{ fontSize: 20, fontWeight: 600, color: '#f0f0f2', letterSpacing: '-0.5px' }}>Standup</span>
        </div>
        <div style={{ color: '#606068', fontSize: 14 }}>{time}</div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
        <div style={{ width: '100%', maxWidth: 960, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center' }}>

          {/* Left */}
          <div style={{ animation: 'fadeIn 0.5s ease forwards' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(79,142,247,0.12)', border: '1px solid rgba(79,142,247,0.25)', borderRadius: 9999, padding: '5px 14px', marginBottom: 24, fontSize: 13, color: '#4f8ef7' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4f8ef7', display: 'inline-block', animation: 'pulse 2s infinite' }} />
              Smart note-taker included
            </div>

            <h1 style={{ fontSize: 52, fontWeight: 600, lineHeight: 1.1, color: '#f0f0f2', letterSpacing: '-2px', marginBottom: 18 }}>
              Meetings that<br />
              <span style={{ background: 'linear-gradient(135deg, #4f8ef7, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                actually matter
              </span>
            </h1>

            <p style={{ fontSize: 16, color: '#a0a0a8', lineHeight: 1.7, marginBottom: 36, maxWidth: 420 }}>
              Video calls with a built-in AI note-taker that captures action items, decisions, and summaries — no API key needed.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <button
                onClick={createMeeting}
                disabled={creating}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  padding: '14px 28px', background: creating ? '#2a3a5a' : '#4f8ef7',
                  color: '#fff', borderRadius: 9999, fontSize: 15, fontWeight: 500,
                  cursor: creating ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                  border: 'none', fontFamily: 'inherit', width: 'fit-content',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
                {creating ? 'Starting...' : 'New meeting'}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                <span style={{ color: '#606068', fontSize: 13 }}>or join with a code</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  style={{
                    flex: 1, padding: '13px 18px', background: '#1e1e21',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 9999,
                    color: '#f0f0f2', fontSize: 15, outline: 'none', fontFamily: 'inherit',
                    letterSpacing: '0.5px',
                  }}
                  type="text"
                  placeholder="abc-defg-hij"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && joinMeeting()}
                  onFocus={e => (e.target.style.borderColor = 'rgba(79,142,247,0.5)')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
                />
                <button
                  onClick={joinMeeting}
                  style={{
                    padding: '13px 22px', borderRadius: 9999, fontSize: 15, fontWeight: 500,
                    color: joinCode.trim() ? '#4f8ef7' : '#606068',
                    cursor: joinCode.trim() ? 'pointer' : 'default',
                    border: '1px solid', borderColor: joinCode.trim() ? 'rgba(79,142,247,0.3)' : 'rgba(255,255,255,0.07)',
                    background: 'transparent', fontFamily: 'inherit', transition: 'all 0.2s',
                  }}
                >
                  Join
                </button>
              </div>

              {error && (
                <div style={{ color: '#f45c5c', fontSize: 13, padding: '10px 14px', background: 'rgba(244,92,92,0.08)', borderRadius: 8, border: '1px solid rgba(244,92,92,0.2)' }}>
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Right — feature cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'fadeIn 0.6s 0.1s ease both' }}>
            {[
              { icon: '🎙️', title: 'Live transcription', desc: 'Every word captured in real-time, attributed to each speaker', color: '#4f8ef7' },
              { icon: '✅', title: 'Action items', desc: 'Automatically detects tasks, assignees and deadlines', color: '#3ecf6e' },
              { icon: '📋', title: 'Smart summary', desc: 'TF-IDF + TextRank extracts the most important moments', color: '#a78bfa' },
              { icon: '🖥️', title: 'Screen sharing', desc: 'Share your screen with one click — no plugins needed', color: '#f5c842' },
            ].map(f => (
              <div key={f.title} style={{
                display: 'flex', alignItems: 'flex-start', gap: 16,
                background: '#161618', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 14, padding: '16px 20px',
                transition: 'border-color 0.2s',
              }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
              >
                <div style={{ width: 40, height: 40, borderRadius: 10, background: '#27272b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                  {f.icon}
                </div>
                <div>
                  <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 3, color: '#f0f0f2' }}>{f.title}</div>
                  <div style={{ fontSize: 13, color: '#a0a0a8', lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer style={{ padding: '14px 32px', textAlign: 'center', color: '#606068', fontSize: 12, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        Standup · Video meetings with smart notes · No account needed
      </footer>
    </div>
  )
}
