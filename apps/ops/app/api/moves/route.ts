import { route } from "@/lib/api";
import { listMoves } from "@/lib/stock";

export const GET = route(async () => listMoves({ limit: 200 }));
