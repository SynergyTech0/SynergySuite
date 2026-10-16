import { vroute } from "@/lib/api";
import { balances, employeeByEmail, getEmployee, myTasks } from "@/lib/hr";
import { booksConfigured } from "@/lib/books";

export const GET = vroute(async (v) => {
  const row = await employeeByEmail(v.email);
  return {
    email: v.email,
    name: (row?.name as string) || v.name,
    roles: v.roles,
    teamSize: v.team.size,
    employee: row ? await getEmployee(v, row.id as string) : null,
    balances: await balances(v.email),
    openTasks: (await myTasks(v)).length,
    booksConnected: booksConfigured(),
  };
});
