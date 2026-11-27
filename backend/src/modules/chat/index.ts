/**
 * Chat module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/chat.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { CommunityChatRepository } from "./repositories/chat.repository";
import { ChatService } from "./services/chat.service";
import { ChatController } from "./controllers/chat.controller";

const chatRepository = new CommunityChatRepository();
const chatService = new ChatService(chatRepository);

export const chatController = new ChatController(chatService);
export { ChatService, ChatController, CommunityChatRepository };
