'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker so the board keeps working offline.
 *
 * On iPad this matters more than it looks: Safari evicts IndexedDB for sites
 * that are not installed to the home screen after about a week of disuse, and
 * a communication board that vanishes is a catastrophic failure rather than a
 * bug. Installed PWAs are exempt, so the install prompt is a data-durability
 * feature here, not a nicety.
 */
export function RegisterSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration failing costs offline support, not the board itself.
      })
    }
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad)
    return () => window.removeEventListener('load', onLoad)
  }, [])

  return null
}
