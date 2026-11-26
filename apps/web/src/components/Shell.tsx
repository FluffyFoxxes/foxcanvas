import { LayoutDashboard, LogOut, Settings } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const leave = async () => {
    await logout();
    navigate("/login");
  };
  return (
    <div className="min-h-screen bg-cream">
      <header className="flex h-16 items-center border-b border-stone-200 bg-white px-4 sm:px-6">
        <NavLink
          to="/"
          className="flex items-center gap-2 text-lg font-bold tracking-tight"
        >
          FoxCanvas
        </NavLink>
        <nav className="ml-4 flex gap-1 sm:ml-10 text-sm">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-2 py-2 sm:px-3 ${isActive ? "bg-stone-100 font-semibold" : "text-stone-500 hover:text-ink"}`
            }
          >
            <LayoutDashboard size={16} /> Boards
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-2 py-2 sm:px-3 ${isActive ? "bg-stone-100 font-semibold" : "text-stone-500 hover:text-ink"}`
            }
          >
            <Settings size={16} /> Settings
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden text-stone-500 sm:block">{user?.name}</span>
          <button
            onClick={leave}
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-ink"
            title="Log out"
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
