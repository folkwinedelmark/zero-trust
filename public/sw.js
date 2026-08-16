/* ZERO TRUST — service worker: installability + background push */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  event.waitUntil(
    (async () => {
      let data = {}
      try {
        data = event.data.json()
      } catch {
        data = { body: event.data.text() }
      }
      const options = {
        body: data.body || 'Nuova attività rilevata',
        icon: '/logo.png',
        badge: '/favicon.png',
        data,
      }
      await self.registration.showNotification(
        data.title || 'Zero Trust',
        options,
      )
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((c) => 'focus' in c)
        if (existing) return existing.focus()
        if (self.clients.openWindow) return self.clients.openWindow('/')
        return undefined
      }),
  )
})
