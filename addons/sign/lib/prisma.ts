// One database client for the whole app (lib/db), whichever path a route imports it from.
import { prisma } from './db';

export { prisma };
export default prisma;
