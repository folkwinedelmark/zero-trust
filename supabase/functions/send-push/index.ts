import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ||
  "mailto:admin@zero-trust-game.com";

function vapidReady() {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY mancanti nei secrets.");
  }
  webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
}

function notificationFromWebhook(payload: Record<string, unknown>) {
  const record = (payload.record ?? payload.new ?? payload) as Record<string, unknown>;
  if (!record || typeof record !== "object") return null;
  const userId = record.user_id;
  if (typeof userId !== "string" || !userId) return null;
  return {
    user_id: userId,
    title: typeof record.title === "string" ? record.title : "Zero Trust",
    body: typeof record.body === "string"
      ? record.body
      : "Nuovo avviso di sistema",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }

  try {
    vapidReady();

    const payload = await req.json();
    const notification = notificationFromWebhook(payload);

    if (!notification) {
      return new Response("Invalid payload", { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: profile } = await supabase
      .from("profiles")
      .select("settings")
      .eq("id", notification.user_id)
      .maybeSingle();

    if (profile?.settings?.push_notifications === false) {
      return new Response("Push disabled for user", { status: 200 });
    }

    const { data: subscriptions, error } = await supabase
      .from("push_subscriptions")
      .select("endpoint, auth_key, p256dh_key")
      .eq("user_id", notification.user_id);

    if (error || !subscriptions || subscriptions.length === 0) {
      return new Response("No active subscriptions found for user", {
        status: 200,
      });
    }

    const pushPayload = JSON.stringify({
      title: notification.title,
      body: notification.body,
    });

    const sendPromises = subscriptions.map((sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh_key,
          auth: sub.auth_key,
        },
      };

      return webpush
        .sendNotification(pushSubscription, pushPayload)
        .catch(async (err: { statusCode?: number }) => {
          console.error("Error sending push to endpoint:", sub.endpoint, err);
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase
              .from("push_subscriptions")
              .delete()
              .eq("endpoint", sub.endpoint);
          }
        });
    });

    await Promise.all(sendPromises);

    return new Response("Push notifications dispatched successfully", {
      status: 200,
    });
  } catch (err) {
    console.error("Server error:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
});
