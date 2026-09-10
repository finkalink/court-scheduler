import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("avatar");

  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Not an image" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image is too large" }, { status: 400 });
  }

  const path = `${user.id}/avatar.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: "image/jpeg" });

  if (uploadError) {
    console.error("avatar upload failed:", uploadError);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  // Cache-bust: the stored object path is fixed per user, so a re-upload
  // would otherwise keep serving the old cached image at the same URL.
  const { data: publicUrlData } = supabase.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await supabase
    .from("users")
    .update({ avatar_url: avatarUrl })
    .eq("id", user.id);

  if (updateError) {
    console.error("avatar url save failed:", updateError);
    return NextResponse.json({ error: "Couldn't save your photo" }, { status: 500 });
  }

  return NextResponse.json({ avatarUrl });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Best-effort -- a missing object (already removed, or never uploaded)
  // isn't worth surfacing as an error to the caller.
  await supabase.storage.from("avatars").remove([`${user.id}/avatar.jpg`]);

  const { error } = await supabase.from("users").update({ avatar_url: null }).eq("id", user.id);
  if (error) {
    return NextResponse.json({ error: "Couldn't remove your photo" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
