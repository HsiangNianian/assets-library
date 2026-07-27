import Link from "next/link";
import { LibraryBig, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-3 font-semibold">
          <span className="grid size-9 place-items-center rounded-xl bg-cyan-500 text-slate-950">
            <LibraryBig className="size-5" />
          </span>
          <span>素材中枢</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/">素材概览</Link>
          </Button>
          <Button asChild>
            <Link href="/upload">
              <Upload className="size-4" />
              上传素材
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
