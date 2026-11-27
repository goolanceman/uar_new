/**
 * Prisma implementation of the file repository — the ONLY place in the files
 * module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { Prisma } from "@prisma/client";
import type {
  FileAssetRow,
  FileDownloadRow,
  FileListFilters,
  FileRepository,
  FileStats,
  UpdateFileData,
} from "./file.repository.interface";

export class PrismaFileRepository implements FileRepository {
  async list(
    filters: FileListFilters,
    skip: number,
    limit: number
  ): Promise<{ items: FileAssetRow[]; total: number }> {
    const where: Prisma.FileAssetWhereInput = {};
    if (filters.q) where.OR = [{ name: { contains: filters.q } }, { title: { contains: filters.q } }];
    if (filters.folder) where.folder = filters.folder;
    if (filters.mime) where.mime = { startsWith: filters.mime };

    const [items, total] = await Promise.all([
      db.fileAsset.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      db.fileAsset.count({ where }),
    ]);
    return { items, total };
  }

  /** Global {count,totalBytes} stats on the unfiltered first page. */
  async stats(): Promise<FileStats> {
    const [count, agg] = await Promise.all([
      db.fileAsset.count(),
      db.fileAsset.aggregate({ _sum: { size: true } }),
    ]);
    return { count, totalBytes: agg._sum.size ?? 0 };
  }

  async findById(id: string): Promise<FileAssetRow | null> {
    return db.fileAsset.findUnique({ where: { id } });
  }

  async findForDownload(id: string): Promise<FileDownloadRow | null> {
    return db.fileAsset.findUnique({
      where: { id },
      select: { id: true, name: true, storedName: true, mime: true, uploadedById: true },
    });
  }

  async update(id: string, data: UpdateFileData): Promise<FileAssetRow> {
    return mapPrismaError(() => db.fileAsset.update({ where: { id }, data }));
  }

  async delete(id: string): Promise<void> {
    await db.fileAsset.delete({ where: { id } });
  }
}
