import { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { UserRole, SubscriptionTier, SubscriptionStatus } from "@prisma/client";

/**
 * SynergyAuth SSO — for the people who WORK here (senders/admins).
 *
 * This app has two kinds of humans and they must not be conflated:
 *   - SENDERS (Shane, Doug, staff) log in. They get SSO against the same IdP as Drive/Boards.
 *   - SIGNERS are external counterparties who open a tokenised /sign/<token> link. They have no
 *     account and never will.
 *
 * That is precisely why SynergySign is NOT fronted by oauth2-proxy the way Drive and Boards are:
 * a proxy in front of the whole app would turn every signing link into a login page an external
 * signer cannot pass, and signers also PATCH /api/documents/.../fields/... to fill values, so you
 * cannot cleanly carve them out at the proxy either. Keeping auth INSIDE the app lets it hold both
 * identities at once — SSO for staff, token for signers.
 */
const SYNERGYAUTH_ISSUER = process.env.SYNERGYAUTH_ISSUER || "";
const ssoEnabled = Boolean(
  SYNERGYAUTH_ISSUER && process.env.SYNERGYAUTH_CLIENT_ID && process.env.SYNERGYAUTH_CLIENT_SECRET,
);

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),

  providers: [
    // SSO first so it renders as the primary option on the sign-in page.
    ...(ssoEnabled
      ? [
          {
            id: "synergyauth",
            name: "SynergyAuth",
            type: "oauth" as const,
            wellKnown: `${SYNERGYAUTH_ISSUER}/.well-known/openid-configuration`,
            clientId: process.env.SYNERGYAUTH_CLIENT_ID!,
            clientSecret: process.env.SYNERGYAUTH_CLIENT_SECRET!,
            idToken: true,
            checks: ["pkce" as const, "state" as const],
            authorization: { params: { scope: "openid email profile" } },
            // Link the SSO identity to an existing account with the same email. NextAuth calls this
            // "dangerous" because a careless IdP could assert an email it never verified — and then
            // anyone could take over an account by signing up at that IdP with your address.
            // SynergyAuth is OUR first-party IdP and verifies its own emails, so the premise doesn't
            // hold. Without this, every staff member who already has a password account (e.g. Shane)
            // would hit OAuthAccountNotLinked on their first SSO login.
            allowDangerousEmailAccountLinking: true,
            profile(profile: any) {
              return {
                id: profile.sub,
                name: profile.name ?? profile.preferred_username ?? profile.email,
                email: profile.email,
                image: null,
                // An identity vouched for by our own IdP is already verified; without this the
                // middleware's `verified` gate would bounce every SSO user to /auth/verify.
                emailVerified: new Date(),
              } as any;
            },
          },
        ]
      : []),

    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password)
          throw new Error("Missing credentials");

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: {
            subscription: true,
            enterprise: {
              select: {
                id: true,
                subscription: true,
                administratorId: true,
              },
            },
          },
        });
        if (!user || !user.password) throw new Error("User not found");

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) {
          await prisma.accountAuditLog.create({
            data: {
              userId: user.id,
              event: "FAILED_LOG_IN",
            },
          });
          throw new Error("Invalid password");
        }

        await prisma.accountAuditLog.create({
          data: {
            userId: user.id,
            event: "LOGGED_IN",
          },
        });

        // If user is in an enterprise, use the enterprise's subscription
        let subscription = undefined;
        if (user.enterprise && user.enterprise.subscription) {
          subscription = {
            tier: user.enterprise.subscription.tier as SubscriptionTier,
            status: user.enterprise.subscription.status as SubscriptionStatus,
            currentPeriodEnd: user.enterprise.subscription.currentPeriodEnd ?? null,
          };
        } else if (user.subscription) {
          subscription = {
            tier: user.subscription.tier as SubscriptionTier,
            status: user.subscription.status as SubscriptionStatus,
            currentPeriodEnd: user.subscription.currentPeriodEnd ?? null,
          };
        }

        // Compute enterprise membership and admin status
        const enterpriseId = user.enterpriseId ?? null;
        const isEnterpriseAdmin = Boolean(user.enterprise && user.enterprise.administratorId === user.id);

        // Return exactly what NextAuth expects as a "User" object
        return {
          id: user.id,
          email: user.email,
          name: user.name || null,
          role: user.role as UserRole,
          verified: user.emailVerified ? true : false,
          subscription,
          enterpriseId,
          isEnterpriseAdmin,
        };
      },
    }),
  ],

  session: { strategy: "jwt" },

  callbacks: {
    /**
     * An identity asserted by our own IdP is verified by definition. Existing password users (who
     * may predate SSO, or whose emailVerified was never set) would otherwise be bounced to
     * /auth/verify on their first SSO login, which is a dead end — there is no verification mail to
     * click when you just came from the IdP.
     */
    async signIn({ user, account }) {
      if (account?.provider === "synergyauth" && user?.email) {
        await prisma.user.updateMany({
          where: { email: user.email, emailVerified: null },
          data: { emailVerified: new Date() },
        });
      }
      return true;
    },

    async jwt({ token, user }) {
      // On sign-in, seed token from user object
      if (user) {
        token.userId = (user as any).id;
        token.email = (user as any).email;
        token.role = (user as any).role;
        token.verified = ((user as any).emailVerified) ? true : false;
        token.subscription = (user as any).subscription;
        token.enterpriseId = (user as any).enterpriseId ?? null;
        token.isEnterpriseAdmin = (user as any).isEnterpriseAdmin ?? false;

        token.accessToken = jwt.sign(
          {
            userId: (user as any).id,
            email: (user as any).email,
            role: (user as any).role,
          },
          process.env.NEXTAUTH_SECRET!,
          { expiresIn: "1h" }
        );
        return token;
      }

      // No `user` provided (subsequent requests). Refresh critical fields from DB.
      if (token?.userId) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.userId as string },
            include: {
              subscription: true,
              enterprise: {
                select: {
                  id: true,
                  subscription: true,
                  administratorId: true,
                },
              },
            },
          });
          if (dbUser) {
            token.email = dbUser.email;
            token.role = dbUser.role as UserRole;
            token.verified = dbUser.emailVerified ? true : false;
            token.enterpriseId = dbUser.enterpriseId ?? null;
            // Note: isEnterpriseAdmin cannot be changed without re-login

            // If user is in an enterprise, use the enterprise's subscription
            if (dbUser.enterprise && dbUser.enterprise.subscription) {
              token.subscription = {
                tier: dbUser.enterprise.subscription.tier as SubscriptionTier,
                status: dbUser.enterprise.subscription.status as SubscriptionStatus,
                currentPeriodEnd: dbUser.enterprise.subscription.currentPeriodEnd ?? null,
              };
            } else if (dbUser.subscription) {
              token.subscription = {
                tier: dbUser.subscription.tier as SubscriptionTier,
                status: dbUser.subscription.status as SubscriptionStatus,
                currentPeriodEnd: dbUser.subscription.currentPeriodEnd ?? null,
              };
            } else {
              token.subscription = undefined;
            }
          }
        } catch (e) {
          // Swallow errors to avoid breaking auth; token remains unchanged
          // Non-fatal: keep prior token content
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token) {
        session.user = {
          id: token.userId as string,
          email: token.email as string,
          name: session.user?.name || null,
          role: token.role as UserRole,
          verified: token.verified as boolean,
          subscription: token.subscription as any,
          enterpriseId: token.enterpriseId ?? null,
          isEnterpriseAdmin: token.isEnterpriseAdmin ?? false,
        };
        session.accessToken = token.accessToken as string;
      }
      return session;
    },
  },

  pages: {
    signIn: "/auth/login",
  },

  secret: process.env.NEXTAUTH_SECRET,
};
