import { admin, json } from "@/lib/http";
import { pushAll } from "@/lib/push";

export const dynamic = "force-dynamic";
export const POST = admin(async () => {
  const n = await pushAll({ title: "FCCTV test alert ✓", body: "Notifications are working on this device.", url: "/alerts", tag: "test" });
  return json({ sent: n });
});
