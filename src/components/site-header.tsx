import Link from "next/link";
import { LibraryBig, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-black/[0.06] bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-[0.7rem] bg-[#0071e3] text-white shadow-sm">
            <LibraryBig className="size-5" />
          </span>
          <span>素材库</span>
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
