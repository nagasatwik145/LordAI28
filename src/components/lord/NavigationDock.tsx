import { Link, useLocation } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  MessageSquare,
  GraduationCap,
  Target,
  Search,
  FileText,
  Settings,
  ChevronRight,
  BarChart3,
  Images,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/images", label: "Images", icon: Images },
  { to: "/study", label: "Study", icon: GraduationCap },
  { to: "/tasks", label: "Tasks", icon: Target },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/statistics", label: "Statistics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const STORAGE_KEY = "lord-sidebar-collapsed";

function NavTooltip({ label, visible }: { label: string; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: -8, scale: 0.92 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -6, scale: 0.92 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="pointer-events-none absolute left-full ml-3 z-50"
          role="tooltip"
        >
          <div
            className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium text-cyan-200 font-mono tracking-wider"
            style={{
              background: "rgba(6,12,24,0.92)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid rgba(0,255,255,0.22)",
              boxShadow: "0 0 18px rgba(0,255,255,0.18), 0 4px 16px rgba(0,0,0,0.5)",
            }}
          >
            {label}
            {/* Arrow */}
            <span
              className="absolute right-full top-1/2 -translate-y-1/2"
              style={{
                borderTop: "5px solid transparent",
                borderBottom: "5px solid transparent",
                borderRight: "6px solid rgba(0,255,255,0.22)",
                width: 0,
                height: 0,
                display: "block",
              }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  active,
  collapsed,
  index,
  isExpanding,
}: {
  to: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  collapsed: boolean;
  index: number;
  isExpanding: boolean;
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (collapsed) {
      tooltipTimer.current = setTimeout(() => setTooltipVisible(true), 150);
    }
  }, [collapsed]);

  const handleMouseLeave = useCallback(() => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltipVisible(false);
  }, []);

  useEffect(() => {
    if (!collapsed) {
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
      setTooltipVisible(false);
    }
  }, [collapsed]);

  // Stagger delay for expand animation
  const staggerDelay = isExpanding ? index * 0.04 : 0;

  return (
    <li className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <Link
        to={to}
        aria-label={label}
        className={cn(
          "group relative flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent",
          active ? "text-cyan-300" : "text-cyan-600/70 hover:text-cyan-300",
        )}
        style={
          active
            ? {
                background: "rgba(0,255,255,0.10)",
                boxShadow: "0 0 18px rgba(0,255,255,0.28), inset 0 0 10px rgba(0,255,255,0.06)",
              }
            : undefined
        }
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            (e.currentTarget as HTMLButtonElement).click();
          }
        }}
      >
        {/* Active pulse ring */}
        {active && (
          <motion.span
            className="absolute inset-0 rounded-2xl"
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            style={{
              boxShadow: "0 0 20px rgba(0,255,255,0.35)",
              border: "1px solid rgba(0,255,255,0.3)",
            }}
          />
        )}

        {/* Hover background */}
        <span
          className={cn(
            "absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200",
            !active && "group-hover:opacity-100",
          )}
          style={{ background: "rgba(0,255,255,0.07)" }}
        />

        <motion.div
          animate={collapsed ? { opacity: 0, x: -6 } : { opacity: 1, x: 0 }}
          transition={{
            duration: 0.22,
            ease: "easeInOut",
            delay: collapsed ? 0 : staggerDelay,
          }}
          className="relative z-10"
        >
          <Icon
            className={cn(
              "h-5 w-5 transition-all duration-200",
              active
                ? "drop-shadow-[0_0_8px_rgba(0,255,255,0.8)]"
                : "group-hover:scale-110 group-hover:drop-shadow-[0_0_6px_rgba(0,255,255,0.5)]",
            )}
          />
        </motion.div>
      </Link>

      {/* Tooltip — only when collapsed */}
      {collapsed && <NavTooltip label={label} visible={tooltipVisible} />}
    </li>
  );
}

export function NavigationDock() {
  const location = useLocation();
  const path = location.pathname;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [isExpanding, setIsExpanding] = useState(false);

  const toggle = useCallback(() => {
    const next = !collapsed;
    // if currently collapsed, we are expanding → stagger icons in
    setIsExpanding(collapsed);
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // ignore
    }
  }, [collapsed]);

  // Keyboard shortcut: Ctrl+B / Cmd+B
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  return (
    <motion.nav
      aria-label="Primary navigation"
      className="custom-scrollbar fixed left-4 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-center md:flex"
      animate={{ width: collapsed ? 14 : 72 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      style={{ overflow: "visible" }}
    >
      {/* Main dock panel */}
      <motion.div
        className="relative flex flex-col items-center gap-1 py-3"
        animate={{ width: collapsed ? 14 : 72 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        style={{
          background: collapsed ? "rgba(0,255,255,0.04)" : "rgba(6,12,24,0.82)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid rgba(0,255,255,0.12)",
          borderRadius: "24px",
          boxShadow: "0 0 25px rgba(0,255,255,0.18), 0 8px 32px rgba(0,0,0,0.5)",
          overflow: "visible",
          minHeight: "auto",
        }}
      >
        {/* Neon breathing edge highlight */}
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-3xl"
          animate={{ opacity: [0.4, 0.9, 0.4] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
          style={{
            boxShadow: "inset 0 0 0 1px rgba(0,255,255,0.18)",
          }}
        />

        {/* Animated cyan top edge highlight */}
        <div
          className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-full"
          style={{
            width: collapsed ? "8px" : "40px",
            height: "2px",
            background: "linear-gradient(90deg, transparent, rgba(0,255,255,0.8), transparent)",
            boxShadow: "0 0 8px rgba(0,255,255,0.6)",
            transition: "width 0.3s ease-in-out",
          }}
        />

        {/* Collapsed: thin glowing rail */}
        <AnimatePresence>
          {collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 rounded-3xl"
              style={{
                background:
                  "linear-gradient(180deg, rgba(0,255,255,0.0) 0%, rgba(0,255,255,0.12) 50%, rgba(0,255,255,0.0) 100%)",
              }}
            />
          )}
        </AnimatePresence>

        {/* Nav items */}
        <ul className="flex flex-col items-center gap-1 px-1.5">
          {NAV.map(({ to, label, icon }, index) => {
            const active = to === "/" ? path === "/" : path.startsWith(to);
            return (
              <NavItem
                key={to}
                to={to}
                label={label}
                icon={icon}
                active={active}
                collapsed={collapsed}
                index={index}
                isExpanding={isExpanding}
              />
            );
          })}
        </ul>

        {/* Bottom soft shadow */}
        <div
          className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full"
          style={{
            width: collapsed ? "8px" : "40px",
            height: "2px",
            background: "linear-gradient(90deg, transparent, rgba(0,255,255,0.5), transparent)",
            boxShadow: "0 0 6px rgba(0,255,255,0.4)",
            transition: "width 0.3s ease-in-out",
          }}
        />
      </motion.div>

      {/* Floating toggle button */}
      <motion.button
        onClick={toggle}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        aria-expanded={!collapsed}
        className={cn(
          "absolute -right-4 top-1/2 z-50 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70",
          "transition-all duration-200",
        )}
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.92 }}
        style={{
          background: "rgba(6,12,24,0.9)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(0,255,255,0.3)",
          boxShadow: "0 0 14px rgba(0,255,255,0.3), 0 2px 8px rgba(0,0,0,0.5)",
        }}
      >
        <motion.div
          animate={{ rotate: collapsed ? 0 : 180 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          <ChevronRight className="h-3.5 w-3.5 text-cyan-400" />
        </motion.div>
      </motion.button>
    </motion.nav>
  );
}
