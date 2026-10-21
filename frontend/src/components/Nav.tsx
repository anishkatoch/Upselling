import { motion } from "framer-motion";
import { Link, useLocation } from "react-router-dom";
import { Grid, Headset, Mic, Users } from "../icons/Icons";
import { EASE } from "../lib/motion";
import "./topnav.css";

const ITEMS = [
  { to: "/", label: "Dashboard", icon: Grid, match: (p: string) => p === "/" },
  { to: "/team", label: "Team", icon: Users, match: (p: string) => p === "/team" || p.startsWith("/team/") },
  { to: "/recordings", label: "Recordings", icon: Mic, match: (p: string) => p === "/recordings" || p.startsWith("/recordings/") },
];

export default function Nav() {
  const { pathname } = useLocation();
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/" className="brand" aria-label="Upsell Insights home">
            <span className="brand-mark">
              <Headset size={15} />
            </span>
            <span className="brand-text">Upsell Insights</span>
          </Link>
          <nav className="top-nav" aria-label="Primary">
            {ITEMS.map((item) => {
              const on = item.match(pathname);
              return (
                <Link key={item.to} to={item.to} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
                  <item.icon size={15} /> <span>{item.label}</span>
                  {on && <motion.span layoutId="nav-underline" className="nav-underline" transition={{ duration: 0.25, ease: EASE }} />}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
    </>
  );
}
