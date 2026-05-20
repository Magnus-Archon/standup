'use client'
import { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  text: string
  sender_sid: string
  sender_name: string
  timestamp: string
}

interface Props {
  messages: Message[]
  mySid: string
  onSend: (text: string) => void
}

export default function ChatPanel({ messages, mySid, onSend }: Props) {
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = () => {
    if (!text.trim()) return
    onSend(text.trim())
    setText('')
  }

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    } catch { return '' }
  }

  const getColor = (name: string) => {
    const colors = ['#4f8ef7', '#a78bfa', '#3ecf6e', '#f5c842', '#f45c5c', '#34d399', '#fb923c']
    return colors[name.charCodeAt(0) % colors.length]
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', fontWeight: 600, fontSize: 15 }}>
        Chat
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#606068', fontSize: 13, marginTop: 40 }}>
            No messages yet.<br />Say something! 👋
          </div>
        )}
        {messages.map(msg => {
          const isMe = msg.sender_sid === mySid
          return (
            <div key={msg.id} style={{ animation: 'fadeIn 0.2s ease', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
              {!isMe && (
                <span style={{ fontSize: 11, color: getColor(msg.sender_name), fontWeight: 600, marginBottom: 4, paddingLeft: 4 }}>
                  {msg.sender_name}
                </span>
              )}
              <div style={{
                maxWidth: '80%',
                background: isMe ? '#4f8ef7' : '#27272b',
                color: isMe ? '#fff' : '#f0f0f2',
                padding: '9px 13px',
                borderRadius: isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                fontSize: 14, lineHeight: 1.5,
                wordBreak: 'break-word',
              }}>
                {msg.text}
              </div>
              <span style={{ fontSize: 10, color: '#606068', marginTop: 3, paddingLeft: 4, paddingRight: 4 }}>
                {formatTime(msg.timestamp)}
              </span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Message everyone..."
            rows={1}
            style={{
              flex: 1, padding: '10px 14px',
              background: '#27272b', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12, color: '#f0f0f2', fontSize: 14,
              outline: 'none', resize: 'none', fontFamily: 'inherit',
              maxHeight: 120, lineHeight: 1.5,
            }}
          />
          <button
            onClick={send}
            disabled={!text.trim()}
            style={{
              width: 38, height: 38, borderRadius: '50%',
              background: text.trim() ? '#4f8ef7' : '#27272b',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'background 0.2s', border: 'none',
              cursor: text.trim() ? 'pointer' : 'default',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
