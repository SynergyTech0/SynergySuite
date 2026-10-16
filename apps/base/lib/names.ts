/** SQL identifiers: generated ones (db_<id>, t_<id>, f_<id>) and the names people type. */

/** Quotes a generated identifier; refuses anything that isn't one. */
export function ident(name: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error(`not a generated identifier: ${name}`);
  return `"${name}"`;
}

/** A Postgres identifier for any name people type: double quotes, with quotes inside doubled. */
export function quoteName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
