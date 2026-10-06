import { useSession } from "./lib/session";
import { LoginPage } from "./components/LoginPage";
import { Shell } from "./components/Shell";
import { ThemeSync } from "./components/ThemeSync";

export function App() {
  const session = useSession((s) => s.session);
  return (
    <>
      <ThemeSync />
      {session ? <Shell key={session.username} /> : <LoginPage />}
    </>
  );
}
