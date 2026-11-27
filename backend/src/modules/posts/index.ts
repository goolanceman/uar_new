/**
 * Posts module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/posts.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaPostRepository } from "./repositories/post.repository";
import { PostService } from "./services/post.service";
import { PostController } from "./controllers/post.controller";

const postRepository = new PrismaPostRepository();
const postService = new PostService(postRepository);

export const postController = new PostController(postService);
export { PostService, PostController, PrismaPostRepository };
