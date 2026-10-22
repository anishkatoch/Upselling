import { useAuth } from "../lib/auth";
import "../pages/auth.css";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Who is signed in, and how to sign out. */
export default function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="user-menu">
      <span className="who" title={user.email || undefined}>
        <span className="avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className="name">{user.name}</span>
      </span>
      <button type="button" onClick={() => void logout()}>
        Log out
      </button>
    </div>
  );
}
