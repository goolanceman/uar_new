/**
 * Rooms module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/rooms.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaRoomRepository } from "./repositories/room.repository";
import { RoomService } from "./services/room.service";
import { RoomController } from "./controllers/room.controller";

const roomRepository = new PrismaRoomRepository();
const roomService = new RoomService(roomRepository);

export const roomsController = new RoomController(roomService);
export { RoomService, RoomController, PrismaRoomRepository };
