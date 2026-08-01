/**
 * SettingsIndexPage — tile-based landing page for /settings.
 * Clicking a tile navigates to the corresponding sub-page.
 */
import { Link } from "@tanstack/react-router";
import {
  Folder,
  KeyRound,
  Palette,
  RotateCcw,
  ScrollText,
  Shield,
  User,
  Users,
  Plug,
  Download,
  HelpCircle,
  FlaskConical,
} from "lucide-react";

interface Tile {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
  disabled?: boolean;
  comingSoonPrompt?: string;
}

const TILES: Tile[] = [
  {
    title: "Profile",
    description: "Display name, email, sign out",
    icon: User,
    to: "/settings/profile",
  },
  {
    title: "Security",
    description: "Change vault password, recovery kit, auto-lock",
    icon: KeyRound,
    to: "/settings/security",
  },
  {
    title: "Preferences",
    description: "Currency, number/date format, Bitcoin display",
    icon: Palette,
    to: "/settings/preferences",
  },
  {
    title: "Categories",
    description: "Organize spending categories in a hierarchy",
    icon: Folder,
    to: "/settings/categories",
  },
  {
    title: "Rules",
    description: "Auto-categorize, rename merchants, add tags",
    icon: ScrollText,
    to: "/settings/rules",
  },
  {
    title: "Household",
    description: "Invite members, shared views",
    icon: Users,
    to: "/settings/household",
  },
  {
    title: "Household security",
    description: "Refresh household keys, download a backup, see history",
    icon: Shield,
    to: "/settings/household-security",
  },
  {
    title: "Connectors",
    description: "Manage SimpleFIN / OrangeRails / xpub sources",
    icon: Plug,
    to: "/settings",
    disabled: true,
    comingSoonPrompt: "later",
  },
  {
    title: "Import / Export",
    description: "CSV import, encrypted backup, restore",
    icon: Download,
    to: "/settings/import-export",
  },
  {
    title: "Reset vault",
    description: "Remove all connections and credentials, keep history",
    icon: RotateCcw,
    to: "/settings/reset-vault",
  },
  {
    title: "About",
    description: "Version, open-source credits, privacy policy",
    icon: HelpCircle,
    to: "/settings/about",
  },
  {
    title: "Demo Data",
    description: "Load a sample family to explore the app",
    icon: FlaskConical,
    to: "/settings/demo",
  },
];

export function SettingsIndexPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Account, security, and data controls.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((tile) => (
          <TileCard key={tile.title} tile={tile} />
        ))}
      </div>
    </div>
  );
}

function TileCard({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  const inner = (
    <>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{tile.title}</span>
          {tile.disabled && tile.comingSoonPrompt && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              Prompt {tile.comingSoonPrompt}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">{tile.description}</div>
      </div>
    </>
  );
  const className =
    "flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors";

  if (tile.disabled) {
    return <div className={`${className} cursor-not-allowed opacity-60`}>{inner}</div>;
  }
  return (
    <Link to={tile.to} className={`${className} hover:border-primary/40 hover:bg-accent/40`}>
      {inner}
    </Link>
  );
}
