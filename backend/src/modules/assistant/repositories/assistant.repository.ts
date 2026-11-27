/**
 * Assistant repository implementation — adapts the shared knowledge base and
 * live-ops libs (read-only shared domain code; no new Prisma access here).
 */
import { retrieve, HELPLINES, SUGGESTED_QUESTIONS } from "@/lib/assistant-knowledge";
import { buildLiveOpsContext } from "@/lib/assistant-ops";
import type { AssistantRepository, Helplines } from "./assistant.repository.interface";

export class LibAssistantRepository implements AssistantRepository {
  retrieveChunks(query: string, topK: number) {
    return retrieve(query, topK);
  }

  buildLiveOpsContext(message: string, role: string) {
    return buildLiveOpsContext(message, role);
  }

  suggestedQuestions(): string[] {
    return [...SUGGESTED_QUESTIONS];
  }

  helplines(): Helplines {
    return HELPLINES;
  }
}
