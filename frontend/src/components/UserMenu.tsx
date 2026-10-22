import { useRef } from "react";
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

/** Who is signed in, and how to sign out (after a yes / no question, so a stray click does not end the session). */
export default function UserMenu() {
  const { user, logout } = useAuth();
  const ask = useRef<HTMLDialogElement>(null);
  if (!user) return null;
  return (
    <div className="user-menu">
      <span className="who" title={user.email || undefined}>
        <span className="avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className="name">{user.name}</span>
      </span>
      <button type="button" onClick={() => ask.current?.showModal()}>
        Log out
      </button>

      <dialog ref={ask} className="logout-dialog" aria-labelledby="logout-title">
        <h2 id="logout-title">Are you sure you want to log out?</h2>
        <div className="logout-actions">
          <button type="button" className="logout-no" onClick={() => ask.current?.close()} autoFocus>
            No
          </button>
          <button
            type="button"
            className="logout-yes"
            onClick={() => {
              ask.current?.close();
              void logout();
            }}
          >
            Yes, log out
          </button>
        </div>
      </dialog>
    </div>
  );
}
