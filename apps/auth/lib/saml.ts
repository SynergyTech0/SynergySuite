import * as samlify from 'samlify';
import forge from 'node-forge';
import { inflateRawSync } from 'zlib';
import { q, now } from './db';
import { issuer } from './keys';
import { encryptSecret, decryptSecret, isEncrypted } from './crypto';

/*
 * SAML 2.0 IdP via samlify. Self-signed X.509 signing cert generated on first
 * use (node-forge) and persisted in sa_saml_cert. SPs are registered in the
 * admin console (entity_id + ACS URL) and constructed on the fly.
 */

// samlify demands an XML schema validator; response XML is built from its own
// templates here, so a pass-through validator is acceptable.
samlify.setSchemaValidator({ validate: () => Promise.resolve('skipped') });

type CertRow = { id: string | number; key_pem: string; cert_pem: string };

let cachedCert: { keyPem: string; certPem: string } | null = null;

export async function samlCert(): Promise<{ keyPem: string; certPem: string }> {
  if (cachedCert) return cachedCert;
  const rows = await q<CertRow>(`SELECT * FROM sa_saml_cert WHERE id = 1::bigint`);
  if (rows.length > 0) {
    const keyPem = decryptSecret(rows[0].key_pem)!;
    // Lazily migrate a plaintext key (pre-encryption row) to ciphertext at rest.
    if (!isEncrypted(rows[0].key_pem)) {
      await q(`UPDATE sa_saml_cert SET key_pem = $1::text WHERE id = 1::bigint`, [encryptSecret(keyPem)]);
    }
    cachedCert = { keyPem, certPem: rows[0].cert_pem };
    return cachedCert;
  }
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + Math.floor(Date.now() / 1000).toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);
  const attrs = [{ name: 'commonName', value: 'SynergyAuth SAML IdP' }, { name: 'organizationName', value: 'SynergyTech' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const certPem = forge.pki.certificateToPem(cert);
  await q(
    `INSERT INTO sa_saml_cert (id, key_pem, cert_pem, created_ms) VALUES (1::bigint, $1::text, $2::text, $3::bigint)`,
    [encryptSecret(keyPem), certPem, now()],
  );
  cachedCert = { keyPem, certPem };
  return cachedCert;
}

export async function samlIdp() {
  const { keyPem, certPem } = await samlCert();
  const base = issuer();
  return samlify.IdentityProvider({
    entityID: `${base}/api/saml/metadata`,
    privateKey: keyPem,
    signingCert: certPem,
    wantAuthnRequestsSigned: false,
    nameIDFormat: ['urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'],
    singleSignOnService: [
      { Binding: samlify.Constants.namespace.binding.redirect, Location: `${base}/api/saml/sso` },
      { Binding: samlify.Constants.namespace.binding.post, Location: `${base}/api/saml/sso` },
    ],
    singleLogoutService: [
      { Binding: samlify.Constants.namespace.binding.redirect, Location: `${base}/api/saml/slo` },
    ],
  });
}

export type SamlSp = { id: string; entity_id: string; acs_url: string; slo_url: string | null; name: string };

export async function findSp(entityId: string): Promise<SamlSp | null> {
  const rows = await q<SamlSp>(`SELECT * FROM sa_saml_sps WHERE entity_id = $1::text`, [entityId]);
  return rows[0] ?? null;
}

export function spInstance(sp: SamlSp) {
  return samlify.ServiceProvider({
    entityID: sp.entity_id,
    assertionConsumerService: [
      { Binding: samlify.Constants.namespace.binding.post, Location: sp.acs_url },
    ],
    ...(sp.slo_url
      ? { singleLogoutService: [{ Binding: samlify.Constants.namespace.binding.redirect, Location: sp.slo_url }] }
      : {}),
    wantMessageSigned: false,
    wantAssertionsSigned: true,
    authnRequestsSigned: false,
  });
}

/** Pull the SP entityID out of a redirect-binding SAMLRequest without a full parse. */
export function issuerFromSamlRequest(samlRequestB64: string): string | null {
  try {
    const xml = inflateRawSync(Buffer.from(samlRequestB64, 'base64')).toString('utf8');
    const m = xml.match(/<(?:[a-zA-Z0-9]+:)?Issuer[^>]*>([^<]+)<\/(?:[a-zA-Z0-9]+:)?Issuer>/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}
