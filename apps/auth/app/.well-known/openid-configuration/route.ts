import { json } from '@/lib/http';
import { issuer } from '@/lib/keys';

export async function GET() {
  const base = issuer();
  return json({
    issuer: base,
    authorization_endpoint: `${base}/api/oidc/authorize`,
    token_endpoint: `${base}/api/oidc/token`,
    userinfo_endpoint: `${base}/api/oidc/userinfo`,
    jwks_uri: `${base}/api/oidc/jwks`,
    introspection_endpoint: `${base}/api/oidc/introspect`,
    revocation_endpoint: `${base}/api/oidc/revoke`,
    end_session_endpoint: `${base}/api/oidc/logout`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256', 'plain'],
    claims_supported: ['sub', 'email', 'email_verified', 'name', 'role'],
  });
}
