import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";
import type { EvidenceFile } from "./types";

type ImageKitAuth = { token: string; expire: number; signature: string };
type UploadResult = { fileId: string; filePath: string; url: string };

function callable<TInput, TOutput>(name: string) {
  if (!app) throw new Error("Firebase is not configured.");
  return httpsCallable<TInput, TOutput>(getFunctions(app, "us-central1"), name);
}

export async function uploadToImageKit(
  clientId: string,
  recordId: string,
  file: File,
  purpose: "labels" | "returns",
): Promise<EvidenceFile> {
  const publicKey = import.meta.env.VITE_IMAGEKIT_PUBLIC_KEY?.trim();
  if (!publicKey) throw new Error("Add VITE_IMAGEKIT_PUBLIC_KEY to .env.local and restart the app.");

  const auth = await callable<{ clientId: string }, ImageKitAuth>("createImageKitUploadAuth")({ clientId });
  const body = new FormData();
  body.append("file", file);
  body.append("fileName", file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "upload");
  body.append("publicKey", publicKey);
  body.append("token", auth.data.token);
  body.append("expire", String(auth.data.expire));
  body.append("signature", auth.data.signature);
  body.append("folder", `/parceldesk/${clientId}/${purpose}/${recordId}`);
  body.append("useUniqueFileName", "true");
  body.append("isPrivateFile", "true");

  const response = await fetch("https://upload.imagekit.io/api/v1/files/upload", { method: "POST", body });
  const payload = await response.json().catch(() => null) as (UploadResult & { message?: string }) | null;
  if (!response.ok || !payload?.fileId || !payload.filePath || !payload.url) {
    throw new Error(payload?.message || `ImageKit upload failed (${response.status}).`);
  }

  return {
    name: file.name,
    path: payload.filePath,
    url: payload.url,
    provider: "imagekit",
    fileId: payload.fileId,
    contentType: file.type || "application/octet-stream",
    size: file.size,
  };
}

export async function deleteImageKitAsset(clientId: string, fileId: string): Promise<void> {
  await callable<{ clientId: string; fileId: string }, { deleted: true }>("deleteImageKitAsset")({ clientId, fileId });
}

export async function getImageKitReturnUrl(returnId: string, fileId: string): Promise<string> {
  const result = await callable<{ returnId: string; fileId: string }, { url: string }>("getImageKitReturnUrl")({ returnId, fileId });
  return result.data.url;
}
