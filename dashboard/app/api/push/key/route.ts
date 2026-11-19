import { admin, json } from "@/lib/http";
import { vapid } from "@/lib/push";

export const dynamic = "force-dynamic";
export const GET = admin(async () => json({ publicKey: (await vapid()).publicKey }));
