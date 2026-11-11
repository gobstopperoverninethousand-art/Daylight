import { NextResponse } from "next/server";
import { aiConfigured, aiModel } from "@/lib/server/ai";
export async function GET() {
  return NextResponse.json(
    {
      supabaseConfigured: !!(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
      ),
      googleConfigured: !!(
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.TOKEN_ENCRYPTION_KEY
      ),
      aiConfigured: aiConfigured(),
      aiProvider: "Google Gemini",
      aiModel: aiModel(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
