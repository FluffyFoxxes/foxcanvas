import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api, type Board } from "../lib/api";

export function Dashboard() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    try {
      setBoards((await api<{ boards: Board[] }>("/boards")).boards);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load boards");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const create = async () => {
    const { board } = await api<{ board: Board }>("/boards", {
      method: "POST",
      body: JSON.stringify({ title: "Untitled board" }),
    });
    window.location.assign(`/board/${board.id}`);
  };
  const rename = async (board: Board) => {
    const title = prompt("Board title", board.title)?.trim();
    if (!title || title === board.title) return;
    const result = await api<{ board: Board }>(`/boards/${board.id}`, {
      method: "PUT",
      body: JSON.stringify({ title, updatedAt: board.updatedAt }),
    });
    setBoards((items) =>
      items.map((item) => (item.id === board.id ? result.board : item)),
    );
  };
  const remove = async (board: Board) => {
    if (!confirm(`Delete “${board.title}”? This cannot be undone.`)) return;
    await api(`/boards/${board.id}`, { method: "DELETE" });
    setBoards((items) => items.filter((item) => item.id !== board.id));
  };
  const shown = boards.filter((board) =>
    board.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <main className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Boards</h1>
          <p className="mt-2 text-sm text-stone-500">
            Your space to collect and connect ideas.
          </p>
        </div>
        <button
          onClick={create}
          className="flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-stone-700"
        >
          <Plus size={18} /> New board
        </button>
      </div>
      <div className="relative mt-10 max-w-sm">
        <Search className="absolute left-3 top-3 text-stone-400" size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search boards"
          className="w-full rounded-lg border border-stone-200 bg-white py-2.5 pl-10 pr-4 outline-none focus:border-fox"
        />
      </div>
      {error && <p className="mt-6 text-red-600">{error}</p>}
      <section className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((board) => (
          <article
            key={board.id}
            className="group relative min-h-44 overflow-hidden rounded-xl border border-stone-200 bg-white p-5 transition hover:border-stone-400"
          >
            <Link
              to={`/board/${board.id}`}
              className="absolute inset-0"
              aria-label={`Open ${board.title}`}
            />
            <div className="relative pointer-events-none">
              <h2 className="line-clamp-2 text-base font-semibold">
                {board.title}
              </h2>
              <p className="mt-2 text-sm text-stone-400">
                Updated{" "}
                {new Date(board.updatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
            <div className="absolute bottom-4 left-5 right-4 flex items-center justify-between">
              <ArrowUpRight
                className="text-stone-400 transition group-hover:text-fox"
                size={20}
              />
              <div className="relative z-10 flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                <button
                  onClick={() => void rename(board)}
                  className="rounded-lg p-2 hover:bg-stone-100"
                  title="Rename"
                >
                  <MoreHorizontal size={17} />
                </button>
                <button
                  onClick={() => void remove(board)}
                  className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600"
                  title="Delete"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </section>
      {!shown.length && !error && (
        <p className="mt-8 text-sm text-stone-500">
          {boards.length
            ? "No boards match your search."
            : "No boards yet. Create one to begin."}
        </p>
      )}
    </main>
  );
}
