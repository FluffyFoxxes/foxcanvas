import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
export function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-cream px-6 text-center">
      <div>
        <p className="text-8xl font-black text-orange-200">404</p>
        <h1 className="mt-2 text-3xl font-bold">This idea wandered off.</h1>
        <p className="mt-3 text-stone-500">
          The page you’re looking for isn’t on this canvas.
        </p>
        <Link
          to="/"
          className="mt-7 inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 font-semibold text-white"
        >
          <ArrowLeft size={17} /> Back to boards
        </Link>
      </div>
    </main>
  );
}
