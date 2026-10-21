import { Link, useLocation } from "react-router-dom";
import { Grid, Headset, Mic, Users } from "../icons/Icons";

const ITEMS = [
  { to: "/", label: "Dashboard", icon: Grid, match: (p: string) => p === "/" },
  { to: "/team", label: "Team", icon: Users, match: (p: string) => p.startsWith("/team") },
  { to: "/recordings", label: "Recordings", icon: Mic, match: (p: string) => p.startsWith("/recordings") },
];

export default function Nav() {
  const { pathname } = useLocation();
  return (
    <aside className="sidebar">
      <Link to="/" className="brand">
        <span className="brand-mark">
          <Headset size={15} />
        </span>
        Upsell Insights
      </Link>
      <nav className="side-nav">
        {ITEMS.map((item) => (
          <Link key={item.to} to={item.to} className={item.match(pathname) ? "on" : ""}>
            <item.icon size={16} /> {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
