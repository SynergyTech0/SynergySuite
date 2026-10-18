import { scriptResponse } from "@/lib/script";

/** The earlier tool's script address, so sites that already load it keep counting. */
export const GET = () => scriptResponse();
