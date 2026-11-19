"use client";
import { api } from "./client";

function urlB64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  return !!(await reg?.pushManager.getSubscription()) && Notification.permission === "granted";
}

/** Asks permission and registers this phone/browser for alert notifications. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("This browser can't show notifications. On Android use Chrome.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications are blocked. Allow them for fcctv.vercel.app in Chrome settings.");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>("/api/push/key");
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) }));
  await api("/api/push/subscribe", { method: "POST", body: JSON.stringify({ ...sub.toJSON(), label: navigator.userAgent.slice(0, 80) }) });
}
