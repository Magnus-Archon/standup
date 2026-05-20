'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Socket } from 'socket.io-client'

export interface RemoteStream {
  sid: string
  stream: MediaStream
  name: string
}

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
}

export function useWebRTC(socket: Socket | null, roomCode: string) {
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([])
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [screenSharing, setScreenSharing] = useState(false)
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())

  // Init local media
  const initLocalStream = useCallback(async (audio = true, video = true) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
        video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : false,
      })
      localStreamRef.current = stream
      setLocalStream(stream)
      return stream
    } catch (err) {
      // Try audio only if video fails
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        localStreamRef.current = stream
        setLocalStream(stream)
        setVideoEnabled(false)
        return stream
      } catch {
        return null
      }
    }
  }, [])

  const createPeer = useCallback((targetSid: string, initiator: boolean, targetName: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(ICE_SERVERS)
    peersRef.current.set(targetSid, pc)

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!)
      })
    }

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc_ice_candidate', { target: targetSid, candidate: event.candidate })
      }
    }

    // Remote stream
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams
      setRemoteStreams(prev => {
        const exists = prev.find(r => r.sid === targetSid)
        if (exists) {
          return prev.map(r => r.sid === targetSid ? { ...r, stream: remoteStream } : r)
        }
        return [...prev, { sid: targetSid, stream: remoteStream, name: targetName }]
      })
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        peersRef.current.delete(targetSid)
        setRemoteStreams(prev => prev.filter(r => r.sid !== targetSid))
      }
    }

    // If initiator, create offer
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          if (socket) {
            socket.emit('webrtc_offer', { target: targetSid, offer: pc.localDescription })
          }
        } catch (err) {
          console.error('Offer error:', err)
        }
      }
    }

    return pc
  }, [socket])

  // Handle socket signaling events
  useEffect(() => {
    if (!socket) return

    const handleOffer = async ({ offer, from, from_name }: any) => {
      let pc = peersRef.current.get(from)
      if (!pc) {
        pc = createPeer(from, false, from_name || from)
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socket.emit('webrtc_answer', { target: from, answer: pc.localDescription })

        // Flush pending candidates
        const pending = pendingCandidates.current.get(from) || []
        for (const c of pending) {
          await pc.addIceCandidate(new RTCIceCandidate(c))
        }
        pendingCandidates.current.delete(from)
      } catch (err) {
        console.error('Handle offer error:', err)
      }
    }

    const handleAnswer = async ({ answer, from }: any) => {
      const pc = peersRef.current.get(from)
      if (!pc) return
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer))
        const pending = pendingCandidates.current.get(from) || []
        for (const c of pending) {
          await pc.addIceCandidate(new RTCIceCandidate(c))
        }
        pendingCandidates.current.delete(from)
      } catch (err) {
        console.error('Handle answer error:', err)
      }
    }

    const handleCandidate = async ({ candidate, from }: any) => {
      const pc = peersRef.current.get(from)
      if (!pc || !pc.remoteDescription) {
        // Queue it
        const q = pendingCandidates.current.get(from) || []
        q.push(candidate)
        pendingCandidates.current.set(from, q)
        return
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
      } catch (err) {
        console.error('ICE candidate error:', err)
      }
    }

    socket.on('webrtc_offer', handleOffer)
    socket.on('webrtc_answer', handleAnswer)
    socket.on('webrtc_ice_candidate', handleCandidate)

    return () => {
      socket.off('webrtc_offer', handleOffer)
      socket.off('webrtc_answer', handleAnswer)
      socket.off('webrtc_ice_candidate', handleCandidate)
    }
  }, [socket, createPeer])

  const connectToPeer = useCallback((sid: string, name: string) => {
    if (!peersRef.current.has(sid)) {
      createPeer(sid, true, name)
    }
  }, [createPeer])

  const disconnectPeer = useCallback((sid: string) => {
    const pc = peersRef.current.get(sid)
    if (pc) {
      pc.close()
      peersRef.current.delete(sid)
    }
    setRemoteStreams(prev => prev.filter(r => r.sid !== sid))
  }, [])

  const toggleAudio = useCallback(() => {
    if (!localStreamRef.current) return
    const enabled = !audioEnabled
    localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = enabled })
    setAudioEnabled(enabled)
    return enabled
  }, [audioEnabled])

  const toggleVideo = useCallback(() => {
    if (!localStreamRef.current) return
    const enabled = !videoEnabled
    localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = enabled })
    setVideoEnabled(enabled)
    return enabled
  }, [videoEnabled])

  const startScreenShare = useCallback(async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      screenStreamRef.current = screen

      // Replace video track in all peers
      const videoTrack = screen.getVideoTracks()[0]
      peersRef.current.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) sender.replaceTrack(videoTrack)
      })

      // Update local stream preview
      const mixed = new MediaStream([
        ...(localStreamRef.current?.getAudioTracks() || []),
        videoTrack,
      ])
      setLocalStream(mixed)
      setScreenSharing(true)

      screen.getVideoTracks()[0].onended = () => stopScreenShare()
    } catch (err) {
      console.error('Screen share error:', err)
    }
  }, [])

  const stopScreenShare = useCallback(() => {
    if (!screenStreamRef.current) return
    screenStreamRef.current.getTracks().forEach(t => t.stop())
    screenStreamRef.current = null

    // Restore camera
    if (localStreamRef.current) {
      const camTrack = localStreamRef.current.getVideoTracks()[0]
      if (camTrack) {
        peersRef.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          if (sender) sender.replaceTrack(camTrack)
        })
      }
      setLocalStream(localStreamRef.current)
    }
    setScreenSharing(false)
  }, [])

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    screenStreamRef.current?.getTracks().forEach(t => t.stop())
    peersRef.current.forEach(pc => pc.close())
    peersRef.current.clear()
    setLocalStream(null)
    setRemoteStreams([])
  }, [])

  return {
    localStream,
    remoteStreams,
    audioEnabled,
    videoEnabled,
    screenSharing,
    initLocalStream,
    connectToPeer,
    disconnectPeer,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    cleanup,
  }
}
