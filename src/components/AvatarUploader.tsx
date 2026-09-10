"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "./Avatar";
import { buttonClass } from "@/lib/buttonStyles";

const VIEWPORT = 220; // px, square
const MAX_BYTES = 8 * 1024 * 1024;
const OUTPUT_SIZE = 400;

export default function AvatarUploader({ avatarUrl }: { avatarUrl: string | null }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseScale = naturalSize ? Math.max(VIEWPORT / naturalSize.w, VIEWPORT / naturalSize.h) : 1;
  const scale = baseScale * zoom;
  const dispW = (naturalSize?.w ?? 0) * scale;
  const dispH = (naturalSize?.h ?? 0) * scale;

  function clamp(x: number, y: number) {
    const minX = Math.min(0, VIEWPORT - dispW);
    const minY = Math.min(0, VIEWPORT - dispH);
    return { x: Math.max(minX, Math.min(0, x)), y: Math.max(minY, Math.min(0, y)) };
  }

  function pickFile(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("That file isn't an image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That image is too large (8MB max).");
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(URL.createObjectURL(file));
    setNaturalSize(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function onImageLoad() {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setNaturalSize({ w, h });
    const initialScale = Math.max(VIEWPORT / w, VIEWPORT / h);
    setOffset({ x: (VIEWPORT - w * initialScale) / 2, y: (VIEWPORT - h * initialScale) / 2 });
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, offsetX: offset.x, offsetY: offset.y };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clamp(dragRef.current.offsetX + dx, dragRef.current.offsetY + dy));
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function onZoomChange(value: number) {
    if (!naturalSize) return;
    setZoom(value);
    // Re-center on zoom rather than trying to zoom toward the drag focus --
    // simple and predictable, matches a slider (not pinch) interaction.
    const newScale = baseScale * value;
    setOffset({
      x: (VIEWPORT - naturalSize.w * newScale) / 2,
      y: (VIEWPORT - naturalSize.h * newScale) / 2,
    });
  }

  function cancel() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(null);
    setNaturalSize(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function save() {
    const img = imgRef.current;
    if (!img || !naturalSize) return;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // The crop area is exactly the VIEWPORT square in display space; map it
    // back to source-image pixel coordinates using the uniform scale factor
    // (offset is where the image's top-left sits relative to the viewport).
    const sx = -offset.x / scale;
    const sy = -offset.y / scale;
    const sSize = VIEWPORT / scale;
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    setSaving(true);
    setError(null);
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          setSaving(false);
          setError("Couldn't process that image.");
          return;
        }
        const formData = new FormData();
        formData.set("avatar", blob, "avatar.jpg");
        const res = await fetch("/api/profile/avatar", { method: "POST", body: formData });
        setSaving(false);
        if (!res.ok) {
          setError("Couldn't save your photo. Try again.");
          return;
        }
        cancel();
        router.refresh();
      },
      "image/jpeg",
      0.85
    );
  }

  async function remove() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/profile/avatar", { method: "DELETE" });
    setSaving(false);
    if (!res.ok) {
      setError("Couldn't remove your photo. Try again.");
      return;
    }
    router.refresh();
  }

  if (!objectUrl) {
    return (
      <div className="flex items-center gap-4">
        <Avatar url={avatarUrl} size="lg" />
        <div className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) pickFile(file);
            }}
          />
          <button
            type="button"
            className={buttonClass("secondary")}
            onClick={() => fileInputRef.current?.click()}
          >
            {avatarUrl ? "Change photo" : "Add photo"}
          </button>
          {avatarUrl && (
            <button
              type="button"
              className="text-sm text-link underline disabled:cursor-not-allowed disabled:text-fg-muted"
              onClick={remove}
              disabled={saving}
            >
              Remove photo
            </button>
          )}
          {error && <p className="text-sm text-error-fg">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative touch-none overflow-hidden rounded-full bg-active"
        style={{ width: VIEWPORT, height: VIEWPORT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- source for
            manual canvas cropping; a live crop preview isn't a fit for
            next/image's fixed-layout model. */}
        <img
          ref={imgRef}
          src={objectUrl}
          alt=""
          draggable={false}
          onLoad={onImageLoad}
          style={{
            position: "absolute",
            left: offset.x,
            top: offset.y,
            width: dispW || undefined,
            height: dispH || undefined,
          }}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        Zoom
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => onZoomChange(Number(e.target.value))}
          className="flex-1"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass("primary", { disabled: saving || !naturalSize })}
          disabled={saving || !naturalSize}
          onClick={save}
        >
          {saving ? "Saving…" : "Save photo"}
        </button>
        <button type="button" className={buttonClass("secondary")} onClick={cancel} disabled={saving}>
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-error-fg">{error}</p>}
    </div>
  );
}
