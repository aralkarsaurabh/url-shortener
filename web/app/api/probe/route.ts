import { runProbe } from "@/features/probe/api/runProbe";
import { serviceUrls } from "@/features/probe/api/services";
import { validateProbe } from "@/features/probe/api/validateProbe";

// A testing tool: lets the page send requests to the local services and see everything that
// comes back. It only reaches the addresses in serviceUrls().
export async function GET() {
  return Response.json({ services: serviceUrls() });
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  const checked = validateProbe(input, serviceUrls());
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
  return Response.json(await runProbe(checked.value));
}
