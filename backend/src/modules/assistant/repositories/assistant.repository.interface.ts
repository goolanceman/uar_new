/**
 * Assistant repository contract — knowledge/live-ops data access for the chat
 * service. Retrieval and the ops snapshot are the module's data sources (the
 * libs behind them own any Prisma access); the LLM SDK call stays in the
 * service.
 */
import type { KnowledgeEntry } from "@/modules/assistant/services/assistant-knowledge.domain";
import type { OpsSection } from "@/modules/assistant/services/assistant-ops.domain";

export interface Helplines {
  emergency: string;
  ambulance: string;
  cyberFraud: string;
  womenEmergency: string;
  womenSupport: string;
  childline: string;
  drugDeaddiction: string;
  teleManas: string;
  drugTrafficking: string;
  animalWelfare: string;
}

export interface AssistantRepository {
  /** Best-matching knowledge entries for the question (RAG chunks). */
  retrieveChunks(query: string, topK: number): KnowledgeEntry[];
  /** Keyword-triggered live operations data (ADMIN/VOLUNTEER only upstream). */
  buildLiveOpsContext(message: string, role: string): Promise<OpsSection[]>;
  /** Curated starter questions shown under the chat. */
  suggestedQuestions(): string[];
  /** The ONLY helpline numbers the agent may quote. */
  helplines(): Helplines;
}
