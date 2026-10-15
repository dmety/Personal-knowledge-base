import { AppError, blankEntry, magicMime, type Entry } from "./model";
import type { Repository } from "./repository";

export const captureLimit = 40 * 1024 * 1024;
export async function captureRecord(repo: Repository, requestId: string, content: string, files: File[]) {
  if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new AppError("提交标识无效");
  if (content.length > 100000 || files.length > 10 || !content.trim() && !files.length) throw new AppError("请写点内容或选择照片，最多 10 张");
  if (files.reduce((n, f) => n + f.size, 0) > captureLimit) throw new AppError("照片总量超过 40 MB", 413);
  const prepared = [];
  for (const [index, file] of files.entries()) {
    if (!file.size || file.size > 20 * 1024 * 1024) throw new AppError("每张照片应在 20 MB 以内");
    const bytes = new Uint8Array(await file.arrayBuffer()), mime = magicMime(bytes);
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime) || file.type && file.type !== mime) throw new AppError("支持 JPEG、PNG、WebP；HEIC 等格式请先转换");
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
    prepared.push({id: `capture-${requestId}-${index}`, name: file.name.slice(0, 200) || "照片", bytes, mime: mime as "image/jpeg" | "image/png" | "image/webp", digest});
  }
  const signature = JSON.stringify([content, prepared.map(f => [f.name, f.mime, f.digest])]);
  const fingerprint = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature)))].map(b => b.toString(16).padStart(2, "0")).join("");
  const id = `capture-${requestId}`;
  const existing = await repo.get(id).catch(e => {if (e instanceof AppError && e.status === 404) return null; throw e;});
  if (existing) {
    if (existing.capture_fingerprint !== fingerprint) throw new AppError("这次提交已保存；修改内容请使用新的提交", 409);
    return existing;
  }
  // Content-addressed file paths make overlapping retries safe even with different payloads.
  for (const [index,f] of prepared.entries()) {f.id = `capture-${f.digest}-${index}`; await repo.putAsset(f.id, f.bytes, f.mime);}
  const attachments = prepared.map(f => ({id: f.id, name: f.name, mime: f.mime, size: f.bytes.length, path: `assets/${f.id}`}));
  const title = content.trim().split(/\r?\n/)[0]?.slice(0, 80) || `照片记录 · ${new Date().toLocaleDateString("zh-CN", {timeZone: "Asia/Shanghai"})}`;
  const entry: Entry = blankEntry({id, title, content, original_content: content, capture_fingerprint: fingerprint, attachments});
  try {await repo.commit([{before: null, after: entry, action: "随手记"}], "human");}
  catch (e) {
    if (!(e instanceof AppError) || e.status !== 409) throw e;
    const saved = await repo.get(id);
    if (saved.capture_fingerprint !== fingerprint) throw new AppError("提交内容冲突，请刷新后重试", 409);
  }
  return repo.get(id);
}
