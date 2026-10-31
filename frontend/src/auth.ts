import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  providers: [
    Credentials({
      name: "AccessCore Credentials",
      credentials: {
        identifier: { label: "Email or User ID", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        try {
          if (!credentials?.identifier) {
            return null;
          }

          const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: credentials.identifier,
              password: credentials.password || "",
            }),
          });

          if (!res.ok) {
            return null;
          }

          const json = await res.json();
          if (!json.success || !json.data) {
            return null;
          }

          const { user, token } = json.data;
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            user_type: user.user_type,
            groups: user.groups,
            tenant_scope: user.tenant_scope,
            token,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as unknown as { role: string }).role;
        token.user_type = (user as unknown as { user_type: string }).user_type;
        token.groups = (user as unknown as { groups: string[] }).groups;
        token.tenant_scope = (user as unknown as { tenant_scope: string[] }).tenant_scope;
        token.apiToken = (user as unknown as { token: string }).token;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as unknown as { role: string }).role = token.role as string;
        (session.user as unknown as { user_type: string }).user_type = token.user_type as string;
        (session.user as unknown as { groups: string[] }).groups = token.groups as string[];
        (session.user as unknown as { tenant_scope: string[] }).tenant_scope = token.tenant_scope as string[];
        (session as unknown as { apiToken: string }).apiToken = token.apiToken as string;
      }
      return session;
    },
  },
});

