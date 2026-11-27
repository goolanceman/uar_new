/**
 * Media asset repository contract — persistence for the media pipeline.
 * The service layer depends on this interface, never on Prisma directly.
 */
export interface MediaAssetRow {
  id: string;
  ownerId: string;
  purpose: string;
  status: string;
  sourceKey: string;
  sourceMime: string;
  sourceSize: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hlsKey: string | null;
  mp4Key: string | null;
  posterKey: string | null;
  error: string | null;
  attempts: number;
  lockedAt: Date | null;
  readyAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMediaAssetData {
  ownerId: string;
  purpose: string;
  sourceKey: string;
  sourceMime: string;
  sourceSize: number;
}

export interface MediaRepository {
  /**
   * Non-terminal assets owned by the user — pending_upload rows created
   * before `stalePendingBefore` don't count (URL expired / upload abandoned).
   */
  countInFlight(ownerId: string, stalePendingBefore: Date): Promise<number>;
  create(data: CreateMediaAssetData): Promise<MediaAssetRow>;
  updateSourceKey(id: string, sourceKey: string): Promise<void>;
  findById(id: string): Promise<MediaAssetRow | null>;
  /** Playback existence probe (GET /files/*) — id + status only. */
  findPlaybackRef(id: string): Promise<{ id: string; status: string } | null>;
}
