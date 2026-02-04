import { getSession } from "@/lib/session";
import { successResponse } from "@/lib/api-response";

export async function POST() {
  const session = await getSession();
  await session.destroy();

  return successResponse({ message: "Logged out" });
}
