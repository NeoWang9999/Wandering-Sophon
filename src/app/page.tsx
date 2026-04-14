"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import SophonSidebar from "@/components/SophonSidebar";

const SophonScene = dynamic(() => import("@/components/SophonScene"), {
  ssr: false,
});

const DEMO_CLAIMED = [
  { index: 0, claimed: true, nickname: "旅行者1" },
  { index: 1, claimed: true, nickname: "旅行者2" },
  { index: 2, claimed: true, nickname: "旅行者3" },
  { index: 3, claimed: true, nickname: "旅行者4" },
  { index: 4, claimed: true, nickname: "旅行者5" },
];

export default function Home() {
  const [selectedSophon, setSelectedSophon] = useState<{
    index: number;
    claimed: boolean;
    nickname: string;
  } | null>(null);

  const handleSophonClick = useCallback((index: number) => {
    const demo = DEMO_CLAIMED.find((d) => d.index === index);
    setSelectedSophon(
      demo ?? { index, claimed: false, nickname: "" }
    );
  }, []);

  const handleClose = useCallback(() => {
    setSelectedSophon(null);
  }, []);

  const handleClaim = useCallback((index: number) => {
    setSelectedSophon({
      index,
      claimed: true,
      nickname: "新认领者",
    });
  }, []);

  return (
    <main className="w-screen h-screen">
      <SophonScene onSophonClick={handleSophonClick} />
      <SophonSidebar
        sophon={selectedSophon}
        onClose={handleClose}
        onClaim={handleClaim}
      />
    </main>
  );
}
