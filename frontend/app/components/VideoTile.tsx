'use client'
import { useEffect, useRef, useState } from 'react'

interface Props {
  stream: MediaStream | null
  name: string
  muted?: boolean
  audioEnabled?: boolean
  videoEnabled?: boolean
  isLocal?: boolean
  isScreenShare?: boolean
  handRaised?: boolean
  isSpeaking?: boolean
  size?: 'normal' | 'large' | 'small'
}

export default function VideoTile({
  stream, name, muted = false, audioEnabled = true, videoEnabled = true,
  isLocal = false, isScreenShare = false, handRaised = false, isSpeaking = false, size = 'normal'
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hasVideo, setHasVideo] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) { setHasVideo(false); return }
    video.srcObject = stream
    const check = () => setHasVideo(stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live'))
    check()
    const interval = setInterval(check, 1000)
    return () => clearInterval(interval)
  }, [stream])

  const showVideo = hasVideo && videoEnabled

  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const avatarColors = [
    '#4f8ef7', '#a78bfa', '#3ecf6e', '#f5c842', '#f45c5c', '#34d399', '#fb923c'
  ]
  const colorIdx = name.charCodeAt(0) % avatarColors.length

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      background: '#161618',
      borderRadius: 14,
      overflow: 'hidden',
      border: isSpeaking
        ? '2px solid #4f8ef7'
        : '2px solid rgba(255,255,255,0.06)',
      transition: 'border-color 0.2s',
      boxShadow: isSpeaking ? '0 0 0 4px rgba(79,142,247,0.15)' : 'none',
    }}>
      {/* Video element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted || isLocal}
        style={{
          width: '100%',
          height: '100%',
          objectFit: isScreenShare ? 'contain' : 'cover',
          display: showVideo ? 'block' : 'none',
          transform: isLocal && !isScreenShare ? 'scaleX(-1)' : 'none',
          background: '#0d0d0d',
        }}
      />

      {/* Avatar fallback when no video */}
      {!showVideo && (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#1a1a1d',
        }}>
          <div style={{
            width: size === 'small' ? 48 : size === 'large' ? 80 : 64,
            height: size === 'small' ? 48 : size === 'large' ? 80 : 64,
            borderRadius: '50%',
            background: avatarColors[colorIdx],
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: size === 'small' ? 18 : size === 'large' ? 32 : 26,
            fontWeight: 600, color: '#fff',
            letterSpacing: '-0.5px',
          }}>
            {initials}
          </div>
        </div>
      )}

      {/* Bottom bar with name + status */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '20px 12px 10px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: size === 'small' ? 11 : 13,
          fontWeight: 500,
          color: '#fff',
          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          maxWidth: '70%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}{isLocal ? ' (You)' : ''}
        </span>

        <div style={{ display: 'flex', gap: 4 }}>
          {!audioEnabled && (
            <div style={{
              width: size === 'small' ? 20 : 26, height: size === 'small' ? 20 : 26,
              borderRadius: '50%', background: '#f45c5c',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                <line x1="1" y1="1" x2="23" y2="23" stroke="white" strokeWidth="2"/>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </div>
          )}
          {handRaised && (
            <div style={{
              width: size === 'small' ? 20 : 26, height: size === 'small' ? 20 : 26,
              borderRadius: '50%', background: '#f5c842',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12,
            }}>
              ✋
            </div>
          )}
        </div>
      </div>

      {/* Speaking indicator ring animation */}
      {isSpeaking && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 14,
          border: '2px solid #4f8ef7',
          animation: 'breathe 1.5s ease-in-out infinite',
          pointerEvents: 'none',
        }} />
      )}

      {/* Screen share label */}
      {isScreenShare && (
        <div style={{
          position: 'absolute', top: 10, left: 10,
          background: 'rgba(79,142,247,0.9)', color: '#fff',
          fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 9999,
        }}>
          SCREEN
        </div>
      )}
    </div>
  )
}
