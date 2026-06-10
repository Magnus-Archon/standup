'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { io, Socket } from 'socket.io-client'
import VideoTile from '@/app/components/VideoTile'
import ChatPanel from '@/app/components/ChatPanel'
import TranscriptPanel from '@/app/components/TranscriptPanel'

// ── Types ──────────────────────────────────
interface Participant {
  sid: string; name: string; audio: boolean; video: boolean
  screen: boolean; hand_raised: boolean; is_host: boolean
}
interface Message { id: string; text: string; sender_sid: string; sender_name: string; timestamp: string }
interface TranscriptEntry { id: string; speaker: string; text: string; created_at: string }
interface Summary { [key: string]: any }
interface RemoteStream { sid: string; stream: MediaStream; name: string }

const ICE_SERVERS = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]}

const REACTIONS = ['👍','❤️','😂','🎉','🙌','💡','🔥','👏']
const EMOJIS_REACTION = ['😮','😂','❤️','👍','🎉','💡']

export default function MeetPage() {
  const params = useParams()
  const router = useRouter()
  const code = (params.code as string)?.toLowerCase()

  // ── Pre-join state ──────────────────────
  const [phase, setPhase] = useState<'prejoin' | 'meeting' | 'ended'>('prejoin')
  const [myName, setMyName] = useState('')
  const [nameError, setNameError] = useState('')

  // ── Meeting state ───────────────────────
  const socketRef = useRef<Socket | null>(null)
  const [mySid, setMySid] = useState('')
  const [participants, setParticipants] = useState<Record<string, Participant>>({})
  const [messages, setMessages] = useState<Message[]>([])
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [requestingSummary, setRequestingSummary] = useState(false)

  // ── Media state ─────────────────────────
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([])
  const [audioOn, setAudioOn] = useState(true)
  const [videoOn, setVideoOn] = useState(true)
  const [screenOn, setScreenOn] = useState(false)
  const [handRaised, setHandRaised] = useState(false)
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const pendingRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())

  // ── UI state ────────────────────────────
  const [rightPanel, setRightPanel] = useState<'none' | 'chat' | 'transcript'>('none')
  const [showReactions, setShowReactions] = useState(false)
  const [floatingEmojis, setFloatingEmojis] = useState<Array<{ id: string; emoji: string; x: number }>>([])
  const [notification, setNotification] = useState('')
  const [copied, setCopied] = useState(false)
  const [transcriptInput, setTranscriptInput] = useState('')
  const [showTranscriptInput, setShowTranscriptInput] = useState(false)
  const [unreadChat, setUnreadChat] = useState(0)
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({})

  // Pre-join media preview
  const previewVideoRef = useRef<HTMLVideoElement>(null)
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null)
  const [previewAudio, setPreviewAudio] = useState(true)
  const [previewVideo, setPreviewVideo] = useState(true)

  // ── Pre-join: get camera preview ───────
  useEffect(() => {
    if (phase !== 'prejoin') return
    let stream: MediaStream | null = null
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(s => { stream = s; setPreviewStream(s); if (previewVideoRef.current) previewVideoRef.current.srcObject = s })
      .catch(() => {})
    return () => { stream?.getTracks().forEach(t => t.stop()) }
  }, [phase])

  const togglePreviewAudio = () => {
    previewStream?.getAudioTracks().forEach(t => { t.enabled = !previewAudio })
    setPreviewAudio(v => !v)
  }
  const togglePreviewVideo = () => {
    previewStream?.getVideoTracks().forEach(t => { t.enabled = !previewVideo })
    setPreviewVideo(v => !v)
  }

  // ── Join meeting ───────────────────────
  const joinMeeting = useCallback(async () => {
    const name = myName.trim()
    if (!name) { setNameError('Please enter your name'); return }
    setNameError('')

    // Stop preview, use that stream as local
    if (previewStream) {
      localStreamRef.current = previewStream
      setLocalStream(previewStream)
    } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: previewVideo, audio: previewAudio })
        localStreamRef.current = s; setLocalStream(s)
      } catch { /* audio only or nothing */ }
    }
    setPreviewStream(null)
    setAudioOn(previewAudio)
    setVideoOn(previewVideo)
    setPhase('meeting')
  }, [myName, previewStream, previewAudio, previewVideo])

  // ── Socket setup after join ────────────
  useEffect(() => {
    if (phase !== 'meeting') return

    const SOCKET_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://standup-1-7kga.onrender.com'
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'], reconnectionAttempts: 10 })
    socketRef.current = socket

    socket.on('connect', () => {
      socket.emit('join_room', { code, name: myName })
    })

    socket.on('room_joined', ({ your_sid, participants: others, messages: msgs, transcript: trans }: any) => {
      setMySid(your_sid)
      setMessages(msgs || [])
      setTranscript(trans || [])
      // Connect to existing participants
      others.forEach((p: Participant) => {
        setParticipants(prev => ({ ...prev, [p.sid]: p }))
        connectToPeer(socket, p.sid, p.name, true)
      })
    })

    socket.on('participant_joined', (p: Participant) => {
      setParticipants(prev => ({ ...prev, [p.sid]: p }))
      showNotif(`${p.name} joined`)
      // They will connect to us (we're existing), so wait for their offer
    })

    socket.on('participant_left', ({ sid, name }: any) => {
      setParticipants(prev => { const n = { ...prev }; delete n[sid]; return n })
      disconnectPeer(sid)
      showNotif(`${name || 'Someone'} left`)
    })

    socket.on('participant_media_state', ({ sid, audio, video, screen }: any) => {
      setParticipants(prev => {
        if (!prev[sid]) return prev
        return { ...prev, [sid]: { ...prev[sid], audio: audio ?? prev[sid].audio, video: video ?? prev[sid].video, screen: screen ?? prev[sid].screen } }
      })
    })

    socket.on('hand_raised', ({ sid, raised }: any) => {
      setParticipants(prev => prev[sid] ? { ...prev, [sid]: { ...prev[sid], hand_raised: raised } } : prev)
    })

    socket.on('participant_reaction', ({ sid, name, emoji }: any) => {
      addFloatingEmoji(emoji)
    })

    socket.on('new_message', (msg: Message) => {
      setMessages(prev => [...prev, msg])
      if (rightPanel !== 'chat') setUnreadChat(c => c + 1)
    })

    socket.on('transcript_update', (entry: TranscriptEntry) => {
      setTranscript(prev => [...prev, entry])
    })

    socket.on('summary_result', (result: Summary) => {
      setSummary(result); setRequestingSummary(false)
    })

    // WebRTC signaling
    socket.on('webrtc_offer', async ({ offer, from }: any) => {
      let pc = peersRef.current.get(from)
      const pName = participants[from]?.name || from
      if (!pc) pc = createPeerConnection(socket, from, pName, false)
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socket.emit('webrtc_answer', { target: from, answer: pc.localDescription })
        flushCandidates(pc, from)
      } catch (e) { console.error('offer err', e) }
    })

    socket.on('webrtc_answer', async ({ answer, from }: any) => {
      const pc = peersRef.current.get(from)
      if (!pc) return
      try { await pc.setRemoteDescription(new RTCSessionDescription(answer)); flushCandidates(pc, from) }
      catch (e) { console.error('answer err', e) }
    })

    socket.on('webrtc_ice_candidate', async ({ candidate, from }: any) => {
      const pc = peersRef.current.get(from)
      if (!pc || !pc.remoteDescription) {
        const q = pendingRef.current.get(from) || []; q.push(candidate); pendingRef.current.set(from, q); return
      }
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch {}
    })

    return () => {
      socket.emit('leave_room', {})
      socket.disconnect()
      socketRef.current = null
    }
  }, [phase, code, myName])

  // ── WebRTC helpers ─────────────────────
  const createPeerConnection = (socket: Socket, sid: string, name: string, initiator: boolean) => {
    const pc = new RTCPeerConnection(ICE_SERVERS)
    peersRef.current.set(sid, pc)

    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!))

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('webrtc_ice_candidate', { target: sid, candidate })
    }

    pc.ontrack = ({ streams: [stream] }) => {
      setRemoteStreams(prev => {
        const exists = prev.find(r => r.sid === sid)
        if (exists) return prev.map(r => r.sid === sid ? { ...r, stream } : r)
        return [...prev, { sid, stream, name }]
      })
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        peersRef.current.delete(sid)
        setRemoteStreams(prev => prev.filter(r => r.sid !== sid))
      }
    }

    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          socket.emit('webrtc_offer', { target: sid, offer: pc.localDescription })
        } catch (e) { console.error('negotiation err', e) }
      }
    }
    return pc
  }

  const connectToPeer = (socket: Socket, sid: string, name: string, initiator: boolean) => {
    if (!peersRef.current.has(sid)) createPeerConnection(socket, sid, name, initiator)
  }

  const disconnectPeer = (sid: string) => {
    peersRef.current.get(sid)?.close()
    peersRef.current.delete(sid)
    setRemoteStreams(prev => prev.filter(r => r.sid !== sid))
  }

  const flushCandidates = async (pc: RTCPeerConnection, sid: string) => {
    const pending = pendingRef.current.get(sid) || []
    for (const c of pending) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {}
    }
    pendingRef.current.delete(sid)
  }

  // ── Media controls ─────────────────────
  const toggleAudio = () => {
    if (!localStreamRef.current) return
    const next = !audioOn
    localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = next })
    setAudioOn(next)
    socketRef.current?.emit('media_state', { audio: next })
  }

  const toggleVideo = () => {
    if (!localStreamRef.current) return
    const next = !videoOn
    localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = next })
    setVideoOn(next)
    socketRef.current?.emit('media_state', { video: next })
  }

  const toggleScreen = async () => {
    if (screenOn) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop())
      screenStreamRef.current = null
      if (localStreamRef.current) {
        const camTrack = localStreamRef.current.getVideoTracks()[0]
        peersRef.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          if (sender && camTrack) sender.replaceTrack(camTrack)
        })
        setLocalStream(localStreamRef.current)
      }
      setScreenOn(false)
      socketRef.current?.emit('media_state', { screen: false })
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        screenStreamRef.current = screen
        const vTrack = screen.getVideoTracks()[0]
        peersRef.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          if (sender) sender.replaceTrack(vTrack)
        })
        const mixed = new MediaStream([...(localStreamRef.current?.getAudioTracks() || []), vTrack])
        setLocalStream(mixed)
        setScreenOn(true)
        socketRef.current?.emit('media_state', { screen: true })
        vTrack.onended = toggleScreen
      } catch {}
    }
  }

  const toggleHand = () => {
    const next = !handRaised
    setHandRaised(next)
    socketRef.current?.emit('raise_hand', { raised: next })
  }

  const sendReaction = (emoji: string) => {
    socketRef.current?.emit('reaction', { emoji })
    addFloatingEmoji(emoji)
    setShowReactions(false)
  }

  const endCall = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    screenStreamRef.current?.getTracks().forEach(t => t.stop())
    peersRef.current.forEach(pc => pc.close())
    peersRef.current.clear()
    socketRef.current?.emit('leave_room', {})
    setPhase('ended')
    setTimeout(() => router.push('/'), 3000)
  }

  // ── Transcript helpers ─────────────────
  const sendTranscriptEntry = () => {
    const text = transcriptInput.trim()
    if (!text || !socketRef.current) return
    const elapsed = 0 // could calc from meeting start
    socketRef.current.emit('transcript_entry', { text, timestamp: elapsed })
    setTranscriptInput('')
    setShowTranscriptInput(false)
  }

  const requestSummary = () => {
    setRequestingSummary(true)
    socketRef.current?.emit('request_summary')
  }

  // ── Chat helpers ───────────────────────
  const sendMessage = (text: string) => {
    socketRef.current?.emit('send_message', { text })
  }

  const openChat = () => {
    setRightPanel(rightPanel === 'chat' ? 'none' : 'chat')
    setUnreadChat(0)
  }

  const openTranscript = () => {
    setRightPanel(rightPanel === 'transcript' ? 'none' : 'transcript')
  }

  // ── Notification helper ─────────────────
  const showNotif = (msg: string) => {
    setNotification(msg)
    setTimeout(() => setNotification(''), 3000)
  }

  const addFloatingEmoji = (emoji: string) => {
    const id = Math.random().toString(36).slice(2)
    const x = 20 + Math.random() * 60
    setFloatingEmojis(prev => [...prev, { id, emoji, x }])
    setTimeout(() => setFloatingEmojis(prev => prev.filter(e => e.id !== id)), 2000)
  }

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Grid layout calculation ────────────
  const allParticipants = [
    { sid: mySid, stream: localStream, name: myName || 'You', isLocal: true, audio: audioOn, video: videoOn, screen: screenOn, hand_raised: handRaised },
    ...remoteStreams.map(r => {
      const p = Object.values(participants).find(p => p.sid === r.sid)
      return { sid: r.sid, stream: r.stream, name: r.name, isLocal: false, audio: p?.audio ?? true, video: p?.video ?? true, screen: p?.screen ?? false, hand_raised: p?.hand_raised ?? false }
    })
  ]

  const count = allParticipants.length
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4

  // ── Pre-join screen ─────────────────────
  if (phase === 'prejoin') {
    return (
      <div style={{ height: '100vh', background: '#0d0d0d', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font)' }}>
        <div style={{ width: '100%', maxWidth: 900, display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 48, padding: '0 24px', alignItems: 'center' }}>
          
          {/* Camera preview */}
          <div>
            <div style={{ aspectRatio: '16/9', background: '#161618', borderRadius: 18, overflow: 'hidden', position: 'relative', marginBottom: 16 }}>
              <video ref={previewVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: previewVideo ? 'block' : 'none' }} />
              {!previewVideo && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#4f8ef7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 700, color: '#fff' }}>
                    {(myName || 'Y')[0].toUpperCase()}
                  </div>
                </div>
              )}
              {/* Preview controls */}
              <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 10 }}>
                {[
                  { active: previewAudio, onClick: togglePreviewAudio, onIcon: '🎙️', offIcon: '🔇', label: 'Mic' },
                  { active: previewVideo, onClick: togglePreviewVideo, onIcon: '📹', offIcon: '📷', label: 'Camera' },
                ].map(btn => (
                  <button key={btn.label} onClick={btn.onClick} style={{
                    width: 44, height: 44, borderRadius: '50%',
                    background: btn.active ? 'rgba(255,255,255,0.15)' : '#f45c5c',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, border: 'none', cursor: 'pointer', backdropFilter: 'blur(8px)',
                  }} title={btn.label}>
                    {btn.active ? btn.onIcon : btn.offIcon}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ textAlign: 'center', fontSize: 13, color: '#606068' }}>
              Your camera preview · {code.toUpperCase()}
            </div>
          </div>

          {/* Join form */}
          <div style={{ animation: 'fadeIn 0.4s ease' }}>
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #4f8ef7, #a78bfa)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, color: '#fff' }}>S</div>
              <span style={{ fontWeight: 600, fontSize: 18, color: '#f0f0f2' }}>Standup</span>
            </div>

            <h2 style={{ fontSize: 28, fontWeight: 600, color: '#f0f0f2', letterSpacing: '-1px', marginBottom: 8, lineHeight: 1.2 }}>
              Ready to join?
            </h2>
            <p style={{ color: '#606068', fontSize: 14, marginBottom: 28 }}>
              Meeting code: <span style={{ color: '#4f8ef7', fontWeight: 600, letterSpacing: '1px' }}>{code}</span>
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, color: '#a0a0a8', marginBottom: 8, fontWeight: 500 }}>Your name</label>
              <input
                value={myName}
                onChange={e => { setMyName(e.target.value); setNameError('') }}
                onKeyDown={e => e.key === 'Enter' && joinMeeting()}
                placeholder="Enter your name"
                autoFocus
                style={{
                  width: '100%', padding: '13px 16px',
                  background: '#1e1e21', border: `1px solid ${nameError ? '#f45c5c' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 12, color: '#f0f0f2', fontSize: 15, outline: 'none', fontFamily: 'inherit',
                }}
                onFocus={e => !nameError && (e.target.style.borderColor = 'rgba(79,142,247,0.5)')}
                onBlur={e => !nameError && (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
              />
              {nameError && <p style={{ color: '#f45c5c', fontSize: 12, marginTop: 6 }}>{nameError}</p>}
            </div>

            <button
              onClick={joinMeeting}
              style={{
                width: '100%', padding: '14px',
                background: 'linear-gradient(135deg, #4f8ef7, #3a7be8)',
                color: '#fff', borderRadius: 12, fontSize: 15, fontWeight: 600,
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 4px 20px rgba(79,142,247,0.35)',
              }}
            >
              Join Meeting
            </button>

            <div style={{ marginTop: 20, padding: '14px', background: '#161618', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
              <p style={{ fontSize: 12, color: '#606068', marginBottom: 8 }}>Share this link</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, fontSize: 12, color: '#a0a0a8', padding: '8px 12px', background: '#27272b', borderRadius: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {typeof window !== 'undefined' ? window.location.href : ''}
                </div>
                <button onClick={copyLink} style={{ padding: '8px 14px', background: copied ? '#3ecf6e' : '#27272b', borderRadius: 8, fontSize: 12, color: '#f0f0f2', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, transition: 'background 0.2s' }}>
                  {copied ? '✓' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Ended screen ────────────────────────
  if (phase === 'ended') {
    return (
      <div style={{ height: '100vh', background: '#0d0d0d', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font)', gap: 16 }}>
        <div style={{ fontSize: 48 }}>👋</div>
        <h2 style={{ fontSize: 28, fontWeight: 600, color: '#f0f0f2' }}>You left the meeting</h2>
        <p style={{ color: '#606068', fontSize: 14 }}>Redirecting to home…</p>
        <button onClick={() => router.push('/')} style={{ marginTop: 8, padding: '12px 28px', background: '#4f8ef7', color: '#fff', borderRadius: 9999, fontSize: 15, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          Go to Home
        </button>
      </div>
    )
  }

  // ── Meeting room ────────────────────────
  return (
    <div style={{ height: '100vh', background: '#0d0d0d', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font)', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: '#0d0d0d', borderBottom: '1px solid rgba(255,255,255,0.05)', zIndex: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #4f8ef7, #a78bfa)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, color: '#fff' }}>S</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#f0f0f2' }}>Standup</div>
            <div style={{ fontSize: 11, color: '#606068', fontFamily: 'monospace', letterSpacing: '0.5px' }}>{code}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={copyLink} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', background: copied ? 'rgba(62,207,110,0.1)' : '#1e1e21',
            border: `1px solid ${copied ? 'rgba(62,207,110,0.3)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 9999, fontSize: 12, color: copied ? '#3ecf6e' : '#a0a0a8',
            cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
          }}>
            {copied ? '✓ Copied' : '🔗 Copy link'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#1e1e21', borderRadius: 9999, fontSize: 12, color: '#a0a0a8' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3ecf6e', animation: 'pulse 2s infinite' }} />
            {Object.keys(participants).length + 1} in meeting
          </div>
        </div>
      </div>

      {/* Body: videos + optional right panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Video grid */}
        <div style={{ flex: 1, position: 'relative', padding: 10, overflow: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 10,
            height: '100%',
            alignContent: 'center',
          }}>
            {allParticipants.map(p => (
              <div key={p.sid} style={{ minHeight: 0, aspectRatio: '16/9' }}>
                <VideoTile
                  stream={p.stream}
                  name={p.name}
                  muted={p.isLocal}
                  audioEnabled={p.audio}
                  videoEnabled={p.video}
                  isLocal={p.isLocal}
                  isScreenShare={p.screen}
                  handRaised={p.hand_raised}
                  isSpeaking={speaking[p.sid] || false}
                  size={count === 1 ? 'large' : count <= 4 ? 'normal' : 'small'}
                />
              </div>
            ))}
          </div>

          {/* Floating emoji reactions */}
          {floatingEmojis.map(e => (
            <div key={e.id} style={{
              position: 'absolute', bottom: 80, left: `${e.x}%`,
              fontSize: 32, animation: 'floatUp 2s ease forwards',
              pointerEvents: 'none', zIndex: 50,
            }}>{e.emoji}</div>
          ))}

          {/* Notification toast */}
          {notification && (
            <div style={{
              position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(30,30,33,0.95)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 9999, padding: '8px 18px', fontSize: 13, color: '#f0f0f2',
              backdropFilter: 'blur(10px)', animation: 'fadeIn 0.2s ease', zIndex: 100,
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            }}>
              {notification}
            </div>
          )}

          {/* Transcript quick-input overlay */}
          {showTranscriptInput && (
            <div style={{
              position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
              width: 500, background: '#1e1e21', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 14, padding: 14, zIndex: 200, boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
              animation: 'slideUp 0.2s ease',
            }}>
              <p style={{ fontSize: 12, color: '#606068', marginBottom: 8 }}>📝 Add transcript entry (what you said)</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={transcriptInput}
                  onChange={e => setTranscriptInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendTranscriptEntry(); if (e.key === 'Escape') setShowTranscriptInput(false) }}
                  placeholder="Type what was said..."
                  autoFocus
                  style={{ flex: 1, padding: '10px 13px', background: '#27272b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 9, color: '#f0f0f2', fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                />
                <button onClick={sendTranscriptEntry} style={{ padding: '10px 16px', background: '#4f8ef7', borderRadius: 9, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 500 }}>Send</button>
                <button onClick={() => setShowTranscriptInput(false)} style={{ padding: '10px 12px', background: '#27272b', borderRadius: 9, color: '#a0a0a8', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>✕</button>
              </div>
            </div>
          )}
        </div>

        {/* Right panel */}
        {rightPanel !== 'none' && (
          <div style={{
            width: 340, background: '#161618', borderLeft: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', flexDirection: 'column', animation: 'slideRight 0.25s ease', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {[{ id: 'chat', label: '💬 Chat' }, { id: 'transcript', label: '📝 Notes' }].map(t => (
                  <button key={t.id} onClick={() => setRightPanel(t.id as any)} style={{
                    padding: '6px 14px', borderRadius: 9999, fontSize: 13, fontWeight: 500,
                    background: rightPanel === t.id ? '#27272b' : 'transparent',
                    color: rightPanel === t.id ? '#f0f0f2' : '#606068',
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>{t.label}</button>
                ))}
              </div>
              <button onClick={() => setRightPanel('none')} style={{ width: 28, height: 28, borderRadius: '50%', background: '#27272b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, border: 'none', cursor: 'pointer', color: '#a0a0a8' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {rightPanel === 'chat' && <ChatPanel messages={messages} mySid={mySid} onSend={sendMessage} />}
              {rightPanel === 'transcript' && (
                <TranscriptPanel
                  transcript={transcript}
                  summary={summary}
                  requesting={requestingSummary}
                  onRequestSummary={requestSummary}
                  mySid={mySid}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom control bar */}
      <div style={{ padding: '12px 24px', background: '#0d0d0d', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>

        {/* Left: time + code */}
        <div style={{ flex: 1 }}>
          <TimeDisplay code={code} />
        </div>

        {/* Center: main controls */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <CtrlBtn active={audioOn} onColor="#27272b" offColor="#f45c5c" onClick={toggleAudio} title={audioOn ? 'Mute' : 'Unmute'}>
            {audioOn ? <MicIcon /> : <MicOffIcon />}
          </CtrlBtn>

          <CtrlBtn active={videoOn} onColor="#27272b" offColor="#f45c5c" onClick={toggleVideo} title={videoOn ? 'Turn off camera' : 'Turn on camera'}>
            {videoOn ? <CamIcon /> : <CamOffIcon />}
          </CtrlBtn>

          <CtrlBtn active={!screenOn} onColor="#27272b" offColor="#4f8ef7" onClick={toggleScreen} title={screenOn ? 'Stop sharing' : 'Share screen'}>
            <ScreenIcon />
          </CtrlBtn>

          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.08)' }} />

          <CtrlBtn active={!handRaised} onColor="#27272b" offColor="#f5c842" onClick={toggleHand} title={handRaised ? 'Lower hand' : 'Raise hand'}>
            <span style={{ fontSize: 18 }}>✋</span>
          </CtrlBtn>

          {/* Reactions */}
          <div style={{ position: 'relative' }}>
            <CtrlBtn active={true} onColor="#27272b" onClick={() => setShowReactions(r => !r)} title="Reactions">
              <span style={{ fontSize: 18 }}>😊</span>
            </CtrlBtn>
            {showReactions && (
              <div style={{
                position: 'absolute', bottom: '110%', left: '50%', transform: 'translateX(-50%)',
                background: '#27272b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
                padding: 10, display: 'flex', gap: 6, flexWrap: 'wrap', width: 200,
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)', animation: 'scaleIn 0.15s ease', zIndex: 300,
              }}>
                {REACTIONS.map(e => (
                  <button key={e} onClick={() => sendReaction(e)} style={{ width: 36, height: 36, borderRadius: 9, background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={el => (el.target as HTMLElement).style.background = '#3c3c42'}
                    onMouseLeave={el => (el.target as HTMLElement).style.background = 'transparent'}
                  >{e}</button>
                ))}
              </div>
            )}
          </div>

          {/* Transcript entry */}
          <CtrlBtn active={true} onColor="#27272b" onClick={() => setShowTranscriptInput(v => !v)} title="Add transcript">
            <span style={{ fontSize: 16 }}>📝</span>
          </CtrlBtn>

          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.08)' }} />

          {/* End call */}
          <button onClick={endCall} style={{
            padding: '12px 24px', background: '#f45c5c', color: '#fff',
            borderRadius: 9999, fontSize: 14, fontWeight: 600,
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 8,
            transition: 'background 0.2s',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = '#e04444')}
            onMouseLeave={e => (e.currentTarget.style.background = '#f45c5c')}
          >
            <PhoneIcon /> Leave
          </button>
        </div>

        {/* Right: panel toggles */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <PanelBtn active={rightPanel === 'chat'} onClick={openChat} badge={unreadChat > 0 ? unreadChat : 0} title="Chat">
            <ChatIcon />
          </PanelBtn>
          <PanelBtn active={rightPanel === 'transcript'} onClick={openTranscript} title="Notes & Summary">
            <NotesIcon />
          </PanelBtn>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────

function TimeDisplay({ code }: { code: string }) {
  const [time, setTime] = useState('')
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 500, color: '#f0f0f2' }}>{time}</div>
      <div style={{ fontSize: 11, color: '#606068', letterSpacing: '0.5px' }}>{code}</div>
    </div>
  )
}

function CtrlBtn({ children, active, onColor, offColor, onClick, title }: { children: React.ReactNode; active: boolean; onColor: string; offColor?: string; onClick: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 46, height: 46, borderRadius: '50%',
      background: active ? onColor : (offColor || '#27272b'),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: 'none', cursor: 'pointer', transition: 'all 0.15s',
      position: 'relative',
    }}
      onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.2)')}
      onMouseLeave={e => (e.currentTarget.style.filter = 'brightness(1)')}
    >{children}</button>
  )
}

function PanelBtn({ children, active, onClick, badge = 0, title }: { children: React.ReactNode; active: boolean; onClick: () => void; badge?: number; title?: string }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 42, height: 42, borderRadius: 10,
      background: active ? '#27272b' : 'transparent',
      border: active ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', position: 'relative', transition: 'all 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = '#27272b')}
      onMouseLeave={e => !active && (e.currentTarget.style.background = 'transparent')}
    >
      {children}
      {badge > 0 && (
        <div style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: '50%', background: '#f45c5c', fontSize: 10, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {badge > 9 ? '9+' : badge}
        </div>
      )}
    </button>
  )
}

// SVG icons
const MicIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
const MicOffIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
const CamIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
const CamOffIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34"/><path d="M16 11.37A4 4 0 1 1 12.63 8"/></svg>
const ScreenIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
const PhoneIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.5 16.5l-3.77 3.77a14 14 0 0 1-6.99-6.99l3.77-3.77"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07"/></svg>
const ChatIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a0a0a8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
const NotesIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a0a0a8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
