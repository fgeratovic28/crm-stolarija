import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

const routeLabels: Record<string, string> = {
  "": "Kontrolna tabla",
  jobs: "Kupci / Poslovi",
  activities: "Aktivnosti",
  finances: "Finansije",
  "material-orders": "Narudžbine materijala",
  vehicles: "Vozila",
  "work-orders": "Radni nalozi",
  "field-reports": "Terenski izveštaji",
  files: "Fajlovi",
  users: "Korisnici",
  settings: "Podešavanja",
  profile: "Profil",
  login: "Prijava",
};

interface BreadcrumbsProps {
  items?: { label: string; href?: string }[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);

  const crumbs = items ?? segments.map((seg, i) => ({
    label: routeLabels[seg] || seg,
    href: i < segments.length - 1 ? "/" + segments.slice(0, i + 1).join("/") : undefined,
  }));

  return (
    <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
      <Link to="/" className="hover:text-foreground transition-colors flex items-center gap-1">
        <Home className="w-3 h-3" />
        <span>Početna</span>
      </Link>
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight className="w-3 h-3" />
          {c.href ? (
            <Link to={c.href} className="hover:text-foreground transition-colors">{c.label}</Link>
          ) : (
            <span className="text-foreground font-medium">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
