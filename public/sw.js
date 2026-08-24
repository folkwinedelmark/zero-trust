/* ZERO TRUST — service worker: installability + background push */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

function parsePushData(event) {
  if (!event.data) return {}
  try {
    return event.data.json()
  } catch {
    return { body: event.data.text() }
  }
}

self.addEventListener('push', (event) => {
  const data = parsePushData(event)
  const options = {
    body: data.body || 'Nuova attività di rete rilevata',
    icon: '/logo.png',
    badge: '/favicon.png',
    vibrate: [200, 100, 200, 100, 200],
    data: {
      url: data.url || self.registration.scope,
    },
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Zero Trust', options),
  )
})

function clientBelongsToApp(client) {
  const scope = self.registration.scope
  try {
    return new URL(client.url).origin === new URL(scope).origin
  } catch {
    return String(client.url || '').startsWith(scope)
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl =
    event.notification.data?.url || self.registration.scope || '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (let i = 0; i < clientList.length; i += 1) {
          const client = clientList[i]
          if (clientBelongsToApp(client) && 'focus' in client) {
            return client.focus()
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }
        return undefined
      }),
  )
})
