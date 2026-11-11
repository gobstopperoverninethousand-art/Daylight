import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { failure, limited, readBody, requireUser } from "@/lib/server/auth";
import { accessToken } from "@/lib/server/google";
import {
  deleteImportedEvent,
  moveImportedEvent,
  readGoogleEventInfo,
} from "@/lib/server/google-events";
import { eventTimeSchema } from "@/lib/google-event-edit";

const ref = z.object({
  calendarId: z
    .string()
    .min(1)
    .max(1024)
    .refine((id) => id !== "primary" && id !== "." && id !== ".."),
  eventId: z.string().regex(/^[a-zA-Z0-9_-]{1,1024}$/),
});
const request = ref.extend({
  etag: z.string().regex(/^"[\x21\x23-\x7E]{1,200}"$/),
});

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const event = ref.parse(Object.fromEntries(req.nextUrl.searchParams));
    await limited(user.id, "google-event-details", 100);
    return NextResponse.json(
      await readGoogleEventInfo(await accessToken(user.id), event),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { time, ...event } = request
      .extend({ time: eventTimeSchema })
      .parse(await readBody(req));
    await limited(user.id, "google-event-move", 60);
    return NextResponse.json({
      event: await moveImportedEvent(
        await accessToken(user.id),
        user.id,
        event,
        time,
      ),
    });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const event = request.parse(await readBody(req));
    await limited(user.id, "google-event-delete", 30);
    await deleteImportedEvent(await accessToken(user.id), user.id, event);
    return NextResponse.json({ deleted: true });
  } catch (e) {
    return failure(e);
  }
}
