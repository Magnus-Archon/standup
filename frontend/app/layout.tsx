import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Standup – Video Meetings',
  description: 'Fast, focused video meetings with smart note-taking',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ height: '100vh', overflow: 'hidden' }}>{children}</body>
    </html>
  )
}
