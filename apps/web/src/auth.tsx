import { createContext, useContext, type ReactNode } from "react";

export type User = {
  id: string;
  name: string;
  displayName: string;
};

const PIXELWAVE: User = {
  id: "pixelwave",
  name: "pixelwave",
  displayName: "pixelwave",
};

const AuthContext = createContext<{ user: User }>({ user: PIXELWAVE });

export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={{ user: PIXELWAVE }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
