/**
 * File repository contract — persistence operations for the file manager and
 * the download lookup (cached row shape). The service depends on this
 * interface, never on Prisma directly.
 */
import type { Prisma } from "@prisma/client";

export type FileAssetRow = Prisma.FileAssetGetPayload<Record<string, never>>;

export interface FileListFilters {
  q?: string;
  folder?: string;
  mime?: string;
}

export interface FileStats {
  count: number;
  totalBytes: number;
}

/** Shape of the download cache row (id, name, storedName, mime, uploadedById). */
export interface FileDownloadRow {
  id: string;
  name: string;
  storedName: string;
  mime: string;
  uploadedById: string | null;
}

export interface UpdateFileData {
  title?: string | null;
  description?: string | null;
  folder?: string;
}

export interface FileRepository {
  list(
    filters: FileListFilters,
    skip: number,
    limit: number
  ): Promise<{ items: FileAssetRow[]; total: number }>;
  stats(): Promise<FileStats>;
  findById(id: string): Promise<FileAssetRow | null>;
  findForDownload(id: string): Promise<FileDownloadRow | null>;
  update(id: string, data: UpdateFileData): Promise<FileAssetRow>;
  delete(id: string): Promise<void>;
}
