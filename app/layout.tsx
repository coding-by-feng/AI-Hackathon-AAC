import type { Metadata, Viewport } from 'next'
import './globals.css'
import { RegisterSW } from '@/components/kid/register-sw'

export const metadata: Metadata = {
  title: 'AAC',
  description: 'Communication board and communication analytics',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'AAC' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // An AAC user must never be able to pinch the board out of alignment
  // mid-sentence, but text scaling stays available through the OS.
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  )
}
