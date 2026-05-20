'use client'
import { useState, useRef, useEffect } from 'react'

interface TranscriptEntry {
  id: string
  speaker: string
  text: string
  created_at: string
}

interface Summary {
  title?: string
  duration_minutes?: number
  participant_count?: number
  summary_sentences?: string[]
  action_items?: Array<{ text: string; assignee: string; speaker: string }>
  decisions?: string[]
  key_topics?: string[]
  sentiment?: string
  sentiment_score?: number
  highlights?: string[]
  speaker_stats?: Record<string, { word_count: number; utterances: number; talk_time_pct: number }>
  word_cloud_terms?: Array<{ word: string; weight: number }>
  questions_raised?: string[]
  generated_at?: string
  error?: string
}

interface Props {
  transcript: TranscriptEntry[]
  summary: Summary | null
  requesting: boolean
  onRequestSummary: () => void
  mySid: string
}

const COLORS = ['#4f8ef7', '#a78bfa', '#3ecf6e', '#f5c842', '#f45c5c', '#34d399', '#fb923c']
const getColor = (name: string) => COLORS[name.charCodeAt(0) % COLORS.length]

const sentimentEmoji: Record<string, string> = {
  positive: '😊', neutral: '😐', mixed: '🤔', negative: '😟'
}
const sentimentColor: Record<string, string> = {
  positive: '#3ecf6e', neutral: '#a0a0a8', mixed: '#f5c842', negative: '#f45c5c'
}

export default function TranscriptPanel({ transcript, summary, requesting, onRequestSummary, mySid }: Props) {
  const [tab, setTab] = useState<'transcript' | 'summary'>('transcript')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (tab === 'transcript') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [transcript, tab])

  useEffect(() => {
    if (summary && !summary.error) setTab('summary')
  }, [summary])

  const formatTime = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) }
    catch { return '' }
  }

  const Section = ({ title, children, accent = '#4f8ef7' }: { title: string; children: React.ReactNode; accent?: string }) => (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        {title}
      </div>
      {children}
    </div>
  )

  const Chip = ({ text, color = '#4f8ef7' }: { text: string; color?: string }) => (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 9999,
      background: `${color}18`, border: `1px solid ${color}35`,
      color, fontSize: 12, fontWeight: 500, margin: '2px',
    }}>{text}</span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 4px' }}>
        {(['transcript', 'summary'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '14px 0', fontSize: 13, fontWeight: 500,
            color: tab === t ? '#f0f0f2' : '#606068',
            borderBottom: tab === t ? '2px solid #4f8ef7' : '2px solid transparent',
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', textTransform: 'capitalize',
            transition: 'color 0.15s',
          }}>
            {t === 'transcript' ? `📝 Transcript` : `🧠 Summary`}
            {t === 'transcript' && transcript.length > 0 && (
              <span style={{ marginLeft: 6, background: '#27272b', borderRadius: 9999, padding: '1px 7px', fontSize: 11, color: '#a0a0a8' }}>
                {transcript.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Transcript tab */}
      {tab === 'transcript' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {transcript.length === 0 && (
            <div style={{ textAlign: 'center', color: '#606068', fontSize: 13, marginTop: 40, lineHeight: 1.7 }}>
              🎙️ Live transcript will appear here<br />
              <span style={{ fontSize: 12, color: '#3c3c42' }}>
                Use the mic button in the meeting to send transcript entries
              </span>
            </div>
          )}
          {transcript.map(entry => (
            <div key={entry.id} style={{ animation: 'fadeIn 0.2s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: getColor(entry.speaker), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                  {entry.speaker[0]?.toUpperCase()}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: getColor(entry.speaker) }}>{entry.speaker}</span>
                <span style={{ fontSize: 11, color: '#606068', marginLeft: 'auto' }}>{formatTime(entry.created_at)}</span>
              </div>
              <p style={{ fontSize: 13, color: '#c0c0c8', lineHeight: 1.6, paddingLeft: 30 }}>
                {entry.text}
              </p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Summary tab */}
      {tab === 'summary' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {!summary && !requesting && (
            <div style={{ textAlign: 'center', marginTop: 40 }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>🧠</div>
              <p style={{ color: '#a0a0a8', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
                Generate an AI-powered summary of this meeting using TF-IDF + TextRank analysis
              </p>
              <button
                onClick={onRequestSummary}
                style={{
                  padding: '12px 24px', background: '#4f8ef7', color: '#fff',
                  borderRadius: 9999, fontSize: 14, fontWeight: 500,
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Generate Summary
              </button>
            </div>
          )}

          {requesting && (
            <div style={{ textAlign: 'center', marginTop: 40, color: '#a0a0a8' }}>
              <div style={{ width: 32, height: 32, border: '3px solid #27272b', borderTopColor: '#4f8ef7', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
              <p style={{ fontSize: 14 }}>Analyzing transcript…</p>
              <p style={{ fontSize: 12, color: '#606068', marginTop: 6 }}>Running TF-IDF + TextRank</p>
            </div>
          )}

          {summary && summary.error && (
            <div style={{ textAlign: 'center', marginTop: 40, color: '#f45c5c', fontSize: 14 }}>
              ⚠️ {summary.error}
              {transcript.length === 0 && <p style={{ color: '#606068', fontSize: 13, marginTop: 8 }}>Add transcript entries first by speaking during the meeting.</p>}
            </div>
          )}

          {summary && !summary.error && (
            <div style={{ animation: 'fadeIn 0.4s ease' }}>

              {/* Meta */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                {summary.duration_minutes !== undefined && (
                  <Chip text={`⏱ ${summary.duration_minutes}m`} color="#a0a0a8" />
                )}
                {summary.participant_count !== undefined && (
                  <Chip text={`👥 ${summary.participant_count} participants`} color="#a0a0a8" />
                )}
                {summary.sentiment && (
                  <Chip
                    text={`${sentimentEmoji[summary.sentiment] || ''} ${summary.sentiment}`}
                    color={sentimentColor[summary.sentiment] || '#a0a0a8'}
                  />
                )}
              </div>

              {/* Highlights */}
              {summary.highlights && summary.highlights.length > 0 && (
                <Section title="⭐ Highlights" accent="#f5c842">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {summary.highlights.map((h, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'rgba(245,200,66,0.07)', border: '1px solid rgba(245,200,66,0.15)', borderRadius: 10, fontSize: 13, color: '#e8e8ee', lineHeight: 1.5 }}>
                        <span style={{ color: '#f5c842', flexShrink: 0 }}>★</span>
                        {h}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Summary */}
              {summary.summary_sentences && summary.summary_sentences.length > 0 && (
                <Section title="📄 Summary" accent="#4f8ef7">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {summary.summary_sentences.map((s, i) => (
                      <p key={i} style={{ fontSize: 13, color: '#c0c0c8', lineHeight: 1.6, padding: '8px 12px', background: '#1e1e21', borderRadius: 8, borderLeft: '3px solid rgba(79,142,247,0.4)' }}>
                        {s}
                      </p>
                    ))}
                  </div>
                </Section>
              )}

              {/* Action items */}
              {summary.action_items && summary.action_items.length > 0 && (
                <Section title="✅ Action Items" accent="#3ecf6e">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {summary.action_items.map((item, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'rgba(62,207,110,0.07)', border: '1px solid rgba(62,207,110,0.15)', borderRadius: 10 }}>
                        <input type="checkbox" style={{ marginTop: 2, accentColor: '#3ecf6e', flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 13, color: '#e8e8ee', lineHeight: 1.5 }}>{item.text}</p>
                          <span style={{ fontSize: 11, color: '#3ecf6e', marginTop: 3, display: 'block' }}>
                            → {item.assignee || item.speaker}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Decisions */}
              {summary.decisions && summary.decisions.length > 0 && (
                <Section title="⚖️ Decisions Made" accent="#a78bfa">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {summary.decisions.map((d, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'rgba(167,139,250,0.07)', border: '1px solid rgba(167,139,250,0.15)', borderRadius: 10, fontSize: 13, color: '#e8e8ee', lineHeight: 1.5 }}>
                        <span style={{ color: '#a78bfa', flexShrink: 0 }}>⚖</span>
                        {d}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Key topics */}
              {summary.key_topics && summary.key_topics.length > 0 && (
                <Section title="🏷️ Key Topics" accent="#fb923c">
                  <div style={{ flexWrap: 'wrap', display: 'flex', gap: 4 }}>
                    {summary.key_topics.map((t, i) => (
                      <Chip key={i} text={t} color="#fb923c" />
                    ))}
                  </div>
                </Section>
              )}

              {/* Questions raised */}
              {summary.questions_raised && summary.questions_raised.length > 0 && (
                <Section title="❓ Questions Raised" accent="#f45c5c">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {summary.questions_raised.map((q, i) => (
                      <div key={i} style={{ fontSize: 13, color: '#c0c0c8', padding: '8px 12px', background: 'rgba(244,92,92,0.07)', borderRadius: 8, border: '1px solid rgba(244,92,92,0.15)', lineHeight: 1.5 }}>
                        {q}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Speaker stats */}
              {summary.speaker_stats && Object.keys(summary.speaker_stats).length > 0 && (
                <Section title="🎤 Speaker Stats" accent="#4f8ef7">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {Object.entries(summary.speaker_stats)
                      .sort((a, b) => b[1].talk_time_pct - a[1].talk_time_pct)
                      .map(([speaker, stats]) => (
                        <div key={speaker} style={{ padding: '10px 12px', background: '#1e1e21', borderRadius: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, color: getColor(speaker) }}>{speaker}</span>
                            <span style={{ fontSize: 12, color: '#a0a0a8' }}>{stats.talk_time_pct}% talk time</span>
                          </div>
                          <div style={{ height: 4, background: '#27272b', borderRadius: 9999, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${stats.talk_time_pct}%`, background: getColor(speaker), borderRadius: 9999, transition: 'width 1s ease' }} />
                          </div>
                          <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: '#606068' }}>
                            <span>{stats.word_count} words</span>
                            <span>{stats.utterances} utterances</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </Section>
              )}

              {/* Regenerate button */}
              <button
                onClick={onRequestSummary}
                style={{
                  width: '100%', padding: '11px', marginTop: 8,
                  background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10, color: '#a0a0a8', fontSize: 13, cursor: 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.2s',
                }}
                onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = 'rgba(79,142,247,0.4)'; (e.target as HTMLElement).style.color = '#4f8ef7' }}
                onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.target as HTMLElement).style.color = '#a0a0a8' }}
              >
                ↺ Regenerate Summary
              </button>

              {summary.generated_at && (
                <p style={{ fontSize: 11, color: '#3c3c42', textAlign: 'center', marginTop: 10 }}>
                  Generated at {new Date(summary.generated_at).toLocaleTimeString()}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Generate summary footer */}
      {tab === 'transcript' && transcript.length >= 3 && !summary && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <button
            onClick={() => { setTab('summary'); onRequestSummary() }}
            style={{
              width: '100%', padding: '10px', background: 'rgba(79,142,247,0.1)',
              border: '1px solid rgba(79,142,247,0.25)', borderRadius: 9,
              color: '#4f8ef7', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            🧠 Generate Smart Summary
          </button>
        </div>
      )}
    </div>
  )
}
