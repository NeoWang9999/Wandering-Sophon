"use client";

import dynamic from "next/dynamic";

const SophonScene = dynamic(() => import("@/components/SophonScene"), {
  ssr: false,
});

export default function Home() {
  return (
    <main className="w-screen h-screen">
      <SophonScene />
    </main>
  );
}
