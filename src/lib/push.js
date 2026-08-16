import { supabase } from './supabase'

export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

function keysFromSubscription(subscription) {
  const json = subscription.toJSON()
  const endpoint = json.endpoint || subscription.endpoint
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    throw new Error('Subscription Push incompleta.')
  }
  return { endpoint, p256dh_key: p256dh, auth_key: auth }
}

export async function enablePushSubscription() {
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!vapid) {
    return {
      error: new Error(
        'Chiave VAPID pubblica mancante. Imposta VITE_VAPID_PUBLIC_KEY nel .env.',
      ),
    }
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { error: new Error('Push non supportate da questo browser.') }
  }

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid),
  })
  const keys = keysFromSubscription(subscription)

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user?.id) {
    return { error: userError ?? new Error('Sessione non valida.') }
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint: keys.endpoint,
      auth_key: keys.auth_key,
      p256dh_key: keys.p256dh_key,
    },
    { onConflict: 'user_id,endpoint' },
  )
  if (error) return { error }
  return { data: keys }
}

export async function disablePushSubscription() {
  let endpoint = null
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        endpoint = subscription.endpoint
        await subscription.unsubscribe()
      }
    } catch {
      /* il delete sul DB resta comunque */
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return { error: null }

  let query = supabase.from('push_subscriptions').delete().eq('user_id', user.id)
  if (endpoint) query = query.eq('endpoint', endpoint)
  const { error } = await query
  return { error }
}
