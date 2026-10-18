# Synergy Vault

A shared password vault for a team, the suite's stand-in for a team password manager.

- **Encrypted in the browser.** The vault passphrase never leaves the browser. It derives an AES-256-GCM key (PBKDF2-SHA256, 600,000 rounds) that encrypts every entry before it is sent; the server keeps only ciphertext, the salt and a verifier. A copy of the database or the server shows nothing readable. Lose the passphrase and the entries are gone: nobody can recover it.
- **Entries** hold a title, username, password, web address and notes, with copy, show and a password generator.
- **Locks itself** after 10 minutes without activity, and on Lock.
- **Change the passphrase** re-encrypts every entry in the browser and swaps them all in one transaction.
- **Activity** lists who unlocked, revealed, copied, added, changed and deleted what (the last 200 events).
- **Access** is the people in `VAULT_ALLOWED_EMAILS`, else `ADMIN_EMAILS`. With neither set nobody can open it. `VAULT_ACCESS_CONTACT` is who people without access are told to ask.

Vault is not in suite search or eDiscovery: the server can't read what it holds.

Port 3910, database `vault`. Tests run against Postgres when `TEST_DATABASE_URL` is set: `npm test --workspace apps/vault`.
